// MyModellerReel main process: the window, settings, file access, the AI provider proxy and the local HTTP API.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
// tests drive the window while it sits behind others: keep it painting (screenshots, render loop)
if (process.env.MMR_TEST) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { registerAccount, needsSignIn, whenSignedIn, uploadFeedback } = require('./account.cjs');

// MMR_HOME: e2e runs keep their own data folder (and single-instance lock), away from the user's real app.
app.setPath('userData', process.env.MMR_HOME || path.join(app.getPath('appData'), 'MyModellerReel'));
const USER = app.getPath('userData');
const SETTINGS_FILE = path.join(USER, 'settings.json');
const API_FILE = path.join(USER, 'api.json');
const USER_PLUGINS = path.join(USER, 'plugins');
const BUILTIN_PLUGINS = path.join(__dirname, '..', '..', 'plugins');
const ROOT = path.join(__dirname, '..', '..');
fs.mkdirSync(USER_PLUGINS, { recursive: true });

const DEFAULTS = {
  ai: {
    provider: 'ollama', // ollama | anthropic | openai (any OpenAI-compatible server: Mistral API, LM Studio, vLLM…)
    ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'mistral' },
    anthropic: { apiKey: '', model: 'claude-sonnet-5-5' },
    openai: { baseUrl: 'https://api.mistral.ai/v1', apiKey: '', model: 'mistral-large-latest' },
    toolset: 'auto', // tools for local models: auto (routed per request) | all | a toolset name
    // image models for AI render and AI textures (#64, #65): a local ComfyUI, or an OpenAI-compatible images API
    image: { provider: 'comfyui', comfyui: { baseUrl: 'http://127.0.0.1:8188', checkpoint: '' }, openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-image-1' } },
    // text / image to 3D (#95): Tripo's API, or a local server that takes { prompt } or an image and answers a GLB
    mesh: { provider: 'tripo', tripo: { apiKey: '' }, local: { url: 'http://127.0.0.1:8081/generate' } },
  },
  shortcuts: {},
  language: 'en',
  api: { port: 7717 },
  startup: { defaultApplied: false }, // Start with Windows was turned on once, at the first start of the installed app
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
const merge = (a, b) =>
  Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b || {})])].map((k) => [k, a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b?.[k]) : (b?.[k] ?? a[k])]));
let settings = merge(DEFAULTS, readJson(SETTINGS_FILE, {}));
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

/** The renderer never sees API keys, only whether one is set. */
function publicSettings() {
  const s = structuredClone(settings);
  for (const p of ['anthropic', 'openai']) {
    s.ai[p].hasKey = !!s.ai[p].apiKey;
    delete s.ai[p].apiKey;
  }
  s.ai.image.openai.hasKey = !!s.ai.image.openai.apiKey;
  delete s.ai.image.openai.apiKey;
  s.ai.mesh.tripo.hasKey = !!s.ai.mesh.tripo.apiKey;
  delete s.ai.mesh.tripo.apiKey;
  return s;
}

// Files the renderer (and so AI scripts) may read or write. Anything else is refused.
const MODEL_EXT = /\.(glb|gltf|obj|stl|fbx|bin)$/i;
const OUT_EXT = /\.(glb|gltf|obj|stl|usdz|3mf|html|png|jpg|webm|mp4|gif|json|csv|txt|pgw|jgw|tfw|wld|xml|landxml|dxf|ifc|geojson|shp|shx|dbf|svg|pdf)$/i;

let win;
function createWindow(page) {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: 'MyModellerReel',
    icon: path.join(ROOT, 'resources', 'icon.png'),
    backgroundColor: '#22382b',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#f3e9d7', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: !process.env.MMR_TEST },
  });
  win.loadFile(path.join(ROOT, 'src', 'renderer', page));
  // Page errors go to a log file in the data folder, so they can be read without DevTools.
  const LOG = path.join(USER, 'renderer.log');
  fs.writeFileSync(LOG, '');
  win.webContents.on('console-message', (e, lvl, msg, line, src) => {
    const level = e.level ?? lvl;
    if (level === 'error' || level === 'warning' || level >= 2) fs.appendFileSync(LOG, `[${level}] ${e.message ?? msg} (${e.sourceId ?? src}:${e.lineNumber ?? line})\n`);
  });
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')))
      win.webContents.toggleDevTools();
  });
  win.on('close', (e) => {
    if (win.__confirmed) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
  });
}

ipcMain.handle('app:close-confirmed', () => {
  win.__confirmed = true;
  win.close();
});
// how-to pages (#158): only docs/how-to/<id>.md
ipcMain.handle('help:read', (_, id) => {
  if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error('No such page.');
  return fs.readFileSync(path.join(ROOT, 'docs', 'how-to', `${id}.md`), 'utf8');
});
ipcMain.handle('app:info', () => ({ test: !!process.env.MMR_TEST, version: app.getVersion(), userData: USER, apiPort: settings.api.port, pluginsDir: USER_PLUGINS, appRoot: ROOT }));
ipcMain.handle('settings:get', () => publicSettings());
// Local AI servers and models on this PC (#198): what answers on the usual ports, and the Hugging Face cache.
ipcMain.handle('ai:detect', async () => {
  const probe = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(900) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const servers = [];
  const ol = await probe('http://127.0.0.1:11434/api/tags');
  if (ol) servers.push({ name: 'Ollama', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: (ol.models || []).map((m) => m.name) });
  for (const [name, port] of [['LM Studio', 1234], ['llama.cpp / LocalAI', 8080], ['vLLM', 8000], ['Jan', 1337], ['GPT4All', 4891]]) {
    const r = await probe(`http://127.0.0.1:${port}/v1/models`);
    if (r) servers.push({ name, provider: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, models: (r.data || []).map((m) => m.id) });
  }
  // models downloaded from Hugging Face (they need a server such as Ollama or LM Studio to run)
  const hub = path.join(process.env.HF_HOME || path.join(require('node:os').homedir(), '.cache', 'huggingface'), 'hub');
  let huggingface = [];
  try {
    huggingface = fs.readdirSync(hub).filter((d) => d.startsWith('models--')).map((d) => {
      let gguf = false;
      try {
        const snaps = path.join(hub, d, 'snapshots');
        gguf = fs.readdirSync(snaps).some((s) => fs.readdirSync(path.join(snaps, s)).some((f) => f.endsWith('.gguf')));
      } catch {}
      return { id: d.slice(8).replace('--', '/'), gguf };
    });
  } catch {}
  const claudeDesktop = fs.existsSync(path.join(process.env.APPDATA || '', 'Claude'));
  // installed but not running: the app and the models it has, so we can say "start it"
  const home = require('node:os').homedir();
  const local = process.env.LOCALAPPDATA || '';
  const ls = (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  };
  const installed = [];
  const ollamaModels = ls(path.join(home, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library')).flatMap((m) => ls(path.join(home, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library', m)).map((t) => `${m}:${t}`));
  if (!ol && (fs.existsSync(path.join(local, 'Programs', 'Ollama')) || ollamaModels.length)) installed.push({ name: 'Ollama', models: ollamaModels, start: 'Start Ollama (from the Start menu, or run "ollama serve").' });
  const lms = [path.join(home, '.lmstudio', 'models'), path.join(home, '.cache', 'lm-studio', 'models')].flatMap((d) => ls(d).flatMap((pub) => ls(path.join(d, pub)).map((m) => `${pub}/${m}`)));
  if (!servers.some((s) => s.name === 'LM Studio') && (fs.existsSync(path.join(local, 'Programs', 'LM Studio')) || lms.length)) installed.push({ name: 'LM Studio', models: lms, start: 'Open LM Studio, load a model and turn on its local server (Developer tab).' });
  return { servers, installed, huggingface, claudeDesktop };
});

// Local AI setup (#224): where Ollama stands, start it, install it (in a window the user sees), download a model.
const OLLAMA_DIR = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama');
const ollamaBase = () => (settings.ai.ollama.baseUrl || 'http://127.0.0.1:11434').replace(/\/(v1|api)?\/?$/, '');
ipcMain.handle('ai:setup-status', async () => {
  let running = null;
  try {
    const r = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) running = await r.json();
  } catch {}
  const installed = !!running || fs.existsSync(path.join(OLLAMA_DIR, 'ollama.exe'));
  const models = (running?.models || []).map((m) => m.name);
  const want = settings.ai.ollama.model;
  const has = models.some((m) => m === want || m.split(':')[0] === want.split(':')[0]);
  return { provider: settings.ai.provider, ollama: running ? 'running' : installed ? 'stopped' : 'missing', models, model: want, has_model: has, platform: process.platform };
});
ipcMain.handle('ai:ollama-start', () => {
  const gui = path.join(OLLAMA_DIR, 'ollama app.exe');
  const exe = fs.existsSync(gui) ? gui : fs.existsSync(path.join(OLLAMA_DIR, 'ollama.exe')) ? path.join(OLLAMA_DIR, 'ollama.exe') : 'ollama';
  const child = require('node:child_process').spawn(exe, exe.endsWith('app.exe') ? [] : ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
  return { started: exe };
});
// winget in a console window: the user sees what is installed and answers its questions themselves
ipcMain.handle('ai:ollama-install', () => {
  if (process.platform !== 'win32') return shell.openExternal('https://ollama.com/download').then(() => ({ opened: 'https://ollama.com/download' }));
  const child = require('node:child_process').spawn('cmd.exe', ['/c start "Install Ollama" cmd /k "winget install -e --id Ollama.Ollama && echo Ollama is installed: go back to MyModellerReel and press Start."'], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
  child.on('error', () => shell.openExternal('https://ollama.com/download'));
  child.unref();
  return { opened: 'winget' };
});
let pulling = null;
ipcMain.handle('ai:ollama-pull', async (event, model) => {
  if (!/^[\w.:/-]{1,80}$/.test(String(model))) throw new Error('Not a model name.');
  pulling = new AbortController();
  const res = await fetch(`${ollamaBase()}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }), signal: pulling.signal }).catch((e) => {
    throw new Error(`Cannot reach Ollama (${e.cause?.code || e.message}). Start it first.`);
  });
  if (!res.ok) throw new Error(`Ollama: ${res.status} ${await res.text()}`);
  let buf = '';
  let last = {};
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    for (let i; (i = buf.indexOf('\n')) >= 0; ) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      last = JSON.parse(line);
      if (last.error) throw new Error(`Ollama: ${last.error}`);
      event.sender.send('ai:pull-progress', { model, status: last.status, completed: last.completed || 0, total: last.total || 0 });
    }
  }
  pulling = null;
  return { model, status: last.status || 'success' };
});
ipcMain.handle('ai:ollama-pull-cancel', () => pulling?.abort());

// copilot feedback (#232): one JSON file per rated turn in <userData>/feedback; shared ones upload to the suite
const FEEDBACK = path.join(USER, 'feedback');
const feedbackFile = (id) => {
  if (!/^[\w-]{1,64}$/.test(String(id))) throw new Error('Not a feedback id.');
  return path.join(FEEDBACK, `${id}.json`);
};
const readFeedback = () => (fs.existsSync(FEEDBACK) ? fs.readdirSync(FEEDBACK).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(FEEDBACK, f), null)).filter(Boolean) : []);
async function shareFeedback() {
  const pending = readFeedback().filter((r) => r.rating && !r.shared).slice(0, 20);
  if (!pending.length) return { uploaded: 0 };
  const FB = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'feedback.js')).href);
  const r = await uploadFeedback(pending.map((x) => FB.uploadRow(x)));
  for (const x of pending) fs.writeFileSync(feedbackFile(x.id), JSON.stringify({ ...x, shared: true }));
  return r;
}
ipcMain.handle('feedback:save', async (_, record) => {
  fs.mkdirSync(FEEDBACK, { recursive: true });
  fs.writeFileSync(feedbackFile(record.id), JSON.stringify(record));
  if (!settings.ai.shareFeedback) return { saved: record.id, shared: false };
  try {
    return { saved: record.id, ...(await shareFeedback()), shared: true };
  } catch (e) {
    return { saved: record.id, shared: false, error: e.message }; // kept; tried again with the next rating
  }
});
ipcMain.handle('feedback:list', () => readFeedback());
ipcMain.handle('feedback:share', () => shareFeedback());
ipcMain.handle('feedback:export', (_, file, text) => {
  if (!/\.jsonl$/i.test(String(file))) throw new Error('Export to a .jsonl file.');
  fs.writeFileSync(file, text);
  return { path: file };
});

ipcMain.handle('settings:set', (_, patch) => {
  for (const p of ['anthropic', 'openai']) if (patch?.ai?.[p] && !patch.ai[p].apiKey) delete patch.ai[p].apiKey; // blank = keep
  if (patch?.ai?.image?.openai && !patch.ai.image.openai.apiKey) delete patch.ai.image.openai.apiKey;
  if (patch?.ai?.mesh?.tripo && !patch.ai.mesh.tripo.apiKey) delete patch.ai.mesh.tripo.apiKey;
  if (patch?.shortcuts) settings.shortcuts = {}; // replaced whole, so removed shortcuts go
  settings = merge(settings, patch);
  saveSettings();
  return publicSettings();
});
ipcMain.handle('window:title', (_, t) => win.setTitle(t));
ipcMain.handle('shell:open-path', (_, p) => shell.openPath(p === 'plugins' ? USER_PLUGINS : p === 'library' ? LIBRARY : USER));
// the component library (#45): GLB / glTF files in a folder; the starter models are copied in once
const LIBRARY = path.join(USER, 'library');
fs.mkdirSync(LIBRARY, { recursive: true });
try {
  const bundled = path.join(ROOT, 'resources', 'library');
  if (fs.existsSync(bundled)) for (const f of fs.readdirSync(bundled)) if (!fs.existsSync(path.join(LIBRARY, f)) && !fs.existsSync(path.join(LIBRARY, `.${f}.removed`))) fs.copyFileSync(path.join(bundled, f), path.join(LIBRARY, f));
} catch (e) {
  console.error('library:', e);
}
// groups and tags of library models: library.json beside them ({ "Tree.glb": { group, tags } })
const LIB_META = path.join(LIBRARY, 'library.json');
const libMeta = () => {
  try {
    return JSON.parse(fs.readFileSync(LIB_META, 'utf8'));
  } catch {
    return {};
  }
};
const cleanMeta = (m = {}) => ({ ...(m.group ? { group: String(m.group).slice(0, 60) } : {}), ...(Array.isArray(m.tags) && m.tags.length ? { tags: [...new Set(m.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 20) } : {}) });
const setMeta = (name, m) => {
  const all = libMeta();
  all[name] = cleanMeta({ ...all[name], ...m });
  fs.writeFileSync(LIB_META, JSON.stringify(all, null, 1));
  return all[name];
};
ipcMain.handle('library:list', () => {
  const meta = libMeta();
  return fs.readdirSync(LIBRARY).filter((f) => /\.(glb|gltf)$/i.test(f)).map((f) => ({ name: f, size: fs.statSync(path.join(LIBRARY, f)).size, group: meta[f]?.group || '', tags: meta[f]?.tags || [] }));
});
ipcMain.handle('library:meta', (_, name, m) => {
  const f = path.basename(String(name));
  if (!fs.existsSync(path.join(LIBRARY, f))) throw new Error(`No "${f}" in the component library.`);
  return setMeta(f, m || {});
});
// a model added to the library: GLB bytes (the page converts other formats first), never over an existing file
ipcMain.handle('library:add', (_, name, data, meta) => {
  const stem = path.basename(String(name)).replace(/\.\w+$/, '').replace(/[^\w .()-]+/g, '_').slice(0, 80) || 'Model';
  if (!(data instanceof ArrayBuffer || ArrayBuffer.isView(data)) || data.byteLength > 300e6) throw new Error('A library model is GLB bytes under 300 MB.');
  let file = `${stem}.glb`;
  for (let k = 2; fs.existsSync(path.join(LIBRARY, file)); k++) file = `${stem} ${k}.glb`;
  fs.writeFileSync(path.join(LIBRARY, file), Buffer.from(data instanceof ArrayBuffer ? data : data.buffer));
  if (meta) setMeta(file, meta);
  return file;
});
ipcMain.handle('library:path', (_, name) => {
  const p = path.join(LIBRARY, path.basename(String(name)));
  if (!/\.(glb|gltf)$/i.test(p) || !fs.existsSync(p)) throw new Error(`No "${name}" in the component library.`);
  return p;
});
const startupState = () => ({ supported: app.isPackaged, enabled: app.getLoginItemSettings().openAtLogin });
ipcMain.handle('startup:get', () => startupState());
ipcMain.handle('startup:set', (_, on) => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!on });
  return startupState();
});
ipcMain.handle('shell:open-url', (_, url) => /^https:\/\//.test(url) && shell.openExternal(url));

ipcMain.handle('file:save-dialog', async (_, { defaultPath, filters }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('file:open-dialog', async (_, { filters, multi }) => {
  const r = await dialog.showOpenDialog(win, { properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters });
  return r.canceled ? null : multi ? r.filePaths : r.filePaths[0];
});
ipcMain.handle('file:read', (_, p) => {
  if (!MODEL_EXT.test(p)) throw new Error(`Refusing to read ${path.basename(p)}: only model files.`);
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
// drawings and images placed as underlays
ipcMain.handle('file:read-binary', (_, p) => {
  if (!/\.(pdf|png|jpe?g|gif|bmp|tiff?|webp|hdr|exr|mp3|wav|ogg|m4a|aac|flac|ply|las|laz|e57|xyz|pts|csv|txt|ifc|shp|shx|dbf)$/i.test(p)) throw new Error(`Refusing to read ${path.basename(p)}: only PDF, image, audio and IFC files.`);
  if (fs.statSync(p).size > 300e6) throw new Error('That file is over 300 MB.');
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
// survey files, feature libraries and world files, as text
ipcMain.handle('file:read-text', (_, p) => {
  if (!/\.(csv|txt|xyz|pnezd|penzd|json|pgw|pngw|jgw|jpgw|tfw|tifw|gfw|bpw|wld|xml|landxml|dxf|ifc|jxl|fxl|geojson|asc|prj|xer|svg)$/i.test(p)) throw new Error(`Refusing to read ${path.basename(p)}: only text, world and exchange files.`);
  if (fs.statSync(p).size > (/\.(dxf|ifc|xml|landxml)$/i.test(p) ? 300e6 : 50e6)) throw new Error('That file is too big.');
  return fs.readFileSync(p, 'utf8');
});
ipcMain.handle('file:write', (_, p, data) => {
  if (!OUT_EXT.test(p)) throw new Error(`Refusing to write ${path.basename(p)}: only model, image and video files.`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data));
  return p;
});

ipcMain.handle('plugins:list', () => {
  const list = [];
  for (const [dir, builtin] of [[BUILTIN_PLUGINS, true], [USER_PLUGINS, false]])
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      if (/\.m?js$/.test(f)) list.push({ name: f.replace(/\.m?js$/, ''), builtin, url: pathToFileURL(path.join(dir, f)).href });
  return list;
});
ipcMain.handle('plugins:write', (_, name, code) => {
  if (!/^[\w-]{1,60}$/.test(name)) throw new Error('Bad plugin name');
  const file = path.join(USER_PLUGINS, `${name}.js`);
  fs.writeFileSync(file, code);
  return { name, url: pathToFileURL(file).href, path: file };
});

// ---------------------------------------------------------------- AI provider proxy (keys stay in this process)
// ---------------------------------------------------------------- updates (#108): GitHub releases, downloaded in the background
let updater = null;
const updateState = { status: 'idle', current: app.getVersion() };
function startUpdates() {
  if (!app.isPackaged || process.env.MMR_TEST) return; // dev builds and tests never update themselves
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => (updateState.status = 'checking'));
  updater.on('update-not-available', () => Object.assign(updateState, { status: 'current' }));
  updater.on('update-available', (i) => Object.assign(updateState, { status: 'downloading', latest: i.version }));
  updater.on('download-progress', (p) => (updateState.percent = Math.round(p.percent)));
  updater.on('update-downloaded', (i) => {
    Object.assign(updateState, { status: 'ready', latest: i.version });
    win?.webContents.send('update:ready', i.version);
  });
  updater.on('error', (e) => Object.assign(updateState, { status: 'error', error: String(e.message || e).slice(0, 300) }));
  const check = () => updater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 3600 * 1000).unref();
}
ipcMain.handle('update:check', async () => {
  if (!updater) return { ...updateState, status: app.isPackaged ? 'off' : 'dev build: updates come with the installer' };
  await updater.checkForUpdates().catch((e) => Object.assign(updateState, { status: 'error', error: String(e.message || e) }));
  return { ...updateState };
});
ipcMain.handle('update:install', () => {
  if (updateState.status !== 'ready') throw new Error('No update is ready yet.');
  win.__confirmed = true;
  setImmediate(() => updater.quitAndInstall(false, true));
  return { restarting: true };
});

const { readStream } = require('./stream.cjs');
let aiAbort = null;
ipcMain.handle('ai:abort', () => aiAbort?.abort());
ipcMain.handle('ai:chat', async (event, body) => {
  const ai = settings.ai;
  let url;
  let headers = { 'content-type': 'application/json' };
  if (ai.provider === 'anthropic') {
    if (!ai.anthropic.apiKey) throw new Error('Add your Claude API key in AI settings.');
    url = 'https://api.anthropic.com/v1/messages';
    headers = { ...headers, 'x-api-key': ai.anthropic.apiKey, 'anthropic-version': '2023-06-01' };
    body = { model: ai.anthropic.model, max_tokens: 8192, ...body };
  } else if (ai.provider === 'openai') {
    url = `${ai.openai.baseUrl.replace(/\/$/, '')}/chat/completions`;
    if (ai.openai.apiKey) headers.authorization = `Bearer ${ai.openai.apiKey}`;
    body = { model: ai.openai.model, ...body };
  } else {
    // Ollama's native endpoint, because only it lets us raise the context window for long tool lists.
    url = `${ai.ollama.baseUrl.replace(/\/(v1|api)?\/?$/, '')}/api/chat`;
    body = { model: ai.ollama.model, ...body };
  }
  let res;
  try {
    aiAbort = new AbortController();
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true, ...(ai.provider === 'openai' ? { stream_options: { include_usage: true } } : {}) }), signal: AbortSignal.any([aiAbort.signal, AbortSignal.timeout(300000)]) });
  } catch (e) {
    if (aiAbort?.signal.aborted) throw new Error('Stopped.');
    const hint = ai.provider === 'ollama' ? ' Is Ollama running? Start it, then `ollama pull mistral`.' : '';
    throw new Error(`Cannot reach ${url}: ${e.cause?.code || e.message}.${hint}`);
  }
  if (!res.ok) throw new Error(`${ai.provider} ${res.status}: ${(await res.text()).slice(0, 500)}`);
  // text goes to the page as it arrives; the rebuilt reply is the same object the non-streaming APIs return
  // servers that ignore stream: true answer plain JSON
  if ((res.headers.get('content-type') || '').includes('application/json')) return { provider: ai.provider, data: JSON.parse(await res.text()) };
  try {
    return { provider: ai.provider, data: await readStream(ai.provider, res.body, (t) => event.sender.send('ai:delta', t)) };
  } catch (e) {
    if (aiAbort?.signal.aborted) throw new Error('Stopped.');
    throw e;
  }
});

// An image from an image model (#64, #65): { prompt, negative, image (base64 PNG of the view, or none), strength,
// width, height } → { b64 } PNG. ComfyUI: upload, queue, wait for /history, fetch /view. OpenAI: images API.
ipcMain.handle('ai:image', async (_, req) => {
  const IG = await import('../core/imagegen.js');
  const cfg = settings.ai.image;
  const signal = AbortSignal.timeout(600000);
  if (cfg.provider === 'openai') {
    if (!cfg.openai.apiKey) throw new Error('Add an API key for the image model in AI settings.');
    const r = IG.openaiImageRequest({ prompt: req.prompt, image: req.image, model: cfg.openai.model, baseUrl: cfg.openai.baseUrl });
    const headers = { authorization: `Bearer ${cfg.openai.apiKey}` };
    let res;
    if (r.form) {
      const form = new FormData();
      for (const [k, v] of Object.entries(r.form)) form.append(k, v);
      form.append(r.file.field, new Blob([Buffer.from(req.image, 'base64')], { type: r.file.type }), r.file.name);
      res = await fetch(r.url, { method: 'POST', headers, body: form, signal });
    } else res = await fetch(r.url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(r.json), signal });
    const out = IG.openaiImageResult(await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } })));
    if (out.b64) return { b64: out.b64 };
    return { b64: Buffer.from(await (await fetch(out.url, { signal })).arrayBuffer()).toString('base64') };
  }
  const base = cfg.comfyui.baseUrl.replace(/\/$/, '');
  const hint = (e) => new Error(`ComfyUI at ${base} did not answer (${e.message}). Start ComfyUI, or choose another image model in AI settings.`);
  let image = null;
  if (req.image) {
    const form = new FormData();
    form.append('image', new Blob([Buffer.from(req.image, 'base64')], { type: 'image/png' }), `mmr-view-${Date.now()}.png`);
    form.append('overwrite', 'true');
    const up = await fetch(`${base}/upload/image`, { method: 'POST', body: form, signal }).catch((e) => { throw hint(e); });
    image = (await up.json()).name;
  }
  const graph = IG.comfyWorkflow({ ...req, image, checkpoint: cfg.comfyui.checkpoint });
  const q = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }), signal }).catch((e) => { throw hint(e); });
  const qj = await q.json();
  if (!qj.prompt_id) throw new Error(`ComfyUI refused the workflow: ${JSON.stringify(qj.error || qj.node_errors || qj).slice(0, 300)}`);
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await (await fetch(`${base}/history/${qj.prompt_id}`, { signal })).json();
    const im = IG.comfyResult(h, qj.prompt_id);
    if (im) {
      const v = await fetch(`${base}/view?${new URLSearchParams({ filename: im.filename, subfolder: im.subfolder || '', type: im.type })}`, { signal });
      return { b64: Buffer.from(await v.arrayBuffer()).toString('base64') };
    }
  }
  throw new Error('ComfyUI took more than 10 minutes.');
});

// ---------------------------------------------------------------- Phase 15: compression, CC0 assets, text to 3D, voice, autosave history
const TEMP_DIR = path.join(app.getPath('temp'), 'MyModellerReel');
fs.mkdirSync(TEMP_DIR, { recursive: true });
/** gltf-transform with every extension and the meshopt / draco codecs (loaded once, on first use). */
let gltfIO = null;
async function gltfTools() {
  if (gltfIO) return gltfIO;
  const [{ NodeIO }, { ALL_EXTENSIONS }, fns, { MeshoptEncoder, MeshoptDecoder }, draco] = await Promise.all([import('@gltf-transform/core'), import('@gltf-transform/extensions'), import('@gltf-transform/functions'), import('meshoptimizer'), import('draco3dgltf')]);
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const d = draco.default || draco;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder, 'draco3d.encoder': await d.createEncoderModule(), 'draco3d.decoder': await d.createDecoderModule() });
  return (gltfIO = { io, fns, MeshoptEncoder });
}
// GLB compression (#104): meshopt or draco, written back (or to out)
ipcMain.handle('glb:compress', async (_, file, method = 'meshopt', out) => {
  if (!/\.glb$/i.test(file) || (out && !/\.glb$/i.test(out))) throw new Error('compress_glb works on .glb files.');
  const { io, fns, MeshoptEncoder } = await gltfTools();
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  await doc.transform(fns.dedup(), fns.weld(), method === 'draco' ? fns.draco() : fns.meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(out || file, doc);
  const after = fs.statSync(out || file).size;
  return { path: out || file, method, before, after, saved: `${Math.round((1 - after / before) * 100)} %` };
});
// CC0 asset sources (#106): only these hosts, GET only
const ASSET_HOST = /^https:\/\/(api\.polyhaven\.com|dl\.polyhaven\.org|cdn\.polyhaven\.com)\//;
ipcMain.handle('net:json', async (_, url) => {
  if (!ASSET_HOST.test(url)) throw new Error('That address is not an allowed asset source.');
  const r = await fetch(url, { headers: { 'user-agent': 'MyModellerReel' }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`The asset source answered ${r.status}.`);
  return r.json();
});
ipcMain.handle('net:download', async (_, files) => {
  const dir = path.join(TEMP_DIR, `asset-${Date.now()}`);
  for (const f of files) {
    if (!ASSET_HOST.test(f.url)) throw new Error('That address is not an allowed asset source.');
    const rel = path.normalize(String(f.path)).replace(/^(\.\.[\\/])+/, '');
    const dest = path.join(dir, rel);
    if (!dest.startsWith(dir)) throw new Error('A file path outside the download folder.');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = await fetch(f.url, { headers: { 'user-agent': 'MyModellerReel' }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`Download failed (${r.status}): ${path.basename(rel)}`);
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  }
  const first = path.join(dir, files[0].path);
  // a glTF with its buffers and textures becomes one GLB, so the importer reads a single file
  if (/\.gltf$/i.test(first)) {
    const { io } = await gltfTools();
    const glb = first.replace(/\.gltf$/i, '.glb');
    await io.write(glb, await io.read(first));
    return [glb];
  }
  return [first];
});
// text / image to 3D (#95): a GLB in the temp folder
ipcMain.handle('mesh:generate', async (_, req) => {
  const cfg = settings.ai.mesh;
  const out = path.join(TEMP_DIR, `generated-${Date.now()}.glb`);
  const IOm = await import('../core/interop.js');
  if (cfg.provider === 'local') {
    const body = req.image ? fs.readFileSync(req.image) : JSON.stringify({ prompt: req.prompt });
    const r = await fetch(cfg.local.url, { method: 'POST', headers: { 'content-type': req.image ? 'application/octet-stream' : 'application/json' }, body, signal: AbortSignal.timeout(900000) }).catch((e) => { throw new Error(`The local 3D server at ${cfg.local.url} did not answer (${e.message}).`); });
    if (!r.ok) throw new Error(`The local 3D server answered ${r.status}.`);
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    return out;
  }
  if (!cfg.tripo.apiKey) throw new Error('Add a Tripo API key in AI settings (or choose a local 3D server).');
  const H = { authorization: `Bearer ${cfg.tripo.apiKey}` };
  let token = null;
  if (req.image) {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(req.image)], { type: 'image/png' }), path.basename(req.image));
    token = (await (await fetch('https://api.tripo3d.ai/v2/openapi/upload', { method: 'POST', headers: H, body: form })).json()).data?.image_token;
  }
  const task = await (await fetch('https://api.tripo3d.ai/v2/openapi/task', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(IOm.meshTask({ prompt: req.prompt, imageToken: token })) })).json();
  const id = task.data?.task_id;
  if (!id) throw new Error(`The 3D service refused the task: ${task.message || JSON.stringify(task).slice(0, 200)}`);
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const url = IOm.meshResult(await (await fetch(`https://api.tripo3d.ai/v2/openapi/task/${id}`, { headers: H })).json());
    if (url) {
      fs.writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
      return out;
    }
  }
  throw new Error('The 3D service took more than 15 minutes.');
});
// voice (#98): MyVoiceReel's command line engine, on this PC
function voiceCli() {
  const c = [path.join(process.env.LOCALAPPDATA || '', 'MyVoiceReel', 'myvoicereel-cli.exe'), path.join(process.env.ProgramFiles || '', 'MyVoiceReel', 'myvoicereel-cli.exe')];
  return c.find((p) => fs.existsSync(p));
}
ipcMain.handle('voice:transcribe', async (_, input, lang) => {
  const exe = voiceCli();
  if (!exe) throw new Error('Voice needs MyVoiceReel installed (its speech engine runs on this PC).');
  const audio = typeof input === 'string' ? input : path.join(TEMP_DIR, `voice-${Date.now()}.wav`);
  if (typeof input !== 'string') fs.writeFileSync(audio, Buffer.from(input));
  const txt = path.join(TEMP_DIR, `transcript-${Date.now()}.txt`); // never beside the user's recording
  await new Promise((res, rej) => require('node:child_process').execFile(exe, ['transcribe', audio, '--txt', txt, ...(lang ? ['--lang', lang] : [])], { timeout: 120000, windowsHide: true }, (err, _o, se) => (err ? rej(new Error(`Speech engine: ${se || err.message}`)) : res())));
  const text = fs.readFileSync(txt, 'utf8').trim();
  fs.rmSync(txt, { force: true });
  if (typeof input !== 'string') fs.rmSync(audio, { force: true });
  return { text };
});
// autosave history (#107): a snapshot every few minutes, the last 20 kept
const AUTOSAVES = path.join(USER, 'autosave');
fs.mkdirSync(AUTOSAVES, { recursive: true });
ipcMain.handle('autosave:write', (_, json) => {
  const f = path.join(AUTOSAVES, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, json);
  const all = fs.readdirSync(AUTOSAVES).filter((x) => x.endsWith('.json')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 20))) fs.rmSync(path.join(AUTOSAVES, old), { force: true });
  return f;
});
ipcMain.handle('autosave:list', () => fs.readdirSync(AUTOSAVES).filter((x) => x.endsWith('.json')).sort().reverse().map((x) => ({ name: x.replace(/\.json$/, ''), size: fs.statSync(path.join(AUTOSAVES, x)).size })));
ipcMain.handle('autosave:read', (_, name) => fs.readFileSync(path.join(AUTOSAVES, `${path.basename(String(name))}.json`), 'utf8'));

// ---------------------------------------------------------------- local HTTP API (used by the MCP server and scripts)
function startApi() {
  const prev = readJson(API_FILE, {});
  const token = prev.token || crypto.randomBytes(24).toString('hex');
  const port = settings.api.port;
  const runInApp = (name, args) =>
    win.webContents.executeJavaScript(`window.mmr.runSafe(${JSON.stringify(name)}, ${JSON.stringify(args ?? {})})`, true);

  const server = http.createServer(async (req, res) => {
    const send = (code, obj, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(obj) : obj);
    };
    // Browsers always send Origin on cross-site requests; local tools don't. The token stops everything else.
    if (req.headers.origin) return send(403, { error: 'Browser requests are not allowed.' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: `Bad token. It is in ${API_FILE}` });
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20e6) return send(413, { error: 'Body too large' });
    }
    try {
      const json = body ? JSON.parse(body) : {};
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, app: 'MyModellerReel', version: app.getVersion() });
      if (req.method === 'GET' && url.pathname === '/api/commands') return send(200, await runInApp('list_commands', {}));
      if (req.method === 'GET' && url.pathname === '/api/guide') return send(200, await win.webContents.executeJavaScript('window.mmr.guide', true));
      if (req.method === 'POST' && url.pathname === '/api/run') return send(200, await runInApp(json.command, json.args));
      if (req.method === 'POST' && url.pathname === '/api/batch') {
        const out = [];
        for (const c of json.commands || []) {
          const r = await runInApp(c.command, c.args);
          out.push(r);
          if (!r.ok && json.stopOnError !== false) break;
        }
        return send(200, out);
      }
      // Synthetic mouse/keyboard input, so agents (and tests) can drive the real UI: [{type:'mouseDown',x,y,button:'left',clickCount:1}, …]
      if (req.method === 'POST' && url.pathname === '/api/input') {
        for (const ev of json.events || []) {
          if (ev.type === 'wait') await new Promise((r) => setTimeout(r, ev.ms || 50));
          else win.webContents.sendInputEvent(ev);
        }
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/window-screenshot') {
        // ?title=…: another window of the app (a detached view, #163); a window behind others may not have painted its
        // WebGL panes lately, so ask for a fresh frame first
        const title = url.searchParams.get('title');
        const w = title ? BrowserWindow.getAllWindows().find((x) => x.getTitle().includes(title)) : win;
        if (!w) return send(404, { ok: false, error: `No window titled "${title}".` });
        w.webContents.invalidate();
        await new Promise((r) => setTimeout(r, 300));
        return send(200, (await w.webContents.capturePage(undefined, { stayAwake: true })).toPNG(), 'image/png');
      }
      if (req.method === 'GET' && url.pathname === '/api/screenshot') {
        const r = await runInApp('screenshot', { width: Number(url.searchParams.get('width')) || 1024 });
        if (!r.ok) return send(500, r);
        return send(200, Buffer.from(r.result.image.split(',')[1], 'base64'), 'image/png');
      }
      send(404, { error: 'GET /api/health | /api/commands | /api/guide | /api/screenshot, POST /api/run {command,args} | /api/batch {commands:[...]}' });
    } catch (e) {
      send(500, { ok: false, error: String(e.message || e) });
    }
  });
  server.on('error', (e) => console.error(`API server: ${e.message}`));
  server.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(API_FILE, JSON.stringify({ port, token, pid: process.pid }, null, 2));
    console.log(`MyModellerReel API on http://127.0.0.1:${port}`);
    // Cache the command list (after plugins load) so the MCP server can list tools while the app is closed.
    setTimeout(async () => {
      const r = await runInApp('list_commands', {}).catch(() => null);
      if (r?.ok) fs.writeFileSync(path.join(USER, 'commands.json'), JSON.stringify(r.result));
      fs.writeFileSync(path.join(USER, 'guide.txt'), await win.webContents.executeJavaScript('window.mmr.guide', true));
    }, 4000);
  });
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => win && (win.isMinimized() && win.restore(), win.focus()));
  app.whenReady().then(async () => {
    registerAccount({
      send: (s) => win?.webContents.send('account:status', s),
      busy: () => win?.webContents.executeJavaScript('!!window.mmr?.app.timeline.recording', true).catch(() => false),
      beforeRelaunch: async () => {
        await win?.webContents.executeJavaScript('window.mmr?.app.autosave()', true).catch(() => {});
        if (win) win.__confirmed = true; // the model is in the autosave: no save prompt on the way out
      },
    });
    // Sign-in is required (#115): the window shows only the sign-in screen, and nothing else starts (API, MCP,
    // plugins) until a session exists. Closing the window then quits.
    const gated = needsSignIn();
    createWindow(gated ? 'signin.html' : 'index.html');
    win.__confirmed = gated;
    await whenSignedIn();
    if (gated) {
      win.__confirmed = false;
      win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    }
    win.webContents.once('did-finish-load', startApi);
    startUpdates();
    if (app.isPackaged && !settings.startup.defaultApplied) {
      app.setLoginItemSettings({ openAtLogin: true });
      settings.startup.defaultApplied = true;
      saveSettings();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
