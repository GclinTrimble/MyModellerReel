// Chrome around the viewport: menus, tool bar, dock panels, status bar, palette, toasts, dialogs.
import * as D from '../core/document.js';
import { MATERIALS } from '../core/materials.js';
import * as L from '../core/layers.js';
export { MATERIALS };
import { listProfiles, profilePoints, profileSvg, ANCHORS } from '../core/profiles.js';
import { getGenerator } from '../core/derived.js';
import { TOOLS, TOOLBAR, SNAPS, SNAP_LABELS, fmt, BRUSH } from './tools.js';
import * as TK from '../core/takeoff.js';
import * as TX from '../core/textures.js';
import { buildForm, SWATCHES, codeGrid } from './forms.js';
import { pickSteps } from '../core/fields.js';
import { sketchPad } from './sketch.js';
import * as S from '../core/survey.js';
import * as SW from '../core/sitework.js';
import * as TR from '../core/terrain.js';
const TITLES = { create_layer: 'New layer', define_profile: 'New sweep profile', set_material: 'Colour and finish', create_corridor: 'New road corridor', create_alignment: 'New alignment', create_surface: 'New surface' };
import { t, LANGUAGES } from '../core/i18n.js';
import { parseUserFile, fileName } from '../core/usertools.js';
import { USER_SKILLS } from '../core/skills.js';
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
/**
 * Calm panels: a panel's explanation paragraphs become an (i) tooltip on their heading, and each section under a heading
 * (h3 or overline) folds, remembered per panel. Paragraphs with links or buttons stay as they are. The first h3 is the
 * panel's title and stays open.
 */
export function tidyPanel(panel, tab, label = tab) {
  if (!panel?.classList?.contains('panel')) return panel;
  const isHead = (el) => el.tagName === 'H3' || el.classList.contains('overline');
  const kids = [...panel.children];
  const title = kids[0]?.tagName === 'H3' && kids[0].textContent.trim().toLowerCase() === String(label).toLowerCase() ? kids[0] : null;
  let head = title;
  const tip = (el, text) => {
    let i = el.querySelector(':scope > .info-tip');
    if (!i) el.append((i = h('i.ph.ph-info.info-tip', { tabIndex: 0, role: 'img' })));
    i.title = i.title ? `${i.title}\n\n${text}` : text;
    i.setAttribute('aria-label', i.title);
  };
  for (const el of kids) {
    if (isHead(el)) head = el;
    else if (head && el.matches('p.muted') && !el.querySelector('a, button, input, select')) tip(head, el.textContent.trim()), el.remove();
  }
  let open = {};
  try {
    open = JSON.parse(localStorage.getItem('mymodellerreel.sections') || '{}');
  } catch {}
  let sec = null;
  for (const el of [...panel.children]) {
    if (el === title) continue;
    if (isHead(el)) {
      const key = `${tab}:${el.textContent.trim()}`;
      sec = h('details.panel-sec', { open: open[key] !== false, ontoggle: (e) => {
        open[key] = e.target.open;
        try {
          localStorage.setItem('mymodellerreel.sections', JSON.stringify(open));
        } catch {}
      } });
      el.replaceWith(sec);
      sec.append(h('summary', {}, el));
    } else if (sec) sec.append(el);
  }
  return panel;
}
export const icon = (name, fill = false) => h(`i.ph${fill ? '-fill' : ''}.ph-${name}`, { 'aria-hidden': 'true' });
/**
 * An ⓘ that keeps explanations out of the way (#255): a short card on hover, focus or tap, placed inside the window.
 * text: a string, or [title, body…]. Screen readers get the same text from the button itself.
 */
export function infoTip(text, label = 'More information') {
  const [title, ...body] = Array.isArray(text) ? text : [null, text];
  const pop = h('div.info-pop', { 'aria-hidden': 'true' }, title ? h('strong', {}, title) : null, ...body.map((b) => h('p', {}, b)));
  const btn = h('button.info-tip', { type: 'button', 'aria-label': label }, icon('info'), h('span.sr-only', {}, [title, ...body].filter(Boolean).join('. ')));
  const show = () => {
    if (pop.isConnected) return;
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: ht } = pop;
    pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 8 + ht < innerHeight ? r.bottom + 8 : Math.max(8, r.top - ht - 8)}px`;
  };
  const hide = () => pop.remove();
  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', hide);
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', hide);
  btn.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  btn.addEventListener('click', (e) => (e.preventDefault(), e.stopPropagation(), pop.isConnected ? hide() : show()));
  return btn;
}
/** The Survey tab's two views (#228): the points, and COGO. */
export const surveyViews = (ui, current) =>
  h('div.segmented.survey-views', { role: 'tablist', 'aria-label': 'Survey' }, ...[['survey', 'Points', 'map-pin'], ['cogo', 'COGO', 'compass-tool']].map(([tab, label, ic]) => h('button.seg', { type: 'button', role: 'tab', 'aria-selected': String(tab === current), 'aria-pressed': String(tab === current), onclick: () => ui.show(tab) }, icon(ic), label)));
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
    try {
      const r = JSON.parse(localStorage.getItem('mymodellerreel.ribbon') || 'null');
      // each launch opens the last ribbon used, or the Site ribbon
      queueMicrotask(() => this.setRibbon(r?.name || 'Site', r?.tab));
      if (localStorage.getItem('mymodellerreel.toolbar') === '0') document.body.classList.add('no-toolbar');
      if (localStorage.getItem('mymodellerreel.dock') === '0') document.body.classList.add('no-dock');
    } catch {}
    this.buildViewbar();
    this.buildTabs();
    this.buildPalette();
    this.$('context-chip').onclick = () => this.app.setContext(null);
  }

  /** A form for any command, generated from its JSON Schema: the UI path to every command with parameters. */
  async commandDialog(name, preset = {}, { form: modal = false } = {}) {
    const c = this.app.reg.commands.get(name);
    if (!c) return this.toast(`No command ${name}`, 'danger');
    if (name === 'create_layer') return this.layerDialog(preset);
    // points to pick: straight into the view (#234); the form is the last resort
    if (!modal && pickSteps(c.params, preset).length) return this.app.pickFirst.start(name, preset);
    // a friendly form (#201): plain words, the right control per field, points picked in the view, errors in place
    const form = buildForm(this.app, c, preset, { pick: (n, hint) => this.pickInView(n, hint), pickEntity: (hint) => this.pickInView(0, hint, true) });
    const err = h('div.form-error.form-top', { role: 'alert' });
    const body = h('div.panel.form', { style: { padding: 0 } }, h('p.small.muted', {}, c.description), err, form.el);
    const title = (TITLES[name] || name.replace(/_/g, ' ')).replace(/^./, (x) => x.toUpperCase());
    for (;;) {
      if ((await this.modal(title, body, [['Run', 'run'], ['Cancel', null]])) !== 'run') return;
      let args;
      try {
        args = form.read();
        const r = await this.app.reg.run(name, args);
        this.toast(r?.name ? `${title}: ${r.name}` : `${title}: done`);
        return r;
      } catch (e) {
        // stay open with the message, next to the field when it names one
        err.textContent = e.message;
        const k = Object.keys(c.params.properties || {}).find((x) => e.message.includes(x));
        if (k) form.error(k, e.message);
      }
    }
  }
  /** New layer (#202): a name, a colour from swatches, a line type you can see, lock, folder, current. */
  async layerDialog(preset = {}) {
    const app = this.app;
    const doc = app.store.doc;
    const used = new Set((doc.tags || []).map((t) => t.color));
    let color = preset.color || SWATCHES.find((c) => !used.has(c)) || SWATCHES[0];
    let lineType = preset.line_type || 'continuous';
    const name = h('input', { value: preset.name || '', placeholder: 'e.g. Walls, C-ROAD/Kerbs', 'aria-label': 'Layer name' });
    const sw = h('div.form-swatches.big', {});
    const drawSw = () =>
      sw.replaceChildren(
        ...SWATCHES.map((c) => h('button.form-swatch', { type: 'button', title: c, 'aria-pressed': String(c === color), style: { background: c }, onclick: () => ((color = c), drawSw()) })),
        h('input', { type: 'color', value: color, title: 'Another colour', oninput: (e) => ((color = e.target.value), drawSw()) }),
      );
    drawSw();
    const dash = { continuous: '', dashed: '8 4', dotted: '1.5 4', center: '14 3 3 3', hidden: '5 3', dashdot: '8 3 1.5 3' };
    const lt = h('div.line-types', {});
    const drawLt = () =>
      lt.replaceChildren(
        ...Object.entries(dash).map(([k, d]) =>
          h('button.line-type', { type: 'button', title: k, 'aria-pressed': String(k === lineType), onclick: () => ((lineType = k), drawLt()) }, svgLine(d, color), h('span', {}, k)),
        ),
      );
    const svgLine = (d, c) => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 60 8');
      s.innerHTML = `<line x1="2" y1="4" x2="58" y2="4" stroke="${c}" stroke-width="2" stroke-dasharray="${d}"/>`;
      return s;
    };
    drawLt();
    const folders = [...new Set((doc.tags || []).map((t) => t.folder).filter(Boolean))];
    const folder = h('input', { value: preset.folder || '', list: 'layer-folders', placeholder: 'none' });
    const locked = h('input', { type: 'checkbox', checked: !!preset.locked });
    const current = h('input', { type: 'checkbox', checked: preset.current ?? true });
    const weight = h('input', { type: 'number', step: 0.05, min: 0, value: preset.line_weight ?? '', placeholder: 'default' });
    const desc = h('input', { value: preset.description || '', placeholder: 'what goes on it' });
    const err = h('div.form-error.form-top', { role: 'alert' });
    const row = (label, ctl, help) => h('div.form-field', {}, h('div.form-label', {}, h('span', {}, label)), ctl, help ? h('div.form-help', {}, help) : null);
    const body = h(
      'div.panel.form',
      { style: { padding: 0 } },
      err,
      row('Name', name, 'A slash makes a group in the list: C-ROAD/Kerbs.'),
      row('Colour', sw),
      row('Line type', lt),
      h('div.form-row', {}, h('label.form-check', {}, current, 'Draw new things on it'), h('label.form-check', {}, locked, 'Locked (cannot be picked)')),
      h('details.form-more', {}, h('summary', {}, 'More options'), row('Folder', h('div.form-stack', {}, folder, h('datalist', { id: 'layer-folders' }, folders.map((f) => h('option', { value: f })))), 'Group layers under a folder in the list.'), row('Line weight (mm)', weight), row('Description', desc)),
    );
    for (;;) {
      if ((await this.modal('New layer', body, [['Create', 'go'], ['Cancel', null]])) !== 'go') return;
      if (!name.value.trim()) {
        err.textContent = 'Give the layer a name.';
        continue;
      }
      const args = { name: name.value.trim(), color, line_type: lineType, locked: locked.checked, current: current.checked, ...(folder.value.trim() ? { folder: folder.value.trim() } : {}), ...(weight.value !== '' ? { line_weight: +weight.value } : {}), ...(desc.value.trim() ? { description: desc.value.trim() } : {}) };
      try {
        const r = await app.reg.run('create_layer', args);
        this.toast(`Layer ${args.name}${args.current ? ': new things go on it' : ''}`);
        return r;
      } catch (e) {
        err.textContent = e.message;
      }
    }
  }
  /** Click points in the view while a form waits (it hides, then comes back). n = 0: until Enter. */
  /**
   * The code card (#217): a small popover at the click with a code box and the codes to recall (recent first, then the
   * library's), filtered as you type. Enter takes the highlighted code or what is typed; Esc or a click away gives null.
   */
  codeCard(at, current = '', title = 'Code') {
    const doc = this.app.store.doc;
    const KEY = 'mymodellerreel.recentCodes';
    let recent = [];
    try {
      recent = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {}
    return new Promise((resolve) => {
      const inp = h('input', { value: current, 'aria-label': title, placeholder: 'e.g. KERB, TREE, GND', autocomplete: 'off', spellcheck: false, role: 'combobox', 'aria-controls': 'code-list', 'aria-expanded': 'true' });
      const list = h('div.code-list', { role: 'listbox', id: 'code-list', 'aria-label': 'Codes' });
      let items = [];
      let hi = -1; // -1: what is typed
      const draw = () => {
        items = S.suggestCodes(doc, recent, inp.value === current ? '' : inp.value);
        hi = Math.min(hi, items.length - 1);
        list.replaceChildren(
          ...items.map((x, i) =>
            h('div.code-item', { role: 'option', 'aria-selected': String(i === hi), onpointerdown: (e) => (e.preventDefault(), done(x.code)) }, icon(x.recent ? 'clock-counter-clockwise' : 'tag'), h('b', {}, x.code), h('span', {}, x.action)),
          ),
        );
        if (!items.length) list.append(h('div.code-empty', {}, inp.value.trim() ? 'A new code: Enter to use it.' : 'No codes yet: type one, or Enter for a point without a code.'));
      };
      // Browse: the whole library as a searchable grid inside the card
      let grid = null;
      const lib = doc.featureCodes || {};
      const browse = Object.keys(lib).length
        ? h('button.icon-btn.sm.code-browse', { title: `Browse the ${Object.keys(lib).length} codes${doc.featureLibrary ? ` of ${doc.featureLibrary.name}` : ''}`, 'aria-label': 'Browse the feature codes', 'aria-expanded': 'false', onclick: () => {
            if (grid) return (grid.el.remove(), (grid = null), card.classList.remove('wide'), browse.setAttribute('aria-expanded', 'false'), inp.focus());
            grid = codeGrid(lib, (c) => done(c), { query: inp.value === current ? '' : inp.value });
            grid.search.addEventListener('keydown', (e) => e.key === 'Escape' && done(null));
            card.classList.add('wide');
            list.after(grid.el);
            browse.setAttribute('aria-expanded', 'true');
            grid.search.focus();
            place();
          } }, icon('squares-four'))
        : null;
      const card = h('div.code-card', { role: 'dialog', 'aria-label': title }, h('div.code-title', {}, icon('map-pin'), h('span.grow', {}, title), browse), inp, list, h('div.code-keys', {}, `↑↓ choose · Enter OK (empty: no code) · Esc cancel · Tab completes${browse ? ' · ▦ browse' : ''}`));
      const away = (e) => !card.contains(e.target) && done(null);
      const done = (code) => {
        card.remove();
        window.removeEventListener('pointerdown', away, true);
        if (code !== null) {
          code = code.trim();
          try {
            localStorage.setItem(KEY, JSON.stringify(S.rememberCode(recent, code)));
          } catch {}
        }
        resolve(code);
      };
      // typing highlights the first code that starts with it (KE → KERB); ↑ back to what is typed, for a new code
      inp.oninput = () => {
        hi = -1;
        draw();
        const t = inp.value.trim().toUpperCase();
        if (t && items[0]?.code.toUpperCase().startsWith(t)) (hi = 0), draw();
      };
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          hi = Math.max(-1, Math.min(items.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
          draw();
        } else if (e.key === 'Enter') done(hi >= 0 ? items[hi].code : inp.value);
        else if (e.key === 'Escape') done(null);
        else if (e.key === 'Tab' && hi >= 0) (e.preventDefault(), (inp.value = items[hi].code), (hi = -1), draw());
      };
      draw();
      document.body.append(card);
      // next to the click, inside the window
      const place = () => {
        const r = card.getBoundingClientRect();
        card.style.left = `${Math.max(8, Math.min((at.clientX ?? innerWidth / 2) + 12, innerWidth - r.width - 8))}px`;
        card.style.top = `${Math.max(8, Math.min((at.clientY ?? innerHeight / 2) + 12, innerHeight - r.height - 8))}px`;
      };
      place();
      // after the click that opened it: its mousedown would take the focus back and close the card
      setTimeout(() => {
        window.addEventListener('pointerdown', away, true);
        inp.focus();
        inp.select();
      });
    });
  }

  /** The form steps aside while points (or, with thing, one object: its id) are clicked in the view. */
  async pickInView(n, hint, thing = false) {
    const dlg = this.$('modal');
    this.modalClosing = true;
    dlg.close();
    try {
      if (thing) return await this.app.tools.pickEntity(hint);
      const pts = await this.app.tools.pickPoints(n, hint);
      return pts.map((p) => p.toArray());
    } finally {
      dlg.showModal();
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
      zoomExtents: { label: 'Zoom extents', icon: 'corners-out', key: 'Shift+Z', run: () => app.reg.run('zoom_extents', { ...app.panes?.target() }) },
      layout1: { label: 'One view', icon: 'square', run: run('set_layout', { count: 1 }) },
      layout2: { label: 'Two views side by side', icon: 'square-split-horizontal', run: run('set_layout', { count: 2, arrangement: 'columns' }) },
      layout2Rows: { label: 'Two views stacked', icon: 'square-split-vertical', run: run('set_layout', { count: 2, arrangement: 'rows' }) },
      layout3: { label: 'Three views', icon: 'layout', run: run('set_layout', { count: 3, arrangement: 'main_left' }) },
      layout4: { label: 'Four views', icon: 'squares-four', key: 'Ctrl+Shift+4', run: run('set_layout', { count: 4, arrangement: 'grid' }) },
      fitPanes: { label: 'Zoom extents in every view', icon: 'corners-out', run: run('zoom_extents', { pane: 'all' }) },
      zoomSel: { label: 'Zoom to selection', icon: 'magnifying-glass-plus', run: () => sel().length && app.reg.run('zoom_extents', { ids: sel() }) },
      // in the view last worked in, when there are several (#161)
      iso: { label: 'Iso', icon: 'cube', run: () => app.reg.run('set_view', { preset: 'iso', ...app.panes?.target() }) },
      top: { label: 'Top', icon: 'square', run: () => app.reg.run('set_view', { preset: 'top', ...app.panes?.target() }) },
      front: { label: 'Front', icon: 'square-half-bottom', run: () => app.reg.run('set_view', { preset: 'front', ...app.panes?.target() }) },
      right: { label: 'Right', icon: 'square-half', run: () => app.reg.run('set_view', { preset: 'right', ...app.panes?.target() }) },
      left: { label: 'Left', run: () => app.reg.run('set_view', { preset: 'left', ...app.panes?.target() }) },
      back: { label: 'Back', run: () => app.reg.run('set_view', { preset: 'back', ...app.panes?.target() }) },
      edges: { label: 'Edges', icon: 'line-segments', ...style('edges') },
      xray: { label: 'X-ray', icon: 'cube-transparent', ...style('xray') },
      wireframe: { label: 'Wireframe', icon: 'cube-focus', ...style('wireframe') },
      shadows: { label: 'Shadows', icon: 'sun', ...style('shadows') },
      grid: { label: 'Grid and axes', icon: 'grid-four', ...style('grid') },
      unsection: { label: 'Remove section cut', icon: 'knife', run: run('section', { enabled: false }) },
      sectionPlanes: { label: 'Section planes…', icon: 'knife', run: () => this.sectionPlanesDialog() },
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
      placeComponent: { label: 'Place component…', icon: 'squares-four', run: async () => { const r = await this.commandDialog('place_component', { name: Object.keys(app.store.doc.components || {})[0] }); if (r?.id) app.tools.place([r.id]); } },
      makeUnique: { label: 'Make unique', icon: 'link-break', run: () => sel().length && app.reg.run('make_unique', {}).then((r) => this.toast(`Now its own component: ${r.component}`)).catch((e) => this.toast(e.message, 'danger')) },
      replaceComponent: { label: 'Replace component…', icon: 'swap', run: form('replace_component') },
      imprint: { label: 'Imprint on a face…', icon: 'selection-foreground', run: () => this.commandDialog('imprint', { id: sel()[0], face: 'top', shape: 'rectangle', size: [0.5, 0.5] }) },
      offsetFace: { label: 'Offset (inset) a face…', icon: 'frame-corners', run: () => this.commandDialog('offset_face', { id: sel()[0], face: 'top', distance: 0.1 }) },
      moveElements: { label: 'Move a face, edge or corner…', icon: 'arrows-out-cardinal', run: () => this.commandDialog('move_elements', { id: sel()[0], edge: 'top front', by: [0, 1, 0] }) },
      repair: { label: 'Repair mesh', icon: 'first-aid-kit', run: () => sel().length && app.reg.run('repair_mesh', {}).then((r) => this.toast(r.map((x) => `${x.name}: ${x.faces_before} → ${x.faces} faces`).join(' · ').slice(0, 200))).catch((e) => this.toast(e.message, 'danger')) },
      proposeToggle: { label: 'Propose AI changes for review', icon: 'git-pull-request', checked: () => app.ai.propose, run: () => app.ai.setPropose(!app.ai.propose) },
      proposeAccept: { label: 'Accept proposal', icon: 'check-circle', run: run('propose', { action: 'accept' }) },
      proposeReject: { label: 'Reject proposal', icon: 'x-circle', run: run('propose', { action: 'reject' }) },
      sketchProfile: { label: 'Sketch a profile…', icon: 'scribble', run: () => sketchPad(app, { mode: 'profile' }).then(() => this.refresh()) },
      sketchForAi: { label: 'Sketch for the AI…', icon: 'scribble', run: () => sketchPad(app, { mode: 'chat' }).then((r) => r && app.ai.attachPicture(r.image, r.note, true)) },
      sweep: { label: 'Sweep a profile along a path…', icon: 'path', run: form('sweep', () => (app.entity(sel()[0])?.curve ? { path: sel()[0] } : {})) },
      liveArray: { label: 'Live array of the selection…', icon: 'columns', run: form('duplicate', () => ({ live: 'true', count: 3, offset: [1, 0, 0] })) },
      bake: { label: 'Bake (freeze parameters)', icon: 'snowflake', run: () => sel().length && app.reg.run('bake', {}).then((r) => this.toast(`Baked ${r.baked.length}`)) },
      recordMacro: { label: 'Record macro', icon: 'record', checked: () => !!app.ctx.macro, run: () => (app.ctx.macro ? app.reg.run('stop_macro', {}).then((r) => this.toast(`Saved recipe "${r.name}" (${r.steps} steps)`)) : app.reg.run('record_macro', {})).catch((e) => this.toast(e.message, 'danger')) },
      saveRecipe: { label: 'Save recipe of this model…', icon: 'floppy-disk-back', run: form('save_recipe') },
      library: { label: 'Profiles, recipes and plugins', icon: 'books', run: () => this.show('library') },
      myTools: { label: 'Manage my tools and skills…', icon: 'toolbox', run: () => this.show('mytools') },
      review: { label: 'Review my model', icon: 'list-checks', run: () => this.reviewDialog() },
      importPoints: { label: 'Import points (CSV, TXT, JobXML, LandXML)…', icon: 'tray-arrow-down', run: () => this.importPointsDialog() },
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
      cogo: { label: 'COGO: inverse, traverse, intersect…', icon: 'compass-tool', run: () => this.show('cogo') },
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
      exportAll: { label: 'Export…', icon: 'export', key: 'Ctrl+E', run: () => this.exportDialog() },
      ribbon: { label: 'Ribbon: tools in tabs', icon: 'rows', checked: () => !!this.ribbon, run: () => this.setRibbon(this.ribbon ? null : 'Draw and modify') },
      sideToolbar: { label: 'Side toolbar', icon: 'sidebar', checked: () => !document.body.classList.contains('no-toolbar'), run: () => this.setSideToolbar(document.body.classList.contains('no-toolbar')) },
      sidePanel: { label: 'Side panel', icon: 'sidebar-simple', key: 'Ctrl+B', checked: () => !document.body.classList.contains('no-dock'), run: () => this.setSidePanel(document.body.classList.contains('no-dock')) },
      ribbonSite: { label: 'Site ribbon: survey, surfaces, design, roads, earthworks', icon: 'mountains', checked: () => this.ribbon?.name === 'Site', run: () => this.setRibbon(this.ribbon?.name === 'Site' ? null : 'Site') },
      ribbonDrawings: { label: 'Drawings ribbon: bring in, scale, place, take lines out', icon: 'file-pdf', checked: () => this.ribbon?.name === 'Drawings', run: () => this.setRibbon(this.ribbon?.name === 'Drawings' ? null : 'Drawings') },
      exportSelection: { label: 'Export the selection…', icon: 'export', run: () => this.exportDialog('selection') },
      isolate: { label: 'Isolate (hide everything else)', icon: 'eye', run: () => sel().length && app.reg.run('set_properties', { ids: app.store.doc.entities.filter((e) => !e.parent && !sel().includes(e.id) && e.visible !== false).map((e) => e.id), visible: false }) },
      properties: { label: 'Properties', icon: 'info', run: () => this.show('entity') },
      exportUsdz: { label: 'Export USDZ (iPhone AR)…', icon: 'device-mobile', run: run('export', { format: 'usdz' }) },
      referenceFile: { label: 'Reference a design (live)…', icon: 'link-simple', run: run('reference_file', {}) },
      publishReference: { label: 'Publish as live reference…', icon: 'broadcast', checked: () => !!app.io.published, run: () => (app.io.published ? app.reg.run('publish_reference', { stop: true }) : app.reg.run('publish_reference', {})).then((r) => r.publishing === false && this.toast('Stopped publishing')).catch((e) => this.toast(e.message, 'danger')) },
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
      materialManager: { label: 'Material manager', icon: 'stack', run: () => this.materialManager() },
      alignment: { label: 'Alignment…', icon: 'path', run: form('create_alignment') },
      corridor: { label: 'Corridor…', icon: 'road-horizon', run: form('create_corridor') },
      editCorridor: { label: 'Change the corridor (template, ditch, benches, layers)…', icon: 'sliders-horizontal', run: form('set_corridor', () => ({ id: this.firstCorridor() })) },
      roadViews: { label: 'Road views: plan, 3D, profile, section', icon: 'squares-four', run: form('road_views', () => ({ corridor: this.firstCorridor() })) },
      corridorSurface: { label: 'See the cut through the ground…', icon: 'mountains', run: form('corridor_surface', () => ({ corridor: this.firstCorridor() })) },
      corridorVolumes: { label: 'Road earthwork volumes…', icon: 'table', run: async () => this.roadVolumesDialog(await this.commandDialog('corridor_volumes', { corridor: this.firstCorridor(), bulking: 1.25, shrinkage: 0.9 })) },
      corridorSolids: { label: 'Earthwork and pavement solids…', icon: 'cube', run: async () => this.roadSolidsDialog(await this.commandDialog('corridor_solids', { corridor: this.firstCorridor() })) },
      applyCorridor: { label: 'Write the road into the ground…', icon: 'check-square', run: form('apply_corridor', () => ({ corridor: this.firstCorridor() })) },
      trench: { label: 'Design: trench…', icon: 'shovel', run: form('design_trench') },
      lineSlope: { label: 'Design: line with cross slope…', icon: 'line-segment', run: form('design_line_slope') },
      plane: { label: 'Design: plane…', icon: 'square', run: form('design_plane') },
      offsetSurface: { label: 'Design: offset surface…', icon: 'stack', run: form('design_offset_surface') },
      road: { label: 'Design: road…', icon: 'road-horizon', run: form('design_road') },
      featureCode: { label: 'Define feature code…', icon: 'tag', run: form('define_feature_code') },
      loadLibrary: { label: 'Feature code libraries…', icon: 'books', run: () => this.featureLibrariesDialog() },
      processCodes: { label: 'Process feature codes', icon: 'arrows-clockwise', run: () => app.reg.run('process_codes', {}).then((r) => this.toast(`${r.lines} lines, ${r.objects} objects${r.warnings.length ? `, ${r.warnings.length} warnings` : ''}`)) },
      coordSys: { label: 'Coordinate system…', icon: 'globe-hemisphere-west', run: () => this.crsDialog() },
      editSurface: { label: 'Edit surface by hand: swap, delete, points, outline, holes', icon: 'triangle', run: () => app.tools.set('surfedit') },
      basePoint: { label: 'Base point: click a point, type its coordinates', icon: 'crosshair', run: () => app.tools.set('basepoint') },
      mapPick: { label: 'Base point from a map…', icon: 'map-trifold', run: () => app.pickLocation() },
      units: { label: 'Units…', icon: 'ruler', run: form('set_units') },
      survey: { label: 'Survey panel', icon: 'map-pin', run: () => this.show('survey') },
      quantities: { label: 'Quantities report…', icon: 'table', run: () => this.quantitiesDialog() },
      askAi: { label: 'Ask the AI', icon: 'sparkle', key: 'Ctrl+J', run: () => this.show('ai', true) },
      newChat: { label: 'New AI chat', icon: 'chat-circle', run: () => app.ai.reset() },
      askHere: { label: 'Ask an agent here…', icon: 'chat-teardrop-dots', key: 'Ctrl+Space', run: () => app.agents.askAt() },
      agents: { label: 'Agents…', icon: 'users-three', run: () => this.show('agents') },
      aiSettings: { label: 'AI and API settings', icon: 'gear', run: () => this.show('settings') },
      aiPanel: { label: 'Ask Plumb', icon: 'sparkle', run: () => this.show('ai') },
      aiFeedback: { label: 'Copilot feedback…', icon: 'thumbs-up', run: () => this.feedbackDialog() },
      aiSetup: { label: 'Set up the local AI model…', icon: 'download-simple', run: () => (this.show('ai'), this.app.ai.add(this.app.ai.setupCard())) },
      insights: { label: 'My achievements', icon: 'trophy', run: () => ((this.app.learning.insightsOpen = true), (this.app.help.page = null), this.show('help')) },
      splitLine: { label: 'Split a line', icon: 'scissors', run: () => this.app.tools.set('split') },
      joinLines: { label: 'Join two lines', icon: 'link', run: () => this.app.tools.set('join') },
      mcp: { label: 'Connect Claude Desktop (MCP)…', icon: 'plugs-connected', run: () => this.mcpDialog() },
      shortcuts: { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => this.shortcutsDialog() },
      about: { label: 'About MyModellerReel', icon: 'info', run: () => this.aboutDialog() },
    };
    for (const t of TOOLS) this.actions[`tool:${t.id}`] = { label: t.label, icon: t.icon, key: t.key, checked: () => app.tools.id === t.id, run: () => app.tools.set(t.id) };
  }

  buildMenus() {
    const T = (g) => TOOLS.filter((t) => t.group === g).map((t) => `tool:${t.id}`);
    this.menus = {
      File: ['new', 'newTab', 'startScreen', 'open', 'save', 'saveAs', 'versions', '-', 'import', 'importCloud', 'freeAssets', '-', 'referenceFile', 'publishReference', '-', 'exportAll', 'exportSelection', '-', 'quantities', '-', 'plugins'],
      Edit: ['undo', 'redo', '-', 'cut', 'copy', 'paste', '-', 'duplicate', 'delete', '-', 'selectAll', 'selectNone', 'selectInvert', 'selectSimilar', 'selectWhere', '-', 'group', 'ungroup', '-', 'makeComponent', 'placeComponent', 'makeUnique', 'replaceComponent', '-', 'hide', 'unhideAll', 'lock', 'unlockAll', '-', 'metadata', '-', 'modelInfo', 'purge', 'units'],
      Arrange: ['alignXmin', 'alignXmid', 'alignXmax', 'alignZmin', 'alignZmid', 'alignZmax', 'alignYmin', '-', 'distX', 'distZ', 'stack', '-', 'placeOn', 'against', 'freeSpace'],
      View: ['zoomExtents', 'zoomSel', 'tool:zoomwin', 'viewBack', 'viewForward', 'Standard views', 'iso', 'top', 'front', 'right', 'left', 'back', 'Panes', 'layout1', 'layout2', 'layout2Rows', 'layout3', 'layout4', 'fitPanes', 'Display', 'edges', 'xray', 'wireframe', 'shadows', 'grid', 'Sections', 'sectionPlanes', 'sectionFill', 'unsection', 'Handles', 'gizmoMove', 'gizmoRotate', 'gizmoScale', 'Style', 'styleShaded', 'styleHidden', 'styleMono', 'styleSketchy', 'Camera and light', 'parallel', 'twoPoint', 'lens', 'effects', 'environment', 'geolocation', 'sunTime', 'sunStudy', 'Render', 'renderImage', 'aiRender', '-', 'ribbon', 'sideToolbar', 'sidePanel', 'timeline', 'theme', 'perf'],
      Tools: ['Draw', ...T('draw'), 'Modify', ...T('edit'), 'Construct', ...T('construct'), 'Drafting', ...T('draft'), 'Camera', ...T('camera'), 'Lights', 'lightPoint', 'lightSpot', 'lightArea', 'Materials', 'texture', 'textureEdit', 'materialMaps', 'aiTexture', 'generateMesh', 'Annotate', 'text3d', 'dimensionShape', 'labelSel', 'listAnnotations', 'clearGuides', 'lineTypes', 'clashes', 'Shape', 'filletEdges', 'chamferEdges', 'loft', 'shell', 'thicken', 'extrudeFaces', 'subdivide', 'deform', 'simplify', 'splitSolid', 'intersect', 'weld', 'symmetry', 'arrayGrid', 'arrayPath', 'axes', 'import2d', 'curvesToFaces', 'imprint', 'offsetFace', 'moveElements', 'repair', 'Parametric', 'sweep', 'sketchProfile', 'liveArray', 'bake', 'Recipes', 'recordMacro', 'saveRecipe', 'library', 'My tools', 'myTools'],
      Animate: ['timeline', 'play', '-', 'keySel', 'keyCam', 'autoKey', '-', 'sequence', 'turntable', 'scenesAnim', 'explode', 'alongPath', 'stagger', 'motion', '-', 'marker', 'caption', 'Depth', 'saveClip', 'applyClip', 'physics', 'addShot', 'addAudio', 'sectionReveal', 'attach', 'lookAt', 'retime', 'schedule', '-', 'clearAnim', 'exportVideo'],
      Site: ['ribbonSite', '-', 'survey', 'importPoints', 'exportPoints', 'importTerrain', 'groundFromCloud', '-', 'Surfaces', 'contours', 'analyze', 'profile', 'sections', 'smooth', 'fromContours', 'contourZ', '-', 'Design', 'pad', 'stamp', 'newTerrain', 'tool:sculpt', 'drape', 'drapeImage', 'water', '-', 'addPoint', 'tool:point', 'cogo', '-', 'breakline', 'boundary', 'surface', 'editSurface', 'checkSurface', '-', 'cutFill', 'volumeReport', '-', 'Roads', 'alignment', 'corridor', 'editCorridor', 'roadViews', 'corridorSurface', 'corridorVolumes', 'corridorSolids', 'applyCorridor', 'Field designs', 'trench', 'lineSlope', 'plane', 'offsetSurface', 'road', '-', 'featureCode', 'loadLibrary', 'processCodes', '-', 'coordSys', 'basePoint', 'mapPick', 'units'],
      Drawings: ['ribbonDrawings', '-', 'importPdf', 'importImage', 'readDrawing', 'vectorise', 'snapDrawings', '-', 'Place', 'tool:calibrate', 'drawingScale', 'tool:control', 'georef', 'georefReport', 'worldFile', '-', 'From the PDF', 'pdfStats', 'extract', 'drawingText', 'textToPoints', 'labelContours', '-', 'Drafting', 'tool:trim', 'tool:extend', 'tool:split', 'tool:join', 'offset', 'fillet', 'chamfer', 'joinCurves', 'explode', 'simplify', 'divide', '-', 'To the model', 'elevate', 'toBreaklines', 'extrudeLines', 'sweepLines', '-', 'Layers', 'newLayer', 'mapLayers', 'layerState', 'restoreLayerState'],
      AI: ['askAi', 'askHere', 'agents', 'newChat', 'sketchForAi', '-', 'review', 'proposeToggle', 'proposeAccept', 'proposeReject', '-', 'mcp', 'aiSetup', 'aiFeedback', 'aiSettings'],
      Help: ['howto', 'tour', 'insights', 'shortcuts', 'mcp', '-', 'checkUpdates', 'restartUpdate', '-', 'about'],
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
    const item = (id, reopen) => {
      if (id === '-') return h('hr');
      const a = this.actions[id];
      if (!a) return h('div.overline', {}, t(id));
      const on = a.checked?.();
      // a toggle keeps the menu open (#194): switch several things on and off in one go
      const click = a.checked ? async () => (await a.run(), reopen()) : () => (this.closeMenu(), a.run());
      return h('button', { role: 'menuitem', 'aria-checked': a.checked ? String(!!on) : undefined, onclick: click }, on ? icon('check') : icon(a.icon || 'dot-outline'), t(a.label), a.key ? h('span.key', {}, a.key) : null);
    };
    // a long menu (#208): the items under each heading go into a sub-menu that opens beside it
    const list = name === 'Tools' ? [...this.menus.Tools, ...this.myToolItems()] : this.menus[name];
    const parts = [];
    if (list.length > 16) {
      let cur = null;
      for (const id of list) {
        if (id !== '-' && !this.actions[id]) parts.push((cur = { sub: id, items: [] }));
        else if (id === '-') (cur = null), parts.push(id);
        else if (cur) cur.items.push(id);
        else parts.push(id);
      }
    } else parts.push(...list);
    const openSub = (p, row) => {
      this.$('menu-sub')?.remove();
      const sub = h('div.menu-pop', { id: 'menu-sub', role: 'menu' });
      const render = () => sub.replaceChildren(...p.items.map((id) => item(id, render)));
      render();
      document.body.append(sub);
      const r = row.getBoundingClientRect();
      Object.assign(sub.style, { left: `${r.right + 2}px`, top: `${Math.max(8, Math.min(r.top - 4, innerHeight - sub.offsetHeight - 8))}px` });
      for (const x of pop.querySelectorAll('.has-sub')) x.classList.toggle('open', x === row);
    };
    const reopenMain = () => ((this.openName = null), this.openMenu(name, btn));
    pop.replaceChildren(
      ...parts.map((p) => {
        if (typeof p === 'string') {
          const el = item(p, reopenMain);
          el.onmouseenter = () => (this.$('menu-sub')?.remove(), pop.querySelectorAll('.has-sub').forEach((x) => x.classList.remove('open')));
          return el;
        }
        const row = h('button.has-sub', { role: 'menuitem', 'aria-haspopup': 'menu' }, icon(this.actions[p.items[0]]?.icon || 'folder-simple'), t(p.sub), h('span.key', {}, icon('caret-right')));
        row.onmouseenter = () => openSub(p, row);
        row.onclick = () => openSub(p, row);
        return row;
      }),
    );
    const r = btn.getBoundingClientRect();
    Object.assign(pop.style, { left: `${r.left}px`, top: `${r.bottom + 4}px` });
    pop.hidden = false;
  }
  /** Tools › My tools (#242): one menu item per saved tool, run through its form. */
  myToolItems() {
    return this.app.reg.list().filter((c) => c.category === 'my tools').map((c) => {
      const id = `my:${c.name}`;
      this.actions[id] = { label: `${c.description.split(':')[0]}…`, icon: 'wrench', run: () => this.runMyTool(c.name) };
      return id;
    });
  }
  runMyTool(name) {
    const c = this.app.reg.commands.get(name);
    return Object.keys(c?.params.properties || {}).length ? this.commandDialog(name) : this.app.reg.run(name, {}).catch((e) => this.toast(e.message, 'danger'));
  }

  /** My tools and skills (#242): what Plumb saved for you, to run, edit, share and delete. */
  panel_mytools() {
    const app = this.app;
    const run = (n, a) => app.reg.run(n, a).catch((e) => (this.toast(e.message, 'danger'), null));
    const mine = app.reg.list().filter((c) => c.category === 'my tools').map((c) => c.name);
    const full = (name) => app.reg.run('list_my_tools', { name });
    const save = (x) => (x.kind === 'tool' ? run('save_tool', { name: x.title, description: x.description, steps: x.steps, params: x.params }) : run('save_skill', x));
    const exportItem = async (x) => {
      const p = await window.native.invoke('file:save-dialog', { defaultPath: fileName(x), filters: [{ name: 'MyModellerReel tool or skill', extensions: ['json'] }] });
      if (p) await window.native.invoke('file:write', p, JSON.stringify(x, null, 2)), this.toast(`Exported to ${p}`);
    };
    const edit = async (x) => {
      const area = h('textarea.code', { rows: 18, spellcheck: false, 'aria-label': 'Definition (JSON)' }, JSON.stringify(x, null, 2));
      if (!(await this.modal(`Edit ${x.title || x.label}`, h('div', {}, h('p.small.muted', {}, x.kind === 'tool' ? 'Steps are commands with their arguments; "{{name}}" takes a parameter. Renaming makes a new tool.' : 'prompt is what Plumb reads; toolset lists the commands it uses.'), area), [['Save', true], ['Cancel', null]]))) return;
      try {
        const y = parseUserFile(area.value);
        if (await save(y)) this.toast('Saved');
      } catch (e) {
        this.toast(e.message, 'danger');
      }
    };
    const importFile = async () => {
      const p = await window.native.invoke('file:open-dialog', { filters: [{ name: 'MyModellerReel tool or skill', extensions: ['json'] }] });
      if (!p) return;
      try {
        const x = parseUserFile(await window.native.invoke('file:read-text', p));
        if (await save(x)) this.toast(`Added ${x.title || x.label}`);
      } catch (e) {
        this.toast(e.message, 'danger');
      }
    };
    const card = (x, ic, title, desc, main) =>
      h(
        'div.card',
        {},
        h('div.row', {}, icon(ic), h('b.grow', {}, title), h('span.small.muted', {}, x.name)),
        desc ? h('div.small.muted', {}, desc) : null,
        h(
          'div.row.wrap',
          {},
          main,
          h('button.btn.sm', { onclick: () => edit(x) }, icon('pencil-simple'), 'Edit'),
          h('button.btn.sm', { onclick: () => exportItem(x) }, icon('export'), 'Export'),
          h('button.icon-btn.sm', { title: 'Delete', 'aria-label': `Delete ${title}`, onclick: async () => (await this.modal(`Delete "${title}"?`, h('p', {}, 'Its file in your library is removed too.'), [['Delete', true], ['Cancel', null]])) && run('delete_my_tool', { name: x.name }) }, icon('trash')),
        ),
      );
    const tools = h('div', {}, h('p.muted.small', {}, 'Loading…'));
    Promise.all(mine.map(full)).then((xs) =>
      tools.replaceChildren(
        ...(xs.length ? xs.map((x) => card(x, 'wrench', x.title, `${x.description} · ${Object.keys(x.params).join(', ') || 'no parameters'}`, h('button.btn.sm.primary', { onclick: () => this.runMyTool(x.name) }, icon('play'), 'Run…'))) : [h('p.small.muted', {}, 'None yet.')]),
      ),
    );
    const skills = Object.values(USER_SKILLS);
    return h(
      'div.panel',
      {},
      h('h3', {}, 'My tools'),
      h('p.muted.small', {}, 'After Plumb has done something you will want again, say "save what we just did as a tool called Kerb return". The numbers become parameters; the tool is a command like any other: in Tools › My tools, command search (Ctrl+K), the API and MCP, and Plumb can call it.'),
      tools,
      h('h3', {}, 'My skills'),
      h('p.muted.small', {}, 'Say "remember this as a skill: …" with how you like a kind of work done and the commands it uses. Pick it in the AI panel and Plumb follows it.'),
      ...(skills.length ? skills.map((x) => card(x, 'graduation-cap', x.label, x.description, h('button.btn.sm.primary', { onclick: () => run('use_skill', { name: x.name }).then(() => this.toast(`Plumb now uses "${x.label}"`)) }, icon('sparkle'), 'Use'))) : [h('p.small.muted', {}, 'None yet.')]),
      h('div.row.wrap', {}, h('button.btn', { onclick: importFile }, icon('download-simple'), 'Import a tool or skill…'), h('button.btn', { onclick: () => window.native.invoke('shell:open-path', 'library') }, icon('folder-open'), 'Library folder')),
    );
  }

  closeMenu() {
    this.$('menu-sub')?.remove();
    this.$('menu-pop').hidden = true;
    for (const b of this.$('menubar').children) b.setAttribute('aria-expanded', 'false');
    this.openName = null;
  }

  /**
   * The side toolbar (#175): one button per slot, variants of a tool behind it in a flyout (the corner mark, a
   * right-click, or a second click opens it); the last one used shows. Navigation lives in the view bar (#174), the
   * drawing tools (calibrate, control points) in the Drawings menu.
   */
  buildToolbar() {
    const bar = this.$('toolbar');
    const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
    this.slots = TOOLBAR.map((slot) => (slot === '-' ? slot : { ids: [].concat(slot), current: [].concat(slot)[0] }));
    for (const s of this.slots) {
      if (s === '-') {
        bar.append(h('hr'));
        continue;
      }
      const t = () => byId[s.current];
      const tip = () => `${tr(t().label)}${t().key ? ` (${t().key})` : ''}${s.ids.length > 1 ? ' · more: right-click' : ''}`;
      const b = h('button.icon-btn.slot', { 'aria-pressed': 'false', 'aria-haspopup': s.ids.length > 1 ? 'menu' : undefined }, icon(t().icon));
      const flyout = () =>
        this.popAt(b, s.ids.map((id) => ({ label: `${tr(byId[id].label)}`, icon: byId[id].icon, key: byId[id].key, checked: () => this.app.tools.id === id, run: () => this.app.tools.set(id) })), { side: 'right' });
      b.onclick = (e) => {
        if (s.ids.length > 1 && (this.app.tools.id === s.current || e.offsetX > b.clientWidth - 12)) return flyout();
        this.app.tools.set(s.current);
      };
      b.oncontextmenu = (e) => (e.preventDefault(), s.ids.length > 1 && flyout());
      if (s.ids.length > 1) b.append(h('span.slot-more', { 'aria-hidden': 'true' }));
      b.dataset.tool = s.current;
      s.el = b;
      s.refresh = () => {
        b.firstChild.className = `ph ph-${t().icon}`;
        b.title = tip();
        b.setAttribute('aria-label', tip());
        b.dataset.tool = s.current;
      };
      s.refresh();
      bar.append(b);
    }
    this.pluginBar = h('div', { style: { display: 'contents' } });
    bar.append(this.pluginBar);
  }

  /** A pop-up list under (or beside) a button: [{ label, icon, run, checked, key, keep }] and '-' / 'Heading'. */
  popAt(anchor, items, { side = 'below', keep = false } = {}) {
    const pop = this.$('menu-pop');
    const render = () =>
      pop.replaceChildren(
        ...items.map((it) => {
          if (it === '-') return h('hr');
          if (typeof it === 'string') return h('div.overline', {}, t(it));
          const on = it.checked?.();
          return h(
            'button',
            { role: 'menuitem', 'aria-checked': it.checked ? String(!!on) : undefined, onclick: async () => (it.keep || keep ? (await it.run(), render()) : (this.closeMenu(), it.run())) },
            on ? icon('check') : icon(it.icon || 'dot-outline'),
            t(it.label),
            it.key ? h('span.key', {}, it.key) : null,
          );
        }),
      );
    this.closeMenu();
    render();
    this.openName = '(pop)';
    const r = anchor.getBoundingClientRect();
    pop.hidden = false;
    const w = pop.offsetWidth;
    const left = side === 'right' ? r.right + 6 : Math.min(r.left, innerWidth - w - 8);
    const top = Math.max(8, Math.min(side === 'right' ? r.top : r.bottom + 4, innerHeight - pop.offsetHeight - 8)); // stays on screen
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
  }
  addPluginButton({ icon: ic = 'puzzle-piece', label, run }) {
    if (!this.pluginBar.children.length) this.pluginBar.append(h('hr'));
    this.pluginBar.append(iconBtn(ic, label, run));
  }
  onTool(id) {
    for (const s of this.slots || []) {
      if (s === '-') continue;
      if (s.ids.includes(id)) (s.current = id), s.refresh();
      s.el.setAttribute('aria-pressed', String(s.ids.includes(id)));
    }
    this.renderViewbar?.();
    this.$('vcb').value = '';
  }

  /**
   * The floating view bar (#174, #194): standard views and navigation tools as two drop-downs, zoom extents, the
   * number of views, a display panel whose toggles stay open, and the timeline.
   */
  buildViewbar() {
    const vb = this.$('viewbar');
    const A = this.actions;
    const btn = (ic, label, onclick, pressed) => h('button.icon-btn.sm', { title: label, 'aria-label': label, onclick, 'aria-pressed': pressed === undefined ? undefined : String(!!pressed) }, icon(ic));
    const drop = (ic, label, items) => {
      const b = h('button.icon-btn.sm.drop', { title: label, 'aria-label': label, 'aria-haspopup': 'menu' }, icon(ic), icon('caret-down'));
      b.onclick = () => this.popAt(b, items());
      return b;
    };
    const NAV = ['orbit', 'pan', 'zoomwin', 'walk'];
    const render = () => {
      const s = this.app.store.doc.settings;
      const tool = this.app.tools?.id;
      const navTool = TOOLS.find((x) => x.id === (NAV.includes(tool) ? tool : 'orbit'));
      // projection and wireframe of the pane last worked in (#205)
      const panes = this.app.panes;
      const multi = panes?.layout.count > 1;
      const pane = multi ? panes.focusI + 1 : 1;
      const cfg = multi ? panes.layout.panes[pane - 1] : null;
      const parallel = (pane === 1 ? s.projection : cfg?.projection) === 'parallel';
      const wire = multi ? cfg?.style === 'wireframe' : !!s.wireframe;
      const run = (n, a) => this.app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
      vb.replaceChildren(
        btn('cursor', 'Select (Space)', () => this.app.tools.set('select'), tool === 'select'),
        btn('perspective', parallel ? 'Parallel projection: click for perspective' : 'Perspective: click for parallel projection', () => run('set_pane', { pane, projection: parallel ? 'perspective' : 'parallel' }), parallel),
        btn('cube-transparent', 'Wireframe', () => (multi ? run('set_pane', { pane, style: wire ? 'shaded' : 'wireframe' }) : A.wireframe.run()), wire),
        h('span.sep'),
        drop('cube', 'Standard views (in the pane you last worked in)', () => ['iso', 'top', 'front', 'right', 'left', 'back'].map((v) => ({ label: `${A[v].label} view`, icon: A[v].icon, run: A[v].run }))),
        drop(navTool.icon, 'Navigate: orbit, pan, zoom window, walk', () => NAV.map((id) => TOOLS.find((x) => x.id === id)).map((x) => ({ label: tr(x.label), icon: x.icon, key: x.key, checked: () => this.app.tools.id === x.id, run: () => this.app.tools.set(x.id) }))),
        btn('corners-out', 'Zoom extents (Shift+Z)', () => A.zoomExtents.run()),
        drop('squares-four', 'Views: one, two, three or four panes', () => ['layout1', 'layout2', 'layout2Rows', 'layout3', 'layout4', '-', 'fitPanes'].map((k) => (k === '-' ? k : { label: A[k].label, icon: A[k].icon, run: A[k].run }))),
        h('span.sep'),
        drop('eye', 'Display: edges, x-ray, shadows, grid, style… (stays open)', () => this.displayItems()),
        drop('magnet', 'Snaps: which points and faces the drawing tools snap to (stays open)', () => this.snapSettings()),
        ...['edges', 'shadows'].map((k) => btn(A[k].icon, A[k].label, A[k].run, s[k])),
        h('span.sep'),
        btn('film-strip', 'Timeline (Ctrl+T)', A.timeline.run, this.app.timeline.active),
        btn('sidebar-simple', 'Side panel (Ctrl+B)', A.sidePanel.run, !document.body.classList.contains('no-dock')),
      );
    };
    this.renderViewbar = render;
    new ResizeObserver(() => render()).observe(vb.parentElement);
  }

  /**
   * One Export dialog (#192): choose what (the model, the selection, a picture, a video, a drawing, survey points),
   * then the format. Every choice runs the command it always did (export, render_video, export_drawing…).
   */
  async exportDialog(what = 'model') {
    const A = this.actions;
    const app = this.app;
    const fmt = (format, label) => ({ label, run: (selection) => app.reg.run('export', { format, ...(selection ? { selection: true } : {}) }) });
    const MODEL = [fmt('glb', 'GLB: one compact 3D file'), fmt('gltf', 'glTF'), fmt('obj', 'OBJ'), fmt('stl', 'STL (3D printing)'), fmt('3mf', '3MF (3D printing, with colours)'), fmt('usdz', 'USDZ (AR on iPhone and iPad)'), fmt('usda', 'OpenUSD (.usda text)'), fmt('ifc', 'IFC (BIM)'), fmt('dxf', 'DXF (CAD)'), fmt('landxml', 'LandXML (surfaces, alignments, points)'), fmt('geojson', 'GeoJSON (GIS)'), fmt('shp', 'Shapefile (GIS)')];
    const act = (label, id) => ({ label, run: () => A[id].run() });
    const WHAT = {
      model: ['The whole model', 'cube', [...MODEL, act('Web viewer: one HTML page that opens anywhere', 'webViewer'), act('Compress a GLB (meshopt or Draco)', 'compress')]],
      selection: ['The selection', 'selection', MODEL],
      image: ['A picture of the view', 'image', [act('PNG of the view', 'exportPng'), act('Photoreal still (path traced)', 'renderImage'), act('AI render', 'aiRender')]],
      video: ['A video of the animation', 'film-strip', [act('MP4, WebM, GIF or PNG frames', 'exportVideo')]],
      drawing: ['A drawing', 'file-pdf', [act('Drawing sheet (PDF, SVG)', 'exportDrawing'), act('Section (SVG, DXF)', 'exportSection')]],
      survey: ['Survey points', 'map-pin', [act('Points file (CSV, JobXML, LandXML…)', 'exportPoints')]],
    };
    const hasSel = app.selection.length > 0;
    if (what === 'selection' && !hasSel) what = 'model';
    const format = h('select', { 'aria-label': 'Format' });
    const fill = () => format.replaceChildren(...WHAT[what][2].map((f, i) => h('option', { value: i }, f.label)));
    const choices = h(
      'div.export-what',
      { role: 'radiogroup', 'aria-label': 'What to export' },
      ...Object.entries(WHAT).map(([k, [label, ic]]) =>
        h('label.export-choice', {}, h('input', { type: 'radio', name: 'export-what', value: k, checked: k === what, disabled: k === 'selection' && !hasSel, onchange: () => ((what = k), fill()) }), icon(ic), h('span', {}, label + (k === 'selection' && !hasSel ? ' (select something first)' : ''))),
      ),
    );
    fill();
    const body = h('div.panel.form', { style: { padding: 0 } }, h('p.small.muted', {}, 'What do you want to export? Then pick the format.'), choices, h('label.field', {}, h('span', {}, 'Format'), format));
    if ((await this.modal('Export', body, [['Export…', 'go'], ['Cancel', null]])) !== 'go') return;
    try {
      const r = await WHAT[what][2][+format.value].run(what === 'selection');
      if (r?.path) this.toast(`Saved ${r.path}`);
      return r;
    } catch (e) {
      this.toast(e.message, 'danger');
    }
  }

  /** Right-click in a view (#193): what can be done to what is under the pointer, or to the view itself. */
  contextMenu(ev) {
    const app = this.app;
    const A = this.actions;
    const vp = app.viewport;
    const T = app.tools;
    const a = (id, label) => A[id] && { label: label || A[id].label, icon: A[id].icon, key: A[id].key, run: A[id].run };
    let items;
    if (T.tool?.busy?.()) {
      items = [
        { label: 'Finish', icon: 'check', key: 'Enter', run: () => T.guard(() => (T.tool.finish ? T.tool.finish() : T.tool.cancel?.())) },
        { label: 'Cancel', icon: 'x', key: 'Esc', run: () => (T.tool.cancel?.(), T.clear()) },
        ...(this.snapItems ? ['-', ...this.snapItems()] : []),
      ];
    } else {
      const mesh = vp.pick(ev);
      // Ask… (#244): a prompt right here, with what is under the pointer
      const ask = { label: 'Ask…', icon: 'chat-teardrop-dots', key: 'Ctrl+Space', run: () => app.agents.askAt(ev.clientX, ev.clientY, mesh?.point?.toArray()) };
      const hit = vp.pickAnnotation(ev) || vp.pickPoint() || mesh || vp.pickCurve() || vp.pickUnderlay();
      if (hit) {
        const id = app.pickTarget(hit.entityId);
        if (!app.selection.includes(id)) app.select([id]);
      }
      const ents = app.selection.map((id) => app.entity(id)).filter(Boolean);
      if (ents.length) {
        const one = ents.length === 1 ? ents[0] : null;
        const pts = ents.filter((e) => e.type === 'point');
        const extra = [];
        const brk = ents.filter((e) => S.isLinework(e) || e.curve);
        if (pts.length >= 3) extra.push({ label: `Create a surface from these ${pts.length} points${brk.length ? ` and ${brk.length} line${brk.length > 1 ? 's' : ''}` : ''}`, icon: 'mountains', run: () => app.reg.run('create_surface', { points: pts.map((p) => p.id), ...(brk.length ? { breaklines: brk.map((l) => l.id) } : {}), name: 'Surface' }).then((r) => this.toast(`${r.name}: ${r.triangles ?? ''} triangles`)).catch((e) => this.toast(e.message, 'danger')) });
        if (one?.derived?.generator === 'corridor') extra.push(a('roadViews'), a('corridorSurface'), a('corridorVolumes'), a('corridorSolids'));
        if (one?.alignment) extra.push({ label: 'Corridor along this alignment…', icon: 'road-horizon', run: () => this.commandDialog('create_corridor', { alignment: one.name }) });
        if (one && (one.meta?.surface || one.derived?.generator === 'surface')) extra.push(a('editSurface'), a('contours'), a('analyze'));
        items = [
          one ? one.name : `${ents.length} selected`,
          ask,
          '-',
          ...extra.filter(Boolean),
          ...(extra.length ? ['-'] : []),
          a('zoomSel'),
          a('hide'),
          a('isolate'),
          '-',
          a('group'),
          ...(one?.type === 'group' ? [a('ungroup')] : []),
          a('makeComponent'),
          a('duplicate'),
          a('copy'),
          '-',
          a('exportSelection'),
          a('lock'),
          a('delete'),
          '-',
          a('properties'),
        ];
      } else items = [ask, '-', a('paste'), a('selectAll'), a('unhideAll'), a('sectionPlanes'), '-', a('zoomExtents'), ...['iso', 'top', 'front', 'right'].map((v) => a(v, `${A[v].label} view`)), '-', a('layout1'), a('layout4'), '-', a('exportAll')];
    }
    const at = { getBoundingClientRect: () => ({ left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY }) };
    this.popAt(at, items.filter(Boolean));
  }

  /** Snap toggles (#180), kept open, and for the right-click menu while drawing: snap only to one kind next click. */
  snapSettings() {
    const now = () => ({ ...SNAPS, ...(this.app.store.doc.settings.snaps || {}) });
    return ['Snap to', ...Object.keys(SNAPS).map((k) => ({ label: SNAP_LABELS[k], icon: 'magnet', checked: () => now()[k] !== false, run: () => this.app.reg.run('set_snaps', { [k]: now()[k] === false }), keep: true }))];
  }
  snapItems() {
    const T = this.app.tools;
    return ['Next click snaps only to', ...['endpoint', 'midpoint', 'face', 'axis', 'grid'].map((k) => ({ label: SNAP_LABELS[k], icon: 'crosshair', checked: () => T.only === k, run: () => ((T.only = k), T.status(`Next click: ${SNAP_LABELS[k].toLowerCase()} only.`)) }))];
  }

  /** Section planes (#187): every plane in the model, which one cuts, and flip / move / delete for each. */
  async sectionPlanesDialog() {
    const app = this.app;
    const body = h('div', {});
    const render = async () => {
      const r = await app.reg.run('list_section_planes', {});
      const go = (args) => app.reg.run('set_section_plane', args).then(render).catch((e) => this.toast(e.message, 'danger'));
      const btn = (ic, label, onclick, pressed) => h('button.icon-btn.sm', { title: label, 'aria-label': label, onclick, 'aria-pressed': pressed === undefined ? undefined : String(!!pressed) }, icon(ic));
      body.replaceChildren(
        r.planes.length
          ? h(
              'div.qty',
              {},
              h(
                'table',
                {},
                h('thead', {}, h('tr', {}, ...['Plane', 'Cuts', '', '', '', ''].map((c) => h('th', {}, c)))),
                h(
                  'tbody',
                  {},
                  r.planes.map((p) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, p.name),
                      h('td', {}, btn(p.active ? 'eye' : 'eye-slash', p.active ? 'Cutting: click to stop' : 'Cut with this plane', () => go({ name: p.name, active: !p.active }), p.active)),
                      h('td', {}, btn('arrows-left-right', 'Flip: cut away the other side', () => go({ name: p.name, flip: true }))),
                      h('td', {}, btn('minus', 'Move back 0.5 m', () => go({ name: p.name, offset: -0.5 }))),
                      h('td', {}, btn('plus', 'Move forward 0.5 m', () => go({ name: p.name, offset: 0.5 }))),
                      h('td', {}, btn('trash', 'Delete this plane', () => app.reg.run('delete_section_plane', { name: p.name }).then(render))),
                    ),
                  ),
                ),
              ),
            )
          : h('p.small', {}, 'No section planes yet. Use the Section Plane tool (X) on a face, or the section command.'),
        h('p.small.muted', {}, 'One plane cuts at a time; the others wait in the list. Section fill (View) closes the cut solids.'),
      );
    };
    await render();
    this.modal('Section planes', body);
  }

  /** Pick a coordinate system from a place or words (#189): suggestions with their EPSG codes, one click to use. */
  async crsDialog() {
    const app = this.app;
    const geo = app.store.doc.settings.geolocation || {};
    const lat = h('input', { type: 'number', step: 'any', value: geo.latitude ?? '', placeholder: '48.85', 'aria-label': 'Latitude' });
    const lon = h('input', { type: 'number', step: 'any', value: geo.longitude ?? '', placeholder: '2.35', 'aria-label': 'Longitude' });
    const words = h('input', { placeholder: 'a country, a name, UTM 31…', 'aria-label': 'Words' });
    const list = h('div', {});
    const cur = app.store.doc.geo?.crs;
    const find = async () => {
      const args = { ...(lat.value !== '' && lon.value !== '' ? { latitude: +lat.value, longitude: +lon.value } : {}), ...(words.value.trim() ? { query: words.value.trim() } : {}) };
      try {
        const r = await app.reg.run('suggest_coordinate_systems', args);
        list.replaceChildren(
          r.systems.length
            ? h(
                'div.qty',
                {},
                h(
                  'table',
                  {},
                  h('thead', {}, h('tr', {}, ...['EPSG', 'Name', 'Where', ''].map((c) => h('th', {}, c)))),
                  h(
                    'tbody',
                    {},
                    r.systems.map((s) =>
                      h(
                        'tr',
                        {},
                        h('td', {}, String(s.epsg)),
                        h('td', { style: { textAlign: 'left' } }, s.name),
                        h('td', { style: { textAlign: 'left' }, title: s.why }, s.area),
                        h('td', {}, h('button.btn.sm' + (cur?.epsg === s.epsg ? '' : '.primary'), { onclick: async () => {
                          await app.reg.run('set_coordinate_system', { epsg: s.epsg, name: s.name });
                          if (args.latitude !== undefined && (geo.latitude !== args.latitude || geo.longitude !== args.longitude)) await app.reg.run('set_geolocation', { latitude: args.latitude, longitude: args.longitude });
                          this.toast(`Coordinate system: EPSG:${s.epsg} ${s.name}`);
                          this.closeModal();
                        } }, cur?.epsg === s.epsg ? 'In use' : 'Use')),
                      ),
                    ),
                  ),
                ),
              )
            : h('p.small', {}, 'Nothing found: try a country name or a UTM zone.'),
        );
      } catch (e) {
        list.replaceChildren(h('p.small', {}, e.message));
      }
    };
    const body = h(
      'div.panel.form',
      { style: { padding: 0 } },
      h('p.small.muted', {}, `Where is the project? Give its latitude and longitude (from a map, or the geolocation), or words such as a country. ${cur ? `Now: ${cur.epsg ? `EPSG:${cur.epsg} ` : ''}${cur.name || ''}.` : ''}`),
      h('div.row', {}, h('label.field.grow', {}, h('span', {}, 'Latitude'), lat), h('label.field.grow', {}, h('span', {}, 'Longitude'), lon)),
      h('label.field', {}, h('span', {}, 'Or words'), words),
      h('div.row', {}, h('button.btn.sm', { onclick: find }, icon('magnifying-glass'), 'Suggest'), h('button.btn.sm', { onclick: () => (this.closeModal(), app.pickLocation()) }, icon('map-trifold'), 'Pick on a map…')),
      list,
    );
    for (const el of [lat, lon, words]) el.onkeydown = (e) => void (e.key === 'Enter' && find()); // void: an onkeydown returning false swallows the key
    if (geo.latitude !== undefined || words.value) find();
    this.modal('Coordinate system', body);
  }
  /** The base point at a clicked model point (#190): its coordinates and grid north. */
  async basePointDialog(at) {
    const app = this.app;
    const g = app.store.doc.geo || {};
    const b = g.base || [0, 0, 0];
    const cur = { e: b[0] + at[0], n: b[1] - at[2], z: b[2] + at[1] };
    const f = (label, v) => h('label.field', {}, h('span', {}, label), h('input', { type: 'number', step: 'any', value: Math.round(v * 1000) / 1000 }));
    const fe = f('Easting', cur.e);
    const fn = f('Northing', cur.n);
    const fz = f('Elevation', cur.z);
    const fa = f('Grid north (° clockwise from the model\'s −z)', app.store.doc.settings.geolocation?.north_angle || 0);
    const body = h('div.panel.form', { style: { padding: 0 } }, h('p.small.muted', {}, `The point you clicked (${at.map((x) => x.toFixed(2)).join(', ')} in the model): what are its real coordinates? Nothing moves; the model is georeferenced around it.`), fe, fn, fz, fa);
    if ((await this.modal('Base point', body, [['Set', 'go'], ['Cancel', null]])) !== 'go') return;
    const val = (x) => +x.querySelector('input').value;
    return app.reg.run('set_base_point', { at, e: val(fe), n: val(fn), z: val(fz), north_angle: val(fa) }).then((r) => this.toast(`Base point E ${r.base[0]} N ${r.base[1]} Z ${r.base[2]}`)).catch((e) => this.toast(e.message, 'danger'));
  }

  /** The display toggles (#194): they keep the list open, like a panel. */
  displayItems() {
    const A = this.actions;
    const s = () => this.app.store.doc.settings;
    const set = (k, v) => this.app.reg.run('set_style', { [k]: v });
    return [
      'Show',
      ...['edges', 'xray', 'wireframe', 'shadows', 'grid', 'sectionFill'].filter((k) => A[k]).map((k) => ({ label: A[k].label, icon: A[k].icon, checked: A[k].checked, run: A[k].run, keep: true })),
      { label: 'Point labels', icon: 'tag', checked: () => (s().point_labels ?? 'name') !== 'none', run: () => set('point_labels', (s().point_labels ?? 'name') === 'none' ? 'name' : 'none'), keep: true },
      { label: 'Snap to drawings (PDF)', icon: 'magnet', checked: () => !!s().snap_underlays, run: () => set('snap_underlays', !s().snap_underlays), keep: true },
      'Style',
      ...[['shaded', 'Shaded'], ['hidden_line', 'Hidden line'], ['monochrome', 'Monochrome'], ['sketchy', 'Sketchy']].map(([v, label]) => ({ label, icon: 'paint-brush', checked: () => (s().render_style || 'shaded') === v, run: () => set('render_style', v), keep: true })),
      'Colour by',
      ...[['material', 'Material'], ['layer', 'Layer']].map(([v, label]) => ({ label, icon: 'palette', checked: () => (s().color_by || 'material') === v, run: () => set('color_by', v), keep: true })),
    ];
  }

  // ---------------------------------------------------------------- dock
  buildTabs() {
    this.tabs = [
      ['ai', 'AI', 'sparkle'],
      ['agents', 'Agents', 'users-three'],
      ['outliner', 'Outliner', 'tree-structure'],
      ['entity', 'Entity', 'info'],
      ['materials', 'Materials', 'palette'],
      ['scenes', 'Scenes', 'camera'],
      ['library', 'Library', 'books'],
      ['survey', 'Survey', 'map-pin'],
      ['settings', 'Settings', 'gear'],
      ['help', 'Help', 'question'],
      ['tool', 'Tool', 'crosshair'], // shown while a command picks (#235)
    ];
    // a vertical strip on the right (#user: horizontal tabs were hard to track); the top button retracts it all
    this.$('dock-tabs').replaceChildren(
      // the side panel's hide / show (Ctrl+B): the strip stays, like the tools on the left
      h('button.icon-btn.dock-retract', { title: t('Hide the panels (Ctrl+B)'), 'aria-label': t('Hide the panels'), onclick: () => this.actions.sidePanel.run() }, icon('caret-double-right')),
      h('hr'),
      ...this.tabs.map(([id, label, ic]) => h('button.icon-btn', { role: 'tab', 'aria-selected': String(id === this.tab), onclick: () => (this.setSidePanel(true), this.show(id)), dataset: { tab: id }, 'aria-label': t(label), title: t(label), hidden: id === 'tool' && !this.app.pickFirst?.active }, icon(ic))),
    );
    this.retractIcon();
  }
  /** The strip's top button says what it does: hide the panels, or show them again. */
  retractIcon() {
    const on = !document.body.classList.contains('no-dock');
    const b = this.$('dock-tabs')?.querySelector('.dock-retract');
    if (b) (b.firstChild.className = `ph ph-caret-double-${on ? 'right' : 'left'}`), (b.title = t(on ? 'Hide the panels (Ctrl+B)' : 'Show the panels (Ctrl+B)')), b.setAttribute('aria-label', b.title);
  }
  /** The Tool tab (#235): shown and opened while a command picks, then back to the tab before. */
  toolTab(on, back = 'ai') {
    const b = this.$('dock-tabs').querySelector('[data-tab=tool]');
    if (b) b.hidden = !on;
    if (on) this.show('tool');
    else if (this.tab === 'tool') this.show(back === 'tool' ? 'ai' : back);
  }
  panel_tool() {
    return this.app.pickFirst.panel();
  }
  show(tab, focus = false) {
    this.tab = tab;
    if (focus) this.setSidePanel(true);
    for (const b of this.$('dock-tabs').querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === (tab === 'cogo' ? 'survey' : tab))); // COGO lives in the Survey tab
    this.renderDock();
    if (focus && tab === 'ai') this.app.ai.focus();
  }
  panel_help() {
    return this.app.help.panel();
  }
  panel_agents() {
    return this.app.agents.panel();
  }
  renderDock() {
    const body = this.$('dock-body');
    if (this.tab !== 'cogo') this.app.cogo?.unmount();
    if (this.tab === 'cogo') return this.app.cogo.mount(body), (body.dataset.tab = 'cogo');
    if (this.tab === 'ai') {
      if (body.firstChild !== this.app.ai.el) body.replaceChildren(this.app.ai.el);
      return;
    }
    // keep where the panel was scrolled to, and inner lists too (#204): a re-render no longer jumps to the top
    this.dockScroll ||= {};
    if (body.dataset.tab === this.tab) this.dockScroll[this.tab] = [body.scrollTop, ...[...body.querySelectorAll('.qty, .outline-tree')].map((x) => x.scrollTop)];
    const panel = tidyPanel(this[`panel_${this.tab}`](), this.tab, t(this.tabs?.find((x) => x[0] === this.tab)?.[1] || this.tab));
    body.replaceChildren(panel);
    body.dataset.tab = this.tab;
    const [top = 0, ...inner] = this.dockScroll[this.tab] || [];
    body.scrollTop = top;
    [...body.querySelectorAll('.qty, .outline-tree')].forEach((x, i) => inner[i] !== undefined && (x.scrollTop = inner[i]));
  }
  refresh() {
    if (this.tab !== 'ai') this.renderDock();
    this.renderViewbar();
    this.renderProposal();
    this.renderMacro();
    this.renderManager();
    this.app.tools?.tool?.renderBar?.(); // the in-view bar of a tool follows the library and the selection
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
  // ---------------------------------------------------------------- ribbons (#195, #197): tools by workflow, in tabs
  static RIBBONS = {
    Site: {
      Survey: ['survey', 'importPoints', 'tool:point', 'addPoint', 'cogo', 'featureCode', 'loadLibrary', 'processCodes', 'exportPoints', 'coordSys', 'basePoint', 'mapPick'],
      Surfaces: ['surface', 'editSurface', 'breakline', 'boundary', 'checkSurface', 'importTerrain', 'groundFromCloud', 'contours', 'contourZ', 'analyze', 'smooth', 'fromContours'],
      Design: ['pad', 'stamp', 'newTerrain', 'tool:sculpt', 'drape', 'drapeImage', 'water', 'trench', 'lineSlope', 'plane', 'offsetSurface', 'road'],
      Roads: ['alignment', 'corridor', 'editCorridor', 'roadViews', 'corridorSurface', 'applyCorridor', 'profile', 'sections'],
      Earthworks: ['cutFill', 'volumeReport', 'corridorVolumes', 'corridorSolids'],
      Materials: ['tool:matbrush', 'materialManager'],
    },
    Drawings: {
      '1 Bring in': ['importPdf', 'importImage', 'readDrawing', 'vectorise'],
      '2 Scale': ['tool:calibrate', 'drawingScale', 'snapDrawings'],
      '3 Place on the map': ['tool:control', 'georef', 'georefReport', 'worldFile'],
      '4 Take lines out': ['pdfStats', 'extract', 'drawingText', 'textToPoints', 'labelContours'],
      '5 Clean up': ['tool:trim', 'tool:extend', 'tool:split', 'tool:join', 'offset', 'fillet', 'chamfer', 'joinCurves', 'explode', 'simplify', 'divide'],
      '6 To the model': ['elevate', 'toBreaklines', 'extrudeLines', 'sweepLines'],
    },
  };
  /** Show a ribbon (Site, Drawings) on one of its tabs, or hide it (null). */
  /** Every ribbon: Site and Drawings by workflow, and one per long menu, a tab per section of it (#209). */
  ribbons() {
    const out = {};
    for (const m of ['Tools', 'Edit', 'Arrange', 'View', 'Animate']) {
      const tabs = {};
      let cur = 'Main';
      for (const id of this.menus[m] || []) {
        if (id === '-') continue;
        if (!this.actions[id] && !id.startsWith('tool:')) cur = id;
        else (tabs[cur] ||= []).push(id);
      }
      out[m === 'Tools' ? 'Draw and modify' : m] = tabs;
    }
    return { ...out, ...UI.RIBBONS };
  }
  setRibbon(name, tab = null) {
    const R = this.ribbons();
    this.ribbon = name && R[name] ? { name, tab: tab && R[name][tab] ? tab : this.ribbon?.name === name ? this.ribbon.tab : Object.keys(R[name])[0] } : null;
    try {
      localStorage.setItem('mymodellerreel.ribbon', JSON.stringify(this.ribbon));
    } catch {}
    this.renderRibbon();
  }
  /** Show or hide the side panel (#236): hidden, only its tab icons stay and the view takes the width. */
  setSidePanel(on) {
    if (on === !document.body.classList.contains('no-dock')) return;
    document.body.classList.toggle('no-dock', !on);
    try {
      localStorage.setItem('mymodellerreel.dock', on ? '1' : '0');
    } catch {}
    this.renderViewbar?.();
    this.retractIcon();
    this.app.viewport.dirty = true;
  }
  /** Show or hide the side toolbar (#209): with a ribbon open, its tools are there. */
  setSideToolbar(on) {
    document.body.classList.toggle('no-toolbar', !on);
    try {
      localStorage.setItem('mymodellerreel.toolbar', on ? '1' : '0');
    } catch {}
    this.app.viewport.dirty = true;
  }
  renderRibbon() {
    let el = this.$('ribbon');
    if (!el) {
      el = h('div.ribbon', { id: 'ribbon', role: 'toolbar', 'aria-label': 'Ribbon' });
      document.querySelector('.workspace').prepend(el);
    }
    el.hidden = !this.ribbon;
    if (!this.ribbon) return void (this.app.viewport.dirty = true);
    const { name, tab } = this.ribbon;
    const tabs = this.ribbons()[name];
    const item = (id) => {
      if (id.startsWith('tool:')) {
        const t = TOOLS.find((x) => x.id === id.slice(5));
        return t && h('button.ribbon-btn', { title: tr(t.label), 'aria-pressed': String(this.app.tools.id === t.id), onclick: () => (this.app.tools.set(t.id), this.renderRibbon()) }, icon(t.icon), h('span', {}, tr(t.label).replace(/\s*\(.*$/, '')));
      }
      const a = this.actions[id];
      return a && h('button.ribbon-btn', { title: t(a.label), onclick: () => a.run() }, icon(a.icon || 'dot-outline'), h('span', {}, t(a.label).replace(/…$/, '').replace(/\s*\(.*$/, '').replace(/:.*$/, '')));
    };
    el.replaceChildren(
      h('div.ribbon-tabs', {}, h('select', { 'aria-label': 'Ribbon', onchange: (e) => this.setRibbon(e.target.value) }, Object.keys(this.ribbons()).map((n) => h('option', { value: n, selected: n === name }, t(n)))), ...Object.keys(tabs).map((k) => h('button.ribbon-tab', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => this.setRibbon(name, k) }, k)), h('span.spacer'), h('button.icon-btn.sm', { title: 'Hide the ribbon', 'aria-label': 'Hide the ribbon', onclick: () => this.setRibbon(null) }, icon('x'))),
      h('div.ribbon-body', {}, ...tabs[tab].map(item).filter(Boolean)),
    );
    this.app.viewport.dirty = true;
  }

  onSelection() {
    // a drawing selected: offer its workflow (#197), once, if no ribbon is open
    const one = this.app.selection.length === 1 && this.app.entity(this.app.selection[0]);
    if (one?.underlay && !this.ribbon && !this.ribbonOffered) (this.ribbonOffered = true), this.setRibbon('Drawings', one.underlay.affine ? '2 Scale' : '1 Bring in');
    if (this.tab === 'outliner' || this.tab === 'entity') this.renderDock();
    const n = this.app.selection.length;
    if (n && this.app.tools.id === 'select') this.setStatus(n === 1 ? `${this.app.entity(this.app.selection[0])?.name} selected.` : `${n} selected.`);
  }

  panel_outliner() {
    const app = this.app;
    const doc = app.store.doc;
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    return h(
      'div.panel',
      {},
      h('div.row', {}, h('h3.grow', {}, 'Outliner'), h('span.muted.small', {}, `${doc.entities.length} entities`)),
      doc.entities.length ? this.outlineTree(run) : h('p.muted', {}, 'Nothing here yet. Draw with the tools on the left, or ask the AI to build something.'),
      h('div.row', {}, h('div.overline.grow', {}, 'Layers'), h('button.icon-btn.sm', { title: 'New layer', 'aria-label': 'New layer', onclick: () => this.actions.newLayer.run() }, icon('plus'))),
      h('div.tree', {}, this.layerRows(doc, run)),
      h('label.row.small', {}, h('input', { type: 'checkbox', checked: doc.settings.color_by === 'layer', onchange: (ev) => run('set_style', { color_by: ev.target.checked ? 'layer' : 'material' }) }), 'Colour by layer'),
      h('div.row', {}, h('div.overline.grow', {}, 'Selection sets'), h('button.icon-btn.sm', { title: 'Save the selection as a set', 'aria-label': 'Save the selection as a set', onclick: () => this.actions.saveSelection.run() }, icon('plus'))),
      Object.keys(doc.selection_sets || {}).length
        ? h('div.chips', {}, ...Object.entries(doc.selection_sets).map(([name, ids]) => h('span.chip', {}, h('button.chip-main', { title: `Select ${ids.length}`, onclick: () => run('select_set', { name }) }, `${name} · ${ids.length}`), h('button.chip-x', { title: 'Forget this set', 'aria-label': `Forget ${name}`, onclick: () => run('delete_selection_set', { name }) }, icon('x')))))
        : h('p.muted.small', {}, 'Select things and press + to name the selection.'),
    );
  }

  /**
   * The outliner as a tree (#203): grouped by hierarchy, type or layer, folders that fold, a search box, Ctrl / Shift
   * to select several, drag onto a group to move things in (or onto the list to take them out), rename in place.
   */
  outlineTree(run) {
    const app = this.app;
    const doc = app.store.doc;
    this.outline ||= { by: 'hierarchy', q: '', open: new Set(['Groups and shapes']) };
    const o = this.outline;
    const q = o.q.toLowerCase();
    const match = (e) => !q || e.name.toLowerCase().includes(q) || (e.tag || '').toLowerCase().includes(q) || (e.point?.code || '').toLowerCase().includes(q);
    const kind = (e) => (e.type === 'point' ? 'Survey points' : e.annotation ? 'Dimensions and labels' : e.underlay ? 'Drawings' : e.pointcloud ? 'Point clouds' : e.alignment ? 'Alignments' : e.meta?.surface || e.derived?.generator === 'surface' || e.derived?.generator === 'finished_ground' ? 'Surfaces' : e.curve ? 'Lines and curves' : 'Groups and shapes');
    const iconOf = (e) => (e.xref ? 'link-simple' : e.component ? 'squares-four' : e.type === 'group' ? 'folder-simple' : e.alignment ? 'path' : e.curve ? 'bezier-curve' : e.underlay ? (e.underlay.kind === 'pdf' ? 'file-pdf' : 'image') : e.type === 'point' ? 'map-pin' : e.annotation ? 'ruler' : 'cube');
    const order = [];
    const row = (e, depth) => {
      order.push(e.id);
      const animated = doc.animation.tracks.some((t) => t.target === e.id);
      const name = h(`span.name${e.visible ? '' : '.dim'}`, { title: `${e.name} (${e.id}) · double-click to rename` }, e.name);
      name.ondblclick = (ev) => {
        ev.stopPropagation();
        const inp = h('input.rename', { value: e.name, 'aria-label': `Rename ${e.name}` });
        const done = (ok) => (ok && inp.value.trim() && inp.value.trim() !== e.name ? run('set_properties', { ids: [e.id], name: inp.value.trim() }) : this.renderDock());
        inp.onkeydown = (k) => (k.key === 'Enter' ? done(true) : k.key === 'Escape' ? done(false) : null);
        inp.onblur = () => done(true);
        name.replaceWith(inp);
        inp.focus();
        inp.select();
      };
      const isGroup = e.type === 'group';
      const kids = isGroup && o.by === 'hierarchy' ? doc.entities.filter((x) => x.parent === e.id) : [];
      const open = o.open.has(e.id);
      const r = h(
        `div.tree-row${app.selection.includes(e.id) ? '.sel' : ''}`,
        {
          style: { paddingLeft: `${6 + depth * 14}px` },
          draggable: 'true',
          onclick: (ev) => {
            if (ev.shiftKey && this.outlineAnchor) {
              const [i, j] = [order.indexOf(this.outlineAnchor), order.indexOf(e.id)].sort((x, y) => x - y);
              return app.select([...new Set([...app.selection, ...order.slice(i, j + 1)])]);
            }
            this.outlineAnchor = e.id;
            app.select(ev.ctrlKey || ev.metaKey ? (app.selection.includes(e.id) ? app.selection.filter((x) => x !== e.id) : [...app.selection, e.id]) : [e.id]);
          },
          ondblclick: () => run('zoom_extents', { ids: [e.id] }),
          ondragstart: (ev) => ev.dataTransfer.setData('text/x-mmr-ids', JSON.stringify(app.selection.includes(e.id) ? app.selection : [e.id])),
          ...(isGroup
            ? {
                ondragover: (ev) => (ev.preventDefault(), r.classList.add('drop')),
                ondragleave: () => r.classList.remove('drop'),
                ondrop: (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  const ids = JSON.parse(ev.dataTransfer.getData('text/x-mmr-ids') || '[]').filter((x) => x !== e.id);
                  if (ids.length) o.open.add(e.id), run('set_parent', { ids, parent: e.id });
                },
              }
            : {}),
        },
        kids.length ? h('button.tree-fold', { 'aria-label': open ? 'Fold' : 'Unfold', onclick: (ev) => (ev.stopPropagation(), open ? o.open.delete(e.id) : o.open.add(e.id), this.renderDock()) }, icon(open ? 'caret-down' : 'caret-right')) : h('span.tree-fold'),
        icon(iconOf(e)),
        e.mesh || e.curve ? h('span.swatch-dot', { style: { background: L.colorOf(doc, e) } }) : null,
        name,
        kids.length ? h('span.muted.small', {}, kids.length) : null,
        animated ? icon('film-strip') : null,
        ...(e.xref
          ? [
              h('button.icon-btn.sm', { title: `Live reference to ${e.xref.path}: reload it`, 'aria-label': 'Reload reference', onclick: (ev) => (ev.stopPropagation(), run('reload_reference', { ids: [e.id] })) }, icon('arrows-clockwise')),
              h('button.icon-btn.sm', { title: 'Bind: make it local (stops following the file)', 'aria-label': 'Bind reference', onclick: (ev) => (ev.stopPropagation(), run('bind_reference', { ids: [e.id] })) }, icon('link-break')),
              h('button.icon-btn.sm', { title: 'Remove the reference', 'aria-label': 'Remove reference', onclick: (ev) => (ev.stopPropagation(), run('delete', { ids: [e.id] })) }, icon('trash')),
            ]
          : []),
        h('button.icon-btn.sm', { title: e.visible ? 'Hide' : 'Show', 'aria-label': e.visible ? 'Hide' : 'Show', onclick: (ev) => (ev.stopPropagation(), run('set_properties', { ids: [e.id], visible: !e.visible })) }, icon(e.visible ? 'eye' : 'eye-slash')),
        h('button.icon-btn.sm', { title: e.locked ? 'Unlock' : 'Lock', 'aria-label': e.locked ? 'Unlock' : 'Lock', onclick: (ev) => (ev.stopPropagation(), run('set_properties', { ids: [e.id], locked: !e.locked })) }, icon(e.locked ? 'lock-simple' : 'lock-simple-open')),
      );
      return [r, ...(open || q ? kids.filter((k) => match(k) || q === '').flatMap((k) => row(k, depth + 1)) : [])];
    };
    const folder = (key, label, ents) => {
      const open = o.open.has(key) || !!q;
      const ids = ents.map((e) => e.id);
      return [
        h(
          'div.tree-row.tree-folder',
          { onclick: () => (open ? o.open.delete(key) : o.open.add(key), this.renderDock()), title: 'Click to fold or unfold' },
          h('span.tree-fold', {}, icon(open ? 'caret-down' : 'caret-right')),
          icon('folder-simple'),
          h('span.name', {}, label),
          h('span.muted.small', {}, ents.length),
          h('button.icon-btn.sm', { title: `Select all ${ents.length}`, 'aria-label': `Select ${label}`, onclick: (ev) => (ev.stopPropagation(), app.select(ids)) }, icon('selection-all')),
          h('button.icon-btn.sm', { title: 'Hide or show them all', 'aria-label': `Hide or show ${label}`, onclick: (ev) => (ev.stopPropagation(), run('set_properties', { ids, visible: !ents.every((e) => e.visible) })) }, icon(ents.every((e) => e.visible) ? 'eye' : 'eye-slash')),
        ),
        ...(open ? ents.flatMap((e) => row(e, 1)) : []),
      ];
    };
    const top = doc.entities.filter((e) => (o.by === 'hierarchy' ? !e.parent : true) && (match(e) || (e.type === 'group' && D.descendants(doc, e.id).some(match))));
    const groups = new Map();
    for (const e of top) {
      const key = o.by === 'layer' ? e.tag || 'Untagged' : kind(e);
      if (o.by !== 'layer' && o.by !== 'type' && key === 'Groups and shapes') continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    let rows;
    if (o.by === 'hierarchy') {
      // groups and shapes at the top level; the rest (points, lines, drawings…) folded into folders by kind
      const loose = top.filter((e) => kind(e) === 'Groups and shapes');
      rows = [...loose.flatMap((e) => row(e, 0)), ...[...groups].flatMap(([k, list]) => folder(k, k, list))];
    } else rows = [...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([k, list]) => folder(`${o.by}:${k}`, k, list));
    const search = h('input.outline-search', { value: o.q, placeholder: 'Search by name, layer or code', 'aria-label': 'Search the outliner', oninput: (ev) => ((o.q = ev.target.value), clearTimeout(this.outlineT), (this.outlineT = setTimeout(() => (this.renderDock(), this.$('dock-body').querySelector('.outline-search')?.focus()), 200))) });
    const by = h('div.segmented.small', { role: 'radiogroup', 'aria-label': 'Group by' }, ...[['hierarchy', 'Groups'], ['type', 'Type'], ['layer', 'Layer']].map(([v, l]) => h('button.seg', { type: 'button', 'aria-pressed': String(o.by === v), onclick: () => ((o.by = v), this.renderDock()) }, l)));
    const tree = h(
      'div.tree.outline-tree',
      {
        ondragover: (ev) => ev.preventDefault(),
        ondrop: (ev) => {
          const ids = JSON.parse(ev.dataTransfer.getData('text/x-mmr-ids') || '[]');
          if (ids.some((id) => app.entity(id)?.parent)) run('set_parent', { ids, parent: '' });
        },
      },
      rows.length ? rows : h('p.muted.small', {}, 'Nothing matches.'),
    );
    return h(
      'div.outline',
      {},
      h('div.row', {}, search),
      h('div.row', {}, by, h('span.grow'), h('button.btn.sm', { title: 'Group the selection (Ctrl+G)', disabled: app.selection.length < 1, onclick: () => this.actions.group.run() }, icon('stack'), 'Group')),
      tree,
      h('p.muted.small', {}, 'Ctrl or Shift selects several; drag onto a group to move them in, onto the list to take them out; double-click a name to rename it.'),
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
        h('p.small.muted', {}, 'Model, survey, draw and animate; ask Plumb in plain words. Pick a starting point:'),
        h('div.start-grid', {}, list.map((t) => h('button.start-card', { onclick: () => start(t.id) }, icon(ICON[t.id] || 'cube'), h('strong', {}, t.name), h('span.small.muted', {}, t.description)))),
        h('div.row.wrap', {}, h('button.btn', { onclick: () => (this.closeModal(), this.tour()) }, icon('compass'), 'Take the 2-minute tour'), h('button.btn', { onclick: () => (this.closeModal(), this.actions.open.run()) }, icon('folder-open'), 'Open a file…'), h('button.btn', { onclick: () => (this.closeModal(), this.actions.import.run()) }, icon('tray-arrow-down'), 'Import LandXML, IFC, DXF…')),
      ),
      [['Start empty', null]],
    );
  }

  /** The guided tour (#109): a highlight and a card per step, Back / Next / Skip, Esc to leave. */
  tour(i = 0) {
    const STEPS = [
      ['#viewport', 'The model', 'Orbit with the middle mouse (Alt + drag on a touchpad), pan with the right (Alt + Shift + drag), zoom with the wheel or a pinch. Z drags a zoom window; Shift+Z fits everything.'],
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
  /** Light up parts of a surface in the view without selecting them: entities, and a drawn path (points, voids). */
  peek(ids = [], path = null, closed = false) {
    this.app.viewport.peek(ids, path, closed);
  }

  /**
   * What a TIN is made of as counts (Points 120 · Breaklines 4 · Voids 1 · Boundary): each opens a list grouped by code
   * or layer; an item or a group lights up in the view, with its remove button; members are added from the selection.
   */
  surfaceMembers(e, d, run, { btn, x, edit, shown, toggle, pointIds, lineIds }) {
    const app = this.app;
    const doc = app.store.doc;
    const id = e.id;
    const p = SW.migrateSurface(e.derived.params);
    const open = this.surfOpen?.id === id ? this.surfOpen.kind : null;
    const zAt = SW.surfaceSampler(doc, e).z;
    const top = TR.surfaceStats(D.worldMesh(doc, e)).max_y;
    const onGround = (ring) => ring.map(([px, pz]) => [px, zAt(px, pz) ?? top, pz]);
    const selected = (test) => app.selection.map((i) => app.entity(i)).filter((x) => x && test(x));
    // the lists, grouped: [{ group, items: [{ label, ids?, path?, closed?, remove? }] }]
    const groupBy = (list, keyOf) => {
      const m = new Map();
      for (const it of list) (m.get(keyOf(it)) || m.set(keyOf(it), []).get(keyOf(it))).push(it);
      return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([group, items]) => ({ group, items }));
    };
    const pts = SW.surfaceSources(doc, p).points;
    const kinds = {
      points: {
        label: 'Points',
        count: d.points,
        groups: [
          ...groupBy(pts, (q) => S.parseCode(q.point.code).code || 'No code').map((g) => ({ ...g, items: g.items.map((q) => ({ label: q.name, ids: [q.id], remove: [`Leave ${q.name} out of this surface`, () => run('surface_points', { id, action: 'exclude', points: [q.id] })] })) })),
          ...(p.exclude.length ? [{ group: 'Left out', items: p.exclude.map((pid) => ({ label: app.entity(pid)?.name || pid, ids: [pid], bring: () => run('surface_points', { id, action: 'include', points: [pid] }) })) }] : []),
        ],
        actions: [
          btn('Add selected', 'plus-circle', () => {
            const sel = selected(S.isPoint);
            if (!sel.length) return this.toast('Select survey points first, then Add selected.');
            run('surface_points', { id, action: 'include', points: sel.map((q) => q.id) });
          }, 'Add the selected survey points'),
          btn('New', 'plus', edit('add'), 'Click to add a new point on the surface'),
          btn('Move', 'hand-pointing', edit('move')),
          pointIds.length ? btn(shown(pointIds) ? 'Hide' : 'Show', shown(pointIds) ? 'eye-slash' : 'eye', toggle(pointIds), 'Show or hide the points') : null,
        ],
      },
      breaklines: {
        label: 'Breaklines',
        count: d.breaklines.length + d.drawn_breaklines,
        groups: [
          ...groupBy(d.breaklines.map((l) => app.entity(l.id)).filter(Boolean), (l) => l.tag || 'No layer').map((g) => ({ ...g, items: g.items.map((l) => ({ label: l.name, ids: [l.id], remove: [`Stop using ${l.name} as a breakline`, () => run('surface_breaklines', { id, action: 'remove', line: l.id })] })) })),
          ...(p.lines.length ? [{ group: 'Drawn on the surface', items: p.lines.map((path, i) => ({ label: `Drawn line ${i + 1}`, path, remove: [`Remove drawn line ${i + 1}`, () => run('surface_breaklines', { id, action: 'remove', index: i })] })) }] : []),
        ],
        actions: [
          btn('Add selected', 'plus-circle', async () => {
            const sel = selected((l) => S.isLinework(l) || l.curve);
            if (!sel.length) return this.toast('Select lines (linework or curves) first, then Add selected.');
            for (const l of sel) await run('surface_breaklines', { id, action: 'add', line: l.id });
          }, 'Use the selected lines as breaklines'),
          btn('Draw', 'line-segments', edit('breakline')),
          lineIds.length ? btn(shown(lineIds) ? 'Hide' : 'Show', shown(lineIds) ? 'eye-slash' : 'eye', toggle(lineIds), 'Show or hide the breaklines') : null,
        ],
      },
      voids: {
        label: 'Voids',
        count: d.voids.length,
        groups: d.voids.length ? [{ group: 'Drawn', items: d.voids.map((r, i) => ({ label: `Void ${i + 1} · ${r.length} corners`, path: onGround(r), closed: true, remove: [`Remove void ${i + 1}`, () => run('surface_boundary', { id, action: 'remove_void', void: i })] })) }] : [],
        actions: [
          btn('Draw', 'polygon', edit('void'), 'Draw a closed outline: the surface is cut along it'),
          btn('From selected', 'plus-circle', () => {
            const [c] = selected((l) => l.curve);
            if (!c) return this.toast('Select a closed curve first.');
            run('surface_boundary', { id, action: 'add_void', from: c.id });
          }, 'A void from the selected closed curve'),
          d.voids.length ? btn('Grips', 'pencil-simple', edit('grips'), 'Drag the corners in the view') : null,
        ],
      },
      boundary: {
        label: 'Boundary',
        count: d.outline ? null : d.boundaries.length || null,
        groups: [
          ...(d.outline ? [{ group: 'Outline', items: [{ label: `Outline · ${d.outline.length} corners`, path: onGround(d.outline), closed: true, remove: ['Clear the outline', () => run('surface_boundary', { id, action: 'clear' })] }] }] : []),
          ...(d.boundaries.length ? [{ group: 'Boundary lines', items: d.boundaries.map((b) => ({ label: `${b.name} (${b.kind})`, ids: [b.id] })) }] : []),
        ],
        actions: [
          btn(d.outline ? 'Redraw' : 'Draw', 'polygon', edit('outline')),
          btn('From selected', 'plus-circle', () => {
            const [c] = selected((l) => l.curve);
            if (!c) return this.toast('Select a closed curve first.');
            run('surface_boundary', { id, action: 'set', from: c.id });
          }, 'The outline from the selected closed curve'),
          d.outline ? btn('Grips', 'pencil-simple', edit('grips'), 'Drag the corners in the view') : null,
        ],
      },
    };
    const toggleKind = (k) => {
      this.surfOpen = open === k ? null : { id, kind: k };
      if (open === k) this.peek();
      redraw();
    };
    const redraw = () => box.replaceWith(this.surfaceMembers(e, d, run, { btn, x, edit, shown, toggle, pointIds, lineIds }));
    const LIMIT = 200; // a group of thousands of points lists its first ones
    const row = (it) =>
      h(
        'div.surf-item',
        { role: 'button', tabindex: 0, title: 'Show it in the view', onclick: () => this.peek(it.ids || [], it.path, it.closed), onkeydown: (ev) => ev.key === 'Enter' && this.peek(it.ids || [], it.path, it.closed) },
        h('span.grow', {}, it.label),
        it.remove ? x(it.remove[0], (ev) => (ev.stopPropagation(), it.remove[1]())) : null,
        it.bring ? h('button.btn', { onclick: (ev) => (ev.stopPropagation(), it.bring()) }, 'Bring back') : null,
      );
    const k = open && kinds[open];
    const box = h(
      'div.surf-members',
      {},
      h(
        'div.surf-counts',
        { role: 'group', 'aria-label': 'What the surface is made of' },
        ...Object.entries(kinds).map(([key, v]) => h('button.surf-count', { 'aria-expanded': String(open === key), onclick: () => toggleKind(key) }, h('span', {}, v.label), h('b', {}, v.count === null ? (key === 'boundary' && d.outline ? '✓' : '–') : String(v.count)), icon(open === key ? 'caret-up' : 'caret-down'))),
      ),
      k
        ? h(
            'div.surf-pop',
            { role: 'region', 'aria-label': k.label },
            ...(k.groups.length
              ? k.groups.map((g, _, all, listed = this.surfOpen.groups?.has(g.group) || (all.length === 1 && g.items.length <= 12)) =>
                  h(
                    'div.surf-group',
                    {},
                    h(
                      'div.surf-group-head',
                      {},
                      h('button.icon-btn', { 'aria-expanded': String(listed), 'aria-label': `List ${g.group}`, title: 'List them', onclick: () => (((this.surfOpen.groups ||= new Set()).has(g.group) ? this.surfOpen.groups.delete(g.group) : this.surfOpen.groups.add(g.group)), redraw()) }, icon(listed ? 'caret-down' : 'caret-right')),
                      h('span.grow', { role: 'button', tabindex: 0, title: 'Show the whole group in the view', onclick: () => this.peek(g.items.flatMap((it) => it.ids || []), g.items.length === 1 ? g.items[0].path : null, g.items[0]?.closed) }, g.group),
                      h('span.muted', {}, String(g.items.length)),
                    ),
                    ...(listed ? [...g.items.slice(0, LIMIT).map(row), g.items.length > LIMIT ? h('div.small.muted', {}, `and ${g.items.length - LIMIT} more`) : null] : []),
                  ),
                )
              : [h('div.small.muted', {}, `No ${k.label.toLowerCase()} yet.`)]),
            h('div.row.wrap', {}, ...k.actions),
          )
        : null,
    );
    return box;
  }

  /** A TIN's definition (#240): what it is made of, each part with its own remove / show button, and its options. */
  surfaceDefinitionCard(e, run) {
    const app = this.app;
    const doc = app.store.doc;
    const d = SW.surfaceDefinition(doc, e);
    const st = TR.surfaceStats(D.worldMesh(doc, e));
    const base = S.geo(doc).base?.[2] || 0;
    const id = e.id;
    const btn = (label, ic, onclick, title = label) => h('button.btn', { onclick, title, 'aria-label': title }, icon(ic), label);
    const x = (title, onclick) => h('button.icon-btn', { onclick, title, 'aria-label': title }, icon('x'));
    const edit = (mode) => () => (app.tools.set('surfedit'), app.tools.tool.setMode?.(mode));
    const item = (label, ...actions) => h('div.row.small', {}, h('span.grow', {}, label), ...actions);
    const head = (label) => h('div.small.muted', { style: { marginTop: '6px' } }, label);
    // show / hide what the surface is made from (the points, the breakline entities)
    const pointIds = SW.surfaceSources(doc, e.derived.params).points.map((p) => p.id);
    const lineIds = d.breaklines.map((l) => l.id);
    const shown = (ids) => ids.some((i) => app.entity(i)?.visible !== false);
    const toggle = (ids) => () => run('set_properties', { ids, visible: !shown(ids) });
    return h(
      'div.surface-def',
      {},
      h('div.small', {}, `Area ${fmt(st.area_2d)} m² (3D ${fmt(st.area_3d)}) · elevation ${fmt(st.min_y + base)} to ${fmt(st.max_y + base)}`),
      this.surfaceMembers(e, d, run, { btn, x, edit, shown, toggle, pointIds, lineIds }),
      head('Triangles'),
      h('div.row.wrap', {}, btn(e.show_triangles ? 'Hide triangles' : 'Show triangles', 'triangle', () => run('show_triangles', { ids: [id], show: !e.show_triangles }), 'Draw the triangle edges over the surface'), btn('Offset…', 'stack', () => this.commandDialog('offset_surfaces', { surface: e.name, distance: -0.3, count: 1 }), 'Offset surfaces or layers to another surface')),
      h('label.row.small', {}, h('span.grow', {}, 'Longest side (m, 0: any)'), h('input', { type: 'number', min: 0, step: 1, value: d.max_edge, style: { width: '72px' }, 'aria-label': 'Longest triangle side', onchange: (ev) => run('set_surface_sources', { id, max_edge: +ev.target.value }) })),
      d.swaps.length || d.deleted_triangles ? item(`${d.swaps.length} swapped, ${d.deleted_triangles} deleted by hand`, h('button.btn', { onclick: () => run('edit_triangles', { id, action: 'restore' }) }, icon('arrow-counter-clockwise'), 'Restore')) : null,
      h('div.row.wrap', {}, btn('Swap an edge', 'triangle', edit('swap'))),
      head('Contours and analysis'),
      h('label.row.small', {}, h('span.grow', {}, 'Contours every (m)'), h('input', { type: 'number', min: 0.1, step: 0.5, value: 1, style: { width: '72px' }, 'aria-label': 'Contour interval', onchange: (ev) => run('surface_contours', { id, interval: +ev.target.value }) })),
      h(
        'label.row.small',
        {},
        h('span.grow', {}, 'Colour by'),
        h('select', { 'aria-label': 'Analysis colours', onchange: (ev) => run('analyze_surface', { id, kind: ev.target.value }) }, ...['none', 'elevation', 'slope', 'aspect'].map((k) => h('option', { value: k, selected: (e.analysis?.kind || 'none') === k }, k))),
      ),
    );
  }

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
    const rows = [['Scale', r.scale ? `1:${r.scale.ratio}` : '—'], ['Title', r.title || '—'], ['Date', r.date || '—'], ['North', r.north_angle !== undefined ? `${r.north_angle}°` : r.north ? 'a north mark' : '—'], ['Grid crossings', r.control.length ? r.control.map((c) => `E ${c.e} N ${c.n}`).join(' · ') : '—'], ['Read by', r.ai ? 'the text and Plumb' : r.ai_error ? `the text (Plumb: ${r.ai_error})` : 'the text']];
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
    q.onkeydown = (e) => void (e.key === 'Enter' && go());
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
  /** The name of the selected corridor, or the first one, to fill in the road forms. */
  firstCorridor() {
    const doc = this.app.store.doc;
    const isC = (e) => e?.derived?.generator === 'corridor';
    return (doc.entities.find((e) => this.app.selection.includes(e.id) && isC(e)) || doc.entities.find(isC))?.name;
  }
  /** Road earthwork volumes (#169): totals, then the table station by station. */
  roadVolumesDialog(r) {
    if (!r) return;
    const t = r.totals;
    const n = (x) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });
    const cols = ['Station', 'Cut m²', 'Fill m²', 'Cut m³', 'Fill m³', 'Σ cut', 'Σ fill', 'Mass haul'];
    const keys = ['station', 'cut_area', 'fill_area', 'cut', 'fill', 'cum_cut', 'cum_fill', 'mass'];
    this.modal(
      `Earthworks · ${r.corridor}`,
      h(
        'div',
        {},
        h('p.small', {}, `Cut ${n(t.cut)} m³ (${n(t.cut_loose)} m³ loose) · fill ${n(t.fill)} m³ (needs ${n(t.fill_needs_cut)} m³ of cut) · ${t.verdict}.`),
        h('div.qty', {}, h('table', {}, h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', {}, c)))), h('tbody', {}, r.rows.map((row) => h('tr', {}, ...keys.map((k) => h('td', {}, n(row[k])))))))),
      ),
    );
  }
  /** What the road needs (#170): each solid's material, volume and weight. */
  roadSolidsDialog(r) {
    if (!r) return;
    const n = (x) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });
    const total = r.solids.reduce((a, s) => a + s.tonnes, 0);
    this.modal(
      'Earthwork and pavement quantities',
      h(
        'div',
        {},
        h('div.qty', {}, h('table', {}, h('thead', {}, h('tr', {}, ...['Solid', 'Material', 'm³', 't'].map((c) => h('th', {}, c)))), h('tbody', {}, r.solids.map((s) => h('tr', {}, h('td', {}, s.name), h('td', { style: { textAlign: 'left' } }, s.material), h('td', {}, n(s.volume_m3)), h('td', {}, n(s.tonnes))))))),
        h('p.small.muted', {}, `${n(total)} t in all. ${r.note}`),
      ),
    );
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
  /** Copilot feedback report (#232): how it is rated, what goes wrong, per model; export and share. */
  async feedbackDialog() {
    const app = this.app;
    let r;
    try {
      r = await app.reg.run('list_ai_feedback', {});
    } catch (e) {
      return this.toast(e.message, 'danger');
    }
    const stat = (v, label) => h('div.ins-stat', {}, h('strong', {}, String(v)), h('span.small.muted', {}, label));
    const body = h(
      'div.panel',
      { style: { padding: 0, minWidth: '420px' } },
      h('p.small.muted', {}, "Your ratings of the copilot's answers, kept on this PC as training data for a better modelling copilot.", r.sharing ? ' Sharing is on: they also go to the suite under your account.' : ' Sharing is off (Settings › AI).'),
      h('div.ins-stats', {}, stat(r.rated, 'answers rated'), stat(r.good_rate == null ? '–' : `${r.good_rate} %`, 'good'), stat(r.with_comment, 'with a comment'), stat(r.shared, 'shared')),
      r.top_tags.length ? h('div', {}, h('div.overline', {}, 'What goes wrong most'), ...r.top_tags.slice(0, 6).map((t) => h('div.row.small', {}, h('span.grow', {}, t.tag), h('span.muted', {}, String(t.count))))) : null,
      r.by_model.length ? h('div', {}, h('div.overline', {}, 'By model'), ...r.by_model.map((m) => h('div.row.small', {}, h('span.grow', {}, m.model), h('span.muted', {}, `${m.good} / ${m.rated} good`)))) : null,
      r.recent.length ? h('div', {}, h('div.overline', {}, 'Latest'), ...r.recent.map((x) => h('div.row.small', { title: x.comment || '' }, icon(x.rating === 'good' ? 'thumbs-up' : x.rating === 'bad' ? 'thumbs-down' : 'circle'), h('span.grow', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.prompt), x.shared ? icon('cloud-check') : null))) : h('p.muted', {}, 'Nothing rated yet: use the thumbs under a copilot answer.'),
    );
    const act = await this.modal('Copilot feedback', body, [['Export JSONL…', 'export'], ['Close', null]]);
    if (act === 'export') app.reg.run('export_ai_feedback', {}).then((x) => x.path && this.toast(`${x.records} records: ${x.path}`)).catch((e) => this.toast(e.message, 'danger'));
  }

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
        h('label.row.small.param-row', {}, h('span', {}, 'Number'), h('input.grow', { value: e.name, 'aria-label': 'Point number or name', onchange: (ev) => run('set_properties', { ids: [e.id], name: ev.target.value.trim() }) })),
        ...[['n', 'Northing'], ['e', 'Easting'], ['z', 'Elevation']].map(([k, l]) => h('label.row.small.param-row', {}, h('span', {}, l), h('input.grow', { type: 'number', step: 'any', value: p[k].toFixed(4), onchange: put(k) }))),
        h('label.row.small.param-row', {}, h('span', {}, 'Code'), h('input.grow', { value: p.code, list: 'code-list', onchange: put('code') }), h('datalist', { id: 'code-list' }, Object.keys(app.store.doc.featureCodes || {}).map((c) => h('option', { value: c })))),
        h('label.row.small.param-row', {}, h('span', {}, 'Description'), h('input.grow', { value: p.desc || '', onchange: put('desc') })),
        ...Object.entries(p.attrs || {}).map(([k, v]) => h('label.row.small.param-row', {}, h('span', { title: 'Attribute' }, k), h('input.grow', { value: String(v), 'aria-label': `Attribute ${k}`, onchange: (ev) => run('edit_points', { points: [e.id], attrs: { [k]: typeof v === 'number' && Number.isFinite(+ev.target.value) ? +ev.target.value : ev.target.value } }) }))),
      );
    }
    if (e.alignment) {
      // an alignment's corners (#210): the radius of each curve, edited in place; the road on it follows
      const al = e.alignment;
      const pts = al.points || [];
      const radii = [...(al.radii || [])];
      const inner = pts.slice(1, -1);
      return h(
        'div.card',
        {},
        h('div.overline', {}, `Alignment · ${fmt(al.length || 0)}`),
        inner.length
          ? h(
              'div.qty',
              {},
              h(
                'table',
                {},
                h('thead', {}, h('tr', {}, h('th', {}, 'Corner'), h('th', {}, 'Radius (m)'))),
                h(
                  'tbody',
                  {},
                  inner.map((p, i) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, `PI ${i + 1}`),
                      h('td', {}, h('input', { type: 'number', min: 0, step: 1, value: radii[i] || 0, 'aria-label': `Radius at PI ${i + 1}`, onchange: (ev) => ((radii[i] = +ev.target.value), run('set_alignment', { id: e.id, radii: inner.map((_, k) => radii[k] || 0) })) })),
                    ),
                  ),
                ),
              ),
            )
          : h('p.small.muted', {}, 'A straight alignment: add points to give it curves.'),
        h('p.small.muted', {}, 'A road built on it (Site › Corridor) follows every change.'),
      );
    }
    if (e.annotation && e.annotation.type !== 'guide') {
      // a dimension or label after placing it (#182, #183); dragging its text with Select does the same
      const n = e.annotation;
      const edit = (k, v) => run('edit_annotation', { id: e.id, [k]: v });
      const row = (label, input) => h('label.row.small.param-row', {}, h('span', {}, label), input);
      const label = n.type === 'label';
      return h(
        'div.card',
        {},
        h('div.overline', {}, label ? (n.leader === false ? 'Text' : 'Label') : 'Dimension'),
        row(label ? 'Text' : 'Text (<> = value)', h('input.grow', { value: label ? n.text : n.text_override || '', placeholder: label ? '{name}' : n.text_now, onchange: (ev) => edit('text', ev.target.value) })),
        ...(label
          ? [
              row('Leader', h('input', { type: 'checkbox', checked: n.leader !== false, onchange: (ev) => edit('leader', ev.target.checked) })),
              row('Size', h('input.grow', { type: 'number', min: 6, max: 72, step: 1, value: n.size || 12, onchange: (ev) => edit('size', +ev.target.value) })),
              row('Plate', h('select.grow', { onchange: (ev) => edit('plate', ev.target.value) }, ['white', 'none'].map((v) => h('option', { value: v, selected: (n.plate || 'white') === v }, v)))),
              row('Colour', h('input', { type: 'color', value: n.color || '#1d262c', onchange: (ev) => edit('color', ev.target.value) })),
            ]
          : [
              row('Offset (m)', h('input.grow', { type: 'number', step: 0.1, value: n.offset ?? 0.5, onchange: (ev) => edit('offset', +ev.target.value) })),
              row('Text slide (m)', h('input.grow', { type: 'number', step: 0.1, value: n.text_shift || 0, onchange: (ev) => edit('text_shift', +ev.target.value) })),
            ]),
        h('p.small.muted', {}, 'Or drag its text with the Select tool.'),
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
        e.derived.generator === 'surface' ? this.surfaceDefinitionCard(e, run) : null,
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
    const setTex = (name) => {
      this.setPaint({ ...this.paint, material: name });
      if (app.selection.length) app.reg.run('apply_material', { ids: app.selection, material: name }).catch((e) => this.toast(e.message, 'danger'));
      else app.tools.set('paint');
    };
    const set = (m) => {
      this.setPaint(m);
      if (app.selection.length) app.reg.run('set_material', { ids: app.selection, color: m.color, opacity: m.opacity ?? 1, metalness: m.metalness ?? 0, roughness: m.roughness ?? 0.8 });
      else app.tools.set('paint');
    };
    return h(
      'div.panel',
      {},
      h('h3', {}, 'Materials'),
      this.surfaceMaterials(),
      h('div.overline', {}, 'Look'),
      h('p.muted.small', {}, 'Click a swatch: it paints the selection, or arms the Paint Bucket (B) when nothing is selected. Alt-click in the model samples a colour.'),
      h('div.overline', {}, 'Textured'),
      // textured materials made in the app (#186): colour, relief and roughness, at real size
      ...Object.entries(Object.groupBy(Object.entries(TX.LIBRARY), ([, m]) => m.category)).map(([cat, list]) =>
        h(
          'div',
          {},
          h('div.small.muted', {}, cat),
          h(
            'div.swatches',
            {},
            list.map(([name]) =>
              h('button.swatch', { 'aria-pressed': String(this.paint.material === name), title: `${name}: click to give it to the selection, or to paint with it`, onclick: () => setTex(name) }, h('i', { style: { backgroundImage: `url(${this.texThumb(name)})`, backgroundSize: 'cover' } }), name),
            ),
          ),
        ),
      ),
      h('div.overline', {}, 'Colours'),
      h('div.swatches', {}, MATERIALS.map((m) => h('button.swatch', { 'aria-pressed': String(!this.paint.material && this.paint.color === m.color), onclick: () => set(m) }, h('i', { style: { background: m.color, opacity: m.opacity ?? 1 } }), m.name))),
      h('label.row', {}, h('span.small', {}, 'Custom'), h('input', { type: 'color', value: this.paint.color, onchange: (ev) => set({ ...this.paint, name: 'Custom', color: ev.target.value }) })),
    );
  }
  /** Surface materials for takeoff, compact: show / hide, colour, name, painted area, the brush. The details are in the manager. */
  surfaceMaterials() {
    const app = this.app;
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    const doc = app.store.doc;
    const rep = TK.takeoff(doc);
    const byName = new Map(rep.rows.map((r) => [r.material, r]));
    const f = (x) => (x ? x.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '');
    const t = rep.totals;
    return h(
      'details.surface-mats',
      { open: true },
      h('summary.overline', {}, icon('stack'), ' Surface materials · takeoff'),
      h(
        'div.mat-list',
        {},
        TK.library(doc).map((m) =>
          h(
            `div.mat-line${m.hidden ? '.off' : ''}`,
            { title: `${m.code || 'no code'} · ${m.thickness || 0} m · ${m.density || 0} kg/m³ · ${m.cost || 0}/m²` },
            h('button.icon-btn.sm', { title: m.hidden ? 'Show its faces' : 'Hide its faces', 'aria-label': `${m.hidden ? 'Show' : 'Hide'} ${m.name}`, 'aria-pressed': String(!m.hidden), onclick: () => run('show_surface_materials', { names: [m.name], visible: !!m.hidden }) }, icon(m.hidden ? 'eye-slash' : 'eye')),
            h('input.mat-color', { type: 'color', value: m.color, 'aria-label': `${m.name} colour`, onchange: (ev) => run('define_surface_material', { name: m.name, color: ev.target.value }) }),
            h('span.mat-name', {}, m.name),
            h('span.small.muted', {}, byName.get(m.name) ? `${f(byName.get(m.name).area)} m²` : ''),
            h('button.icon-btn.sm', { title: `Paint ${m.name} with the brush`, 'aria-label': `Paint ${m.name}`, onclick: () => ((BRUSH.material = m.name), app.tools.set('matbrush')) }, icon('paint-brush')),
          ),
        ),
      ),
      rep.rows.length ? h('p.small', {}, `Painted ${f(t.area)} m² · ${f(t.volume)} m³ · ${f(t.weight_t)} t · cost ${f(t.cost)}`) : h('p.muted.small', {}, 'Paint faces with the material brush to measure them.'),
      h('div.row.wrap', {}, h('button.btn.sm.primary', { onclick: () => this.materialManager() }, icon('table'), 'Material manager'), h('button.btn.sm', { onclick: () => run('show_surface_materials', { all: true }) }, icon('eye'), 'Show all')),
    );
  }
  /**
   * The material manager: a floating window over the view (drag it by its title) with the whole library and the
   * takeoff, edited in place. It stays open while you paint and follows every change.
   */
  materialManager(open = true) {
    let win = this.$('mat-manager');
    if (!open) return win?.remove();
    if (!win) {
      win = h('section.float-win', { id: 'mat-manager', role: 'dialog', 'aria-label': 'Material manager' });
      document.body.append(win);
    }
    this.renderManager();
  }
  renderManager() {
    const win = this.$('mat-manager');
    if (!win) return;
    const app = this.app;
    const doc = app.store.doc;
    const run = (n, a) => app.reg.run(n, a).catch((e) => this.toast(e.message, 'danger'));
    const rep = TK.takeoff(doc);
    const byName = new Map(rep.rows.map((r) => [r.material, r]));
    const f = (x) => (x ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '–');
    const set = (m, k, v) => run('define_surface_material', { name: m.name, [k]: v });
    const num = (m, k, step) => h('input.num', { type: 'number', min: 0, step, value: m[k] ?? 0, 'aria-label': `${m.name} ${k}`, onchange: (ev) => set(m, k, +ev.target.value) });
    const newName = (k = 1) => (TK.find(doc, `Material ${k}`) ? newName(k + 1) : `Material ${k}`);
    const file = async (kind, save, name, cmd) => {
      const p = await app.io.pick(kind, save, name);
      if (p) run(cmd, { path: p }).then((r) => r && this.toast(save ? `Wrote ${p}` : `Read ${r.imported} materials`));
    };
    const head = h('header', {}, icon('stack'), h('strong.grow', {}, 'Material manager'), h('button.icon-btn.sm', { title: 'Close', 'aria-label': 'Close', onclick: () => this.materialManager(false) }, icon('x')));
    // drag the window by its title bar
    head.onpointerdown = (e) => {
      if (e.target.closest('button')) return;
      const r = win.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const mv = (ev) => Object.assign(win.style, { left: `${Math.max(0, ev.clientX - dx)}px`, top: `${Math.max(0, ev.clientY - dy)}px`, right: 'auto' });
      const up = () => (removeEventListener('pointermove', mv), removeEventListener('pointerup', up));
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
    };
    const cols = ['', 'Colour', 'Material', 'Code', 'Thick m', 'kg/m³', 'Cost/m²', 'Area m²', 'Plan m²', 'Volume m³', 'Weight t', 'Cost', ''];
    const t = rep.totals;
    win.replaceChildren(
      head,
      h('p.small.muted', {}, 'Codes follow your classification (MasterFormat, Uniclass, a Trimble Business Center material code). Volume = painted area × thickness, weight = volume × density.'),
      h(
        'div.float-body',
        {},
        h(
          'table.qty.mat-table',
          {},
          h('thead', {}, h('tr', {}, ...cols.map((x) => h('th', {}, x)))),
          h(
            'tbody',
            {},
            TK.library(doc).map((m) => {
              const r = byName.get(m.name) || {};
              return h(
                `tr${m.hidden ? '.off' : ''}`,
                {},
                h('td', {}, h('button.icon-btn.sm', { title: m.hidden ? 'Show' : 'Hide', 'aria-pressed': String(!m.hidden), onclick: () => run('show_surface_materials', { names: [m.name], visible: !!m.hidden }) }, icon(m.hidden ? 'eye-slash' : 'eye'))),
                h('td', {}, h('input.mat-color', { type: 'color', value: m.color, 'aria-label': `${m.name} colour`, onchange: (ev) => set(m, 'color', ev.target.value) })),
                h('td', {}, h('input.name', { value: m.name, 'aria-label': 'Name', onchange: (ev) => ev.target.value.trim() && run('define_surface_material', { name: m.name, rename: ev.target.value.trim() }) })),
                h('td', {}, h('input.code', { value: m.code || '', 'aria-label': `${m.name} code`, onchange: (ev) => set(m, 'code', ev.target.value) })),
                h('td', {}, num(m, 'thickness', 0.01)),
                h('td', {}, num(m, 'density', 50)),
                h('td', {}, num(m, 'cost', 1)),
                ...[r.area, r.plan_area, r.volume, r.weight_t, r.cost].map((x) => h('td.n', {}, f(x))),
                h('td', {}, h('button.icon-btn.sm', { title: `Paint ${m.name}`, onclick: () => ((BRUSH.material = m.name), app.tools.set('matbrush')) }, icon('paint-brush')), h('button.icon-btn.sm', { title: `Delete ${m.name} (its faces become unpainted)`, onclick: () => run('delete_surface_material', { name: m.name }) }, icon('trash'))),
              );
            }),
          ),
          h('tfoot', {}, h('tr', {}, h('th', { colSpan: 7 }, 'Total'), ...[t.area, t.plan_area, t.volume, t.weight_t, t.cost].map((x) => h('th.n', {}, f(x))), h('th'))),
        ),
      ),
      h(
        'div.row.wrap',
        {},
        h('button.btn.sm', { onclick: () => run('define_surface_material', { name: newName(), color: '#7f8c8d' }) }, icon('plus'), 'New material'),
        h('button.btn.sm', { title: 'Read a library (JSON or CSV)', onclick: () => file('matlib', false, '', 'import_surface_materials') }, icon('upload-simple'), 'Import library'),
        h('button.btn.sm', { title: 'Save the library (JSON or CSV)', onclick: () => file('matlib', true, 'materials.json', 'export_surface_materials') }, icon('download-simple'), 'Export library'),
        h('span.grow'),
        h('button.btn.sm.primary', { title: 'CSV, JSON, or GeoJSON (OGC API Features encoding: painted faces as polygons)', onclick: () => file('takeoff', true, 'takeoff.csv', 'material_takeoff') }, icon('export'), 'Export takeoff'),
      ),
    );
  }
  /** A small picture of a library material, made once. */
  texThumb(name) {
    this.thumbs ||= new Map();
    if (!this.thumbs.has(name)) {
      const m = TX.makeMaps(name, 64);
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d').putImageData(new ImageData(m.color, 64, 64), 0, 0);
      this.thumbs.set(name, c.toDataURL());
    }
    return this.thumbs.get(name);
  }
  setPaint(m) {
    this.paint = m;
    this.app.tools.paint = m.material ? { material: m.material } : { color: m.color, opacity: m.opacity ?? 1, metalness: m.metalness ?? 0, roughness: m.roughness ?? 0.8 };
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
    const assets = h('div.assets', { ondragover: (e) => e.dataTransfer.types.includes('Files') && e.preventDefault(), ondrop: (e) => e.dataTransfer.files.length && (e.preventDefault(), e.stopPropagation(), app.dropFiles(e.dataTransfer.files, { library: true })) }, h('p.muted.small', {}, 'Loading…'));
    app.io.listLibrary().then((list) => {
      assets.replaceChildren(
        ...(list.length ? list : []).map((f) => {
          const img = h('img', { alt: '' });
          app.io.libraryThumb(f.name).then((src) => (img.src = src)).catch(() => {});
          const place = (position) => app.reg.run('insert_asset', { name: f.name, position }).then((r) => r?.id && app.tools.place([r.id])).catch((e) => this.toast(e.message, 'danger'));
          return h('button.asset', { title: `${f.name}: click to place, or drag into the view`, draggable: true, ondragstart: (e) => e.dataTransfer.setData('text/x-mmr-asset', f.name), onclick: () => place(app.viewport.controls.target.toArray().map((x, k) => (k === 1 ? 0 : Math.round(x * 100) / 100))) }, img, h('span', {}, f.name.replace(/\.\w+$/, '')));
        }),
        ...(list.length ? [] : [h('p.muted.small', {}, 'Put GLB or glTF files in the library folder.')]),
      );
    });
    return h(
      'div.panel',
      {},
      h('h3', {}, 'Components'),
      h('p.muted.small', {}, 'Drop a model file here to add it to the library, or into the view to place it.'),
      assets,
      h('div.row.wrap', {}, h('button.btn.sm', { title: 'Add a GLB, glTF, OBJ, STL or FBX model to the library', onclick: () => run('add_to_library', {}).then((r) => r?.added && this.toast(`Added ${r.added}`)) }, icon('plus'), 'Add model…'), h('button.btn.sm', { onclick: () => window.native.invoke('shell:open-path', 'library') }, icon('folder-open'), 'Library folder'), h('button.btn.sm', { onclick: () => ((app.io.thumbs = null), this.renderDock()) }, icon('arrows-clockwise'), 'Refresh')),
      h('h3', {}, 'Profiles'),
      h('p.muted.small', {}, path ? `Click a profile to sweep it along "${path.name}".` : 'Select a curve (Curve tool, U) and click a profile to sweep it along. Parameters can be changed later in the Entity panel.'),
      h(
        'div.profiles',
        {},
        listProfiles(doc).map((p) =>
          h('button.profile', { title: p.description, disabled: !path, onclick: () => run('sweep', { path: path.id, profile: p.name }) }, thumb(p), h('span', {}, p.name.replace(/_/g, ' '))),
        ),
      ),
      h('div.row', {}, h('button.btn', { onclick: () => this.commandDialog('define_profile', app.selection[0] ? { from_face: app.selection[0] } : {}) }, icon('plus'), 'Profile from a face…'), h('button.btn', { onclick: this.actions.sketchProfile.run }, icon('scribble'), 'Sketch a profile…')),
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
      h('h3', {}, 'My tools and skills'),
      h('p.muted.small', {}, 'Ask Plumb to save what it just did as a tool, or how you work as a skill.'),
      h('div.row', {}, h('button.btn', { onclick: this.actions.myTools.run }, icon('toolbox'), 'My tools and skills')),
      h('h3', {}, 'Plugins'),
      h('p.muted.small', {}, 'A plugin is one JavaScript file that adds commands. Every command it adds is instantly available to the toolbar, the AI, the HTTP API and MCP. Ask the AI to "create a plugin that…" and it writes one for you.'),
      h('div.row', {}, h('button.btn', { onclick: this.actions.plugins.run }, icon('folder-open'), 'Open plugins folder'), h('button.btn', { onclick: () => app.reloadPlugins() }, icon('arrows-clockwise'), 'Reload')),
      ...app.plugins.map((p) => h('div.card', {}, h('div.row', {}, icon('puzzle-piece'), h('b.grow', {}, p.name), h('span.small.muted', {}, p.builtin ? 'built-in' : 'yours')), h('div.small.muted', {}, p.error ? `Failed: ${p.error}` : p.commands.join(', ') || 'no commands'))),
    );
  }

  /** Find the models on this PC and connect one in a click (#198). */
  aiFinder() {
    const app = this.app;
    const box = h('div.card.ai-finder', {});
    const render = (r) => {
      const cur = app.settings.ai;
      const using = (s, m) => cur.provider === s.provider && (cur[s.provider]?.model === m) && (cur[s.provider]?.baseUrl || '').replace(/\/$/, '') === s.baseUrl;
      box.replaceChildren(
        h('div.row', {}, h('strong.grow', {}, 'Models on this PC'), h('button.btn.sm', { onclick: () => find() }, icon('magnifying-glass'), r ? 'Look again' : 'Find them')),
        ...(r
          ? [
              h('p.small', {}, r.advice),
              ...r.servers.map((s) => {
                const pick = h('select', { 'aria-label': `${s.name} model` }, s.models.map((m) => h('option', { value: m, selected: m === s.suggested }, m)));
                return h(
                  'div.row.small',
                  {},
                  h('span', { style: { minWidth: '120px' } }, s.name),
                  s.models.length ? pick : h('span.muted.grow', {}, 'running, no model loaded'),
                  s.models.length ? h('button.btn.sm.primary', { onclick: () => app.reg.run('use_ai_model', { provider: s.provider, base_url: s.baseUrl, model: pick.value }).then(() => (this.toast(`Plumb now uses ${pick.value} on ${s.name}.`), app.ai.renderHead(), this.renderDock())).catch((e) => this.toast(e.message, 'danger')) }, using(s, pick.value) ? 'In use' : 'Use') : null,
                );
              }),
              ...(r.huggingface.length ? [h('p.small.muted', {}, `Downloaded from Hugging Face: ${r.huggingface.map((m) => m.id + (m.gguf ? ' (GGUF)' : '')).join(', ')}. Load one in Ollama or LM Studio to use it here.`)] : []),
              r.claudeDesktop ? h('p.small', {}, 'Claude Desktop is installed: ', h('button.btn.sm', { onclick: () => this.actions.mcp?.run() }, 'Connect it with MCP'), ' so Claude can drive this app.') : null,
            ]
          : [h('p.small.muted', {}, 'Finds Ollama, LM Studio, llama.cpp, vLLM, Jan and GPT4All running here, and models downloaded from Hugging Face.')]),
      );
    };
    const find = () => app.reg.run('detect_local_models', {}).then((r) => ((this.aiFound = r), render(r))).catch((e) => this.toast(e.message, 'danger'));
    render(this.aiFound);
    if (!this.aiFound) find();
    return box;
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
    const field = (label, value, onchange, attrs = {}, tip = null) => h('label.field', {}, h('span', {}, label, tip ? infoTip(tip) : null), h('input', { value: value ?? '', onchange, ...attrs }));
    const prov = ai.provider;
    const cfg =
      prov === 'anthropic'
        ? [field('Model', ai.anthropic.model, (e) => save({ ai: { anthropic: { model: e.target.value } } })), field(`API key ${ai.anthropic.hasKey ? '(saved; type to replace)' : ''}`, '', (e) => save({ ai: { anthropic: { apiKey: e.target.value } } }), { type: 'password', placeholder: 'sk-ant-…' })]
        : prov === 'openai'
          ? [field('Base URL', ai.openai.baseUrl, (e) => save({ ai: { openai: { baseUrl: e.target.value } } })), field('Model', ai.openai.model, (e) => save({ ai: { openai: { model: e.target.value } } })), field(`API key ${ai.openai.hasKey ? '(saved; type to replace)' : ''}`, '', (e) => save({ ai: { openai: { apiKey: e.target.value } } }), { type: 'password' })]
          : prov === 'builtin'
            ? [] // the model list is in the card above (#255)
            : [field('Ollama address', ai.ollama.baseUrl, (e) => save({ ai: { ollama: { baseUrl: e.target.value } } }), {}, 'On this PC it is http://127.0.0.1:11434. Change it only when Ollama runs on another computer.'), field('Model', ai.ollama.model, (e) => save({ ai: { ollama: { model: e.target.value } } }), {}, 'An Ollama model that can call tools: mistral, mistral-small, qwen2.5, llama3.1…')];
    return h(
      'div.panel',
      {},
      ...this.accountCard(),
      h('h3', {}, 'AI'),
      ai.provider === 'ollama' || ai.provider === 'builtin' ? app.ai.setupCard() : null,
      prov === 'builtin' ? null : this.aiFinder(), // finding other models matters once you leave the built-in one
      // copilot feedback (#232): kept on this PC; shared only when ticked
      h('label.row.small', { title: 'Rated answers (the request, what the copilot did and the model) upload to the MyStudioReel suite under your account, to train a better modelling copilot. Off: they stay on this PC.' }, h('input', { type: 'checkbox', checked: !!ai.shareFeedback, onchange: (e) => app.reg.run('share_ai_feedback', { on: e.target.checked }).then(() => this.toast(e.target.checked ? 'Feedback will be shared' : 'Feedback stays on this PC')).catch((err) => this.toast(err.message, 'danger')) }), 'Share my copilot feedback to improve it'),
      h(
        'label.field',
        {},
        h('span', {}, 'Provider', infoTip(['Where Plumb’s model runs', 'Built-in: the app runs it on this PC, offline. Ollama or LM Studio: another app on this PC. Claude or an API: online, with your key.', 'Keys stay on this PC and are only used by the app itself; the page never sees them.'])),
        h(
          'select',
          { onchange: (e) => save({ ai: { provider: e.target.value } }) },
          [['builtin', 'Built-in model (offline)'], ['ollama', 'Ollama (Mistral, Qwen…)'], ['anthropic', 'Claude (Anthropic API)'], ['openai', 'OpenAI-compatible (Mistral API, LM Studio, vLLM…)']].map(([v, l]) => h('option', { value: v, selected: v === prov }, l)),
        ),
      ),
      ...cfg,
      (prov === 'ollama' || prov === 'builtin') &&
        h(
          'label.field',
          {},
          h('span', {}, 'Tools', infoTip('Local models do better with fewer tools. Auto gives each request the best matches.')),
          h(
            'select',
            { onchange: (e) => save({ ai: { toolset: e.target.value } }) },
            [['auto', 'Auto: the best matches for each request'], ['all', 'All commands'], ['modelling', 'Modelling'], ['animation', 'Animation'], ['query', 'Scene queries'], ['files', 'Files']].map(([v, l]) => h('option', { value: v, selected: v === (ai.toolset || 'auto') }, l)),
          ),
        ),
      h('h3', {}, 'Image model (AI render, AI textures)'),
      h('label.field', {}, h('span', {}, 'Provider'), h('select', { onchange: (e) => save({ ai: { image: { provider: e.target.value } } }) }, [['comfyui', 'ComfyUI on this PC (Stable Diffusion, Flux…)'], ['openai', 'OpenAI-compatible images API']].map(([v, l]) => h('option', { value: v, selected: v === ai.image.provider }, l)))),
      ...(ai.image.provider === 'openai'
        ? [field('Base URL', ai.image.openai.baseUrl, (e) => save({ ai: { image: { openai: { baseUrl: e.target.value } } } })), field('Model', ai.image.openai.model, (e) => save({ ai: { image: { openai: { model: e.target.value } } } })), field(`API key ${ai.image.openai.hasKey ? '(saved; type to replace)' : ''}`, '', (e) => save({ ai: { image: { openai: { apiKey: e.target.value } } } }), { type: 'password' })]
        : [field('ComfyUI URL', ai.image.comfyui.baseUrl, (e) => save({ ai: { image: { comfyui: { baseUrl: e.target.value } } } })), field('Checkpoint', ai.image.comfyui.checkpoint, (e) => save({ ai: { image: { comfyui: { checkpoint: e.target.value } } } }), { placeholder: 'sd_xl_base_1.0.safetensors' }, 'A model file in ComfyUI/models/checkpoints.')]),
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
        h('div.panel', {}, h('h3', {}, title), body, h('footer', {}, buttons.map(([label, value], i) => h(`button.btn${i === 0 ? '.primary' : ''}`, { onclick: () => ((this.modalClosing = true), dlg.close(), resolve(value)) }, label)))),
      );
      // the close event comes later: one we caused (a button, picking in the view) is not a Cancel, and one that
      // arrives while the dialog is open again belongs to the dialog this one replaced (Coordinate system → Pick on a map)
      this.modalClosing = false;
      dlg.onclose = () => dlg.open || (this.modalClosing ? (this.modalClosing = false) : resolve(null));
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

  /** Import points: JobXML / LandXML through the import registry; a text file through a live preview of how it splits. */
  async importPointsDialog(path) {
    const app = this.app;
    path ||= await window.native.invoke('file:open-dialog', { filters: [{ name: 'Points', extensions: ['csv', 'txt', 'xyz', 'pnezd', 'jxl', 'xml'] }] });
    if (!path) return;
    const fail = (e) => this.toast(e.message, 'danger');
    if (/\.(jxl|xml)$/i.test(path)) return app.reg.run('import', { path }).then((r) => this.importReport(r)).catch(fail);
    const ROLES = { name: 'Point name', e: 'Easting (X)', n: 'Northing (Y)', z: 'Elevation (Z)', code: 'Code', desc: 'Description', attr: 'Attribute', ignore: 'Ignore' };
    const o = { path, delimiter: 'auto', header: undefined, columns: undefined, units: S.geo(app.store.doc).units || 'm' };
    const sel = (label, value, opts, onchange) => h('label.field', {}, h('span', {}, label), h('select', { 'aria-label': label, onchange: (ev) => onchange(ev.target.value) }, Object.entries(opts).map(([v, l]) => h('option', { value: v, selected: v === value }, l))));
    const custom = h('input', { 'aria-label': 'Custom delimiter', placeholder: '|', size: 3, style: { display: 'none' }, oninput: (ev) => ev.target.value && ((o.delimiter = ev.target.value), (o.columns = undefined), draw()) });
    const opts = h('div.points-wizard-opts');
    const status = h('p.small', { role: 'status' });
    const table = h('div.qty.points-wizard');
    const draw = async () => {
      let r;
      try {
        r = await app.reg.run('preview_points', { ...o, rows: 30 });
      } catch (e) {
        status.textContent = e.message;
        return;
      }
      o.columns = r.columns;
      const dKey = ['auto', 'comma', 'tab', 'semicolon', 'space'].includes(o.delimiter) ? o.delimiter : 'custom';
      custom.style.display = dKey === 'custom' ? '' : 'none';
      opts.replaceChildren(
        sel('Delimiter', dKey, { auto: `Detect (${r.delimiter.length > 1 ? r.delimiter : `"${r.delimiter}"`})`, comma: 'Comma', tab: 'Tab', semicolon: 'Semicolon', space: 'Space', custom: 'Other…' }, (v) => (v === 'custom' ? ((custom.style.display = ''), custom.focus()) : ((o.delimiter = v), (o.columns = undefined), draw()))),
        custom,
        sel('First line', o.header === undefined ? 'auto' : String(o.header), { auto: `Detect (${r.header ? 'header' : 'data'})`, true: 'Column names', false: 'Data' }, (v) => ((o.header = v === 'auto' ? undefined : v === 'true'), (o.columns = undefined), draw())),
        sel('Units', o.units, { m: 'Metres', ft: 'Feet', usft: 'US survey feet' }, (v) => ((o.units = v), draw())),
      );
      const setCol = (i, c) => ((o.columns = o.columns.map((x, k) => (k === i ? c : x))), draw());
      const headCell = (c, i) =>
        h(
          'th',
          {},
          h('select', { 'aria-label': `Column ${i + 1}`, onchange: (ev) => setCol(i, ev.target.value === 'attr' ? { role: 'attr', name: r.labels[i] || `col${i + 1}` } : { role: ev.target.value }) }, Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: v === c.role }, l))),
          c.role === 'attr' ? h('input', { 'aria-label': `Attribute name of column ${i + 1}`, value: c.name, onchange: (ev) => setCol(i, { role: 'attr', name: ev.target.value.trim() || `col${i + 1}` }) }) : null,
        );
      const rows = r.sample.map((cells, k) => h(`tr${r.header && k === 0 ? '.is-header' : ''}`, {}, r.columns.map((c, i) => h(`td${c.role === 'ignore' ? '.muted' : ''}`, {}, cells[i] ?? ''))));
      table.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, r.columns.map(headCell))), h('tbody', {}, rows)));
      status.textContent = `${r.points} of ${r.lines - (r.header ? 1 : 0)} lines read as points${r.skipped_lines.length ? `; lines ${r.skipped_lines.slice(0, 8).join(', ')}${r.skipped_lines.length > 8 ? '…' : ''} are skipped (no numbers where northing and easting are)` : ''}.`;
    };
    await draw();
    const body = h('div.panel.form.points-wizard-body', { style: { padding: 0 } }, h('p.small.muted', {}, path), opts, h('p.small.muted', {}, 'Pick what each column holds. Attribute columns are kept on every point under the name you give.'), table, status);
    if ((await this.modal('Import points', body, [['Import', 'go'], ['Cancel', null]])) !== 'go') return;
    const { path: p, delimiter, header, columns, units } = o;
    return app.reg
      .run('import_points', { path: p, delimiter, ...(header === undefined ? {} : { header }), columns, units })
      .then((r) => this.toast(`${r.imported} points imported${r.renamed_duplicates.length ? `, ${r.renamed_duplicates.length} renamed (names in use)` : ''}.`))
      .catch(fail);
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
      surveyViews(this, 'survey'),
      h('h3', {}, 'Coordinates'),
      h('div.small', {}, g.base ? `Base point E ${g.base[0]} · N ${g.base[1]} · Z ${g.base[2]}` : 'No base point yet: the first point sets it.'),
      h('div.small.muted', {}, `${g.crs?.name || 'No coordinate system'}${g.crs?.epsg ? ` (EPSG:${g.crs.epsg})` : ''} · units ${g.units || 'm'} · angles ${g.angles || 'deg'}`),
      h('div.row.wrap', {}, h('button.btn', { onclick: this.actions.coordSys.run }, icon('globe-hemisphere-west'), 'System…'), h('button.btn', { onclick: this.actions.basePoint.run }, icon('crosshair'), 'Base…'), h('button.btn', { onclick: this.actions.mapPick.run }, icon('map-trifold'), 'Map…'), h('button.btn', { onclick: this.actions.units.run }, icon('ruler'), 'Units…')),
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
      h('div.row', {}, h('h3.grow', {}, 'Feature codes'), h('button.btn', { onclick: this.actions.featureCode.run }, icon('plus'), 'Code…'), h('button.icon-btn.sm', { title: 'Feature code libraries', 'aria-label': 'Feature code libraries', onclick: this.actions.loadLibrary.run }, icon('books'))),
      doc.featureLibrary ? h('p.small.muted', {}, icon('books'), ` Library: ${doc.featureLibrary.name}`) : null,
      h('div.row.wrap', {}, Object.entries(doc.featureCodes || {}).map(([c, d]) => h('span.code-chip', { title: d.description || c }, h('i', { style: { background: d.color || '#1e3a4c' } }), c, d.line ? ' ⁄ line' : '', d.object ? ` ⁄ ${d.object.type}` : ''))),
      h('label.row.small', {}, h('span', {}, 'Labels'), h('select', { onchange: (e) => run('set_style', { point_labels: e.target.value }) }, [['name', 'Name'], ['name_z', 'Name + elevation'], ['code', 'Code'], ['all', 'All'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: (doc.settings.point_labels ?? 'name') === v }, l)))),
    );
  }

  /** Feature code libraries: the ones kept on this computer (import FXL / JSON), the model's, their codes to search and edit. */
  async featureLibrariesDialog(open = null) {
    const app = this.app;
    const run = (name, args) => app.reg.run(name, args);
    const fail = (e) => this.toast(e.message, 'danger');
    const body = h('div.panel.libs', { style: { padding: 0 } }, h('p.muted', {}, 'Reading the libraries…'));
    let sel = open;
    let mode = null; // 'rename' | 'duplicate' | 'delete': the selected library's pending action
    const again = (fn) => async () => {
      try {
        await fn();
      } catch (e) {
        fail(e);
      }
      draw();
    };
    // a code edit is a form of its own; the manager comes back after it
    const editCode = (code, d = {}) => async () => {
      this.modalClosing = true; // its close event comes later: not the form's Cancel
      this.closeModal();
      await this.commandDialog('edit_library_code', { library: sel, ...(code ? { code } : {}), ...Object.fromEntries(Object.entries({ description: d.description, type: d.type, category: d.category, layer: d.layer, color: d.color, line_style: d.lineStyle, breakline: d.breakline, object: d.object, attrs: d.attrs }).filter(([, v]) => v !== undefined)) }, { form: true });
      this.featureLibrariesDialog(sel);
    };
    const draw = async () => {
      const { libraries, in_use } = await run('feature_libraries', {});
      if (!libraries.some((l) => l.name === sel)) sel = libraries.find((l) => l.name === in_use)?.name || libraries[0]?.name || null;
      const lib = sel ? await run('feature_library', { name: sel, limit: 1e6 }) : null;
      const codes = lib ? Object.fromEntries(lib.codes.map(({ code, ...d }) => [code, d])) : {};
      const doc = app.store.doc;
      const nameBox = (verb) => {
        const inp = h('input', { value: verb === 'rename' ? sel : `${sel} copy`, 'aria-label': 'New name' });
        const ok = again(() => run('manage_feature_library', { name: sel, action: verb, to: inp.value.trim() }).then((r) => ((sel = r.name), (mode = null))));
        inp.onkeydown = (e) => (e.stopPropagation(), e.key === 'Enter' ? ok() : e.key === 'Escape' && ((mode = null), draw()));
        setTimeout(() => (inp.focus(), inp.select()));
        return h('div.row', {}, inp, h('button.btn.primary', { onclick: ok }, verb === 'rename' ? 'Rename' : 'Duplicate'), h('button.btn', { onclick: () => ((mode = null), draw()) }, 'Cancel'));
      };
      body.replaceChildren(
        h(
          'div.row.wrap',
          {},
          h('button.btn.primary', { onclick: again(async () => {
            const path = await window.native.invoke('file:open-dialog', { filters: [{ name: 'Feature library (FXL, JSON)', extensions: ['fxl', 'json'] }] });
            if (!path) return;
            const r = await run('import_feature_library', { path });
            sel = r.name;
            this.toast(`${r.name}: ${r.codes} codes (${Object.entries(r.types).map(([k, n]) => `${n} ${k}`).join(', ')})`);
          }) }, icon('download-simple'), 'Import FXL or JSON…'),
          Object.keys(doc.featureCodes || {}).length && !libraries.some((l) => l.name === in_use)
            ? h('button.btn', { title: 'Keep the codes of this model as a library on this computer', onclick: again(async () => (sel = (await run('import_feature_library', { name: in_use || app.file?.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'From the model' })).name)) }, icon('floppy-disk'), "Keep this model's codes")
            : null,
        ),
        libraries.length
          ? h('div.lib-list', { role: 'listbox', 'aria-label': 'Libraries' }, libraries.map((l) => h('button.lib-item', { role: 'option', 'aria-selected': String(l.name === sel), onclick: () => ((sel = l.name), (mode = null), draw()) }, icon('books'), h('b.grow', {}, l.name), l.name === in_use ? h('span.lib-badge', {}, 'In use') : null, h('span.small.muted', {}, `${l.codes} codes`))))
          : h('p.muted', {}, 'No libraries yet. Import a Trimble FXL (Feature Definition Manager) or a JSON library.'),
        lib
          ? h(
              'div.lib-detail',
              {},
              mode === 'rename' || mode === 'duplicate'
                ? nameBox(mode)
                : h(
                    'div.row.wrap',
                    {},
                    h('button.btn.primary', { disabled: lib.name === in_use, onclick: again(async () => {
                      const r = await run('use_feature_library', { name: lib.name });
                      this.toast(`This model uses ${r.in_use}: ${r.codes} codes, ${r.processed.lines} lines`);
                    }) }, icon('check-circle'), lib.name === in_use ? 'In use' : 'Use in this model'),
                    h('button.btn', { onclick: () => ((mode = 'rename'), draw()) }, icon('pencil-simple'), 'Rename'),
                    h('button.btn', { onclick: () => ((mode = 'duplicate'), draw()) }, icon('copy'), 'Duplicate'),
                    h('button.btn', { onclick: again(async () => {
                      const path = await window.native.invoke('file:save-dialog', { defaultPath: `${lib.name}.fxl`, filters: [{ name: 'Trimble FXL', extensions: ['fxl'] }, { name: 'JSON', extensions: ['json'] }, { name: 'CSV', extensions: ['csv'] }] });
                      if (path) this.toast(`Exported ${(await run('export_feature_library', { library: lib.name, path })).codes} codes`);
                    }) }, icon('export'), 'Export…'),
                    mode === 'delete'
                      ? h('button.btn.danger', { onclick: again(() => run('manage_feature_library', { name: lib.name, action: 'delete' }).then(() => (mode = null))) }, icon('trash'), `Delete ${lib.name}?`)
                      : h('button.btn', { onclick: () => ((mode = 'delete'), draw()) }, icon('trash'), 'Delete'),
                  ),
              h('div.row', {}, h('span.small.muted.grow', {}, `${lib.total} codes${lib.source && !/^(fxl|json|model)$/.test(lib.source) ? ` · from ${lib.source.split(/[\\/]/).pop()}` : ''}`), h('button.btn.sm', { onclick: editCode(null) }, icon('plus'), 'Code…')),
              codeGrid(codes, (c) => editCode(c, codes[c])(), {
                extra: (r) => [
                  h('button.icon-btn.sm', { title: `Edit ${r.code}`, 'aria-label': `Edit ${r.code}`, onclick: (e) => (e.stopPropagation(), editCode(r.code, codes[r.code])()) }, icon('pencil-simple')),
                  h('button.icon-btn.sm', { title: `Remove ${r.code}`, 'aria-label': `Remove ${r.code}`, onclick: (e) => (e.stopPropagation(), again(() => run('edit_library_code', { library: lib.name, code: r.code, remove: true }))()) }, icon('trash')),
                ],
              }).el,
            )
          : null,
      );
    };
    const shown = this.modal('Feature code libraries', body);
    draw().catch(fail);
    return shown;
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
    return this.modal('Keyboard shortcuts', h('div.panel', { style: { padding: 0, gap: '4px' } }, rows.map((a) => h('div.row', {}, h('span.grow', {}, a.label), h('kbd', {}, a.key))), h('p.small.muted', {}, 'While a tool is active, just type numbers: they go to the Measurements box (bottom right). Arrow keys lock an axis: → red, ← green, ↑ blue. Middle mouse (or Alt + drag) orbits, right mouse (or Alt + Shift + drag) pans, the wheel or a pinch zooms.')));
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
        run: () => ((c.params.required || []).length || pickSteps(c.params).length ? this.commandDialog(c.name) : this.app.reg.run(c.name, {}).then((r) => this.toast(JSON.stringify(r).slice(0, 200))).catch((e) => this.toast(e.message, 'danger'))),
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
