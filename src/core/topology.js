// Topology power tools on the polygon-mesh kernel: imprint (sticky geometry), offset, mesh repair and moving
// vertices. Pure module, Node-tested. Meshes are { v: [[x,y,z]…], f: [[i,j,k…]…] }, faces planar and CCW outward.
import { ShapeUtils, Vector2 } from 'three';
import * as G from './geometry.js';

const EPS = 1e-6;

/** A 2D frame on a plane: project(p) → [u, v], and back. */
export function planeFrame(normal, origin) {
  const n = G.norm(normal);
  const u = Math.abs(n[1]) > 0.9 ? G.norm(G.cross([0, 0, 1], n)) : G.norm(G.cross([0, 1, 0], n));
  const w = G.cross(n, u);
  return {
    n,
    to: (p) => {
      const d = G.sub(p, origin);
      return [G.dot(d, u), G.dot(d, w)];
    },
    from: ([a, b]) => G.add(origin, G.add(G.scl(u, a), G.scl(w, b))),
  };
}

const area2 = (pts) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;

/** Strictly inside a 2D polygon (ray casting). */
export function insidePolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < -EPS && o(c, d, a) * o(c, d, b) < -EPS;
}

/**
 * Imprint a closed loop drawn on face fi: the face becomes the loop's own face plus a ring of faces around it, so
 * push/pull can raise or sink just the loop. Returns { mesh, face } (the new inner face's index).
 */
export function imprint(mesh, fi, loop) {
  const face = mesh.f[fi];
  if (!face) throw new Error(`Face ${fi} does not exist.`);
  const n = G.faceNormal(mesh, fi);
  const outer3 = face.map((i) => mesh.v[i]);
  const fr = planeFrame(n, outer3[0]);
  const plane = G.dot(n, outer3[0]);
  if (loop.length < 3) throw new Error('A loop needs at least 3 points.');
  if (loop.some((p) => Math.abs(G.dot(n, p) - plane) > 1e-3)) throw new Error('The loop is not on that face.');
  const inner = loop.map(fr.to);
  const ring = (f) => f.map((i) => fr.to(mesh.v[i]));
  const crosses = (a, b) => a.some((p, i) => b.some((q, j) => segmentsCross(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
  const holds = (outline) => inner.every((p) => insidePolygon(p, outline)) && !crosses(inner, outline);
  const coplanar = mesh.f.map((_, g) => g).filter((g) => G.dot(G.faceNormal(mesh, g), n) > 1 - 1e-6 && Math.abs(G.dot(n, mesh.v[mesh.f[g][0]]) - plane) < 1e-6);
  // 1. one face of that plane holds the whole loop: cut it there
  const holder = [fi, ...coplanar].find((g) => holds(ring(mesh.f[g])));
  // 2. otherwise the triangles left on that plane by earlier imprints are cut again as one region
  const region = holder === undefined ? coplanar.filter((g) => mesh.f[g].length === 3) : [holder];
  let outerIdx;
  let holes = [];
  if (holder !== undefined) outerIdx = mesh.f[holder];
  else {
    const directed = new Map();
    for (const g of region) mesh.f[g].forEach((a, k) => directed.set(ek(a, mesh.f[g][(k + 1) % 3]), [a, mesh.f[g][(k + 1) % 3]]));
    const inside = [...directed].filter(([, [a, b]]) => directed.has(ek(b, a))).map(([k]) => k);
    for (const k of inside) directed.delete(k);
    const loops = loopsFrom(directed).sort((p, q) => Math.abs(area2(ring(q))) - Math.abs(area2(ring(p))));
    if (!loops.length || !holds(ring(loops[0]))) throw new Error('The loop must lie inside the face.');
    [outerIdx, ...holes] = loops;
    if (holes.some((h) => crosses(inner, ring(h)) || ring(h).every((p) => insidePolygon(p, inner)) || inner.some((p) => insidePolygon(p, ring(h)))))
      throw new Error('The loop overlaps an earlier imprint on that face.');
  }
  const m = G.clone(mesh);
  const base = m.v.length;
  m.v.push(...inner.map((p) => fr.from(p)));
  const holeIdx = inner.map((_, k) => base + k);
  const all = [...outerIdx, ...holes.flat(), ...holeIdx];
  const v2 = (pts) => pts.map(([x, y]) => new Vector2(x, y));
  const tris = ShapeUtils.triangulateShape(v2(ring(outerIdx)), [...holes.map((h) => v2(ring(h))), v2(inner)]).map((t) => {
    const tri = t.map((k) => all[k]);
    return G.dot(G.polygonNormal(tri.map((i) => m.v[i])), n) < 0 ? tri.reverse() : tri;
  });
  // the inner face, wound like the face it was drawn on
  const innerFace = G.dot(G.polygonNormal(holeIdx.map((i) => m.v[i])), n) > 0 ? holeIdx : [...holeIdx].reverse();
  const gone = new Set(region);
  m.f = [...m.f.filter((_, g) => !gone.has(g)), ...tris, innerFace];
  return { mesh: m, face: m.f.length - 1 };
}

/** A 2D polygon offset by d (positive = inwards), with mitred corners. */
export function offsetPolygon(pts, d) {
  const ccw = area2(pts) > 0;
  const k = ccw ? 1 : -1; // inward normal of edge (a→b) is the left side for a CCW polygon
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const t = [b[0] - a[0], b[1] - a[1]];
    const L = Math.hypot(...t) || 1;
    const nIn = [(-t[1] / L) * k, (t[0] / L) * k];
    return { p: [a[0] + nIn[0] * d, a[1] + nIn[1] * d], t: [t[0] / L, t[1] / L] };
  });
  return pts.map((_, i) => {
    const A = lines[(i - 1 + pts.length) % pts.length];
    const B = lines[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-9) return B.p; // straight through
    const s = ((B.p[0] - A.p[0]) * B.t[1] - (B.p[1] - A.p[1]) * B.t[0]) / den;
    return [A.p[0] + A.t[0] * s, A.p[1] + A.t[1] * s];
  });
}

/** The outline of face fi offset by d in its own plane (positive = inset), as 3D points. */
export function offsetFaceLoop(mesh, fi, d) {
  const pts = G.facePoints(mesh, fi);
  const fr = planeFrame(G.faceNormal(mesh, fi), pts[0]);
  const out = offsetPolygon(pts.map(fr.to), d);
  if (d > 0 && area2(out) * area2(pts.map(fr.to)) <= 0) throw new Error(`An inset of ${d} m is wider than the face.`);
  return out.map(fr.from);
}

// ---------------------------------------------------------------- repair

const key = (p, tol) => p.map((x) => Math.round(x / tol)).join(',');
const ek = (a, b) => `${a}_${b}`;

function loopsFrom(directed) {
  // directed: Map "a_b" → [a, b]; chain them into closed loops
  const next = new Map();
  for (const [a, b] of directed.values()) next.set(a, b);
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let x = start;
    while (x !== undefined && !seen.has(x)) {
      seen.add(x);
      loop.push(x);
      x = next.get(x);
    }
    if (x === start && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Clean a mesh: weld vertices closer than tol, drop degenerate and duplicate faces, make the winding consistent and
 * outward, merge coplanar neighbours into single polygons (so push/pull moves a whole imported face), close holes.
 * Returns { mesh, report }.
 */
export function repairMesh(mesh, { tol = 1e-5, merge = true, closeHoles = true } = {}) {
  const report = { welded: 0, removed: 0, flipped: 0, merged: 0, holes: 0 };
  // 1. weld
  const v = [];
  const map = new Map();
  const remap = mesh.v.map((p) => {
    const k = key(p, tol);
    if (!map.has(k)) map.set(k, v.push([...p]) - 1);
    else report.welded++;
    return map.get(k);
  });
  // 2. degenerate and duplicate faces
  const seenFaces = new Set();
  let f = [];
  for (const face of mesh.f) {
    const g = face.map((i) => remap[i]).filter((i, k, a) => i !== a[(k + 1) % a.length]);
    const sig = [...g].sort((a, b) => a - b).join(',');
    if (new Set(g).size < 3 || seenFaces.has(sig) || G.len(G.cross(G.sub(v[g[1]], v[g[0]]), G.sub(v[g[2]], v[g[0]]))) < 1e-12 && g.length === 3) {
      report.removed++;
      continue;
    }
    seenFaces.add(sig);
    f.push(g);
  }
  // 3. consistent winding: neighbours walk a shared edge in opposite directions
  const owner = new Map(); // undirected edge → faces
  f.forEach((face, fi) => face.forEach((a, k) => {
    const b = face[(k + 1) % face.length];
    const u = a < b ? ek(a, b) : ek(b, a);
    if (!owner.has(u)) owner.set(u, []);
    owner.get(u).push(fi);
  }));
  const done = new Array(f.length).fill(false);
  const has = (face, a, b) => face.some((x, k) => x === a && face[(k + 1) % face.length] === b);
  for (let s = 0; s < f.length; s++) {
    if (done[s]) continue;
    done[s] = true;
    const queue = [s];
    while (queue.length) {
      const fi = queue.pop();
      const face = f[fi];
      face.forEach((a, k) => {
        const b = face[(k + 1) % face.length];
        for (const g of owner.get(a < b ? ek(a, b) : ek(b, a))) {
          if (done[g]) continue;
          if (has(f[g], a, b)) (f[g] = [...f[g]].reverse()), report.flipped++;
          done[g] = true;
          queue.push(g);
        }
      });
    }
  }
  // 4. merge coplanar neighbours
  if (merge) {
    const plane = f.map((face) => {
      const n = G.polygonNormal(face.map((i) => v[i]));
      return { n, d: G.dot(n, v[face[0]]) };
    });
    const parent = f.map((_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const faces of owner.values())
      for (let i = 0; i < faces.length; i++)
        for (let j = i + 1; j < faces.length; j++) {
          const [a, b] = [faces[i], faces[j]];
          if (G.dot(plane[a].n, plane[b].n) > 1 - 1e-6 && Math.abs(plane[a].d - plane[b].d) < tol * 10) parent[find(a)] = find(b);
        }
    const groups = new Map();
    f.forEach((_, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    });
    const out = [];
    for (const members of groups.values()) {
      if (members.length === 1) {
        out.push(f[members[0]]);
        continue;
      }
      const directed = new Map();
      for (const fi of members) f[fi].forEach((a, k) => directed.set(ek(a, f[fi][(k + 1) % f[fi].length]), [a, f[fi][(k + 1) % f[fi].length]]));
      const inner = [...directed].filter(([, [a, b]]) => directed.has(ek(b, a))).map(([k2]) => k2);
      for (const k2 of inner) directed.delete(k2);
      const loops = loopsFrom(directed);
      const boundaryEdges = directed.size;
      if (loops.length === 1 && loops[0].length === boundaryEdges) {
        out.push(loops[0]);
        report.merged += members.length - 1;
      } else for (const fi of members) out.push(f[fi]); // a face with holes stays in pieces
    }
    f = out;
  }
  // 5. close holes: boundary edges of the whole mesh, chained into loops, become faces
  if (closeHoles) {
    const directed = new Map();
    for (const face of f) face.forEach((a, k) => directed.set(ek(a, face[(k + 1) % face.length]), [a, face[(k + 1) % face.length]]));
    const open = new Map();
    for (const [k2, [a, b]] of directed) if (!directed.has(ek(b, a))) open.set(ek(b, a), [b, a]); // reversed: the cap runs the other way
    for (const loop of loopsFrom(open)) {
      const pts = loop.map((i) => v[i]);
      if (G.isPlanar(pts, 1e-4)) f.push(loop);
      else {
        // fan from the first point: good enough for small holes left by imports
        for (let k = 1; k < loop.length - 1; k++) f.push([loop[0], loop[k], loop[k + 1]]);
      }
      report.holes++;
    }
  }
  let m = { v, f };
  // drop unused vertices
  const used = [...new Set(f.flat())].sort((a, b) => a - b);
  const idx = new Map(used.map((o, n) => [o, n]));
  m = { v: used.map((i) => v[i]), f: f.map((face) => face.map((i) => idx.get(i))) };
  if (G.volume(m) < 0) (m.f = m.f.map((face) => [...face].reverse())), (report.flipped += m.f.length);
  return { mesh: m, report };
}

/** Move some vertices; faces that stop being flat are split into triangles. */
export function moveVertices(mesh, ids, delta) {
  const m = G.clone(mesh);
  for (const i of new Set(ids)) m.v[i] = G.add(m.v[i], delta);
  const f = [];
  for (let fi = 0; fi < m.f.length; fi++) {
    const face = m.f[fi];
    if (face.length === 3 || G.isPlanar(face.map((i) => m.v[i]), 1e-6)) f.push(face);
    else for (let k = 1; k < face.length - 1; k++) f.push([face[0], face[k], face[k + 1]]);
  }
  m.f = f;
  return m;
}
