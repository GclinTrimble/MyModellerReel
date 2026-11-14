// Point cloud classification (#298): neighbourhoods on a voxel hash grid, covariance features, statistical outliers,
// a progressive morphological ground filter, height above ground, planar segments, and the rules that turn them into
// ASPRS LAS 1.4 classes. Pure: runs per tile in the cloud worker (src/main/cloud-classify.mjs) and in Node tests.
//
// Neighbourhood API (also used by plane detection #300 and point selection, cloudselect.js). Positions are one
// interleaved array [x0, y0, z0, x1, …] (Float64Array or Float32Array), z up (file axes: x east, y north).
//   voxelGrid(pos, cell, count?)            → grid { pos, count, cell, min, dims, start, order, slot }: the points
//                                             sorted by cell (CSR: cell s holds order[start[s] .. start[s + 1]])
//   neighbours(grid, i, { r } | { k }, out?) → indices (a subarray of out, a Uint32Array) of the points within r of
//                                             point i, or its k nearest; i itself included (it is its own nearest)
//   neighboursAt(grid, x, y, z, opts, out?)  → the same around any spot
//   covarianceFeatures(pos, idx, n?)         → { linearity, planarity, scatter, verticality, normal, direction,
//                                             centroid, eigen: [l1 ≥ l2 ≥ l3], change }: eigen features of the
//                                             3×3 covariance of the points idx[0..n); normal the smallest axis (z ≥ 0),
//                                             direction the largest; verticality 1 − |normal z| (1 on a wall, 0 on a floor)
//   pointFeatures(grid, { r } | { k })       → per point Float32Arrays linearity, planarity, scatter, verticality,
//                                             roughness (√l3, m), normal (×3), direction (×3)
//   growPlane(grid, normal, seed, opts)      → the indices reached from seed over neighbours on the seed's plane
//                                             (normal within angle, distance to the plane within distance)
//   planarSegments(grid, normal, opts)       → Int32Array segment per point (−1 none) and the segments' sizes

const EPS = 1e-12;

// ---------------------------------------------------------------- voxel grid

/** Points sorted into cubic cells of size cell. count defaults to pos.length / 3. */
export function voxelGrid(pos, cell, count = Math.floor(pos.length / 3)) {
  if (!(cell > 0)) throw new Error('voxelGrid: cell must be > 0');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++) {
      const v = pos[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  if (!count) min.fill(0), max.fill(0);
  const dims = min.map((m, k) => Math.floor((max[k] - m) / cell) + 1);
  const map = new Map();
  const slot = new Int32Array(count);
  const counts = [];
  for (let i = 0; i < count; i++) {
    const key = keyOf(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], min, cell, dims);
    let s = map.get(key);
    if (s === undefined) map.set(key, (s = counts.length)), counts.push(0);
    slot[i] = s;
    counts[s]++;
  }
  const start = new Int32Array(counts.length + 1);
  for (let s = 0; s < counts.length; s++) start[s + 1] = start[s] + counts[s];
  const fill = start.slice(0, counts.length);
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[fill[slot[i]]++] = i;
  return { pos, count, cell, min, dims, map, start, order, slot };
}

function keyOf(x, y, z, min, cell, dims) {
  const ix = Math.floor((x - min[0]) / cell);
  const iy = Math.floor((y - min[1]) / cell);
  const iz = Math.floor((z - min[2]) / cell);
  return ix + dims[0] * (iy + dims[1] * iz);
}

const scratch = { d: new Float64Array(1024), i: new Uint32Array(1024) };
const grow = (n) => {
  if (scratch.d.length < n) scratch.d = new Float64Array(n * 2), scratch.i = new Uint32Array(n * 2);
};

/**
 * Indices of the points within r of (x, y, z), or its k nearest (opts { r } or { k }; rmax: give up beyond that
 * distance, returning fewer), into out. max caps a radius search.
 */
export function neighboursAt(g, x, y, z, { r, k, max = 4096, rmax = Infinity } = {}, out = new Uint32Array(Math.max(k || 0, 64))) {
  const { pos, cell, min, dims, map, start, order } = g;
  const cx = Math.floor((x - min[0]) / cell);
  const cy = Math.floor((y - min[1]) / cell);
  const cz = Math.floor((z - min[2]) / cell);
  if (r !== undefined) {
    const s = Math.ceil(r / cell);
    const r2 = r * r;
    let n = 0;
    for (let iz = Math.max(0, cz - s); iz <= Math.min(dims[2] - 1, cz + s); iz++)
      for (let iy = Math.max(0, cy - s); iy <= Math.min(dims[1] - 1, cy + s); iy++)
        for (let ix = Math.max(0, cx - s); ix <= Math.min(dims[0] - 1, cx + s); ix++) {
          const c = map.get(ix + dims[0] * (iy + dims[1] * iz));
          if (c === undefined) continue;
          for (let q = start[c]; q < start[c + 1]; q++) {
            const j = order[q];
            const dx = pos[j * 3] - x;
            const dy = pos[j * 3 + 1] - y;
            const dz = pos[j * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= r2) {
              if (n >= out.length) {
                if (n >= max) return out.subarray(0, n);
                const o2 = new Uint32Array(Math.min(max, out.length * 2));
                o2.set(out);
                out = o2;
              }
              out[n++] = j;
            }
          }
        }
    return out.subarray(0, n);
  }
  // k nearest: shell after shell of cells until the k-th distance is inside what was searched (or past rmax)
  if (out.length < k) out = new Uint32Array(k);
  const reach = Math.max(dims[0], dims[1], dims[2]);
  const face = Math.min(x - min[0] - cx * cell, (cx + 1) * cell - (x - min[0]), y - min[1] - cy * cell, (cy + 1) * cell - (y - min[1]), z - min[2] - cz * cell, (cz + 1) * cell - (z - min[2]));
  let n = 0;
  for (let s = 0; ; s++) {
    for (let iz = Math.max(0, cz - s); iz <= Math.min(dims[2] - 1, cz + s); iz++)
      for (let iy = Math.max(0, cy - s); iy <= Math.min(dims[1] - 1, cy + s); iy++) {
        const rim = Math.abs(iz - cz) === s || Math.abs(iy - cy) === s;
        for (let ix = Math.max(0, cx - s); ix <= Math.min(dims[0] - 1, cx + s); ix += rim || s === 0 ? 1 : 2 * s) {
          if (!rim && ix !== cx - s && ix !== cx + s) continue;
          const c = map.get(ix + dims[0] * (iy + dims[1] * iz));
          if (c === undefined) continue;
          grow(n + start[c + 1] - start[c]);
          for (let q = start[c]; q < start[c + 1]; q++) {
            const j = order[q];
            const dx = pos[j * 3] - x;
            const dy = pos[j * 3 + 1] - y;
            const dz = pos[j * 3 + 2] - z;
            scratch.d[n] = dx * dx + dy * dy + dz * dz;
            scratch.i[n++] = j;
          }
        }
      }
    const last = s >= reach || s * cell > rmax;
    if (n >= k || last) {
      const m = Math.min(k, n);
      selectSmallest(scratch.d, scratch.i, n, m);
      n = m; // the rest can never be among the k nearest
      let worst = 0;
      for (let t = 0; t < m; t++) worst = Math.max(worst, scratch.d[t]);
      if ((m === k && worst <= (s * cell + face) ** 2) || last) {
        out.set(scratch.i.subarray(0, m));
        return out.subarray(0, m);
      }
    }
  }
}

/** Neighbours of point i (itself included). */
export const neighbours = (g, i, opts, out) => neighboursAt(g, g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], opts, out);

/** Move the m smallest of d[0..n) (with their i) to the front (quickselect, unordered). */
function selectSmallest(d, idx, n, m) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi && m > 0 && m < n) {
    const p = d[(lo + hi) >> 1];
    let a = lo;
    let b = hi;
    while (a <= b) {
      while (d[a] < p) a++;
      while (d[b] > p) b--;
      if (a <= b) {
        [d[a], d[b]] = [d[b], d[a]];
        [idx[a], idx[b]] = [idx[b], idx[a]];
        a++;
        b--;
      }
    }
    if (m - 1 <= b) hi = b;
    else if (m - 1 >= a) lo = a;
    else break;
  }
}

// ---------------------------------------------------------------- covariance features

/** Eigenvalues of a symmetric 3×3 (a00, a01, a02, a11, a12, a22), largest first. */
function eigenvalues(a00, a01, a02, a11, a12, a22) {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12;
  if (p1 < EPS * (a00 * a00 + a11 * a11 + a22 * a22 + EPS)) return [a00, a11, a22].sort((x, y) => y - x);
  const q = (a00 + a11 + a22) / 3;
  const p2 = (a00 - q) ** 2 + (a11 - q) ** 2 + (a22 - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const [b00, b11, b22] = [(a00 - q) / p, (a11 - q) / p, (a22 - q) / p];
  const [b01, b02, b12] = [a01 / p, a02 / p, a12 / p];
  const det = b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
  const r = Math.max(-1, Math.min(1, det / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return [e1, 3 * q - e1 - e3, e3];
}

/** The unit eigenvector of eigenvalue l: the longest cross product of two rows of A − lI. */
function eigenvector(a00, a01, a02, a11, a12, a22, l) {
  const r0 = [a00 - l, a01, a02];
  const r1 = [a01, a11 - l, a12];
  const r2 = [a02, a12, a22 - l];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  let best = [0, 0, 1];
  let bn = 0;
  for (const c of [cross(r0, r1), cross(r0, r2), cross(r1, r2)]) {
    const n = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    if (n > bn) (bn = n), (best = c);
  }
  const n = Math.sqrt(bn) || 1;
  return bn ? best.map((v) => v / n) : best;
}

/** Eigen features of the points idx[0..n) of pos. */
export function covarianceFeatures(pos, idx, n = idx.length) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let t = 0; t < n; t++) {
    const j = idx[t] * 3;
    cx += pos[j];
    cy += pos[j + 1];
    cz += pos[j + 2];
  }
  cx /= n || 1;
  cy /= n || 1;
  cz /= n || 1;
  let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0; // prettier-ignore
  for (let t = 0; t < n; t++) {
    const j = idx[t] * 3;
    const dx = pos[j] - cx;
    const dy = pos[j + 1] - cy;
    const dz = pos[j + 2] - cz;
    a00 += dx * dx;
    a01 += dx * dy;
    a02 += dx * dz;
    a11 += dy * dy;
    a12 += dy * dz;
    a22 += dz * dz;
  }
  const m = n || 1;
  [a00, a01, a02, a11, a12, a22] = [a00 / m, a01 / m, a02 / m, a11 / m, a12 / m, a22 / m];
  const [l1, l2, l3] = eigenvalues(a00, a01, a02, a11, a12, a22).map((v) => Math.max(0, v));
  let normal = n >= 3 ? eigenvector(a00, a01, a02, a11, a12, a22, l3) : [0, 0, 1];
  if (normal[2] < 0) normal = normal.map((v) => -v);
  const direction = n >= 2 && l1 > l2 + EPS ? eigenvector(a00, a01, a02, a11, a12, a22, l1) : [1, 0, 0];
  const s = l1 + EPS;
  return {
    linearity: (l1 - l2) / s,
    planarity: (l2 - l3) / s,
    scatter: l3 / s,
    verticality: 1 - Math.abs(normal[2]),
    change: l3 / (l1 + l2 + l3 + EPS),
    normal,
    direction,
    centroid: [cx, cy, cz],
    eigen: [l1, l2, l3],
  };
}

/** Features of every point of a grid over its neighbourhood ({ r } or { k }); onProgress(fraction) now and then. */
export function pointFeatures(g, opts = { k: 12 }, onProgress = null, only = null) {
  const n = g.count;
  const f = { linearity: new Float32Array(n), planarity: new Float32Array(n), scatter: new Float32Array(n), verticality: new Float32Array(n), roughness: new Float32Array(n), normal: new Float32Array(n * 3), direction: new Float32Array(n * 3), neighbours: new Uint16Array(n) };
  let out = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    if (only && !only[i]) continue;
    const nb = neighbours(g, i, opts, out);
    if (nb.buffer !== out.buffer) out = new Uint32Array(nb.buffer);
    f.neighbours[i] = Math.min(65535, nb.length);
    if (nb.length < 3) continue;
    const c = covarianceFeatures(g.pos, nb);
    f.linearity[i] = c.linearity;
    f.planarity[i] = c.planarity;
    f.scatter[i] = c.scatter;
    f.verticality[i] = c.verticality;
    f.roughness[i] = Math.sqrt(c.eigen[2]);
    f.normal.set(c.normal, i * 3);
    f.direction.set(c.direction, i * 3);
    if (onProgress && (i & 0xffff) === 0) onProgress(i / n);
  }
  return f;
}

// ---------------------------------------------------------------- planes

/**
 * The points reached from seed over neighbours within radius (default 2 cells) that lie on the seed's plane: normal
 * within angle (degrees, default 12) of the seed's, and within distance (m, default 0.08) of its plane. A wall grows to
 * its corners and stops there. allowed(i) narrows it; normal is the Float32Array from pointFeatures.
 */
export function growPlane(g, normal, seed, { angle = 12, distance = 0.08, radius = 2 * g.cell, allowed = null, taken = null, max = Infinity } = {}) {
  const cos = Math.cos((angle * Math.PI) / 180);
  const [nx, ny, nz] = [normal[seed * 3], normal[seed * 3 + 1], normal[seed * 3 + 2]];
  const p = g.pos;
  const d0 = nx * p[seed * 3] + ny * p[seed * 3 + 1] + nz * p[seed * 3 + 2];
  const seen = taken || new Uint8Array(g.count);
  const out = [seed];
  seen[seed] = 1;
  let buf = new Uint32Array(256);
  for (let h = 0; h < out.length && out.length < max; h++) {
    const nb = neighbours(g, out[h], { r: radius }, buf);
    if (nb.buffer !== buf.buffer) buf = new Uint32Array(nb.buffer);
    for (let t = 0; t < nb.length; t++) {
      const j = nb[t];
      if (seen[j] || (allowed && !allowed(j))) continue;
      const dot = Math.abs(nx * normal[j * 3] + ny * normal[j * 3 + 1] + nz * normal[j * 3 + 2]);
      if (dot < cos) continue;
      if (Math.abs(nx * p[j * 3] + ny * p[j * 3 + 1] + nz * p[j * 3 + 2] - d0) > distance) continue;
      seen[j] = 1;
      out.push(j);
    }
  }
  return out;
}

/**
 * Planar segments: seeds in order of flatness (lowest scatter first), each grown with growPlane; segments under
 * minPoints are dropped. Returns { segment: Int32Array (−1 none), sizes: [points per segment] }.
 */
export function planarSegments(g, f, { angle = 12, distance = 0.08, radius, minPoints = 30, maxScatter = 0.02, allowed = null } = {}) {
  const n = g.count;
  const segment = new Int32Array(n).fill(-1);
  const taken = new Uint8Array(n);
  const seeds = [];
  for (let i = 0; i < n; i++) if (f.neighbours[i] >= 3 && f.scatter[i] <= maxScatter && (!allowed || allowed(i))) seeds.push(i);
  seeds.sort((a, b) => f.scatter[a] - f.scatter[b]);
  const sizes = [];
  for (const s of seeds) {
    if (taken[s]) continue;
    const pts = growPlane(g, f.normal, s, { angle, distance, radius, allowed, taken });
    if (pts.length < minPoints) {
      for (const j of pts) taken[j] = j === s ? 1 : 0; // others may still join a better plane
      continue;
    }
    const id = sizes.length;
    for (const j of pts) segment[j] = id;
    sizes.push(pts.length);
  }
  return { segment, sizes };
}

// ---------------------------------------------------------------- classes and parameters

/** ASPRS LAS 1.4 R15 codes the passes write, and the user classes 64+ the document starts with. */
export const ASPRS = { unclassified: 1, ground: 2, lowVegetation: 3, mediumVegetation: 4, highVegetation: 5, building: 6, lowNoise: 7, wire: 14, tower: 15, road: 11, highNoise: 18 };
export const USER_CLASSES = { 64: ['Kerb', '#e8c547'], 65: ['Vehicle', '#4fb3d9'] };
export const STEPS = ['noise', 'ground', 'vegetation', 'buildings', 'road', 'wires'];
export const DEFAULT_STEPS = ['noise', 'ground', 'vegetation', 'buildings'];
/** The classes each step owns: a point holding one that the step no longer finds goes back to 1. */
export const OWNS = { noise: [7, 18], ground: [2], vegetation: [3, 4, 5], buildings: [6], road: [11], wires: [14, 15] };
export const PARAMS = {
  noise: { min_points: 4, ratio: 0.15 }, // points in a 3 × 3 × 3 block of cells (2 spacings each)
  ground: { method: 'pmf', cell: 1, max_window: 20, slope: 0.3, dh0: 0.3, dh_max: 2.5, tolerance: 0.25 },
  vegetation: { bands: [0.5, 2], min_height: 0.15 },
  buildings: { min_height: 2.5, min_area: 4, angle: 10, distance: 0.1 },
  road: { intensity: null, roughness: 0.03, kerb_class: 64, kerb: [0.07, 0.3] },
  wires: { min_height: 3, linearity: 0.85 },
};
export const paramsOf = (p = {}) => Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, { ...v, ...(p[k] || {}) }]));

// ---------------------------------------------------------------- noise

/**
 * Outliers by local density: the points in a point's block of 3 × 3 × 3 voxel cells. A point is noise when its block
 * holds fewer than min_points, or under ratio × the median block of the cloud (a bird, a multipath echo, a speck far
 * below the ground). Counted per cell, so it costs about the same for 50 M points as reading them. Returns a Uint8Array
 * flag per point and the typical spacing (the cell over the cube root of the median block).
 */
export function outliers(g, { min_points = 4, ratio = 0.15 } = {}) {
  const { dims, map, start } = g;
  const cells = start.length - 1;
  const coord = new Int32Array(cells * 3);
  for (const [key, c] of map) {
    const ix = key % dims[0];
    const r = (key - ix) / dims[0];
    const iy = r % dims[1];
    coord.set([ix, iy, (r - iy) / dims[1]], c * 3);
  }
  const block = new Uint32Array(cells);
  for (let c = 0; c < cells; c++) {
    const [x, y, z] = [coord[c * 3], coord[c * 3 + 1], coord[c * 3 + 2]];
    let sum = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [a, b, e] = [x + dx, y + dy, z + dz];
          if (a < 0 || b < 0 || e < 0 || a >= dims[0] || b >= dims[1] || e >= dims[2]) continue;
          const o = map.get(a + dims[0] * (b + dims[1] * e));
          if (o !== undefined) sum += start[o + 1] - start[o];
        }
    block[c] = sum;
  }
  const sample = [];
  for (let i = 0; i < g.count; i += Math.max(1, Math.floor(g.count / 20000))) sample.push(block[g.slot[i]]);
  sample.sort((a, b) => a - b);
  const median = sample[sample.length >> 1] || 0;
  const limit = Math.max(min_points, ratio * median);
  const flag = new Uint8Array(g.count);
  for (let i = 0; i < g.count; i++) if (block[g.slot[i]] < limit) flag[i] = 1;
  // points per cell on a surface go as (cell / spacing)²: 27 cells of a block see about 9 of them
  return { flag, spacing: g.cell / Math.sqrt(Math.max(1, median / 9)) };
}

// ---------------------------------------------------------------- ground

/** A 2D grid over the points' x, y: { x0, y0, cell, nx, ny, at(x, y) → cell index }. */
export function grid2(pos, n, cell, use) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    if (use && !use(i)) continue;
    const [x, y] = [pos[i * 3], pos[i * 3 + 1]];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (x0 === Infinity) [x0, y0, x1, y1] = [0, 0, 0, 0];
  const nx = Math.floor((x1 - x0) / cell) + 1;
  const ny = Math.floor((y1 - y0) / cell) + 1;
  return { x0, y0, cell, nx, ny, at: (x, y) => Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / cell))) * nx + Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell))) };
}

/** Empty cells (NaN) take the value of the nearest filled one (breadth first). */
function fill(z, nx, ny) {
  const q = [];
  for (let c = 0; c < z.length; c++) if (!Number.isNaN(z[c])) q.push(c);
  if (!q.length) return z.fill(0);
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const [x, y] = [c % nx, (c / nx) | 0];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [a, b] = [x + dx, y + dy];
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const d = b * nx + a;
      if (Number.isNaN(z[d])) (z[d] = z[c]), q.push(d);
    }
  }
  return z;
}

/** A square min (or max) filter of half-width h cells, separable. */
function filter(z, nx, ny, h, max) {
  const t = new Float64Array(z.length);
  const out = new Float64Array(z.length);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let v = z[y * nx + x];
      for (let a = Math.max(0, x - h); a <= Math.min(nx - 1, x + h); a++) {
        const w = z[y * nx + a];
        if (max ? w > v : w < v) v = w;
      }
      t[y * nx + x] = v;
    }
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let v = t[y * nx + x];
      for (let b = Math.max(0, y - h); b <= Math.min(ny - 1, y + h); b++) {
        const w = t[b * nx + x];
        if (max ? w > v : w < v) v = w;
      }
      out[y * nx + x] = v;
    }
  return out;
}

/** Bilinear height of a grid of cell values (at cell centres) at x, y. */
export function sampleGrid(G, z, x, y) {
  if (G.nx < 2 || G.ny < 2) return z[G.at(x, y)];
  const fx = Math.min(G.nx - 1, Math.max(0, (x - G.x0) / G.cell - 0.5));
  const fy = Math.min(G.ny - 1, Math.max(0, (y - G.y0) / G.cell - 0.5));
  const [ix, iy] = [Math.min(G.nx - 2, Math.floor(fx)), Math.min(G.ny - 2, Math.floor(fy))];
  const [u, v] = [fx - ix, fy - iy];
  const c = iy * G.nx + ix;
  return (z[c] * (1 - u) + z[c + 1] * u) * (1 - v) + (z[c + G.nx] * (1 - u) + z[c + G.nx + 1] * u) * v;
}

/**
 * Ground by a progressive morphological filter (Zhang et al. 2003) on the lowest point per cell: openings with windows
 * of 3, 5, 9, 17… cells up to max_window metres take away what stands up more than a threshold growing with slope and
 * window (buildings, trees, cars); embankments, cuts and ditches stay. A point is ground within tolerance of that
 * surface, plus the local slope over a cell. use(i): the points to look at. Returns { ground, grid, surface }.
 */
export function groundPoints(pos, n, p = PARAMS.ground, use = null) {
  const G = grid2(pos, n, p.cell, use);
  const zmin = new Float64Array(G.nx * G.ny).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (use && !use(i)) continue;
    const c = G.at(pos[i * 3], pos[i * 3 + 1]);
    if (!(zmin[c] <= pos[i * 3 + 2])) zmin[c] = pos[i * 3 + 2];
  }
  const empty = zmin.map((v) => (Number.isNaN(v) ? 1 : 0));
  fill(zmin, G.nx, G.ny);
  let z = zmin.slice();
  const off = new Uint8Array(z.length);
  let prev = 1;
  for (let w = 3; (w - 2) * p.cell <= p.max_window; w = 2 * w - 1) {
    const h = (w - 1) >> 1;
    const open = filter(filter(z, G.nx, G.ny, h, false), G.nx, G.ny, h, true);
    const dh = Math.min(p.dh_max, p.dh0 + p.slope * (w - prev) * p.cell);
    for (let c = 0; c < z.length; c++) if (z[c] - open[c] > dh) off[c] = 1;
    z = open;
    prev = w;
  }
  const surf = new Float64Array(zmin.length).fill(NaN);
  for (let c = 0; c < z.length; c++) if (!off[c] && !empty[c]) surf[c] = zmin[c];
  fill(surf, G.nx, G.ny);
  const slope = new Float64Array(surf.length);
  for (let y = 0; y < G.ny; y++)
    for (let x = 0; x < G.nx; x++) {
      const gx = (surf[y * G.nx + Math.min(G.nx - 1, x + 1)] - surf[y * G.nx + Math.max(0, x - 1)]) / 2;
      const gy = (surf[Math.min(G.ny - 1, y + 1) * G.nx + x] - surf[Math.max(0, y - 1) * G.nx + x]) / 2;
      slope[y * G.nx + x] = Math.min(2 * p.cell, Math.hypot(gx, gy));
    }
  const ground = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (use && !use(i)) continue;
    const [x, y] = [pos[i * 3], pos[i * 3 + 1]];
    const d = pos[i * 3 + 2] - sampleGrid(G, surf, x, y);
    const tol = p.tolerance + slope[G.at(x, y)];
    if (d <= tol && d >= -tol - 0.5) ground[i] = 1;
  }
  return { ground, grid: G, surface: surf };
}

/** Height above ground of every point: the ground points' lowest per cell (holes filled), bilinear. */
export function heightAboveGround(pos, n, isGround, cell = 1) {
  const G = grid2(pos, n, cell);
  const z = new Float64Array(G.nx * G.ny).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!isGround(i)) continue;
    const c = G.at(pos[i * 3], pos[i * 3 + 1]);
    if (!(z[c] <= pos[i * 3 + 2])) z[c] = pos[i * 3 + 2];
  }
  fill(z, G.nx, G.ny);
  const hag = new Float32Array(n);
  for (let i = 0; i < n; i++) hag[i] = pos[i * 3 + 2] - sampleGrid(G, z, pos[i * 3], pos[i * 3 + 1]);
  return hag;
}

/** Otsu's threshold of values (a 256-bin histogram over their range). */
export function otsu(values) {
  let [lo, hi] = [Infinity, -Infinity];
  for (const v of values) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  if (!(hi > lo)) return lo;
  const bins = new Float64Array(256);
  for (const v of values) bins[Math.min(255, Math.floor(((v - lo) / (hi - lo)) * 256))]++;
  const total = values.length;
  let sum = 0;
  for (let b = 0; b < 256; b++) sum += b * bins[b];
  let [wB, sB, best, at] = [0, 0, -1, 0];
  for (let b = 0; b < 256; b++) {
    wB += bins[b];
    if (!wB || wB === total) continue;
    sB += b * bins[b];
    const [mB, mF] = [sB / wB, (sum - sB) / (total - wB)];
    const between = wB * (total - wB) * (mB - mF) ** 2;
    if (between > best) (best = between), (at = b);
  }
  return lo + ((at + 1) / 256) * (hi - lo);
}

// ---------------------------------------------------------------- the passes

/**
 * Classify points. input: { count, pos (interleaved x, y, z), classification (current classes), intensity? }.
 * opts: { steps, params, writable (Uint8Array: 1 where a class may change; default all), onProgress(fraction, stage) }.
 * Returns { classes (a new Uint8Array, unchanged where not writable), changed, spacing }.
 */
export function classifyPoints(input, { steps = DEFAULT_STEPS, params = {}, writable = null, onProgress = () => {} } = {}) {
  const P = paramsOf(params);
  const n = input.count;
  const pos = input.pos;
  const cur = input.classification || new Uint8Array(n).fill(1);
  const on = new Set(steps);
  const found = new Uint8Array(n); // 0: nothing found this run
  const set = (i, c) => (found[i] = c);
  // the neighbourhood scale from the density over the footprint
  const G0 = grid2(pos, n, 1);
  let filled = 0;
  const seen = new Uint8Array(G0.nx * G0.ny);
  for (let i = 0; i < n; i++) {
    const c = G0.at(pos[i * 3], pos[i * 3 + 1]);
    if (!seen[c]) (seen[c] = 1), filled++;
  }
  const spacingGuess = Math.max(0.02, Math.sqrt(filled / Math.max(1, n)));
  const g = voxelGrid(pos, Math.max(0.05, 2 * spacingGuess), n);
  onProgress(0.05, 'noise');

  let noise = new Uint8Array(n);
  let spacing = spacingGuess;
  if (on.has('noise')) ({ flag: noise, spacing } = outliers(g, P.noise));
  else for (let i = 0; i < n; i++) noise[i] = cur[i] === 7 || cur[i] === 18 ? 1 : 0;
  onProgress(0.2, 'ground');

  let ground;
  if (on.has('ground')) ground = groundPoints(pos, n, P.ground, (i) => !noise[i]).ground;
  else ground = Uint8Array.from(cur, (c) => (c === 2 || c === 11 || c === P.road.kerb_class ? 1 : 0));
  const hasGround = ground.some((v) => v);
  const hag = hasGround ? heightAboveGround(pos, n, (i) => ground[i] && !noise[i], P.ground.cell) : new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (noise[i]) on.has('noise') && set(i, hag[i] < 0 ? 7 : 18);
    else if (ground[i] && on.has('ground')) set(i, 2);
  }
  onProgress(0.35, 'features');

  // above-ground points: features, planes, buildings, wires, vegetation
  const above = (i) => !noise[i] && !ground[i] && hag[i] > P.vegetation.min_height;
  const building = new Uint8Array(n);
  const planar = new Uint8Array(n);
  let f = null;
  let buf = new Uint32Array(64);
  const near = (i, r) => {
    const nb = neighbours(g, i, { r }, buf);
    if (nb.buffer !== buf.buffer) buf = new Uint32Array(nb.buffer);
    return nb;
  };
  if (on.has('buildings') || on.has('vegetation') || on.has('wires')) {
    const mask = Uint8Array.from({ length: n }, (_, i) => (above(i) ? 1 : 0));
    f = pointFeatures(g, { k: 12 }, (t) => onProgress(0.35 + 0.25 * t, 'features'), mask);
    onProgress(0.6, 'planes');
    const B = P.buildings;
    const minPts = Math.max(20, Math.round(B.min_area / (spacing * spacing || 1) / 2));
    const seg = planarSegments(g, f, { angle: B.angle, distance: B.distance, radius: 1.5 * g.cell, minPoints: minPts, maxScatter: 0.01, allowed: (i) => mask[i] === 1 });
    // segments that touch form clusters; a cluster is a building when it is wide and reaches min_height
    const parent = Int32Array.from({ length: seg.sizes.length }, (_, i) => i);
    const root = (a) => (parent[a] === a ? a : (parent[a] = root(parent[a])));
    // segments in the same voxel cell or touching cells join (a roof and its walls)
    const first = new Int32Array(g.start.length - 1).fill(-1);
    for (let i = 0; i < n; i++) {
      const s = seg.segment[i];
      if (s < 0) continue;
      const c = g.slot[i];
      if (first[c] < 0) first[c] = s;
      else parent[root(s)] = root(first[c]);
    }
    for (const [key, c] of g.map) {
      if (first[c] < 0) continue;
      for (const d of [1, g.dims[0], g.dims[0] * g.dims[1], 1 + g.dims[0], 1 - g.dims[0], g.dims[0] * g.dims[1] + 1, g.dims[0] * g.dims[1] - 1, g.dims[0] * g.dims[1] + g.dims[0], g.dims[0] * g.dims[1] - g.dims[0]]) {
        const o = g.map.get(key + d);
        if (o !== undefined && first[o] >= 0) parent[root(first[o])] = root(first[c]);
      }
    }
    const box = new Map();
    for (let i = 0; i < n; i++) {
      const s = seg.segment[i];
      if (s < 0) continue;
      planar[i] = 1;
      const c = root(s);
      let b = box.get(c);
      if (!b) box.set(c, (b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, top: -Infinity }));
      b.x0 = Math.min(b.x0, pos[i * 3]);
      b.x1 = Math.max(b.x1, pos[i * 3]);
      b.y0 = Math.min(b.y0, pos[i * 3 + 1]);
      b.y1 = Math.max(b.y1, pos[i * 3 + 1]);
      b.top = Math.max(b.top, hag[i]);
    }
    const isB = new Set([...box].filter(([, b]) => b.top >= B.min_height && Math.max(b.x1 - b.x0, b.y1 - b.y0) >= Math.sqrt(B.min_area)).map(([c]) => c));
    for (let i = 0; i < n; i++) if (seg.segment[i] >= 0 && isB.has(root(seg.segment[i]))) building[i] = 1;
    // roof edges and wall corners left out of the planes: mostly building around them
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let i = 0; i < n; i++) {
        if (!mask[i] || building[i] || planar[i]) continue;
        const nb = near(i, g.cell);
        let b = 0;
        for (const j of nb) b += building[j];
        if (b * 2 > nb.length) add.push(i);
      }
      for (const i of add) building[i] = 1;
    }
    if (on.has('buildings')) for (let i = 0; i < n; i++) if (building[i]) set(i, 6);
  }
  onProgress(0.8, 'vegetation');

  if (on.has('wires') && f) {
    const W = P.wires;
    for (let i = 0; i < n; i++) {
      if (!above(i) || building[i] || hag[i] < W.min_height || f.linearity[i] < W.linearity) continue;
      const dz = Math.abs(f.direction[i * 3 + 2]);
      if (dz < 0.4) set(i, 14);
      else if (dz > 0.9) set(i, 15);
    }
  }
  if (on.has('vegetation')) {
    const [b1, b2] = P.vegetation.bands;
    for (let i = 0; i < n; i++) if (above(i) && !building[i] && !planar[i] && !found[i]) set(i, hag[i] < b1 ? 3 : hag[i] < b2 ? 4 : 5);
  }
  if (on.has('road') && hasGround) roadAndKerbs(input, ground, noise, P.road, set);
  onProgress(0.95, 'writing');

  // what this run writes: what it found; a point in a class the run owns that it no longer finds goes back to 1
  const owned = new Set(steps.flatMap((s) => OWNS[s] || []));
  if (on.has('road')) owned.add(P.road.kerb_class);
  const classes = Uint8Array.from(cur);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (writable && !writable[i]) continue;
    let c = found[i] || (owned.has(cur[i]) ? 1 : cur[i]);
    if (c === 2 && !on.has('road') && (cur[i] === 11 || cur[i] === P.road.kerb_class)) c = cur[i]; // road and kerbs are ground too
    if (c !== cur[i]) (classes[i] = c), changed++;
  }
  onProgress(1, 'done');
  return { classes, changed, spacing };
}

/**
 * Road surface (11) and kerbs (kerb_class), from the ground points on two grids. Kerbs: on 0.25 m cells of mean ground
 * height, a step of kerb height between two cells with level ground on both sides (a slope rises cell after cell, a
 * kerb at once). Road: on 0.5 m cells, mostly of the asphalt's intensity (the darker Otsu class of the ground, or
 * intensity [lo, hi]) and smooth (the residual of a plane through the cell under roughness).
 */
function roadAndKerbs(input, ground, noise, R, set) {
  const n = input.count;
  const pos = input.pos;
  const ids = [];
  for (let i = 0; i < n; i++) if (ground[i] && !noise[i]) ids.push(i);
  if (!ids.length) return;
  const use = (i) => ground[i] && !noise[i];
  const K = grid2(pos, n, 0.25, use);
  const zs = new Float64Array(K.nx * K.ny);
  const cn = new Uint32Array(K.nx * K.ny);
  for (const i of ids) {
    const c = K.at(pos[i * 3], pos[i * 3 + 1]);
    zs[c] += pos[i * 3 + 2];
    cn[c]++;
  }
  const z = (x, y) => (x < 0 || y < 0 || x >= K.nx || y >= K.ny || !cn[y * K.nx + x] ? NaN : zs[y * K.nx + x] / cn[y * K.nx + x]);
  const kerbCell = new Uint8Array(K.nx * K.ny);
  const flat = R.kerb[0] / 2;
  for (let y = 0; y < K.ny; y++)
    for (let x = 0; x < K.nx; x++) {
      if (!cn[y * K.nx + x]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const step = Math.abs(z(x + dx, y + dy) - z(x, y));
        if (!(step >= R.kerb[0] && step <= R.kerb[1])) continue;
        if (!(Math.abs(z(x, y) - z(x - dx, y - dy)) < flat) || !(Math.abs(z(x + 2 * dx, y + 2 * dy) - z(x + dx, y + dy)) < flat)) continue;
        kerbCell[y * K.nx + x] = 1;
        kerbCell[(y + dy) * K.nx + x + dx] = 1;
      }
    }
  const inten = input.intensity;
  const band = R.intensity || (inten ? [0, otsu(ids.filter((_, k) => k % 7 === 0).map((i) => inten[i]))] : null);
  let roadCell = null;
  const Rg = grid2(pos, n, 0.5, use);
  if (band) {
    // per cell: dark points, and the sums of a least-squares plane z = a x + b y + c about the cell's first point
    const S = new Float64Array(Rg.nx * Rg.ny * 11);
    for (const i of ids) {
      const c = Rg.at(pos[i * 3], pos[i * 3 + 1]);
      const o = c * 11;
      if (!S[o]) (S[o + 9] = pos[i * 3]), (S[o + 10] = pos[i * 3 + 1]);
      const [x, y, w] = [pos[i * 3] - S[o + 9], pos[i * 3 + 1] - S[o + 10], pos[i * 3 + 2]];
      S[o]++;
      if (inten[i] >= band[0] && inten[i] <= band[1]) S[o + 1]++;
      S[o + 2] += x * x;
      S[o + 3] += x * y;
      S[o + 4] += y * y;
      S[o + 5] += x;
      S[o + 6] += y;
      S[o + 7] += w;
      S[o + 8] += w * w;
    }
    // the residual needs Σxz and Σyz too: a second pass, the plane solved per cell
    const XZ = new Float64Array(Rg.nx * Rg.ny * 2);
    for (const i of ids) {
      const c = Rg.at(pos[i * 3], pos[i * 3 + 1]);
      const o = c * 11;
      XZ[c * 2] += (pos[i * 3] - S[o + 9]) * pos[i * 3 + 2];
      XZ[c * 2 + 1] += (pos[i * 3 + 1] - S[o + 10]) * pos[i * 3 + 2];
    }
    roadCell = new Uint8Array(Rg.nx * Rg.ny);
    for (let c = 0; c < roadCell.length; c++) {
      const o = c * 11;
      const m = S[o];
      if (m < 4 || S[o + 1] < 0.6 * m) continue;
      // normal equations [Sxx Sxy Sx; Sxy Syy Sy; Sx Sy n] [a b c] = [Sxz Syz Sz]
      const A = [[S[o + 2], S[o + 3], S[o + 5]], [S[o + 3], S[o + 4], S[o + 6]], [S[o + 5], S[o + 6], m]];
      const r = [XZ[c * 2], XZ[c * 2 + 1], S[o + 7]];
      const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const D = det(A);
      if (Math.abs(D) < 1e-12) continue;
      const sol = [0, 1, 2].map((k) => det(A.map((row, j) => row.map((v, q) => (q === k ? r[j] : v)))) / D);
      const resid = (S[o + 8] - (sol[0] * r[0] + sol[1] * r[1] + sol[2] * r[2])) / m;
      if (Math.sqrt(Math.max(0, resid)) <= R.roughness) roadCell[c] = 1;
    }
  }
  for (const i of ids) {
    const [x, y] = [pos[i * 3], pos[i * 3 + 1]];
    if (kerbCell[K.at(x, y)]) set(i, R.kerb_class);
    else if (roadCell?.[Rg.at(x, y)] && inten[i] >= band[0] && inten[i] <= band[1]) set(i, 11);
  }
}
