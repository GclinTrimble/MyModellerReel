// Friendly command forms (#201): the fields of any command, made from its JSON Schema, in plain words and with the
// right control for each value — colours with swatches, on / off, choices as buttons, numbers with their unit, points
// picked in the view, entities from the model — required fields first, the rest folded under "More options".
import { h, icon } from './ui.js';

export const SWATCHES = ['#c8553d', '#e8bc5e', '#4c7a5a', '#2f6f86', '#1e3a4c', '#7a5c8c', '#b5492b', '#8a6d3b', '#9aa3ab', '#3c3f44', '#d9d4c7', '#ffffff'];
const ENTITY_KEYS = new Set(['id', 'corridor', 'alignment', 'surface', 'existing', 'design', 'from_face', 'from', 'to', 'target', 'path', 'profile_from', 'parent', 'of', 'curve', 'outline']);
const LAYER_KEYS = new Set(['tag', 'layer']);

/** "line_weight" → "Line weight"; a few words people use instead of the API's. */
export function human(k) {
  const words = { id: 'Which one', ids: 'Which ones', epsg: 'EPSG code', crs: 'Coordinate system', fov: 'Field of view', ior: 'Index of refraction', vcb: 'Value', dof: 'Depth of field', ao: 'Ambient occlusion' };
  return words[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
/** The unit at the start of a description ("m", "mm", "%", "degrees", "H:V"…), shown after a number. */
export function unitOf(desc = '') {
  const m = String(desc).match(/^\s*(m²|m³|mm|cm|km|m|%|°|degrees|deg|px|s|seconds|H:V|ftUS|ft|t|kg)\b/i) || String(desc).match(/[,(]\s*(mm|cm|m|%|degrees|px|s)\)?\s*$/i);
  return m ? m[1].replace('degrees', '°').replace('deg', '°').replace('seconds', 's') : '';
}
const isV3 = (s) => s.type === 'array' && s.items?.type === 'number' && s.minItems === 3 && s.maxItems === 3;
const isPoints = (s) => s.type === 'array' && isV3(s.items || {});
const isColor = (k, s) => /colou?r|tint|emissive/.test(k) || /#rrggbb|hex colou?r/i.test(s.description || '');
/** "a | b | c" in a description, when there is no enum: suggestions. */
const choicesIn = (s) => (!s.enum && s.type === 'string' && /\|/.test(s.description || '') ? s.description.split(/[:(]/).pop().split('|').map((x) => x.replace(/\(.*|default.*/i, '').trim()).filter((x) => /^[\w-]{1,24}$/.test(x)) : null);

/**
 * The form of command c (its schema) prefilled with preset. Returns { el, read(), error(field, msg) } where read()
 * gives the arguments to run it with (fields left empty are not sent, so the command's defaults apply).
 */
export function buildForm(app, c, preset = {}, { pick } = {}) {
  const props = c.params.properties || {};
  const req = new Set(c.params.required || []);
  const doc = app.store.doc;
  const names = [...new Set(doc.entities.filter((e) => !e.parent || e.type !== 'point').map((e) => e.name))].slice(0, 400);
  const layers = (doc.tags || []).map((t) => t.name);
  const readers = {};
  const rows = {};
  const tip = (s) => (s.description ? h('span.form-tip', { title: s.description, 'aria-label': s.description, tabindex: 0 }, icon('info')) : null);
  const field = (k, s) => {
    const v = preset[k];
    let control;
    let read;
    if (k === 'ids') {
      const sel = app.selection.length;
      const useSel = h('input', { type: 'checkbox', checked: v === undefined && sel > 0 });
      const list = h('input', { value: Array.isArray(v) ? v.join(', ') : '', list: 'form-entities', placeholder: 'names, separated by commas' });
      control = h('div.form-stack', {}, h('label.form-check', {}, useSel, `The selection (${sel})`), list);
      read = () => (list.value.trim() ? list.value.split(',').map((x) => x.trim()).filter(Boolean) : useSel.checked ? undefined : undefined);
    } else if (s.enum && (s.enum.length <= 4 || s.type === 'boolean')) {
      // a few choices: buttons
      let cur = v === undefined ? null : String(v);
      const opts = [...(req.has(k) ? [] : [[null, 'Default']]), ...s.enum.map((o) => [String(o), String(o).replace(/_/g, ' ')])];
      const btns = opts.map(([val, label]) => h('button.seg', { type: 'button', 'aria-pressed': String(cur === val), onclick: () => ((cur = val), btns.forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i][0] === cur)))) }, label));
      control = h('div.segmented', { role: 'radiogroup' }, ...btns);
      read = () => cur ?? undefined;
    } else if (s.enum) {
      const sel = h('select', {}, h('option', { value: '' }, req.has(k) ? 'Choose…' : 'Default'), s.enum.map((o) => h('option', { value: o, selected: String(v) === String(o) }, String(o).replace(/_/g, ' '))));
      control = sel;
      read = () => sel.value || undefined;
    } else if (s.type === 'boolean') {
      let cur = v === undefined ? null : !!v;
      const opts = [[null, 'Default'], [true, 'Yes'], [false, 'No']];
      const btns = opts.map(([val, label]) => h('button.seg', { type: 'button', 'aria-pressed': String(cur === val), onclick: () => ((cur = val), btns.forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i][0] === cur)))) }, label));
      control = h('div.segmented', { role: 'radiogroup' }, ...btns);
      read = () => cur ?? undefined;
    } else if (s.type === 'string' && isColor(k, s)) {
      const text = h('input', { value: v || '', placeholder: '#rrggbb', class: 'form-color-text' });
      const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#c8553d', oninput: () => (text.value = picker.value) });
      text.oninput = () => /^#[0-9a-f]{6}$/i.test(text.value) && (picker.value = text.value);
      control = h('div.form-row', {}, picker, text, h('div.form-swatches', {}, SWATCHES.map((c2) => h('button.form-swatch', { type: 'button', title: c2, style: { background: c2 }, onclick: () => ((text.value = c2), (picker.value = c2)) }))));
      read = () => text.value.trim() || undefined;
    } else if (s.type === 'number' || s.type === 'integer') {
      const inp = h('input', { type: 'number', step: 'any', value: v ?? '' });
      const unit = unitOf(s.description);
      control = h('div.form-row', {}, inp, unit ? h('span.form-unit', {}, unit) : null);
      read = () => (inp.value === '' ? undefined : +inp.value);
    } else if (isV3(s)) {
      const inps = ['x', 'y', 'z'].map((a, i) => h('input', { type: 'number', step: 'any', value: v?.[i] ?? '', placeholder: a, 'aria-label': `${human(k)} ${a}` }));
      const pb = pick && h('button.btn.sm', { type: 'button', onclick: async () => { const [p] = (await pick(1, `Click the ${human(k).toLowerCase()} in the view`)) || []; if (p) inps.forEach((x, i) => (x.value = Math.round(p[i] * 1000) / 1000)); } }, icon('crosshair'), 'Pick in the view');
      control = h('div.form-row', {}, ...inps, pb);
      read = () => (inps.every((x) => x.value === '') ? undefined : inps.map((x) => +x.value || 0));
    } else if (isPoints(s)) {
      const ta = h('textarea', { rows: 2, value: v ? JSON.stringify(v) : '', placeholder: '[[x, y, z], …]' });
      const pb = pick && h('button.btn.sm', { type: 'button', onclick: async () => { const pts = await pick(0, 'Click the points in the view; Enter when done'); if (pts?.length) ta.value = JSON.stringify(pts.map((p) => p.map((x) => Math.round(x * 1000) / 1000))); } }, icon('crosshair'), 'Pick points in the view');
      control = h('div.form-stack', {}, ta, pb);
      read = () => (ta.value.trim() ? JSON.parse(ta.value) : undefined);
    } else if (s.type === 'array' && (s.items?.type === 'number' || s.items?.type === 'string')) {
      const inp = h('input', { value: Array.isArray(v) ? v.join(', ') : v ?? '', placeholder: s.items.type === 'number' ? '1, 2, 3' : 'a, b, c', list: s.items.type === 'string' ? 'form-entities' : undefined });
      control = inp;
      read = () => (inp.value.trim() ? inp.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (s.items.type === 'number' ? +x : x)) : undefined);
    } else if (s.type === 'string' || !s.type) {
      const listId = LAYER_KEYS.has(k) ? 'form-layers' : ENTITY_KEYS.has(k) || /entity|id or name|curve|alignment|surface/i.test(s.description || '') ? 'form-entities' : null;
      const choices = choicesIn(s);
      const dl = choices && h('datalist', { id: `form-${k}` }, choices.map((x) => h('option', { value: x })));
      const inp = h('input', { value: v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v), list: listId || (choices ? `form-${k}` : undefined), placeholder: choices ? choices.join(' · ') : '' });
      control = h('div.form-stack', {}, inp, dl);
      read = () => {
        const t = inp.value.trim();
        if (!t) return undefined;
        if (!s.type && /^[[{]/.test(t)) return JSON.parse(t);
        return t;
      };
    } else {
      // objects and anything else: JSON, for the few who need it
      const ta = h('textarea', { rows: 3, value: v ? JSON.stringify(v, null, 1) : '', placeholder: '{ }' });
      control = ta;
      read = () => (ta.value.trim() ? JSON.parse(ta.value) : undefined);
    }
    readers[k] = read;
    // screen readers (and tests) find each field by its name
    const first = control.matches?.('input, select, textarea') ? control : control.querySelector?.('input:not([type=checkbox]):not([type=color]), select, textarea');
    if (first && !first.getAttribute('aria-label')) first.setAttribute('aria-label', human(k));
    const msg = h('div.form-error', { role: 'alert' });
    const row = h('div.form-field', {}, h('div.form-label', {}, h('span', {}, human(k), req.has(k) ? h('span.form-req', { title: 'Needed' }, ' *') : null), tip(s)), control, s.description ? h('div.form-help', {}, s.description) : null, msg);
    rows[k] = msg;
    return row;
  };
  const keys = Object.keys(props);
  const main = keys.filter((k) => req.has(k) || preset[k] !== undefined || k === 'ids' || k === 'id'); // which thing(s) it acts on come first
  const more = keys.filter((k) => !main.includes(k));
  const el = h(
    'div.cmd-form',
    {},
    h('datalist', { id: 'form-entities' }, names.map((n) => h('option', { value: n }))),
    h('datalist', { id: 'form-layers' }, layers.map((n) => h('option', { value: n }))),
    ...main.map((k) => field(k, props[k])),
    more.length ? h('details.form-more', { open: !main.length }, h('summary', {}, `More options (${more.length})`), ...more.map((k) => field(k, props[k]))) : null,
    !keys.length ? h('p.small', {}, 'Nothing to fill in.') : null,
  );
  return {
    el,
    read() {
      const args = {};
      for (const k of Object.keys(rows)) rows[k].textContent = '';
      for (const [k, r] of Object.entries(readers)) {
        let v;
        try {
          v = r();
        } catch {
          rows[k].textContent = 'This is not valid; check the brackets and commas.';
          throw new Error(`${human(k)} is not valid.`);
        }
        if (v !== undefined) args[k] = v;
      }
      for (const k of req) if (args[k] === undefined && k !== 'ids') {
        rows[k].textContent = 'Needed.';
        throw new Error(`${human(k)} is needed.`);
      }
      return args;
    },
    error(k, m) {
      if (rows[k]) rows[k].textContent = m;
    },
  };
}
