// Bootstrap: one store, one command registry, and everything else (UI, tools, AI, API, plugins) on top of it.
import * as THREE from 'three';
import { Store, newDoc, getEntity, descendants } from '../core/document.js';
import * as A from '../core/animation.js';
import * as G from '../core/geometry.js';
import { createRegistry, GUIDE } from '../core/commands.js';
import { registerGenerator } from '../core/derived.js';
import { booleanMeshes } from '../core/csg.js';
import { skillPrompt } from '../core/skills.js';
import { protocolOf, visionRequest, parseReply, REVIEW_SYSTEM } from '../core/agent.js';
import { Viewport, skyTexture } from './viewport.js';
import { Tools, TOOLS, setDisplay, setAxes } from './tools.js';
import { Help } from './help.js';
import { UI } from './ui.js';
import { Timeline } from './timeline.js';
import { Agents } from './agents.js';
import { CogoPanel } from './cogo.js';
import { IO } from './io.js';
import { Panes } from './panes.js';
import { Learning } from './learning.js';
import { drawLabels } from './labels.js';
import { registerFont } from '../core/font.js';
import { setLanguage } from '../core/i18n.js';
import { comboOf } from '../core/shortcuts.js';
import * as Assets from '../core/assets.js';
import { newDoc as freshDoc } from '../core/document.js';

const native = window.native;
const AUTOSAVE = 'mymodellerreel.autosave';

const app = { selection: [], context: null, file: null, dirty: false, plugins: [] };
app.info = await native.invoke('app:info');
app.settings = await native.invoke('settings:get');
app.account = await native.invoke('account:status');
app.startup = await native.invoke('startup:get');
setLanguage(app.settings.language || 'en');
native.onAccount((s) => {
  app.account = s;
  if (app.ui.tab === 'settings') app.ui.renderDock();
});

// 3D text (#31): Liberation Sans from pdf.js's standard fonts, loaded before any document builds its text
for (const [name, file] of [['sans', 'LiberationSans-Regular.ttf'], ['sans-bold', 'LiberationSans-Bold.ttf']])
  try {
    registerFont(name, await (await fetch(new URL(`../../node_modules/pdfjs-dist/standard_fonts/${file}`, import.meta.url))).arrayBuffer());
  } catch (e) {
    console.error(`font ${file}:`, e);
  }

let restored = null;
try {
  restored = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null');
} catch {
  /* a broken autosave is not worth a crash */
}
const store = (app.store = new Store(restored?.doc?.format === 'mymodellerreel' ? restored.doc : newDoc()));
app.file = restored?.file || null;

app.entity = (id) => getEntity(store.doc, id);
app.viewport = new Viewport(document.getElementById('viewport'), store);
app.viewport.onStatus = (t) => app.ui?.setStatus(t);
app.timeline = new Timeline(app);
app.io = new IO(app);
app.ui = new UI(app);

app.ctx = {
  store,
  get doc() {
    return store.doc;
  },
  selection: { get: () => app.selection, set: (ids) => app.select(ids) },
  view: app.viewport,
  timeline: app.timeline,
  io: app.io,
  context: () => app.context,
  help: { open: (id) => app.help.open(id) },
  version: app.info?.version,
  plugins: {
    list: () => app.plugins,
    async create(name, code) {
      const r = await native.invoke('plugins:write', name, code);
      await loadPlugin({ name, url: r.url, builtin: false }, `?v=${Date.now()}`, true);
      return { plugin: name, path: r.path, commands: app.plugins.find((p) => p.name === name)?.commands || [] };
    },
  },
  autoKey: false,
  onMacro: () => app.ui.refresh(),
  onEditComponent: (id) => {
    app.context = id; // edit inside the instance, like double-clicking a group
    app.ui.refresh();
  },
  skill: localStorage.getItem('mymodellerreel.skill') || null,
  onSkill: (name) => {
    localStorage.setItem('mymodellerreel.skill', name || '');
    for (const t of app.agents?.threads.values() || []) t.renderHead();
  },
  // The design review's vision half: four views + the checks, to the configured model (#100).
  // several documents in tabs (#112): the one store swaps what it holds
  docs: {
    list: () => app.docTabs.map((d, i) => ({ n: i + 1, name: d.name, current: i === app.docAt, file: d.file || null })),
    create: (name) => app.openDocTab(name),
    switch: (ref) => app.switchDocTab(ref),
    close: (ref) => app.closeDocTab(ref),
  },
  ai: {
    async vision({ system, text, images }) {
      const protocol = protocolOf(app.settings.ai.provider);
      return parseReply(protocol, await app.chat(visionRequest(protocol, { system, text, images }))).text;
    },
    async review({ images, issues, stats }) {
      const protocol = protocolOf(app.settings.ai.provider);
      const text = `Scene: ${JSON.stringify(stats)}\nAutomatic checks found: ${issues.length ? issues.map((i) => `- ${i.message}`).join('\n') : 'nothing'}\nThe views are iso, front, top, right.`;
      return parseReply(protocol, await app.chat(visionRequest(protocol, { system: REVIEW_SYSTEM, text, images }))).text;
    },
  },
  afterRun: [
    (name) => {
      // Animation commands from anywhere (AI, API) open the timeline so the result is visible.
      const c = app.reg.commands.get(name);
      if (c?.category === 'animate' && !['get_animation', 'playback', 'set_timeline'].includes(name)) app.timeline.open();
      if (name === 'new_model') app.setFile(null, false);
    },
  ],
};
app.reg = createRegistry(app.ctx);
/** One request to the configured AI provider (the main process holds the keys). Errors read as plain sentences. */
app.chat = async (body) => {
  try {
    const data = (await native.invoke('ai:chat', body)).data;
    app.onUsage?.(data);
    return data;
  } catch (e) {
    throw new Error(String(e.message).replace(/^Error invoking remote method 'ai:chat': (Error: )?/, ''));
  }
};
native.onUpdateReady?.((v) => app.ui.toast(`Version ${v} is ready: Help › Restart to update (or it installs when you close the app).`));
app.skillPrompt = () => (app.ctx.skill ? skillPrompt(app.ctx.skill) : '');
app.tools = null;

app.select = (ids) => {
  app.selection = [...new Set(ids)].filter((id) => app.entity(id));
  app.viewport.highlight(app.selection);
  app.ui.onSelection();
  app.tools?.tool?.syncGrips?.(); // grips follow the selection (#181)
  if (app.timeline.active) app.timeline.render();
};
/** Clicking a shape selects its outermost group, unless you are editing inside a group. */
app.pickTarget = (leafId) => {
  let e = app.entity(leafId);
  const inContext = app.context && descendants(store.doc, app.context).some((d) => d.id === leafId);
  const stop = inContext ? app.context : null;
  while (e?.parent && e.parent !== stop) e = app.entity(e.parent);
  return e?.id;
};
app.setContext = (id) => {
  app.context = id;
  app.select([]);
  app.ui.refresh();
};
// ---------------------------------------------------------------- document tabs (#112)
app.docTabs = [{ name: 'Untitled', file: null }];
app.docAt = 0;
const tabStrip = document.createElement('div');
tabStrip.className = 'doc-tabs';
tabStrip.setAttribute('role', 'tablist');
document.querySelector('.stage').prepend(tabStrip);
app.renderDocTabs = () => {
  tabStrip.hidden = app.docTabs.length < 2;
  tabStrip.replaceChildren(
    ...app.docTabs.map((d, i) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === app.docAt));
      b.textContent = i === app.docAt ? (app.file ? app.file.split(/[\\/]/).pop() : d.name) : d.name;
      b.onclick = () => app.switchDocTab(i + 1);
      const x = document.createElement('span');
      x.className = 'x';
      x.textContent = '×';
      x.title = 'Close';
      x.onclick = (e) => (e.stopPropagation(), app.closeDocTab(i + 1));
      b.append(x);
      return b;
    }),
  );
};
const parkDoc = () => Object.assign(app.docTabs[app.docAt], { doc: store.doc, undo: store.undoStack, redo: store.redoStack, file: app.file, dirty: app.dirty, name: app.file ? app.file.split(/[\\/]/).pop() : app.docTabs[app.docAt].name });
const showDoc = (i) => {
  const d = app.docTabs[i];
  app.docAt = i;
  store.doc = d.doc || freshDoc();
  store.undoStack = d.undo || [];
  store.redoStack = d.redo || [];
  store.changed(); // rebuild the view first: the old tab's objects are not in this document
  app.select([]);
  app.setFile(d.file || null, !!d.dirty);
  app.viewport.setCamera(store.doc.camera);
  app.renderDocTabs();
};
const tabIndex = (ref) => {
  if (ref === undefined || ref === null || ref === '') return app.docAt;
  const n = Number(ref);
  const i = Number.isInteger(n) && n >= 1 && n <= app.docTabs.length ? n - 1 : app.docTabs.findIndex((d) => d.name.toLowerCase() === String(ref).toLowerCase());
  if (i < 0) throw new Error(`No open document "${ref}". Open: ${app.docTabs.map((d) => d.name).join(', ')}.`);
  return i;
};
app.openDocTab = (name) => {
  parkDoc();
  app.docTabs.push({ name: name || `Untitled ${app.docTabs.length + 1}`, file: null });
  showDoc(app.docTabs.length - 1);
  return { documents: app.ctx.docs.list() };
};
app.switchDocTab = (ref) => {
  const i = tabIndex(ref);
  if (i !== app.docAt) parkDoc(), showDoc(i);
  return { current: app.docTabs[i].name };
};
app.closeDocTab = (ref) => {
  const i = tabIndex(ref);
  if (app.docTabs.length === 1) throw new Error('This is the only document: use New model instead.');
  if (i === app.docAt) {
    app.docTabs.splice(i, 1);
    showDoc(Math.min(i, app.docTabs.length - 1));
  } else {
    app.docTabs.splice(i, 1);
    if (i < app.docAt) app.docAt--;
    app.renderDocTabs();
  }
  return { documents: app.ctx.docs.list() };
};
app.renderDocTabs();

app.setFile = (path, dirty) => {
  app.file = path;
  app.dirty = dirty;
  app.docTabs && (app.docTabs[app.docAt].file = path);
  queueMicrotask(() => app.renderDocTabs?.());
  const name = path ? path.split(/[\\/]/).pop() : app.docTabs?.[app.docAt]?.name || 'Untitled';
  document.getElementById('doc-title').textContent = `${name}${dirty ? ' •' : ''}`;
  native.invoke('window:title', `${name} - MyModellerReel`);
};
app.afterOpen = (path) => {
  app.select([]);
  app.context = null;
  app.setFile(path, false);
  app.viewport.setCamera(store.doc.camera);
  app.viewport.zoomExtents();
};
app.newModel = async () => {
  if (app.dirty && store.doc.entities.length) {
    const v = await app.ui.modal('Start a new model?', document.createTextNode('Unsaved changes will be lost.'), [['Save first', 'save'], ['Discard', 'discard'], ['Cancel', null]]);
    if (!v) return;
    if (v === 'save' && (await app.reg.run('save', { path: app.file || undefined })).cancelled) return;
  }
  await app.reg.run('new_model');
  app.setFile(null, false);
  app.viewport.setCamera(newDoc().camera);
};
app.keySelection = async () => {
  if (!app.selection.length) return app.ui.toast('Select something to key.');
  app.timeline.open();
  await app.reg.run('run_script', { code: `for (const id of ${JSON.stringify(app.selection)}) await api.add_keyframe({ target: id });` });
  app.ui.toast(`Keyed ${app.selection.length} at ${app.timeline.time.toFixed(2)}s`);
};
app.setAutoKey = (on) => {
  app.ctx.autoKey = on;
  if (on) app.timeline.open();
  app.timeline.renderHead();
  app.ui.toast(on ? 'Auto-key on: moving, rotating and scaling now records keyframes at the playhead.' : 'Auto-key off');
};
app.animateScenes = async () => {
  const scenes = store.doc.scenes;
  if (scenes.length < 2) return app.ui.toast('Add at least two scenes first (Scenes panel).');
  const values = scenes.map((s) => ({ position: s.camera.position, target: s.camera.target }));
  await app.reg.run('run_script', {
    code: `const v = ${JSON.stringify(values)}; for (let i = 0; i < v.length; i++) await api.add_keyframe({ target: 'camera', time: i * 3, values: v[i] });`,
  });
  app.timeline.open();
};
app.setTheme = (dark) => {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('mymodellerreel.theme', dark ? 'dark' : 'light');
  app.viewport.scene.background = dark ? skyTexture('#33414c', '#181d22') : skyTexture('#cfe1e6', '#f4efe6');
  app.viewport.dirty = true;
  if (app.tools) app.ui.refresh();
};
app.toggleTheme = () => app.setTheme(!document.documentElement.classList.contains('dark'));
app.mcpConfig = () => ({
  mcpServers: { mymodellerreel: { command: 'node', args: [`${app.info.appRoot || '<project folder>'}\\src\\mcp\\server.js`] } },
});

let lastAssetIds = ''; // the asset ids the last disk copy holds
app.autosave = () => {
  try {
    localStorage.setItem(AUTOSAVE, JSON.stringify({ doc: store.doc, file: app.file }));
  } catch {
    /* quota: the model is bigger than local storage; the user's own saves still work */
  }
  // local storage keeps no file bytes: when the model starts using new ones (a texture, a PDF, a scan), put a copy
  // with them on disk now rather than at the next five-minute copy, so a restart does not lose them
  const ids = [...Assets.usedIds(store.doc)].filter((id) => Assets.get(id)).sort().join();
  if (ids !== lastAssetIds) {
    lastAssetIds = ids;
    if (ids) native.invoke('autosave:write', JSON.stringify({ doc: store.doc, file: app.file, assets: Assets.pack(store.doc) })).catch(() => {});
  }
};

// ---------------------------------------------------------------- store → view
let saveTimer;
let lastDoc = store.doc;
store.on((doc) => {
  setDisplay({ unit: doc.settings.display_units, precision: doc.settings.precision });
  setAxes(doc.settings.axes);
  if (doc !== lastDoc) {
    // undo / redo / open replaced the document: drop stale references
    app.selection = app.selection.filter((id) => getEntity(doc, id));
    if (app.context && !getEntity(doc, app.context)) app.context = null;
    lastDoc = doc;
  }
  app.viewport.pose = app.timeline.active ? A.evaluate(doc, app.timeline.time) : null;
  app.viewport.rebuild();
  app.viewport.showProposal(store.proposalDiff());
  app.panes?.sync(); // undo, open or a command changed the layout (#160)
  app.tools?.tool?.syncGrips?.();
  app.tools?.tool?.afterRebuild?.(); // a preview in progress (placing a component) holds the new objects
  app.ui.refresh();
  app.timeline.render();
  app.setFile(app.file, true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(app.autosave, 1500);
});

// ---------------------------------------------------------------- public API (HTTP server, MCP, plugins, devtools)
window.mmr = {
  guide: GUIDE,
  THREE,
  geometry: G,
  animation: A,
  app,
  get doc() {
    return store.doc;
  },
  run: (name, args) => app.reg.run(name, args),
  async runSafe(name, args) {
    try {
      return { ok: true, result: await app.reg.run(name, args) };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
  list: () => app.reg.list(),
  registerCommand(spec) {
    if (!spec?.name || typeof spec.run !== 'function') throw new Error('registerCommand needs { name, description, params, run }');
    app.reg.define({ category: 'plugin', mutates: true, compound: true, ...spec, params: spec.params || { type: 'object', properties: {} }, run: (args) => spec.run(args, window.mmr) });
  },
  /** A generator of parametric shapes: { description, params, world?, run({ params, inputs, doc }) → { mesh, origin? } }. */
  registerGenerator: (name, spec) => registerGenerator(name, spec),
  csg: { booleanMeshes },
  addToolbarButton: (b) => app.ui.addPluginButton({ ...b, run: b.run || (() => app.reg.run(b.command, b.args || {}).catch((e) => app.ui.toast(e.message, 'danger'))) }),
  toast: (m) => app.ui.toast(m),
};

// ---------------------------------------------------------------- plugins
async function loadPlugin(p, bust = '', strict = false) {
  const before = new Set(app.reg.commands.keys());
  try {
    const mod = await import(p.url + bust);
    if (typeof mod.default !== 'function') throw new Error('A plugin must `export default function (mmr) { … }`.');
    await mod.default(window.mmr);
    const added = [...app.reg.commands.keys()].filter((k) => !before.has(k));
    app.plugins = app.plugins.filter((x) => x.name !== p.name).concat({ name: p.name, builtin: p.builtin, commands: added });
  } catch (e) {
    app.plugins = app.plugins.filter((x) => x.name !== p.name).concat({ name: p.name, builtin: p.builtin, commands: [], error: e.message });
    if (strict) throw new Error(`Plugin ${p.name} failed to load: ${e.message}`);
    console.error(e);
  }
}
app.reloadPlugins = async () => {
  for (const p of await native.invoke('plugins:list')) await loadPlugin(p, `?v=${Date.now()}`);
  app.ui.refresh();
  app.ui.toast(`${app.plugins.length} plugins loaded`);
};

// ---------------------------------------------------------------- keyboard
const vcb = document.getElementById('vcb');
const canvas = document.getElementById('viewport');
window.addEventListener('keydown', (ev) => {
  const k = ev.key;
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (document.querySelector('dialog[open]')) return;
  if (ctrl && k.toLowerCase() === 'k') return ev.preventDefault(), app.ui.openPalette();
  if (ctrl && k.toLowerCase() === 'j') return ev.preventDefault(), app.ui.show('ai', true);
  if (ctrl && ev.code === 'Space') return ev.preventDefault(), app.agents.askAt(); // Ask at the cursor (#244)
  if (ev.target === vcb) {
    if (k === 'Enter') app.tools.vcb(vcb.value), (vcb.value = ''), canvas.focus();
    if (k === 'Escape') (vcb.value = ''), canvas.focus();
    return;
  }
  if (ev.target.closest('input, textarea, select, [contenteditable]')) return;
  // your own shortcuts (#110) win over the built-in ones
  const mine = app.settings.shortcuts?.[comboOf(ev)];
  if (mine) {
    ev.preventDefault();
    if (mine.startsWith('tool:')) return app.tools.set(mine.slice(5));
    if (app.ui.actions[mine]) return app.ui.actions[mine].run();
    return app.reg.run(mine, {}).catch((e) => app.ui.toast(e.message, 'danger'));
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'm' && !ev.repeat) return ev.preventDefault(), app.ai.listen(); // hold to talk (#98)
  if (app.timeline.active && (app.timeline.selKeys.size || app.timeline.clipboard) && app.timeline.handleKey(ev)) return; // keyframes first
  const A_ = app.ui.actions;
  const combos = {
    'ctrl+z': 'undo', 'ctrl+y': 'redo', 'ctrl+shift+z': 'redo', 'ctrl+s': 'save', 'ctrl+shift+s': 'saveAs', 'ctrl+o': 'open', 'ctrl+n': 'new',
    'ctrl+g': 'group', 'ctrl+shift+g': 'ungroup', 'ctrl+a': 'selectAll', 'ctrl+d': 'duplicate', 'ctrl+t': 'timeline',
    'ctrl+c': 'copy', 'ctrl+x': 'cut', 'ctrl+v': 'paste',
    f1: 'howto',
    'shift+z': 'zoomExtents', 'shift+ ': 'play', delete: 'delete', backspace: 'delete', k: 'keySel',
  };
  const combo = `${ctrl ? 'ctrl+' : ''}${ev.shiftKey ? 'shift+' : ''}${k.toLowerCase()}`;
  // Typing numbers while a tool works goes to the Measurements box, like in the classic modellers.
  const vcbChar = /^[0-9.,;\-*/'"]$/.test(k) || (vcb.value && /^[a-z]$/i.test(k)) || (k === 'x' && app.tools.id === 'move');
  if (!ctrl && app.tools.id !== 'select' && vcbChar && !app.tools.key(ev)) {
    ev.preventDefault();
    vcb.value += k;
    vcb.focus();
    return;
  }
  if (combos[combo] && A_[combos[combo]]) return ev.preventDefault(), A_[combos[combo]].run();
  if (app.tools.key(ev)) return ev.preventDefault();
  if (!ctrl && !ev.altKey) {
    const t = k === ' ' ? TOOLS[0] : TOOLS.find((x) => x.key.toLowerCase() === k.toLowerCase());
    if (t) return ev.preventDefault(), app.tools.set(t.id);
  }
});

native.onBeforeClose(async () => {
  if (app.dirty && store.doc.entities.length) {
    const v = await app.ui.modal('Save before closing?', document.createTextNode('Your model has unsaved changes. (It is also kept for your next session.)'), [['Save', 'save'], ["Don't save", 'close'], ['Cancel', null]]);
    if (!v) return;
    if (v === 'save' && (await app.reg.run('save', { path: app.file || undefined })).cancelled) return;
  }
  native.invoke('app:close-confirmed');
});

// ---------------------------------------------------------------- start
const theme = localStorage.getItem('mymodellerreel.theme');
app.setTheme(theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
// agent profiles (#243): app.ai is the thread on show (Plumb unless another agent's is open)
app.agents = new Agents(app);
app.ctx.agents = app.agents;
Object.defineProperty(app, 'ai', { get: () => app.agents.current });
app.cogo = new CogoPanel(app);
app.help = new Help(app);
app.learning = new Learning(app);
// every command, from any source, may complete a lesson or a guided step (#213, #214)
{
  const run0 = app.reg.run.bind(app.reg);
  app.reg.run = async (name, args) => {
    const r = await run0(name, args);
    if (name !== 'complete_lesson' && name !== 'list_lessons') queueMicrotask(() => app.learning.ran(name));
    return r;
  };
}
app.ui.init();
app.tools = new Tools(app);
app.panes = new Panes(app);
app.panes.sync();
app.viewport.rebuild();
app.ui.show('ai');
app.ui.refresh();
app.setFile(app.file, false);
if (restored?.doc?.entities?.length) {
  app.viewport.setCamera(store.doc.camera);
  app.ui.toast('Restored your last session.');
}
document.getElementById('api-pill').textContent = `API :${app.info.apiPort} · MCP`;
canvas.focus();
for (const p of await native.invoke('plugins:list')) await loadPlugin(p);
app.ui.refresh();
app.viewport.listeners.add(() => drawLabels(app));
// first run, or nothing to restore: the start screen (#109); tests drive the app themselves
if (!app.info.test && !restored?.doc?.entities?.length) app.ui.startScreen();
// Keep the camera in the document so saves and the AI know the current view.
app.viewport.controls.addEventListener('end', () => (store.doc.camera = app.viewport.getCamera()));

// components dragged from the Library panel land where they are dropped (#45)
canvas.addEventListener('dragover', (e) => e.dataTransfer.types.includes('text/x-mmr-asset') && e.preventDefault());
canvas.addEventListener('drop', (e) => {
  const name = e.dataTransfer.getData('text/x-mmr-asset');
  if (!name) return;
  e.preventDefault();
  const hit = app.viewport.pick(e);
  const p = hit ? hit.point : app.viewport.ray(e).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  app.reg.run('insert_asset', { name, ...(p ? { position: p.toArray().map((x) => Math.round(x * 100) / 100) } : {}) }).catch((err) => app.ui.toast(err.message, 'danger'));
});

// where the pointer is, for Ask at the cursor (#244)
canvas.addEventListener('pointermove', (e) => (app.agents.pointer = { x: e.clientX, y: e.clientY }));
// Ctrl+M released: stop listening and transcribe (#98)
window.addEventListener('keyup', (ev) => (ev.key.toLowerCase() === 'm' || ev.key === 'Control') && app.ai.recorder && app.ai.hear());
// the gizmo's drags become one set_transform each (#67)
app.viewport.onGizmo = (id, t) => id && app.reg.run('set_transform', { id, ...t }).catch((e) => app.ui.toast(e.message, 'danger'));
// language and shortcuts changed in Settings or by a command
app.applySettings = () => {
  setLanguage(app.settings.language || 'en');
  for (const id of ['menubar', 'toolbar']) document.getElementById(id).replaceChildren();
  app.ui.buildMenus();
  app.ui.buildToolbar();
  app.ui.buildTabs();
  app.ui.renderDock();
  app.ui.onTool?.(app.tools.id);
};
// autosave history (#107): a copy every five minutes while the model changes
let lastHistory = '';
setInterval(() => {
  const json = JSON.stringify({ doc: store.doc, file: app.file });
  if (json === lastHistory || !store.doc.entities.length) return;
  lastHistory = json;
  native.invoke('autosave:write', JSON.stringify({ doc: store.doc, file: app.file, assets: Assets.pack(store.doc) })).catch(() => {});
}, 5 * 60 * 1000);
// the local autosave holds no file bytes (scans, PDFs, audio): take them from the newest copy on disk
if (store.doc.entities.length)
  native
    .invoke('autosave:list')
    .then(async (l) => {
      const s = l[0] && JSON.parse(await native.invoke('autosave:read', l[0].name));
      if (s?.assets && Object.keys(s.assets).length) Assets.unpack(s.assets), app.viewport.rebuild(), (lastAssetIds = Object.keys(s.assets).sort().join());
    })
    .catch(() => {});
