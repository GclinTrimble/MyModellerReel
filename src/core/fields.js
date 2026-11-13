// Command form fields (#215): which control a schema property gets, its default, and reading what was typed. Pure, so
// the rules are tested in Node; src/renderer/forms.js draws the controls. Hints live in the schema as `ui` (on a
// property: { kind, count }; on params: { modes: [{ label, fields }] }) and are stripped from what AIs and MCP see.
import { direction } from './cogo.js';

/** A params schema without the form hints: AIs, MCP and the HTTP API get plain JSON Schema. */
export function stripUi(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
  const { ui, ...out } = s;
  if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, stripUi(v)]));
  if (out.items) out.items = stripUi(out.items);
  return out;
}

const POINTISH = /point names? or \[x, y, z\]|a point name or \[x, y, z\]/i;

/** The special control a field needs: 'point', 'points', 'angle', 'tuple', or null for the plain ones. */
export function kindOf(s = {}) {
  if (s.ui?.kind) return s.ui.kind;
  const d = s.description || '';
  if (POINTISH.test(d)) return s.type === 'array' ? 'points' : 'point';
  if (s.type !== 'number' && s.type !== 'array' && /degrees from north|\bDMS\b/.test(d)) return 'angle';
  if (s.type === 'array' && s.items?.type === 'number' && tupleLabels(s)) return 'tuple';
  return null;
}

/** "[width, depth] m, default [20, 20]" → ['width', 'depth']. */
export function tupleLabels(s = {}) {
  const m = (s.description || '').match(/^\s*\[\s*([a-z]+(?:\s*,\s*[a-z]+){1,2})\s*\]/i);
  return m ? m[1].split(/\s*,\s*/) : null;
}

/** The default a command uses when the field is left empty, from `default` or "default 5" in the description. */
export function defaultOf(s = {}) {
  if (s.default !== undefined) return s.default;
  const m = (s.description || '').match(/default:?\s*(\[[^\]]*\]|[-−]?\d+(?:\.\d+)?)/i);
  if (!m) return undefined;
  const t = m[1].replace(/−/g, '-');
  return t.startsWith('[') ? t.slice(1, -1).split(',').map(Number) : +t;
}

/** An example from "e.g. …" in the description, for a placeholder. */
export const exampleOf = (s = {}) => (s.description || '').match(/e\.g\.\s*"?([^",;)]+)"?/i)?.[1]?.trim() || '';

/** A point typed or chosen: a known name, or "x, y, z" (brackets optional). Returns { value } or { error }. */
export function readPoint(text, names, { namesOnly = false } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return { value: undefined };
  const n = t.replace(/^\[|\]$/g, '').split(/[,;\s]+/).filter(Boolean);
  if (!namesOnly && n.length === 3 && n.every((x) => Number.isFinite(+x))) return { value: n.map(Number) };
  if (names.has(t)) return { value: t };
  return { error: `No point named "${t}". Choose one from the list${namesOnly ? '' : ', pick it in the view, or type x, y, z'}.` };
}

/** A bearing or angle: degrees (45.5), DMS (45°30'00"), a quadrant bearing (N45°30'E) or a turn (R90, L45, AR270). The text is sent as typed; the command reads it. */
export function readAngle(text) {
  const t = String(text ?? '').trim();
  if (!t) return { value: undefined };
  try {
    direction(t, { prev: 0 });
    return { value: /^-?\d+(\.\d+)?$/.test(t) ? +t : t };
  } catch {
    return { error: 'Type degrees (45.5), degrees, minutes, seconds (45°30\'00") or a bearing (N45°30\'E).' };
  }
}

/** A number within the schema's limits. */
export function readNumber(text, s = {}) {
  const t = String(text ?? '').trim().replace(/−/g, '-').replace(',', '.');
  if (!t) return { value: undefined };
  const v = Number(t);
  if (!Number.isFinite(v)) return { error: 'Type a number.' };
  if (s.type === 'integer' && !Number.isInteger(v)) return { error: 'Type a whole number.' };
  if (s.minimum !== undefined && v < s.minimum) return { error: `At least ${s.minimum}.` };
  if (s.maximum !== undefined && v > s.maximum) return { error: `At most ${s.maximum}.` };
  return { value: v };
}

const isV3 = (s = {}) => s.type === 'array' && s.items?.type === 'number' && s.minItems === 3 && s.maxItems === 3;
/**
 * Pick first (#234): the point arguments a command needs that preset does not give, in schema order, as steps of
 * picks: { key, count (Infinity: until Enter), many (an array of points), names (named points only) }. The needed ones
 * are params.required plus the first mode's.
 */
export function pickSteps(params = {}, preset = {}) {
  const props = params.properties || {};
  const m = params.ui?.modes?.[0];
  const need = new Set([...(params.required || []), ...(m ? m.required || m.fields.slice(0, 1) : [])]);
  return Object.keys(props)
    .filter((k) => need.has(k) && preset[k] === undefined)
    .map((k) => {
      const s = props[k];
      const kind = kindOf(s);
      if (kind === 'point' || isV3(s)) return { key: k, count: 1, many: false, names: !!s.ui?.names };
      if (kind === 'points' || (s.type === 'array' && isV3(s.items))) return { key: k, count: s.ui?.count || Infinity, many: true, names: !!s.ui?.names };
      return null;
    })
    .filter(Boolean);
}

/** "1.5" → 1.5 m · "150mm" · "15cm" · "3'" · '6"'. Returns metres (NaN when it is not a length). */
export function parseLength(s) {
  const m = String(s).trim().replace(/−/g, '-').match(/^(-?[\d.]+)\s*(mm|cm|m|km|'|"|ft|in)?$/i);
  if (!m) return NaN;
  const f = { mm: 0.001, cm: 0.01, m: 1, km: 1000, "'": 0.3048, ft: 0.3048, '"': 0.0254, in: 0.0254 }[(m[2] || 'm').toLowerCase()];
  return parseFloat(m[1]) * f;
}

/**
 * A point typed while picking (#234): absolute "x, y, z", relative "@dx, dy, dz" (or ＠) from the last point, or one
 * length along the rubber band from the last point towards the cursor. from / toward are [x, y, z] or null.
 * Returns { value: [x, y, z] } or { error }.
 */
export function readTyped(text, { from = null, toward = null } = {}) {
  let t = String(text ?? '').trim().replace(/＠/g, '@').replace(/−/g, '-');
  if (!t) return { value: undefined };
  const rel = t.startsWith('@');
  if (rel) t = t.slice(1).trim();
  const parts = t.replace(/^\[|\]$/g, '').split(/\s*[,;]\s*|\s+/).filter(Boolean);
  if (parts.length === 3) {
    const n = parts.map(Number);
    if (!n.every(Number.isFinite)) return { error: 'Type numbers: x, y, z.' };
    if (!rel) return { value: n };
    if (!from) return { error: 'Nothing to be relative to yet: type x, y, z for the first point.' };
    return { value: from.map((x, i) => x + n[i]) };
  }
  if (parts.length === 1 && !rel) {
    const d = parseLength(parts[0]);
    if (!Number.isFinite(d)) return { error: 'Type x, y, z, @dx, dy, dz, or a distance.' };
    if (!from) return { error: 'A distance needs a first point: type x, y, z or pick it.' };
    const v = (toward || from).map((x, i) => x - from[i]);
    const len = Math.hypot(...v);
    if (len < 1e-9) return { error: 'Move the cursor to show the direction, then type the distance.' };
    return { value: from.map((x, i) => x + (v[i] / len) * d) };
  }
  return { error: rel ? 'Relative is @dx, dy, dz.' : 'Type x, y, z, @dx, dy, dz, or a distance.' };
}
