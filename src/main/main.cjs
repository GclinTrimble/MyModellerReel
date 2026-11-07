// MyModellerReel main process: the window, settings, file access, the AI provider proxy and the local HTTP API.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { registerAccount, needsSignIn, whenSignedIn } = require('./account.cjs');

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
  },
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
  return s;
}

// Files the renderer (and so AI scripts) may read or write. Anything else is refused.
const MODEL_EXT = /\.(glb|gltf|obj|stl|fbx|bin)$/i;
const OUT_EXT = /\.(glb|gltf|obj|stl|png|jpg|webm|mp4|json)$/i;

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
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
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
ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: USER, apiPort: settings.api.port, pluginsDir: USER_PLUGINS, appRoot: ROOT }));
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_, patch) => {
  for (const p of ['anthropic', 'openai']) if (patch?.ai?.[p] && !patch.ai[p].apiKey) delete patch.ai[p].apiKey; // blank = keep
  settings = merge(settings, patch);
  saveSettings();
  return publicSettings();
});
ipcMain.handle('window:title', (_, t) => win.setTitle(t));
ipcMain.handle('shell:open-path', (_, p) => shell.openPath(p === 'plugins' ? USER_PLUGINS : USER));
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
ipcMain.handle('file:open-dialog', async (_, { filters }) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('file:read', (_, p) => {
  if (!MODEL_EXT.test(p)) throw new Error(`Refusing to read ${path.basename(p)}: only model files.`);
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
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
ipcMain.handle('ai:chat', async (_, body) => {
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
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  } catch (e) {
    const hint = ai.provider === 'ollama' ? ' Is Ollama running? Start it, then `ollama pull mistral`.' : '';
    throw new Error(`Cannot reach ${url}: ${e.cause?.code || e.message}.${hint}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${ai.provider} ${res.status}: ${text.slice(0, 500)}`);
  return { provider: ai.provider, data: JSON.parse(text) };
});

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
      if (req.method === 'GET' && url.pathname === '/api/window-screenshot') return send(200, (await win.webContents.capturePage()).toPNG(), 'image/png');
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
    if (app.isPackaged && !settings.startup.defaultApplied) {
      app.setLoginItemSettings({ openAtLogin: true });
      settings.startup.defaultApplied = true;
      saveSettings();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
