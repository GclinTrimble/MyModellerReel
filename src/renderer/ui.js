// Chrome around the viewport: menus, tool bar, dock panels, status bar, palette, toasts, dialogs.
import * as D from '../core/document.js';
import { MATERIALS } from '../core/materials.js';
import * as L from '../core/layers.js';
export { MATERIALS };
import { listProfiles, profilePoints, profileSvg, ANCHORS } from '../core/profiles.js';
import { getGenerator } from '../core/derived.js';
import { TOOLS, fmt } from './tools.js';
import { t, LANGUAGES } from '../core/i18n.js';
const tr = (label) => t(label.replace(/\s*\(.*$/, '')) + (label.match(/\s*\(.*$/)?.[0] || '');

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
    const lightSpot = () => {
      const t = app.viewport.controls.target;
      return [t.x, t.y + 2.5, t.z].map((x) => Math.round(x * 100) / 100);
    };
    const style = (k) => ({ checked: () => app.store.doc.settings[k], run: () => app.reg.run('set_style', { [k]: !app.store.doc.settings[k] }) });
    this.actions = {
      new: { label: 'New model', icon: 'file-plus', key: 'Ctrl+N', run: () => app.newModel() },
      open: { label: 'Open…', icon: 'folder-open', key: 'Ctrl+O', run: run('open', {}) },
      save: { label: 'Save', icon: 'floppy-disk', key: 'Ctrl+S', run: () => app.reg.run('save', { path: app.file || undefined }).catch((e) => this.toast(e.message, 'danger')) },
      saveAs: { label: 'Save as…', icon: 'floppy-disk', key: 'Ctrl+Shift+S', run: run('save', {}) },
      howto: { label: 'How do I…', icon: 'question', key: 'F1', run: () => ((this.app.help.page = null), this.show('help')) },
      startScreen: { label: 'New from template…', icon: 'squares-four', run: () => this.startScreen() },
      tour: { label: 'Take the 2-minute tour', icon: 'compass', run: () => this.tour() },
      checkUpdates: { label: 'Check for updates', icon: 'arrow-circle-up', run: () => app.reg.run('check_for_updates', {}).then((r) => this.toast(r.status === 'ready' ? `Version ${r.latest} is ready: Restart to update.` : r.status === 'downloading' ? `Downloading ${r.latest}… ${r.percent ?? 0}%` : r.status === 'current' ? `You have the latest version (${r.current}).` : r.status === 'error' ? `Could not check: ${r.error}` : `Version ${r.current}: ${r.status}`)).catch((e) => this.toast(e.message, 'danger')) },
      restartUpdate: { label: 'Restart to update', icon: 'arrow-clockwise', run: run('restart_to_update', {}) },
      copy: { label: 'Copy', icon: 'copy', key: 'Ctrl+C', run: () => sel().length && app.reg.run('copy', {}).catch((e) => this.toast(e.message, 'danger')) },
      cut: { label: 'Cut', icon: 'scissors', key: 'Ctrl+X', run: () => sel().length && app.reg.run('cut', {}).catch((e) => this.toast(e.message, 'danger')) },
      paste: { label: 'Paste in place', icon: 'clipboard-text', key: 'Ctrl+V', run: run('paste', {}) },
      modelInfo: { label: 'Model info…', icon: 'info', run: () => app.reg.run('model_info', {}).then((r) => this.infoDialog('Model info', r)) },
      purge: { label: 'Purge unused', icon: 'broom', run: () => app.reg.run('purge', {}).then((r) => this.toast(r.total ? `Purged ${r.total}: ${[...r.removed.layers, ...r.removed.components, ...r.removed.groups].join(', ')}` : 'Nothing unused.')) },
      viewBack: { label: 'Previous view', icon: 'arrow-u-up-left', run: run('view_back', {}) },
      viewForward: { label: 'Next view', icon: 'arrow-u-up-right', run: run('view_forward', {}) },
      units: { label: 'Units and precision…', icon: 'ruler', run: form('set_units', () => ({ display: app.store.doc.settings.display_units || 'auto', precision: app.store.doc.settings.precision })) },
      import: { label: 'Import (LandXML, IFC, DXF, models)…', icon: 'tray-arrow-down', run: () => app.reg.run('import', {}).then((r) => r && !r.cancelled && r.created && this.importReport(r)).catch((e) => this.toast(e.message, 'danger')) },
      exportLandxml: { label: 'Export LandXML…', icon: 'export', run: run('export', { format: 'landxml' }) },
      exportIfc: { label: 'Export IFC…', icon: 'export', run: run('export', { format: 'ifc' }) },
      exportDxf: { label: 'Export DXF…', icon: 'export', run: run('export', { format: 'dxf' }) },
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
      importPoints: { label: 'Import points (CSV / TXT)…', icon: 'tray-arrow-down', run: () => this.importPointsDialog() },
      importPdf: { label: 'Import PDF drawing…', icon: 'file-pdf', run: async () => {
        const path = await window.native.invoke('file:open-dialog', { filters: [{ name: 'PDF drawing', extensions: ['pdf'] }] });
        if (path) this.commandDialog('import_pdf', { path, scale: '1:500', pages: [1] });
      } },
      importImage: { label: 'Import image (world file / GeoTIFF)…', icon: 'image', run: async () => {
        const path = await window.native.invoke('file:open-dialog', { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'gif', 'bmp'] }] });
        if (path) app.reg.run('import_image', { path }).then((r) => (this.toast(`${r.name}: placed by ${r.placed_by}`), app.reg.run('zoom_extents', { ids: [r.id] }))).catch((e) => this.toast(e.message, 'danger'));
      } },
      drawingScale: { label: 'Set drawing scale…', icon: 'ruler', run: form('calibrate_underlay', () => ({ id: sel()[0], drawing_scale: '1:500' })) },
      georef: { label: 'Georeference from control points', icon: 'crosshair-simple', run: () => app.reg.run('georeference_underlay', { id: sel()[0] }).then((g) => this.toast(`${g.method}: RMS ${fmt(g.rms)}`)).catch((e) => this.toast(e.message, 'danger')) },
      georefReport: { label: 'Georeference report', icon: 'list-checks', run: () => this.georefDialog(sel()[0]) },
      worldFile: { label: 'Export world file…', icon: 'export', run: async () => {
        const e = app.entity(sel()[0]);
        if (!e?.underlay) return this.toast('Select a drawing first.', 'danger');
        const path = await window.native.invoke('file:save-dialog', { defaultPath: `${e.name}.wld`, filters: [{ name: 'World file', extensions: ['wld', 'pgw', 'jgw', 'tfw'] }] });
        if (path) run('export_world_file', { id: e.id, path })();
      } },
      pdfStats: { label: 'What is in this PDF?', icon: 'info', run: () => app.reg.run('pdf_linework_stats', { id: sel()[0] }).then((r) => this.infoDialog('PDF content', r)).catch((e) => this.toast(e.message, 'danger')) },
      extract: { label: 'Extract linework…', icon: 'path', run: form('extract_linework', () => ({ id: sel()[0] })) },
      drawingText: { label: 'Text on the drawing', icon: 'text-t', run: () => app.reg.run('list_drawing_text', { id: sel()[0], limit: 200 }).then((r) => this.infoDialog(`${r.count} text labels`, r.texts.map((t) => `${t.str}   [${t.at.join(', ')}]`).join('\n'))).catch((e) => this.toast(e.message, 'danger')) },
      offset: { label: 'Offset curve…', icon: 'arrows-in-line-horizontal', run: form('offset_curve', () => ({ id: sel()[0], distance: 1 })) },
      fillet: { label: 'Fillet…', icon: 'circle-half', run: form('fillet', () => ({ radius: 1 })) },
      chamfer: { label: 'Chamfer…', icon: 'line-segment', run: form('chamfer', () => ({ distance: 1 })) },
      joinCurves: { label: 'Join curves', icon: 'link', run: () => app.reg.run('join_curves', {}).then((r) => this.toast(`${r.before} curves → ${r.after}`)).catch((e) => this.toast(e.message, 'danger')) },
      explode: { label: 'Explode curve', icon: 'arrows-out-line-horizontal', run: run('explode_curve', {}) },
      simplify: { label: 'Simplify curves…', icon: 'wave-sine', run: form('simplify_curve', { tolerance: 0.05 }) },
      divide: { label: 'Divide curve into points…', icon: 'dots-three', run: form('divide_curve', () => ({ id: sel()[0], spacing: 10 })) },
      elevate: { label: 'Elevate linework…', icon: 'arrow-fat-line-up', run: form('elevate_linework', { mode: 'constant' }) },
      toBreaklines: { label: 'Linework to breaklines…', icon: 'line-segments', run: form('linework_to_breaklines', { kind: 'breakline' }) },
      extrudeLines: { label: 'Extrude closed linework…', icon: 'cube', run: form('extrude_linework', { height: 6 }) },
      sweepLines: { label: 'Sweep a profile along linework…', icon: 'path', run: form('sweep_linework', { profile: 'kerb' }) },
      newLayer: { label: 'New layer…', icon: 'stack', run: form('create_layer', { current: true }) },
      layerState: { label: 'Save layer state…', icon: 'floppy-disk-back', run: form('save_layer_state') },
      restoreLayerState: { label: 'Restore layer state…', icon: 'clock-counter-clockwise', run: form('restore_layer_state') },
      mapLayers: { label: 'Merge layers…', icon: 'stack-simple', run: form('merge_layers') },
      exportPoints: { label: 'Export points…', icon: 'export', run: async () => {
        const path = await window.native.invoke('file:save-dialog', { defaultPath: 'Points.csv', filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
        if (path) run('export_points', { path })();
      } },
      addPoint: { label: 'Add point…', icon: 'map-pin', run: form('add_point') },
      breakline: { label: 'Breakline through the selected points', icon: 'line-segment', run: run('add_breakline', {}) },
      boundary: { label: 'Boundary through the selected points', icon: 'polygon', run: run('add_boundary', {}) },
      surface: { label: 'Create surface (TIN)…', icon: 'mountains', run: form('create_surface', { name: 'Existing ground' }) },
      checkSurface: { label: 'Check surface', icon: 'list-checks', run: () => this.checkSurfaceDialog(sel()[0]) },
      contours: { label: 'Contours…', icon: 'wave-sine', run: form('surface_contours', () => ({ id: sel()[0], interval: 1, major_every: 5 })) },
      analyze: { label: 'Analysis colours (slope, elevation, aspect)…', icon: 'palette', run: form('analyze_surface', () => ({ id: sel()[0], kind: 'slope' })) },
      profile: { label: 'Profile along the selected line', icon: 'chart-line', run: () => app.reg.run('surface_profile', { path: sel()[0], interval: 1 }).then((r) => this.profileDialog(r)).catch((e) => this.toast(e.message, 'danger')) },
      sections: { label: 'Cross-sections along the selected line', icon: 'columns', run: () => app.reg.run('cross_sections', { path: sel()[0] }).then((r) => this.sectionsDialog(r)).catch((e) => this.toast(e.message, 'danger')) },
      pad: { label: 'Pad with batters…', icon: 'stack', run: form('create_pad', () => ({ outline: sel()[0], cut_slope: 2, fill_slope: 2, merge: true })) },
      smooth: { label: 'Smooth surface…', icon: 'drop', run: form('smooth_surface', () => ({ id: sel()[0], levels: 1 })) },
      fromContours: { label: 'Surface from contours…', icon: 'mountains', run: form('terrain_from_contours', { spacing: 2 }) },
      contourZ: { label: 'Assign contour elevations…', icon: 'arrows-down-up', run: form('assign_contour_elevations', { interval: 1 }) },
      newTerrain: { label: 'New terrain to sculpt…', icon: 'square', run: form('create_terrain', { width: 100, depth: 100, spacing: 2 }) },
      stamp: { label: 'Stamp a platform…', icon: 'stamp', run: form('stamp') },
      drape: { label: 'Drape onto a surface…', icon: 'arrow-line-down', run: form('drape') },
      water: { label: 'Water level…', icon: 'waves', run: form('water_level') },
      importTerrain: { label: 'Import terrain (GeoTIFF, ASCII grid)…', icon: 'globe-hemisphere-west', run: async () => {
        const path = await window.native.invoke('file:open-dialog', { filters: [{ name: 'Elevation grids', extensions: ['tif', 'tiff', 'asc'] }] });
        if (path) app.reg.run('import_terrain', { path }).then((r) => (this.toast(`${r.name}: ${r.triangles} triangles`), app.reg.run('zoom_extents', { ids: [r.id] }))).catch((e) => this.toast(e.message, 'danger'));
      } },
      drapeImage: { label: 'Drape an image on a surface…', icon: 'image', run: form('drape_image') },
      textToPoints: { label: 'Spot heights to points…', icon: 'map-pin', run: form('text_to_points', () => ({ id: sel()[0] })) },
      labelContours: { label: 'Contour heights from labels…', icon: 'tag', run: form('label_contours') },
      text3d: { label: '3D text…', icon: 'text-t', run: form('create_text', { text: 'Text', size: 0.5, depth: 0.05 }) },
      dimensionShape: { label: 'Dimension the selected shape', icon: 'arrows-horizontal', run: () => (sel().length ? Promise.all(['x', 'y', 'z'].map((axis) => app.reg.run('add_dimension', { id: sel()[0], axis, offset: 0.4 }))).catch((e) => this.toast(e.message, 'danger')) : this.toast('Select a shape first.')) },
      labelSel: { label: 'Label the selection…', icon: 'tag', run: form('add_label', () => ({ id: sel()[0], text: '{name}' })) },
      listAnnotations: { label: 'Dimensions and labels…', icon: 'list-bullets', run: () => app.reg.run('list_annotations', {}).then((r) => this.infoDialog('Dimensions and labels', r.length ? r.map((x) => `${x.name}: ${x.text || x.type}${x.attached.length ? ` (on ${x.attached.join(', ')})` : ''}`).join('\n') : 'None yet: Tools › Dimension (D) or Label (K).')) },
      clearGuides: { label: 'Delete all guides', icon: 'eraser', run: run('clear_guides', {}) },
      lineTypes: { label: 'New line type…', icon: 'line-segments', run: form('define_line_type', { name: 'fence', pattern: [1, 0.3, 0.1, 0.3] }) },
      clashes: { label: 'Clash check', icon: 'warning-diamond', run: () => app.reg.run('check_clashes', { select: true }).then((r) => this.clashDialog(r)).catch((e) => this.toast(e.message, 'danger')) },
      sectionFill: { label: 'Section fill', icon: 'paint-bucket', checked: () => app.store.doc.settings.section_fill !== false, run: () => app.reg.run('set_style', { section_fill: app.store.doc.settings.section_fill === false }) },
      exportSection: { label: 'Export section (SVG, DXF)…', icon: 'export', run: () => app.reg.run('export_section', { preview: true }).then((r) => r?.preview && this.svgPreview(`Section saved: ${r.path.split(/[\\/]/).pop()}`, r.preview)).catch((e) => this.toast(e.message, 'danger')) },
      exportDrawing: { label: 'Export drawing sheet (PDF, SVG)…', icon: 'file-pdf', run: () => app.reg.run('export_drawing', { preview: true, title: app.store.doc.name || 'Untitled' }).then((r) => r?.preview && this.svgPreview(`Sheet saved: ${r.path.split(/[\\/]/).pop()} · ${r.scale}`, r.preview)).catch((e) => this.toast(e.message, 'danger')) },
      geolocation: { label: 'Geolocation…', icon: 'globe-hemisphere-west', run: form('set_geolocation', () => ({ ...(app.store.doc.settings.geolocation || {}) })) },
      sunTime: { label: 'Sun at a date and time…', icon: 'sun', run: form('set_sun_time', () => ({ date: app.store.doc.settings.sun.date || new Date().toISOString().slice(0, 10), time: app.store.doc.settings.sun.time || '12:00' })) },
      sunStudy: { label: 'Sun study on the timeline…', icon: 'sun-horizon', run: form('animate_sun', () => ({ date: app.store.doc.settings.sun.date || new Date().toISOString().slice(0, 10), from: '06:00', to: '20:00' })) },
      styleShaded: { label: 'Shaded', icon: 'cube', checked: () => (app.store.doc.settings.render_style || 'shaded') === 'shaded', run: run('set_style', { render_style: 'shaded' }) },
      styleHidden: { label: 'Hidden line', icon: 'cube-transparent', checked: () => app.store.doc.settings.render_style === 'hidden_line', run: run('set_style', { render_style: 'hidden_line' }) },
      styleMono: { label: 'Monochrome', icon: 'circle-half-tilt', checked: () => app.store.doc.settings.render_style === 'monochrome', run: run('set_style', { render_style: 'monochrome' }) },
      styleSketchy: { label: 'Sketchy', icon: 'pencil-simple-line', checked: () => app.store.doc.settings.render_style === 'sketchy', run: run('set_style', { render_style: 'sketchy' }) },
      parallel: { label: 'Parallel projection', icon: 'square', checked: () => app.store.doc.settings.projection === 'parallel', run: () => app.reg.run('set_camera', { projection: app.store.doc.settings.projection === 'parallel' ? 'perspective' : 'parallel' }) },
      twoPoint: { label: 'Two-point perspective', icon: 'arrows-vertical', checked: () => !!app.store.doc.settings.two_point, run: () => app.reg.run('set_camera', { two_point: !app.store.doc.settings.two_point }) },
      lens: { label: 'Camera lens…', icon: 'aperture', run: form('set_camera', { lens: 35 }) },
      effects: { label: 'Effects (AO, bloom, depth of field)…', icon: 'sparkle', run: form('set_effects', () => ({ ...(app.store.doc.settings.effects || {}) })) },
      environment: { label: 'Environment lighting…', icon: 'mountains', run: form('set_environment', () => ({ preset: app.store.doc.settings.environment?.preset || 'studio' })) },
      lightPoint: { label: 'Point light', icon: 'lightbulb', run: () => app.reg.run('create_light', { kind: 'point', position: lightSpot() }) },
      lightSpot: { label: 'Spot light', icon: 'flashlight', run: () => app.reg.run('create_light', { kind: 'spot', position: lightSpot(), target: app.viewport.controls.target.toArray().map((x) => Math.round(x * 100) / 100) }) },
      lightArea: { label: 'Area light (panel)', icon: 'rectangle', run: () => app.reg.run('create_light', { kind: 'area', position: lightSpot(), target: app.viewport.controls.target.toArray().map((x) => Math.round(x * 100) / 100) }) },
      texture: { label: 'Texture from an image…', icon: 'image-square', run: async () => {
        if (!sel().length) return this.toast('Select the shapes first.');
        const path = await app.io.pick('texture', false);
        if (path) app.reg.run('set_texture', { path, size: [1, 1] }).catch((e) => this.toast(e.message, 'danger'));
      } },
      textureEdit: { label: 'Texture size and projection…', icon: 'arrows-out', run: form('set_texture', () => ({ ...(app.entity(sel()[0])?.material.texture || {}), asset: undefined })) },
      materialMaps: { label: 'Glass, coat and maps…', icon: 'drop', run: form('set_material_maps', {}) },
      renderImage: { label: 'Render photoreal still (path traced)…', icon: 'camera', run: () => app.reg.run('render_image', { samples: 256 }).then((r) => r?.path && this.toast(`Rendered ${r.samples} samples in ${r.seconds} s`)).catch((e) => this.toast(e.message, 'danger')) },
      aiRender: { label: 'AI render…', icon: 'magic-wand', run: () => this.commandDialog('ai_render', { prompt: 'warm evening light, landscaped garden, people walking', strength: 0.55 }).then((r) => r?.image && this.imagePreview('AI render', r.image)) },
      aiTexture: { label: 'AI texture from a prompt…', icon: 'magic-wand', run: form('generate_texture', { prompt: 'weathered red brick', size: 1 }) },
      saveClip: { label: 'Save as a clip…', icon: 'film-reel', run: form('save_clip', () => ({ name: 'Door opens' })) },
      applyClip: { label: 'Apply a clip to the selection…', icon: 'film-slate', run: form('apply_clip', () => ({ name: (app.store.doc.animation.clips || [])[0]?.name || '', start: Math.round((app.timeline.time || 0) * 100) / 100 })) },
      physics: { label: 'Physics: drop and settle the selection', icon: 'atom', run: () => (sel().length ? app.reg.run('simulate_physics', { start: Math.round((app.timeline.time || 0) * 100) / 100 }).then((r) => this.toast(`Simulated ${r.moved.length} shapes${r.settled_at !== null ? `, settled at ${r.settled_at} s` : ''}`)).catch((e) => this.toast(e.message, 'danger')) : this.toast('Select the shapes that fall.')) },
      addShot: { label: 'Add a shot from this view…', icon: 'film-strip', run: form('add_shot', () => ({ start: Math.round((app.timeline.time || 0) * 100) / 100, end: Math.round(((app.timeline.time || 0) + 3) * 100) / 100 })) },
      addAudio: { label: 'Add music or a voiceover…', icon: 'music-notes', run: async () => {
        const path = await app.io.pick('audio', false);
        if (path) app.reg.run('add_audio', { path, start: Math.round((app.timeline.time || 0) * 100) / 100 }).catch((e) => this.toast(e.message, 'danger'));
      } },
      sectionReveal: { label: 'Section reveal (the cut sweeps through)…', icon: 'knife', run: form('animate_section', () => ({ normal: [0, 1, 0], start: Math.round((app.timeline.time || 0) * 100) / 100 })) },
      attach: { label: 'Attach to… (carry with)', icon: 'link', run: form('attach', () => ({ id: sel()[0], parent: sel()[1] || '', start: Math.round((app.timeline.time || 0) * 100) / 100 })) },
      lookAt: { label: 'Look at…', icon: 'eye', run: form('look_at', () => ({ id: sel()[0], at: sel()[1] || '' })) },
      retime: { label: 'Retime keyframes…', icon: 'clock-countdown', run: form('retime', { scale: 2 }) },
      schedule: { label: 'Import a schedule (4D: CSV, MS Project, P6)…', icon: 'calendar', run: async () => {
        const path = await app.io.pick('schedule', false);
        if (path) app.reg.run('import_schedule', { path }).then((r) => this.infoDialog('Schedule imported', `${r.tasks} tasks, ${r.matched} matched to the model, ${r.seconds_per_day} s per day.${r.unmatched.length ? `\nNot matched: ${r.unmatched.join(', ')}` : ''}`)).catch((e) => this.toast(e.message, 'danger'));
      } },
      filletEdges: { label: 'Fillet edges…', icon: 'circle-half', run: form('fillet_edges', () => ({ id: sel()[0], edges: 'all', radius: 0.05 })) },
      chamferEdges: { label: 'Chamfer edges…', icon: 'triangle', run: form('chamfer_edges', () => ({ id: sel()[0], edges: 'all', distance: 0.05 })) },
      loft: { label: 'Loft through the selected curves', icon: 'vignette', run: () => (sel().length > 1 ? app.reg.run('loft', { profiles: sel() }).catch((e) => this.toast(e.message, 'danger')) : this.toast('Select two or more curves, in order.')) },
      shell: { label: 'Shell (hollow)…', icon: 'cube-transparent', run: form('shell', () => ({ id: sel()[0], thickness: 0.05, open: 'top' })) },
      thicken: { label: 'Thicken…', icon: 'stack-plus', run: form('thicken', () => ({ id: sel()[0], thickness: 0.1 })) },
      extrudeFaces: { label: 'Extrude faces…', icon: 'arrow-fat-line-up', run: form('extrude_faces', () => ({ id: sel()[0], faces: ['top'], distance: 0.2 })) },
      subdivide: { label: 'Subdivide (smooth)', icon: 'circles-three', run: () => (sel().length ? app.reg.run('subdivide', { id: sel()[0], levels: 2 }).catch((e) => this.toast(e.message, 'danger')) : this.toast('Select a shape.')) },
      deform: { label: 'Deform (taper, twist, bend)…', icon: 'wave-sine', run: form('deform', () => ({ id: sel()[0], type: 'twist', amount: 90, axis: 'y' })) },
      simplify: { label: 'Simplify mesh…', icon: 'triangle-dashed', run: form('simplify_mesh', { ratio: 0.5 }) },
      splitSolid: { label: 'Split solid along a plane…', icon: 'scissors', run: form('split_solid', () => ({ id: sel()[0], normal: [0, 1, 0] })) },
      intersect: { label: 'Intersect faces', icon: 'intersect', run: needTwo(() => app.reg.run('intersect_faces', { ids: sel() }).catch((e) => this.toast(e.message, 'danger'))) },
      weld: { label: 'Weld edges', icon: 'link-simple', run: run('weld_edges', {}) },
      symmetry: { label: 'Symmetry (mirror edits across x)', icon: 'flip-horizontal', checked: () => !!app.store.doc.settings.symmetry, run: () => app.reg.run('set_symmetry', { axis: app.store.doc.settings.symmetry ? 'off' : 'x' }) },
      axes: { label: 'Drawing axes and grid…', icon: 'compass-tool', run: form('set_axes', () => ({ ...(app.store.doc.settings.axes || { angle: 0, grid: 1, snap: true }) })) },
      import2d: { label: 'Import a 2D drawing (SVG, DXF)…', icon: 'file-svg', run: async () => {
        const path = await app.io.pick('drawing2d', false);
        if (path) app.reg.run('import_2d', { path, faces: true }).then((r) => this.toast(`${r.curves ?? ''} lines${r.faces ? `, ${r.faces} faces` : ''}`)).catch((e) => this.toast(e.message, 'danger'));
      } },
      curvesToFaces: { label: 'Closed curves to faces', icon: 'polygon', run: run('curves_to_faces', {}) },
      arrayGrid: { label: 'Grid array…', icon: 'grid-four', run: form('array_grid', { nx: 3, ny: 1, nz: 2 }) },
      arrayPath: { label: 'Array along a curve…', icon: 'path', run: form('array_path', () => ({ path: sel().map((x) => app.entity(x)).find((e) => e?.curve)?.name || '', count: 10 })) },
      saveSelection: { label: 'Save the selection as a set…', icon: 'selection-plus', run: () => (sel().length ? this.commandDialog('save_selection', { name: `Set ${Object.keys(app.store.doc.selection_sets || {}).length + 1}` }) : this.toast('Select something first.')) },
      importCloud: { label: 'Import a point cloud (PLY, LAS, XYZ)…', icon: 'dots-nine', run: async () => {
        const path = await app.io.pick('cloud', false);
        if (path) app.reg.run('import_point_cloud', { path }).then((r) => this.toast(`${r.points.toLocaleString()} points (of ${r.in_file.toLocaleString()})`)).catch((e) => this.toast(e.message, 'danger'));
      } },
      groundFromCloud: { label: 'Ground surface from a point cloud', icon: 'mountains', run: () => {
        const id = sel().find((x) => app.entity(x)?.pointcloud) || app.store.doc.entities.find((e) => e.pointcloud)?.id;
        if (!id) return this.toast('Import or select a point cloud first.');
        app.reg.run('classify_ground', { id }).then((r) => this.toast(`Ground: ${r.ground_points.toLocaleString()} points`)).catch((e) => this.toast(e.message, 'danger'));
      } },
      vectorise: { label: 'Vectorise a scanned drawing', icon: 'scan', run: () => (sel().some((x) => app.entity(x)?.underlay) ? app.reg.run('vectorise_underlay', { id: sel().find((x) => app.entity(x)?.underlay) }).then((r) => this.toast(`${r.curves} lines traced`)).catch((e) => this.toast(e.message, 'danger')) : this.toast('Select a drawing (underlay) first.')) },
      readDrawing: { label: 'Read the drawing (scale, grid, title)…', icon: 'magnifying-glass', run: () => {
        const id = sel().find((x) => app.entity(x)?.underlay);
        if (!id) return this.toast('Select a drawing (underlay) first.');
        app.reg.run('read_drawing', { id }).then((r) => this.readDrawingDialog(id, r)).catch((e) => this.toast(e.message, 'danger'));
      } },
      snapDrawings: { label: 'Snap to drawings (without extracting)', icon: 'magnet', checked: () => !!app.store.doc.settings.snap_underlays, run: () => app.reg.run('set_style', { snap_underlays: !app.store.doc.settings.snap_underlays }) },
      gizmoMove: { label: 'Handles: move', icon: 'arrows-out-cardinal', checked: () => app.store.doc.settings.gizmo === 'move', run: () => app.reg.run('set_gizmo', { mode: app.store.doc.settings.gizmo === 'move' ? 'off' : 'move' }) },
      gizmoRotate: { label: 'Handles: rotate', icon: 'arrow-clockwise', checked: () => app.store.doc.settings.gizmo === 'rotate', run: () => app.reg.run('set_gizmo', { mode: app.store.doc.settings.gizmo === 'rotate' ? 'off' : 'rotate' }) },
      gizmoScale: { label: 'Handles: scale', icon: 'arrows-out', checked: () => app.store.doc.settings.gizmo === 'scale', run: () => app.reg.run('set_gizmo', { mode: app.store.doc.settings.gizmo === 'scale' ? 'off' : 'scale' }) },
      newTab: { label: 'New document tab', icon: 'browsers', key: 'Ctrl+Shift+N', run: run('new_document', {}) },
      versions: { label: 'Versions…', icon: 'clock-counter-clockwise', run: () => this.versionsDialog() },
      webViewer: { label: 'Export a web viewer (HTML)…', icon: 'globe', run: run('export_web_viewer', {}) },
      exportUsdz: { label: 'Export USDZ (iPhone AR)…', icon: 'device-mobile', run: run('export', { format: 'usdz' }) },
      export3mf: { label: 'Export 3MF (3D printing)…', icon: 'printer', run: run('export', { format: '3mf' }) },
      compress: { label: 'Compress a GLB…', icon: 'file-zip', run: async () => {
        const path = await app.io.pick('glb', false);
        if (path) app.reg.run('compress_glb', { path }).then((r) => this.toast(`${r.method}: ${Math.round(r.before / 1024)} → ${Math.round(r.after / 1024)} KB (${r.saved} smaller)`)).catch((e) => this.toast(e.message, 'danger'));
      } },
      freeAssets: { label: 'Free assets (Poly Haven, CC0)…', icon: 'download-simple', run: () => this.assetsDialog() },
      generateMesh: { label: 'Generate a 3D model from words…', icon: 'magic-wand', run: form('generate_mesh', { prompt: 'a wooden garden chair', height: 0.9 }) },
      perf: { label: 'Performance report', icon: 'gauge', run: () => app.reg.run('performance_report', {}).then((r) => this.infoDialog('Performance', r)) },
      exportGeojson: { label: 'Export GeoJSON…', icon: 'export', run: run('export', { format: 'geojson' }) },
      exportShp: { label: 'Export Shapefile…', icon: 'export', run: run('export', { format: 'shp' }) },
      cutFill: { label: 'Cut / fill…', icon: 'chart-bar', run: form('cut_fill') },
      volumeReport: { label: 'Volume report…', icon: 'table', run: form('volume_report') },
      alignment: { label: 'Alignment…', icon: 'path', run: form('create_alignment') },
      corridor: { label: 'Corridor…', icon: 'road-horizon', run: form('create_corridor') },
      trench: { label: 'Design: trench…', icon: 'shovel', run: form('design_trench') },
      lineSlope: { label: 'Design: line with cross slope…', icon: 'line-segment', run: form('design_line_slope') },
      plane: { label: 'Design: plane…', icon: 'square', run: form('design_plane') },
      offsetSurface: { label: 'Design: offset surface…', icon: 'stack', run: form('design_offset_surface') },
      road: { label: 'Design: road…', icon: 'road-horizon', run: form('design_road') },
      featureCode: { label: 'Define feature code…', icon: 'tag', run: form('define_feature_code') },
      loadLibrary: { label: 'Load feature library…', icon: 'books', run: async () => {
        const path = await window.native.invoke('file:open-dialog', { filters: [{ name: 'Feature library', extensions: ['json'] }] });
        if (path) run('load_feature_library', { path })();
      } },
      processCodes: { label: 'Process feature codes', icon: 'arrows-clockwise', run: () => app.reg.run('process_codes', {}).then((r) => this.toast(`${r.lines} lines, ${r.objects} objects${r.warnings.length ? `, ${r.warnings.length} warnings` : ''}`)) },
      coordSys: { label: 'Coordinate system…', icon: 'globe-hemisphere-west', run: form('set_coordinate_system') },
      basePoint: { label: 'Base point…', icon: 'crosshair', run: form('set_base_point') },
      units: { label: 'Units…', icon: 'ruler', run: form('set_units') },
      survey: { label: 'Survey panel', icon: 'map-pin', run: () => this.show('survey') },
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
      File: ['new', 'newTab', 'startScreen', 'open', 'save', 'saveAs', 'versions', '-', 'import', 'importCloud', 'freeAssets', 'Export', 'exportGlb', 'exportGltf', 'exportObj', 'exportStl', 'exportLandxml', 'exportIfc', 'exportDxf', 'exportGeojson', 'exportShp', 'exportSection', 'exportDrawing', 'exportUsdz', 'export3mf', 'webViewer', 'compress', 'exportPng', 'exportVideo', '-', 'quantities', '-', 'plugins'],
      Edit: ['undo', 'redo', '-', 'cut', 'copy', 'paste', '-', 'duplicate', 'delete', '-', 'selectAll', 'selectNone', 'selectInvert', 'selectSimilar', 'selectWhere', '-', 'group', 'ungroup', '-', 'makeComponent', 'placeComponent', 'makeUnique', 'replaceComponent', '-', 'hide', 'unhideAll', 'lock', 'unlockAll', '-', 'metadata', '-', 'modelInfo', 'purge', 'units'],
      Arrange: ['alignXmin', 'alignXmid', 'alignXmax', 'alignZmin', 'alignZmid', 'alignZmax', 'alignYmin', '-', 'distX', 'distZ', 'stack', '-', 'placeOn', 'against', 'freeSpace'],
      View: ['zoomExtents', 'zoomSel', 'tool:zoomwin', 'viewBack', 'viewForward', '-', 'iso', 'top', 'front', 'right', 'left', 'back', '-', 'edges', 'xray', 'wireframe', 'shadows', 'grid', 'sectionFill', 'unsection', 'gizmoMove', 'gizmoRotate', 'gizmoScale', 'perf', 'Style', 'styleShaded', 'styleHidden', 'styleMono', 'styleSketchy', 'Camera and light', 'parallel', 'twoPoint', 'lens', 'effects', 'environment', 'geolocation', 'sunTime', 'sunStudy', 'Render', 'renderImage', 'aiRender', '-', 'timeline', 'theme'],
      Tools: ['Draw', ...T('draw'), 'Modify', ...T('edit'), 'Construct', ...T('construct'), 'Drafting', ...T('draft'), 'Camera', ...T('camera'), 'Lights', 'lightPoint', 'lightSpot', 'lightArea', 'Materials', 'texture', 'textureEdit', 'materialMaps', 'aiTexture', 'generateMesh', 'Annotate', 'text3d', 'dimensionShape', 'labelSel', 'listAnnotations', 'clearGuides', 'lineTypes', 'clashes', 'Shape', 'filletEdges', 'chamferEdges', 'loft', 'shell', 'thicken', 'extrudeFaces', 'subdivide', 'deform', 'simplify', 'splitSolid', 'intersect', 'weld', 'symmetry', 'arrayGrid', 'arrayPath', 'axes', 'import2d', 'curvesToFaces', 'imprint', 'offsetFace', 'moveElements', 'repair', 'Parametric', 'sweep', 'liveArray', 'bake', 'Recipes', 'recordMacro', 'saveRecipe', 'library'],
      Animate: ['timeline', 'play', '-', 'keySel', 'keyCam', 'autoKey', '-', 'sequence', 'turntable', 'scenesAnim', 'explode', 'alongPath', 'stagger', 'motion', '-', 'marker', 'caption', 'Depth', 'saveClip', 'applyClip', 'physics', 'addShot', 'addAudio', 'sectionReveal', 'attach', 'lookAt', 'retime', 'schedule', '-', 'clearAnim', 'exportVideo'],
      Site: ['survey', 'importPoints', 'exportPoints', 'importTerrain', 'groundFromCloud', '-', 'Surfaces', 'contours', 'analyze', 'profile', 'sections', 'smooth', 'fromContours', 'contourZ', '-', 'Design', 'pad', 'stamp', 'newTerrain', 'tool:sculpt', 'drape', 'drapeImage', 'water', '-', 'addPoint', 'tool:point', '-', 'breakline', 'boundary', 'surface', 'checkSurface', '-', 'cutFill', 'volumeReport', '-', 'alignment', 'corridor', 'Field designs', 'trench', 'lineSlope', 'plane', 'offsetSurface', 'road', '-', 'featureCode', 'loadLibrary', 'processCodes', '-', 'coordSys', 'basePoint', 'units'],
      Drawings: ['importPdf', 'importImage', 'readDrawing', 'vectorise', 'snapDrawings', '-', 'Place', 'tool:calibrate', 'drawingScale', 'tool:control', 'georef', 'georefReport', 'worldFile', '-', 'From the PDF', 'pdfStats', 'extract', 'drawingText', 'textToPoints', 'labelContours', '-', 'Drafting', 'tool:trim', 'tool:extend', 'offset', 'fillet', 'chamfer', 'joinCurves', 'explode', 'simplify', 'divide', '-', 'To the model', 'elevate', 'toBreaklines', 'extrudeLines', 'sweepLines', '-', 'Layers', 'newLayer', 'mapLayers', 'layerState', 'restoreLayerState'],
      AI: ['askAi', 'newChat', '-', 'review', 'proposeToggle', 'proposeAccept', 'proposeReject', '-', 'mcp', 'aiSettings'],
      Help: ['howto', 'tour', 'shortcuts', 'mcp', '-', 'checkUpdates', 'restartUpdate', '-', 'about'],
    };
    const bar = this.$('menubar');
    for (const name of Object.keys(this.menus)) {
      const b = h('button', { 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => this.openMenu(name, b), onmouseenter: () => this.openName && this.openName !== name && this.openMenu(name, b) }, t(name));
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
        if (!a) return h('div.overline', {}, t(id));
        const on = a.checked?.();
        return h('button', { role: 'menuitem', onclick: () => (this.closeMenu(), a.run()) }, on ? icon('check') : icon(a.icon || 'dot-outline'), t(a.label), a.key ? h('span.key', {}, a.key) : null);
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
      const b = iconBtn(t.icon, `${tr(t.label)}${t.key ? ` (${t.key})` : ''}`, () => this.app.tools.set(t.id), false);
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
      ['survey', 'Survey', 'map-pin'],
      ['settings', 'Settings', 'gear'],
      ['help', 'Help', 'question'],
    ];
    this.$('dock-tabs').replaceChildren(
      ...this.tabs.map(([id, label, ic]) => h('button', { role: 'tab', 'aria-selected': String(id === this.tab), onclick: () => this.show(id), dataset: { tab: id }, 'aria-label': t(label) }, icon(ic), t(label))),
    );
  }
  show(tab, focus = false) {
    this.tab = tab;
    for (const b of this.$('dock-tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    this.renderDock();
    if (focus && tab === 'ai') this.app.ai.focus();
  }
  panel_help() {
    return this.app.help.panel();
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
            icon(e.component ? 'squares-four' : e.type === 'group' ? 'folder-simple' : e.curve ? 'bezier-curve' : e.underlay ? (e.underlay.kind === 'pdf' ? 'file-pdf' : 'image') : e.type === 'point' ? 'map-pin' : 'cube'),
            e.mesh || e.curve ? h('span.swatch-dot', { style: { background: L.colorOf(doc, e) } }) : null,
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
      h('div.row', {}, h('div.overline.grow', {}, 'Layers'), h('button.icon-btn.sm', { title: 'New layer', 'aria-label': 'New layer', onclick: () => this.actions.newLayer.run() }, icon('plus'))),
      h('div.tree', {}, this.layerRows(doc, run)),
      h('label.row.small', {}, h('input', { type: 'checkbox', checked: doc.settings.color_by === 'layer', onchange: (ev) => run('set_style', { color_by: ev.target.checked ? 'layer' : 'material' }) }), 'Colour by layer'),
      h('div.row', {}, h('div.overline.grow', {}, 'Selection sets'), h('button.icon-btn.sm', { title: 'Save the selection as a set', 'aria-label': 'Save the selection as a set', onclick: () => this.actions.saveSelection.run() }, icon('plus'))),
      Object.keys(doc.selection_sets || {}).length
        ? h('div.chips', {}, ...Object.entries(doc.selection_sets).map(([name, ids]) => h('span.chip', {}, h('button.chip-main', { title: `Select ${ids.length}`, onclick: () => run('select_set', { name }) }, `${name} · ${ids.length}`), h('button.chip-x', { title: 'Forget this set', 'aria-label': `Forget ${name}`, onclick: () => run('delete_selection_set', { name }) }, icon('x')))))
        : h('p.muted.small', {}, 'Select things and press + to name the selection.'),
    );
  }

  /** One row per layer, indented under "/" groups: colour, name, count, current, lock, visibility. */
  layerRows(doc, run) {
    const cur = doc.settings.current_layer || 'Untagged';
    const counts = new Map();
    for (const e of doc.entities) if (e.type !== 'group') counts.set(e.tag, (counts.get(e.tag) || 0) + 1);
    let folder = null;
    return [...doc.tags]
      .sort((a, b) => (a.name === 'Untagged' ? -1 : b.name === 'Untagged' ? 1 : (a.folder || '').localeCompare(b.folder || '') || a.name.localeCompare(b.name)))
      .flatMap((t) => {
        const head = (t.folder || null) !== folder && t.folder ? h('div.tree-row.layer-folder', {}, icon('folder-simple'), h('span.name', {}, t.folder)) : null;
        folder = t.folder || null;
        const depth = t.name.split('/').length - 1 + (t.folder ? 1 : 0);
        const leaf = t.name.split('/').pop();
        const isCur = t.name === cur;
        const row = h(
          'div.tree-row.layer-row',
          { style: { paddingLeft: `${4 + depth * 14}px` }, title: t.description || t.name },
          h('input.layer-swatch', { type: 'color', value: t.color || '#d9d4c7', 'aria-label': `Colour of layer ${t.name}`, onchange: (ev) => run('set_layer', { name: t.name, color: ev.target.value }) }),
          h('span.name', {}, leaf),
          h('span.muted.small', {}, counts.get(t.name) || 0),
          h('button.icon-btn.sm', { title: isCur ? 'Current layer: new geometry goes here' : 'Make current', 'aria-label': isCur ? `${t.name} is the current layer` : `Make ${t.name} current`, 'aria-pressed': String(isCur), onclick: () => run('set_layer', { name: t.name, current: true }) }, icon(isCur ? 'check-circle' : 'circle')),
          h('button.icon-btn.sm', { title: 'Attribute table', 'aria-label': `Attribute table of ${t.name}`, onclick: () => this.attributeTable(t.name) }, icon('table')),
          h('button.icon-btn.sm', { title: t.locked ? 'Unlock layer' : 'Lock layer', 'aria-label': t.locked ? `Unlock ${t.name}` : `Lock ${t.name}`, onclick: () => run('set_layer', { name: t.name, locked: !t.locked }) }, icon(t.locked ? 'lock-simple' : 'lock-simple-open')),
          h('button.icon-btn.sm', { title: t.visible ? 'Hide layer' : 'Show layer', 'aria-label': t.visible ? `Hide ${t.name}` : `Show ${t.name}`, onclick: () => run('set_layer', { name: t.name, visible: !t.visible }) }, icon(t.visible ? 'eye' : 'eye-slash')),
        );
        return head ? [head, row] : [row];
      });
  }

  /** The control pairs and residuals of a georeferenced drawing. */
  async georefDialog(id) {
    const app = this.app;
    try {
      const r = await app.reg.run('georef_report', { id });
      const e = app.entity(id);
      const rows = (e.underlay.control || []).map((c, i) => {
        const res = r.pairs?.find((p) => p.name === c.name);
        return h('tr', {}, h('td', {}, c.name), h('td', {}, `${c.n.toFixed(3)}`), h('td', {}, `${c.e.toFixed(3)}`), h('td', {}, res ? fmt(res.d) : '–'), h('td', {}, res?.flag ? h('span.param-error', {}, 'worst') : ''), h('td', {}, h('button.btn', { onclick: async () => (await app.reg.run('edit_control_pair', { id, pair: i, enabled: !c.enabled }), await app.reg.run('georeference_underlay', { id }).catch(() => {}), this.georefDialog(id)) }, c.enabled ? 'Turn off' : 'Turn on')));
      });
      this.modal(`Georeference · ${e.name}`, h('div', {}, h('p.small', {}, r.rms !== undefined ? `${r.method}: RMS ${fmt(r.rms)} · ${r.metres_per_unit.map((x) => x.toFixed(4)).join(' × ')} m per unit · turned ${(Math.abs(r.rotation) < 0.005 ? 0 : r.rotation).toFixed(2)}°` : `${r.pairs} control pair(s). Add 2 or more with the Control points tool (J).`), rows.length ? h('div.qty', {}, h('table', {}, h('thead', {}, h('tr', {}, ...['Pair', 'N', 'E', 'Residual', '', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))) : null));
    } catch (err) {
      this.toast(err.message, 'danger');
    }
  }

  /** The start screen (#109): templates to begin from, the tour, open a file. */
  async startScreen() {
    const app = this.app;
    const list = await app.reg.run('list_templates', {});
    const ICON = { empty: 'file', 'empty-feet': 'ruler', house: 'house-line', product: 'film-strip', site: 'mountains', sequence: 'stack' };
    const start = (id) => {
      this.closeModal();
      app.reg.run('new_from_template', { id }).then(() => (app.viewport.zoomExtents(), id === 'product' || id === 'sequence' ? this.toast('Press Play (Shift+Space), or File › Export video.') : null)).catch((e) => this.toast(e.message, 'danger'));
    };
    const first = !localStorage.getItem('mymodellerreel.onboarded');
    localStorage.setItem('mymodellerreel.onboarded', '1');
    this.modal(
      first ? 'Welcome to MyModellerReel' : 'Start from a template',
      h(
        'div.start',
        {},
        h('p.small.muted', {}, 'Model, survey, draw and animate; ask the copilot in plain words. Pick a starting point:'),
        h('div.start-grid', {}, list.map((t) => h('button.start-card', { onclick: () => start(t.id) }, icon(ICON[t.id] || 'cube'), h('strong', {}, t.name), h('span.small.muted', {}, t.description)))),
        h('div.row.wrap', {}, h('button.btn', { onclick: () => (this.closeModal(), this.tour()) }, icon('compass'), 'Take the 2-minute tour'), h('button.btn', { onclick: () => (this.closeModal(), this.actions.open.run()) }, icon('folder-open'), 'Open a file…'), h('button.btn', { onclick: () => (this.closeModal(), this.actions.import.run()) }, icon('tray-arrow-down'), 'Import LandXML, IFC, DXF…')),
      ),
      [['Start empty', null]],
    );
  }

  /** The guided tour (#109): a highlight and a card per step, Back / Next / Skip, Esc to leave. */
  tour(i = 0) {
    const STEPS = [
      ['#viewport', 'The model', 'Orbit with the middle mouse, pan with the right, zoom with the wheel. Z drags a zoom window; Shift+Z fits everything.'],
      ['#toolbar', 'Tools', 'Draw (L, R, C, A…), push / pull (P), move (M), rotate (Q), measure (T). Hover a tool to see its key. While a tool works, type numbers: they go to the Measurements box.'],
      ['#vcb', 'Measurements box', 'Type exact values while drawing or moving: 2.5, 3,2, 150mm, 45°, x5 for five copies.'],
      ['#menubar', 'Menus', 'Everything has a menu entry: Site for survey and terrain, Drawings for PDFs and images, Animate for the timeline and videos.'],
      ['#palette-btn', 'Search (Ctrl+K)', 'Find any command by what you want to do ("hinge a door"), or ask the AI from here.'],
      ['#dock-tabs', 'Panels', 'AI chat, Outliner and layers, the selected entity, materials, scenes, the library, the survey table, settings.'],
      ['#timeline', 'Timeline', 'Keyframes, markers and captions; Animate › Render video turns it into an MP4.'],
      ['#api-pill', 'Automation', 'Every button is a command: scripts, the HTTP API and MCP (Claude and other AIs) drive the same ones.'],
    ];
    document.querySelector('.tour')?.remove();
    if (i >= STEPS.length) return;
    const [sel, title, text] = STEPS[i];
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    const hl = h('div.tour-hl', { style: r ? { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` } : {} });
    const next = h('button.btn.primary', { onclick: () => this.tour(i + 1) }, i === STEPS.length - 1 ? 'Done' : 'Next');
    const card = h(
      'div.tour-card',
      { role: 'dialog', 'aria-label': title },
      h('div.overline', {}, `${i + 1} / ${STEPS.length}`),
      h('h3', {}, title),
      h('p.small', {}, text),
      h('div.row', {}, i ? h('button.btn', { onclick: () => this.tour(i - 1) }, 'Back') : null, h('span.grow'), h('button.btn', { onclick: () => this.tour(STEPS.length) }, 'Skip'), next),
    );
    const wrap = h('div.tour', { onkeydown: (ev) => ev.key === 'Escape' && this.tour(STEPS.length) }, hl, card);
    document.body.append(wrap);
    // the card sits beside the highlight, inside the window
    const cw = 320;
    const left = r ? (r.right + cw + 24 < innerWidth ? r.right + 16 : Math.max(16, r.left - cw - 16)) : innerWidth / 2 - cw / 2;
    const top = r ? Math.min(Math.max(16, r.top), innerHeight - 220) : innerHeight / 3;
    Object.assign(card.style, { left: `${Math.min(left, innerWidth - cw - 16)}px`, top: `${top}px` });
    next.focus();
  }

  /** What an import brought in, what it skipped and why. */
  importReport(r) {
    const rows = Object.entries(r.created).map(([k, v]) => h('tr', {}, h('td', {}, k.replace(/_/g, ' ')), h('td', {}, String(v))));
    this.modal(
      `Imported ${r.file || r.format.toUpperCase()}`,
      h(
        'div',
        {},
        h('div.qty', {}, h('table', {}, h('tbody', {}, rows))),
        r.layers?.length ? h('p.small', {}, `Layers: ${r.layers.join(', ')}`) : null,
        r.skipped?.length ? h('div', {}, h('div.overline', {}, 'Skipped'), ...r.skipped.map((s) => h('div.small', {}, `${s.what} (${s.count})`))) : null,
        r.warnings?.length ? h('div', {}, h('div.overline', {}, 'Warnings'), ...r.warnings.map((w) => h('div.small.param-error', {}, w))) : null,
      ),
    );
  }

  /** A feature layer's attribute table: one row per feature, a column per attribute; edit in place, sort, filter. */
  attributeTable(layer, sortBy = 'name', filter = '') {
    const app = this.app;
    const doc = app.store.doc;
    const t = doc.tags.find((x) => x.name === layer);
    const feats = doc.entities.filter((e) => e.tag === layer && !e.parent);
    // survey points show their code and coordinates too
    const pts = feats.some((e) => e.point) ? ['code', 'N', 'E', 'Z'] : [];
    const cols = [...pts, ...new Set([...Object.keys(t?.schema || {}), ...feats.flatMap((e) => Object.keys(e.meta || {}))])].filter((c) => c !== 'name'); // the name is the first column already
    const PT = { code: (e) => e.point?.code, N: (e) => e.point?.n, E: (e) => e.point?.e, Z: (e) => e.point?.z };
    const val = (e, c) => (c === 'name' ? e.name : PT[c] && pts.length ? PT[c](e) : e.meta?.[c]);
    const rows = feats
      .filter((e) => !filter || [e.name, ...cols.map((c) => e.meta?.[c])].some((v) => String(v ?? '').toLowerCase().includes(filter.toLowerCase())))
      .sort((a, b) => String(val(a, sortBy) ?? '').localeCompare(String(val(b, sortBy) ?? ''), undefined, { numeric: true }));
    const cell = (e, c) => {
      if (PT[c] && pts.length) {
        if (!e.point) return '';
        if (c === 'code') return h('input.cell', { value: e.point.code, 'aria-label': `Code of ${e.name}`, onchange: (ev) => app.reg.run('edit_points', { points: [e.id], code: ev.target.value }).catch((err) => this.toast(err.message, 'danger')) });
        return h('span.small', {}, PT[c](e).toFixed(3));
      }
      const f = t?.schema?.[c];
      const v = e.meta?.[c];
      const put = (x) => app.reg.run('edit_attributes', { ids: [e.id], values: { [c]: x } }).catch((err) => this.toast(err.message, 'danger'));
      if (f?.type === 'boolean') return h('input', { type: 'checkbox', checked: !!v, 'aria-label': `${c} of ${e.name}`, onchange: (ev) => put(ev.target.checked) });
      if (f?.options) return h('select.cell', { 'aria-label': `${c} of ${e.name}`, onchange: (ev) => put(ev.target.value) }, ['', ...f.options].map((o) => h('option', { value: o, selected: o === v }, o)));
      return h('input.cell', { value: v ?? '', 'aria-label': `${c} of ${e.name}`, onchange: (ev) => put(f?.type === 'number' || typeof v === 'number' ? +ev.target.value : ev.target.value) });
    };
    const box = h('input', { type: 'search', placeholder: 'Filter', value: filter, 'aria-label': 'Filter features', onchange: (ev) => (this.closeModal?.(), this.attributeTable(layer, sortBy, ev.target.value)) });
    this.modal(
      `${layer} · ${rows.length} of ${feats.length} features`,
      h(
        'div',
        {},
        h('div.row', {}, box, h('button.btn', { onclick: () => app.select(rows.map((e) => e.id)) }, icon('cursor'), 'Select these')),
        h('div.qty.attr', {}, h('table', {}, h('thead', {}, h('tr', {}, ...['name', ...cols].map((c) => h('th', { onclick: () => (this.closeModal?.(), this.attributeTable(layer, c, filter)), title: 'Sort', style: { cursor: 'pointer' } }, c + (c === sortBy ? ' ▲' : ''))))), h('tbody', {}, rows.slice(0, 500).map((e) => h('tr', {}, h('td', {}, e.name), ...cols.map((c) => h('td', {}, cell(e, c)))))))),
      ),
    );
  }

  /** An analysis legend (#121) under a coloured surface. */
  legend(e) {
    const a = e.analysis;
    if (!a?.legend) return null;
    return h('div.legend', {}, h('div.small.muted', {}, a.kind), ...a.legend.map((l) => h('div.legend-row', {}, h('i', { style: { background: l.color } }), h('span.small', {}, l.label))));
  }

  /** A long section chart (#122): chainage across, elevation up, one line per surface; save as SVG. */
  profileDialog(r) {
    const W = 760;
    const H = 300;
    const pad = 44;
    const vals = r.samples.flatMap((s) => r.surfaces.map((n) => s[n])).filter((v) => v !== null);
    if (!vals.length) return this.toast('The line does not cross a surface.', 'danger');
    const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
    const span = hi - lo || 1;
    const X = (s) => pad + ((W - pad * 1.5) * s) / (r.length || 1);
    const Y = (z) => H - pad - ((H - pad * 1.6) * (z - lo)) / span;
    const COLORS = ['#2f6f86', '#c8553d', '#4c7a5a', '#8a4b3a'];
    const ns = 'http://www.w3.org/2000/svg';
    const el = (n, attrs, text) => {
      const x = document.createElementNS(ns, n);
      for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
      if (text !== undefined) x.textContent = text;
      return x;
    };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `Profile, ${r.length.toFixed(1)} m` });
    svg.append(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));
    for (let k = 0; k <= 4; k++) {
      const z = lo + (span * k) / 4;
      svg.append(el('line', { x1: pad, x2: W - pad / 2, y1: Y(z), y2: Y(z), stroke: '#e3e0d8' }), el('text', { x: 4, y: Y(z) + 4, 'font-size': 11, fill: '#5f6b72' }, z.toFixed(2)));
    }
    const step = Math.pow(10, Math.floor(Math.log10(r.length / 5 || 1)));
    for (let s = 0; s <= r.length + 1e-9; s += step * (r.length / step > 10 ? 2 : 1)) svg.append(el('text', { x: X(s) - 10, y: H - pad + 18, 'font-size': 11, fill: '#5f6b72' }, s.toFixed(0)));
    r.surfaces.forEach((n, i) => {
      const d = r.samples.filter((s) => s[n] !== null).map((s, k) => `${k ? 'L' : 'M'}${X(s.chainage).toFixed(1)},${Y(s[n]).toFixed(1)}`).join(' ');
      svg.append(el('path', { d, fill: 'none', stroke: COLORS[i % 4], 'stroke-width': 2 }), el('text', { x: W - 150, y: 18 + i * 16, 'font-size': 12, fill: COLORS[i % 4] }, n));
    });
    const save = async () => {
      const path = await window.native.invoke('file:save-dialog', { defaultPath: 'Profile.svg', filters: [{ name: 'SVG', extensions: ['svg'] }] });
      if (path) await this.app.io.writeText(path, new XMLSerializer().serializeToString(svg));
    };
    this.modal(`Profile · ${r.length.toFixed(1)} m`, h('div', {}, svg, h('p.small.muted', {}, 'Chainage (m) across, elevation up. surface_profile returns the numbers; csv saves them.')), [['Close', null]]).then(() => {});
    document.querySelector('#modal footer')?.prepend(h('button.btn', { onclick: save }, icon('export'), 'Save SVG'));
  }

  /** Cross-sections (#122): one at a time, Previous / Next. */
  /** What read_drawing found, with Apply. */
  async readDrawingDialog(id, r) {
    const rows = [['Scale', r.scale ? `1:${r.scale.ratio}` : '—'], ['Title', r.title || '—'], ['Date', r.date || '—'], ['North', r.north_angle !== undefined ? `${r.north_angle}°` : r.north ? 'a north mark' : '—'], ['Grid crossings', r.control.length ? r.control.map((c) => `E ${c.e} N ${c.n}`).join(' · ') : '—'], ['Read by', r.ai ? 'the text and the copilot' : r.ai_error ? `the text (copilot: ${r.ai_error})` : 'the text']];
    const body = h('div', {}, ...rows.map(([k, v]) => h('div.legend-row', {}, h('strong', {}, `${k}: `), h('span', {}, v))));
    if ((await this.modal('What the drawing says', body, [['Apply', 'ok'], ['Close', null]])) === 'ok') this.app.reg.run('read_drawing', { id, use_ai: false, apply: true }).then((x) => this.toast(x.applied.join(', ') || 'Nothing to apply.')).catch((e) => this.toast(e.message, 'danger'));
  }
  /** Poly Haven: search and bring one in. */
  assetsDialog() {
    const app = this.app;
    const q = h('input', { placeholder: 'brick, oak, chair, sky…', value: '' });
    const type = h('select', {}, ['models', 'textures', 'hdris'].map((v) => h('option', { value: v }, v)));
    const list = h('div.asset-results', {}, h('p.small.muted', {}, 'Free CC0 assets from Poly Haven: models, textures (onto the selection) and HDRI skies.'));
    const go = () => {
      list.replaceChildren(h('p.small.muted', {}, 'Searching…'));
      app.reg.run('search_assets', { query: q.value, type: type.value }).then((r) => list.replaceChildren(...(r.length ? r.map((x) => h('div.legend-row', {}, h('span.grow', {}, `${x.name} `, h('span.small.muted', {}, x.categories.slice(0, 3).join(', '))), h('button.btn.sm', { onclick: () => (this.closeModal(), app.reg.run('import_asset', { id: x.id, type: type.value }).then(() => this.toast(`${x.name} imported (CC0)`)).catch((e) => this.toast(e.message, 'danger'))) }, 'Import'))) : [h('p.small.muted', {}, 'Nothing found.')]))).catch((e) => list.replaceChildren(h('p.small', {}, e.message)));
    };
    q.onkeydown = (e) => e.key === 'Enter' && go();
    this.modal('Free assets', h('div', {}, h('div.row', {}, q, type, h('button.btn.primary.sm', { onclick: go }, 'Search')), list));
  }
  /** Versions saved in the file: save, restore, compare. */
  async versionsDialog() {
    const app = this.app;
    const vs = await app.reg.run('list_versions', {});
    const rows = vs.map((v) => h('div.legend-row', {}, h('span.grow', {}, `${v.name} `, h('span.small.muted', {}, `${new Date(v.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${v.entities} shapes`)), h('button.btn.sm', { onclick: () => app.reg.run('compare_versions', { from: v.name }).then((d) => this.infoDialog(`${v.name} → now`, `Added: ${d.added.join(', ') || '—'}\nChanged: ${d.changed.join(', ') || '—'}\nRemoved: ${d.removed.join(', ') || '—'}`)) }, 'Compare'), h('button.btn.sm', { onclick: () => (this.closeModal(), app.reg.run('restore_version', { name: v.name })) }, 'Restore')));
    const name = h('input', { placeholder: 'Version name', value: `Version ${vs.length + 1}` });
    this.modal('Versions', h('div', {}, h('div.row', {}, name, h('button.btn.primary.sm', { onclick: () => (this.closeModal(), app.reg.run('save_version', { name: name.value }).then(() => this.toast(`Saved "${name.value}"`))) }, 'Save this version')), ...(rows.length ? rows : [h('p.small.muted', {}, 'No versions yet.')])));
  }
  /** A picture (data URL) in a dialog: AI renders. */
  imagePreview(title, src) {
    this.modal(title, h('img.svg-preview', { src, alt: title }));
  }
  /** A picture of an exported sheet or section, so you see what you saved. */
  svgPreview(title, svg) {
    this.modal(title, h('img.svg-preview', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: title }));
  }
  clashDialog(r) {
    const app = this.app;
    if (!r.count) return this.toast('No clashes.');
    const rows = r.clashes.map((c) => h('div.legend-row', {}, h('span', {}, `${c.names[0]} × ${c.names[1]}: ${(c.volume * 1000).toFixed(1)} L, ${(c.depth * 100).toFixed(1)} cm deep`), h('button.btn.sm', { onclick: () => app.reg.run('select', { ids: c.ids }).then(() => app.reg.run('zoom_extents', { ids: c.ids }).catch(() => {})) }, 'Show')));
    this.modal(`${r.count} clash${r.count > 1 ? 'es' : ''}`, h('div', {}, ...rows));
  }
  sectionsDialog(r, i = 0) {
    const x = r.sections[i];
    const prof = { length: x.points.at(-1).offset - x.points[0].offset, surfaces: r.surfaces, samples: x.points.map((q) => ({ ...q, chainage: q.offset - x.points[0].offset })) };
    this.closeModal();
    this.profileDialog(prof);
    const head = document.querySelector('#modal h3');
    if (head) head.textContent = `Cross-section at ${x.station.toFixed(1)} m (${i + 1} / ${r.sections.length}) · left to right`;
    const foot = document.querySelector('#modal footer');
    foot?.prepend(h('button.btn', { disabled: i === 0, onclick: () => this.sectionsDialog(r, i - 1) }, 'Previous'), h('button.btn', { disabled: i === r.sections.length - 1, onclick: () => this.sectionsDialog(r, i + 1) }, 'Next'));
  }

  /** A read-only result in a dialog (counts, text lists). */
  infoDialog(title, data) {
    this.modal(title, h('pre.small.info-pre', {}, typeof data === 'string' ? data : JSON.stringify(data, null, 1)));
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
      h('label.field', {}, h('span', {}, `Name · ${e.id} · ${e.type === 'group' ? 'group' : e.curve ? `${e.curve.kind} curve` : e.underlay ? `${e.underlay.kind} drawing` : e.mesh ? `${e.mesh.f.length} faces` : e.type}`), h('input', { value: e.name, onchange: (ev) => run('set_properties', { ids: [e.id], name: ev.target.value }) })),
      h('label.field', {}, h('span', {}, 'Tag'), h('input', { value: e.tag, list: 'tag-list', onchange: (ev) => run('set_properties', { ids: [e.id], tag: ev.target.value || 'Untagged' }) }), h('datalist', { id: 'tag-list' }, doc.tags.map((t) => h('option', { value: t.name })))),
      h('div.card', {}, h('div.overline', {}, 'Transform (relative to parent; Y is up)'), xyz('Position', 'position', 0.1), xyz('Rotation°', 'rotation', 5), xyz('Scale', 'scale', 0.1), h('div.small.muted', {}, `Size ${size.map(fmt).join(' × ')}`)),
      e.underlay
        ? null
        : h(
        'div.row.wrap',
        {},
        h('span.small.muted', {}, 'Pivot'),
        ...['left', 'right', 'center', 'bottom', 'top'].map((p) => h('button.btn', { onclick: () => run('set_pivot', { id: e.id, pivot: p }) }, p)),
      ),
      this.paramsCard(e),
      e.analysis && !e.derived?.report ? h('div.card', {}, h('div.overline', {}, 'Analysis'), this.legend(e)) : null,
      e.underlay ? null : matFields,
      this.metaCard(e),
      tracks.length ? h('div.card', {}, h('div.overline', {}, 'Animation'), ...tracks.map((t) => h('div.small', {}, `${t.property}: ${t.keys.length} keys, ${t.keys[0].t}s → ${t.keys.at(-1).t}s`))) : null,
      actions,
    );
  }

  /** A parametric shape's parameters (#42, #134) or a curve's settings, edited in place. */
  paramsCard(e) {
    const app = this.app;
    const run = (n, a) => app.reg.run(n, a).catch((x) => this.toast(x.message, 'danger'));
    if (e.point) {
      const p = e.point;
      const put = (k) => (ev) => run('edit_points', { points: [e.id], [k]: k === 'code' || k === 'desc' ? ev.target.value : +ev.target.value });
      return h(
        'div.card',
        {},
        h('div.overline', {}, 'Survey point'),
        ...[['n', 'Northing'], ['e', 'Easting'], ['z', 'Elevation']].map(([k, l]) => h('label.row.small.param-row', {}, h('span', {}, l), h('input.grow', { type: 'number', step: 'any', value: p[k].toFixed(4), onchange: put(k) }))),
        h('label.row.small.param-row', {}, h('span', {}, 'Code'), h('input.grow', { value: p.code, list: 'code-list', onchange: put('code') }), h('datalist', { id: 'code-list' }, Object.keys(app.store.doc.featureCodes || {}).map((c) => h('option', { value: c })))),
        h('label.row.small.param-row', {}, h('span', {}, 'Description'), h('input.grow', { value: p.desc || '', onchange: put('desc') })),
      );
    }
    if (e.underlay) {
      const u = e.underlay;
      const slider = (k, label) => h('label.row.small', {}, h('span', { style: { width: '64px' } }, label), h('input.grow', { type: 'range', min: 0, max: 1, step: 0.05, value: u[k] ?? 0, 'aria-label': label, onchange: (ev) => run('set_underlay', { id: e.id, [k]: +ev.target.value }) }));
      const [a, , , d] = u.affine;
      return h(
        'div.card',
        {},
        h('div.overline', {}, `${u.kind === 'pdf' ? `PDF page ${u.page}` : 'Image'} · ${(Math.hypot(a, d) * 1000).toFixed(2)} mm per ${u.kind === 'pdf' ? 'point' : 'pixel'}${u.georef ? ` · ${u.georef.method}${u.georef.rms ? ` RMS ${fmt(u.georef.rms)}` : ''}` : ''}`),
        slider('opacity', 'Opacity'),
        slider('fade', 'Fade'),
        h('label.row.small', {}, h('input', { type: 'checkbox', checked: !!u.mono, onchange: (ev) => run('set_underlay', { id: e.id, mono: ev.target.checked }) }), 'Black and white'),
        h('div.row.wrap', {}, h('button.btn', { onclick: () => app.tools.set('calibrate') }, icon('ruler'), 'Calibrate'), h('button.btn', { onclick: () => app.tools.set('control') }, icon('crosshair'), `Control points (${u.control.length})`), u.control.length ? h('button.btn', { onclick: () => this.georefDialog(e.id) }, icon('list-checks'), 'Report') : null),
        u.kind === 'pdf' ? h('div.row.wrap', {}, h('button.btn', { onclick: () => this.commandDialog('extract_linework', { id: e.id }) }, icon('path'), 'Extract linework…'), h('button.btn', { onclick: () => this.actions.pdfStats.run() }, icon('info'), 'Contents')) : null,
        u.clip ? h('button.btn', { onclick: () => run('set_underlay', { id: e.id, clip: 'none' }) }, icon('crop'), 'Remove crop') : null,
      );
    }
    if (e.line)
      return h(
        'div.card',
        {},
        h('div.overline', {}, `${e.line.kind}${e.line.boundary ? ` · ${e.line.boundary}` : ''} · ${e.line.points.length} points`),
        h('div.row.wrap', {}, h('button.btn', { onclick: () => run('edit_linework', { id: e.id, action: 'reverse' }) }, icon('arrows-left-right'), 'Reverse'), h('button.btn', { onclick: () => run('edit_linework', { id: e.id, action: 'smooth', smooth: !e.line.smooth }) }, icon('bezier-curve'), e.line.smooth ? 'Straight' : 'Smooth')),
      );
    if (e.derived?.report && e.mesh) {
      const tri = e.mesh.f.length;
      return h(
        'div.card',
        {},
        h('div.overline', {}, `Surface · ${tri} triangles · ${e.derived.report.points} points`),
        this.legend(e),
        e.derived.error ? h('div.small.param-error', { role: 'alert' }, e.derived.error) : null,
        h('div.row.wrap', {}, h('button.btn', { onclick: () => this.checkSurfaceDialog(e.id) }, icon('list-checks'), 'Check'), h('button.btn', { onclick: () => this.commandDialog('cut_fill', { existing: e.id }) }, icon('chart-bar'), 'Cut / fill…')),
      );
    }
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
    // the component library (#45): click to place at the view's centre, or drag into the view
    const assets = h('div.assets', {}, h('p.muted.small', {}, 'Loading…'));
    app.io.listLibrary().then((list) => {
      assets.replaceChildren(
        ...(list.length ? list : []).map((f) => {
          const img = h('img', { alt: '' });
          app.io.libraryThumb(f.name).then((src) => (img.src = src)).catch(() => {});
          const place = (position) => run('insert_asset', { name: f.name, position });
          return h('button.asset', { title: `${f.name}: click to place, or drag into the view`, draggable: true, ondragstart: (e) => e.dataTransfer.setData('text/x-mmr-asset', f.name), onclick: () => place(app.viewport.controls.target.toArray().map((x, k) => (k === 1 ? 0 : Math.round(x * 100) / 100))) }, img, h('span', {}, f.name.replace(/\.\w+$/, '')));
        }),
        ...(list.length ? [] : [h('p.muted.small', {}, 'Put GLB or glTF files in the library folder.')]),
      );
    });
    return h(
      'div.panel',
      {},
      h('h3', {}, 'Components'),
      assets,
      h('div.row', {}, h('button.btn.sm', { onclick: () => window.native.invoke('shell:open-path', 'library') }, icon('folder-open'), 'Library folder'), h('button.btn.sm', { onclick: () => ((app.io.thumbs = null), this.renderDock()) }, icon('arrows-clockwise'), 'Refresh')),
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
      h('h3', {}, 'Image model (AI render, AI textures)'),
      h('label.field', {}, h('span', {}, 'Provider'), h('select', { onchange: (e) => save({ ai: { image: { provider: e.target.value } } }) }, [['comfyui', 'ComfyUI on this PC (Stable Diffusion, Flux…)'], ['openai', 'OpenAI-compatible images API']].map(([v, l]) => h('option', { value: v, selected: v === ai.image.provider }, l)))),
      ...(ai.image.provider === 'openai'
        ? [field('Base URL', ai.image.openai.baseUrl, (e) => save({ ai: { image: { openai: { baseUrl: e.target.value } } } })), field('Model', ai.image.openai.model, (e) => save({ ai: { image: { openai: { model: e.target.value } } } })), field(`API key ${ai.image.openai.hasKey ? '(saved; type to replace)' : ''}`, '', (e) => save({ ai: { image: { openai: { apiKey: e.target.value } } } }), { type: 'password' })]
        : [field('ComfyUI URL', ai.image.comfyui.baseUrl, (e) => save({ ai: { image: { comfyui: { baseUrl: e.target.value } } } })), field('Checkpoint (a model file in ComfyUI/models/checkpoints)', ai.image.comfyui.checkpoint, (e) => save({ ai: { image: { comfyui: { checkpoint: e.target.value } } } }), { placeholder: 'sd_xl_base_1.0.safetensors' })]),
      h('h3', {}, 'API and MCP'),
      h('p.small', {}, `Local HTTP API on 127.0.0.1:${app.info.apiPort}. Claude Desktop (or any MCP client) connects through the MCP server and can use every command.`),
      h('div.row', {}, h('button.btn.primary', { onclick: () => this.mcpDialog() }, icon('plugs-connected'), 'Connect Claude Desktop…'), h('button.btn', { onclick: () => window.native.invoke('shell:open-path', 'data') }, icon('folder-open'), 'Data folder')),
      h('h3', {}, t('Language')),
      h('label.field', {}, h('span', {}, `${t('Language')} (menus and panels)`), h('select', { onchange: (e) => app.reg.run('set_language', { lang: e.target.value }) }, Object.entries(LANGUAGES).map(([v, l]) => h('option', { value: v, selected: v === (s.language || 'en') }, l)))),
      h('h3', {}, t('Keyboard shortcuts')),
      h('p.small.muted', {}, Object.keys(s.shortcuts || {}).length ? Object.entries(s.shortcuts).map(([k, v]) => `${k} → ${v}`).join(' · ') : 'None of your own yet.'),
      h('div.row', {}, h('button.btn.sm', { onclick: () => this.commandDialog('set_shortcut', { key: 'Ctrl+Shift+F', action: 'filletEdges' }) }, icon('keyboard'), 'Add a shortcut…')),
      h('h3', {}, t('Appearance')),
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
  closeModal() {
    const d = this.$('modal');
    if (d.open) d.close();
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
  async reviewDialog(opts = {}) {
    const app = this.app;
    const list = h('div.review-list', {}, h('p.muted', {}, 'Checking…'));
    const critique = h('div.review-critique');
    const done = this.modal('Review', h('div.panel', { style: { padding: 0 } }, list, critique), [['Ask the AI to fix them', 'fix'], ['Close', null]]);
    let r;
    try {
      r = await app.reg.run('review_model', opts);
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

  /** Import points: a file, its column order and units. */
  async importPointsDialog() {
    const path = await window.native.invoke('file:open-dialog', { filters: [{ name: 'Points', extensions: ['csv', 'txt', 'xyz', 'pnezd'] }] });
    if (path) this.commandDialog('import_points', { path, format: 'PNEZD' });
  }

  /** Surface checks (#130) with one-click fixes. */
  async checkSurfaceDialog(id) {
    const app = this.app;
    const s = id && app.entity(id);
    if (!s?.derived?.report) return this.toast('Select a surface first.');
    const list = h('div.review-list', {}, h('p.muted', {}, 'Checking…'));
    const done = this.modal(`Check ${s.name}`, h('div.panel', { style: { padding: 0 } }, list), [['Close', null]]);
    const draw = async () => {
      const r = await app.reg.run('check_surface', { id });
      const fix = (label, cmd, args) => h('button.btn.sm', { onclick: async (ev) => (ev.stopPropagation(), await app.reg.run(cmd, args).catch((e) => this.toast(e.message, 'danger')), draw()) }, label);
      list.replaceChildren(
        h('p.small.muted', {}, `${r.triangles} triangles, ${r.area_2d} m² in plan, elevations ${r.min_y}…${r.max_y} (model).`),
        ...(r.issues.length
          ? r.issues.map((i) =>
              h(
                `div.review-issue.${i.severity}`,
                { onclick: () => i.point && (app.select([i.point]), app.reg.run('zoom_extents', { ids: [i.point] })) },
                icon(i.severity === 'error' ? 'x-circle' : i.severity === 'warning' ? 'warning' : 'info'),
                h('span.grow', {}, i.message),
                i.point ? fix('Exclude', 'set_surface_sources', { id, exclude: [...(s.derived.params.exclude || []), i.point] }) : null,
                i.point ? fix('Delete', 'delete', { ids: [i.point] }) : null,
              ),
            )
          : [h('p', {}, icon('check-circle'), ' No problems found.')]),
      );
    };
    await draw().catch((e) => list.replaceChildren(h('p', { role: 'alert' }, e.message)));
    await done;
  }

  /** Survey: coordinates, points table, surfaces and the feature library. */
  panel_survey() {
    const app = this.app;
    const doc = app.store.doc;
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    const g = doc.geo || {};
    const pts = doc.entities.filter((e) => e.type === 'point');
    const q = (this.surveyFilter || '').toLowerCase();
    const shown = pts.filter((p) => !q || `${p.name} ${p.point.code} ${p.point.desc}`.toLowerCase().includes(q));
    const k = { m: 1, ft: 0.3048, usft: 1200 / 3937 }[g.units || 'm'];
    const f = (x) => (x / k).toFixed(3);
    const filter = h('input', { placeholder: 'Filter by name, code, description', value: this.surveyFilter || '', 'aria-label': 'Filter points', oninput: (e) => ((this.surveyFilter = e.target.value), this.renderDock(), this.$('dock-body').querySelector('input')?.focus()) });
    const surfaces = doc.entities.filter((e) => e.derived?.report || ['corridor', 'design_trench', 'design_plane', 'design_line_slope', 'design_offset_surface', 'design_road'].includes(e.derived?.generator));
    return h(
      'div.panel',
      {},
      h('h3', {}, 'Coordinates'),
      h('div.small', {}, g.base ? `Base point E ${g.base[0]} · N ${g.base[1]} · Z ${g.base[2]}` : 'No base point yet: the first point sets it.'),
      h('div.small.muted', {}, `${g.crs?.name || 'No coordinate system'}${g.crs?.epsg ? ` (EPSG:${g.crs.epsg})` : ''} · units ${g.units || 'm'} · angles ${g.angles || 'deg'}`),
      h('div.row.wrap', {}, h('button.btn', { onclick: this.actions.coordSys.run }, icon('globe-hemisphere-west'), 'System…'), h('button.btn', { onclick: this.actions.basePoint.run }, icon('crosshair'), 'Base…'), h('button.btn', { onclick: this.actions.units.run }, icon('ruler'), 'Units…')),
      h('div.row', {}, h('h3.grow', {}, `Points · ${pts.length}`), h('button.btn', { onclick: this.actions.importPoints.run }, icon('tray-arrow-down'), 'Import…'), h('button.icon-btn.sm', { title: 'Export points', 'aria-label': 'Export points', onclick: this.actions.exportPoints.run }, icon('export'))),
      filter,
      h(
        'div.qty.pts',
        {},
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ['Name', 'N', 'E', 'Z', 'Code'].map((c) => h('th', {}, c)))),
          h(
            'tbody',
            {},
            shown.slice(0, 300).map((p) =>
              h(
                `tr${app.selection.includes(p.id) ? '.sel' : ''}`,
                { onclick: () => app.select([p.id]), ondblclick: () => run('zoom_extents', { ids: [p.id] }) },
                h('td', {}, p.name),
                h('td', {}, f(p.point.n)),
                h('td', {}, f(p.point.e)),
                h('td', {}, h('input.cell', { inputmode: 'decimal', value: f(p.point.z), 'aria-label': `Elevation of ${p.name}`, onclick: (e) => e.stopPropagation(), onchange: (e) => run('edit_points', { points: [p.id], z: +e.target.value }) })),
                h('td', {}, h('input.cell', { value: p.point.code, 'aria-label': `Code of ${p.name}`, onclick: (e) => e.stopPropagation(), onchange: (e) => run('edit_points', { points: [p.id], code: e.target.value }) })),
              ),
            ),
          ),
        ),
      ),
      shown.length > 300 ? h('div.small.muted', {}, `Showing 300 of ${shown.length}: filter to narrow.`) : null,
      h('div.row.wrap', {}, h('button.btn', { onclick: this.actions.breakline.run }, icon('line-segment'), 'Breakline'), h('button.btn', { onclick: this.actions.boundary.run }, icon('polygon'), 'Boundary'), h('button.btn.primary', { onclick: this.actions.surface.run }, icon('mountains'), 'Surface…')),
      h('h3', {}, 'Surfaces'),
      surfaces.length
        ? surfaces.map((s) =>
            h(
              'div.card',
              {},
              h('div.row', {}, icon('mountains'), h('b.grow', {}, s.name), h('span.small.muted', {}, `${s.mesh?.f.length || 0} triangles`)),
              s.derived.error ? h('div.small.param-error', {}, s.derived.error) : null,
              h('div.row.wrap', {}, s.derived.report ? h('button.btn', { onclick: () => this.checkSurfaceDialog(s.id) }, icon('list-checks'), 'Check') : null, h('button.btn', { onclick: () => this.commandDialog('cut_fill', { existing: s.id }) }, icon('chart-bar'), 'Cut / fill…'), h('button.icon-btn.sm', { title: 'Select', 'aria-label': `Select ${s.name}`, onclick: () => app.select([s.id]) }, icon('cursor'))),
            ),
          )
        : h('p.small.muted', {}, 'Import points, then Surface… makes a live TIN.'),
      h('div.row', {}, h('h3.grow', {}, 'Feature codes'), h('button.btn', { onclick: this.actions.featureCode.run }, icon('plus'), 'Code…'), h('button.icon-btn.sm', { title: 'Load library', 'aria-label': 'Load feature library', onclick: this.actions.loadLibrary.run }, icon('books'))),
      h('div.row.wrap', {}, Object.entries(doc.featureCodes || {}).map(([c, d]) => h('span.code-chip', { title: d.description || c }, h('i', { style: { background: d.color || '#1e3a4c' } }), c, d.line ? ' ⁄ line' : '', d.object ? ` ⁄ ${d.object.type}` : ''))),
      h('label.row.small', {}, h('span', {}, 'Labels'), h('select', { onchange: (e) => run('set_style', { point_labels: e.target.value }) }, [['name', 'Name'], ['name_z', 'Name + elevation'], ['code', 'Code'], ['all', 'All'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: (doc.settings.point_labels ?? 'name') === v }, l)))),
    );
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
