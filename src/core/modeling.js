// Modelling power tools (#17–#24, #26, #29): loft, shell, thicken, extrude faces, divide edge, Catmull-Clark
// subdivision, deformers, decimation, fillet / chamfer cutters (applied with the boolean kernel), mesh intersections
// and 3-point rectangles. Meshes are { v, f } polygon meshes with faces CCW around their outward normal.
import { Vector2, ShapeUtils } from 'three';
import * as G from './geometry.js';

const { sub, add, scl, dot, cross, len, norm } = G;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const ekey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Edges: key "a,b" (a < b) → { a, b, faces: [face indices], dirs: [[from, to] as in each face] }. */
export function edgesOf(mesh) {
  const m = new Map();
  mesh.f.forEach((f, fi) =>
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      const key = ekey(a, b);
      if (!m.has(key)) m.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [], dirs: [] });
      m.get(key).faces.push(fi);
      m.get(key).dirs.push([a, b]);
    }),
  );
  return m;
}

/** A mesh of triangles only. */
export function triangulated(mesh) {
  const f = [];
  for (let fi = 0; fi < mesh.f.length; fi++) f.push(...G.triangulateFace(mesh, fi));
  return { v: mesh.v.map((p) => [...p]), f };
}

// ---------------------------------------------------------------- loft (#18)

/** A closed (or open) polyline resampled to n points evenly by length. */
export function resample(pts, n, closed = true) {
  const P = closed ? [...pts, pts[0]] : pts;
  const seg = P.slice(1).map((p, i) => len(sub(p, P[i])));
  const total = seg.reduce((s, x) => s + x, 0);
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (total * k) / (closed ? n : n - 1);
    let i = 0;
    while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
    out.push(add(P[i], scl(sub(P[i + 1], P[i]), seg[i] ? d / seg[i] : 0)));
  }
  return out;
}

/**
 * A loft through profiles in order: each a closed ring (or an open line with closed: false), resampled to the same
 * number of points and turned so neighbours line up. caps close the ends of closed rings. Returns a mesh.
 */
export function loft(profiles, { closed = true, caps = true, points = 0 } = {}) {
  if (profiles.length < 2) throw new Error('A loft needs at least two profiles.');
  const n = points || Math.max(...profiles.map((p) => p.length), 12);
  const rings = profiles.map((p) => resample(p, n, closed));
  // ring winding: all the same way as the first, and each started where it is nearest the previous one's start
  const area = (r) => {
    const nrm = G.polygonNormal(r);
    return nrm;
  };
  const n0 = area(rings[0]);
  for (let i = 1; i < rings.length; i++) {
    if (closed && dot(area(rings[i]), n0) < 0) rings[i].reverse();
    if (!closed) continue;
    let best = 0;
    let bd = Infinity;
    for (let s = 0; s < n; s++) {
      let d = 0;
      for (let k = 0; k < n; k++) d += len(sub(rings[i][(k + s) % n], rings[i - 1][k]));
      if (d < bd) (bd = d), (best = s);
    }
    rings[i] = rings[i].map((_, k) => rings[i][(k + best) % n]);
  }
  const v = rings.flat().map((p) => p.map(r6));
  const f = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % n;
      f.push([i * n + k, i * n + j, (i + 1) * n + j, (i + 1) * n + k]);
    }
  if (closed && caps) {
    f.push([...Array(n).keys()].reverse());
    f.push([...Array(n).keys()].map((k) => (rings.length - 1) * n + k));
  }
  const mesh = { v, f };
  return G.volume(mesh) < 0 ? { v, f: f.map((x) => [...x].reverse()) } : mesh;
}

// ---------------------------------------------------------------- offsets: shell (#19), thicken (#24)

/** Per vertex, the move that puts it d along every adjacent face's normal (exact for up to three faces). */
export function vertexOffsets(mesh, d, faces = null) {
  const normals = mesh.v.map(() => []);
  mesh.f.forEach((f, fi) => {
    if (faces && !faces.has(fi)) return;
    const n = G.faceNormal(mesh, fi);
    if (!Number.isFinite(n[0])) return;
    for (const i of f) if (!normals[i].some((m) => dot(m, n) > 0.9999)) normals[i].push(n);
  });
  return normals.map((ns) => {
    if (!ns.length) return [0, 0, 0];
    if (ns.length === 1) return scl(ns[0], d);
    // least squares: (Σ n nᵀ + εI) x = d Σ n
    const M = [[1e-9, 0, 0], [0, 1e-9, 0], [0, 0, 1e-9]];
    const b = [0, 0, 0];
    for (const n of ns) for (let r = 0; r < 3; r++) (b[r] += d * n[r]), M[r].forEach((_, c) => (M[r][c] += n[r] * n[c]));
    return solve3(M, b);
  });
}
function solve3(M, b) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  return [0, 1, 2].map((c) => det(M.map((row, r) => row.map((x, k) => (k === c ? b[r] : x)))) / D);
}

/** Boundary edges of a face set as they run in their faces: [[a, b], …]. */
function boundary(mesh, faceSet) {
  const count = new Map();
  for (const fi of faceSet) {
    const f = mesh.f[fi];
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      const key = ekey(a, b);
      count.set(key, count.has(key) ? null : [a, b]);
    });
  }
  return [...count.values()].filter(Boolean);
}

/** Hollow a closed solid to wall thickness t; openFaces are removed (an open box, a tank without a lid). */
export function shell(mesh, t, openFaces = []) {
  if (!(t > 0)) throw new Error('thickness must be above 0.');
  const open = new Set(openFaces);
  const keep = mesh.f.map((_, i) => i).filter((i) => !open.has(i));
  const off = vertexOffsets(mesh, t, new Set(keep)); // an open face does not push its rim down
  const n = mesh.v.length;
  const v = [...mesh.v.map((p) => [...p]), ...mesh.v.map((p, i) => sub(p, off[i]).map(r6))];
  const f = [...keep.map((i) => [...mesh.f[i]]), ...keep.map((i) => mesh.f[i].map((x) => x + n).reverse())];
  // the rim where faces were removed: the removed faces' edges, as they ran in them
  for (const fi of open) {
    const face = mesh.f[fi];
    face.forEach((a, k) => {
      const b = face[(k + 1) % face.length];
      if (open.has(otherFace(mesh, fi, a, b))) return; // between two removed faces: no rim
      f.push([a, b, b + n, a + n]);
    });
  }
  return compact({ v, f });
}
function otherFace(mesh, fi, a, b) {
  return mesh.f.findIndex((f, i) => i !== fi && f.some((x, k) => (x === b && f[(k + 1) % f.length] === a) || (x === a && f[(k + 1) % f.length] === b)));
}

/** Give a sheet (open faces) a thickness: outwards along the normals, or half each way with both. */
export function thicken(mesh, t, { both = false } = {}) {
  if (!(t > 0)) throw new Error('thickness must be above 0.');
  const out = vertexOffsets(mesh, both ? t / 2 : t);
  const n = mesh.v.length;
  const top = mesh.v.map((p, i) => add(p, out[i]).map(r6));
  const bot = both ? mesh.v.map((p, i) => sub(p, out[i]).map(r6)) : mesh.v.map((p) => [...p]);
  const v = [...bot, ...top];
  const f = [...mesh.f.map((face) => face.map((i) => i + n)), ...mesh.f.map((face) => [...face].reverse())];
  for (const [a, b] of boundary(mesh, mesh.f.keys())) f.push([a, b, b + n, a + n]);
  return { v, f };
}

/** Extrude faces along their normals: as one region (shared walls, default) or each on its own. */
export function extrudeFaces(mesh, faces, d, { individual = false } = {}) {
  const groups = individual ? faces.map((fi) => [fi]) : [faces];
  let v = mesh.v.map((p) => [...p]);
  const f = mesh.f.map((x) => [...x]);
  for (const g of groups) {
    const set = new Set(g);
    const off = vertexOffsets({ v, f }, d, set);
    const map = new Map();
    const copy = (i) => {
      if (!map.has(i)) map.set(i, v.push(add(v[i], off[i]).map(r6)) - 1);
      return map.get(i);
    };
    const edges = boundary({ v, f }, set);
    for (const fi of g) f[fi] = f[fi].map(copy);
    for (const [a, b] of edges) f.push([a, b, map.get(b), map.get(a)]);
  }
  return { v, f };
}

/** Split an edge into segments: the new points go into both faces along it. */
export function divideEdge(mesh, a, b, segments = 2) {
  if (!(segments >= 2)) throw new Error('segments must be 2 or more.');
  const v = mesh.v.map((p) => [...p]);
  const ids = [];
  for (let k = 1; k < segments; k++) ids.push(v.push(add(v[a], scl(sub(v[b], v[a]), k / segments)).map(r6)) - 1);
  let hit = 0;
  const f = mesh.f.map((face) => {
    const out = [];
    face.forEach((x, k) => {
      out.push(x);
      const y = face[(k + 1) % face.length];
      if (x === a && y === b) out.push(...ids), hit++;
      else if (x === b && y === a) out.push(...[...ids].reverse()), hit++;
    });
    return out;
  });
  if (!hit) throw new Error(`No edge between vertices ${a} and ${b}.`);
  return { v, f };
}

/** Drop vertices no face uses (and renumber). */
export function compact(mesh) {
  const used = [...new Set(mesh.f.flat())].sort((x, y) => x - y);
  const map = new Map(used.map((i, k) => [i, k]));
  return { v: used.map((i) => mesh.v[i]), f: mesh.f.map((face) => face.map((i) => map.get(i))) };
}

// ---------------------------------------------------------------- subdivision (#22)

/** Catmull-Clark subdivision, levels 1–3 (boundaries kept as creases that smooth along themselves). */
export function catmullClark(mesh, levels = 1) {
  let m = mesh;
  for (let l = 0; l < Math.min(3, Math.max(1, levels)); l++) m = ccOnce(m);
  return m;
}
function ccOnce({ v, f }) {
  const fp = f.map((face) => scl(face.reduce((s, i) => add(s, v[i]), [0, 0, 0]), 1 / face.length));
  const E = new Map();
  f.forEach((face, fi) =>
    face.forEach((a, k) => {
      const b = face[(k + 1) % face.length];
      const key = ekey(a, b);
      if (!E.has(key)) E.set(key, { a, b, faces: [] });
      E.get(key).faces.push(fi);
    }),
  );
  const out = v.map((p) => [...p]);
  const eIndex = new Map();
  for (const [key, e] of E) {
    const mid = scl(add(v[e.a], v[e.b]), 0.5);
    const p = e.faces.length === 2 ? scl(add(add(v[e.a], v[e.b]), add(fp[e.faces[0]], fp[e.faces[1]])), 0.25) : mid;
    eIndex.set(key, out.push(p) - 1);
  }
  const fIndex = fp.map((p) => out.push(p) - 1);
  // move the original vertices
  const vf = v.map(() => []);
  const ve = v.map(() => []);
  f.forEach((face, fi) => face.forEach((i) => vf[i].push(fi)));
  for (const e of E.values()) ve[e.a].push(e), ve[e.b].push(e);
  v.forEach((P, i) => {
    const bd = ve[i].filter((e) => e.faces.length === 1);
    if (bd.length >= 2) {
      const [o1, o2] = bd.slice(0, 2).map((e) => v[e.a === i ? e.b : e.a]);
      out[i] = scl(add(scl(P, 6), add(o1, o2)), 1 / 8);
      return;
    }
    const n = vf[i].length;
    if (!n) return;
    const F = scl(vf[i].reduce((s, fi) => add(s, fp[fi]), [0, 0, 0]), 1 / n);
    const R = scl(ve[i].reduce((s, e) => add(s, scl(add(v[e.a], v[e.b]), 0.5)), [0, 0, 0]), 1 / ve[i].length);
    out[i] = scl(add(add(F, scl(R, 2)), scl(P, n - 3)), 1 / n);
  });
  const nf = [];
  f.forEach((face, fi) => {
    const L = face.length;
    for (let k = 0; k < L; k++) {
      const prev = face[(k - 1 + L) % L];
      const cur = face[k];
      const next = face[(k + 1) % L];
      nf.push([cur, eIndex.get(ekey(cur, next)), fIndex[fi], eIndex.get(ekey(prev, cur))]);
    }
  });
  return { v: out.map((p) => p.map(r6)), f: nf };
}

// ---------------------------------------------------------------- deformers (#23)

/** Triangles split evenly until every edge is shorter than maxEdge (so a deformer has points to move). */
export function refine(mesh, maxEdge, maxTriangles = 60000) {
  let m = triangulated(mesh);
  for (let it = 0; it < 8; it++) {
    let longest = 0; // a loop, not Math.max(...): big meshes overflow the stack with a spread
    for (const t of m.f) for (let k = 0; k < 3; k++) longest = Math.max(longest, len(sub(m.v[t[k]], m.v[t[(k + 1) % 3]])));
    if (longest <= maxEdge || m.f.length * 4 > maxTriangles) break;
    const v = m.v.map((p) => [...p]);
    const mid = new Map();
    const at = (a, b) => {
      const k = ekey(a, b);
      if (!mid.has(k)) mid.set(k, v.push(scl(add(v[a], v[b]), 0.5)) - 1);
      return mid.get(k);
    };
    const f = [];
    for (const [a, b, c] of m.f) {
      const [ab, bc, ca] = [at(a, b), at(b, c), at(c, a)];
      f.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    m = { v, f };
  }
  return m;
}

/**
 * Bend, twist, taper or lattice a mesh along an axis (x | y | z) over its own extent. taper: amount = how much the
 * far end shrinks (0.5 = half size); twist and bend: degrees from one end to the other; lattice: corners =
 * 8 offsets [dx, dy, dz] for the box corners (x fastest, then y, then z).
 */
export function deform(mesh, { type, amount = 0, axis = 'y', corners = null }) {
  const b = G.bbox(mesh);
  const A = { x: 0, y: 1, z: 2 }[axis] ?? 1;
  const [P, Q] = [(A + 1) % 3, (A + 2) % 3];
  const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
  const L = b.max[A] - b.min[A] || 1;
  const t = (p) => (p[A] - b.min[A]) / L;
  const v = mesh.v.map((p) => {
    const q = [...p];
    const u = t(p);
    if (type === 'taper') {
      const s = 1 - amount * u;
      q[P] = c[P] + (p[P] - c[P]) * s;
      q[Q] = c[Q] + (p[Q] - c[Q]) * s;
    } else if (type === 'twist') {
      const a = (amount * u * Math.PI) / 180;
      const [x, y] = [p[P] - c[P], p[Q] - c[Q]];
      q[P] = c[P] + x * Math.cos(a) - y * Math.sin(a);
      q[Q] = c[Q] + x * Math.sin(a) + y * Math.cos(a);
    } else if (type === 'bend') {
      const theta = (amount * Math.PI) / 180;
      if (Math.abs(theta) < 1e-9) return q;
      const R = L / theta; // the axis becomes an arc of radius R in the A–P plane
      const a = u * theta;
      const r = R - (p[P] - c[P]);
      q[P] = c[P] + R - r * Math.cos(a);
      q[A] = b.min[A] + r * Math.sin(a);
    } else if (type === 'lattice') {
      if (!corners || corners.length !== 8) throw new Error('lattice needs 8 corner offsets.');
      const w = [0, 1, 2].map((k) => (b.max[k] - b.min[k] ? (p[k] - b.min[k]) / (b.max[k] - b.min[k]) : 0));
      for (let i = 0; i < 8; i++) {
        const wt = (i & 1 ? w[0] : 1 - w[0]) * (i & 2 ? w[1] : 1 - w[1]) * (i & 4 ? w[2] : 1 - w[2]);
        for (let k = 0; k < 3; k++) q[k] += corners[i][k] * wt;
      }
    } else throw new Error('type must be taper, twist, bend or lattice.');
    return q.map(r6);
  });
  return { v, f: mesh.f.map((x) => [...x]) };
}

// ---------------------------------------------------------------- decimation (#26)

/** Fewer triangles: vertices snapped to a grid sized to reach about ratio of the triangles, then merged. */
export function simplify(mesh, ratio) {
  if (!(ratio > 0 && ratio < 1)) throw new Error('ratio is between 0 and 1 (0.5: half the triangles).');
  const tri = triangulated(mesh);
  const target = Math.max(4, Math.round(tri.f.length * ratio));
  const b = G.bbox(tri);
  const size = Math.max(...b.max.map((x, k) => x - b.min[k])) || 1;
  const cluster = (cell) => {
    const id = new Map();
    const sum = [];
    const map = tri.v.map((p) => {
      const k = p.map((x, j) => Math.floor((x - b.min[j]) / cell)).join(',');
      if (!id.has(k)) id.set(k, sum.push([0, 0, 0, 0]) - 1);
      const s = sum[id.get(k)];
      s[0] += p[0], s[1] += p[1], s[2] += p[2], s[3]++;
      return id.get(k);
    });
    const seen = new Set();
    const f = [];
    for (const t of tri.f) {
      const q = t.map((i) => map[i]);
      if (q[0] === q[1] || q[1] === q[2] || q[0] === q[2]) continue;
      const k = [...q].sort((x, y) => x - y).join(',');
      if (seen.has(k)) continue;
      seen.add(k);
      f.push(q);
    }
    return { v: sum.map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]].map(r6)), f };
  };
  // the cell size that lands nearest the target
  let lo = size / 2000;
  let hi = size / 2;
  let best = cluster(lo);
  for (let i = 0; i < 24; i++) {
    const mid = Math.sqrt(lo * hi);
    const m = cluster(mid);
    if (m.f.length > target) (lo = mid), (best = m);
    else hi = mid;
  }
  return compact(best);
}

// ---------------------------------------------------------------- fillet and chamfer (#17)

/** Edges by name: all (sharp convex ones), vertical, horizontal, top, bottom; or [[a, b], …] as given. */
export function pickEdges(mesh, which = 'all', { angle = 20 } = {}) {
  if (Array.isArray(which)) return which;
  const b = G.bbox(mesh);
  const out = [];
  for (const e of edgesOf(mesh).values()) {
    if (e.faces.length !== 2) continue;
    const [n1, n2] = e.faces.map((fi) => G.faceNormal(mesh, fi));
    if (Math.acos(Math.max(-1, Math.min(1, dot(n1, n2)))) < (angle * Math.PI) / 180) continue;
    if (!convex(mesh, e)) continue;
    const d = norm(sub(mesh.v[e.b], mesh.v[e.a]));
    const y = (mesh.v[e.a][1] + mesh.v[e.b][1]) / 2;
    const vertical = Math.abs(d[1]) > 0.99;
    const ok = which === 'all' || (which === 'vertical' && vertical) || (which === 'horizontal' && Math.abs(d[1]) < 0.01) || (which === 'top' && !vertical && Math.abs(y - b.max[1]) < 1e-6) || (which === 'bottom' && !vertical && Math.abs(y - b.min[1]) < 1e-6);
    if (ok) out.push([e.a, e.b]);
  }
  return out;
}
/** Is an edge convex (the solid's inside is on the side the normals point away from)? */
function convex(mesh, e) {
  const [f1, f2] = e.faces;
  const n1 = G.faceNormal(mesh, f1);
  const c2 = G.faceCenter(mesh, f2);
  return dot(sub(c2, mesh.v[e.a]), n1) < -1e-9;
}

/**
 * The piece to cut away to round (fillet) or bevel (chamfer) a convex edge a–b of radius / distance r: a prism
 * along the edge (a little longer at both ends) whose section is the corner minus the round. null if the edge is
 * not a sharp convex edge between two faces.
 */
export function edgeCutter(mesh, [a, b], { radius, mode = 'fillet', segments = 8, extend = 0.001 }) {
  const e = edgesOf(mesh).get(ekey(a, b));
  if (!e || e.faces.length !== 2 || !convex(mesh, e)) return null;
  const [n1, n2] = e.faces.map((fi) => G.faceNormal(mesh, fi));
  const dir = norm(sub(mesh.v[e.b], mesh.v[e.a]));
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(n1, n2)))); // turn between the faces
  if (phi < 1e-3 || phi > Math.PI - 1e-3) return null;
  // in-face directions away from the edge (into each face)
  const in1 = norm(cross(n1, dir));
  const in2 = norm(cross(dir, n2));
  const s1 = dot(in1, sub(G.faceCenter(mesh, e.faces[0]), mesh.v[e.a])) < 0 ? scl(in1, -1) : in1;
  const s2 = dot(in2, sub(G.faceCenter(mesh, e.faces[1]), mesh.v[e.a])) < 0 ? scl(in2, -1) : in2;
  const t = mode === 'fillet' ? radius / Math.tan((Math.PI - phi) / 2) : radius; // from the edge to the tangent points
  const sec = (p) => {
    const T1 = add(p, scl(s1, t));
    const T2 = add(p, scl(s2, t));
    if (mode !== 'fillet') return [p, T2, T1];
    const c = sub(add(T1, scl(n1, -radius)), [0, 0, 0]);
    const pts = [p, T2];
    for (let k = 1; k < segments; k++) {
      // around the centre from T2's direction to T1's (the outside of the round)
      const u = k / segments;
      const d = norm(add(scl(n2, 1 - u), scl(n1, u)));
      pts.push(add(c, scl(d, radius)));
    }
    pts.push(T1);
    return pts;
  };
  const pa = sub(mesh.v[e.a], scl(dir, extend + t));
  const pb = add(mesh.v[e.b], scl(dir, extend + t));
  // push the corner point a hair outside so the cut is clean
  const out = norm(add(n1, n2));
  const A = sec(add(pa, scl(out, 1e-4)));
  const B = sec(add(pb, scl(out, 1e-4)));
  const n = A.length;
  const v = [...A, ...B].map((p) => p.map(r6));
  const f = [[...Array(n).keys()], [...Array(n).keys()].map((k) => n + k).reverse()];
  for (let k = 0; k < n; k++) f.push([k, (k + 1) % n, n + ((k + 1) % n), n + k].reverse());
  const m = { v, f };
  return G.volume(m) < 0 ? { v, f: f.map((x) => [...x].reverse()) } : m;
}

// ---------------------------------------------------------------- intersections (#21)

/** Where two meshes cross: polylines (world points) along the crossing, from triangle pairs whose boxes overlap. */
export function meshIntersections(m1, m2) {
  const t1 = [...G.triangles(m1)];
  const t2 = [...G.triangles(m2)];
  const box = (t) => ({ min: [0, 1, 2].map((k) => Math.min(t[0][k], t[1][k], t[2][k])), max: [0, 1, 2].map((k) => Math.max(t[0][k], t[1][k], t[2][k])) });
  const b2 = t2.map(box);
  const segs = [];
  for (const a of t1) {
    const ba = box(a);
    t2.forEach((b, j) => {
      const bb = b2[j];
      if ([0, 1, 2].some((k) => ba.max[k] < bb.min[k] - 1e-9 || bb.max[k] < ba.min[k] - 1e-9)) return;
      const s = triTri(a, b);
      if (s) segs.push(s);
    });
  }
  return chain(segs);
}
function planeCut(tri, n, d) {
  const s = tri.map((p) => dot(n, p) - d);
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (Math.abs(s[i]) < 1e-12) pts.push(tri[i]);
    else if ((s[i] > 0) !== (s[j] > 0) && Math.abs(s[j]) > 1e-12) pts.push(add(tri[i], scl(sub(tri[j], tri[i]), s[i] / (s[i] - s[j]))));
  }
  return pts.length >= 2 ? pts.slice(0, 2) : null;
}
function triTri(a, b) {
  const na = norm(cross(sub(a[1], a[0]), sub(a[2], a[0])));
  const nb = norm(cross(sub(b[1], b[0]), sub(b[2], b[0])));
  if (len(cross(na, nb)) < 1e-9) return null; // parallel or coplanar
  const sa = planeCut(a, nb, dot(nb, b[0]));
  const sb = planeCut(b, na, dot(na, a[0]));
  if (!sa || !sb) return null;
  const L = norm(cross(na, nb));
  const ta = sa.map((p) => dot(p, L)).sort((x, y) => x - y);
  const tb = sb.map((p) => dot(p, L)).sort((x, y) => x - y);
  const lo = Math.max(ta[0], tb[0]);
  const hi = Math.min(ta[1], tb[1]);
  if (hi - lo < 1e-9) return null;
  const base = sa[0];
  const t0 = dot(base, L);
  const dirA = norm(sub(sa[1], sa[0]));
  const k = dot(dirA, L) || 1;
  return [add(base, scl(dirA, (lo - t0) / k)), add(base, scl(dirA, (hi - t0) / k))];
}
function chain(segs) {
  const key = (p) => p.map((x) => Math.round(x * 1e4)).join(',');
  const by = new Map();
  segs.forEach((s, i) => s.forEach((p, k) => (by.get(key(p)) || by.set(key(p), []).get(key(p))).push([i, k])));
  const used = new Set();
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const line = [segs[i][0], segs[i][1]];
    for (const dirn of [1, 0]) {
      for (let guard = 0; guard < segs.length; guard++) {
        const end = dirn ? line.at(-1) : line[0];
        const next = (by.get(key(end)) || []).find(([j]) => !used.has(j));
        if (!next) break;
        used.add(next[0]);
        const p = segs[next[0]][1 - next[1]];
        dirn ? line.push(p) : line.unshift(p);
      }
    }
    lines.push(line.map((p) => p.map(r6)));
  }
  return lines;
}

// ---------------------------------------------------------------- 3-point rectangle (#29)

/** A rectangle from a corner, a point along its first side and a point that sets its width: 4 corners. */
export function rectangle3(p1, p2, p3) {
  const u = sub(p2, p1);
  const lu = len(u);
  if (lu < 1e-9) throw new Error('The first two points are the same.');
  const ud = scl(u, 1 / lu);
  const w = sub(p3, p1);
  const vperp = sub(w, scl(ud, dot(w, ud)));
  if (len(vperp) < 1e-9) throw new Error('The third point is on the first side: no width.');
  return [p1, p2, add(p2, vperp), add(p1, vperp)].map((p) => p.map(r6));
}

/** Points and headings along a path for an array: count copies evenly by length (closed: no copy on the start twice). */
export function pathPlacements(pts, count, { closed = false } = {}) {
  const P = closed ? [...pts, pts[0]] : pts;
  const seg = P.slice(1).map((p, i) => len(sub(p, P[i])));
  const total = seg.reduce((s, x) => s + x, 0);
  const out = [];
  for (let k = 0; k < count; k++) {
    let d = (total * k) / (closed ? count : Math.max(1, count - 1));
    let i = 0;
    while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
    const dir = sub(P[i + 1], P[i]);
    out.push({ position: add(P[i], scl(dir, seg[i] ? d / seg[i] : 0)).map(r6), heading: r6((Math.atan2(dir[0], dir[2]) * 180) / Math.PI) });
  }
  return out;
}

void Vector2;
void ShapeUtils;
