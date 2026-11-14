// Features in a scan (#300): voxel neighbourhoods and PCA normals, planes (region growing on voxels, refined on the
// points), merging and regularising them, corners where walls meet, plane–plane edges, wall tops, and step edges
// (kerb top and bottom) across an alignment. Pure, and imports only drafting.js, so it runs in a module worker too.
// Points: [x, y, z, …] (Float32Array or Float64Array) in model space: x east, y up, z south. Metres.
//
// shortcut: voxelGrid, neighbours and covarianceFeatures are a minimal stand-in for the shared neighbourhood code of
// classify.js (#298); same names and shapes, swap the import once it is on main.
import * as DR from './drafting.js';

const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scl(a, 1 / (len(a) || 1));
const r3 = (x) => Math.round(x * 1e3) / 1e3 || 0;
const r5 = (x) => Math.round(x * 1e5) / 1e5 || 0;

// ---------------------------------------------------------------- 3 × 3 symmetric eigen (Jacobi)

/** Eigen pairs of a symmetric 3 × 3 [xx, xy, xz, yy, yz, zz]: { values (largest first), vectors (unit, same order) }. */
export function eigen3([xx, xy, xz, yy, yz, zz]) {
  const a = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => Math.max(0, a[i][i])), vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]]) };
}

/** Moments of some points about a shift s: { n, s, m: [Σx, Σy, Σz], c: [Σxx, Σxy, Σxz, Σyy, Σyz, Σzz] } (relative to s). */
const moments = (s) => ({ n: 0, s, m: [0, 0, 0], c: [0, 0, 0, 0, 0, 0] });
function addPoint(M, x, y, z) {
  x -= M.s[0];
  y -= M.s[1];
  z -= M.s[2];
  M.n++;
  M.m[0] += x;
  M.m[1] += y;
  M.m[2] += z;
  const c = M.c;
  c[0] += x * x;
  c[1] += x * y;
  c[2] += x * z;
  c[3] += y * y;
  c[4] += y * z;
  c[5] += z * z;
}
/** Centroid, covariance and its eigen pairs of moments. */
function fromMoments(M) {
  const k = 1 / M.n;
  const [a, b, c] = [M.m[0] * k, M.m[1] * k, M.m[2] * k];
  const C = M.c;
  const cov = [C[0] * k - a * a, C[1] * k - a * b, C[2] * k - a * c, C[3] * k - b * b, C[4] * k - b * c, C[5] * k - c * c];
  return { centroid: [M.s[0] + a, M.s[1] + b, M.s[2] + c], cov, ...eigen3(cov) };
}

// ---------------------------------------------------------------- the voxel grid and neighbourhoods

/**
 * Points sorted into cubic cells of size m: { size, min, dims, count (cells), start (Uint32Array, cells + 1), order
 * (point indices cell by cell), cellOf (Uint32Array, per point), keyOf (Float64Array, per cell), index (Map key → cell) }.
 */
export function voxelGrid(points, size) {
  const n = points.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = points[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  if (!n) min.fill(0), max.fill(0);
  const dims = [0, 1, 2].map((k) => Math.floor((max[k] - min[k]) / size) + 3); // a margin cell each side: neighbours never wrap
  const keyAt = (x, y, z) => Math.floor((x - min[0]) / size) + 1 + (Math.floor((y - min[1]) / size) + 1) * dims[0] + (Math.floor((z - min[2]) / size) + 1) * dims[0] * dims[1];
  const index = new Map();
  const cellOf = new Uint32Array(n);
  const keys = [];
  for (let i = 0; i < n; i++) {
    const key = keyAt(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    let c = index.get(key);
    if (c === undefined) index.set(key, (c = keys.length)), keys.push(key);
    cellOf[i] = c;
  }
  const count = keys.length;
  const start = new Uint32Array(count + 1);
  for (let i = 0; i < n; i++) start[cellOf[i] + 1]++;
  for (let c = 0; c < count; c++) start[c + 1] += start[c];
  const fill = start.slice(0, count);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;
  return { size, min, dims, count, start, order, cellOf, keyOf: Float64Array.from(keys), index, keyAt };
}

/** The (up to 26) occupied cells around cell c. */
export function cellNeighbours(grid, c) {
  const out = [];
  const key = grid.keyOf[c];
  const [X, XY] = [grid.dims[0], grid.dims[0] * grid.dims[1]];
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        const nb = grid.index.get(key + dx + dy * X + dz * XY);
        if (nb !== undefined) out.push(nb);
      }
  return out;
}

/** Indices of the points within radius of p = [x, y, z]. */
export function neighbours(grid, points, p, radius) {
  const out = [];
  const r = Math.ceil(radius / grid.size);
  const s = grid.size;
  const [X, XY] = [grid.dims[0], grid.dims[0] * grid.dims[1]];
  const c0 = grid.keyAt(p[0], p[1], p[2]);
  const r2 = radius * radius;
  for (let dz = -r; dz <= r; dz++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const c = grid.index.get(c0 + dx + dy * X + dz * XY);
        if (c === undefined) continue;
        for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
          const i = grid.order[k];
          const q = i * 3;
          if ((points[q] - p[0]) ** 2 + (points[q + 1] - p[1]) ** 2 + (points[q + 2] - p[2]) ** 2 <= r2) out.push(i);
        }
      }
  return out;
}

/**
 * Shape of a neighbourhood (indices into points): { count, centroid, normal (smallest axis, pointing up when it can),
 * values (λ1 ≥ λ2 ≥ λ3), linearity, planarity, scattering, verticality (1 − |n·up|), curvature (λ3 / Σλ) }.
 */
export function covarianceFeatures(points, idx) {
  if (idx.length < 3) return null;
  const q = idx[0] * 3;
  const M = moments([points[q], points[q + 1], points[q + 2]]);
  for (const i of idx) addPoint(M, points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
  return shapeOf(fromMoments(M), M.n);
}
function shapeOf(f, count) {
  const [l1, l2, l3] = f.values;
  const sum = l1 + l2 + l3 || 1e-30;
  let normal = f.vectors[2];
  if (normal[1] < 0) normal = scl(normal, -1);
  return { count, centroid: f.centroid, normal, values: f.values, linearity: (l1 - l2) / (l1 || 1e-30), planarity: (l2 - l3) / (l1 || 1e-30), scattering: l3 / (l1 || 1e-30), verticality: 1 - Math.abs(normal[1]), curvature: l3 / sum, cov: f.cov };
}

/** Each cell's own shape (null under 3 points). */
function cellShapes(grid, points) {
  const out = new Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    const a = grid.start[c];
    const b = grid.start[c + 1];
    if (b - a < 3) {
      out[c] = null;
      continue;
    }
    const q = grid.order[a] * 3;
    const M = moments([points[q], points[q + 1], points[q + 2]]);
    for (let k = a; k < b; k++) {
      const i = grid.order[k] * 3;
      addPoint(M, points[i], points[i + 1], points[i + 2]);
    }
    out[c] = shapeOf(fromMoments(M), M.n);
  }
  return out;
}

/**
 * A normal per point (Float32Array, x y z each, pointing up when it can): the PCA of its cell and the cells around it
 * (3 × 3 × 3 cells of size voxel, automatic by default) when its own cell is not flat. For colour by normal.
 */
export function pointNormals(points, { voxel = autoVoxel(points) } = {}) {
  const grid = voxelGrid(points, voxel);
  const out = new Float32Array(points.length);
  for (let c = 0; c < grid.count; c++) {
    const own = [];
    for (let j = grid.start[c]; j < grid.start[c + 1]; j++) own.push(grid.order[j]);
    let f = own.length >= 8 ? covarianceFeatures(points, own) : null;
    if (!f || f.curvature > 0.02) {
      const idx = [];
      for (const k of [c, ...cellNeighbours(grid, c)]) for (let j = grid.start[k]; j < grid.start[k + 1]; j++) idx.push(grid.order[j]);
      f = covarianceFeatures(points, idx) || f;
    }
    const nrm = f ? f.normal : [0, 1, 0];
    for (let j = grid.start[c]; j < grid.start[c + 1]; j++) out.set(nrm, grid.order[j] * 3);
  }
  return out;
}

// ---------------------------------------------------------------- planes

/** vertical (walls, façades, abutments), horizontal (floors, roofs, slabs, ground) or sloped, by the tilt of the normal. */
export const planeType = (n, tol = 10) => (Math.abs(n[1]) >= Math.cos(tol * D2R) ? 'horizontal' : Math.abs(n[1]) <= Math.sin(tol * D2R) ? 'vertical' : 'sloped');

/** In-plane axes: u horizontal along a wall (east for a level plane), v = n × u. */
export function basis(n) {
  const u = Math.abs(n[1]) > 0.999 ? [1, 0, 0] : norm(cross([0, 1, 0], n));
  return { u, v: cross(n, u) };
}

/** A plane through points idx by PCA: { normal, d (n · p = d), centroid, rms, count }. */
export function fitPlane(points, idx) {
  const f = covarianceFeatures(points, idx);
  if (!f) return null;
  const normal = f.normal;
  return { normal, d: dot(normal, f.centroid), centroid: f.centroid, rms: Math.sqrt(f.values[2]), count: f.count };
}

/** A cell size giving about `target` points per surface cell (between 0.15 and 2 m). */
export function autoVoxel(points, target = 16) {
  const n = points.length / 3;
  if (n < 100) return 0.5;
  const s0 = 0.5;
  const g = voxelGrid(points, s0);
  const perArea = n / (g.count * s0 * s0); // points per m² of surface, roughly
  return Math.max(0.15, Math.min(2, Math.sqrt(target / perArea)));
}

/**
 * Planes in a scan. opts: distance (m, inlier band, default 0.03), minArea (m², 2), minPoints (500), voxel (m, auto),
 * angle (degrees between neighbouring cells of one plane, 10), regularise (snap near-vertical planes to vertical and
 * walls to the dominant directions), tolerance (degrees for that, 5), onProgress(fraction, stage).
 * Returns { planes, voxel }: each { normal, d, centroid, rms, count, area, type, extent (3D ring on the plane), u, v,
 * inliers (Uint32Array) }, largest first.
 */
export function detectPlanes(points, opts = {}) {
  const { distance = 0.03, minArea = 2, minPoints = 500, angle = 10, regularise = false, tolerance = 5, onProgress = () => {} } = opts;
  const voxel = opts.voxel || autoVoxel(points);
  onProgress(0.02, 'neighbourhoods');
  const grid = voxelGrid(points, voxel);
  const shapes = cellShapes(grid, points);
  onProgress(0.2, 'normals');
  const flatCell = (s) => s && s.count >= 5 && Math.sqrt(s.values[2]) < distance && s.values[1] > 9 * s.values[2] && Math.sqrt(s.values[1]) > voxel * 0.12;
  const seeds = [];
  for (let c = 0; c < grid.count; c++) if (flatCell(shapes[c])) seeds.push(c);
  seeds.sort((a, b) => shapes[a].curvature - shapes[b].curvature);
  const label = new Int32Array(grid.count).fill(-1);
  const cosA = Math.cos(angle * D2R);
  const regions = [];
  for (const [si, s] of seeds.entries()) {
    if (label[s] >= 0) continue;
    if (si % 2000 === 0) onProgress(0.2 + 0.3 * (si / seeds.length), 'growing');
    const id = regions.length;
    const shift = shapes[s].centroid;
    const R = { cells: [s], N: 0, S1: [0, 0, 0], S2: [0, 0, 0, 0, 0, 0], shift };
    const take = (c) => {
      const f = shapes[c];
      const d = sub(f.centroid, shift);
      R.N += f.count;
      for (let k = 0; k < 3; k++) R.S1[k] += f.count * d[k];
      const [a, b, e] = d;
      const C = f.cov;
      const outer = [a * a, a * b, a * e, b * b, b * e, e * e];
      for (let k = 0; k < 6; k++) R.S2[k] += f.count * (C[k] + outer[k]);
    };
    const plane = () => {
      const k = 1 / R.N;
      const m = scl(R.S1, k);
      const cov = R.S2.map((v, i) => v * k - [m[0] * m[0], m[0] * m[1], m[0] * m[2], m[1] * m[1], m[1] * m[2], m[2] * m[2]][i]);
      const n = eigen3(cov).vectors[2];
      const p = add(shift, m);
      return { n, d: dot(n, p) };
    };
    label[s] = id;
    take(s);
    let P = { n: shapes[s].normal, d: dot(shapes[s].normal, shapes[s].centroid) };
    let fittedAt = R.N;
    const queue = [s];
    while (queue.length) {
      const c = queue.pop();
      for (const nb of cellNeighbours(grid, c)) {
        if (label[nb] >= 0 || !flatCell(shapes[nb])) continue;
        const f = shapes[nb];
        if (Math.abs(dot(f.normal, P.n)) < cosA || Math.abs(dot(f.centroid, P.n) - P.d) > distance) continue;
        label[nb] = id;
        take(nb);
        R.cells.push(nb);
        queue.push(nb);
        if (R.N > fittedAt * 1.15) (P = plane()), (fittedAt = R.N);
      }
    }
    R.plane = R.cells.length > 1 ? plane() : P;
    regions.push(R);
  }
  onProgress(0.5, 'fitting');
  // refine on the points: the region's cells and the ring around them, three passes of fit and re-select
  const stamp = new Int32Array(grid.count).fill(-1);
  const cand = [];
  const candidates = (cells, tag) => {
    cand.length = 0;
    for (const c of cells)
      for (const k of [c, ...cellNeighbours(grid, c)])
        if (stamp[k] !== tag) (stamp[k] = tag), cand.push(k);
    return cand;
  };
  const refine = (cells, P, tag) => {
    const cs = candidates(cells, tag);
    let fit = { normal: P.n, d: P.d };
    let idx = [];
    for (let pass = 0; pass < 3; pass++) {
      idx = [];
      const [nx, ny, nz] = fit.normal;
      for (const c of cs)
        for (let j = grid.start[c]; j < grid.start[c + 1]; j++) {
          const i = grid.order[j];
          if (Math.abs(nx * points[i * 3] + ny * points[i * 3 + 1] + nz * points[i * 3 + 2] - fit.d) <= distance) idx.push(i);
        }
      const f = fitPlane(points, idx);
      if (!f) return null;
      if (dot(f.normal, fit.normal) < 0) (f.normal = scl(f.normal, -1)), (f.d = -f.d);
      fit = f;
    }
    return { ...fit, inliers: Uint32Array.from(idx) };
  };
  const minCells = Math.max(3, Math.floor(minArea / (voxel * voxel) / 4));
  let planes = [];
  regions.forEach((R, id) => {
    if (R.N < minPoints / 3 || R.cells.length < minCells) return;
    const f = refine(R.cells, R.plane, id);
    if (f && f.count >= minPoints) planes.push({ ...f, cells: R.cells, region: id });
    if (id % 200 === 0) onProgress(0.5 + 0.2 * (id / regions.length), 'fitting');
  });
  // merge coplanar pieces that touch (a wall split by a window, a roof by a chimney)
  onProgress(0.72, 'merging');
  planes = mergeCoplanar(planes, grid, { distance, angle: Math.min(angle / 2, 3), refine });
  if (regularise) planes = regularisePlanes(planes, { tolerance });
  onProgress(0.8, 'extents');
  const out = [];
  for (const p of planes) {
    const ext = extentOf(points, p, { cell: Math.max(voxel / 2, 0.1) });
    if (ext.area < minArea) continue;
    if (p.normal[1] < -1e-9 || (Math.abs(p.normal[1]) <= 1e-9 && orientKey(p.normal) < 0)) (p.normal = scl(p.normal, -1)), (p.d = -p.d), ext.ring.reverse();
    out.push({ normal: p.normal.map(r5), d: p.d, centroid: p.centroid, rms: p.rms, count: p.count, area: ext.area, type: planeType(p.normal), extent: ext.ring, u: ext.u, v: ext.v, inliers: ext.inliers, ...(p.regularised ? { regularised: true } : {}) });
  }
  out.sort((a, b) => b.area - a.area);
  onProgress(1, 'done');
  return { planes: out, voxel, grid };
}
// a stable sign for walls: the normal points east, or north when it runs east–west (model −z is north)
const orientKey = (n) => (Math.abs(n[0]) > 1e-6 ? n[0] : -n[2]);

function mergeCoplanar(planes, grid, { distance, angle, refine }) {
  const parent = planes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cosA = Math.cos(angle * D2R);
  // each piece's box in cells; pieces two cells apart or closer may merge (a band of mixed cells can split a wall)
  const [X, XY] = [grid.dims[0], grid.dims[0] * grid.dims[1]];
  const boxes = planes.map((p) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const c of p.cells) {
      const k = grid.keyOf[c];
      const v = [k % X, Math.floor(k / X) % grid.dims[1], Math.floor(k / XY)];
      for (let a = 0; a < 3; a++) (b[a] = Math.min(b[a], v[a])), (b[a + 3] = Math.max(b[a + 3], v[a]));
    }
    return b;
  });
  const close = (a, b) => [0, 1, 2].every((k) => a[k] <= b[k + 3] + 2 && b[k] <= a[k + 3] + 2);
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++) {
      const [p, q] = [planes[i], planes[j]];
      if (find(i) === find(j) || Math.abs(dot(p.normal, q.normal)) < cosA || !close(boxes[i], boxes[j])) continue;
      if (Math.abs(dot(q.centroid, p.normal) - p.d) > distance || Math.abs(dot(p.centroid, q.normal) - q.d) > distance) continue;
      parent[find(j)] = find(i);
    }
  const groups = new Map();
  planes.forEach((_, i) => (groups.get(find(i)) || groups.set(find(i), []).get(find(i))).push(i));
  const out = [];
  let tag = 1e9;
  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(planes[g[0]]);
      continue;
    }
    const big = g.reduce((a, b) => (planes[b].count > planes[a].count ? b : a));
    const cells = g.flatMap((i) => planes[i].cells);
    const f = refine(cells, { n: planes[big].normal, d: planes[big].d }, tag++);
    if (f) out.push({ ...f, cells, region: planes[big].region, merged: g.length });
  }
  return out;
}

/**
 * Regularise: near-vertical planes (within tolerance°) made exactly vertical, and walls turned to the dominant
 * directions (the area-weighted heading, mod 90°) when within tolerance° of one. Each keeps its centroid.
 */
export function regularisePlanes(planes, { tolerance = 5 } = {}) {
  const tol = tolerance * D2R;
  const walls = planes.filter((p) => Math.abs(p.normal[1]) < Math.sin(tol));
  // dominant heading: the weighted circular mean of 4 × heading
  let [c, s] = [0, 0];
  for (const p of walls) {
    const h = Math.atan2(p.normal[2], p.normal[0]) * 4;
    c += p.count * Math.cos(h);
    s += p.count * Math.sin(h);
  }
  const dom = Math.atan2(s, c) / 4;
  return planes.map((p) => {
    if (!walls.includes(p)) return p;
    let n = norm([p.normal[0], 0, p.normal[2]]);
    const h = Math.atan2(n[2], n[0]);
    const k = Math.round((h - dom) / (Math.PI / 2));
    const snapped = dom + k * (Math.PI / 2);
    if (walls.length > 1 && Math.abs(h - snapped) < tol) n = [Math.cos(snapped), 0, Math.sin(snapped)];
    return { ...p, normal: n, d: dot(n, p.centroid), regularised: true };
  });
}

/**
 * The extent of a plane's inliers: occupancy cells on the plane, the largest connected piece, its outline traced and
 * simplified (an alpha shape of sorts). { ring (3D, counter-clockwise about the normal), area (m²), inliers (those in
 * the piece), u, v }.
 */
export function extentOf(points, p, { cell = 0.25 } = {}) {
  const n = p.normal;
  const { u, v } = basis(n);
  const o = scl(n, p.d);
  const m = p.inliers.length;
  const U = new Float64Array(m);
  const V = new Float64Array(m);
  let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m; k++) {
    const i = p.inliers[k] * 3;
    const q = [points[i] - o[0], points[i + 1] - o[1], points[i + 2] - o[2]];
    U[k] = dot(q, u);
    V[k] = dot(q, v);
    if (U[k] < u0) u0 = U[k];
    if (U[k] > u1) u1 = U[k];
    if (V[k] < v0) v0 = V[k];
    if (V[k] > v1) v1 = V[k];
  }
  const W = Math.floor((u1 - u0) / cell) + 3;
  const H = Math.floor((v1 - v0) / cell) + 3;
  if (W * H > 4e7) return { ring: [], area: 0, inliers: p.inliers, u, v }; // shortcut: absurd extents (a scan-wide plane at 1 cm cells) are skipped
  const occ = new Int32Array(W * H).fill(-1); // -1 empty, else the component
  const at = new Int32Array(m);
  for (let k = 0; k < m; k++) {
    at[k] = Math.floor((U[k] - u0) / cell) + 1 + (Math.floor((V[k] - v0) / cell) + 1) * W;
    occ[at[k]] = 0;
  }
  // connected pieces (8-neighbours), with a one-cell gap bridged so sparse scans stay whole
  const comp = new Int32Array(W * H).fill(-1);
  const sizes = [];
  for (let s = 0; s < W * H; s++) {
    if (occ[s] < 0 || comp[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const c = stack.pop();
      size++;
      const cx = c % W;
      const cy = (c - cx) / W;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const k = x + y * W;
          if (occ[k] >= 0 && comp[k] < 0) (comp[k] = id), stack.push(k);
        }
    }
    sizes.push(size);
  }
  const best = sizes.indexOf(Math.max(...sizes));
  // close one-cell holes and gaps in the piece so its outline is one ring
  const filled = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) if (comp[s] === best) filled[s] = 1;
  const grown = filled.slice();
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const s = x + y * W;
      if (filled[s]) continue;
      if ((filled[s - 1] && filled[s + 1]) || (filled[s - W] && filled[s + W])) grown[s] = 1;
    }
  let area = 0;
  for (let s = 0; s < W * H; s++) area += grown[s];
  area *= cell * cell;
  const inl = [];
  for (let k = 0; k < m; k++) if (comp[at[k]] === best) inl.push(p.inliers[k]);
  // outline: boundary edges with the piece on their left, linked into loops; the longest is the outer ring
  const next = new Map();
  const vid = (x, y) => x + y * (W + 1);
  const edge = (a, b) => (next.get(a) || next.set(a, []).get(a)).push(b);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!grown[x + y * W]) continue;
      if (y === 0 || !grown[x + (y - 1) * W]) edge(vid(x, y), vid(x + 1, y));
      if (x === W - 1 || !grown[x + 1 + y * W]) edge(vid(x + 1, y), vid(x + 1, y + 1));
      if (y === H - 1 || !grown[x + (y + 1) * W]) edge(vid(x + 1, y + 1), vid(x, y + 1));
      if (x === 0 || !grown[x - 1 + y * W]) edge(vid(x, y + 1), vid(x, y));
    }
  let ring = [];
  for (const startV of [...next.keys()]) {
    if (!next.get(startV)?.length) continue;
    const loop = [];
    let a = startV;
    while (next.get(a)?.length) {
      loop.push(a);
      const outs = next.get(a);
      a = outs.pop();
    }
    if (loop.length > ring.length) ring = loop;
  }
  const xy = ring.map((k) => [u0 + ((k % (W + 1)) - 1) * cell, v0 + (Math.floor(k / (W + 1)) - 1) * cell]);
  const simple = xy.length > 3 ? DR.simplify(xy, cell * 0.75, true) : xy;
  const ring3 = simple.map(([a, b]) => add(o, add(scl(u, a), scl(v, b))));
  return { ring: ring3, area, inliers: Uint32Array.from(inl), u, v };
}

// ---------------------------------------------------------------- lines where planes meet

/** The line where two planes meet: { point, dir } (dir unit; point the nearest to both centroids), or null when parallel. */
export function planeLine(a, b) {
  const dir = cross(a.normal, b.normal);
  const L = len(dir);
  if (L < 1e-6) return null;
  const d = scl(dir, 1 / L);
  const mid = scl(add(a.centroid, b.centroid), 0.5);
  // the point on both planes nearest mid: solve n1·x = d1, n2·x = d2, d·x = d·mid
  const n1 = a.normal;
  const n2 = b.normal;
  const det = dot(n1, cross(n2, d));
  const x = scl(add(add(scl(cross(n2, d), a.d), scl(cross(d, n1), b.d)), scl(cross(n1, n2), dot(d, mid))), 1 / det);
  return { point: x, dir: d };
}

/**
 * Where along a plane–plane line both planes have points within band of it: { from, to } (m along dir from point,
 * the longest run of bins of size bin both hold, one empty bin bridged), or null. Each plane's inliers near the other
 * plane are the ones near the line (they lie on their own plane).
 */
export function support(points, a, b, line, { band = 0.3, bin = 0.2, minLength = 0.5, skip = null, keep = null, maxGap = 0.1 } = {}) {
  const all = [[], []];
  const near = (p, other, k) => {
    const t = [];
    const [nx, ny, nz] = other.normal;
    for (const i of p.inliers) {
      const q = i * 3;
      if (Math.abs(nx * points[q] + ny * points[q + 1] + nz * points[q + 2] - other.d) > band) continue;
      const v = (points[q] - line.point[0]) * line.dir[0] + (points[q + 1] - line.point[1]) * line.dir[1] + (points[q + 2] - line.point[2]) * line.dir[2];
      all[k].push(v);
      if (skip?.[i] || (keep && !keep(i, p))) continue;
      t.push(v);
    }
    return t;
  };
  const ta = near(a, b, 0);
  const tb = near(b, a, 1);
  if (ta.length < 3 || tb.length < 3) return null;
  const lo = Math.max(Math.min(...ta), Math.min(...tb));
  const hi = Math.min(Math.max(...ta), Math.max(...tb));
  if (!(hi - lo >= minLength)) return null;
  const nb = Math.ceil((hi - lo) / bin);
  const ha = new Uint32Array(nb);
  const hb = new Uint32Array(nb);
  for (const t of ta) if (t >= lo && t <= hi) ha[Math.min(nb - 1, Math.floor((t - lo) / bin))]++;
  for (const t of tb) if (t >= lo && t <= hi) hb[Math.min(nb - 1, Math.floor((t - lo) / bin))]++;
  let best = null;
  let run = null;
  let gap = 0;
  for (let k = 0; k < nb; k++) {
    if (ha[k] && hb[k]) {
      if (!run) run = [k, k];
      run[1] = k;
      gap = 0;
    } else if (run && ++gap > 1) {
      if (!best || run[1] - run[0] > best[1] - best[0]) best = run;
      (run = null), (gap = 0);
    }
  }
  if (run && (!best || run[1] - run[0] > best[1] - best[0])) best = run;
  if (!best) return null;
  // the run's ends at the points themselves: the farthest point both planes reach inside the run
  const [r0, r1] = [lo + best[0] * bin, lo + (best[1] + 1) * bin];
  const inRun = (ts) => ts.filter((t) => t >= r0 - 1e-9 && t <= r1 + 1e-9);
  const [A, B] = [inRun(ta), inRun(tb)];
  if (!A.length || !B.length) return null;
  // filtered points stop short of a junction (a roof, the ground): carry each end on over the plane's other points
  // while they follow on closely (a wall standing clear of the ground keeps its gap)
  const reach = (ts, v, k) => {
    const s = all[k].filter((t) => (v < 0 ? t <= ts : t >= ts)).sort((x, y) => v * (x - y));
    let e = ts;
    for (const t of s) if (Math.abs(t - e) <= maxGap) e = t;
    else break;
    return e;
  };
  const from = Math.max(reach(Math.min(...A), -1, 0), reach(Math.min(...B), -1, 1));
  const to = Math.min(reach(Math.max(...A), 1, 0), reach(Math.max(...B), 1, 1));
  return to - from >= minLength ? { from, to } : null;
}

/**
 * Corners: where two vertical planes meet at minAngle° or more, the vertical line through their intersection over
 * the height both support. level (model y): instead, the corner in a horizontal slice at that height (both planes
 * must hold points within band of it). Returns [{ base, top, point (base, or at level), angle, planes: [i, j], height }].
 */
export function detectCorners(points, planes, { minAngle = 30, band = 1, level = null, grid = null, radius = 0.2 } = {}) {
  const out = [];
  // the ground or a roof running into a wall shares a strip of its points: those do not count as wall, nor do points
  // whose own neighbourhood faces another way (the ground along a wall's foot)
  const skip = new Uint8Array(points.length / 3);
  for (const p of planes) if (p.type !== 'vertical') for (const i of p.inliers) skip[i] = 1;
  const g = grid || voxelGrid(points, Math.max(0.3, 2 * radius));
  const keep = (i, p) => {
    const f = covarianceFeatures(points, neighbours(g, points, [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]], radius));
    return !f || Math.abs(dot(f.normal, p.normal)) >= 0.5;
  };
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++) {
      const [a, b] = [planes[i], planes[j]];
      if (a.type !== 'vertical' || b.type !== 'vertical') continue;
      const ang = Math.acos(Math.min(1, Math.abs(dot(a.normal, b.normal)))) / D2R;
      if (ang < minAngle) continue;
      const line = planeLine(a, b);
      if (!line) continue;
      if (line.dir[1] < 0) line.dir = scl(line.dir, -1);
      const s = support(points, a, b, line, { band, skip, keep });
      if (!s) continue;
      const base = add(line.point, scl(line.dir, s.from));
      const top = add(line.point, scl(line.dir, s.to));
      if (level !== null && !(level >= base[1] - band && level <= top[1] + band)) continue;
      const point = level === null ? base : add(line.point, scl(line.dir, (level - line.point[1]) / line.dir[1]));
      out.push({ base, top, point, angle: ang, planes: [i, j], height: top[1] - base[1] });
    }
  return out;
}

/**
 * Plane–plane edges (eaves, ridges, verges, wall tops on a flat roof, wall feet): every pair meeting at minAngle° or
 * more, but two walls (those are corners), clipped to where both have points. [{ from, to, dir, angle, planes, length }].
 */
export function planeEdges(points, planes, { minAngle = 20, band = 0.3 } = {}) {
  const out = [];
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++) {
      const [a, b] = [planes[i], planes[j]];
      if (a.type === 'vertical' && b.type === 'vertical') continue;
      const ang = Math.acos(Math.min(1, Math.abs(dot(a.normal, b.normal)))) / D2R;
      if (ang < minAngle) continue;
      const line = planeLine(a, b);
      if (!line) continue;
      const s = support(points, a, b, line, { band });
      if (!s) continue;
      out.push({ from: add(line.point, scl(line.dir, s.from)), to: add(line.point, scl(line.dir, s.to)), dir: line.dir, angle: ang, planes: [i, j], length: s.to - s.from });
    }
  return out;
}

/** The top of each wall: the highest point every bin (m) along it, simplified. [{ plane, points (3D polyline), length }]. */
export function wallTops(points, planes, { bin = 0.5, tolerance = 0.05 } = {}) {
  const out = [];
  planes.forEach((p, k) => {
    if (p.type !== 'vertical') return;
    const { u } = basis(p.normal);
    const o = scl(p.normal, p.d);
    const top = new Map();
    const count = new Map();
    for (const i of p.inliers) {
      const q = [points[i * 3] - o[0], points[i * 3 + 1] - o[1], points[i * 3 + 2] - o[2]];
      const b = Math.floor(dot(q, u) / bin);
      count.set(b, (count.get(b) || 0) + 1);
      const h = points[i * 3 + 1];
      const t = top.get(b);
      if (!t) top.set(b, [h, h, h]);
      else if (h > t[0]) (t[2] = t[1]), (t[1] = t[0]), (t[0] = h);
      else if (h > t[1]) (t[2] = t[1]), (t[1] = h);
      else if (h > t[2]) t[2] = h;
    }
    const med = [...count.values()].sort((a, b) => a - b)[count.size >> 1];
    const bins = [...top.keys()].filter((b) => count.get(b) >= med / 4).sort((a, b) => a - b);
    if (bins.length < 2) return;
    // the mean of the three highest points: a single noisy point does not lift the line
    const pts = bins.map((b) => [(b + 0.5) * bin, top.get(b).reduce((s, h) => s + h, 0) / 3]);
    const simple = DR.simplify(pts, tolerance);
    const line = simple.map(([a, h]) => {
      const w = add(o, scl(u, a));
      return [w[0], h, w[2]];
    });
    out.push({ plane: k, points: line, length: (bins.at(-1) - bins[0] + 1) * bin });
  });
  return out;
}

// ---------------------------------------------------------------- step edges across an alignment (kerbs, wall tops)

/** Points sorted into plan cells (x, z) of size m, for strip queries. */
export function planGrid(points, size = 1) {
  const n = points.length / 3;
  let [x0, z0] = [Infinity, Infinity];
  for (let i = 0; i < n; i++) (x0 = Math.min(x0, points[i * 3])), (z0 = Math.min(z0, points[i * 3 + 2]));
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor((points[i * 3] - x0) / size)},${Math.floor((points[i * 3 + 2] - z0) / size)}`;
    (cells.get(k) || cells.set(k, []).get(k)).push(i);
  }
  return { size, x0, z0, cells };
}
function inRect(points, pg, c, t, along, across) {
  const r = [-t[1], t[0]];
  const ext = Math.abs(t[0]) * along + Math.abs(r[0]) * across;
  const ezt = Math.abs(t[1]) * along + Math.abs(r[1]) * across;
  const out = [];
  for (let gx = Math.floor((c[0] - ext - pg.x0) / pg.size); gx <= Math.floor((c[0] + ext - pg.x0) / pg.size); gx++)
    for (let gz = Math.floor((c[2] - ezt - pg.z0) / pg.size); gz <= Math.floor((c[2] + ezt - pg.z0) / pg.size); gz++)
      for (const i of pg.cells.get(`${gx},${gz}`) || []) {
        const dx = points[i * 3] - c[0];
        const dz = points[i * 3 + 2] - c[2];
        if (Math.abs(dx * t[0] + dz * t[1]) <= along) {
          const o = dx * r[0] + dz * r[1];
          if (Math.abs(o) <= across) out.push([o, points[i * 3 + 1]]);
        }
      }
  return out;
}

/** A profile without its lone points (a bird, a multipath echo): kept when two others lie within 0.25 m across and 0.2 m up. */
export function dropIsolated(prof, { across = 0.25, up = 0.2 } = {}) {
  const bins = new Map();
  for (const p of prof) {
    const k = Math.floor(p[0] / across);
    (bins.get(k) || bins.set(k, []).get(k)).push(p[1]);
  }
  return prof.filter(([o, h]) => {
    const k = Math.floor(o / across);
    let n = 0;
    for (const b of [k - 1, k, k + 1]) for (const v of bins.get(b) || []) if (Math.abs(v - h) <= up && ++n > 2) return true;
    return false;
  });
}

/**
 * The steps in one cross profile [[offset, height], …]: where a line fitted just left of an offset and one fitted just
 * right of it jump by minHeight to maxHeight, both fits clean. [{ offset, bottom, top, height, side }] where bottom
 * and top are the heights of the lower and upper surface at the step, side +1 when the upper one is to the right.
 */
export function profileSteps(prof, { minHeight = 0.05, maxHeight = 0.4, window = 0.5, gap = 0.04, step = 0.02, noise = 0.02 } = {}) {
  prof = dropIsolated(prof);
  if (prof.length < 10) return [];
  prof.sort((a, b) => a[0] - b[0]);
  const n = prof.length;
  const o = prof.map((p) => p[0]);
  const P = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)];
  for (let i = 0; i < n; i++) {
    const [x, h] = prof[i];
    const v = [1, x, x * x, h, x * h, h * h];
    for (let k = 0; k < 6; k++) P[k][i + 1] = P[k][i] + v[k];
  }
  const lower = (x) => {
    let [lo, hi] = [0, n];
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (o[m] < x) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  // a line h = a + b·x through the points with offsets in [x0, x1]: { at(x), rms, n }
  const fit = (x0, x1) => {
    const [i, j] = [lower(x0), lower(x1)];
    const S = P.map((p) => p[j] - p[i]);
    const [N, sx, sxx, sh, sxh, shh] = S;
    if (N < 4) return null;
    const det = N * sxx - sx * sx;
    if (det < 1e-12) return null;
    const b = (N * sxh - sx * sh) / det;
    const a = (sh - b * sx) / N;
    const sse = shh - 2 * a * sh - 2 * b * sxh + a * a * N + 2 * a * b * sx + b * b * sxx;
    return { at: (x) => a + b * x, rms: Math.sqrt(Math.max(0, sse) / N), n: N, slope: b };
  };
  const cands = [];
  for (let x = o[0] + window; x <= o[n - 1] - window; x += step) {
    const L = fit(x - window, x - gap);
    const R = fit(x + gap, x + window);
    if (!L || !R || L.rms > noise || R.rms > noise) continue;
    const J = R.at(x) - L.at(x);
    if (Math.abs(J) >= minHeight && Math.abs(J) <= maxHeight) cands.push({ x, J, L, R });
  }
  // the best jump in each run of candidates
  const runs = [];
  for (const c of cands) {
    const last = runs.at(-1);
    if (last && c.x - last.at(-1).x <= step * 1.5 + 1e-9 && Math.sign(c.J) === Math.sign(last[0].J)) last.push(c);
    else runs.push([c]);
  }
  const out = [];
  for (const run of runs) {
    const top = Math.max(...run.map((r) => Math.abs(r.J)));
    const best = run.filter((r) => Math.abs(r.J) >= top * 0.98);
    const c = best[best.length >> 1];
    // the face: points between the two surfaces near the step; their median offset is the step
    const [lo, hi] = c.J > 0 ? [c.L, c.R] : [c.R, c.L];
    const face = [];
    // (the middle of the face only: a noisy point of either surface stays out)
    for (let i = lower(c.x - 0.1); i < n && o[i] <= c.x + 0.1; i++) {
      const [x, h] = prof[i];
      const f = (h - lo.at(x)) / (hi.at(x) - lo.at(x));
      if (f > 0.3 && f < 0.7) face.push(x);
    }
    face.sort((a, b) => a - b);
    const x = face.length ? (face[(face.length - 1) >> 1] + face[face.length >> 1]) / 2 : c.x;
    const mid = fit(x - 0.1, x + 0.1);
    // a step leaves a line across it a residual of about a quarter of its height; a slope break hardly any
    const side = Math.max(c.L.rms, c.R.rms);
    if (mid && mid.n >= 6 && mid.rms ** 2 - side ** 2 < (0.15 * c.J) ** 2) continue;
    const L = fit(x - window, x - gap) || c.L;
    const R = fit(x + gap, x + window) || c.R;
    const [hl, hr] = [L.at(x), R.at(x)];
    out.push({ offset: x, bottom: Math.min(hl, hr), top: Math.max(hl, hr), height: Math.abs(hr - hl), side: hr > hl ? 1 : -1, face: face.length });
  }
  return out;
}

/**
 * Step edges along a path of [x, y, z, station] points (an alignment): a cross profile every spacing m (points within
 * strip m of it, width m either side), its steps, linked from station to station into lines. Returns [{ offset (mean,
 * + right of the path), side (+1 upper surface to the right), top (3D polyline), bottom (3D polyline), height (mean),
 * stations }] with at least minStations profiles each.
 */
export function stepEdges(points, path, { spacing = 1, width = 10, strip = 0.25, minHeight = 0.05, maxHeight = 0.4, minStations = 3, onProgress = () => {} } = {}) {
  const pg = planGrid(points, 1);
  const end = path.at(-1)[3];
  const chains = [];
  const at = (s) => {
    let i = 1;
    while (i < path.length - 1 && path[i][3] < s) i++;
    const [p, q] = [path[i - 1], path[i]];
    const u = (s - p[3]) / (q[3] - p[3] || 1);
    const t = [q[0] - p[0], q[2] - p[2]];
    const L = Math.hypot(...t) || 1;
    return { p: [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u], t: [t[0] / L, t[1] / L] };
  };
  const nSt = Math.floor((end - path[0][3]) / spacing + 1e-9) + 1;
  for (let k = 0; k < nSt; k++) {
    const s = path[0][3] + k * spacing;
    if (k % 20 === 0) onProgress(k / nSt);
    const { p, t } = at(s);
    const r = [-t[1], t[0]];
    const steps = profileSteps(inRect(points, pg, p, t, strip, width), { minHeight, maxHeight });
    for (const st of steps) {
      const w = (h) => [p[0] + r[0] * st.offset, h, p[2] + r[1] * st.offset];
      const hit = { s, p, r, offset: st.offset, side: st.side, top: w(st.top), bottom: w(st.bottom), height: st.height };
      let best = null;
      for (const c of chains) {
        const last = c.at(-1);
        if (last.side !== st.side || s - last.s > spacing * 2.5 + 1e-9 || last.s === s) continue;
        const d = Math.abs(last.offset - st.offset);
        if (d < 0.3 && (!best || d < best.d)) best = { c, d };
      }
      if (best) best.c.push(hit);
      else chains.push([hit]);
    }
  }
  onProgress(1);
  return chains
    .filter((c) => c.length >= minStations)
    .map((c) => {
      const off = c.map((h) => h.offset);
      const dev = [];
      c.forEach((h, k) => {
        const m = off.slice(Math.max(0, k - 2), k + 3).sort((a, b) => a - b)[Math.min(k + 3, off.length) - Math.max(0, k - 2) >> 1];
        dev.push(Math.abs(m - h.offset));
        if (Math.abs(m - h.offset) < 0.01) return;
        for (const key of ['top', 'bottom']) (h[key][0] = h.p[0] + h.r[0] * m), (h[key][2] = h.p[2] + h.r[1] * m);
        h.offset = m;
      });
      // heights: the mean over three neighbouring profiles (a kerb rises and falls smoothly)
      for (const key of ['top', 'bottom']) {
        const ys = c.map((h) => h[key][1]);
        c.forEach((h, k) => {
          if (k && k < c.length - 1 && c[k + 1].s - c[k - 1].s <= 2 * spacing + 1e-9) h[key][1] = (ys[k - 1] + ys[k] + ys[k + 1]) / 3;
        });
      }
      const line = (key) => simplify3(c.map((h) => h[key]), 0.005);
      return { offset: c.reduce((s, h) => s + h.offset, 0) / c.length, side: c[0].side, top: line('top'), bottom: line('bottom'), height: c.reduce((s, h) => s + h.height, 0) / c.length, stations: c.length, from: c[0].s, to: c.at(-1).s, residual: { mean: r3(dev.reduce((s, d) => s + d, 0) / dev.length), max: r3(Math.max(...dev)) } };
    });
}

/** Douglas–Peucker in 3D. */
export function simplify3(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const ab = sub(pts[j], pts[i]);
    const L2 = dot(ab, ab) || 1e-30;
    let [w, dm] = [-1, 0];
    for (let k = i + 1; k < j; k++) {
      const ap = sub(pts[k], pts[i]);
      const t = Math.max(0, Math.min(1, dot(ap, ab) / L2));
      const d = len(sub(ap, scl(ab, t)));
      if (d > dm) (dm = d), (w = k);
    }
    if (w > 0 && dm > eps) (keep[w] = 1), stack.push([i, w], [w, j]);
  }
  return pts.filter((_, k) => keep[k]);
}

/** Compact numbers for a reply. */
export const round = { r3, r5 };

// ---------------------------------------------------------------- one request, as the commands and the worker run it

/** Inliers of known planes ({ normal, d, extent }) among points: within distance, inside the extent's box on the plane (+0.5 m). */
export function inliersOf(points, planes, distance = 0.03) {
  const pg = planGrid(points, 2); // each plane reads only the points under its extent
  return planes.map((p) => {
    const { u, v } = basis(p.normal);
    const ext = p.extent?.length ? p.extent : null;
    const box = ext && [0, 1].map((k) => [Math.min(...ext.map((q) => dot(q, k ? v : u))) - 0.5, Math.max(...ext.map((q) => dot(q, k ? v : u))) + 0.5]);
    const idx = [];
    const test = (i) => {
      const q = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
      if (Math.abs(dot(q, p.normal) - p.d) > distance) return;
      if (box && !(dot(q, u) >= box[0][0] && dot(q, u) <= box[0][1] && dot(q, v) >= box[1][0] && dot(q, v) <= box[1][1])) return;
      idx.push(i);
    };
    if (!ext) for (let i = 0; i < points.length / 3; i++) test(i);
    else {
      const xs = ext.map((q) => q[0]);
      const zs = ext.map((q) => q[2]);
      for (let gx = Math.floor((Math.min(...xs) - 0.5 - pg.x0) / pg.size); gx <= Math.floor((Math.max(...xs) + 0.5 - pg.x0) / pg.size); gx++)
        for (let gz = Math.floor((Math.min(...zs) - 0.5 - pg.z0) / pg.size); gz <= Math.floor((Math.max(...zs) + 0.5 - pg.z0) / pg.size); gz++) for (const i of pg.cells.get(`${gx},${gz}`) || []) test(i);
    }
    idx.sort((x, y) => x - y);
    return { ...p, type: p.type || planeType(p.normal), centroid: p.centroid || p.extent?.[0] || [0, 0, 0], inliers: Uint32Array.from(idx), count: idx.length };
  });
}

/**
 * What the detect commands ask for, in one pass over the points: planes (opts of detectPlanes) or given planes
 * ([{ normal, d, extent }]), then corners, edges (plane–plane), tops (wall tops) and steps ({ path, … } of
 * stepEdges) as asked. The planes come back without their inliers. onProgress(fraction, stage).
 */
export function runFeatures(points, req, onProgress = () => {}) {
  const out = {};
  let planes = [];
  let grid = null;
  const needPlanes = req.planes || req.corners || req.edges || req.tops;
  if (needPlanes) {
    if (req.given) planes = inliersOf(points, req.given, req.planes?.distance);
    else {
      const r = detectPlanes(points, { ...req.planes, onProgress: (f, s) => onProgress(f * (req.steps ? 0.7 : 0.9), s) });
      (planes = r.planes), (grid = r.grid), (out.voxel = r.voxel);
    }
  }
  if (req.corners) out.corners = detectCorners(points, planes, { ...req.corners, grid });
  if (req.edges) out.edges = planeEdges(points, planes, req.edges);
  if (req.tops) out.tops = wallTops(points, planes, req.tops);
  if (req.steps) out.steps = stepEdges(points, req.steps.path, { ...req.steps, onProgress: (f) => onProgress((needPlanes ? 0.7 : 0) + f * (needPlanes ? 0.3 : 1), 'profiles') });
  if (needPlanes) out.planes = planes.map(({ inliers, ...p }) => p);
  onProgress(1, 'done');
  return out;
}
