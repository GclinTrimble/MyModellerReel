// Annotations (#49 guides, #50 dimensions, #51 labels): curve entities whose points are worked out from what they
// measure. A reference point is fixed ([x, y, z] in the world) or attached to an entity ({ id, local }), so a
// dimension or a label follows the geometry: syncAnnotations runs after every change. The text is drawn over the
// view (labels.js) at e.annotation.at.
import { Vector3, Matrix4 } from 'three';
import * as D from './document.js';
import * as G from './geometry.js';
import * as Q from './quantities.js';
import * as S from './survey.js';
import { formatLength, formatArea } from './units.js';

export const GUIDES = 'Guides';
export const DIMS = 'Dimensions';
const LONG = 200; // a guide line runs this far each way

const toLocal = (doc, e, p) => new Vector3(...p).applyMatrix4(new Matrix4().copy(D.worldMatrix(doc, e)).invert()).toArray().map((x) => Math.round(x * 1e6) / 1e6);
const toWorld = (doc, e, p) => new Vector3(...p).applyMatrix4(D.worldMatrix(doc, e)).toArray();

/**
 * A reference from what a command was given: [x, y, z] (world), { id, point: [x, y, z] } (a world point stuck to
 * that entity), { id, vertex: k } or { id, corner: 'min' | 'max' | [sx, sy, sz] } (corner of its own box, s = 0 min,
 * 1 max, 0.5 middle), or an entity id / name alone (its box centre).
 */
export function makeRef(doc, x) {
  if (Array.isArray(x) && x.length === 3 && x.every(Number.isFinite)) return x.map(Number);
  const id = typeof x === 'string' ? x : x?.id;
  const e = id && (D.getEntity(doc, id) || doc.entities.find((y) => y.name === id));
  if (!e) throw new Error(`No entity "${id}" to measure from.`);
  if (x.point) return { id: e.id, local: toLocal(doc, e, x.point) };
  if (Number.isInteger(x.vertex)) {
    if (!e.mesh?.v[x.vertex] && !e.curve?.points[x.vertex]) throw new Error(`${e.name} has no vertex ${x.vertex}.`);
    return { id: e.id, local: (e.mesh?.v || e.curve.points)[x.vertex] };
  }
  // a place in its box (0 min, 1 max): it follows the shape when it is resized too
  return { id: e.id, rel: x.corner === 'min' ? [0, 0, 0] : x.corner === 'max' ? [1, 1, 1] : Array.isArray(x.corner) ? x.corner : [0.5, 0.5, 0.5] };
}

/** An entity's box in its own frame (meshes and curves). */
function localBox(e) {
  if (e.mesh?.v.length) return G.bbox(e.mesh);
  if (e.curve?.points.length) return G.bbox({ v: e.curve.points });
  return { min: [0, 0, 0], max: [0, 0, 0] };
}

/** Where a reference is now; null when its entity has gone. */
export function resolve(doc, r) {
  if (Array.isArray(r)) return r;
  const e = D.getEntity(doc, r.id);
  if (!e) return null;
  if (r.rel) {
    const b = localBox(e);
    return toWorld(doc, e, [0, 1, 2].map((k) => b.min[k] + r.rel[k] * (b.max[k] - b.min[k])));
  }
  return toWorld(doc, e, r.local);
}

const sub = G.sub;
const add = G.add;
const scl = G.scl;
const unit = (a) => {
  const l = G.len(a);
  return l > 1e-12 ? scl(a, 1 / l) : [1, 0, 0];
};
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** A default side to offset a dimension to: square to it, level when it can be. */
function sideOf(dir, normal) {
  if (normal) {
    const n = sub(normal, scl(dir, G.dot(normal, dir)));
    if (G.len(n) > 1e-9) return unit(n);
  }
  const h = G.cross(dir, [0, 1, 0]);
  return G.len(h) > 1e-6 ? unit(h) : [1, 0, 0];
}

/**
 * Polyline points and text of a dimension (all world). kind: linear (along axis x | y | z, or aligned without one)
 * | radial | diameter | angular.
 */
export function dimensionGeometry(doc, a, pts) {
  const fmt = (m) => (a.text_override ? a.text_override.replace('<>', formatLength(m, units(doc))) : formatLength(m, units(doc)));
  if (a.kind === 'radial' || a.kind === 'diameter') {
    const [c, p] = pts;
    const r = G.len(sub(p, c));
    const dir = unit(sub(p, c));
    const start = a.kind === 'diameter' ? sub(c, scl(dir, r)) : c;
    const tick = Math.min(0.2, r * 0.15);
    const side = sideOf(dir, a.normal);
    const back = sub(p, scl(dir, tick));
    const line = [start, p, add(back, scl(side, tick * 0.4)), p, sub(back, scl(side, tick * 0.4))];
    return { points: line, text: `${a.kind === 'diameter' ? 'Ø' : 'R'} ${fmt(a.kind === 'diameter' ? 2 * r : r).trim()}`, at: add(G.scl(add(start, p), 0.5), scl(side, tick)), value: a.kind === 'diameter' ? 2 * r : r };
  }
  if (a.kind === 'angular') {
    const [v, p, q] = pts;
    const u = unit(sub(p, v));
    const w0 = unit(sub(q, v));
    const ang = Math.acos(Math.max(-1, Math.min(1, G.dot(u, w0))));
    const r = (a.offset ?? Math.min(G.len(sub(p, v)), G.len(sub(q, v))) * 0.6) || 0.5;
    // an arc from u to w in their plane
    const n = unit(G.cross(u, w0));
    const perp = unit(G.cross(n, u));
    const steps = Math.max(4, Math.round((ang * 180) / Math.PI / 5));
    const arc = Array.from({ length: steps + 1 }, (_, i) => add(v, add(scl(u, r * Math.cos((ang * i) / steps)), scl(perp, r * Math.sin((ang * i) / steps)))));
    const mid = add(v, add(scl(u, r * 1.15 * Math.cos(ang / 2)), scl(perp, r * 1.15 * Math.sin(ang / 2))));
    const deg = (ang * 180) / Math.PI;
    return { points: [p, v, ...arc, v, q], text: a.text_override ? a.text_override.replace('<>', `${deg.toFixed(1)}°`) : `${deg.toFixed(1)}°`, at: mid, value: deg };
  }
  const [p, q] = pts;
  const dir = AXES[a.axis] ? AXES[a.axis] : unit(sub(q, p));
  const meas = G.dot(sub(q, p), dir);
  const side = sideOf(dir, a.normal);
  const off = a.offset ?? 0.5;
  // the dimension line sits off the further-out of the two points along the side direction
  const base = off >= 0 ? Math.max(G.dot(p, side), G.dot(q, side)) : Math.min(G.dot(p, side), G.dot(q, side));
  const pa = add(p, scl(side, base - G.dot(p, side) + off));
  const qa = add(pa, scl(dir, meas));
  const ext = Math.sign(off || 1) * Math.min(0.15, Math.abs(meas) * 0.05 + 0.02);
  const tick = Math.min(0.12, Math.abs(meas) * 0.06);
  const t = scl(unit(add(dir, side)), tick);
  const line = [p, add(pa, scl(side, ext)), add(pa, t), sub(pa, t), pa, qa, add(qa, t), sub(qa, t), qa, add(qa, scl(side, ext)), q];
  // text_shift (#182): the text slid along the dimension line, m
  return { points: line, text: fmt(Math.abs(meas)), at: add(add(scl(add(pa, qa), 0.5), scl(side, Math.sign(off || 1) * 0.12)), scl(dir, a.text_shift || 0)), value: Math.abs(meas), frame: { dir, side } };
}

const units = (doc) => ({ unit: doc.settings.display_units || 'auto', precision: doc.settings.precision ?? undefined });

/** A label's text from its template: {name} {area} {volume} {length} {height} {elevation} {tag} {meta.key}. */
export function labelText(doc, template, target, at) {
  const e = target && D.getEntity(doc, target);
  return String(template ?? '{name}').replace(/\{([\w.]+)\}/g, (_, k) => {
    if (k === 'elevation') return `${(at[1] + (S.geo(doc).base?.[2] ?? 0)).toFixed(3)}`;
    if (!e) return '';
    if (k === 'name') return e.name;
    if (k === 'tag') return e.tag;
    if (k.startsWith('meta.')) return String(e.meta?.[k.slice(5)] ?? '');
    if (k === 'area' && e.mesh) return formatArea(Q.area(D.worldMesh(doc, e)), units(doc));
    if (k === 'footprint' && e.mesh) {
      const w = D.worldMesh(doc, e);
      let s = 0;
      for (let fi = 0; fi < w.f.length; fi++) if (G.faceNormal(w, fi)[1] > 0.99) s += G.faceArea(w, fi);
      return formatArea(s, units(doc));
    }
    if (k === 'volume' && e.mesh) return `${Math.abs(G.volume(D.worldMesh(doc, e))).toFixed(2)} m³`;
    if (k === 'length' && e.curve) return formatLength(D.curvePoints(doc, e).reduce((s, p, i, a) => s + (i ? G.len(sub(p, a[i - 1])) : 0), 0), units(doc));
    if (k === 'height') {
      const b = D.worldBox(doc, e);
      return formatLength(b.max[1] - b.min[1], units(doc));
    }
    return '';
  });
}

/** Points and text of an annotation now (world). */
export function annotationGeometry(doc, e) {
  const a = e.annotation;
  const pts = a.refs.map((r, i) => resolve(doc, r) || a.last?.[i]);
  if (pts.some((p) => !p)) return null;
  if (a.type === 'guide') {
    if (pts.length === 1 && !a.direction) {
      const s = 0.3;
      const [x, y, z] = pts[0];
      return { points: [[x - s, y, z], [x + s, y, z], [x, y, z], [x, y, z - s], [x, y, z + s], [x, y, z], [x, y - s, z], [x, y + s, z]], text: '', at: pts[0], pts };
    }
    const d = unit(pts[1] ? sub(pts[1], pts[0]) : a.direction);
    return { points: [add(pts[0], scl(d, -LONG)), add(pts[0], scl(d, LONG))], text: '', at: pts[0], pts };
  }
  if (a.type === 'label') {
    // text alone (#183): no leader, the text where it points (moved by offset)
    if (a.leader === false) return { points: [pts[0], pts[0]], text: labelText(doc, a.text, a.refs[0]?.id, pts[0]), at: add(pts[0], a.offset || [0, 0, 0]), pts };
    const off = a.offset || [0.6, 0.9, 0];
    const elbow = add(pts[0], off);
    const end = add(elbow, [Math.sign(off[0] || 1) * 0.3, 0, 0]);
    return { points: [pts[0], elbow, end], text: labelText(doc, a.text, a.refs[0]?.id, pts[0]), at: end, pts };
  }
  return { ...dimensionGeometry(doc, a, pts), pts };
}

/** Bring every annotation up to date with what it measures. */
export function syncAnnotations(doc) {
  for (const e of doc.entities) {
    if (!e.annotation) continue;
    const g = annotationGeometry(doc, e);
    if (!g) continue;
    const { mesh, origin } = G.recenter({ v: g.points.map(D.round3), f: [] });
    e.curve = { kind: 'polyline', points: mesh.v, closed: false };
    e.position = D.round3(origin);
    e.rotation = [0, 0, 0];
    e.scale = [1, 1, 1];
    e.parent = null;
    e.annotation.text_now = g.text;
    e.annotation.at = D.round3(g.at);
    if (g.value !== undefined) e.annotation.value = Math.round(g.value * 1e6) / 1e6;
    if (g.frame) e.annotation.frame = { dir: D.round3(g.frame.dir), side: D.round3(g.frame.side) }; // for dragging it (#182)
    e.annotation.last = g.pts.map(D.round3);
  }
}
