// Scan to plan (#301): building footprints, wall lines in a slice and civil edges turned into clean, regular drafting
// with a quality report. Pure, Node-tested on the synthetic scan (tests/extract.test.js).
// Plan points are [x, n] (n north = the model's −z, the frame of drafting.js); 3D points are model [x, y up, z south],
// flat arrays [x, y, z, …] like cloudfeatures.js.
import * as DR from './drafting.js';
import { triangulate } from './terrain.js';
import { insidePolygon } from './topology.js';

const D2R = Math.PI / 180;
const r3 = (x) => Math.round(x * 1e3) / 1e3 || 0;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dirOf = (t) => [Math.cos(t), Math.sin(t)];

/** A seeded random number generator (mulberry32): the same scan gives the same lines. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Signed area of a plan ring (counter-clockwise > 0). */
export const area = (ring) => ring.reduce((s, p, i) => s + cross(p, ring[(i + 1) % ring.length]), 0) / 2;
/** The area centroid of a plan ring. */
export function centroid(ring) {
  const A = area(ring);
  const c = ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length];
    const k = cross(p, q);
    return [s[0] + (p[0] + q[0]) * k, s[1] + (p[1] + q[1]) * k];
  }, [0, 0]);
  return Math.abs(A) > 1e-12 ? mul(c, 1 / (6 * A)) : ring[0];
}

// ---------------------------------------------------------------- outline: occupancy grid → closed rings

/**
 * The outlines of plan points (flat [x0, n0, x1, n1, …]): an occupancy grid of cell m, dilated (closes the gaps
 * between sparse points), holes filled (a ring of wall points becomes the building), each connected region traced
 * counter-clockwise along its cell edges. Returns regions, largest first: { ring: [[x, n], …], area, index (the
 * points inside it) }.
 */
export function outline(pts, { cell = 0.25, dilate = 1, minCells = 4 } = {}) {
  const n = pts.length / 2;
  if (!n) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) (x0 = Math.min(x0, pts[2 * i])), (x1 = Math.max(x1, pts[2 * i])), (y0 = Math.min(y0, pts[2 * i + 1])), (y1 = Math.max(y1, pts[2 * i + 1]));
  const pad = dilate + 1;
  const W = Math.floor((x1 - x0) / cell) + 1 + 2 * pad;
  const H = Math.floor((y1 - y0) / cell) + 1 + 2 * pad;
  const cellOf = (i) => (Math.floor((pts[2 * i + 1] - y0) / cell) + pad) * W + Math.floor((pts[2 * i] - x0) / cell) + pad;
  let occ = new Uint8Array(W * H);
  for (let i = 0; i < n; i++) occ[cellOf(i)] = 1;
  for (let k = 0; k < dilate; k++) {
    const next = occ.slice();
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) if (occ[j * W + i]) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) next[(j + dj) * W + i + di] = 1;
    occ = next;
  }
  // the outside: flood from the border; everything else (walls and the rooms they close) is inside
  const out = new Uint8Array(W * H);
  const stack = [0];
  out[0] = 1;
  while (stack.length) {
    const c = stack.pop();
    const i = c % W;
    const j = (c - i) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [a, b] = [i + di, j + dj];
      if (a < 0 || b < 0 || a >= W || b >= H) continue;
      const d = b * W + a;
      if (!out[d] && !occ[d]) (out[d] = 1), stack.push(d);
    }
  }
  // regions (4-connected), then each one's boundary: directed cell edges with the inside on the left
  const label = new Int32Array(W * H).fill(-1);
  const regions = [];
  for (let s = 0; s < W * H; s++) {
    if (out[s] || label[s] >= 0) continue;
    const id = regions.length;
    const cells = [s];
    label[s] = id;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const i = c % W;
      for (const d of [c + 1, c - 1, c + W, c - W]) if (d >= 0 && d < W * H && Math.abs((d % W) - i) <= 1 && !out[d] && label[d] < 0) (label[d] = id), cells.push(d);
    }
    regions.push(cells);
  }
  const result = [];
  regions.forEach((cells, id) => {
    if (cells.length < minCells) return;
    const next = new Map();
    const edge = (a, b, c, d) => next.set(`${a},${b}`, [c, d]);
    for (const c of cells) {
      const i = c % W;
      const j = (c - i) / W;
      const inside = (a, b) => label[b * W + a] === id;
      if (!inside(i, j - 1)) edge(i, j, i + 1, j);
      if (!inside(i + 1, j)) edge(i + 1, j, i + 1, j + 1);
      if (!inside(i, j + 1)) edge(i + 1, j + 1, i, j + 1);
      if (!inside(i - 1, j)) edge(i, j + 1, i, j);
    }
    // filled regions have one boundary loop (a diagonal pinch can leave two: keep the longest)
    let best = [];
    const seen = new Set();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      for (let k = start; k && !seen.has(k); ) {
        seen.add(k);
        const [a, b] = k.split(',').map(Number);
        loop.push([a, b]);
        const q = next.get(k);
        k = q && `${q[0]},${q[1]}`;
      }
      if (loop.length > best.length) best = loop;
    }
    const ring = best.filter((p, k) => {
      const a = best[(k + best.length - 1) % best.length];
      const b = best[(k + 1) % best.length];
      return cross(sub(p, a), sub(b, p)) !== 0; // corners only
    }).map(([a, b]) => [x0 + (a - pad) * cell, y0 + (b - pad) * cell]);
    const index = [];
    for (let i = 0; i < n; i++) if (label[cellOf(i)] === id) index.push(i);
    result.push({ ring, area: area(ring), index });
  });
  return result.sort((a, b) => b.area - a.area);
}

// ---------------------------------------------------------------- regularise: square edges, merged, refined on the points

/** The dominant direction (radians, 0 to the period) of a ring's edges: a length-weighted histogram, refined around its peak. */
export function dominantAngle(ring, period = Math.PI / 2) {
  const bins = new Float64Array(90);
  const edges = ring.map((p, i) => sub(ring[(i + 1) % ring.length], p));
  const fold = (e) => (((Math.atan2(e[1], e[0]) % period) + period) % period) / period; // 0..1
  for (const e of edges) bins[Math.floor(fold(e) * 90) % 90] += Math.hypot(...e);
  let peak = 0;
  for (let b = 0; b < 90; b++) if (bins[b] + bins[(b + 1) % 90] + bins[(b + 89) % 90] > bins[peak] + bins[(peak + 1) % 90] + bins[(peak + 89) % 90]) peak = b;
  // circular mean (on the folded circle) of the edges near the peak
  let [c, s] = [0, 0];
  for (const e of edges) {
    const f = fold(e) * 2 * Math.PI;
    const d = Math.abs((((f - ((peak + 0.5) / 90) * 2 * Math.PI) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (d > (8 / 90) * 2 * Math.PI) continue;
    const w = Math.hypot(...e);
    (c += w * Math.cos(f)), (s += w * Math.sin(f));
  }
  return ((((Math.atan2(s, c) / (2 * Math.PI)) % 1) + 1) % 1) * period;
}

/** Where two lines { p, d } cross (null when parallel). */
const meet = (A, B) => DR.intersect(A.p, add(A.p, A.d), B.p, add(B.p, B.d), true)?.p || null;

/**
 * Quality of a straight edge a→b against plan points (flat): the points within `near` m of it (and along it), their
 * distances (mean, max), and the share of its length they cover in 0.5 m bins; guessed when coverage < 0.5.
 */
export function edgeQuality(a, b, pts, { near = 0.05, bin = 0.5 } = {}) {
  const L = dist(a, b);
  const d = mul(sub(b, a), 1 / (L || 1));
  const nb = Math.max(1, Math.round(L / bin));
  const hit = new Uint8Array(nb);
  let [count, sum, max] = [0, 0, 0];
  for (let i = 0; i < pts.length; i += 2) {
    const q = [pts[i] - a[0], pts[i + 1] - a[1]];
    const t = dot(q, d);
    if (t < 0 || t > L) continue;
    const e = Math.abs(cross(d, q));
    if (e > near) continue;
    count++;
    sum += e;
    max = Math.max(max, e);
    hit[Math.min(nb - 1, Math.floor((t / L) * nb))] = 1;
  }
  const coverage = hit.reduce((s, h) => s + h, 0) / nb;
  return { length: r3(L), points: count, mean: r3(count ? sum / count : 0), max: r3(max), coverage: r3(coverage), guessed: coverage < 0.5 };
}

/**
 * A rough closed ring made regular: simplified, its dominant direction found, edges within tolerance° of it (or
 * square to it, or of the extra `angles`) snapped, consecutive parallel edges merged, edges shorter than minEdge
 * removed (jogs), and with `points` (plan, flat) each edge moved onto the outermost face of the points near it (of
 * `fallback` where it has none of `points`); its quality is measured against `points`.
 * Returns { ring (counter-clockwise), angle (°), edges: per edge its quality (edgeQuality) and snapped }.
 */
export function regularise(ring0, { angles = [0, 90], tolerance = 5, minEdge = 0.3, simplify = 0.25, points = null, fallback = null, band = 0.6 } = {}) {
  let ring = area(ring0) < 0 ? [...ring0].reverse() : ring0;
  ring = DR.simplify(ring, simplify, true);
  if (ring.length < 3) throw new Error('The outline is too small to regularise.');
  const theta = dominantAngle(ring);
  const allowed = angles.map((a) => theta + a * D2R);
  // one line per edge: { p (a point), d (unit direction), w (length), snap (the allowed angle index, or -1) }
  let lines = ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const t = Math.atan2(q[1] - p[1], q[0] - p[0]);
    let snap = -1;
    let dir = t;
    for (const [k, a] of allowed.entries()) {
      const off = ((((t - a) % Math.PI) + 1.5 * Math.PI) % Math.PI) - Math.PI / 2; // −90..90
      if (Math.abs(off) <= tolerance * D2R) (snap = k), (dir = t - off);
    }
    return { p: mul(add(p, q), 0.5), d: dirOf(dir), w: dist(p, q), snap };
  });
  const parallel = (A, B) => Math.abs(cross(A.d, B.d)) < 1e-9 && dot(A.d, B.d) > 0;
  const mergeTwo = (A, B) => ({ ...A, p: mul(add(mul(A.p, A.w), mul(B.p, B.w)), 1 / (A.w + B.w)), w: A.w + B.w });
  const mergeRuns = () => {
    for (let changed = true; changed && lines.length > 3; ) {
      changed = false;
      for (let i = 0; i < lines.length && lines.length > 3; i++) {
        const j = (i + 1) % lines.length;
        if (!parallel(lines[i], lines[j])) continue;
        lines[i] = mergeTwo(lines[i], lines[j]);
        lines.splice(j, 1);
        changed = true;
        i--;
      }
    }
  };
  const vertices = () => lines.map((L, i) => meet(lines[(i + lines.length - 1) % lines.length], L) || L.p);
  mergeRuns();
  // jogs: an edge shorter than minEdge goes; its neighbours meet (or merge when parallel)
  for (let guard = 0; guard < 100 && lines.length > 3; guard++) {
    const v = vertices();
    let k = -1;
    let shortest = minEdge;
    for (let i = 0; i < lines.length; i++) {
      const l = dist(v[i], v[(i + 1) % lines.length]);
      if (l < shortest) (shortest = l), (k = i);
    }
    if (k < 0) break;
    lines.splice(k, 1);
    mergeRuns();
  }
  // each edge onto the points: the outermost face (a histogram across it) inside a band around the rough edge
  if (points) {
    const v = vertices();
    const refine = (L, a, b, points) => {
      const len = dist(a, b);
      const o = [L.d[1], -L.d[0]]; // outward (right of a counter-clockwise ring)
      const step = 0.02;
      const nbin = Math.ceil((2 * band) / step);
      const hist = new Uint32Array(nbin);
      const s = [];
      for (let k = 0; k < points.length; k += 2) {
        const q = [points[k] - a[0], points[k + 1] - a[1]];
        const t = dot(q, L.d);
        if (t < Math.min(0.3, len / 4) || t > len - Math.min(0.3, len / 4)) continue; // not the corners
        const e = dot(q, o);
        if (e < -band || e >= band) continue;
        hist[Math.floor((e + band) / step)]++;
        s.push(e);
      }
      if (s.length < 10) return null;
      const top = Math.max(...hist);
      let face = nbin - 1;
      while (face > 0 && hist[face] < 0.3 * top) face--;
      const c = -band + (face + 0.5) * step;
      const near = s.filter((e) => Math.abs(e - c) < 0.04);
      const shift = near.reduce((t, e) => t + e, 0) / near.length;
      return { ...L, p: add(L.p, mul(o, shift + dot(sub(a, L.p), o))) };
    };
    // an edge with no points of its own (an occluded wall) falls back on the others (the roof edge seen from above)
    lines = lines.map((L, i) => refine(L, v[i], v[(i + 1) % lines.length], points) || (fallback && refine(L, v[i], v[(i + 1) % lines.length], fallback)) || L);
  }
  const v = vertices();
  return {
    ring: v,
    angle: r3((theta / D2R) % 90),
    edges: lines.map((L, i) => ({ ...(points ? edgeQuality(v[i], v[(i + 1) % v.length], points) : { length: r3(dist(v[i], v[(i + 1) % v.length])) }), snapped: L.snap >= 0 })),
  };
}

// ---------------------------------------------------------------- eaves

/**
 * The eave height (model y) of a building: the roof seen from above (the highest point per cell inside the
 * footprint), extrapolated to each footprint edge by a straight fit across the cells within 1.5 m of it; the eave is
 * the lowest of those (a gable end is higher); points within `wall` m of an edge are the walls and left out. top:
 * the 95th percentile of the roof. points: 3D model, flat.
 */
export function eaveHeight(points, ring, { cell = 0.5, margin = 0.3, wall = 0.15 } = {}) {
  const top = new Map();
  const bb = ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < points.length; i += 3) {
    const q = [points[i], -points[i + 2]];
    if (q[0] < bb[0] - margin || q[0] > bb[2] + margin || q[1] < bb[1] - margin || q[1] > bb[3] + margin) continue;
    if (!insidePolygon(q, ring)) continue;
    if (ring.some((a, j) => DR.nearest([a, ring[(j + 1) % ring.length]], q).d < wall)) continue; // the walls, not the roof
    const k =`${Math.floor(q[0] / cell)},${Math.floor(q[1] / cell)}`;
    const t = top.get(k);
    if (!t || points[i + 1] > t[2]) top.set(k, [q[0], q[1], points[i + 1]]);
  }
  const roof = [...top.values()];
  if (roof.length < 3) throw new Error('No roof points inside the footprint.');
  const ys = roof.map((r) => r[2]).sort((a, b) => a - b);
  const top95 = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))];
  let eave = Infinity;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const L = dist(a, b);
    const d = mul(sub(b, a), 1 / L);
    const inward = [-d[1], d[0]]; // left of a counter-clockwise ring
    const xs = [];
    for (const r of roof) {
      const q = sub(r, a);
      const t = dot(q, d);
      const e = dot(q, inward);
      if (t > 0.1 * L && t < 0.9 * L && e >= 0 && e < 1.5) xs.push([e, r[2]]);
    }
    if (xs.length < 3) return;
    const mx = xs.reduce((s, x) => s + x[0], 0) / xs.length;
    const my = xs.reduce((s, x) => s + x[1], 0) / xs.length;
    const sxx = xs.reduce((s, x) => s + (x[0] - mx) ** 2, 0);
    const slope = sxx > 1e-9 ? xs.reduce((s, x) => s + (x[0] - mx) * (x[1] - my), 0) / sxx : 0;
    eave = Math.min(eave, my - slope * mx);
  });
  if (!Number.isFinite(eave)) eave = ys[Math.floor(ys.length * 0.05)];
  return { eave, top: top95, roof: top95 - eave < 0.3 ? 'flat' : 'pitched' };
}

// ---------------------------------------------------------------- footprints

/**
 * Building footprints from building points (3D model, flat): regions in plan, then per region the wall band (band
 * m above ground(x, z) → y) outlined and regularised, or the roof outline seen from above when the band is empty.
 * Its ground: the foot of its walls (2nd percentile of the wall points under the band), else ground() at its corners.
 * Returns per building { ring (plan, counter-clockwise), area, perimeter, ground, eave, top, roof, source, angle,
 * edges (quality), quality: { points, mean, max, guessed } }.
 */
export function footprints(points, { ground, band = [1, 2.5], cell = 0.25, tolerance = 5, minEdge = 0.3, minArea = 4 } = {}) {
  const n = points.length / 3;
  const plan = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) (plan[2 * i] = points[3 * i]), (plan[2 * i + 1] = -points[3 * i + 2]);
  const out = [];
  for (const reg of outline(plan, { cell: 0.5, dilate: 1 })) {
    if (reg.area < minArea) continue;
    const c = centroid(reg.ring);
    const g = ground(c[0], -c[1]);
    const mine = new Float64Array(reg.index.length * 3);
    reg.index.forEach((i, k) => mine.set(points.subarray(3 * i, 3 * i + 3), 3 * k));
    const inBand = [];
    for (const i of reg.index) {
      const h = points[3 * i + 1] - g;
      if (h >= band[0] && h <= band[1]) inBand.push(plan[2 * i], plan[2 * i + 1]);
    }
    const source = inBand.length >= 100 ? 'walls' : 'roof';
    const all = Float64Array.from(reg.index.flatMap((i) => [plan[2 * i], plan[2 * i + 1]]));
    const pts = source === 'walls' ? Float64Array.from(inBand) : all;
    // the rough shape from every point (the roof closes it where a wall is hidden), the edges from the wall band
    const [rough] = outline(all, { cell, dilate: 1 });
    if (!rough || rough.ring.length < 3) continue;
    let reg2;
    try {
      reg2 = regularise(rough.ring, { tolerance, minEdge, simplify: cell, points: pts, fallback: all });
    } catch {
      continue;
    }
    const ring = reg2.ring;
    const A = area(ring);
    if (A < minArea) continue;
    // the building's own ground: its wall feet where the scan reaches them, else the ground around its outline
    const feet = [];
    for (const i of reg.index) {
      const q = [plan[2 * i], plan[2 * i + 1]];
      if (points[3 * i + 1] - g < band[0] && ring.some((a, j) => DR.nearest([a, ring[(j + 1) % ring.length]], q).d < 0.2)) feet.push(points[3 * i + 1]);
    }
    feet.sort((a, b) => a - b);
    const around = ring.map((p) => ground(p[0], -p[1])).sort((a, b) => a - b);
    const base = feet.length >= 20 ? feet[Math.floor(feet.length * 0.02)] : around[around.length >> 1];
    const eh = eaveHeight(mine, ring);
    const support = reg2.edges.reduce((s, e) => s + e.points, 0);
    out.push({
      ring,
      area: A,
      perimeter: DR.length(ring, true),
      ground: base,
      ...eh,
      source,
      angle: reg2.angle,
      edges: reg2.edges,
      quality: { points: support, mean: r3(reg2.edges.reduce((s, e) => s + e.mean * e.points, 0) / (support || 1)), max: Math.max(...reg2.edges.map((e) => e.max)), guessed: reg2.edges.filter((e) => e.guessed).length },
    });
  }
  return out;
}

// ---------------------------------------------------------------- line segments in a slice

/**
 * Straight segments through 2D points (flat [u0, v0, …]): sequential RANSAC (lines through two nearby points,
 * scored on a sample), each refitted by least squares on its inliers within `distance`, split where the points stop
 * for more than maxGap, kept when a run has minPoints and minLength and few points beside it (a face, not a patch of
 * ground the slab cuts). Returns [{ a, b, points, mean, max }].
 */
export function fitSegments(pts, { distance = 0.03, minPoints = 30, minLength = 0.3, maxGap = 0.3, iterations = 300, seed = 1, maxLines = 200 } = {}) {
  const rand = rng(seed);
  const n = pts.length / 2;
  let alive = Array.from({ length: n }, (_, i) => i);
  const P = (i) => [pts[2 * i], pts[2 * i + 1]];
  // a 1 m grid to pick the second point near the first (lines through the same wall)
  const grid = new Map();
  const key = (p) => `${Math.floor(p[0])},${Math.floor(p[1])}`;
  for (let i = 0; i < n; i++) (grid.get(key(P(i))) || grid.set(key(P(i)), []).get(key(P(i)))).push(i);
  const segs = [];
  const dead = new Uint8Array(n);
  for (let fails = 0, round = 0; segs.length < maxLines && alive.length >= minPoints && fails < 5 && round < 3000; round++) {
    const sample = alive.length > 3000 ? Array.from({ length: 3000 }, () => alive[Math.floor(rand() * alive.length)]) : alive;
    const scale = alive.length / sample.length;
    let best = null;
    for (let it = 0; it < iterations; it++) {
      const i = alive[Math.floor(rand() * alive.length)];
      const p = P(i);
      const cand = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${Math.floor(p[0]) + dx},${Math.floor(p[1]) + dy}`) || []) if (!dead[j] && j !== i) cand.push(j);
      if (!cand.length) continue;
      const q = P(cand[Math.floor(rand() * cand.length)]);
      const L = dist(p, q);
      if (L < 0.1) continue;
      const d = mul(sub(q, p), 1 / L);
      // MSAC: an inlier counts less the farther it lies, so a line through two near-parallel faces loses to either
      let score = 0;
      let count = 0;
      for (const k of sample) {
        const e = Math.abs(cross(d, sub(P(k), p))) / (distance / 2); // scored tight: near-collinear faces stay apart
        if (e < 1) (score += 1 - e * e), count++;
      }
      if (!best || score > best.score) best = { p, d, score, count };
    }
    if (!best || best.count * scale < minPoints / 2) break;
    // refit on the inliers (principal direction), then collect again
    let line = best;
    let inl = [];
    for (let round = 0; round < 2; round++) {
      inl = alive.filter((k) => Math.abs(cross(line.d, sub(P(k), line.p))) < distance);
      const c = inl.reduce((s, k) => add(s, P(k)), [0, 0]).map((x) => x / inl.length);
      let [sxx, sxy, syy] = [0, 0, 0];
      for (const k of inl) {
        const q = sub(P(k), c);
        (sxx += q[0] * q[0]), (sxy += q[0] * q[1]), (syy += q[1] * q[1]);
      }
      line = { p: c, d: dirOf(0.5 * Math.atan2(2 * sxy, sxx - syy)) };
    }
    inl = alive.filter((k) => Math.abs(cross(line.d, sub(P(k), line.p))) < distance);
    for (const k of inl) dead[k] = 1;
    alive = alive.filter((k) => !dead[k]);
    // runs along the line, cut where the points stop
    const along = inl.map((k) => [dot(sub(P(k), line.p), line.d), Math.abs(cross(line.d, sub(P(k), line.p)))]).sort((a, b) => a[0] - b[0]);
    // the points just beside the line (distance to 3 × distance either side): a face has next to none, a patch of
    // ground cut by the slab as many as on the line
    const beside = [];
    for (let k = 0; k < n; k++) {
      const e = Math.abs(cross(line.d, sub(P(k), line.p)));
      if (e >= distance && e < 3 * distance) beside.push(dot(sub(P(k), line.p), line.d));
    }
    beside.sort((a, b) => a - b);
    const below = (t) => {
      let [lo, hi] = [0, beside.length];
      while (lo < hi) beside[(lo + hi) >> 1] < t ? (lo = ((lo + hi) >> 1) + 1) : (hi = (lo + hi) >> 1);
      return lo;
    };
    let made = 0;
    let area = 0;
    for (let s = 0, e = 0; s < along.length; s = e) {
      e = s + 1;
      while (e < along.length && along[e][0] - along[e - 1][0] <= maxGap) e++;
      let [s1, e1] = [s, e];
      // a few points past a small gap at either end are a crossing face, not this one
      for (let k = s; k < Math.min(e - 1, s + 20); k++) if (along[k + 1][0] - along[k][0] > 0.1) s1 = k + 1;
      for (let k = e - 1; k > Math.max(s1, e - 21); k--) if (along[k][0] - along[k - 1][0] > 0.1) e1 = k;
      const run = along.slice(s1, e1);
      if (!run.length) continue;
      const L = run.at(-1)[0] - run[0][0];
      if (run.length < minPoints || L < minLength) continue;
      if (below(run.at(-1)[0]) - below(run[0][0]) > 0.5 * run.length) {
        area++; // an area, not a line: dropped, and the search goes on
        continue;
      }
      const res = run.map((r) => r[1]);
      segs.push({ a: add(line.p, mul(line.d, run[0][0])), b: add(line.p, mul(line.d, run.at(-1)[0])), points: run.length, mean: r3(res.reduce((t, x) => t + x, 0) / res.length), max: r3(Math.max(...res)) });
      made++;
    }
    fails = made || area ? 0 : fails + 1;
  }
  return segs;
}

/**
 * Segments into polylines, through drafting.js: collinear pieces closer than gap bridged (a door, an occlusion:
 * kept as guessed), ends within gap of another segment's line meeting it at a corner (both ends) or a T (one end),
 * then joined end to end (DR.join). Returns [{ pts: [[u, v], …], closed, segments, guessed: [{ from, to, length }],
 * points, mean, max }], the closed ones first, largest first.
 */
export function joinSegments(segs0, { gap = 1, minAngle = 20 } = {}) {
  let segs = segs0.map((s) => ({ a: s.a, b: s.b, points: s.points, mean: s.mean, max: s.max, guessed: [], parts: 1 }));
  const dir = (s) => mul(sub(s.b, s.a), 1 / (dist(s.a, s.b) || 1));
  // 1. collinear pieces: bridge the gap
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const [A, B] = [segs[i], segs[j]];
        const d = dir(A);
        if (Math.abs(cross(d, dir(B))) > Math.sin(2 * D2R)) continue;
        if (Math.abs(cross(d, sub(B.a, A.a))) > 0.05 || Math.abs(cross(d, sub(B.b, A.a))) > 0.05) continue;
        const ta = [0, dot(sub(A.b, A.a), d)];
        const tb = [dot(sub(B.a, A.a), d), dot(sub(B.b, A.a), d)].sort((x, y) => x - y);
        const space = Math.max(tb[0] - ta[1], ta[0] - tb[1]);
        if (space > gap) continue;
        const lo = Math.min(ta[0], tb[0]);
        const hi = Math.max(ta[1], tb[1]);
        const guessed = [...A.guessed, ...B.guessed];
        if (space > 0.05) {
          const g0 = tb[0] > ta[1] ? ta[1] : tb[1];
          const from = add(A.a, mul(d, g0));
          guessed.push({ from, to: add(from, mul(d, space)), length: r3(space) });
        }
        const w = A.points + B.points;
        segs[i] = { a: add(A.a, mul(d, lo)), b: add(A.a, mul(d, hi)), points: w, mean: r3((A.mean * A.points + B.mean * B.points) / w), max: Math.max(A.max, B.max), guessed, parts: A.parts + B.parts };
        segs.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  // 2. corners: two free ends whose lines cross within gap of both meet there
  const ends = [];
  segs.forEach((s, i) => ends.push({ i, k: 'a' }, { i, k: 'b' }));
  const pairs = [];
  for (let x = 0; x < ends.length; x++)
    for (let y = x + 1; y < ends.length; y++) {
      const [E, F] = [ends[x], ends[y]];
      if (E.i === F.i) continue;
      const [S, T] = [segs[E.i], segs[F.i]];
      if (Math.abs(cross(dir(S), dir(T))) < Math.sin(minAngle * D2R)) continue;
      const X = DR.intersect(S.a, S.b, T.a, T.b, true)?.p;
      if (!X) continue;
      const [de, df] = [dist(X, S[E.k]), dist(X, T[F.k])];
      // the end must reach towards X, or be cut back by half a metre at most (a run picks up the next face's points)
      const back = (s, k) => dot(sub(X, s[k]), k === 'b' ? dir(s) : mul(dir(s), -1));
      if (de <= gap && df <= gap && back(S, E.k) > -0.5 && back(T, F.k) > -0.5) pairs.push({ E, F, X, cost: de + df });
    }
  pairs.sort((p, q) => p.cost - q.cost);
  const used = new Set();
  for (const { E, F, X } of pairs) {
    const [ke, kf] = [`${E.i}${E.k}`, `${F.i}${F.k}`];
    if (used.has(ke) || used.has(kf)) continue;
    used.add(ke), used.add(kf);
    segs[E.i][E.k] = X;
    segs[F.i][F.k] = X;
  }
  // 3. T: a free end within gap of another segment's span is extended (or trimmed) onto it
  for (const E of ends) {
    if (used.has(`${E.i}${E.k}`)) continue;
    const S = segs[E.i];
    let best = null;
    segs.forEach((T, j) => {
      if (j === E.i || Math.abs(cross(dir(S), dir(T))) < Math.sin(minAngle * D2R)) return;
      const x = DR.intersect(S.a, S.b, T.a, T.b, true);
      if (!x || x.u < -0.01 || x.u > 1.01) return;
      const d = dist(x.p, S[E.k]);
      if (d <= gap && (!best || d < best.d)) best = { d, p: x.p };
    });
    if (best) S[E.k] = best.p;
  }
  const lines = DR.join(segs.map((s) => ({ pts: [s.a, s.b], seg: s })), 1e-6);
  // DR.join keeps the first piece's fields: gather every segment's report along each polyline
  const owner = (p, q) => segs.find((s) => (dist(s.a, p) < 1e-6 && dist(s.b, q) < 1e-6) || (dist(s.a, q) < 1e-6 && dist(s.b, p) < 1e-6));
  return lines
    .map((l) => {
      const pts = l.pts;
      const mine = [];
      for (let k = 0; k < (l.closed ? pts.length : pts.length - 1); k++) {
        const s = owner(pts[k], pts[(k + 1) % pts.length]);
        if (s && !mine.includes(s)) mine.push(s);
      }
      const w = mine.reduce((t, s) => t + s.points, 0);
      return { pts, closed: l.closed, segments: mine.length, guessed: mine.flatMap((s) => s.guessed), points: w, mean: r3(mine.reduce((t, s) => t + s.mean * s.points, 0) / (w || 1)), max: Math.max(0, ...mine.map((s) => s.max)), area: l.closed ? Math.abs(area(pts)) : 0, length: DR.length(pts, l.closed) };
    })
    .sort((a, b) => b.closed - a.closed || b.area - a.area || b.length - a.length);
}

/**
 * Wall centre lines: parallel segments facing each other 0.05–0.6 m apart and overlapping by half the shorter one
 * are the two faces of a wall: [{ a, b, thickness }] along the overlap, half-way between them.
 */
export function centreLines(segs, { min = 0.05, max = 0.6 } = {}) {
  const out = [];
  const dir = (s) => mul(sub(s.b, s.a), 1 / (dist(s.a, s.b) || 1));
  const taken = new Set();
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      if (taken.has(i) || taken.has(j)) continue;
      const [A, B] = [segs[i], segs[j]];
      const d = dir(A);
      if (Math.abs(cross(d, dir(B))) > Math.sin(2 * D2R)) continue;
      const t = Math.abs(cross(d, sub(B.a, A.a)));
      if (t < min || t > max) continue;
      const tb = [dot(sub(B.a, A.a), d), dot(sub(B.b, A.a), d)].sort((x, y) => x - y);
      const lo = Math.max(0, tb[0]);
      const hi = Math.min(dist(A.a, A.b), tb[1]);
      if (hi - lo < 0.5 * Math.min(dist(A.a, A.b), tb[1] - tb[0])) continue;
      const o = mul([-d[1], d[0]], cross(d, sub(B.a, A.a)) / 2);
      out.push({ a: add(add(A.a, mul(d, lo)), o), b: add(add(A.a, mul(d, hi)), o), thickness: r3(t) });
      taken.add(i), taken.add(j);
    }
  return out;
}

// ---------------------------------------------------------------- edges and breaklines

/**
 * Edge lines (3D model polylines in order along a route) joined where one stops and the next carries on within gap
 * m in plan and heading the same way: the joins are guessed. Returns [{ pts, guessed: [{ from, to, length }] }].
 */
export function bridgeLines(lines, { gap = 5 } = {}) {
  const out = lines.map((pts) => ({ pts: pts.slice(), guessed: [] }));
  const head = (pts, end) => {
    const [p, q] = end ? [pts.at(-2), pts.at(-1)] : [pts[1], pts[0]];
    const d = [q[0] - p[0], q[2] - p[2]];
    return mul(d, 1 / (Math.hypot(...d) || 1));
  };
  for (let joined = true; joined; ) {
    joined = false;
    for (let i = 0; i < out.length && !joined; i++)
      for (let j = 0; j < out.length && !joined; j++) {
        if (i === j) continue;
        const [A, B] = [out[i].pts, out[j].pts];
        const e = A.at(-1);
        const s = B[0];
        const g = Math.hypot(s[0] - e[0], s[2] - e[2]);
        if (g > gap) continue;
        const h = head(A, true);
        const along = (s[0] - e[0]) * h[0] + (s[2] - e[2]) * h[1];
        if (along < -0.05 || dot(h, mul(head(B, false), -1)) < Math.cos(15 * D2R) || Math.abs(cross(h, [s[0] - e[0], s[2] - e[2]])) > 0.3) continue;
        out[i] = { pts: [...A, ...B], guessed: [...out[i].guessed, ...(g > 0.05 ? [{ from: e, to: s, length: r3(g) }] : []), ...out[j].guessed] };
        out.splice(j, 1);
        joined = true;
      }
  }
  return out;
}

/** A 3D polyline moved d m sideways in plan (+ right of its direction), heights kept: a kerb top next to its bottom. */
export function nudge(pts3, d) {
  const moved = DR.offset(DR.flat(pts3), -d);
  return moved.map((p, i) => [p[0], pts3[i][1], -p[1]]);
}

/**
 * A ground surface (mesh v, f in model coordinates, triangles facing up) rebuilt to follow breaklines (3D
 * polylines): its vertices within clear m of a line dropped, the lines' vertices added and constrained, triangles no
 * longer than its longest edge kept. Returns { v, f, failed (constraints that crossed another) }.
 */
export function withBreaklines(mesh, lines, { clear = 0.3 } = {}) {
  let longest = 0;
  for (const f of mesh.f) for (let k = 0; k < f.length; k++) longest = Math.max(longest, Math.hypot(mesh.v[f[k]][0] - mesh.v[f[(k + 1) % f.length]][0], mesh.v[f[k]][2] - mesh.v[f[(k + 1) % f.length]][2]));
  const flat = lines.map((l) => DR.flat(l));
  const near = (p) => flat.some((l) => l.length > 1 && DR.nearest(l, [p[0], -p[2]]).d < clear);
  const v = mesh.v.filter((p) => !near(p));
  const seen = new Map(v.map((p, i) => [`${Math.round(p[0] * 1e3)},${Math.round(p[2] * 1e3)}`, i]));
  const constraints = [];
  for (const l of lines) {
    let prev = -1;
    for (const p of l) {
      const k = `${Math.round(p[0] * 1e3)},${Math.round(p[2] * 1e3)}`;
      if (!seen.has(k)) seen.set(k, v.push(p) - 1);
      const i = seen.get(k);
      if (prev >= 0 && prev !== i) constraints.push([prev, i]);
      prev = i;
    }
  }
  const { faces, failed } = triangulate(v, { constraints, maxEdge: longest * 1.01 });
  return { v, f: faces, failed: failed.length };
}

/** Hausdorff distance between two closed plan rings (sampled every 0.05 m along both). */
export function hausdorff(A, B, step = 0.05) {
  const dense = (R) => DR.divide(R, { spacing: step }, true);
  const one = (P, Q) => Math.max(...dense(P).map((p) => DR.nearest(Q, p, true).d));
  return Math.max(one(A, B), one(B, A));
}
