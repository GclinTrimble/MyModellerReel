// Command form fields (#215): which control a schema property gets, its default, and reading what was typed. Pure, so
// the rules are tested in Node; src/renderer/forms.js draws the controls. Hints live in the schema as `ui` (on a
// property: { kind, count }; on params: { modes: [{ label, fields }] }) and are stripped from what AIs and MCP see.
import { parseAngle } from './survey.js';

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

/** A bearing or angle: degrees (45.5) or DMS (45°30'00"). The text is sent as typed; the command reads it. */
export function readAngle(text) {
  const t = String(text ?? '').trim();
  if (!t) return { value: undefined };
  try {
    parseAngle(t);
    return { value: /^-?\d+(\.\d+)?$/.test(t) ? +t : t };
  } catch {
    return { error: 'Type degrees (45.5) or degrees, minutes, seconds (45°30\'00").' };
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
