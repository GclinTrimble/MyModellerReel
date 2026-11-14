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

/** Indices of the points within r of (x, y, z), or its k nearest (opts { r } or { k }), into out. */
export function neighboursAt(g, x, y, z, { r, k, max = 4096 } = {}, out = new Uint32Array(Math.max(k || 0, 64))) {
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
  // k nearest: shells of cells until the k-th distance is inside the searched cube
  if (out.length < k) out = new Uint32Array(k);
  const reach = Math.max(dims[0], dims[1], dims[2]);
  for (let s = 1; ; s++) {
    let n = 0;
    for (let iz = Math.max(0, cz - s); iz <= Math.min(dims[2] - 1, cz + s); iz++)
      for (let iy = Math.max(0, cy - s); iy <= Math.min(dims[1] - 1, cy + s); iy++)
        for (let ix = Math.max(0, cx - s); ix <= Math.min(dims[0] - 1, cx + s); ix++) {
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
    // the cube of half-side s cells holds every point nearer than s cells plus the query's distance to its cell's faces
    const safe = (s * cell + Math.min(x - min[0] - cx * cell, (cx + 1) * cell - (x - min[0]), y - min[1] - cy * cell, (cy + 1) * cell - (y - min[1]), z - min[2] - cz * cell, (cz + 1) * cell - (z - min[2]))) ** 2;
    if (n >= k || s > reach) {
      const m = Math.min(k, n);
      selectSmallest(scratch.d, scratch.i, n, m);
      let worst = 0;
      for (let t = 0; t < m; t++) worst = Math.max(worst, scratch.d[t]);
      if (worst <= safe || s > reach) {
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
