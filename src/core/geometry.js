// Polygon-mesh kernel. A mesh is { v: [[x,y,z]...], f: [[i,j,k,...]...] }.
// Faces are planar polygons wound counter-clockwise around their outward normal. Y is up, units are metres.
// Pure module: runs in the renderer and in Node tests (only three's ShapeUtils is used, for triangulation).
import { ShapeUtils, Vector2 } from 'three';

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const clone = (m) => ({ v: m.v.map((p) => [...p]), f: m.f.map((f) => [...f]) });

/** Newell's method: robust normal of a (possibly concave) planar polygon. */
export function polygonNormal(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm(n);
}

export const facePoints = (m, fi) => m.f[fi].map((i) => m.v[i]);
export const faceNormal = (m, fi) => polygonNormal(facePoints(m, fi));
export function faceCenter(m, fi) {
  const p = facePoints(m, fi);
  return scl(p.reduce(add, [0, 0, 0]), 1 / p.length);
}
export function faceArea(m, fi) {
  const p = facePoints(m, fi);
  let s = [0, 0, 0];
  for (let i = 0; i < p.length; i++) s = add(s, cross(p[i], p[(i + 1) % p.length]));
  return Math.abs(dot(s, faceNormal(m, fi))) / 2;
}

/** A single flat face from points, flipped if needed so its normal agrees with `want`. */
export function flatFace(points, want = [0, 1, 0]) {
  const pts = points.map((p) => [...p]);
  if (dot(polygonNormal(pts), want) < 0) pts.reverse();
  return { v: pts, f: [pts.map((_, i) => i)] };
}

export const isPlanar = (pts, tol = 1e-4) => {
  const n = polygonNormal(pts);
  return pts.every((p) => Math.abs(dot(sub(p, pts[0]), n)) < tol);
};

export const rectPoints = (w, d) => [
  [-w / 2, 0, -d / 2],
  [w / 2, 0, -d / 2],
  [w / 2, 0, d / 2],
  [-w / 2, 0, d / 2],
];
export const circlePoints = (r, seg = 24) =>
  Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * Math.PI * 2;
    return [r * Math.cos(a), 0, r * Math.sin(a)];
  });

/**
 * Extrude face `fi` by `dist` along its normal. A lone face becomes a closed prism (bottom, top, sides);
 * a face of a solid is replaced by its offset copy plus side walls (a boss, or a pocket when dist < 0).
 */
export function extrude(mesh, fi, dist) {
  const m = clone(mesh);
  const face = m.f[fi];
  const off = scl(faceNormal(m, fi), dist);
  const top = face.map((i) => m.v.push(add(m.v[i], off)) - 1);
  const sides = face.map((a, k) => {
    const k1 = (k + 1) % face.length;
    return [a, face[k1], top[k1], top[k]];
  });
  if (m.f.length === 1) {
    m.f = dist >= 0 ? [[...face].reverse(), top, ...sides] : [face, [...top].reverse(), ...sides.map((s) => s.reverse())];
  } else {
    m.f[fi] = top;
    m.f.push(...sides);
  }
  return m;
}

const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
function faceEdges(face) {
  return face.map((a, k) => edgeKey(a, face[(k + 1) % face.length]));
}

/**
 * Push/pull, the way a designer expects it: when every neighbour of the face is perpendicular to it
 * (boxes, cylinders, any prism) the face just slides; otherwise it extrudes and grows new side walls.
 */
export function pushPull(mesh, fi, dist) {
  if (mesh.f.length > 1) {
    const n = faceNormal(mesh, fi);
    const mine = new Set(faceEdges(mesh.f[fi]));
    const adj = mesh.f.map((f, g) => g).filter((g) => g !== fi && faceEdges(mesh.f[g]).some((e) => mine.has(e)));
    if (adj.length && adj.every((g) => Math.abs(dot(faceNormal(mesh, g), n)) < 1e-6)) {
      const m = clone(mesh);
      for (const i of new Set(m.f[fi])) m.v[i] = add(m.v[i], scl(n, dist));
      return m;
    }
  }
  return extrude(mesh, fi, dist);
}

export function bbox(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.v)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  return { min, max };
}

/** Move the local origin to the bottom-centre of the bounding box. Returns the old-space origin. */
export function recenter(mesh) {
  const { min, max } = bbox(mesh);
  const origin = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  return { mesh: { v: mesh.v.map((p) => sub(p, origin)), f: mesh.f.map((f) => [...f]) }, origin };
}

export const translate = (mesh, d) => ({ v: mesh.v.map((p) => add(p, d)), f: mesh.f.map((f) => [...f]) });

/** Signed volume (divergence theorem). Positive for a closed, outward-wound mesh. */
export function volume(mesh) {
  let s = 0;
  for (const tri of triangles(mesh)) s += dot(tri[0], cross(tri[1], tri[2]));
  return s / 6;
}

/** Make a closed mesh outward-facing (flip every face if it is inside-out). */
export function orient(mesh) {
  if (volume(mesh) < 0) mesh.f = mesh.f.map((f) => [...f].reverse());
  return mesh;
}

/** Fan-free triangulation of every face (concave faces handled by earcut via three's ShapeUtils). */
export function triangulateFace(mesh, fi) {
  const face = mesh.f[fi];
  if (face.length === 3) return [face];
  const n = faceNormal(mesh, fi);
  const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
  const [u, w] = [0, 1, 2].filter((k) => k !== ax);
  const contour = face.map((i) => new Vector2(mesh.v[i][u], mesh.v[i][w]));
  return ShapeUtils.triangulateShape(contour, []).map((t) => {
    const tri = t.map((k) => face[k]);
    const tn = polygonNormal(tri.map((i) => mesh.v[i]));
    return dot(tn, n) < 0 ? tri.reverse() : tri;
  });
}

export function* triangles(mesh) {
  for (let fi = 0; fi < mesh.f.length; fi++) for (const t of triangulateFace(mesh, fi)) yield t.map((i) => mesh.v[i]);
}

/** Flat-shaded buffers + which polygon each triangle came from (for picking faces). */
export function toBuffers(mesh) {
  const pos = [];
  const nor = [];
  const col = mesh.fc ? [] : null; // per-face colours (cut/fill maps)
  const triFace = [];
  // sRGB hex → linear, as the renderer expects vertex colours
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const rgb = (h) => [1, 3, 5].map((k) => lin(parseInt(h.slice(k, k + 2), 16) / 255));
  for (let fi = 0; fi < mesh.f.length; fi++) {
    const n = faceNormal(mesh, fi);
    const c = col && rgb(mesh.fc[fi] || '#ffffff');
    for (const t of triangulateFace(mesh, fi)) {
      for (const i of t) pos.push(...mesh.v[i]), nor.push(...n), col && col.push(...c);
      triFace.push(fi);
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), triFace, ...(col ? { color: new Float32Array(col) } : {}) };
}

/** Build a mesh from raw triangles (imports, booleans). Welds vertices closer than 1e-5. */
export function fromTriangles(position, index = null) {
  const v = [];
  const map = new Map();
  const weld = (i) => {
    const p = [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]];
    const key = p.map((x) => Math.round(x * 1e5)).join(',');
    if (!map.has(key)) map.set(key, v.push(p) - 1);
    return map.get(key);
  };
  const count = index ? index.length : position.length / 3;
  const f = [];
  for (let k = 0; k < count; k += 3) {
    const tri = [0, 1, 2].map((j) => weld(index ? index[k + j] : k + j));
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) f.push(tri);
  }
  return { v, f };
}

// ---------- Primitives (local space: base centred on the origin, sitting on y = 0) ----------

export const box = (w, h, d) => extrude(flatFace(rectPoints(w, d)), 0, h);
export const cylinder = (r, h, seg = 32) => extrude(flatFace(circlePoints(r, seg)), 0, h);
export const prism = (points2d, h) => extrude(flatFace(points2d.map(([x, z]) => [x, 0, z])), 0, h);

export function cone(r, h, seg = 32) {
  const v = [...circlePoints(r, seg), [0, h, 0]];
  const f = [[...Array(seg).keys()].reverse()];
  for (let i = 0; i < seg; i++) f.push([i, seg, (i + 1) % seg]);
  return orient({ v, f });
}

/** Surface of revolution around Y from a profile of [radius, y] pairs (vases, columns, domes). */
export function lathe(profile, seg = 32) {
  const v = [];
  const f = [];
  const rows = profile.length;
  for (const [r, y] of profile)
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      v.push([r * Math.cos(a), y, r * Math.sin(a)]);
    }
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i;
      const b = j * seg + ((i + 1) % seg);
      f.push([a, b, b + seg, a + seg]);
    }
  if (profile[0][0] > 0) f.push([...Array(seg).keys()]); // close the bottom
  if (profile[rows - 1][0] > 0) f.push([...Array(seg).keys()].map((i) => (rows - 1) * seg + i));
  return orient(dropDegenerate({ v, f }));
}

export function sphere(r, seg = 32, rings = 16) {
  const profile = Array.from({ length: rings + 1 }, (_, j) => {
    const a = -Math.PI / 2 + (j / rings) * Math.PI;
    return [Math.max(0, r * Math.cos(a)), r + r * Math.sin(a)];
  });
  return lathe(profile, seg);
}

/** Collapse coincident vertices inside each face (poles of spheres), dropping faces that vanish. */
function dropDegenerate(m) {
  const key = (p) => p.map((x) => Math.round(x * 1e6)).join(',');
  const first = new Map();
  const remap = m.v.map((p, i) => {
    const k = key(p);
    if (!first.has(k)) first.set(k, i);
    return first.get(k);
  });
  m.f = m.f
    .map((face) => face.map((i) => remap[i]).filter((i, k, arr) => i !== arr[(k + 1) % arr.length]))
    .filter((face) => new Set(face).size >= 3);
  return m;
}

/**
 * Edges the eye cannot find by angle: where a drawn (imprinted) face meets the coplanar face around it. Returns
 * [[a, b], …] point pairs for the outlines of polygon faces (4+ sides) whose neighbour across the edge is coplanar.
 * Seams between triangles (imports, booleans) stay hidden.
 */
export function imprintEdges(mesh) {
  const owner = new Map();
  mesh.f.forEach((f, fi) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length];
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    (owner.get(key) || owner.set(key, []).get(key)).push(fi);
  }));
  const out = [];
  for (const [key, fs] of owner) {
    if (fs.length !== 2 || fs[0] === fs[1]) continue;
    if (mesh.f[fs[0]].length < 4 && mesh.f[fs[1]].length < 4) continue;
    if (dot(faceNormal(mesh, fs[0]), faceNormal(mesh, fs[1])) < 1 - 1e-6) continue; // a crease: drawn anyway
    const [a, b] = key.split('_').map(Number);
    out.push([mesh.v[a], mesh.v[b]]);
  }
  return out;
}
