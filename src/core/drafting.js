// 2D drafting on polylines (#147, and the clean-up of extracted linework #145). Points are [x, y] in a plan frame
// with y to the north (the model's −z), so "left" is left when looking down. Curves carry heights: lift() puts them
// back on the 3D polyline a result came from.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const dist = (a, b) => len(sub(a, b));
const close = (pts, closed) => (closed ? [...pts, pts[0]] : pts);

/** Segment p1p2 against q1q2: { t, u, p } with t, u in [0, 1] when they cross; `infinite` drops the bounds. */
export function intersect(p1, p2, q1, q2, infinite = false) {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(q1, p1), s) / den;
  const u = cross(sub(q1, p1), r) / den;
  if (!infinite && (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9)) return null;
  return { t, u, p: add(p1, mul(r, t)) };
}

export const length = (pts, closed = false) => close(pts, closed).slice(1).reduce((s, p, i, a) => s + dist(p, i ? a[i - 1] : pts[0]), 0);

/** Nearest place on a polyline: { i (segment), t, s (distance along), p, d }. */
export function nearest(pts, q, closed = false) {
  const P = close(pts, closed);
  let best = null;
  let s = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const ab = sub(P[i + 1], a);
    const L = len(ab);
    const t = L ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / (L * L))) : 0;
    const p = add(a, mul(ab, t));
    const d = dist(p, q);
    if (!best || d < best.d) best = { i, t, s: s + t * L, p, d };
    s += L;
  }
  return best;
}

/** The point at distance s along. */
export function pointAt(pts, s, closed = false) {
  const P = close(pts, closed);
  for (let i = 0; i < P.length - 1; i++) {
    const L = dist(P[i], P[i + 1]);
    if (s <= L || i === P.length - 2) return add(P[i], mul(sub(P[i + 1], P[i]), L ? Math.min(1, s / L) : 0));
    s -= L;
  }
  return P[0];
}

/** The part of a polyline between distances s0 < s1. */
export function slice(pts, s0, s1, closed = false) {
  const P = close(pts, closed);
  const out = [pointAt(P, s0)];
  let s = 0;
  for (let i = 1; i < P.length; i++) {
    s += dist(P[i - 1], P[i]);
    if (s > s0 + 1e-9 && s < s1 - 1e-9) out.push(P[i]);
  }
  out.push(pointAt(P, s1));
  return out;
}

/** Douglas–Peucker; also merges collinear runs. */
export function simplify(pts, eps, closed = false) {
  if (pts.length < 3) return pts.slice();
  const P = closed ? [...pts, pts[0]] : pts;
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let w = -1;
    let dm = 0;
    for (let k = i + 1; k < j; k++) {
      const n = nearest([P[i], P[j]], P[k]).d;
      if (n > dm) (dm = n), (w = k);
    }
    if (w > 0 && dm > eps) (keep[w] = 1), stack.push([i, w], [w, j]);
  }
  const out = P.filter((_, k) => keep[k]);
  if (closed) out.pop();
  return out;
}

/** Offset to the left by d (negative: right). Mitred corners, bevelled past 4 × d. */
export function offset(pts, d, closed = false) {
  const n = pts.length;
  const seg = (i) => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const t = norm(sub(b, a));
    const l = [-t[1], t[0]];
    return [add(a, mul(l, d)), add(b, mul(l, d))];
  };
  const S = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) if (dist(pts[i], pts[(i + 1) % n]) > 1e-12) S.push(seg(i));
  if (!S.length) throw new Error('The curve has no length.');
  const out = [];
  const join = (A, B) => {
    const x = intersect(A[0], A[1], B[0], B[1], true);
    if (!x) return [A[1]];
    if (dist(x.p, A[1]) > 4 * Math.abs(d)) return [A[1], B[0]];
    return [x.p];
  };
  if (!closed) out.push(S[0][0]);
  for (let i = 0; i < S.length - (closed ? 0 : 1); i++) out.push(...join(S[i], S[(i + 1) % S.length]));
  if (!closed) out.push(S.at(-1)[1]);
  else out.unshift(out.pop());
  return out;
}

/** Every crossing of a polyline with cutter polylines, as distances along it. */
export function crossings(pts, cutters, closed = false) {
  const P = close(pts, closed);
  const out = [];
  let s = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const L = dist(P[i], P[i + 1]);
    for (const c of cutters) for (let j = 0; j < c.length - 1; j++) {
      const x = intersect(P[i], P[i + 1], c[j], c[j + 1]);
      if (x) out.push(s + x.t * L);
    }
    s += L;
  }
  return [...new Set(out.map((x) => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
}

/** Cut away the piece nearest `at` between crossings with the cutters. Returns the pieces left. */
export function trim(pts, cutters, at, closed = false) {
  const total = length(pts, closed);
  const cuts = crossings(pts, cutters, closed).filter((s) => s > 1e-6 && s < total - 1e-6);
  if (!cuts.length) throw new Error('Nothing to trim against: the curve does not cross the boundaries.');
  const s = nearest(pts, at, closed).s;
  if (closed) {
    // the piece between the cuts around s goes; the rest is one open piece
    const after = cuts.find((c) => c > s) ?? cuts[0] + total;
    const before = [...cuts].reverse().find((c) => c <= s) ?? cuts.at(-1) - total;
    return [slice([...pts, ...pts, pts[0]], after, before + total)];
  }
  const lo = [...cuts].reverse().find((c) => c <= s) ?? 0;
  const hi = cuts.find((c) => c > s) ?? total;
  const out = [];
  if (lo > 1e-9) out.push(slice(pts, 0, lo));
  if (hi < total - 1e-9) out.push(slice(pts, hi, total));
  return out;
}

/** Extend the end nearest `at` ('start' | 'end' | a point) straight on to the nearest boundary ahead. */
export function extend(pts, cutters, end = 'end') {
  const atStart = end === 'start' || (Array.isArray(end) && dist(end, pts[0]) < dist(end, pts.at(-1)));
  const P = atStart ? [...pts].reverse() : pts.slice();
  const a = P.at(-2);
  const b = P.at(-1);
  let best = null;
  for (const c of cutters) for (let j = 0; j < c.length - 1; j++) {
    const x = intersect(a, b, c[j], c[j + 1], true);
    if (!x || x.t <= 1 + 1e-9 || x.u < -1e-9 || x.u > 1 + 1e-9) continue;
    if (!best || x.t < best.t) best = x;
  }
  if (!best) throw new Error('No boundary ahead of that end to extend to.');
  P[P.length - 1] = best.p;
  return atStart ? P.reverse() : P;
}

/** Round the corner at vertex i (or every corner when i is null) with radius r. */
export function fillet(pts, r, i = null, closed = false, chamferD = null) {
  const n = pts.length;
  const corners = i === null ? [...Array(n).keys()].filter((k) => closed || (k > 0 && k < n - 1)) : [i];
  const out = [];
  const rep = new Map();
  for (const k of corners) {
    const p = pts[k];
    const a = pts[(k - 1 + n) % n];
    const b = pts[(k + 1) % n];
    const u = norm(sub(a, p));
    const v = norm(sub(b, p));
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
    if (ang < 1e-6 || Math.PI - ang < 1e-6) continue; // straight or folded back: nothing to round
    const t = chamferD ? chamferD[0] : r / Math.tan(ang / 2);
    const t2 = chamferD ? chamferD[1] : t;
    if (t > dist(a, p) * (i === null ? 0.5 : 1) + 1e-9 || t2 > dist(b, p) * (i === null ? 0.5 : 1) + 1e-9) throw new Error(`The ${chamferD ? 'chamfer' : `radius ${r}`} does not fit at corner ${k}: the sides are too short.`);
    const p1 = add(p, mul(u, t));
    const p2 = add(p, mul(v, t2));
    if (chamferD) {
      rep.set(k, [p1, p2]);
      continue;
    }
    const bis = norm(add(u, v));
    const c = add(p, mul(bis, r / Math.sin(ang / 2)));
    const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    let a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    let sw = a2 - a1;
    if (sw > Math.PI) sw -= 2 * Math.PI;
    if (sw < -Math.PI) sw += 2 * Math.PI;
    const segs = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 24)));
    rep.set(k, Array.from({ length: segs + 1 }, (_, q) => add(c, mul([Math.cos(a1 + (sw * q) / segs), Math.sin(a1 + (sw * q) / segs)], r))));
  }
  for (let k = 0; k < n; k++) out.push(...(rep.get(k) || [pts[k]]));
  return out;
}

/** Fillet (or chamfer) two separate polylines at their nearest ends: both are cut or stretched to meet. */
export function filletPair(A, B, r, chamferD = null) {
  const ends = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([x, y]) => ({ x, y, d: dist(x ? A.at(-1) : A[0], y ? B.at(-1) : B[0]) }));
  const { x, y } = ends.reduce((m, e) => (e.d < m.d ? e : m));
  const a = x ? A.slice() : [...A].reverse(); // a ends at the corner
  const b = y ? [...B].reverse() : B.slice(); // b starts at the corner
  const X = intersect(a.at(-2), a.at(-1), b[0], b[1], true);
  if (!X) throw new Error('The two curves are parallel there.');
  a[a.length - 1] = X.p;
  b[0] = X.p;
  const joined = [...a, ...b.slice(1)];
  return fillet(joined, r, a.length - 1, false, chamferD);
}

/** Join polylines whose ends meet within tol into longer ones (same `key` only). lines: { pts, closed, key }. */
export function join(lines, tol = 1e-3) {
  const open = lines.filter((l) => !l.closed && l.pts.length > 1);
  const out = lines.filter((l) => l.closed || l.pts.length < 2);
  const cell = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const index = new Map();
  const put = (k, i) => (index.get(k) || index.set(k, []).get(k)).push(i);
  open.forEach((l, i) => (put(cell(l.pts[0]), i), put(cell(l.pts.at(-1)), i)));
  const used = new Uint8Array(open.length);
  const near = (p, key) => {
    const [cx, cy] = [Math.round(p[0] / tol), Math.round(p[1] / tol)];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const i of index.get(`${cx + dx},${cy + dy}`) || []) {
        if (used[i] || open[i].key !== key) continue;
        if (dist(open[i].pts[0], p) <= tol) return [i, false];
        if (dist(open[i].pts.at(-1), p) <= tol) return [i, true];
      }
    return null;
  };
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let pts = open[i].pts.slice();
    for (const dir of [1, 0]) {
      if (!dir) pts.reverse();
      for (let h; (h = near(pts.at(-1), open[i].key)); ) {
        used[h[0]] = 1;
        const q = h[1] ? [...open[h[0]].pts].reverse() : open[h[0]].pts;
        pts.push(...q.slice(1));
      }
    }
    pts.reverse();
    const closed = pts.length > 3 && dist(pts[0], pts.at(-1)) <= tol;
    if (closed) pts.pop();
    out.push({ ...open[i], pts, closed });
  }
  return out;
}

/** Drop repeated points, zero-length and duplicate lines (either direction). */
export function dedupe(lines, tol = 1e-3) {
  const seen = new Set();
  const out = [];
  const r = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  for (const l of lines) {
    const pts = l.pts.filter((p, i) => !i || dist(p, l.pts[i - 1]) > tol);
    if (pts.length < 2 || length(pts) <= tol) continue;
    const k = pts.map(r).join(';');
    const kr = [...pts].reverse().map(r).join(';');
    const key = `${l.key}|${k < kr ? k : kr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...l, pts });
  }
  return out;
}

/** Points every `spacing` (or `count` equal parts) along, ends included. */
export function divide(pts, { count, spacing }, closed = false) {
  const L = length(pts, closed);
  const n = count || Math.max(1, Math.floor(L / spacing + 1e-9));
  const step = count ? L / n : spacing;
  const out = [];
  for (let k = 0; k <= n; k++) if (k * step <= L + 1e-9 && !(closed && k === n && count)) out.push(pointAt(pts, k * step, closed));
  return out;
}

/** Split at the point nearest `at` (two pieces), or remove the part between two points. */
export function breakAt(pts, at, at2 = null, closed = false) {
  const s1 = nearest(pts, at, closed).s;
  const total = length(pts, closed);
  if (closed) {
    const s2 = at2 ? nearest(pts, at2, closed).s : s1;
    const [lo, hi] = [Math.min(s1, s2), Math.max(s1, s2)];
    const P = [...pts, ...pts, pts[0]];
    return [slice(P, hi, lo + total)];
  }
  if (!at2) return [slice(pts, 0, s1), slice(pts, s1, total)].filter((p) => length(p) > 1e-9);
  const s2 = nearest(pts, at2).s;
  const [lo, hi] = [Math.min(s1, s2), Math.max(s1, s2)];
  return [slice(pts, 0, lo), slice(pts, hi, total)].filter((p) => length(p) > 1e-9);
}

/** Heights for 2D results from the 3D polyline they came from (nearest place, interpolated). */
export function lift(pts2, src3, closed = false) {
  const flat = src3.map((p) => [p[0], -p[2]]);
  const P = close(src3, closed);
  return pts2.map((q) => {
    const h = nearest(flat, q, closed);
    const y = P[h.i][1] + (P[h.i + 1][1] - P[h.i][1]) * h.t;
    return [q[0], y, -q[1]];
  });
}

export const flat = (pts3) => pts3.map((p) => [p[0], -p[2]]);
