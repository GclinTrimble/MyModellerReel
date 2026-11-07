// Underlays (#140, #142, #143, #144): an image or a PDF page lying on its entity's plane. Its own coordinates (u, v)
// are pixels (images) or PDF points (pages), origin top-left, v down. `affine` [a, b, c, d, e, f] maps them to the
// entity's local plan in metres: X = a·u + b·v + c (east), Y = d·u + e·v + f (north); model x = X, z = −Y.
// World files use the same six numbers (A, D, B, E, C, F) at pixel centres, in project E / N.

export const apply = ([a, b, c, d, e, f], [u, v]) => [a * u + b * v + c, d * u + e * v + f];

export function invert([a, b, c, d, e, f]) {
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-18) throw new Error('The drawing has no size (scale 0).');
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
}

/** a ∘ b: apply b first, then a (both [a..f]). */
export const compose = ([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) => [a1 * a2 + b1 * d2, a1 * b2 + b1 * e2, a1 * c2 + b1 * f2 + c1, d1 * a2 + e1 * d2, d1 * b2 + e1 * e2, d1 * c2 + e1 * f2 + f1];

/** Metres per source unit: PDF points (1/72 in) or pixels at dpi, at a drawing scale "1:500" (or 500). */
export function unitScale(kind, drawingScale = 1, dpi = 96) {
  const n = typeof drawingScale === 'string' ? Number(drawingScale.split(':').pop()) : drawingScale;
  if (!(n > 0)) throw new Error(`Drawing scale "${drawingScale}" is not like "1:500".`);
  return (kind === 'pdf' ? 0.0254 / 72 : 0.0254 / dpi) * n;
}

/** Plain placement: s metres per unit, the top-left corner at (x0, y0), turned so north is up. */
export const placeAffine = (s, [x0, y0] = [0, 0]) => [s, 0, x0, 0, -s, y0];

const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
/** Plan bearing of p → q, degrees clockwise from north (+Y). */
export const bearing = (p, q) => ((Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI + 360) % 360;

/** Scale about the image of a so that a → b measures `distance`. a, b in source units. */
export function calibrateScale(A, a, b, distance) {
  const [pa, pb] = [apply(A, a), apply(A, b)];
  const d = dist(pa, pb);
  if (!(d > 1e-12) || !(distance > 0)) throw new Error('Pick two different points and a distance above 0.');
  const k = distance / d;
  return { affine: compose([k, 0, pa[0] * (1 - k), 0, k, pa[1] * (1 - k)], A), factor: k };
}

/** Turn about the image of a so that a → b points along `deg` (clockwise from north). */
export function calibrateOrient(A, a, b, deg) {
  const [pa, pb] = [apply(A, a), apply(A, b)];
  if (dist(pa, pb) < 1e-12) throw new Error('Pick two different points.');
  const turn = deg - bearing(pa, pb);
  const r = (turn * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  // clockwise in plan: X' = c·X + s·Y, Y' = −s·X + c·Y, about pa
  const R = [c, s, pa[0] - c * pa[0] - s * pa[1], -s, c, pa[1] + s * pa[0] - c * pa[1]];
  return { affine: compose(R, A), turned: ((turn % 360) + 540) % 360 - 180 };
}

/** Shift so the source point a lands on plan point to [X, Y]. */
export function calibrateMove(A, a, to) {
  const p = apply(A, a);
  return { affine: compose([1, 0, to[0] - p[0], 0, 1, to[1] - p[1]], A), by: [to[0] - p[0], to[1] - p[1]] };
}

/** Least squares by normal equations (small systems): rows of [x1..xn | y]. */
function lsq(rows, n) {
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const r of rows) for (let i = 0; i < n; i++) for (let j = 0; j <= n; j++) M[i][j] += r[i] * r[j === n ? n : j];
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-14) throw new Error('The control points are in a line or on top of each other: spread them out.');
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Solve the source → plan transform from control pairs [{ u, v, X, Y }]. method: similarity / helmert (scale,
 * rotation, shift: 4 parameters, 2+ pairs) or affine (6 parameters, 3+ pairs; allows skew and two scales).
 */
export function solve(pairs, method = 'auto') {
  const n = pairs.length;
  const m = method === 'auto' ? 'helmert' : method === 'similarity' ? 'helmert' : method;
  if (m === 'affine') {
    if (n < 3) throw new Error('An affine fit needs 3 control points or more.');
    // centred for a well-conditioned solve
    const [cu, cv] = [pairs.reduce((s, p) => s + p.u, 0) / n, pairs.reduce((s, p) => s + p.v, 0) / n];
    const X = lsq(pairs.map((p) => [p.u - cu, p.v - cv, 1, p.X]), 3);
    const Y = lsq(pairs.map((p) => [p.u - cu, p.v - cv, 1, p.Y]), 3);
    return report(pairs, [X[0], X[1], X[2] - X[0] * cu - X[1] * cv, Y[0], Y[1], Y[2] - Y[0] * cu - Y[1] * cv], 'affine');
  }
  if (m !== 'helmert') throw new Error(`Unknown method "${method}": similarity, helmert or affine.`);
  if (n < 2) throw new Error('Georeferencing needs 2 control points or more.');
  // X = p·u + q·v + c, Y = q·u − p·v + f (conformal with the source's v pointing down)
  const [cu, cv] = [pairs.reduce((s, p) => s + p.u, 0) / n, pairs.reduce((s, p) => s + p.v, 0) / n];
  const rows = pairs.flatMap((p) => [
    [p.u - cu, p.v - cv, 1, 0, p.X],
    [-(p.v - cv), p.u - cu, 0, 1, p.Y],
  ]);
  const [P, Qq, c, f] = lsq(rows, 4);
  return report(pairs, [P, Qq, c - P * cu - Qq * cv, Qq, -P, f - Qq * cu + P * cv], 'helmert');
}

function report(pairs, affine, method) {
  const res = pairs.map((p) => {
    const [X, Y] = apply(affine, [p.u, p.v]);
    return { dX: p.X - X, dY: p.Y - Y, d: Math.hypot(p.X - X, p.Y - Y) };
  });
  const dof = pairs.length * 2 - (method === 'affine' ? 6 : 4);
  const rms = Math.sqrt(res.reduce((s, r) => s + r.d * r.d, 0) / pairs.length);
  const worst = res.reduce((w, r, i) => (r.d > res[w].d ? i : w), 0);
  const [a, b, , d, e] = affine;
  return { affine, method, residuals: res, rms, worst, redundancy: dof, scale: [Math.hypot(a, d), Math.hypot(b, e)], rotation: (Math.atan2(d, a) * -180) / Math.PI };
}

/** World file text (6 lines) for an affine, in project E / N: base = [E0, N0] of the local origin. */
export function worldFile(A, base = [0, 0]) {
  const [a, b, c, d, e, f] = A;
  const [C, F] = apply(A, [0.5, 0.5]);
  return [a, d, b, e, C + base[0], F + base[1]].map((x) => (Math.round(x * 1e10) / 1e10).toString()).join('\n') + '\n';
}

/** Read a world file (A, D, B, E, C, F at the upper-left pixel centre) to an affine in project E / N. */
export function parseWorldFile(text) {
  const n = String(text).trim().split(/\s+/).map(Number);
  if (n.length < 6 || n.slice(0, 6).some((x) => !Number.isFinite(x))) throw new Error('A world file has six numbers, one per line.');
  const [A, D, B, E, C, F] = n;
  return [A, B, C - 0.5 * A - 0.5 * B, D, E, F - 0.5 * D - 0.5 * E];
}

/** GeoTIFF placement tags to an affine in project E / N (PixelIsArea: tie points at pixel corners). */
export function affineFromGeoTiff({ ModelTransformation: M, ModelPixelScale: S, ModelTiepoint: T }) {
  if (M?.length >= 8) return [M[0], M[1], M[3], M[4], M[5], M[7]];
  if (S && T?.length >= 6) return [S[0], 0, T[3] - T[0] * S[0], 0, -S[1], T[4] + T[1] * S[1]];
  return null;
}

/** Shift an affine in project E / N to local plan metres (subtract the base point E, N). */
export const toLocalAffine = ([a, b, c, d, e, f], [E0, N0]) => [a, b, c - E0, d, e, f - N0];

/** The four corners of the source rectangle on the plan. */
export const corners = (A, [w, h]) => [[0, 0], [w, 0], [w, h], [0, h]].map((p) => apply(A, p));
