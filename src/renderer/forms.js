// Friendly command forms (#201, #215): the fields of any command, made from its JSON Schema, in plain words and with the
// right control for each value — the model's points to choose from, numbers with their unit and default, bearings in
// degrees or DMS, colours with swatches, choices as buttons — checked as you type, help in the ⓘ tooltip, alternative
// inputs as modes (params.ui.modes), required fields first and the rest folded under "More options".
import { h, icon } from './ui.js';
import { kindOf, defaultOf, exampleOf, tupleLabels, readPoint, readAngle, readNumber } from '../core/fields.js';

export const SWATCHES = ['#c8553d', '#e8bc5e', '#4c7a5a', '#2f6f86', '#1e3a4c', '#7a5c8c', '#b5492b', '#8a6d3b', '#9aa3ab', '#3c3f44', '#d9d4c7', '#ffffff'];
const ENTITY_KEYS = new Set(['id', 'corridor', 'alignment', 'surface', 'existing', 'design', 'from_face', 'from', 'to', 'target', 'path', 'profile_from', 'parent', 'of', 'curve', 'outline']);
const LAYER_KEYS = new Set(['tag', 'layer']);
const SNAP = 0.25; // m: a pick this close to a named point uses its name

/** "line_weight" → "Line weight"; a few words people use instead of the API's. */
export function human(k) {
  const words = { id: 'Which one', ids: 'Which ones', epsg: 'EPSG code', crs: 'Coordinate system', fov: 'Field of view', ior: 'Index of refraction', vcb: 'Value', dof: 'Depth of field', ao: 'Ambient occlusion', n: 'Northing', e: 'Easting', z: 'Elevation', dz: 'Height difference' };
  return words[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
/** The unit at the start of a description ("m", "mm", "%", "degrees", "H:V"…), shown after a number. */
export function unitOf(desc = '') {
  const m = String(desc).match(/^\s*(m²|m³|mm|cm|km|m|%|°|degrees|deg|px|s|seconds|H:V|ftUS|ft|t|kg)(?=[\s,.;)]|$)/i) || String(desc).match(/[,(]\s*(mm|cm|m|%|degrees|px|s)\)?\s*$/i) || String(desc).match(/^\s*\[[^\]]*\]\s*(mm|cm|m|%)\b/i);
  return m ? m[1].replace('degrees', '°').replace('deg', '°').replace('seconds', 's') : '';
}
const isV3 = (s) => s.type === 'array' && s.items?.type === 'number' && s.minItems === 3 && s.maxItems === 3;
const isPoints = (s) => s.type === 'array' && isV3(s.items || {});
const isColor = (k, s) => /colou?r|tint|emissive/.test(k) || /#rrggbb|hex colou?r/i.test(s.description || '');
/** "a | b | c" in a description, when there is no enum: suggestions. */
const choicesIn = (s) => (!s.enum && s.type === 'string' && /\|/.test(s.description || '') ? s.description.split(/[:(]/).pop().split('|').map((x) => x.replace(/\(.*|default.*/i, '').trim()).filter((x) => /^[\w-]{1,24}$/.test(x)) : null);
const r3 = (p) => p.map((x) => Math.round(x * 1000) / 1000);

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
  const pts = doc.entities.filter((e) => e.type === 'point');
  const pointNames = new Set(pts.map((p) => p.name));
  /** A picked spot: the named point there, else its coordinates. */
  const snapName = (p) => pts.find((q) => Math.hypot(q.position[0] - p[0], q.position[1] - p[1], q.position[2] - p[2]) < SNAP)?.name || r3(p);
  const posOf = (name) => r3(pts.find((q) => q.name === name).position);
  const modes = c.params.ui?.modes || [];
  let mode = Math.max(0, modes.findIndex((m) => m.fields.some((k) => preset[k] !== undefined)));
  const inMode = (k) => modes.findIndex((m) => m.fields.includes(k));
  const needed = (k) => req.has(k) || (modes.length && inMode(k) === mode && (modes[mode].required || modes[mode].fields.slice(0, 1)).includes(k));
  const fields = {};

  const tip = (s) => (s.description ? h('span.form-tip', { title: s.description, 'aria-label': s.description, tabindex: 0 }, icon('info')) : null);
  const field = (k, s) => {
    const v = preset[k];
    const kind = kindOf(s);
    const def = defaultOf(s);
    const unit = unitOf(s.description);
    const msg = h('div.form-error', { role: 'alert' });
    let control;
    let read; // returns the value, or throws with a message for the field
    const checked = (fn) => () => {
      const r = fn();
      if (r.error) throw new Error(r.error);
      return r.value;
    };
    // validation as you type: the message under the field, the box marked
    const live = (inp, fn) => {
      const run = () => {
        const r = fn();
        msg.textContent = r.error || '';
        inp.setAttribute('aria-invalid', String(!!r.error));
      };
      inp.addEventListener('input', run);
      inp.addEventListener('blur', run);
    };
    if (k === 'ids') {
      const sel = app.selection.length;
      const useSel = h('input', { type: 'checkbox', checked: v === undefined && sel > 0 });
      const list = h('input', { value: Array.isArray(v) ? v.join(', ') : '', list: 'form-entities', placeholder: 'names, separated by commas' });
      control = h('div.form-stack', {}, h('label.form-check', {}, useSel, `The selection (${sel})`), list);
      read = () => (list.value.trim() ? list.value.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
    } else if (kind === 'point') {
      // one point: the model's points to choose from, or x, y, z; Pick in the view snaps to a named point
      const namesOnly = !!s.ui?.names;
      const inp = h('input', { value: v === undefined ? '' : Array.isArray(v) ? v.join(', ') : v, list: 'form-points', placeholder: pts.length ? `e.g. ${pts[0].name}${namesOnly ? '' : ', or x, y, z'}` : namesOnly ? 'a point name' : 'x, y, z' });
      const fn = () => readPoint(inp.value, pointNames, { namesOnly });
      live(inp, fn);
      const pb = pick && !namesOnly && h('button.btn.sm', { type: 'button', title: 'Click it in the view', onclick: async () => { const [p] = (await pick(1, `Click the ${human(k).toLowerCase()} in the view`)) || []; if (p) (inp.value = [snapName(p)].flat().join(', ')), inp.dispatchEvent(new Event('input')); } }, icon('crosshair'), 'Pick');
      control = h('div.form-row.form-grow', {}, inp, pb);
      read = checked(fn);
    } else if (kind === 'points' || isPoints(s)) {
      // several points as chips: choose from the list, type x, y, z, or pick them in the view
      const coords = isPoints(s); // the command wants coordinates: a chosen name becomes its position
      const count = s.ui?.count;
      const vals = Array.isArray(v) ? [...v] : [];
      const chips = h('div.form-chips', { role: 'list' });
      const inp = h('input', { list: 'form-points', placeholder: count ? `Choose ${count} points` : pts.length ? 'Choose points, or type x, y, z' : 'x, y, z' });
      const label = (p) => (Array.isArray(p) ? p.join(', ') : p);
      const fn = () => (count && vals.length && vals.length !== count ? { error: `Choose ${count} points (${vals.length} so far).` } : { value: vals.length ? vals : undefined });
      const show = () => {
        chips.replaceChildren(...vals.map((p, i) => h('span.form-chip', { role: 'listitem' }, icon('map-pin'), label(p), h('button.form-chip-x', { type: 'button', 'aria-label': `Remove ${label(p)}`, onclick: () => (vals.splice(i, 1), show()) }, icon('x')))));
        inp.hidden = !!count && vals.length >= count;
        if (pb) pb.hidden = inp.hidden;
        const r = fn();
        msg.textContent = r.error || '';
      };
      const add = () => {
        const r = readPoint(inp.value, pointNames);
        if (r.error) return (msg.textContent = r.error);
        if (r.value === undefined) return;
        vals.push(coords && typeof r.value === 'string' ? posOf(r.value) : r.value);
        inp.value = '';
        show();
      };
      inp.onchange = add; // a choice from the list, or typed and left
      inp.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), add());
      const pb = pick && h('button.btn.sm', { type: 'button', onclick: async () => { const got = await pick(count ? count - vals.length : 0, count ? `Click ${count - vals.length} point(s) in the view` : 'Click the points in the view; Enter when done'); for (const p of got || []) vals.push(coords ? r3(p) : snapName(p)); show(); } }, icon('crosshair'), 'Pick in the view');
      control = h('div.form-stack', {}, chips, h('div.form-row.form-grow', {}, inp, pb));
      show();
      read = checked(fn);
    } else if (kind === 'angle') {
      const inp = h('input', { value: v ?? '', inputmode: 'decimal', placeholder: def !== undefined ? String(def) : 'e.g. 45 or 45°30\'', class: 'form-num form-angle' });
      const fn = () => readAngle(inp.value);
      live(inp, fn);
      control = h('div.form-row', {}, inp, h('span.form-unit', {}, '°'));
      read = checked(fn);
    } else if (kind === 'tuple') {
      const labels = tupleLabels(s);
      const inps = labels.map((l, i) => h('input', { value: v?.[i] ?? '', inputmode: 'decimal', placeholder: Array.isArray(def) ? String(def[i]) : l, 'aria-label': `${human(k)} ${l}`, title: l }));
      const each = () => inps.map((x) => readNumber(x.value, s.items));
      inps.forEach((x) => live(x, () => each().find((r) => r.error) || { value: 0 }));
      control = h('div.form-row.form-tuple', {}, ...inps.flatMap((x, i) => [i ? h('span.form-unit', {}, '×') : null, x]), unit ? h('span.form-unit', {}, unit) : null, h('span.form-hint', {}, labels.join(' × ')));
      read = () => {
        const rs = each();
        const bad = rs.find((r) => r.error);
        if (bad) throw new Error(bad.error);
        if (rs.every((r) => r.value === undefined)) return undefined;
        return rs.map((r, i) => r.value ?? (Array.isArray(def) ? def[i] : 0));
      };
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
      const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#c8553d', title: 'Another colour', oninput: () => (text.value = picker.value) });
      text.oninput = () => /^#[0-9a-f]{6}$/i.test(text.value) && (picker.value = text.value);
      const fn = () => (!text.value.trim() || /^#[0-9a-f]{6}$/i.test(text.value.trim()) ? { value: text.value.trim() || undefined } : { error: 'A colour is # and six hex digits, e.g. #c8553d.' });
      live(text, fn);
      control = h('div.form-row', {}, h('div.form-swatches', {}, SWATCHES.map((c2) => h('button.form-swatch', { type: 'button', title: c2, 'aria-label': c2, style: { background: c2 }, onclick: () => ((text.value = c2), (picker.value = c2), (msg.textContent = '')) }))), picker, text);
      read = checked(fn);
    } else if (s.type === 'number' || s.type === 'integer') {
      const inp = h('input', { value: v ?? '', inputmode: 'decimal', placeholder: def !== undefined ? String(def) : exampleOf(s), class: 'form-num' });
      const fn = () => readNumber(inp.value, s);
      live(inp, fn);
      control = h('div.form-row', {}, inp, unit ? h('span.form-unit', {}, unit) : null);
      read = checked(fn);
    } else if (isV3(s)) {
      const inps = ['x', 'y', 'z'].map((a, i) => h('input', { value: v?.[i] ?? '', inputmode: 'decimal', placeholder: a, 'aria-label': `${human(k)} ${a}`, class: 'form-num' }));
      inps.forEach((x) => live(x, () => readNumber(x.value)));
      const pb = pick && h('button.btn.sm', { type: 'button', onclick: async () => { const [p] = (await pick(1, `Click the ${human(k).toLowerCase()} in the view`)) || []; if (p) inps.forEach((x, i) => (x.value = r3(p)[i])); } }, icon('crosshair'), 'Pick');
      control = h('div.form-row', {}, ...inps, pb);
      read = () => {
        if (inps.every((x) => x.value === '')) return undefined;
        return inps.map((x) => {
          const r = readNumber(x.value);
          if (r.error) throw new Error(r.error);
          return r.value ?? 0;
        });
      };
    } else if (s.type === 'array' && (s.items?.type === 'number' || s.items?.type === 'string')) {
      const inp = h('input', { value: Array.isArray(v) ? v.join(', ') : v ?? '', placeholder: Array.isArray(def) ? def.join(', ') : s.items.type === 'number' ? '1, 2, 3' : 'a, b, c', list: s.items.type === 'string' ? 'form-entities' : undefined });
      control = inp;
      read = () => (inp.value.trim() ? inp.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (s.items.type === 'number' ? +x : x)) : undefined);
    } else if (s.type === 'string' || !s.type) {
      const listId = LAYER_KEYS.has(k) ? 'form-layers' : ENTITY_KEYS.has(k) || /entity|id or name|curve|alignment|surface/i.test(s.description || '') ? 'form-entities' : null;
      const choices = choicesIn(s);
      const dl = choices && h('datalist', { id: `form-${k}` }, choices.map((x) => h('option', { value: x })));
      const inp = h('input', { value: v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v), list: listId || (choices ? `form-${k}` : undefined), placeholder: choices ? choices.join(' · ') : def !== undefined ? String(def) : exampleOf(s) });
      control = h('div.form-stack', {}, inp, dl);
      read = () => {
        const t = inp.value.trim();
        if (!t) return undefined;
        if (!s.type && /^[[{]/.test(t)) return JSON.parse(t);
        return t;
      };
    } else {
      // objects and anything else: JSON, for the few who need it
      const ta = h('textarea', { rows: 3, value: v ? JSON.stringify(v, null, 1) : '', placeholder: '{ "key": value }' });
      control = ta;
      read = () => (ta.value.trim() ? JSON.parse(ta.value) : undefined);
    }
    // screen readers (and tests) find each field by its name
    const first = control.matches?.('input, select, textarea') ? control : control.querySelector?.('input:not([type=checkbox]):not([type=color]), select, textarea');
    if (first && !first.getAttribute('aria-label')) first.setAttribute('aria-label', human(k));
    const star = h('span.form-req', { title: 'Needed', hidden: !needed(k) }, ' *');
    const row = h('div.form-field', { 'data-field': k }, h('div.form-label', {}, h('span', {}, human(k), star), tip(s)), control, msg);
    fields[k] = { row, read, msg, star };
    return row;
  };

  const keys = Object.keys(props);
  const modeKeys = modes.flatMap((m) => m.fields);
  const main = keys.filter((k) => !modeKeys.includes(k) && (req.has(k) || preset[k] !== undefined || k === 'ids' || k === 'id')); // which thing(s) it acts on come first
  const more = keys.filter((k) => !modeKeys.includes(k) && !main.includes(k));
  const showMode = () => {
    for (const k of modeKeys) {
      fields[k].row.hidden = inMode(k) !== mode;
      fields[k].star.hidden = !needed(k);
    }
    modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === mode)));
  };
  const modeBtns = modes.map((m, i) => h('button.seg', { type: 'button', onclick: () => ((mode = i), showMode()) }, m.label));
  const el = h(
    'div.cmd-form',
    {},
    h('datalist', { id: 'form-entities' }, names.map((n) => h('option', { value: n }))),
    h('datalist', { id: 'form-layers' }, layers.map((n) => h('option', { value: n }))),
    h('datalist', { id: 'form-points' }, pts.slice(0, 2000).map((p) => h('option', { value: p.name }, p.point?.code || ''))),
    modes.length ? h('div.segmented.form-modes', { role: 'radiogroup', 'aria-label': 'How' }, ...modeBtns) : null,
    ...main.map((k) => field(k, props[k])),
    ...modeKeys.map((k) => field(k, props[k])),
    more.length ? h('details.form-more', { open: !main.length && !modes.length }, h('summary', {}, `More options (${more.length})`), ...more.map((k) => field(k, props[k]))) : null,
    !keys.length ? h('p.small', {}, 'Nothing to fill in.') : null,
  );
  if (modes.length) showMode();
  return {
    el,
    read() {
      const args = {};
      for (const f of Object.values(fields)) f.msg.textContent = '';
      for (const [k, f] of Object.entries(fields)) {
        if (f.row.hidden) continue; // another mode's field
        let v;
        try {
          v = f.read();
        } catch (e) {
          f.msg.textContent = e instanceof SyntaxError ? 'This is not valid; check the brackets and commas.' : e.message;
          throw new Error(`${human(k)}: ${f.msg.textContent}`);
        }
        if (v !== undefined) args[k] = v;
      }
      for (const k of Object.keys(fields))
        if (!fields[k].row.hidden && needed(k) && args[k] === undefined && k !== 'ids') {
          fields[k].msg.textContent = 'Needed.';
          throw new Error(`${human(k)} is needed.`);
        }
      return args;
    },
    error(k, m) {
      if (fields[k]) fields[k].msg.textContent = m;
    },
  };
}
