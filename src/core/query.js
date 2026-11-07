// Scene queries and relational placement: what agents ask instead of reading raw JSON ("what is under this
// point?", "where is there room for a 2 x 1 m table?", "put the lamp on the table").
import * as G from './geometry.js';
import * as D from './document.js';

const AX = { x: 0, y: 1, z: 2 };
export const centerOf = (b) => b.min.map((x, k) => (x + b.max[k]) / 2);
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** Union bounds of entities, with size and centre. */
export function boundsOf(doc, ents) {
  const b = D.unionBox(ents.map((e) => D.worldBox(doc, e)));
  return { min: D.round3(b.min), max: D.round3(b.max), size: D.round3(b.max.map((x, k) => x - b.min[k])), center: D.round3(centerOf(b)) };
}

// ---------------------------------------------------------------- selection by properties

const globToRe = (p) => (p.startsWith('/') && p.lastIndexOf('/') > 0 ? new RegExp(p.slice(1, p.lastIndexOf('/')), p.slice(p.lastIndexOf('/') + 1) || 'i') : new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'));
const sizeOf = (doc, e) => {
  const b = D.worldBox(doc, e);
  return b.max.map((x, k) => x - b.min[k]);
};

/**
 * Entities matching every given filter. name: glob ("Window*") or /regex/; color: hex; tag; type (mesh | group | curve);
 * min_size / max_size: largest dimension in metres; metadata: { key: value | "*" }; similar_to: an entity (same kind,
 * same face count and size within 10 %). Searches top-level entities unless inside is a group id or include_children.
 */
export function matchEntities(doc, f = {}) {
  const ref = f.similar_to ? D.resolve(doc, f.similar_to)[0] : null;
  const refSize = ref && sizeOf(doc, ref);
  const nameRe = f.name ? globToRe(f.name) : null;
  const pool = f.inside ? D.descendants(doc, D.resolve(doc, f.inside)[0].id) : f.include_children ? doc.entities : doc.entities.filter((e) => !e.parent);
  return pool.filter((e) => {
    if (nameRe && !nameRe.test(e.name)) return false;
    if (f.type && e.type !== f.type) return false;
    if (f.tag && e.tag.toLowerCase() !== f.tag.toLowerCase()) return false;
    if (f.color) {
      const mats = [e, ...D.descendants(doc, e.id)].filter((x) => x.mesh).map((x) => x.material.color.toLowerCase());
      if (!mats.includes(f.color.toLowerCase())) return false;
    }
    if (f.min_size !== undefined || f.max_size !== undefined) {
      const big = Math.max(...sizeOf(doc, e));
      if (f.min_size !== undefined && big < f.min_size) return false;
      if (f.max_size !== undefined && big > f.max_size) return false;
    }
    if (f.metadata)
      for (const [k, v] of Object.entries(f.metadata)) {
        const have = e.meta?.[k];
        if (have === undefined || (v !== '*' && String(have).toLowerCase() !== String(v).toLowerCase())) return false;
      }
    if (ref) {
      if (e.id === ref.id || e.type !== ref.type) return false;
      if (e.mesh && e.mesh.f.length !== ref.mesh.f.length) return false;
      const s = sizeOf(doc, e);
      const sorted = (a) => [...a].sort((x, y) => x - y);
      const [a, b] = [sorted(s), sorted(refSize)];
      if (a.some((x, k) => Math.abs(x - b[k]) > 0.1 * Math.max(b[k], 0.01))) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- raycast

function rayBox(o, d, b) {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return false;
      continue;
    }
    let a = (b.min[k] - o[k]) / d[k];
    let c = (b.max[k] - o[k]) / d[k];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

/** Möller–Trumbore. Returns t or null. */
function rayTri(o, d, a, b, c) {
  const e1 = G.sub(b, a);
  const e2 = G.sub(c, a);
  const p = G.cross(d, e2);
  const det = G.dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const s = G.sub(o, a);
  const u = G.dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = G.cross(s, e1);
  const v = G.dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = G.dot(e2, q) * inv;
  return t > 1e-9 ? t : null;
}

const visible = (doc, e) => {
  const tagOff = new Set(doc.tags.filter((t) => !t.visible).map((t) => t.name));
  for (let x = e; x; x = x.parent && D.getEntity(doc, x.parent)) if (!x.visible || tagOff.has(x.tag)) return false;
  return true;
};

/** Hits of a ray against visible shapes, nearest first: { id, name, point, normal, distance, face }. */
export function raycast(doc, origin, direction, { ids = null, all = false, maxDistance = Infinity } = {}) {
  const d = G.norm(direction);
  const pool = (ids ? D.resolve(doc, ids).flatMap((e) => [e, ...D.descendants(doc, e.id)]) : doc.entities).filter((e) => e.mesh && visible(doc, e));
  const hits = [];
  for (const e of pool) {
    if (!rayBox(origin, d, D.worldBox(doc, e))) continue;
    const w = D.worldMesh(doc, e);
    let best = null;
    for (let fi = 0; fi < w.f.length; fi++)
      for (const tri of G.triangulateFace(w, fi)) {
        const t = rayTri(origin, d, ...tri.map((i) => w.v[i]));
        if (t !== null && t <= maxDistance && (!best || t < best.t)) best = { t, fi };
      }
    if (best) {
      let n = G.faceNormal(w, best.fi);
      if (G.dot(n, d) > 0 && w.f.length === 1) n = G.scl(n, -1); // the visible side of a lone face
      hits.push({ id: e.id, name: e.name, distance: r4(best.t), point: D.round3(G.add(origin, G.scl(d, best.t))), normal: D.round3(n), face: best.fi });
    }
  }
  hits.sort((a, b) => a.distance - b.distance);
  return all ? hits : hits.slice(0, 1);
}

// ---------------------------------------------------------------- free space

/** Footprints (x/z boxes) of top-level visible things, for free-space search. */
const footprints = (doc, skip) =>
  doc.entities.filter((e) => !e.parent && visible(doc, e) && !skip.has(e.id)).map((e) => D.worldBox(doc, e)).filter((b) => b.max[0] > b.min[0] || b.max[2] > b.min[2]);

/**
 * Nearest spot to `near` ([x, z]) where a w × d footprint touches nothing (with clearance). Spiral search on a grid.
 * Returns the base-centre position [x, 0, z] or null.
 */
export function findFreeSpace(doc, [w, d], { near = [0, 0], clearance = 0.1, maxRadius = 100, skip = [] } = {}) {
  const boxes = footprints(doc, new Set(skip));
  const step = Math.max(0.05, Math.min(w, d) / 2);
  const free = (x, z) =>
    boxes.every((b) => x + w / 2 + clearance <= b.min[0] || x - w / 2 - clearance >= b.max[0] || z + d / 2 + clearance <= b.min[2] || z - d / 2 - clearance >= b.max[2]);
  if (free(near[0], near[1])) return [r4(near[0]), 0, r4(near[1])];
  for (let ring = 1; ring * step <= maxRadius; ring++) {
    let best = null;
    for (let i = -ring; i <= ring; i++)
      for (const [dx, dz] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const x = near[0] + dx * step;
        const z = near[1] + dz * step;
        const dist = Math.hypot(x - near[0], z - near[1]);
        if (free(x, z) && (!best || dist < best.dist)) best = { x, z, dist };
      }
    if (best) return [r4(best.x), 0, r4(best.z)];
  }
  return null;
}

// ---------------------------------------------------------------- arrange (each returns world offsets to apply)

/** Offsets that align boxes on an axis: to min | center | max of a reference box (default: their union). */
export function alignOffsets(boxes, axis, to = 'center', ref = null) {
  const k = AX[axis];
  const R = ref || D.unionBox(boxes);
  const target = to === 'min' ? R.min[k] : to === 'max' ? R.max[k] : (R.min[k] + R.max[k]) / 2;
  return boxes.map((b) => {
    const cur = to === 'min' ? b.min[k] : to === 'max' ? b.max[k] : (b.min[k] + b.max[k]) / 2;
    const off = [0, 0, 0];
    off[k] = r4(target - cur);
    return off;
  });
}

/**
 * Offsets that space boxes evenly along an axis, in the order of their centres. Without gap the first and last stay
 * and the gaps between neighbours become equal; with gap every neighbour ends up exactly gap apart from the first.
 */
export function distributeOffsets(boxes, axis, gap = null) {
  const k = AX[axis];
  const order = boxes.map((b, i) => i).sort((i, j) => boxes[i].min[k] + boxes[i].max[k] - (boxes[j].min[k] + boxes[j].max[k]));
  const sizes = order.map((i) => boxes[i].max[k] - boxes[i].min[k]);
  const first = boxes[order[0]];
  const last = boxes[order.at(-1)];
  const g = gap ?? (order.length > 1 ? (last.max[k] - first.min[k] - sizes.reduce((a, b) => a + b, 0)) / (order.length - 1) : 0);
  const out = boxes.map(() => [0, 0, 0]);
  let at = first.min[k];
  order.forEach((i, n) => {
    out[i][k] = r4(at - boxes[i].min[k]);
    at += sizes[n] + g;
  });
  return out;
}

const SIDES = { top: [0, 1, 0], bottom: [0, -1, 0], right: [1, 0, 0], left: [-1, 0, 0], front: [0, 0, 1], back: [0, 0, -1] };

/** Plane of a target to place against: a box side by word, or a mesh face by index. { point, normal } in world. */
export function targetFace(doc, target, face = 'top') {
  if (typeof face === 'string' && /^\d+$/.test(face)) face = +face;
  if (typeof face === 'number') {
    if (!target.mesh?.f[face]) throw new Error(`${target.name} has no face ${face}.`);
    const w = D.worldMesh(doc, target);
    return { point: G.faceCenter(w, face), normal: G.faceNormal(w, face) };
  }
  const n = SIDES[face];
  if (!n) throw new Error(`face must be a face index or one of ${Object.keys(SIDES).join(', ')}.`);
  const b = D.worldBox(doc, target);
  const c = centerOf(b);
  const k = n.findIndex((x) => x !== 0);
  c[k] = n[k] > 0 ? b.max[k] : b.min[k];
  return { point: c, normal: n };
}

/**
 * Offset that brings a box onto a plane: its extreme point against the normal touches the plane (plus gap), and its
 * centre lands on the plane point (or `at`). keep lists world axes that must not move (against keeps the height).
 */
export function placeOffset(box, { point, normal }, { gap = 0, at = null, keep = [] } = {}) {
  const n = G.norm(normal);
  const c = centerOf(box);
  const corners = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z]);
  const support = Math.min(...corners.map((p) => G.dot(p, n))); // the box's face that will touch
  const anchor = at || point;
  // move in-plane so the centre is over the anchor, then along the normal so the support face meets the plane
  const inPlane = G.sub(anchor, c);
  const tangential = G.sub(inPlane, G.scl(n, G.dot(inPlane, n)));
  const along = G.dot(point, n) + gap - support;
  const off = G.add(tangential, G.scl(n, along));
  for (const a of keep) off[AX[a]] = 0;
  return D.round3(off);
}
