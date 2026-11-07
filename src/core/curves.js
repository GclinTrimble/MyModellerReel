// Curves and sweeps. A curve is { kind: 'polyline' | 'spline' | 'bezier', points: [[x,y,z]...], closed }.
// spline: centripetal Catmull-Rom through every point (no overshoot, no cusps). bezier: cubic segments
// p0 c c p1 c c p2 … so it needs 3k+1 points. Pure module, Node-tested.
import * as G from './geometry.js';

export const KINDS = ['polyline', 'spline', 'bezier'];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Barry–Goldman evaluation of a centripetal Catmull-Rom span p1→p2 at t ∈ [0, 1]. */
function catmull(p0, p1, p2, p3, t) {
  const k = (a, b) => Math.max(1e-6, G.len(G.sub(b, a)) ** 0.5);
  const t0 = 0;
  const t1 = t0 + k(p0, p1);
  const t2 = t1 + k(p1, p2);
  const t3 = t2 + k(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const A1 = lerp3(p0, p1, (u - t0) / (t1 - t0));
  const A2 = lerp3(p1, p2, (u - t1) / (t2 - t1));
  const A3 = lerp3(p2, p3, (u - t2) / (t3 - t2));
  const B1 = lerp3(A1, A2, (u - t0) / (t2 - t0));
  const B2 = lerp3(A2, A3, (u - t1) / (t3 - t1));
  return lerp3(B1, B2, (u - t1) / (t2 - t1));
}

function bezier(p0, c0, c1, p1, t) {
  const s = 1 - t;
  return [0, 1, 2].map((k) => s * s * s * p0[k] + 3 * s * s * t * c0[k] + 3 * s * t * t * c1[k] + t * t * t * p1[k]);
}

/** Check a curve and explain what is wrong in words a caller can fix. */
export function checkCurve({ kind = 'polyline', points, closed = false }) {
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}.`);
  if (!Array.isArray(points) || points.length < 2 || points.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((x) => !Number.isFinite(x))))
    throw new Error('A curve needs at least 2 points, each [x, y, z].');
  if (kind === 'bezier' && !closed && (points.length - 1) % 3) throw new Error(`A bezier needs 3k+1 points (point, handle, handle, point, …); got ${points.length}.`);
  if (kind === 'bezier' && closed && points.length % 3) throw new Error(`A closed bezier needs 3k points; got ${points.length}.`);
  if (closed && points.length < 3) throw new Error('A closed curve needs at least 3 points.');
}

/** The curve as a polyline. Closed curves repeat their first point at the end. */
export function samplePoints(curve, perSpan = 16) {
  checkCurve(curve);
  const { kind = 'polyline', points: P, closed = false } = curve;
  if (kind === 'polyline') return closed ? [...P.map((p) => [...p]), [...P[0]]] : P.map((p) => [...p]);
  const out = [];
  if (kind === 'spline') {
    const n = P.length;
    const at = (i) => (closed ? P[(i + n) % n] : i < 0 ? G.sub(G.scl(P[0], 2), P[1]) : i >= n ? G.sub(G.scl(P[n - 1], 2), P[n - 2]) : P[i]);
    const spans = closed ? n : n - 1;
    for (let i = 0; i < spans; i++) for (let s = 0; s < perSpan; s++) out.push(catmull(at(i - 1), at(i), at(i + 1), at(i + 2), s / perSpan));
    out.push([...(closed ? P[0] : P[n - 1])]);
    return out;
  }
  const Q = closed ? [...P, P[0]] : P;
  for (let i = 0; i + 3 < Q.length; i += 3) for (let s = 0; s < perSpan; s++) out.push(bezier(Q[i], Q[i + 1], Q[i + 2], Q[i + 3], s / perSpan));
  out.push([...Q.at(-1)]);
  return out;
}

export const polyLength = (pts) => pts.slice(1).reduce((s, p, i) => s + G.len(G.sub(p, pts[i])), 0);

/** Point and unit tangent at a fraction u (0..1) of the polyline's length. */
export function pointAt(pts, u) {
  const total = polyLength(pts);
  let want = Math.min(1, Math.max(0, u)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = G.len(G.sub(pts[i], pts[i - 1]));
    if (want <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, want / seg) : 0;
      return { point: lerp3(pts[i - 1], pts[i], t), tangent: G.norm(G.sub(pts[i], pts[i - 1])) };
    }
    want -= seg;
  }
  return { point: [...pts[0]], tangent: [1, 0, 0] };
}

/** Drop points closer than eps to the previous one (they have no tangent). */
const dedupe = (pts, eps = 1e-7) => pts.filter((p, i) => !i || G.len(G.sub(p, pts[i - 1])) > eps);

/**
 * Sweep a 2D profile ([u, v] pairs: u to the right of the travel direction, v up) along a path. The profile stays
 * upright (v follows world up) unless the path runs vertically, where frames are carried along without twist.
 * Corners are mitred so the section keeps its true size on both legs. Open paths get end caps.
 * Returns a closed, outward-facing mesh in the path's coordinates.
 */
export function sweep(profile, path, { closed = null } = {}) {
  let pts = dedupe(path);
  if (pts.length < 2) throw new Error('The path is too short to sweep along.');
  const isClosed = closed ?? (pts.length > 3 && G.len(G.sub(pts[0], pts.at(-1))) < 1e-6);
  if (isClosed && G.len(G.sub(pts[0], pts.at(-1))) < 1e-6) pts = pts.slice(0, -1);
  if (profile.length < 3) throw new Error('A profile needs at least 3 points.');
  const n = pts.length;
  const seg = (i) => G.norm(G.sub(pts[(i + 1) % n], pts[i])); // direction of the leg leaving point i
  const legIn = (i) => (i === 0 && !isClosed ? seg(0) : seg((i - 1 + n) % n));
  const legOut = (i) => (i === n - 1 && !isClosed ? seg(n - 2) : seg(i));
  const rings = [];
  let prevR = null;
  for (let i = 0; i < n; i++) {
    const tin = legIn(i);
    const tout = legOut(i);
    const T = G.norm(G.add(tin, tout));
    let R;
    if (Math.abs(T[1]) < 0.99) R = G.norm(G.cross(T, [0, 1, 0]));
    else {
      // vertical: carry the previous right vector over (no twist); the very first one faces +x
      const base = prevR || [1, 0, 0];
      R = G.norm(G.sub(base, G.scl(T, G.dot(base, T))));
    }
    const U = G.cross(R, T);
    prevR = R;
    // mitre: stretch the section along the bend so each leg sees the true profile
    const cosHalf = Math.max(0.2, G.dot(T, tin));
    const bend = G.sub(tout, tin);
    const k = G.len(bend) > 1e-9 ? G.norm(G.sub(bend, G.scl(T, G.dot(bend, T)))) : null;
    rings.push(
      profile.map(([u, v]) => {
        let off = G.add(G.scl(R, u), G.scl(U, v));
        if (k) off = G.add(off, G.scl(k, (1 / cosHalf - 1) * G.dot(off, k)));
        return G.add(pts[i], off);
      }),
    );
  }
  const m = profile.length;
  const v = rings.flat();
  const f = [];
  const spans = isClosed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const a = i * m;
    const b = ((i + 1) % n) * m;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      f.push([a + j, b + j, b + j1, a + j1]);
    }
  }
  // (R, U) is seen from behind (R × U = −T), so a counter-clockwise profile faces backwards: right for the start cap
  if (!isClosed) {
    f.push([...Array(m).keys()]);
    f.push([...Array(m).keys()].map((j) => (n - 1) * m + j).reverse());
  }
  return G.orient({ v, f });
}
