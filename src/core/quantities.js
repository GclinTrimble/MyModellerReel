// Quantities (#53): count, surface area, volume, length and cost of the shapes in a model, grouped by material,
// tag, metadata, name or kind. "How many m³ of concrete?" Pure module, Node-tested.
import * as G from './geometry.js';
import * as D from './document.js';
import * as C from './curves.js';
import { materialName } from './materials.js';

const r3 = (x) => Math.round(x * 1000) / 1000;

/** World surface area of a mesh (sum of its faces). */
export function area(w) {
  let s = 0;
  for (let fi = 0; fi < w.f.length; fi++) s += G.faceArea(w, fi);
  return s;
}

/** Length that matters for linear things: a curve's, or the path of a sweep (or of a live array's source). */
function lengthOf(doc, e) {
  if (e.curve) return C.polyLength(D.curvePoints(doc, e));
  const d = e.derived;
  if (d?.generator === 'sweep') {
    const path = d.inputs[0] ? D.getEntity(doc, d.inputs[0]) : null;
    if (path?.curve) return C.polyLength(D.curvePoints(doc, path));
    if (d.params.path) return C.polyLength(d.params.path);
  }
  return 0;
}

/** The value an entity is grouped under. by: material | tag | name | type | meta.<key> (or a bare metadata key) | none. */
function groupKey(e, by) {
  if (!by || by === 'none') return 'All';
  if (by === 'material') return materialName(e.material.color);
  if (by === 'tag') return e.tag;
  if (by === 'type') return e.curve ? 'curve' : e.derived?.generator || 'shape';
  if (by === 'name') return e.name.replace(/\s*(copy|\d+)+$/i, '').trim() || e.name; // "Column 12" → "Column"
  const k = by.startsWith('meta.') ? by.slice(5) : by;
  const v = e.meta?.[k];
  return v === undefined ? `(no ${k})` : String(v);
}

/**
 * Rows per group: { group, count, area m², volume m³, length m, cost }. Groups are walked into: shapes inside them
 * are counted (with their group's tag/metadata when they have none of their own). Hidden things are skipped unless
 * hidden: true.
 */
export function quantities(doc, { by = 'material', ids = null, hidden = false } = {}) {
  const roots = ids ? D.resolve(doc, ids) : doc.entities.filter((e) => !e.parent);
  const tagOff = new Set(doc.tags.filter((t) => !t.visible).map((t) => t.name));
  const leaves = [];
  const walk = (e, inherited) => {
    if (!hidden && (!e.visible || tagOff.has(e.tag))) return;
    const ctx = { meta: { ...inherited.meta, ...(e.meta || {}) }, tag: e.tag !== 'Untagged' ? e.tag : inherited.tag };
    if (e.mesh || e.curve) leaves.push({ e, ctx });
    for (const c of D.childrenOf(doc, e.id)) walk(c, ctx);
  };
  for (const r of roots) walk(r, { meta: {}, tag: 'Untagged' });
  const rows = new Map();
  for (const { e, ctx } of leaves) {
    const key = groupKey({ ...e, meta: ctx.meta, tag: ctx.tag }, by);
    const row = rows.get(key) || { group: key, count: 0, area: 0, volume: 0, length: 0, cost: 0, ids: [] };
    row.count++;
    row.ids.push(e.id);
    if (e.mesh) {
      const w = D.worldMesh(doc, e);
      row.area += area(w);
      row.volume += Math.max(0, G.volume(w)); // open surfaces have no volume
    }
    row.length += lengthOf(doc, e);
    const cost = Number(ctx.meta.cost);
    if (Number.isFinite(cost)) row.cost += cost;
    rows.set(key, row);
  }
  const out = [...rows.values()].map((r) => ({ ...r, area: r3(r.area), volume: r3(r.volume), length: r3(r.length), cost: r3(r.cost) })).sort((a, b) => b.volume - a.volume || b.area - a.area);
  const totals = out.reduce((t, r) => ({ count: t.count + r.count, area: r3(t.area + r.area), volume: r3(t.volume + r.volume), length: r3(t.length + r.length), cost: r3(t.cost + r.cost) }), { count: 0, area: 0, volume: 0, length: 0, cost: 0 });
  return { by, rows: out, totals };
}

/** CSV (comma separated, quoted where needed) of a quantities report. */
export function toCsv(report) {
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = [report.by === 'none' ? 'group' : report.by, 'count', 'area_m2', 'volume_m3', 'length_m', 'cost'];
  const lines = report.rows.map((r) => [r.group, r.count, r.area, r.volume, r.length, r.cost].map(q).join(','));
  const t = report.totals;
  return [head.join(','), ...lines, ['Total', t.count, t.area, t.volume, t.length, t.cost].map(q).join(',')].join('\n') + '\n';
}
