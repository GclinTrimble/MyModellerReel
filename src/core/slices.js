// Slices (#292): slab clips (clip.js kind 'slab') placed at an elevation, along a line, across or along an alignment
// at a station, or through a face; the slab's 2D frame; the points of a scan inside it and their statistics; series.
// Pure: the commands are in commands.js, the tests in tests/slices.test.js.
import * as G from './geometry.js';
import * as Assets from './assets.js';
import * as CV from './clip.js';
import * as RD from './roads.js';

const r3 = (x) => Math.round(x * 1e3) / 1e3 || 0;
const r4 = (x) => Math.round(x * 1e4) / 1e4 || 0;
const UP = [0, 1, 0];

/** Is the slab level (a plan cut)? */
export const isHorizontal = (c) => Math.abs(CV.normalize(c).normal[1]) > 0.999;

/**
 * The slab's 2D frame: o its middle, n towards the viewer, u to the right, v up. A level slab looks down with east
 * right and north (−z) up; an upright one keeps world up.
 */
export function frame(c0) {
  const c = CV.normalize(c0);
  const n = c.normal;
  const u = Math.abs(n[1]) > 0.999 ? [1, 0, 0] : G.norm(G.cross(UP, n));
  return { o: c.point, n, u, v: G.cross(n, u) };
}
/** A world point in the slab's frame: [u, v]. */
export const to2d = (f, p) => {
  const d = G.sub(p, f.o);
  return [G.dot(d, f.u), G.dot(d, f.v)];
};
/** A frame point [u, v] back in the world, on the slab's middle plane. */
export const to3d = (f, [a, b]) => G.add(f.o, G.add(G.scl(f.u, a), G.scl(f.v, b)));

// ---------------------------------------------------------------- presets: { point, normal } of a slab

/** A level slab at height y (model), centred over at = [x, z]. */
export const level = (y, at = [0, 0]) => ({ point: [r4(at[0]), r4(y), r4(at[1])], normal: [0, 1, 0] });

/** An upright slab containing the line p0 → p1 (seen from its left in plan, so the line runs left to right). */
export function alongLine(p0, p1) {
  const d = G.sub(p1, p0);
  if (Math.hypot(d[0], d[2]) < 1e-9) throw new Error('The two points are on one vertical: they give no direction.');
  return { point: G.scl(G.add(p0, p1), 0.5).map(r4), normal: G.norm([-d[2], 0, d[0]]).map(r4) };
}

/**
 * A slab at station s of a path of [x, y, z, station] points: across it (square to the road, seen looking ahead so
 * right of the road is right in the view) or along it (containing the tangent, seen from the right).
 */
export function atStation(path, s, { along = false } = {}) {
  const end = path.at(-1)[3];
  if (!(s >= path[0][3] - 1e-6 && s <= end + 1e-6)) throw new Error(`The alignment runs from station ${r3(path[0][3])} to ${r3(end)}; got ${s}.`);
  const { p, t } = RD.at(path, s);
  const normal = along ? [-t[1], 0, t[0]] : [-t[0], 0, -t[1]];
  return { point: p.map(r4), normal: normal.map(r4) };
}

/** A slab parallel to a face (its centroid and outward normal), moved offset along the normal. */
export const throughFace = (centroid, normal, offset = 0) => {
  const n = G.norm(normal);
  return { point: G.add(centroid, G.scl(n, offset)).map(r4), normal: n.map(r4) };
};

/** The values of a series from → to every step (to included when it falls on a step). */
export function seriesValues(from, to, step) {
  if (!(step > 0)) throw new Error('step must be more than 0.');
  if (!(to >= from)) throw new Error('to must be at or after from.');
  const n = Math.floor((to - from) / step + 1e-9) + 1;
  if (n > 200) throw new Error(`That makes ${n} slices: 200 at most (a bigger step).`);
  return Array.from({ length: n }, (_, i) => r4(from + i * step));
}

/** A series' next slice: the index after (by +1) or before (by −1) i, clamped to the ends. */
export const stepIndex = (i, by, n) => Math.max(0, Math.min(n - 1, i + by));

// ---------------------------------------------------------------- the points inside a slab

/** A point cloud entity's preview positions (the thinned cloud kept in the document): local [x, y, z, …]. */
export const previewPositions = (e) => new Float32Array(Assets.bytes(e.pointcloud.asset).slice().buffer, 0, e.pointcloud.count * 3);

/**
 * The points of a cloud entity inside a clip, in world space: { count (all of them), points (Float32Array, every
 * k-th one when there are more than max) }. matrix: the entity's world matrix (16 numbers, column-major).
 */
export function pointsInClip(entity, clip, { max = Infinity, matrix = null, positions = null } = {}) {
  // shortcut: reads the thinned preview cloud. Octree clouds (#293, #294) add their branch here: visit only the nodes
  // whose bounds hit the clip and read them at full depth inside it.
  const p = positions || previewPositions(entity);
  const c = clip && CV.normalize(clip);
  const t = c ? CV.tester(c) : () => true; // no clip: every point
  const keep = c?.kind === 'box' && c.keep === 'outside' ? (x, y, z) => !t(x, y, z) : t;
  const m = matrix;
  const at = (i, out, k) => {
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    if (!m) return (out[k] = x), (out[k + 1] = y), (out[k + 2] = z);
    out[k] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  };
  const n = p.length / 3;
  const hit = new Uint32Array(n);
  const w = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i++) {
    at(i, w, 0);
    if (keep(w[0], w[1], w[2])) hit[count++] = i;
  }
  const k = Math.min(count, Math.max(0, Math.floor(max)));
  const step = k ? count / k : 1;
  const points = new Float32Array(k * 3);
  for (let j = 0; j < k; j++) at(hit[Math.floor(j * step)], points, j * 3);
  return { count, points };
}

/** Join several pointsInClip results into one. */
export function merge(parts) {
  const out = new Float32Array(parts.reduce((s, x) => s + x.points.length, 0));
  let o = 0;
  for (const x of parts) out.set(x.points, o), (o += x.points.length);
  return { count: parts.reduce((s, x) => s + x.count, 0), points: out };
}

/**
 * What a slice holds: the count, the bounds of its points in the slab's frame (u right, v up; m from the slab's
 * middle), its size, density (points per m² of that rectangle) and, for a level slab, a histogram of the heights
 * across its thickness (bins from its bottom face). count: the whole count when points is a sample.
 */
export function stats(c0, points, { count = points.length / 3, bins = 10 } = {}) {
  const c = CV.normalize(c0);
  const f = frame(c);
  const n = points.length / 3;
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  const w = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    w[0] = points[i * 3];
    w[1] = points[i * 3 + 1];
    w[2] = points[i * 3 + 2];
    const [a, b] = to2d(f, w);
    if (a < min[0]) min[0] = a;
    if (b < min[1]) min[1] = b;
    if (a > max[0]) max[0] = a;
    if (b > max[1]) max[1] = b;
  }
  if (!n) return { count, bounds: null, width: 0, height: 0, center: [0, 0], area: 0, density: 0 };
  const width = max[0] - min[0];
  const height = max[1] - min[1];
  const area = width * height;
  const out = { count, bounds: { min: min.map(r3), max: max.map(r3) }, width: r3(width), height: r3(height), center: [r3((min[0] + max[0]) / 2), r3((min[1] + max[1]) / 2)], area: r3(area), density: area > 0 ? r3(count / area) : 0 };
  if (n < count) out.sampled = n;
  if (isHorizontal(c)) {
    const step = c.thickness / bins;
    const from = c.point[1] - c.thickness / 2;
    const counts = new Array(bins).fill(0);
    for (let i = 0; i < n; i++) counts[Math.max(0, Math.min(bins - 1, Math.floor((points[i * 3 + 1] - from) / step)))]++;
    const k = count / n; // a sample stands for the whole count
    out.histogram = { from: r4(from), step: r4(step), counts: k === 1 ? counts : counts.map((x) => Math.round(x * k)) };
  }
  return out;
}

/** The slab's points in its frame as [[u, v], …] (m, rounded to mm). */
export function project2d(c0, points) {
  const f = frame(c0);
  const out = [];
  for (let i = 0; i < points.length; i += 3) out.push(to2d(f, [points[i], points[i + 1], points[i + 2]]).map(r3));
  return out;
}

/** The points flattened onto the slab's middle plane (world, Float32Array), to keep as a point set. */
export function flatten(c0, points) {
  const f = frame(c0);
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const d = (points[i] - f.o[0]) * f.n[0] + (points[i + 1] - f.o[1]) * f.n[1] + (points[i + 2] - f.o[2]) * f.n[2];
    for (let k = 0; k < 3; k++) out[i + k] = points[i + k] - d * f.n[k];
  }
  return out;
}

/**
 * The ground height (model y) around at = [x, z]: the median of the lowest point in each cell (m) within radius of
 * it in plan (all of them when none are that close), so walls, trees and the odd ditch do not move it.
 */
export function groundLevel(points, { at = null, radius = 15, cell = 2 } = {}) {
  const low = new Map();
  const r2 = radius * radius;
  for (let i = 0; i < points.length; i += 3) {
    if (at && (points[i] - at[0]) ** 2 + (points[i + 2] - at[1]) ** 2 > r2) continue;
    const k = `${Math.floor(points[i] / cell)},${Math.floor(points[i + 2] / cell)}`;
    if (!(low.get(k) <= points[i + 1])) low.set(k, points[i + 1]);
  }
  if (!low.size) {
    if (!at) throw new Error('No points to find the ground from.');
    return groundLevel(points, { cell });
  }
  const ys = [...low.values()].sort((a, b) => a - b);
  return ys[Math.floor(ys.length / 2)];
}

/** A camera { position, target } moved from one slab's frame to another's, keeping where it stands relative to it. */
export function carry(from, to, cam) {
  const [a, b] = [frame(from), frame(to)];
  const map = (p) => {
    const d = G.sub(p, a.o);
    return [b.u, b.v, b.n].reduce((s, ax, k) => G.add(s, G.scl(ax, G.dot(d, [a.u, a.v, a.n][k]))), b.o).map(r3);
  };
  return { position: map(cam.position), target: map(cam.target) };
}

/**
 * A parallel camera square to the slab, fitted to its points (stats from stats()), looking along −n with the frame's
 * v up: { position, target }. aspect: the pane's width / height.
 */
export function viewCamera(c0, st, { fov = 45, aspect = 1.5, margin = 1.3 } = {}) {
  const c = CV.normalize(c0);
  const f = frame(c);
  const target = st?.bounds ? to3d(f, st.center) : f.o;
  const h = Math.max(st?.height || 0, (st?.width || 0) / aspect, 1) * margin;
  const dist = Math.max(h / (2 * Math.tan((fov * Math.PI) / 360)), c.thickness);
  let position = G.add(target, G.scl(f.n, dist));
  if (isHorizontal(c)) position = G.add(position, G.scl(f.v, -dist * 1e-4)); // a hair off vertical: north stays up
  return { position: position.map(r3), target: target.map(r3) };
}
