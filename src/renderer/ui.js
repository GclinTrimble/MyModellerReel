// Chrome around the viewport: menus, tool bar, dock panels, status bar, palette, toasts, dialogs.
import * as D from '../core/document.js';
import { MATERIALS } from '../core/materials.js';
export { MATERIALS };
import { listProfiles, profilePoints, profileSvg, ANCHORS } from '../core/profiles.js';
import { getGenerator } from '../core/derived.js';
import { TOOLS, fmt } from './tools.js';

/** Tiny DOM helper: h('button.btn', { onclick }, 'Label', child…) */
export function h(sel, attrs = {}, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if ((k === 'style' || k === 'dataset') && typeof v === 'object') Object.assign(el[k], v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
export const icon = (name, fill = false) => h(`i.ph${fill ? '-fill' : ''}.ph-${name}`, { 'aria-hidden': 'true' });
const iconBtn = (name, label, onclick, pressed) =>
  h('button.icon-btn', { title: label, 'aria-label': label, onclick, 'aria-pressed': pressed === undefined ? undefined : String(!!pressed) }, icon(name));

export class UI {
  constructor(app) {
    this.app = app;
    this.tab = 'ai';
    this.$ = (id) => document.getElementById(id);
    this.paint = MATERIALS[3];
  }

  init() {
    this.buildActions();
    this.buildMenus();
    this.buildToolbar();
    this.buildViewbar();
    this.buildTabs();
    this.buildPalette();
    this.$('context-chip').onclick = () => this.app.setContext(null);
  }

  /** A form for any command, generated from its JSON Schema: the UI path to every command with parameters. */
  async commandDialog(name, preset = {}) {
    const c = this.app.reg.commands.get(name);
    if (!c) return this.toast(`No command ${name}`, 'danger');
    const props = c.params.properties || {};
    const req = new Set(c.params.required || []);
    const inputs = {};
    const fields = Object.entries(props).map(([k, s]) => {
      const v = preset[k];
      const text = v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      let input;
      if (s.enum || s.type === 'boolean') {
        const opts = s.enum || ['true', 'false'];
        input = h('select', {}, h('option', { value: '' }, req.has(k) ? 'choose…' : '(default)'), opts.map((o) => h('option', { value: o, selected: String(v) === o }, o)));
      } else input = h('input', { value: text, type: s.type === 'number' ? 'number' : 'text', step: 'any', placeholder: s.type === 'array' ? (k === 'ids' ? 'selection' : '[…]') : s.type === 'object' ? '{ "key": "value" }' : '' });
      inputs[k] = [input, s];
      return h('label.field', {}, h('span', {}, `${k}${req.has(k) ? ' *' : ''}`, s.description ? h('span.muted', {}, ` · ${s.description}`) : null), input);
    });
    const body = h('div.panel.form', { style: { padding: 0 } }, h('p.small.muted', {}, c.description), fields.length ? fields : h('p.small', {}, 'No parameters.'));
    if ((await this.modal(name.replace(/_/g, ' '), body, [['Run', 'run'], ['Cancel', null]])) !== 'run') return;
    const args = {};
    for (const [k, [input, s]] of Object.entries(inputs)) {
      const raw = input.value.trim();
      if (!raw) continue;
      if (s.type === 'number') args[k] = +raw;
      else if (s.type === 'boolean') args[k] = raw === 'true';
      else if (s.type === 'string') args[k] = raw;
      else {
        try {
          args[k] = JSON.parse(raw);
        } catch {
          args[k] = s.type === 'array' ? raw.split(',').map((x) => x.trim()) : raw;
        }
      }
    }
    try {
      const r = await this.app.reg.run(name, args);
      this.toast(JSON.stringify(r).slice(0, 200));
      return r;
    } catch (e) {
      this.toast(e.message, 'danger');
    }
  }

  // ---------------------------------------------------------------- actions (menus, palette, shortcuts share them)
  buildActions() {
    const app = this.app;
    const run = (name, args) => () => app.reg.run(name, args).catch((e) => this.toast(e.message, 'danger'));
    const sel = () => app.selection;
    const form = (name, preset = {}) => () => this.commandDialog(name, typeof preset === 'function' ? preset() : preset);
    const needTwo = (fn) => () => (sel().length > 1 ? fn() : this.toast('Select at least two things.'));
    const style = (k) => ({ checked: () => app.store.doc.settings[k], run: () => app.reg.run('set_style', { [k]: !app.store.doc.settings[k] }) });
    this.actions = {
      new: { label: 'New model', icon: 'file-plus', key: 'Ctrl+N', run: () => app.newModel() },
      open: { label: 'Open…', icon: 'folder-open', key: 'Ctrl+O', run: run('open', {}) },
      save: { label: 'Save', icon: 'floppy-disk', key: 'Ctrl+S', run: () => app.reg.run('save', { path: app.file || undefined }).catch((e) => this.toast(e.message, 'danger')) },
      saveAs: { label: 'Save as…', icon: 'floppy-disk', key: 'Ctrl+Shift+S', run: run('save', {}) },
      import: { label: 'Import model…', icon: 'tray-arrow-down', run: run('import', {}) },
      exportGlb: { label: 'Export GLB', icon: 'export', run: run('export', { format: 'glb' }) },
      exportGltf: { label: 'Export glTF', icon: 'export', run: run('export', { format: 'gltf' }) },
      exportObj: { label: 'Export OBJ', icon: 'export', run: run('export', { format: 'obj' }) },
      exportStl: { label: 'Export STL (3D print)', icon: 'export', run: run('export', { format: 'stl' }) },
      exportPng: { label: 'Export image (PNG)', icon: 'image', run: run('export', { format: 'png' }) },
      exportVideo: { label: 'Render video (MP4, WebM, GIF, PNG)…', icon: 'film-script', run: form('render_video') },
      plugins: { label: 'Open plugins folder', icon: 'puzzle-piece', run: () => window.native.invoke('shell:open-path', 'plugins') },
      undo: { label: 'Undo', icon: 'arrow-arc-left', key: 'Ctrl+Z', run: run('undo') },
      redo: { label: 'Redo', icon: 'arrow-arc-right', key: 'Ctrl+Y', run: run('redo') },
      delete: { label: 'Delete', icon: 'trash', key: 'Del', run: () => sel().length && app.reg.run('delete', {}) },
      selectAll: { label: 'Select all', icon: 'selection-all', key: 'Ctrl+A', run: run('select', { mode: 'all' }) },
      selectNone: { label: 'Select none', icon: 'selection', key: 'Esc', run: run('select', { mode: 'none' }) },
      group: { label: 'Make group', icon: 'stack', key: 'Ctrl+G', run: () => sel().length && app.reg.run('group', {}) },
      ungroup: { label: 'Explode group', icon: 'stack-minus', key: 'Ctrl+Shift+G', run: () => sel().length === 1 && app.reg.run('ungroup', { id: sel()[0] }).catch((e) => this.toast(e.message)) },
      duplicate: { label: 'Duplicate', icon: 'copy', key: 'Ctrl+D', run: () => sel().length && app.reg.run('duplicate', { offset: [1, 0, 0] }) },
      hide: { label: 'Hide', icon: 'eye-slash', run: () => sel().length && app.reg.run('set_properties', { visible: false }) },
      unhideAll: { label: 'Unhide all', icon: 'eye', run: run('run_script', { code: 'for (const e of api.doc.entities) e.visible = true;' }) },
      lock: { label: 'Lock', icon: 'lock-simple', run: () => sel().length && app.reg.run('set_properties', { locked: true }) },
      unlockAll: { label: 'Unlock all', icon: 'lock-simple-open', run: run('run_script', { code: 'for (const e of api.doc.entities) e.locked = false;' }) },
      zoomExtents: { label: 'Zoom extents', icon: 'corners-out', key: 'Shift+Z', run: run('zoom_extents', {}) },
      zoomSel: { label: 'Zoom to selection', icon: 'magnifying-glass-plus', run: () => sel().length && app.reg.run('zoom_extents', { ids: sel() }) },
      iso: { label: 'Iso', icon: 'cube', run: run('set_view', { preset: 'iso' }) },
      top: { label: 'Top', icon: 'square', run: run('set_view', { preset: 'top' }) },
      front: { label: 'Front', icon: 'square-half-bottom', run: run('set_view', { preset: 'front' }) },
      right: { label: 'Right', icon: 'square-half', run: run('set_view', { preset: 'right' }) },
      left: { label: 'Left', run: run('set_view', { preset: 'left' }) },
      back: { label: 'Back', run: run('set_view', { preset: 'back' }) },
      edges: { label: 'Edges', icon: 'line-segments', ...style('edges') },
      xray: { label: 'X-ray', icon: 'cube-transparent', ...style('xray') },
      wireframe: { label: 'Wireframe', icon: 'cube-focus', ...style('wireframe') },
      shadows: { label: 'Shadows', icon: 'sun', ...style('shadows') },
      grid: { label: 'Grid and axes', icon: 'grid-four', ...style('grid') },
      unsection: { label: 'Remove section cut', icon: 'knife', run: run('section', { enabled: false }) },
      theme: { label: 'Dark theme', icon: 'moon', checked: () => document.documentElement.classList.contains('dark'), run: () => app.toggleTheme() },
      timeline: { label: 'Timeline', icon: 'film-strip', key: 'Ctrl+T', checked: () => app.timeline.active, run: () => app.timeline.toggle() },
      play: { label: 'Play / pause', icon: 'play', key: 'Shift+Space', run: () => (app.timeline.playing ? app.timeline.pause() : app.timeline.play()) },
      keySel: { label: 'Key the selection at the playhead', icon: 'diamond', key: 'K', run: () => app.keySelection() },
      keyCam: { label: 'Key the camera at the playhead', icon: 'video-camera', run: () => app.reg.run('add_keyframe', { target: 'camera' }).then(() => app.timeline.open()) },
      autoKey: { label: 'Auto-key (edits record keyframes)', icon: 'record', checked: () => app.ctx.autoKey, run: () => app.setAutoKey(!app.ctx.autoKey) },
      sequence: { label: 'Build sequence from selection', icon: 'stack', run: () => sel().length && app.reg.run('build_sequence', { order: 'bottom-up' }).then(() => app.timeline.open()) },
      marker: { label: 'Add marker at the playhead…', icon: 'flag', run: () => this.commandDialog('add_marker', { time: app.timeline.time }) },
      caption: { label: 'Add caption…', icon: 'subtitles', run: () => this.commandDialog('add_caption', { start: app.timeline.time }) },
      motion: { label: 'Add procedural motion…', icon: 'wave-sine', run: () => this.commandDialog('add_motion', { target: sel()[0] || 'camera' }) },
      explode: { label: 'Exploded view…', icon: 'arrows-out', run: form('explode') },
      alongPath: { label: 'Animate along a path…', icon: 'path', run: () => this.commandDialog('animate_along_path', { target: sel().find((x) => !app.entity(x)?.curve) || 'camera', path: sel().find((x) => app.entity(x)?.curve) }) },
      stagger: { label: 'Stagger the selection\'s animation…', icon: 'stairs', run: form('stagger', { order: 'height', delta: 0.2 }) },
      turntable: { label: 'Turntable camera', icon: 'arrows-clockwise', run: () => app.reg.run('turntable', {}).then(() => app.timeline.open()) },
      scenesAnim: { label: 'Animate through scenes', icon: 'film-slate', run: () => app.animateScenes() },
      clearAnim: { label: 'Clear animation of selection', icon: 'trash', run: () => app.reg.run('run_script', { code: `for (const id of ${JSON.stringify(sel())}) await api.remove_keyframes({ target: id });` }) },
      alignXmin: { label: 'Align left (x min)', icon: 'align-left', run: needTwo(run('align', { axis: 'x', to: 'min' })) },
      alignXmid: { label: 'Align centres (x)', icon: 'align-center-horizontal', run: needTwo(run('align', { axis: 'x', to: 'center' })) },
      alignXmax: { label: 'Align right (x max)', icon: 'align-right', run: needTwo(run('align', { axis: 'x', to: 'max' })) },
      alignZmin: { label: 'Align back (z min)', icon: 'align-top', run: needTwo(run('align', { axis: 'z', to: 'min' })) },
      alignZmid: { label: 'Align centres (z)', icon: 'align-center-vertical', run: needTwo(run('align', { axis: 'z', to: 'center' })) },
      alignZmax: { label: 'Align front (z max)', icon: 'align-bottom', run: needTwo(run('align', { axis: 'z', to: 'max' })) },
      alignYmin: { label: 'Align bottoms (y min)', icon: 'arrow-line-down', run: needTwo(run('align', { axis: 'y', to: 'min' })) },
      distX: { label: 'Distribute along x', icon: 'columns', run: needTwo(run('distribute', { axis: 'x' })) },
      distZ: { label: 'Distribute along z', icon: 'rows', run: needTwo(run('distribute', { axis: 'z' })) },
      stack: { label: 'Stack in selection order', icon: 'stack-simple', run: needTwo(run('stack', {})) },
      placeOn: { label: 'Place on…', icon: 'arrow-line-down', run: form('place_on') },
      against: { label: 'Push against…', icon: 'arrows-out-line-horizontal', run: form('against') },
      freeSpace: { label: 'Find free space…', icon: 'crosshair', run: form('find_free_space', () => (sel()[0] ? { like: sel()[0] } : {})) },
      selectInvert: { label: 'Invert selection', icon: 'selection-inverse', run: run('select', { mode: 'invert' }) },
      selectSimilar: { label: 'Select similar', icon: 'selection-plus', run: () => (sel()[0] ? app.reg.run('select_where', { similar_to: sel()[0], mode: 'add' }).catch((e) => this.toast(e.message, 'danger')) : this.toast('Select one thing first.')) },
      selectWhere: { label: 'Select by…', icon: 'list-magnifying-glass', run: form('select_where') },
      metadata: { label: 'Set metadata…', icon: 'tag-simple', run: form('set_metadata') },
      makeComponent: { label: 'Make component…', icon: 'squares-four', run: () => (sel().length ? this.commandDialog('make_component', { name: app.entity(sel()[0])?.name }) : this.toast('Select what the component is made of.')) },
      placeComponent: { label: 'Place component…', icon: 'squares-four', run: form('place_component') },
      makeUnique: { label: 'Make unique', icon: 'link-break', run: () => sel().length && app.reg.run('make_unique', {}).then((r) => this.toast(`Now its own component: ${r.component}`)).catch((e) => this.toast(e.message, 'danger')) },
      replaceComponent: { label: 'Replace component…', icon: 'swap', run: form('replace_component') },
      imprint: { label: 'Imprint on a face…', icon: 'selection-foreground', run: () => this.commandDialog('imprint', { id: sel()[0], face: 'top', shape: 'rectangle', size: [0.5, 0.5] }) },
      offsetFace: { label: 'Offset (inset) a face…', icon: 'frame-corners', run: () => this.commandDialog('offset_face', { id: sel()[0], face: 'top', distance: 0.1 }) },
      moveElements: { label: 'Move a face, edge or corner…', icon: 'arrows-out-cardinal', run: () => this.commandDialog('move_elements', { id: sel()[0], edge: 'top front', by: [0, 1, 0] }) },
      repair: { label: 'Repair mesh', icon: 'first-aid-kit', run: () => sel().length && app.reg.run('repair_mesh', {}).then((r) => this.toast(r.map((x) => `${x.name}: ${x.faces_before} → ${x.faces} faces`).join(' · ').slice(0, 200))).catch((e) => this.toast(e.message, 'danger')) },
      proposeToggle: { label: 'Propose AI changes for review', icon: 'git-pull-request', checked: () => app.ai.propose, run: () => app.ai.setPropose(!app.ai.propose) },
      proposeAccept: { label: 'Accept proposal', icon: 'check-circle', run: run('propose', { action: 'accept' }) },
      proposeReject: { label: 'Reject proposal', icon: 'x-circle', run: run('propose', { action: 'reject' }) },
      sweep: { label: 'Sweep a profile along a path…', icon: 'path', run: form('sweep', () => (app.entity(sel()[0])?.curve ? { path: sel()[0] } : {})) },
      liveArray: { label: 'Live array of the selection…', icon: 'columns', run: form('duplicate', () => ({ live: 'true', count: 3, offset: [1, 0, 0] })) },
      bake: { label: 'Bake (freeze parameters)', icon: 'snowflake', run: () => sel().length && app.reg.run('bake', {}).then((r) => this.toast(`Baked ${r.baked.length}`)) },
      recordMacro: { label: 'Record macro', icon: 'record', checked: () => !!app.ctx.macro, run: () => (app.ctx.macro ? app.reg.run('stop_macro', {}).then((r) => this.toast(`Saved recipe "${r.name}" (${r.steps} steps)`)) : app.reg.run('record_macro', {})).catch((e) => this.toast(e.message, 'danger')) },
      saveRecipe: { label: 'Save recipe of this model…', icon: 'floppy-disk-back', run: form('save_recipe') },
      library: { label: 'Profiles, recipes and plugins', icon: 'books', run: () => this.show('library') },
      review: { label: 'Review my model', icon: 'list-checks', run: () => this.reviewDialog() },
      quantities: { label: 'Quantities report…', icon: 'table', run: () => this.quantitiesDialog() },
      askAi: { label: 'Ask the AI', icon: 'sparkle', key: 'Ctrl+J', run: () => this.show('ai', true) },
      newChat: { label: 'New AI chat', icon: 'chat-circle', run: () => app.ai.reset() },
      aiSettings: { label: 'AI and API settings', icon: 'gear', run: () => this.show('settings') },
      mcp: { label: 'Connect Claude Desktop (MCP)…', icon: 'plugs-connected', run: () => this.mcpDialog() },
      shortcuts: { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => this.shortcutsDialog() },
      about: { label: 'About MyModellerReel', icon: 'info', run: () => this.aboutDialog() },
    };
    for (const t of TOOLS) this.actions[`tool:${t.id}`] = { label: t.label, icon: t.icon, key: t.key, checked: () => app.tools.id === t.id, run: () => app.tools.set(t.id) };
  }

  buildMenus() {
    const T = (g) => TOOLS.filter((t) => t.group === g).map((t) => `tool:${t.id}`);
    this.menus = {
      File: ['new', 'open', 'save', 'saveAs', '-', 'import', 'Export', 'exportGlb', 'exportGltf', 'exportObj', 'exportStl', 'exportPng', 'exportVideo', '-', 'quantities', '-', 'plugins'],
      Edit: ['undo', 'redo', '-', 'duplicate', 'delete', '-', 'selectAll', 'selectNone', 'selectInvert', 'selectSimilar', 'selectWhere', '-', 'group', 'ungroup', '-', 'makeComponent', 'placeComponent', 'makeUnique', 'replaceComponent', '-', 'hide', 'unhideAll', 'lock', 'unlockAll', '-', 'metadata'],
      Arrange: ['alignXmin', 'alignXmid', 'alignXmax', 'alignZmin', 'alignZmid', 'alignZmax', 'alignYmin', '-', 'distX', 'distZ', 'stack', '-', 'placeOn', 'against', 'freeSpace'],
      View: ['zoomExtents', 'zoomSel', '-', 'iso', 'top', 'front', 'right', 'left', 'back', '-', 'edges', 'xray', 'wireframe', 'shadows', 'grid', 'unsection', '-', 'timeline', 'theme'],
      Tools: ['Draw', ...T('draw'), 'Modify', ...T('edit'), 'Construct', ...T('construct'), 'Camera', ...T('camera'), 'Shape', 'imprint', 'offsetFace', 'moveElements', 'repair', 'Parametric', 'sweep', 'liveArray', 'bake', 'Recipes', 'recordMacro', 'saveRecipe', 'library'],
      Animate: ['timeline', 'play', '-', 'keySel', 'keyCam', 'autoKey', '-', 'sequence', 'turntable', 'scenesAnim', 'explode', 'alongPath', 'stagger', 'motion', '-', 'marker', 'caption', '-', 'clearAnim', 'exportVideo'],
      AI: ['askAi', 'newChat', '-', 'review', 'proposeToggle', 'proposeAccept', 'proposeReject', '-', 'mcp', 'aiSettings'],
      Help: ['shortcuts', 'mcp', 'about'],
    };
    const bar = this.$('menubar');
    for (const name of Object.keys(this.menus)) {
      const b = h('button', { 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => this.openMenu(name, b), onmouseenter: () => this.openName && this.openName !== name && this.openMenu(name, b) }, name);
      bar.append(b);
    }
    document.addEventListener('pointerdown', (e) => !e.target.closest('.menu-pop, .menubar') && this.closeMenu());
  }
  openMenu(name, btn) {
    const pop = this.$('menu-pop');
    if (this.openName === name) return this.closeMenu();
    this.closeMenu();
    this.openName = name;
    btn.setAttribute('aria-expanded', 'true');
    pop.replaceChildren(
      ...this.menus[name].map((id) => {
        if (id === '-') return h('hr');
        const a = this.actions[id];
        if (!a) return h('div.overline', {}, id);
        const on = a.checked?.();
        return h('button', { role: 'menuitem', onclick: () => (this.closeMenu(), a.run()) }, on ? icon('check') : icon(a.icon || 'dot-outline'), a.label, a.key ? h('span.key', {}, a.key) : null);
      }),
    );
    const r = btn.getBoundingClientRect();
    Object.assign(pop.style, { left: `${r.left}px`, top: `${r.bottom + 4}px` });
    pop.hidden = false;
  }
  closeMenu() {
    this.$('menu-pop').hidden = true;
    for (const b of this.$('menubar').children) b.setAttribute('aria-expanded', 'false');
    this.openName = null;
  }

  buildToolbar() {
    const bar = this.$('toolbar');
    let group = null;
    for (const t of TOOLS) {
      if (group && t.group !== group) bar.append(h('hr'));
      group = t.group;
      const b = iconBtn(t.icon, `${t.label} (${t.key})`, () => this.app.tools.set(t.id), false);
      b.dataset.tool = t.id;
      bar.append(b);
    }
    bar.append(h('hr'), iconBtn('corners-out', 'Zoom extents (Shift+Z)', () => this.actions.zoomExtents.run()));
    this.pluginBar = h('div', { style: { display: 'contents' } });
    bar.append(this.pluginBar);
  }
  addPluginButton({ icon: ic = 'puzzle-piece', label, run }) {
    if (!this.pluginBar.children.length) this.pluginBar.append(h('hr'));
    this.pluginBar.append(iconBtn(ic, label, run));
  }
  onTool(id) {
    for (const b of this.$('toolbar').querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    this.$('vcb').value = '';
  }

  buildViewbar() {
    const vb = this.$('viewbar');
    const render = () => {
      const s = this.app.store.doc.settings;
      vb.replaceChildren(
        ...['iso', 'top', 'front', 'right'].map((v) => h('button.icon-btn.sm', { title: `${this.actions[v].label} view`, 'aria-label': `${this.actions[v].label} view`, onclick: this.actions[v].run }, icon(this.actions[v].icon))),
        h('span.sep'),
        ...['edges', 'xray', 'shadows', 'grid'].map((k) =>
          h('button.icon-btn.sm', { title: this.actions[k].label, 'aria-label': this.actions[k].label, 'aria-pressed': String(!!s[k]), onclick: this.actions[k].run }, icon(this.actions[k].icon)),
        ),
        h('span.sep'),
        h('button.icon-btn.sm', { title: 'Timeline (Ctrl+T)', 'aria-label': 'Timeline (Ctrl+T)', 'aria-pressed': String(this.app.timeline.active), onclick: this.actions.timeline.run }, icon('film-strip')),
      );
    };
    this.renderViewbar = render;
  }

  // ---------------------------------------------------------------- dock
  buildTabs() {
    this.tabs = [
      ['ai', 'AI', 'sparkle'],
      ['outliner', 'Outliner', 'tree-structure'],
      ['entity', 'Entity', 'info'],
      ['materials', 'Materials', 'palette'],
      ['scenes', 'Scenes', 'camera'],
      ['library', 'Library', 'books'],
      ['settings', 'Settings', 'gear'],
    ];
    this.$('dock-tabs').replaceChildren(
      ...this.tabs.map(([id, label, ic]) => h('button', { role: 'tab', 'aria-selected': String(id === this.tab), onclick: () => this.show(id), dataset: { tab: id } }, icon(ic), label)),
    );
  }
  show(tab, focus = false) {
    this.tab = tab;
    for (const b of this.$('dock-tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    this.renderDock();
    if (focus && tab === 'ai') this.app.ai.focus();
  }
  renderDock() {
    const body = this.$('dock-body');
    if (this.tab === 'ai') {
      if (body.firstChild !== this.app.ai.el) body.replaceChildren(this.app.ai.el);
      return;
    }
    const panel = this[`panel_${this.tab}`]();
    body.replaceChildren(panel);
  }
  refresh() {
    if (this.tab !== 'ai') this.renderDock();
    this.renderViewbar();
    this.renderProposal();
    this.renderMacro();
    const chip = this.$('context-chip');
    const ctx = this.app.context && this.app.entity(this.app.context);
    chip.hidden = !ctx;
    if (ctx) chip.replaceChildren(icon('pencil-simple'), `Editing inside "${ctx.name}"`, icon('x'));
  }
  /** A red "recording" pill in the status bar while a macro records. */
  renderMacro() {
    const m = this.app.ctx.macro;
    let pill = this.$('macro-pill');
    if (!m) return pill?.remove();
    if (!pill) {
      pill = h('button.macro-pill', { id: 'macro-pill', title: 'Stop recording and save the macro as a recipe', onclick: () => this.actions.recordMacro.run() });
      this.$('status-hint').after(pill);
    }
    pill.replaceChildren(icon('record', true), `Recording "${m.name}" · ${m.steps.length} steps · Stop`);
  }

  renderProposal() {
    const bar = this.$('proposal-bar');
    const d = this.app.store.proposalDiff();
    bar.hidden = !d;
    if (!d) return;
    const parts = [d.added.length && `${d.added.length} new`, d.changed.length && `${d.changed.length} changed`, d.removed.length && `${d.removed.length} removed`, d.animation && 'animation edited'].filter(Boolean);
    const run = (action) => () => this.app.reg.run('propose', { action }).catch((e) => this.toast(e.message, 'danger'));
    bar.replaceChildren(
      icon('git-pull-request'),
      h('span.grow', {}, `Proposal: ${parts.join(', ') || 'no changes yet'}`),
      h('button.btn.primary', { onclick: run('accept') }, icon('check'), 'Accept'),
      h('button.btn', { onclick: run('reject') }, icon('x'), 'Reject'),
    );
  }
  onSelection() {
    if (this.tab === 'outliner' || this.tab === 'entity') this.renderDock();
    const n = this.app.selection.length;
    if (n && this.app.tools.id === 'select') this.setStatus(n === 1 ? `${this.app.entity(this.app.selection[0])?.name} selected.` : `${n} selected.`);
  }

  panel_outliner() {
    const app = this.app;
    const doc = app.store.doc;
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    const rows = [];
    const walk = (parent, depth) => {
      for (const e of doc.entities.filter((x) => x.parent === parent)) {
        const animated = doc.animation.tracks.some((t) => t.target === e.id);
        rows.push(
          h(
            `div.tree-row${app.selection.includes(e.id) ? '.sel' : ''}`,
            { style: { paddingLeft: `${8 + depth * 16}px` }, onclick: (ev) => app.select(ev.ctrlKey || ev.shiftKey ? [...new Set([...app.selection, e.id])] : [e.id]), ondblclick: () => run('zoom_extents', { ids: [e.id] }) },
            icon(e.component ? 'squares-four' : e.type === 'group' ? 'folder-simple' : e.curve ? 'bezier-curve' : 'cube'),
            e.mesh || e.curve ? h('span.swatch-dot', { style: { background: e.material.color } }) : null,
            h(`span.name${e.visible ? '' : '.dim'}`, { title: `${e.name} (${e.id})` }, e.name),
            animated ? icon('film-strip') : null,
            h('button.icon-btn.sm', { title: e.visible ? 'Hide' : 'Show', 'aria-label': e.visible ? 'Hide' : 'Show', onclick: (ev) => (ev.stopPropagation(), run('set_properties', { ids: [e.id], visible: !e.visible })) }, icon(e.visible ? 'eye' : 'eye-slash')),
            h('button.icon-btn.sm', { title: e.locked ? 'Unlock' : 'Lock', 'aria-label': e.locked ? 'Unlock' : 'Lock', onclick: (ev) => (ev.stopPropagation(), run('set_properties', { ids: [e.id], locked: !e.locked })) }, icon(e.locked ? 'lock-simple' : 'lock-simple-open')),
          ),
        );
        walk(e.id, depth + 1);
      }
    };
    walk(null, 0);
    return h(
      'div.panel',
      {},
      h('div.row', {}, h('h3.grow', {}, 'Outliner'), h('span.muted.small', {}, `${doc.entities.length} entities`)),
      rows.length ? h('div.tree', {}, rows) : h('p.muted', {}, 'Nothing here yet. Draw with the tools on the left, or ask the AI to build something.'),
      h('div.overline', {}, 'Tags'),
      h(
        'div.tree',
        {},
        doc.tags.map((t) =>
          h('div.tree-row', {}, icon('tag'), h('span.name', {}, t.name), h('span.muted.small', {}, doc.entities.filter((e) => e.tag === t.name).length), h('button.icon-btn.sm', { title: t.visible ? 'Hide tag' : 'Show tag', 'aria-label': t.visible ? 'Hide tag' : 'Show tag', onclick: () => run('set_tag_visibility', { tag: t.name, visible: !t.visible }) }, icon(t.visible ? 'eye' : 'eye-slash'))),
        ),
      ),
    );
  }

  panel_entity() {
    const app = this.app;
    const doc = app.store.doc;
    const sel = app.selection.map((id) => app.entity(id)).filter(Boolean);
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    if (!sel.length) return h('div.panel', {}, h('h3', {}, 'Entity'), h('p.muted', {}, 'Select something to see and edit its size, position, material and animation.'));
    const e = sel[0];
    const mat = e.mesh ? e.material : (D.descendants(doc, e.id).find((x) => x.mesh)?.material ?? e.material);
    const matFields = h(
      'div.card',
      {},
      h('div.overline', {}, 'Material'),
      h('div.row', {}, h('input', { type: 'color', value: mat.color, onchange: (ev) => run('set_material', { ids: app.selection, color: ev.target.value }) }), h('span.grow.small', {}, mat.color)),
      ...[['opacity', 'Opacity'], ['metalness', 'Metal'], ['roughness', 'Rough']].map(([k, label]) =>
        h('label.row.small', {}, h('span', { style: { width: '64px' } }, label), h('input.grow', { type: 'range', min: 0, max: 1, step: 0.05, value: mat[k] ?? 0, onchange: (ev) => run('set_material', { ids: app.selection, [k]: +ev.target.value }) })),
      ),
    );
    const actions = h(
      'div.row.wrap',
      {},
      h('button.btn', { onclick: () => app.keySelection() }, icon('diamond'), 'Key pose'),
      h('button.btn', { onclick: () => this.actions.group.run() }, icon('stack'), 'Group'),
      sel.length === 1 && e.type === 'group' ? h('button.btn', { onclick: () => this.actions.ungroup.run() }, icon('stack-minus'), 'Explode') : null,
      h('button.btn.danger', { onclick: () => run('delete', {}) }, icon('trash'), 'Delete'),
    );
    if (sel.length > 1) return h('div.panel', {}, h('h3', {}, `${sel.length} selected`), matFields, actions);
    const b = D.worldBox(doc, e);
    const size = b.max.map((x, k) => x - b.min[k]);
    const xyz = (label, key, step) =>
      h(
        'div.xyz',
        {},
        h('span.lab', {}, label),
        ...[0, 1, 2].map((k) =>
          h('input', {
            type: 'number',
            step,
            value: Math.round(e[key][k] * 1000) / 1000,
            onchange: (ev) => {
              const v = [...e[key]];
              v[k] = +ev.target.value;
              run('set_transform', { id: e.id, [key]: v });
            },
          }),
        ),
      );
    const tracks = doc.animation.tracks.filter((t) => t.target === e.id);
    return h(
      'div.panel',
      {},
      h('label.field', {}, h('span', {}, `Name · ${e.id} · ${e.type === 'group' ? 'group' : e.curve ? `${e.curve.kind} curve` : `${e.mesh.f.length} faces`}`), h('input', { value: e.name, onchange: (ev) => run('set_properties', { ids: [e.id], name: ev.target.value }) })),
      h('label.field', {}, h('span', {}, 'Tag'), h('input', { value: e.tag, list: 'tag-list', onchange: (ev) => run('set_properties', { ids: [e.id], tag: ev.target.value || 'Untagged' }) }), h('datalist', { id: 'tag-list' }, doc.tags.map((t) => h('option', { value: t.name })))),
      h('div.card', {}, h('div.overline', {}, 'Transform (relative to parent; Y is up)'), xyz('Position', 'position', 0.1), xyz('Rotation°', 'rotation', 5), xyz('Scale', 'scale', 0.1), h('div.small.muted', {}, `Size ${size.map(fmt).join(' × ')}`)),
      h(
        'div.row.wrap',
        {},
        h('span.small.muted', {}, 'Pivot'),
        ...['left', 'right', 'center', 'bottom', 'top'].map((p) => h('button.btn', { onclick: () => run('set_pivot', { id: e.id, pivot: p }) }, p)),
      ),
      this.paramsCard(e),
      matFields,
      this.metaCard(e),
      tracks.length ? h('div.card', {}, h('div.overline', {}, 'Animation'), ...tracks.map((t) => h('div.small', {}, `${t.property}: ${t.keys.length} keys, ${t.keys[0].t}s → ${t.keys.at(-1).t}s`))) : null,
      actions,
    );
  }

  /** A parametric shape's parameters (#42, #134) or a curve's settings, edited in place. */
  paramsCard(e) {
    const app = this.app;
    const run = (n, a) => app.reg.run(n, a).catch((x) => this.toast(x.message, 'danger'));
    if (e.component) {
      const n = app.store.doc.entities.filter((x) => x.component === e.component).length;
      return h(
        'div.card',
        {},
        h('div.overline', {}, `Component · ${e.component} · ${n} instance${n > 1 ? 's' : ''}`),
        h('div.small.muted', {}, 'Edit its parts (double-click it) and every instance follows.'),
        h('div.row.wrap', {}, h('button.btn', { onclick: () => run('edit_component', { id: e.id }) }, icon('pencil-simple'), 'Edit parts'), h('button.btn', { onclick: () => run('make_unique', { ids: [e.id] }) }, icon('link-break'), 'Make unique')),
      );
    }
    if (e.curve)
      return h(
        'div.card',
        {},
        h('div.overline', {}, `Curve · ${e.curve.points.length} points`),
        h('label.row.small', {}, h('span', { style: { width: '64px' } }, 'Kind'), h('select.grow', { onchange: (ev) => run('set_curve', { id: e.id, kind: ev.target.value }) }, ['polyline', 'spline', 'bezier'].map((k) => h('option', { value: k, selected: e.curve.kind === k }, k)))),
        h('label.row.small', {}, h('input', { type: 'checkbox', checked: !!e.curve.closed, onchange: (ev) => run('set_curve', { id: e.id, closed: ev.target.checked }) }), 'Closed loop'),
        h('div.row.wrap', {}, h('button.btn', { onclick: () => this.commandDialog('sweep', { path: e.id }) }, icon('path'), 'Sweep along…')),
      );
    if (!e.derived) return null;
    const d = e.derived;
    const gen = getGenerator(d.generator);
    const keys = Object.keys(gen?.params || d.params).filter((k) => !(k === 'path' && d.inputs.length)); // a curve drives the path
    const fields = keys.map((k) => {
      const v = d.params[k];
      const set = (val) => run('set_params', { id: e.id, params: { [k]: val } });
      let input;
      if (k === 'mirror' || typeof v === 'boolean') input = h('input', { type: 'checkbox', checked: !!v, onchange: (ev) => set(ev.target.checked) });
      else if (k === 'anchor') input = h('select.grow', { onchange: (ev) => set(ev.target.value || undefined) }, h('option', { value: '' }, '(profile default)'), ANCHORS.map((x) => h('option', { value: x, selected: x === v }, x)));
      else if (typeof v === 'number' || (v === undefined && /\bm\b|count|number|sides|smooth/.test(gen?.params[k] || ''))) input = h('input.grow', { type: 'number', step: 'any', value: v ?? '', onchange: (ev) => ev.target.value !== '' && set(+ev.target.value) });
      else if (k === 'profile' && typeof v === 'string') input = h('select.grow', { onchange: (ev) => set(ev.target.value) }, listProfiles(app.store.doc).map((p) => h('option', { value: p.name, selected: p.name === v }, p.name)));
      else
        input = h('input.grow', {
          value: typeof v === 'string' ? v : JSON.stringify(v),
          onchange: (ev) => {
            try {
              set(JSON.parse(ev.target.value));
            } catch {
              set(ev.target.value);
            }
          },
        });
      return h('label.row.small.param-row', { title: gen?.params[k] || '' }, h('span', {}, k.replace(/_/g, ' ')), input);
    });
    return h(
      'div.card',
      {},
      h('div.row', {}, h('div.overline.grow', {}, `Parameters · ${d.generator}`), h('button.icon-btn.sm', { title: 'Bake: freeze into a plain shape', 'aria-label': 'Bake', onclick: () => run('bake', { ids: [e.id] }) }, icon('snowflake'))),
      d.error ? h('div.small.param-error', { role: 'alert' }, d.error) : null,
      d.inputs.length ? h('div.small.muted', {}, `Made from ${d.inputs.map((x) => app.entity(x)?.name || `${x} (deleted)`).join(', ')}`) : null,
      ...fields,
    );
  }

  /** Metadata key/values of one entity (#46): edit in place, add, remove. */
  metaCard(e) {
    const run = (values, remove) => this.app.reg.run('set_metadata', { ids: [e.id], ...(values ? { values } : {}), ...(remove ? { remove } : {}) }).catch((x) => this.toast(x.message, 'danger'));
    const parse = (v) => (v !== '' && Number.isFinite(+v) ? +v : v === 'true' ? true : v === 'false' ? false : v);
    const key = h('input', { placeholder: 'key (role, cost…)', 'aria-label': 'New metadata key' });
    const val = h('input', { placeholder: 'value', 'aria-label': 'New metadata value' });
    return h(
      'div.card',
      {},
      h('div.overline', {}, 'Metadata'),
      ...Object.entries(e.meta || {}).map(([k, v]) =>
        h('div.row.meta-row', {}, h('span.small', { title: k }, k), h('input.grow', { value: String(v), 'aria-label': k, onchange: (ev) => run({ [k]: parse(ev.target.value) }) }), h('button.icon-btn.sm', { title: `Remove ${k}`, 'aria-label': `Remove ${k}`, onclick: () => run(null, [k]) }, icon('x'))),
      ),
      h('div.row.meta-row', {}, key, val, h('button.icon-btn.sm', { title: 'Add', 'aria-label': 'Add metadata', onclick: () => key.value.trim() && run({ [key.value.trim()]: parse(val.value.trim()) }) }, icon('plus'))),
    );
  }

  panel_materials() {
    const app = this.app;
    const set = (m) => {
      this.setPaint(m);
      if (app.selection.length) app.reg.run('set_material', { ids: app.selection, color: m.color, opacity: m.opacity ?? 1, metalness: m.metalness ?? 0, roughness: m.roughness ?? 0.8 });
      else app.tools.set('paint');
    };
    return h(
      'div.panel',
      {},
      h('h3', {}, 'Materials'),
      h('p.muted.small', {}, 'Click a swatch: it paints the selection, or arms the Paint Bucket (B) when nothing is selected. Alt-click in the model samples a colour.'),
      h('div.swatches', {}, MATERIALS.map((m) => h('button.swatch', { 'aria-pressed': String(this.paint.color === m.color), onclick: () => set(m) }, h('i', { style: { background: m.color, opacity: m.opacity ?? 1 } }), m.name))),
      h('label.row', {}, h('span.small', {}, 'Custom'), h('input', { type: 'color', value: this.paint.color, onchange: (ev) => set({ ...this.paint, name: 'Custom', color: ev.target.value }) })),
    );
  }
  setPaint(m) {
    this.paint = m;
    this.app.tools.paint = { color: m.color, opacity: m.opacity ?? 1, metalness: m.metalness ?? 0, roughness: m.roughness ?? 0.8 };
    if (this.tab === 'materials') this.renderDock();
  }

  panel_scenes() {
    const app = this.app;
    const doc = app.store.doc;
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    return h(
      'div.panel',
      {},
      h('h3', {}, 'Scenes'),
      h('p.muted.small', {}, 'A scene remembers a camera view. Animate through scenes turns them into a camera move on the timeline.'),
      h('div.row', {}, h('button.btn.primary', { onclick: () => run('add_scene', {}) }, icon('plus'), 'Add scene'), h('button.btn', { onclick: () => app.animateScenes() }, icon('film-slate'), 'Animate through scenes')),
      h(
        'div.tree',
        {},
        doc.scenes.map((s) =>
          h(
            'div.tree-row',
            { onclick: () => run('go_to_scene', { name: s.name }) },
            icon('camera'),
            h('span.name', {}, s.name),
            h('button.icon-btn.sm', { title: 'Update to current view', 'aria-label': 'Update to current view', onclick: (ev) => (ev.stopPropagation(), run('add_scene', { name: s.name })) }, icon('arrows-clockwise')),
            h('button.icon-btn.sm', { title: 'Delete scene', 'aria-label': 'Delete scene', onclick: (ev) => (ev.stopPropagation(), run('run_script', { code: `api.doc.scenes = api.doc.scenes.filter((s) => s.name !== ${JSON.stringify(s.name)});` })) }, icon('trash')),
          ),
        ),
      ),
    );
  }

  /** Library: sweep profiles (#135), recipes and macros (#93, #92), plugins. */
  panel_library() {
    const app = this.app;
    const doc = app.store.doc;
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    const path = app.selection.map((x) => app.entity(x)).find((e) => e?.curve);
    const thumb = (p) => {
      const i = h('span.thumb');
      try {
        i.innerHTML = profileSvg(p.custom ? p.points : profilePoints(p.name));
      } catch {
        /* a broken custom profile just has no picture */
      }
      return i;
    };
    const recipes = Object.entries(doc.recipes || {});
    return h(
      'div.panel',
      {},
      h('h3', {}, 'Profiles'),
      h('p.muted.small', {}, path ? `Click a profile to sweep it along "${path.name}".` : 'Select a curve (Curve tool, U) and click a profile to sweep it along. Parameters can be changed later in the Entity panel.'),
      h(
        'div.profiles',
        {},
        listProfiles(doc).map((p) =>
          h('button.profile', { title: p.description, disabled: !path, onclick: () => run('sweep', { path: path.id, profile: p.name }) }, thumb(p), h('span', {}, p.name.replace(/_/g, ' '))),
        ),
      ),
      h('div.row', {}, h('button.btn', { onclick: () => this.commandDialog('define_profile', app.selection[0] ? { from_face: app.selection[0] } : {}) }, icon('plus'), 'Profile from a face…')),
      h('h3', {}, 'Recipes'),
      h('p.muted.small', {}, 'A recipe is how a model was built, replayable with other values ("3 storeys instead of 2"). Record a macro to capture what you do next.'),
      h(
        'div.row.wrap',
        {},
        h(`button.btn${app.ctx.macro ? '.danger' : ''}`, { onclick: this.actions.recordMacro.run }, icon(app.ctx.macro ? 'stop-circle' : 'record'), app.ctx.macro ? 'Stop recording' : 'Record macro'),
        h('button.btn', { onclick: this.actions.saveRecipe.run }, icon('floppy-disk-back'), 'Save this model as a recipe…'),
      ),
      ...recipes.map(([name, r]) =>
        h(
          'div.card',
          {},
          h('div.row', {}, icon('scroll'), h('b.grow', {}, name), h('span.small.muted', {}, `${r.steps.length} steps`)),
          r.description ? h('div.small.muted', {}, r.description) : null,
          h(
            'div.row.wrap',
            {},
            h('button.btn', { onclick: () => (Object.keys(r.params || {}).length ? this.commandDialog('replay_recipe', { name, params: r.params }) : run('replay_recipe', { name })) }, icon('play-circle'), 'Replay…'),
            h('button.btn', { onclick: () => run('replay_recipe', { name, clear: false }) }, icon('plus'), 'Add to model'),
            h('button.icon-btn.sm', { title: 'Delete recipe', 'aria-label': `Delete recipe ${name}`, onclick: () => run('run_script', { code: `delete api.doc.recipes[${JSON.stringify(name)}];` }) }, icon('trash')),
          ),
        ),
      ),
      h('h3', {}, 'Plugins'),
      h('p.muted.small', {}, 'A plugin is one JavaScript file that adds commands. Every command it adds is instantly available to the toolbar, the AI, the HTTP API and MCP. Ask the AI to "create a plugin that…" and it writes one for you.'),
      h('div.row', {}, h('button.btn', { onclick: this.actions.plugins.run }, icon('folder-open'), 'Open plugins folder'), h('button.btn', { onclick: () => app.reloadPlugins() }, icon('arrows-clockwise'), 'Reload')),
      ...app.plugins.map((p) => h('div.card', {}, h('div.row', {}, icon('puzzle-piece'), h('b.grow', {}, p.name), h('span.small.muted', {}, p.builtin ? 'built-in' : 'yours')), h('div.small.muted', {}, p.error ? `Failed: ${p.error}` : p.commands.join(', ') || 'no commands'))),
    );
  }

  panel_settings() {
    const app = this.app;
    const s = app.settings;
    const ai = s.ai;
    const save = async (patch) => {
      app.settings = await window.native.invoke('settings:set', patch);
      this.toast('Saved');
      app.ai.renderHead();
      this.renderDock();
    };
    const field = (label, value, onchange, attrs = {}) => h('label.field', {}, h('span', {}, label), h('input', { value: value ?? '', onchange, ...attrs }));
    const prov = ai.provider;
    const cfg =
      prov === 'anthropic'
        ? [field('Model', ai.anthropic.model, (e) => save({ ai: { anthropic: { model: e.target.value } } })), field(`API key ${ai.anthropic.hasKey ? '(saved; type to replace)' : ''}`, '', (e) => save({ ai: { anthropic: { apiKey: e.target.value } } }), { type: 'password', placeholder: 'sk-ant-…' })]
        : prov === 'openai'
          ? [field('Base URL', ai.openai.baseUrl, (e) => save({ ai: { openai: { baseUrl: e.target.value } } })), field('Model', ai.openai.model, (e) => save({ ai: { openai: { model: e.target.value } } })), field(`API key ${ai.openai.hasKey ? '(saved; type to replace)' : ''}`, '', (e) => save({ ai: { openai: { apiKey: e.target.value } } }), { type: 'password' })]
          : [field('Ollama URL', ai.ollama.baseUrl, (e) => save({ ai: { ollama: { baseUrl: e.target.value } } })), field('Model (needs tool calling: mistral, mistral-small, qwen2.5, llama3.1)', ai.ollama.model, (e) => save({ ai: { ollama: { model: e.target.value } } }))];
    return h(
      'div.panel',
      {},
      ...this.accountCard(),
      h('h3', {}, 'AI'),
      h(
        'label.field',
        {},
        h('span', {}, 'Provider'),
        h(
          'select',
          { onchange: (e) => save({ ai: { provider: e.target.value } }) },
          [['ollama', 'Local model (Ollama: Mistral…)'], ['anthropic', 'Claude (Anthropic API)'], ['openai', 'OpenAI-compatible (Mistral API, LM Studio, vLLM…)']].map(([v, l]) => h('option', { value: v, selected: v === prov }, l)),
        ),
      ),
      ...cfg,
      prov === 'ollama' &&
        h(
          'label.field',
          {},
          h('span', {}, 'Tools for local models (small models do better with fewer)'),
          h(
            'select',
            { onchange: (e) => save({ ai: { toolset: e.target.value } }) },
            [['auto', 'Auto: the best matches for each request'], ['all', 'All commands'], ['modelling', 'Modelling'], ['animation', 'Animation'], ['query', 'Scene queries'], ['files', 'Files']].map(([v, l]) => h('option', { value: v, selected: v === (ai.toolset || 'auto') }, l)),
          ),
        ),
      h('p.small.muted', {}, 'Keys are stored on this PC and only used by the app itself; the page never sees them.'),
      h('h3', {}, 'API and MCP'),
      h('p.small', {}, `Local HTTP API on 127.0.0.1:${app.info.apiPort}. Claude Desktop (or any MCP client) connects through the MCP server and can use every command.`),
      h('div.row', {}, h('button.btn.primary', { onclick: () => this.mcpDialog() }, icon('plugs-connected'), 'Connect Claude Desktop…'), h('button.btn', { onclick: () => window.native.invoke('shell:open-path', 'data') }, icon('folder-open'), 'Data folder')),
      h('h3', {}, 'Appearance'),
      h('label.row', {}, h('input', { type: 'checkbox', checked: document.documentElement.classList.contains('dark'), onchange: () => app.toggleTheme() }), 'Dark theme'),
      app.startup.supported &&
        h(
          'label.row',
          {},
          h('input', { type: 'checkbox', id: 'pref-startup', checked: app.startup.enabled, onchange: async (e) => (app.startup = await window.native.invoke('startup:set', e.target.checked)) }),
          'Start MyModellerReel when Windows starts',
        ),
    );
  }

  /** Settings › Account (#115): the MyStudioReel sign-in shared by every Reel app on this PC (MySnipReel's wording). */
  accountCard() {
    const s = this.app.account;
    if (!s?.configured) return [];
    const act = (channel) => async () => {
      this.app.account = await window.native.invoke(channel);
      this.renderDock();
    };
    const problem = s.problem ? h('div.small.acct-problem', { role: 'alert' }, s.problem) : null;
    let body;
    if (s.signingIn) body = [h('div.row', {}, h('span', {}, 'Finish signing in in your browser'), h('button.btn', { id: 'account-cancel', onclick: act('account:cancel') }, 'Cancel'))];
    else if (!s.signedIn)
      body = [
        h('div.small.muted', {}, 'Sign in once with your MyStudioReel account and every Reel app on this PC is signed in.'),
        problem,
        h('div.row', {}, h('button.btn.primary', { id: 'account-sign-in', onclick: act('account:sign-in') }, icon('user-circle'), 'Sign in with Google')),
      ];
    else {
      const who = s.name || s.email || '?';
      const other = s.otherDevice;
      body = [
        h('div.acct-user', {}, h('span.acct-avatar', { 'aria-hidden': 'true' }, who.trim()[0].toUpperCase()), h('div', {}, s.name && h('strong', {}, s.name), s.email && h('div.small.muted', {}, s.email))),
        h('div.small', {}, s.plan === 'pro' ? 'MyStudioReel Pro, on this PC' : s.plan === 'free' ? 'Free plan' : 'Checking your licence…'),
        other &&
          h(
            'div.small',
            {},
            `Your licence is in use on ${other.name}. Use it here and ${other.name} switches to Free at its next check. A licence can move up to 3 times in 30 days.`,
          ),
        other && h('div.row', {}, h('button.btn', { id: 'account-take-over', onclick: act('account:take-over') }, icon('desktop'), 'Use on this PC instead')),
        problem,
        h('div.row', {}, h('button.btn', { id: 'account-sign-out', onclick: act('account:sign-out') }, icon('sign-out'), 'Sign out')),
        h('div.small.muted', {}, 'Signing out signs out every Reel app on this PC.'),
      ];
    }
    return [h('h3', {}, 'Account'), h('div.card', { id: 'pref-account' }, body)];
  }

  // ---------------------------------------------------------------- status, toasts, dialogs
  setStatus(hint, vcbLabel) {
    this.$('status-hint').textContent = hint || '';
    if (vcbLabel !== undefined) this.$('vcb-label').textContent = vcbLabel || 'Measurements';
  }
  toast(msg, kind = '') {
    const t = h(`div.toast${kind ? `.${kind}` : ''}`, { role: kind === 'danger' ? 'alert' : 'status' }, msg);
    this.$('toasts').append(t);
    setTimeout(() => t.remove(), kind === 'danger' ? 6000 : 2600);
  }
  modal(title, body, buttons = [['Close', null]]) {
    const dlg = this.$('modal');
    return new Promise((resolve) => {
      dlg.replaceChildren(
        h('div.panel', {}, h('h3', {}, title), body, h('footer', {}, buttons.map(([label, value], i) => h(`button.btn${i === 0 ? '.primary' : ''}`, { onclick: () => (dlg.close(), resolve(value)) }, label)))),
      );
      dlg.onclose = () => resolve(null);
      dlg.showModal();
    });
  }
  /** Design review (#100): the checks at once, the vision critique when it arrives; issues select what they name. */
  async reviewDialog() {
    const app = this.app;
    const list = h('div.review-list', {}, h('p.muted', {}, 'Checking…'));
    const critique = h('div.review-critique');
    const done = this.modal('Review', h('div.panel', { style: { padding: 0 } }, list, critique), [['Ask the AI to fix them', 'fix'], ['Close', null]]);
    let r;
    try {
      r = await app.reg.run('review_model', {});
    } catch (e) {
      list.replaceChildren(h('p', { role: 'alert' }, e.message));
      return;
    }
    const sev = { error: 'x-circle', warning: 'warning', info: 'info' };
    list.replaceChildren(
      h('p.small.muted', {}, `${r.stats.shapes} shapes, ${r.stats.faces} faces, ${r.stats.size.join(' × ')} m.`),
      ...(r.issues.length
        ? r.issues.map((i) => h(`button.review-issue.${i.severity}`, { onclick: () => (app.select(i.ids), app.reg.run('zoom_extents', { ids: i.ids })) }, icon(sev[i.severity]), i.message))
        : [h('p', {}, icon('check-circle'), ' No geometric problems found.')]),
    );
    critique.replaceChildren(r.critique ? h('div', {}, h('div.overline', {}, `AI review · ${app.ai.modelName()}`), h('p.pre', {}, r.critique)) : h('p.small.muted', {}, r.critique_error ? `The AI review could not run: ${r.critique_error}` : 'Set up a vision model (Claude, or an OpenAI-compatible one) in AI settings for a written critique of the views.'));
    if ((await done) === 'fix' && (r.issues.length || r.critique)) app.ai.ask(`Fix these review findings where they are real mistakes, leave design choices alone:\n${r.issues.map((i) => `- ${i.message}`).join('\n')}${r.critique ? `\n${r.critique}` : ''}`);
  }

  /** Quantities report (#53): pick the grouping, read the table, export CSV. */
  async quantitiesDialog() {
    const app = this.app;
    const metaKeys = [...new Set(app.store.doc.entities.flatMap((e) => Object.keys(e.meta || {})))];
    const by = h('select', {}, ['material', 'tag', 'name', 'type', 'none', ...metaKeys.map((k) => `meta.${k}`)].map((v) => h('option', { value: v }, v.replace('meta.', 'metadata: '))));
    const table = h('div.qty');
    const fill = async () => {
      const r = await app.reg.run('report_quantities', { group_by: by.value });
      const n = (x) => (x ? x.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '–');
      const row = (cells, cls = 'td') => h('tr', {}, cells.map((c) => h(cls, {}, c)));
      table.replaceChildren(
        h('table', {}, h('thead', {}, row([by.value.replace('meta.', ''), 'Count', 'Area m²', 'Volume m³', 'Length m', 'Cost'], 'th')), h('tbody', {}, r.rows.map((x) => row([x.group, x.count, n(x.area), n(x.volume), n(x.length), n(x.cost)])), row(['Total', r.totals.count, n(r.totals.area), n(r.totals.volume), n(r.totals.length), n(r.totals.cost)], 'th'))),
      );
    };
    by.onchange = fill;
    await fill();
    const v = await this.modal('Quantities', h('div.panel', { style: { padding: 0 } }, h('label.row', {}, h('span.small', { style: { whiteSpace: 'nowrap' } }, 'Group by'), by), table), [['Export CSV…', 'csv'], ['Close', null]]);
    if (v === 'csv') {
      const path = await window.native.invoke('file:save-dialog', { defaultPath: 'Quantities.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (path) await app.reg.run('report_quantities', { group_by: by.value, path }).catch((e) => this.toast(e.message, 'danger'));
    }
  }

  mcpDialog() {
    const cfg = this.app.mcpConfig();
    const text = JSON.stringify(cfg, null, 2);
    return this.modal(
      'Connect Claude Desktop (MCP)',
      h(
        'div.panel',
        { style: { padding: 0 } },
        h('p', {}, 'Add this to Claude Desktop → Settings → Developer → Edit config (claude_desktop_config.json), then restart Claude Desktop. Claude then sees every MyModellerReel command as a tool, can look at screenshots, and starts the app if it is closed.'),
        h('div.code', {}, text),
        h('p.small.muted', {}, 'Or run "npm run mcp:config" in the project folder to add it for you. Any other MCP client (Claude Code, Cursor…) uses the same command.'),
      ),
      [['Copy config', 'copy'], ['Close', null]],
    ).then((v) => v === 'copy' && navigator.clipboard.writeText(text).then(() => this.toast('Copied')));
  }
  shortcutsDialog() {
    const rows = Object.values(this.actions).filter((a) => a.key);
    return this.modal('Keyboard shortcuts', h('div.panel', { style: { padding: 0, gap: '4px' } }, rows.map((a) => h('div.row', {}, h('span.grow', {}, a.label), h('kbd', {}, a.key))), h('p.small.muted', {}, 'While a tool is active, just type numbers: they go to the Measurements box (bottom right). Arrow keys lock an axis: → red, ← green, ↑ blue. Middle mouse orbits, right mouse pans, the wheel zooms.')));
  }
  aboutDialog() {
    return this.modal(
      'MyModellerReel',
      h('div.panel', { style: { padding: 0 } }, h('p', {}, h('b', {}, 'Model it. Reel it. Ship it.')), h('p', {}, `Version ${this.app.info.version}. An AI-first 3D modeller and animation sequencer of the My…Reel family. Files are GLB, the format every 3D tool reads.`), h('p.small.muted', {}, `Data folder: ${this.app.info.userData}`)),
    );
  }

  // ---------------------------------------------------------------- command palette (Ctrl+K)
  buildPalette() {
    const dlg = this.$('palette');
    const input = this.$('palette-input');
    const list = this.$('palette-list');
    let items = [];
    let idx = 0;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const acts = Object.entries(this.actions).map(([id, a]) => ({ label: a.label, key: a.key, icon: a.icon, run: a.run, id }));
      // Every command: ones without required parameters run at once, the others open their form.
      const cmds = this.app.reg.list().map((c) => ({
        label: c.name,
        desc: c.description,
        icon: (c.params.required || []).length ? 'textbox' : 'terminal',
        run: () => ((c.params.required || []).length ? this.commandDialog(c.name) : this.app.reg.run(c.name, {}).then((r) => this.toast(JSON.stringify(r).slice(0, 200))).catch((e) => this.toast(e.message, 'danger'))),
      }));
      items = [...acts, ...cmds].filter((i) => !q || `${i.label} ${i.desc || ''}`.toLowerCase().includes(q)).slice(0, 40);
      if (q) items.push({ label: `Ask the AI: "${input.value.trim()}"`, icon: 'sparkle', run: () => this.app.ai.ask(input.value.trim()) });
      idx = Math.min(idx, items.length - 1);
      list.replaceChildren(...items.map((it, i) => h('li', { 'aria-selected': String(i === idx), onclick: () => go(i) }, icon(it.icon || 'dot-outline'), h('span', {}, it.label), it.desc ? h('span.desc', {}, it.desc) : null, it.key ? h('span.key', {}, it.key) : null)));
      list.children[idx]?.scrollIntoView({ block: 'nearest' });
    };
    const go = (i) => {
      const it = items[i];
      dlg.close();
      it?.run();
    };
    input.oninput = () => ((idx = 0), render());
    input.onkeydown = (e) => {
      if (e.key === 'ArrowDown') (idx = Math.min(items.length - 1, idx + 1)), render(), e.preventDefault();
      else if (e.key === 'ArrowUp') (idx = Math.max(0, idx - 1)), render(), e.preventDefault();
      else if (e.key === 'Enter') {
        // A sentence with no matching command goes straight to the AI.
        const q = input.value.trim();
        if (q.split(/\s+/).length > 2 && !items.slice(0, -1).some((x) => x.label.toLowerCase() === q.toLowerCase())) go(items.length - 1);
        else go(idx);
      }
    };
    this.openPalette = () => {
      input.value = '';
      idx = 0;
      render();
      dlg.showModal();
      input.focus();
    };
    this.$('palette-btn').onclick = this.openPalette;
  }
}
