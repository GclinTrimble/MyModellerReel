// Surface tools (#121, #122, #123, #120, #34, #35, #37): contours, analysis colours, profiles and cross-sections, pads
// with batter slopes, smoothing that keeps the survey, surfaces from contours, sculpting, and elevation grids.
// Meshes are world (or local) { v: [[x, y, z]], f: [[a, b, c]] }, y up; heights come from samplers z(x, z).
import * as DR from './drafting.js';
import * as TR from './terrain.js';

const tri = (m) => m.f.flatMap((f) => f.slice(1, -1).map((_, k) => [f[0], f[k + 1], f[k + 2]]));

/** Contour lines every interval: [{ z, major, lines: [{ pts: [[x, y, z]], closed }] }]. */
export function contours(mesh, { interval = 1, base = 0, major_every = 5, smooth = 0 } = {}) {
  if (!(interval > 0)) throw new Error('interval must be above 0.');
  const ys = mesh.v.map((p) => p[1]);
  const [lo, hi] = [Math.min(...ys), Math.max(...ys)];
  const first = Math.ceil((lo - base) / interval);
  const last = Math.floor((hi - base) / interval);
  if (last - first > 2000) throw new Error('That interval gives more than 2000 contours: use a bigger one.');
  const out = [];
  const T = tri(mesh);
  for (let k = first; k <= last; k++) {
    const z = base + k * interval;
    const segs = [];
    for (const t of T) {
      const P = t.map((i) => mesh.v[i]);
      const d = P.map((p) => (Math.abs(p[1] - z) < 1e-9 ? 1e-9 : p[1] - z)); // a vertex on the level counts as just above
      const cut = [];
      for (let i = 0; i < 3; i++) {
        const [a, b] = [i, (i + 1) % 3];
        if (d[a] > 0 !== d[b] > 0) {
          const u = d[a] / (d[a] - d[b]);
          cut.push([P[a][0] + (P[b][0] - P[a][0]) * u, -(P[a][2] + (P[b][2] - P[a][2]) * u)]);
        }
      }
      if (cut.length === 2) segs.push({ pts: cut, closed: false, key: 0 });
    }
    if (!segs.length) continue;
    const lines = DR.join(DR.dedupe(segs, 1e-6), 1e-6).map((l) => {
      let pts = DR.simplify(l.pts, interval * 0.01, l.closed);
      for (let s = 0; s < smooth; s++) pts = chaikin(pts, l.closed);
      return { pts: pts.map(([x, n]) => [x, z, -n]), closed: l.closed };
    });
    out.push({ z, major: major_every > 0 && k % major_every === 0, lines });
  }
  return out;
}

/** Corner cutting: rounder lines, ends kept. */
export function chaikin(pts, closed) {
  if (pts.length < 3) return pts;
  const out = closed ? [] : [pts[0]];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [a, b] = [pts[i], pts[(i + 1) % n]];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  if (!closed) out.push(pts.at(-1));
  return out;
}

const RAMP = ['#2c7bb6', '#00a6ca', '#00ccbc', '#90eb9d', '#ffff8c', '#f9d057', '#f29e2e', '#e76818', '#d7191c'];
const lerpHex = (t) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))];

/** Per-face colours and a legend: elevation bands, slope classes, aspect, or the difference to another surface. */
export function analyze(mesh, { kind = 'elevation', bands = 8, thresholds = [2, 5, 10, 20, 33], other = null, units = 'percent', base = 0 } = {}) {
  const T = mesh.f.map((f) => f.map((i) => mesh.v[i]));
  const normal = (P) => {
    const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
    const w = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    return n.map((x) => (x / l) * Math.sign(n[1] || 1));
  };
  if (kind === 'elevation') {
    const ys = mesh.v.map((p) => p[1]);
    const [lo, hi] = [Math.min(...ys), Math.max(...ys)];
    const step = (hi - lo) / bands || 1;
    const fc = T.map((P) => lerpHex(Math.min(bands - 1, Math.floor((P.reduce((s, p) => s + p[1], 0) / P.length - lo) / step)) / Math.max(1, bands - 1)));
    const legend = Array.from({ length: bands }, (_, i) => ({ label: `${(lo + i * step + base).toFixed(2)} – ${(lo + (i + 1) * step + base).toFixed(2)}`, color: lerpHex(i / Math.max(1, bands - 1)) }));
    return { fc, legend };
  }
  if (kind === 'slope') {
    const th = [...thresholds].sort((a, b) => a - b);
    const cls = (P) => {
      const n = normal(P);
      const deg = (Math.acos(Math.min(1, Math.abs(n[1]))) * 180) / Math.PI;
      const v = units === 'degrees' ? deg : Math.tan((deg * Math.PI) / 180) * 100;
      const i = th.findIndex((t) => v < t);
      return i < 0 ? th.length : i;
    };
    const fc = T.map((P) => lerpHex(cls(P) / th.length));
    const u = units === 'degrees' ? '°' : '%';
    const legend = [...th, Infinity].map((t, i) => ({ label: i === 0 ? `< ${t}${u}` : t === Infinity ? `≥ ${th.at(-1)}${u}` : `${th[i - 1]} – ${t}${u}`, color: lerpHex(i / th.length) }));
    return { fc, legend };
  }
  if (kind === 'aspect') {
    const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const COL = ['#d7191c', '#f29e2e', '#ffff8c', '#90eb9d', '#00ccbc', '#00a6ca', '#2c7bb6', '#8e44ad'];
    const fc = T.map((P) => {
      const n = normal(P);
      if (Math.hypot(n[0], n[2]) < 1e-3) return '#d9d4c7'; // flat
      const bearing = ((Math.atan2(n[0], -n[2]) * 180) / Math.PI + 360) % 360; // downhill direction, from north
      return COL[Math.round(bearing / 45) % 8];
    });
    return { fc, legend: [...DIRS.map((d, i) => ({ label: `faces ${d}`, color: COL[i] })), { label: 'flat', color: '#d9d4c7' }] };
  }
  if (kind === 'difference') {
    if (!other) throw new Error('difference needs the other surface.');
    const d = T.map((P) => {
      const c = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
      const z = other(c[0], c[2]);
      return z === null ? null : c[1] - z;
    });
    const m = Math.max(1e-6, ...d.filter((x) => x !== null).map(Math.abs));
    const fc = d.map((x) => (x === null ? '#d9d4c7' : x > 0 ? mix('#ffffff', '#d7191c', x / m) : mix('#ffffff', '#2c7bb6', -x / m)));
    return { fc, legend: [{ label: `up to +${m.toFixed(2)} m (higher)`, color: '#d7191c' }, { label: '0', color: '#ffffff' }, { label: `down to −${m.toFixed(2)} m (lower)`, color: '#2c7bb6' }] };
  }
  throw new Error(`Unknown analysis "${kind}": elevation, slope, aspect or difference.`);
}
function mix(a, b, t) {
  const p = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * Math.min(1, t)).toString(16).padStart(2, '0')).join('')}`;
}

/** Samples along a path every interval: [{ s, x, z, values: [height per sampler or null] }]. */
export function profile(path, samplers, interval = 1) {
  const P = path.map((p) => [p[0], -p[2]]);
  const L = DR.length(P);
  if (!(L > 0)) throw new Error('The path has no length.');
  const n = Math.min(5000, Math.max(1, Math.ceil(L / interval)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const s = Math.min(L, i * interval);
    const [x, nn] = DR.pointAt(P, s);
    out.push({ s, x, z: -nn, values: samplers.map((f) => f(x, -nn)) });
    if (s >= L) break;
  }
  return { length: L, samples: out };
}

/** Cross-sections square to a path at an interval, left and right widths. */
export function sections(path, samplers, { interval = 10, left = 20, right = 20, step = 1 } = {}) {
  const P = path.map((p) => [p[0], -p[2]]);
  const L = DR.length(P);
  const out = [];
  for (let s = 0; s <= L + 1e-9; s += interval) {
    const c = DR.pointAt(P, s);
    const a = DR.pointAt(P, Math.max(0, s - 0.5));
    const b = DR.pointAt(P, Math.min(L, s + 0.5));
    const t = [b[0] - a[0], b[1] - a[1]];
    const tl = Math.hypot(...t) || 1;
    const lft = [-t[1] / tl, t[0] / tl]; // left of travel, seen from above
    const pts = [];
    for (let o = -left; o <= right + 1e-9; o += step) {
      const q = [c[0] - lft[0] * o, c[1] - lft[1] * o]; // offset: negative left, positive right
      pts.push({ offset: Math.round(o * 1000) / 1000, x: q[0], z: -q[1], values: samplers.map((f) => f(q[0], -q[1])) });
    }
    out.push({ station: Math.round(s * 1000) / 1000, x: c[0], z: -c[1], points: pts });
  }
  return out;
}

/**
 * A pad: a flat (or graded) top inside a closed outline, with cut / fill slopes (H:V) running out to the ground.
 * outline: world [[x, y, z]]; elevation: model height of the top; ground: z(x, z). Returns { mesh, daylight }.
 */
export function padMesh(outline, { elevation, grade = 0, bearing = 0, cut_slope = 2, fill_slope = 2, ground, max_distance = 200, step = 2 }) {
  let P = outline.map((p) => [p[0], -p[2]]);
  if (P.length > 3 && Math.hypot(P[0][0] - P.at(-1)[0], P[0][1] - P.at(-1)[1]) < 1e-9) P = P.slice(0, -1);
  if (P.length < 3) throw new Error('A pad needs a closed outline of 3 points or more.');
  if (P.reduce((s, p, i) => s + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0) < 0) P.reverse(); // counter-clockwise
  const c = [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
  const b = (bearing * Math.PI) / 180;
  const topY = ([x, n]) => elevation + ((grade / 100) * ((x - c[0]) * Math.sin(b) + (n - c[1]) * Math.cos(b)));
  // daylight from every corner (along the bisector) and every ~step m along the sides (square to them)
  const Q = [];
  const D = [];
  const m = P.length;
  for (let i = 0; i < m; i++) {
    const [a, p, q] = [P[(i - 1 + m) % m], P[i], P[(i + 1) % m]];
    const e1 = [p[0] - a[0], p[1] - a[1]];
    const e2 = [q[0] - p[0], q[1] - p[1]];
    const n1 = [e1[1], -e1[0]].map((x) => x / (Math.hypot(...e1) || 1));
    const n2 = [e2[1], -e2[0]].map((x) => x / (Math.hypot(...e2) || 1));
    const dir = [n1[0] + n2[0], n1[1] + n2[1]];
    const dl = Math.hypot(...dir) || 1;
    Q.push(p);
    D.push([dir[0] / dl, dir[1] / dl]); // outward bisector
    const k = Math.max(1, Math.round(Math.hypot(...e2) / step));
    for (let j = 1; j < k; j++) Q.push([p[0] + (e2[0] * j) / k, p[1] + (e2[1] * j) / k]), D.push(n2);
  }
  const n = Q.length;
  const top = Q.map((p) => [p[0], topY(p), -p[1]]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = Q[i];
    const d = D[i];
    const y0 = top[i][1];
    const g0 = ground(p[0], -p[1]);
    if (g0 === null || g0 === undefined) {
      out.push([p[0], y0, -p[1]]);
      continue;
    }
    const slope = g0 > y0 ? cut_slope : fill_slope; // H per 1 V
    const sgn = g0 > y0 ? 1 : -1; // the batter goes up in cut, down in fill
    const f = (t) => {
      const g = ground(p[0] + d[0] * t, -(p[1] + d[1] * t));
      return g === null || g === undefined ? null : y0 + (sgn * t) / slope - g;
    };
    let lo = 0;
    let hi = 0.5;
    let fh = f(hi);
    while (fh !== null && Math.sign(fh) === Math.sign(f(0) || -sgn) && hi < max_distance) (lo = hi), (hi *= 1.6), (fh = f(hi));
    if (fh === null) hi = lo; // ran off the ground: stop at the last good spot
    for (let k = 0; k < 40 && hi > lo; k++) {
      const m = (lo + hi) / 2;
      const fm = f(m);
      if (fm === null || Math.sign(fm) !== Math.sign(f(0) || -sgn)) hi = m;
      else lo = m;
    }
    const t = hi;
    out.push([p[0] + d[0] * t, y0 + (sgn * t) / slope, -(p[1] + d[1] * t)]);
  }
  const v = [...top, ...out];
  const f = [top.map((_, i) => i)];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([i, n + j, n + i], [i, j, n + j]); // the batter as triangles: they follow the ground
  }
  return { mesh: { v, f: f.map((face) => (newellY(v, face) < 0 ? [...face].reverse() : face)) }, daylight: out };
}

/** The up component of a polygon's (Newell) normal: ground faces should face up. */
const newellY = (v, face) => face.reduce((s, i, k) => {
  const [p, q] = [v[i], v[face[(k + 1) % face.length]]];
  return s + (p[2] - q[2]) * (p[0] + q[0]);
}, 0);

/** Subdivide (midpoints) then Laplacian-smooth the new points; surveyed points (the original vertices) stay put. */
export function smoothMesh(mesh, { levels = 1, iterations = 10, strength = 0.5, keep = true } = {}) {
  let m = { v: mesh.v.map((p) => [...p]), f: tri(mesh) };
  const fixed = new Set(keep ? m.v.map((_, i) => i) : []);
  for (let l = 0; l < levels; l++) {
    const mid = new Map();
    const mp = (a, b) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!mid.has(k)) mid.set(k, m.v.push(m.v[a].map((x, i) => (x + m.v[b][i]) / 2)) - 1);
      return mid.get(k);
    };
    m.f = m.f.flatMap(([a, b, c]) => {
      const [ab, bc, ca] = [mp(a, b), mp(b, c), mp(c, a)];
      return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
    });
  }
  // boundary vertices keep their place too
  const edges = new Map();
  for (const f of m.f) for (let i = 0; i < 3; i++) {
    const [a, b] = [f[i], f[(i + 1) % 3]];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  const nb = m.v.map(() => new Set());
  for (const [k, cnt] of edges) {
    const [a, b] = k.split(',').map(Number);
    nb[a].add(b);
    nb[b].add(a);
    if (cnt === 1) fixed.add(a), fixed.add(b);
  }
  for (let it = 0; it < iterations; it++) {
    const y = m.v.map((p) => p[1]);
    m.v.forEach((p, i) => {
      if (fixed.has(i) || !nb[i].size) return;
      const avg = [...nb[i]].reduce((s, j) => s + y[j], 0) / nb[i].size;
      p[1] = y[i] + strength * (avg - y[i]);
    });
  }
  return m;
}

/** A TIN from contour lines (their points resampled), with flat triangles between two points of one contour lifted. */
export function contourSurface(lines, { spacing = 2, weed = 0.05 } = {}) {
  const v = [];
  const owner = [];
  const constraints = [];
  lines.forEach((l, li) => {
    const flat = l.pts.map((p) => [p[0], -p[2]]);
    const simple = DR.simplify(flat, weed, l.closed);
    const len = DR.length(simple, l.closed);
    const n = Math.max(l.closed ? 3 : 1, Math.ceil(len / spacing));
    const y = l.pts[0][1];
    const start = v.length;
    for (let k = 0; k < (l.closed ? n : n + 1); k++) {
      const [x, nn] = DR.pointAt(simple, (len * k) / n, l.closed);
      v.push([x, y, -nn]);
      owner.push(li);
    }
    for (let k = start; k < v.length - 1; k++) constraints.push([k, k + 1]);
    if (l.closed) constraints.push([v.length - 1, start]);
  });
  let { faces } = TR.triangulate(v, { constraints });
  // flat triangles (all three points on one contour): add a point in the middle at the height between this
  // contour and the nearest other one
  const extra = [];
  for (const t of faces) {
    if (!(owner[t[0]] === owner[t[1]] && owner[t[1]] === owner[t[2]])) continue;
    const c = [0, 1, 2].map((k) => (v[t[0]][k] + v[t[1]][k] + v[t[2]][k]) / 3);
    let best = null;
    v.forEach((p, i) => {
      if (owner[i] === owner[t[0]]) return;
      const d = Math.hypot(p[0] - c[0], p[2] - c[2]);
      if (!best || d < best.d) best = { d, y: p[1] };
    });
    if (best) extra.push([c[0], (c[1] + best.y) / 2, c[2]]);
  }
  if (extra.length) {
    v.push(...extra);
    faces = TR.triangulate(v, { constraints }).faces;
  }
  return { mesh: { v, f: faces }, lifted: extra.length };
}

/** A flat grid to sculpt: width × depth m, cells of spacing m, at height y. */
export function gridMesh(width, depth, spacing = 1, y = 0) {
  const nx = Math.max(1, Math.round(width / spacing));
  const nz = Math.max(1, Math.round(depth / spacing));
  const v = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) v.push([-width / 2 + (width * i) / nx, y, -depth / 2 + (depth * j) / nz]);
  const f = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      f.push([a, a + nx + 1, a + 1], [a + 1, a + nx + 1, a + nx + 2]);
    }
  return { v, f };
}

/** Brush weight at plan distance: shape (circle, ellipse, square), inner (full strength) and outer radius, falloff. */
export function brushWeight([dx, dz], { radius = 5, inner = 0, shape = 'circle', ratio = 0.5, angle = 0, falloff = 'smooth' }) {
  const a = (angle * Math.PI) / 180;
  const [u, w] = [dx * Math.cos(a) + dz * Math.sin(a), -dx * Math.sin(a) + dz * Math.cos(a)];
  const r = shape === 'square' ? Math.max(Math.abs(u), Math.abs(w)) : shape === 'ellipse' ? Math.hypot(u, w / Math.max(0.05, ratio)) : Math.hypot(u, w);
  if (r >= radius) return 0;
  if (r <= inner) return 1;
  const t = 1 - (r - inner) / (radius - inner || 1); // 1 inside → 0 at the edge
  return falloff === 'linear' ? t : falloff === 'sharp' ? t * t * t : falloff === 'plateau' ? Math.min(1, t * 3) : t * t * (3 - 2 * t);
}

/** One brush stroke on a mesh's vertex heights (a new mesh). operation: raise, lower, flatten, smooth, noise, terrace. */
export function sculpt(mesh, { at, operation = 'raise', strength = 0.5, height = null, step = 1, seed = 1, ...brush }) {
  const v = mesh.v.map((p) => [...p]);
  const W = v.map((p) => brushWeight([p[0] - at[0], p[2] - at[1]], brush));
  const hit = W.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);
  if (!hit.length) throw new Error('The brush touches no point of the surface: aim at it, or use a bigger radius.');
  let rnd = seed * 9301 + 49297;
  const rand = () => ((rnd = (rnd * 9301 + 49297) % 233280), rnd / 233280 - 0.5);
  const target = height ?? hit.reduce((s, i) => s + v[i][1] * W[i], 0) / hit.reduce((s, i) => s + W[i], 0);
  const nb = (i) => {
    const out = [];
    for (const f of mesh.f) if (f.includes(i)) for (const j of f) if (j !== i) out.push(j);
    return out;
  };
  for (const i of hit) {
    const w = W[i] * strength;
    const y = v[i][1];
    if (operation === 'raise') v[i][1] = y + w;
    else if (operation === 'lower') v[i][1] = y - w;
    else if (operation === 'flatten') v[i][1] = y + (target - y) * Math.min(1, w * 2);
    else if (operation === 'smooth') {
      const n = nb(i);
      if (n.length) v[i][1] = y + ((n.reduce((s, j) => s + mesh.v[j][1], 0) / n.length - y) * Math.min(1, w * 2));
    } else if (operation === 'noise') v[i][1] = y + rand() * w;
    else if (operation === 'terrace') v[i][1] = y + (Math.round(y / step) * step - y) * Math.min(1, w * 2);
    else throw new Error(`Unknown operation "${operation}": raise, lower, flatten, smooth, noise, terrace.`);
  }
  return { v, f: mesh.f.map((f) => [...f]), touched: hit.length };
}

/** ESRI ASCII grid (.asc) text to { width, height, values (row 0 = north), affine (project E / N), nodata }. */
export function parseAsciiGrid(text) {
  const lines = text.split(/\r?\n/);
  const head = {};
  let i = 0;
  for (; i < lines.length && /^[a-z_]+\s/i.test(lines[i].trim()); i++) {
    const [k, v] = lines[i].trim().split(/\s+/);
    head[k.toLowerCase()] = +v;
  }
  const { ncols: w, nrows: h, cellsize: cs } = head;
  if (!(w > 0 && h > 0 && cs > 0)) throw new Error('Not an ASCII grid (ncols, nrows, cellsize).');
  const values = new Float32Array(w * h);
  let k = 0;
  for (; i < lines.length && k < values.length; i++) for (const t of lines[i].trim().split(/\s+/)) if (t !== '') values[k++] = +t;
  if (k < values.length) throw new Error(`The grid is short: ${k} of ${values.length} values.`);
  const x0 = head.xllcorner ?? (head.xllcenter ?? 0) - cs / 2;
  const y0 = head.yllcorner ?? (head.yllcenter ?? 0) - cs / 2;
  return { width: w, height: h, values, nodata: head.nodata_value ?? -9999, affine: [cs, 0, x0, 0, -cs, y0 + h * cs] };
}

/** A grid of heights to a mesh: every step-th sample, cells with no data left out. toLocal maps (E, N, Z) to [x, y, z]. */
export function demMesh({ width, height, values, nodata, affine }, toLocal, { step = 1, max_points = 250000 } = {}) {
  let s = step;
  while ((width / s) * (height / s) > max_points) s++;
  const cols = Math.floor((width - 1) / s) + 1;
  const rows = Math.floor((height - 1) / s) + 1;
  const idx = new Int32Array(cols * rows).fill(-1);
  const v = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const val = values[r * s * width + c * s];
      if (!Number.isFinite(val) || val === nodata || val < -1e30) continue;
      const [u, w] = [c * s + 0.5, r * s + 0.5];
      const E = affine[0] * u + affine[1] * w + affine[2];
      const N = affine[3] * u + affine[4] * w + affine[5];
      idx[r * cols + c] = v.push(toLocal(E, N, val)) - 1;
    }
  const f = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const [a, b, d, e] = [idx[r * cols + c], idx[r * cols + c + 1], idx[(r + 1) * cols + c], idx[(r + 1) * cols + c + 1]];
      const n = [a, b, d, e].filter((x) => x >= 0).length;
      if (n === 4) f.push([a, d, b], [b, d, e]);
      else if (n === 3) f.push(a < 0 ? [b, d, e] : b < 0 ? [a, d, e] : d < 0 ? [a, e, b] : [a, d, b]); // one corner missing: the other three
    }
  if (!f.length) throw new Error('The grid has no cells with data.');
  return { mesh: { v, f }, step: s };
}

/** Flatten to a height inside an outline, blending over width m outside it (a pad stamped into a grid). */
export function stampMesh(mesh, outline, { y, width = 3 }) {
  const ring = outline.map((p) => [p[0], -p[2]]);
  const inside = ([x, n]) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > n !== ring[j][1] > n && x < ((ring[j][0] - ring[i][0]) * (n - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
    return c;
  };
  let touched = 0;
  const v = mesh.v.map((p) => {
    const q = [p[0], -p[2]];
    let w = 1;
    if (!inside(q)) {
      const d = DR.nearest(ring, q, true).d;
      const t = Math.max(0, 1 - d / width);
      w = t * t * (3 - 2 * t);
    }
    if (w > 0) touched++;
    return [p[0], p[1] + (y - p[1]) * w, p[2]];
  });
  if (!touched) throw new Error('The outline is not over the surface.');
  return { v, f: mesh.f.map((f) => [...f]), touched };
}
