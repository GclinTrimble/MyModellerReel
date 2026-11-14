// describe_cloud (#302): one compact summary of a point cloud from its thinned preview (a uniform sample of the whole
// cloud), so an AI starts from numbers instead of points: bounds, density, classes, likely ground and floor levels,
// dominant wall directions. Pure; positions are model space (x east, y up, z south).
import { className } from './cloudstyle.js';

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

/** Model → project (east, north, elevation) with the project base point. */
const toProject = (p, base = [0, 0, 0]) => [base[0] + p[0], base[1] - p[2], base[2] + p[1]];

/**
 * d: { count, position (Float32 x, y, z), classification? } a decoded preview; opts: { matrix (16, column-major: local →
 * model), full (points in the whole cloud), base ([E, N, Z] project base point), keep(x, y, z, i) (only these points) }.
 */
export function describeCloud(d, { matrix = null, full = d.count, base = [0, 0, 0], keep = null } = {}) {
  const p = d.position;
  const m = matrix;
  const n0 = d.count;
  const xs = new Float32Array(n0);
  const ys = new Float32Array(n0);
  const zs = new Float32Array(n0);
  const idx = new Uint32Array(n0);
  let n = 0;
  for (let i = 0; i < n0; i++) {
    let [x, y, z] = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
    if (m) [x, y, z] = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    if (keep && !keep(x, y, z, i)) continue;
    (xs[n] = x), (ys[n] = y), (zs[n] = z), (idx[n++] = i);
  }
  const scale = n0 ? full / n0 : 0; // one preview point stands for this many
  const out = { points: Math.round(n * scale), preview_points: n };
  if (!n) return { ...out, bounds: null };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    [xs[i], ys[i], zs[i]].forEach((v, k) => {
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    });
  const pa = toProject(min, base);
  const pb = toProject(max, base);
  out.bounds = {
    model: { min: min.map(r3), max: max.map(r3) },
    project: { min: [pa[0], pb[1], pa[2]].map(r3), max: [pb[0], pa[1], pb[2]].map(r3) }, // north runs against z
  };
  out.size = max.map((v, k) => r2(v - min[k]));

  // plan cells: occupied area (density) and the lowest point per 2 m cell (the ground)
  const cells = (size) => {
    const nz = Math.floor((max[2] - min[2]) / size) + 1;
    const key = (i) => Math.floor((xs[i] - min[0]) / size) * nz + Math.floor((zs[i] - min[2]) / size);
    return { nz, key };
  };
  const c1 = cells(1);
  const occupied = new Set();
  for (let i = 0; i < n; i++) occupied.add(c1.key(i));
  out.density = r2(out.points / occupied.size); // points / m² over the ground the scan covers
  const c2 = cells(2);
  const low = new Map();
  for (let i = 0; i < n; i++) {
    const k = c2.key(i);
    if (!(low.get(k) <= ys[i])) low.set(k, ys[i]);
  }
  const lows = Float32Array.from(low.values()).sort();
  const q = (t) => r2(lows[Math.min(lows.length - 1, Math.floor(t * lows.length))] + base[2]);
  out.ground = { low: q(0.02), median: q(0.5), high: q(0.98) };

  // classes, scaled to the whole cloud
  if (d.classification) {
    const counts = new Map();
    for (let i = 0; i < n; i++) counts.set(d.classification[idx[i]], (counts.get(d.classification[idx[i]]) || 0) + 1);
    out.classes = [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([code, c]) => ({ code, name: className(code), points: Math.round(c * scale), share: r2((100 * c) / n) }));
  }
  out.levels = levels(ys, n, base[2]);
  out.walls = walls(xs, ys, zs, n, min, max);
  return out;
}

/** Peaks of the height histogram (10 cm bins): flat floors, roofs, flat ground. { elevation, share % }, biggest first. */
function levels(ys, n, z0) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) (lo = Math.min(lo, ys[i])), (hi = Math.max(hi, ys[i]));
  const step = Math.max(0.1, (hi - lo) / 4000);
  const bins = Math.floor((hi - lo) / step) + 1;
  const h = new Float64Array(bins);
  for (let i = 0; i < n; i++) h[Math.floor((ys[i] - lo) / step)]++;
  const s = h.map((_, i) => (h[i - 1] || 0) + 2 * h[i] + (h[i + 1] || 0)); // [1 2 1] smoothing
  const w = Math.max(1, Math.round(0.5 / step)); // a peak is the highest within 0.5 m
  const peaks = [];
  for (let i = 0; i < bins; i++) {
    if (s[i] < 0.02 * 4 * n) continue; // at least 2 % of the points
    let top = true;
    for (let j = Math.max(0, i - w); j <= Math.min(bins - 1, i + w) && top; j++) if (s[j] > s[i] || (s[j] === s[i] && j < i)) top = false;
    if (top) peaks.push({ elevation: r2(lo + (i + 0.5) * step + z0), share: r2((100 * (h[i - 1] || 0) + 100 * h[i] + 100 * (h[i + 1] || 0)) / n) });
  }
  return peaks.sort((a, b) => b.share - a.share).slice(0, 6);
}

/**
 * Dominant wall directions: 0.5 m plan cells whose points span over 1 m of height, then the line through their
 * neighbours within 1.5 m (a 2D principal direction; trees and roof edges are blobs, walls are lines). Bearings in
 * degrees east of north, 0–180, with the share of wall cells along each.
 */
function walls(xs, ys, zs, n, min, max) {
  const size = 0.5;
  const nz = Math.floor((max[2] - min[2]) / size) + 1;
  const lo = new Map();
  const hi = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor((xs[i] - min[0]) / size) * nz + Math.floor((zs[i] - min[2]) / size);
    if (!(lo.get(k) <= ys[i])) lo.set(k, ys[i]);
    if (!(hi.get(k) >= ys[i])) hi.set(k, ys[i]);
  }
  const tall = new Set([...lo.keys()].filter((k) => hi.get(k) - lo.get(k) > 1));
  const hist = new Float64Array(36); // 5° bins
  let lines = 0;
  for (const k of tall) {
    const [cx, cz] = [Math.floor(k / nz), k % nz];
    let [sx, sz, sxx, szz, sxz, c] = [0, 0, 0, 0, 0, 0];
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++)
        if (dx * dx + dz * dz <= 9 && tall.has((cx + dx) * nz + cz + dz)) (sx += dx), (sz += dz), (sxx += dx * dx), (szz += dz * dz), (sxz += dx * dz), c++;
    if (c < 5) continue;
    const [a, b, e] = [sxx / c - (sx / c) ** 2, szz / c - (sz / c) ** 2, sxz / c - (sx * sz) / c ** 2];
    const tr = (a + b) / 2;
    const d = Math.sqrt(((a - b) / 2) ** 2 + e * e);
    if (tr - d > (tr + d) / 6) continue; // not a line
    const ang = 0.5 * Math.atan2(2 * e, a - b); // major axis from +x towards +z
    const bearing = ((((Math.atan2(Math.cos(ang), -Math.sin(ang)) * 180) / Math.PI) % 180) + 180) % 180; // east = cos, north = −(+z)
    hist[Math.floor(bearing / 5 + 0.5) % 36]++;
    lines++;
  }
  if (!lines) return [];
  const out = [];
  const used = new Set();
  for (const i of [...hist.keys()].sort((x, y) => hist[y] - hist[x])) {
    if (hist[i] < 0.1 * lines || out.length >= 4) break;
    if ([-2, -1, 1, 2].some((o) => used.has((i + o + 36) % 36))) continue;
    used.add(i);
    out.push({ bearing: i * 5, share: r2((100 * hist[i]) / lines) });
  }
  return out;
}
