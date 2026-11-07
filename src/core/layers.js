// Layers (#138): the tag list is the layer list. A layer is { name, visible, color?, locked?, line_type?, line_weight?,
// description?, schema? }; "/" in a name makes groups ("C-ROAD/Kerbs"). Entities point at one by `tag`, and with
// `byLayer: true` take its colour. Feature layers carry an attribute schema that set_metadata checks.
import * as D from './document.js';

export const FIELDS = ['color', 'locked', 'line_type', 'line_weight', 'description', 'schema'];

/** A glob ("C-ROAD/*", "*kerb*") or exact name to a predicate, case-insensitive. */
export function matcher(pattern) {
  const re = new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return (name) => re.test(name);
}

export const layerOf = (doc, name) => doc.tags.find((t) => t.name === name);

export function ensureLayer(doc, name) {
  let t = layerOf(doc, name);
  if (!t) doc.tags.push((t = { name, visible: true }));
  return t;
}

/** Layers matching a name or glob; an unknown exact name is an error. */
export function find(doc, pattern) {
  const hit = doc.tags.filter((t) => matcher(pattern)(t.name));
  if (!hit.length) throw new Error(`No layer matches "${pattern}". Layers: ${doc.tags.map((t) => t.name).join(', ')}.`);
  return hit;
}

export const isLocked = (doc, e) => !!(e.locked || layerOf(doc, e.tag)?.locked);
export const colorOf = (doc, e) => (e.byLayer && layerOf(doc, e.tag)?.color) || e.material.color;

/** Layer table with counts and plan extents (world boxes), for people and AIs. */
export function listLayers(doc) {
  const by = new Map(doc.tags.map((t) => [t.name, []]));
  for (const e of doc.entities) if (!e.parent) by.get(e.tag)?.push(e);
  return doc.tags.map((t) => {
    const ents = by.get(t.name);
    const box = ents.length ? D.unionBox(ents.map((e) => D.worldBox(doc, e))) : null;
    return {
      ...t,
      count: ents.length,
      current: (doc.settings.current_layer || 'Untagged') === t.name,
      ...(box && Number.isFinite(box.min[0]) ? { extent: { min: D.round3(box.min), max: D.round3(box.max) } } : {}),
    };
  });
}

/** Move every entity of the `from` layers onto `to`, and drop the emptied layers (never Untagged). */
export function mergeLayers(doc, from, to) {
  ensureLayer(doc, to);
  const names = new Set(from.filter((n) => n !== to));
  let moved = 0;
  for (const e of doc.entities) if (names.has(e.tag)) (e.tag = to), moved++;
  doc.tags = doc.tags.filter((t) => !names.has(t.name) || t.name === 'Untagged');
  if (names.has(doc.settings.current_layer)) doc.settings.current_layer = to;
  return moved;
}

/** Mapping table: [{ from: glob, to: name }], first match wins; a "$1"-free rename of whole layers. */
export function mapLayers(doc, rules) {
  const out = [];
  for (const t of [...doc.tags]) {
    const r = rules.find((x) => matcher(x.from)(t.name));
    if (!r || r.to === t.name) continue;
    out.push({ from: t.name, to: r.to, moved: mergeLayers(doc, [t.name], r.to) });
  }
  return out;
}

/** Check (and default) metadata values against a feature layer's schema: { field: { type, default, options } }. */
export function checkAttributes(layer, values) {
  const s = layer?.schema;
  if (!s) return values;
  const out = { ...values };
  for (const [k, v] of Object.entries(values)) {
    const f = s[k];
    if (!f || v === null) continue;
    const t = f.type || 'string';
    if (t === 'number' && typeof v !== 'number') throw new Error(`${layer.name}: "${k}" is a number.`);
    if (t === 'boolean' && typeof v !== 'boolean') throw new Error(`${layer.name}: "${k}" is true or false.`);
    if (f.options && !f.options.includes(v)) throw new Error(`${layer.name}: "${k}" is one of ${f.options.join(', ')}.`);
  }
  return out;
}

/** The schema's defaults for an entity landing on a feature layer (existing values kept). */
export function applyDefaults(layer, meta = {}) {
  const s = layer?.schema;
  if (!s) return meta;
  const out = { ...meta };
  for (const [k, f] of Object.entries(s)) if (out[k] === undefined && f.default !== undefined) out[k] = f.default;
  return out;
}

const STATE_KEYS = ['visible', 'color', 'locked'];
export const captureState = (doc) => Object.fromEntries(doc.tags.map((t) => [t.name, Object.fromEntries(STATE_KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]))]));
export function restoreState(doc, state) {
  for (const t of doc.tags) if (state[t.name]) Object.assign(t, state[t.name]);
}
