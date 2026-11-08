// Drawing on a face splits it (#179): a new flat loop and the flat faces it overlaps on the same plane become one
// arrangement — the overlap, what is left of each face and what lies outside them — as faces of one shape. Pure maths,
// Node-tested; constrained Delaunay in the plane's 2D frame, regions read back as loops.
import * as G from './geometry.js';
import * as TR from './terrain.js';
import { insidePolygon } from './topology.js';

const EPS = 1e-7;

/** A 2D frame on the plane through o with normal n: to(p) → [u, v], from([u, v]) → p. */
export function planeFrame(n, o) {
  const N = G.norm(n);
  const a = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = G.norm(G.cross(a, N));
  const v = G.cross(N, u);
  return { to: (p) => { const d = G.sub(p, o); return [G.dot(d, u), G.dot(d, v)]; }, from: ([x, y]) => G.add(o, G.add(G.scl(u, x), G.scl(v, y))) };
}

function cross2d(p, q, r) {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}
/** Where segments pq and rs cross (parameters t on pq, s on rs), or null. */
function hit(p, q, r, s) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < EPS) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t > -EPS && t < 1 + EPS && u > -EPS && u < 1 + EPS ? [t, u] : null;
}
const area2d = (loop) => loop.reduce((s, p, i) => s + cross2d([0, 0], p, loop[(i + 1) % loop.length]), 0) / 2;

/** Do two 2D polygons overlap with some area (not just touch)? */
export function overlaps(a, b) {
  const c = (poly) => poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
  if (a.some((p) => insidePolygon(p, b)) || b.some((p) => insidePolygon(p, a)) || insidePolygon(c(a), b) || insidePolygon(c(b), a)) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const h = hit(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]);
      if (h && h[0] > EPS && h[0] < 1 - EPS && h[1] > EPS && h[1] < 1 - EPS) return true;
    }
  return false;
}

/**
 * The arrangement of flat faces (loops3, on one plane) and a new loop cut3 on it. Returns { faces: [[p3, …], …],
 * kinds: ['face 0 ∩ new', …] } — every region (the overlap, what is left of each face, the new loop outside them) as a
 * loop wound counter-clockwise around n; a region with a hole comes back as its triangles.
 */
export function splitFaces(loops3, cut3, n) {
  const fr = planeFrame(n, cut3[0]);
  const polys = loops3.map((l) => l.map(fr.to));
  const cut = cut3.map(fr.to);
  const all = [...polys, cut];
  const pts = [];
  const index = new Map();
  const id = (p) => {
    const k = `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
    if (!index.has(k)) index.set(k, pts.push(p) - 1);
    return index.get(k);
  };
  // every edge, split where it meets another one
  const segs = all.flatMap((poly) => poly.map((p, i) => ({ p, q: poly[(i + 1) % poly.length], ts: [0, 1] })));
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const h = hit(segs[i].p, segs[i].q, segs[j].p, segs[j].q);
      if (h) segs[i].ts.push(h[0]), segs[j].ts.push(h[1]);
    }
  const constraints = [];
  for (const s of segs) {
    const ts = [...new Set(s.ts.map((t) => Math.round(Math.min(1, Math.max(0, t)) * 1e9) / 1e9))].sort((a, b) => a - b);
    const ids = ts.map((t) => id([s.p[0] + (s.q[0] - s.p[0]) * t, s.p[1] + (s.q[1] - s.p[1]) * t]));
    for (let k = 1; k < ids.length; k++) if (ids[k] !== ids[k - 1]) constraints.push([ids[k - 1], ids[k]]);
  }
  const { faces } = TR.triangulate(pts.map(([x, y]) => [x, 0, y]), { constraints });
  // label each triangle: which old face holds it, and whether the new loop does
  const groups = new Map();
  for (const t of faces) {
    const tri = cross2d(...t.map((k) => pts[k])) < 0 ? [t[0], t[2], t[1]] : t; // counter-clockwise in the frame
    const c = tri.reduce((s, k) => [s[0] + pts[k][0] / 3, s[1] + pts[k][1] / 3], [0, 0]);
    const fi = polys.findIndex((poly) => insidePolygon(c, poly));
    const inNew = insidePolygon(c, cut);
    if (fi < 0 && !inNew) continue;
    const key = `${fi}:${inNew ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tri);
  }
  const out = { faces: [], kinds: [] };
  const lift = (loop) => {
    const p3 = loop.map((k) => fr.from(pts[k]));
    return G.dot(G.polygonNormal(p3), n) < 0 ? p3.reverse() : p3;
  };
  for (const [key, tris] of groups) {
    // connected pieces of the region, then their outlines
    const edgeTri = new Map();
    tris.forEach((t, i) => t.forEach((a, k) => edgeTri.set(`${a},${t[(k + 1) % 3]}`, i)));
    const seen = new Set();
    for (let s = 0; s < tris.length; s++) {
      if (seen.has(s)) continue;
      const comp = [];
      const stack = [s];
      seen.add(s);
      while (stack.length) {
        const i = stack.pop();
        comp.push(tris[i]);
        tris[i].forEach((a, k) => {
          const j = edgeTri.get(`${tris[i][(k + 1) % 3]},${a}`);
          if (j !== undefined && !seen.has(j)) seen.add(j), stack.push(j);
        });
      }
      const directed = new Map();
      for (const t of comp) t.forEach((a, k) => directed.set(`${a},${t[(k + 1) % 3]}`, [a, t[(k + 1) % 3]]));
      const next = new Map();
      for (const [, [a, b]] of directed) if (!directed.has(`${b},${a}`)) next.set(a, b);
      const loops = [];
      const used = new Set();
      for (const start of next.keys()) {
        if (used.has(start)) continue;
        const loop = [];
        let k = start;
        while (k !== undefined && !used.has(k)) used.add(k), loop.push(k), (k = next.get(k));
        if (loop.length >= 3) loops.push(loop);
      }
      const kind = (() => {
        const [fi, inNew] = key.split(':').map(Number);
        return fi < 0 ? 'new' : inNew ? `face ${fi} ∩ new` : `face ${fi}`;
      })();
      if (loops.length === 1 && Math.abs(area2d(loops[0].map((k) => pts[k]))) > EPS) {
        out.faces.push(lift(loops[0])); // corners where edges were split stay: the neighbour shares them, so no cracks
        out.kinds.push(kind);
      } else
        for (const t of comp) {
          out.faces.push(lift(t));
          out.kinds.push(kind);
        }
    }
  }
  return out;

  // drop points in the middle of straight runs (where an edge was split but nothing branches off inside this region)
  function simplify(loop) {
    const keep = loop.filter((k, i) => {
      const a = pts[loop[(i - 1 + loop.length) % loop.length]];
      const b = pts[loop[(i + 1) % loop.length]];
      return Math.abs(cross2d(a, pts[k], b)) > 1e-9;
    });
    return keep.length >= 3 ? keep : loop;
  }
}

/** One mesh from 3D loops: shared corners welded. */
export function meshOfLoops(loops) {
  const v = [];
  const index = new Map();
  const id = (p) => {
    const k = p.map((x) => Math.round(x * 1e5)).join(',');
    if (!index.has(k)) index.set(k, v.push(p.map((x) => Math.round(x * 1e6) / 1e6)) - 1);
    return index.get(k);
  };
  return { v, f: loops.map((l) => l.map(id)) };
}
