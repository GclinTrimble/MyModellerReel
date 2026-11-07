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
import { Tools, TOOLS } from './tools.js';
import { UI } from './ui.js';
import { Timeline } from './timeline.js';
import { Assistant } from './ai.js';
import { IO } from './io.js';
import { drawLabels } from './labels.js';

const native = window.native;
const AUTOSAVE = 'mymodellerreel.autosave';

const app = { selection: [], context: null, file: null, dirty: false, plugins: [] };
app.info = await native.invoke('app:info');
app.settings = await native.invoke('settings:get');
app.account = await native.invoke('account:status');
app.startup = await native.invoke('startup:get');
native.onAccount((s) => {
  app.account = s;
  if (app.ui.tab === 'settings') app.ui.renderDock();
});

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
    app.ai?.renderHead();
  },
  // The design review's vision half: four views + the checks, to the configured model (#100).
  ai: {
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
    return (await native.invoke('ai:chat', body)).data;
  } catch (e) {
    throw new Error(String(e.message).replace(/^Error invoking remote method 'ai:chat': (Error: )?/, ''));
  }
};
app.skillPrompt = () => (app.ctx.skill ? skillPrompt(app.ctx.skill) : '');
app.tools = null;

app.select = (ids) => {
  app.selection = [...new Set(ids)].filter((id) => app.entity(id));
  app.viewport.highlight(app.selection);
  app.ui.onSelection();
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
app.setFile = (path, dirty) => {
  app.file = path;
  app.dirty = dirty;
  const name = path ? path.split(/[\\/]/).pop() : 'Untitled';
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

app.autosave = () => {
  try {
    localStorage.setItem(AUTOSAVE, JSON.stringify({ doc: store.doc, file: app.file }));
  } catch {
    /* quota: the model is bigger than local storage; the user's own saves still work */
  }
};

// ---------------------------------------------------------------- store → view
let saveTimer;
let lastDoc = store.doc;
store.on((doc) => {
  if (doc !== lastDoc) {
    // undo / redo / open replaced the document: drop stale references
    app.selection = app.selection.filter((id) => getEntity(doc, id));
    if (app.context && !getEntity(doc, app.context)) app.context = null;
    lastDoc = doc;
  }
  app.viewport.pose = app.timeline.active ? A.evaluate(doc, app.timeline.time) : null;
  app.viewport.rebuild();
  app.viewport.showProposal(store.proposalDiff());
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
  if (ev.target === vcb) {
    if (k === 'Enter') app.tools.vcb(vcb.value), (vcb.value = ''), canvas.focus();
    if (k === 'Escape') (vcb.value = ''), canvas.focus();
    return;
  }
  if (ev.target.closest('input, textarea, select, [contenteditable]')) return;
  const A_ = app.ui.actions;
  const combos = {
    'ctrl+z': 'undo', 'ctrl+y': 'redo', 'ctrl+shift+z': 'redo', 'ctrl+s': 'save', 'ctrl+shift+s': 'saveAs', 'ctrl+o': 'open', 'ctrl+n': 'new',
    'ctrl+g': 'group', 'ctrl+shift+g': 'ungroup', 'ctrl+a': 'selectAll', 'ctrl+d': 'duplicate', 'ctrl+t': 'timeline',
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
app.ai = new Assistant(app);
app.ui.init();
app.tools = new Tools(app);
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
// Keep the camera in the document so saves and the AI know the current view.
app.viewport.controls.addEventListener('end', () => (store.doc.camera = app.viewport.getCamera()));
