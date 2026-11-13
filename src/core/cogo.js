// COGO (#227): coordinate geometry on survey coordinates, the way a field book reads. Points are { n, e, z } in metres
// (the document's survey frame), directions are azimuths in degrees clockwise from north. solve() is what the commands,
// the COGO panel's live preview and the AI share: it takes the user's words (names, project units, bearings as typed)
// and returns the answer, the points it would store and a report line. Pure module, Node-tested.
import * as D from './document.js';
import * as S from './survey.js';

const RAD = Math.PI / 180;
export const norm360 = (a) => ((a % 360) + 360) % 360;

/**
 * A direction as an azimuth. Accepts an azimuth (45.5, "45°30'", "45 30 00"), a quadrant bearing ("N45°30'E",
 * "S 12 30 W"), or, with the previous leg's azimuth `prev`, a turn: "R90" / "L45" (deflection from the direction of
 * travel) or "AR270" (angle right, clockwise from the backsight).
 */
export function direction(v, { prev = null, angles = 'deg' } = {}) {
  if (typeof v === 'number') return norm360(S.parseAngle(v, angles));
  const s = String(v).trim().replace(/\s+/g, ' ');
  const q = s.match(/^([NS])\s*(.+?)\s*([EW])$/i);
  if (q) {
    const a = S.parseAngle(q[2], angles);
    if (a < 0 || a > 90) throw new Error(`A quadrant bearing is 0 to 90°: "${s}".`);
    const ns = q[1].toUpperCase();
    const ew = q[3].toUpperCase();
    return norm360(ns === 'N' ? (ew === 'E' ? a : -a) : ew === 'E' ? 180 - a : 180 + a);
  }
  const t = s.match(/^(AR|R|L)\s*(.+)$/i);
  if (t) {
    if (prev === null) throw new Error(`"${s}" is a turn: it needs a direction before it (a backsight or an earlier leg).`);
    const a = S.parseAngle(t[2], angles);
    const k = t[1].toUpperCase();
    return norm360(k === 'AR' ? prev + 180 + a : k === 'R' ? prev + a : prev - a);
  }
  return norm360(S.parseAngle(s, angles));
}

/** "N 45°30'00" E" for an azimuth. */
export function quadrant(az) {
  const a = norm360(az);
  const [ns, ew, q] = a <= 90 ? ['N', 'E', a] : a <= 180 ? ['S', 'E', 180 - a] : a <= 270 ? ['S', 'W', a - 180] : ['N', 'W', 360 - a];
  return `${ns} ${S.formatAngle(q, 'dms')} ${ew}`;
}

/** Between two points: azimuth, horizontal and slope distance, height difference, grade (%). */
export function inverse(a, b) {
  const dE = b.e - a.e;
  const dN = b.n - a.n;
  const dz = (b.z ?? 0) - (a.z ?? 0);
  const hd = Math.hypot(dE, dN);
  return { azimuth: norm360(Math.atan2(dE, dN) / RAD), hd, sd: Math.hypot(hd, dz), dz, grade: hd > 1e-9 ? (dz / hd) * 100 : null, dE, dN };
}

/** The point at an azimuth and horizontal distance (and height difference) from a. */
export const polar = (a, az, hd, dz = 0) => ({ n: a.n + hd * Math.cos(az * RAD), e: a.e + hd * Math.sin(az * RAD), z: (a.z ?? 0) + dz });

/**
 * Legs from a start point: [{ dir, dist, dz, side }]. Directions may turn from the last leg (or from `prev`, the
 * direction of travel arriving at the start). Sideshots (side) do not move on. Returns the points and the length.
 */
export function traverse(start, legs, { prev = null, angles = 'deg' } = {}) {
  let cur = start;
  let length = 0;
  const pts = [];
  for (const [i, l] of legs.entries()) {
    if (!(l.dist >= 0)) throw new Error(`Leg ${i + 1} needs a distance.`);
    const az = direction(l.dir, { prev, angles });
    const p = { ...polar(cur, az, l.dist, l.dz || 0), az, side: !!l.side, from: cur, leg: i };
    pts.push(p);
    if (!l.side) (cur = p), (prev = az), (length += l.dist);
  }
  return { points: pts, length };
}

/** How far the end of a traverse misses where it should be: error, precision 1:N (length / linear error). */
export function closure(end, target, length) {
  const dN = end.n - target.n;
  const dE = end.e - target.e;
  const linear = Math.hypot(dN, dE);
  return { dN, dE, dz: (end.z ?? 0) - (target.z ?? 0), linear, ratio: linear > 1e-9 ? length / linear : Infinity, azimuth: norm360(Math.atan2(dE, dN) / RAD) };
}

/** Compass (Bowditch) rule: spread the misclosure over the stations by distance travelled; sideshots move with their station. */
export function compassAdjust(trav, target) {
  const main = trav.points.filter((p) => !p.side);
  if (!main.length) return trav;
  const c = closure(main.at(-1), target, trav.length);
  let run = 0;
  const fix = new Map();
  const out = [];
  for (const p of trav.points) {
    if (p.side) {
      const k = fix.get(p.from) || { n: 0, e: 0, z: 0 };
      out.push({ ...p, n: p.n - k.n, e: p.e - k.e, z: p.z - k.z });
      continue;
    }
    run += Math.hypot(p.n - p.from.n, p.e - p.from.e);
    const f = trav.length ? run / trav.length : 0;
    const k = { n: c.dN * f, e: c.dE * f, z: c.dz * f };
    fix.set(p, k);
    out.push({ ...p, n: p.n - k.n, e: p.e - k.e, z: p.z - k.z });
  }
  return { ...trav, points: out, adjusted: c };
}

/** Area (m², always positive) and perimeter of a ring of points. */
export function area(pts) {
  let a = 0;
  let per = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.e * q.n - q.e * p.n;
    per += Math.hypot(q.e - p.e, q.n - p.n);
  }
  return { area: Math.abs(a) / 2, perimeter: per };
}

// ---------------------------------------------------------------- intersections (one or two answers)

const unit = (az) => [Math.sin(az * RAD), Math.cos(az * RAD)]; // [dE, dN]

/** Two lines, each a point and an azimuth. null when parallel. */
export function bearingBearing(a, az1, b, az2) {
  const [u1, v1] = unit(az1);
  const [u2, v2] = unit(az2);
  const den = u1 * v2 - v1 * u2;
  if (Math.abs(den) < 1e-12) return [];
  const t = ((b.e - a.e) * v2 - (b.n - a.n) * u2) / den;
  return [{ e: a.e + u1 * t, n: a.n + v1 * t, z: a.z ?? 0 }];
}

/** A line (a point and an azimuth) and a circle (centre b, radius r): 0–2 points, the nearer one first. */
export function bearingDistance(a, az, b, r) {
  const [u, v] = unit(az);
  const fe = a.e - b.e;
  const fn = a.n - b.n;
  const B = fe * u + fn * v;
  const disc = B * B - (fe * fe + fn * fn - r * r);
  if (disc < -1e-9) return [];
  const s = Math.sqrt(Math.max(0, disc));
  const ts = s < 1e-9 ? [-B] : [-B - s, -B + s].sort((x, y) => Math.abs(x) - Math.abs(y));
  return ts.map((t) => ({ e: a.e + u * t, n: a.n + v * t, z: a.z ?? 0, ahead: t >= -1e-9 }));
}

/** Two circles: 0–2 points, the one left of a→b first. */
export function distanceDistance(a, r1, b, r2) {
  const d = Math.hypot(b.e - a.e, b.n - a.n);
  if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const x = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const y = Math.sqrt(Math.max(0, r1 * r1 - x * x));
  const ue = (b.e - a.e) / d;
  const un = (b.n - a.n) / d;
  const m = { e: a.e + ue * x, n: a.n + un * x };
  const left = { e: m.e - un * y, n: m.n + ue * y, z: a.z ?? 0, side: 'left' };
  const right = { e: m.e + un * y, n: m.n - ue * y, z: a.z ?? 0, side: 'right' };
  return y < 1e-9 ? [left] : [left, right];
}

// ---------------------------------------------------------------- along a line

/** Station along a polyline [{ n, e }] and offset from it (+ right, − left, looking along the line). */
export function stationOffset(line, q, start = 0) {
  let best = null;
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const de = b.e - a.e;
    const dn = b.n - a.n;
    const L = Math.hypot(de, dn);
    const last = i === line.length - 2;
    let t = L ? ((q.e - a.e) * de + (q.n - a.n) * dn) / (L * L) : 0;
    t = Math.min(last ? Infinity : 1, Math.max(i === 0 ? -Infinity : 0, t)); // past the ends: on the extended line
    const p = { e: a.e + de * t, n: a.n + dn * t };
    const d = Math.hypot(q.e - p.e, q.n - p.n);
    if (!best || d < best.d - 1e-9) {
      const cross = de * (q.n - a.n) - dn * (q.e - a.e);
      best = { station: start + s + t * L, offset: cross > 0 ? -d : d, d, on: p, beyond: t < 0 || t > 1 };
    }
    s += L;
  }
  return best;
}

/** The point at a station and offset (+ right) along a polyline; past the ends it goes on along the end segments. */
export function atStation(line, station, offset = 0, start = 0) {
  let s = start;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const L = Math.hypot(b.e - a.e, b.n - a.n);
    if (station <= s + L + 1e-9 || i === line.length - 2) {
      const t = L ? (station - s) / L : 0;
      const ue = L ? (b.e - a.e) / L : 0;
      const un = L ? (b.n - a.n) / L : 0;
      const z = (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * Math.min(1, Math.max(0, t));
      return { e: a.e + (b.e - a.e) * t + un * offset, n: a.n + (b.n - a.n) * t - ue * offset, z, azimuth: norm360(Math.atan2(ue, un) / RAD) };
    }
    s += L;
  }
  throw new Error('The line needs two points or more.');
}

// ---------------------------------------------------------------- horizontal curves

const PARTS = {
  length: (d) => d, // arc / R
  tangent: (d) => Math.tan(d / 2),
  chord: (d) => 2 * Math.sin(d / 2),
  external: (d) => 1 / Math.cos(d / 2) - 1,
  middle: (d) => 1 - Math.cos(d / 2),
};

/**
 * A circular curve from any two of radius, delta (degrees), length (arc), tangent, chord, external, middle ordinate.
 * Curves up to 180°. Returns all of them, and the degree of curve (arc definition, per 100 units).
 */
export function solveCurve(given) {
  const known = Object.keys(given).filter((k) => given[k] !== undefined && given[k] !== null && given[k] !== '' && (k === 'radius' || k === 'delta' || PARTS[k]));
  if (known.length !== 2) throw new Error('Give exactly two of radius, delta, length, tangent, chord, external, middle.');
  for (const k of known) if (!(+given[k] > 0)) throw new Error(`${k} must be more than 0.`);
  let R = +given.radius || null;
  let d = given.delta ? +given.delta * RAD : null;
  const others = known.filter((k) => k !== 'radius' && k !== 'delta');
  if (R && d === null) {
    const [k] = others;
    const f = given[k] / R;
    d = { length: f, tangent: 2 * Math.atan(f), chord: f <= 2 ? 2 * Math.asin(f / 2) : NaN, external: 2 * Math.acos(1 / (1 + f)), middle: f <= 1 ? 2 * Math.acos(1 - f) : NaN }[k];
    if (!Number.isFinite(d)) throw new Error(`No curve has radius ${R} and ${k} ${given[k]}.`);
  } else if (!R && d !== null) R = given[others[0]] / PARTS[others[0]](d);
  else if (!R) {
    // two lengths: their ratio fixes delta; bisection (each ratio is monotonic up to 180°)
    const [a, b] = others;
    const want = given[a] / given[b];
    const g = (x) => PARTS[a](x) / PARTS[b](x) - want;
    let lo = 1e-6;
    let hi = Math.PI - 1e-6;
    if (g(lo) * g(hi) > 0) throw new Error(`No curve has ${a} ${given[a]} and ${b} ${given[b]}.`);
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (g(lo) * g(mid) <= 0) hi = mid;
      else lo = mid;
    }
    d = (lo + hi) / 2;
    R = given[a] / PARTS[a](d);
  }
  if (!(d > 0) || d > 2 * Math.PI) throw new Error('That curve turns more than a full circle.');
  return { radius: R, delta: d / RAD, ...Object.fromEntries(Object.entries(PARTS).map(([k, f]) => [k, R * f(d)])), degree: 18000 / (Math.PI * R) };
}

// ---------------------------------------------------------------- solve(): the user's words in, answers out

/** A point from a name / id, [n, e] / [n, e, z] (project units), or { n, e, z }. */
export function pointOf(doc, ref, k = 1) {
  if (Array.isArray(ref)) {
    if (ref.length < 2 || !ref.every(Number.isFinite)) throw new Error('A point is a name or [Northing, Easting, Elevation].');
    return { n: ref[0] * k, e: ref[1] * k, z: (ref[2] ?? 0) * k };
  }
  if (ref && typeof ref === 'object') return { n: ref.n * k, e: ref.e * k, z: (ref.z ?? 0) * k };
  const p = S.points(doc).find((x) => x.name === String(ref) || x.id === ref);
  if (!p) throw new Error(`There is no point "${ref}".`);
  return { ...p.point, name: p.name };
}

/** A line: point names / coordinates, or a curve, alignment or linework by name. Returns [{ n, e, z }] and its start station. */
export function lineOf(doc, ref, k = 1) {
  if (Array.isArray(ref)) {
    if (ref.length < 2) throw new Error('A line needs two points or more.');
    return { pts: ref.map((r) => pointOf(doc, r, k)), start: 0 };
  }
  const [c] = D.resolve(doc, ref);
  if (!c?.curve && !c?.line) throw new Error(`${c?.name || ref} is not a line, curve or alignment.`);
  const model = c.curve ? D.curvePoints(doc, c) : S.lineworkPath(doc, c);
  return { pts: model.map((p) => S.toProject(doc, p)), start: c.derived?.params?.start_station || 0 };
}

const num = (v) => (v === undefined || v === null || v === '' ? undefined : +v);

/**
 * One COGO calculation. kind: inverse | traverse | intersect | station_offset | offset_point | curve | area.
 * Lengths in and out are in project units. Returns { result, points (to store), lines (to preview), report }.
 */
export function solve(doc, kind, a) {
  const g = S.geo(doc);
  const k = S.UNITS[g.units] || 1;
  const L = (m) => +(m / k).toFixed(4);
  const u = g.units === 'm' || !g.units ? 'm' : g.units;
  const len = (m) => `${(m / k).toFixed(3)} ${u}`;
  const dir = (az) => `${quadrant(az)} (az ${S.formatAngle(az, 'dms')})`;
  const P = (r) => pointOf(doc, r, k);
  const out = (p) => ({ n: L(p.n), e: L(p.e), z: L(p.z ?? 0) });
  const opt = { angles: g.angles };
  if (kind === 'inverse') {
    const pts = (a.points || [a.from, a.to]).map(P);
    if (pts.length < 2) throw new Error('Give two points or more.');
    const legs = pts.slice(1).map((b, i) => ({ ...inverse(pts[i], b), from: pts[i].name, to: b.name }));
    const result = legs.map((r) => ({ from: r.from, to: r.to, azimuth: +r.azimuth.toFixed(6), bearing: quadrant(r.azimuth), hd: L(r.hd), sd: L(r.sd), dz: L(r.dz), grade: r.grade === null ? null : +r.grade.toFixed(3) }));
    const total = legs.reduce((s, r) => s + r.hd, 0);
    const report = legs.map((r) => `${r.from ?? 'A'} → ${r.to ?? 'B'}: ${dir(r.azimuth)}, ${len(r.hd)} horizontal, ${len(r.sd)} slope, dz ${len(r.dz)}${r.grade === null ? '' : `, ${r.grade.toFixed(2)} %`}`);
    if (legs.length > 1) report.push(`Total ${len(total)} horizontal`);
    return { result: legs.length === 1 ? result[0] : { legs: result, total: L(total) }, points: [], lines: [pts], report: report.join('\n') };
  }
  if (kind === 'traverse') {
    const start = P(a.from);
    const prev = a.backsight !== undefined && a.backsight !== '' ? (typeof a.backsight === 'string' && S.points(doc).some((p) => p.name === a.backsight) ? inverse(P(a.backsight), start).azimuth : direction(a.backsight, opt)) : null;
    const legs = (a.legs || []).map((l) => ({ dir: l.direction ?? l.dir, dist: num(l.distance ?? l.dist) * k, dz: (num(l.dz) || 0) * k, side: !!l.side }));
    if (!legs.length) throw new Error('Give one leg or more: a direction and a distance.');
    let trav = traverse(start, legs, { prev, ...opt });
    const report = trav.points.map((p, i) => `${p.side ? 'Sideshot' : 'Leg'} ${i + 1}: ${dir(p.az)}, ${len(Math.hypot(p.n - p.from.n, p.e - p.from.e))} → N ${(p.n / k).toFixed(3)} E ${(p.e / k).toFixed(3)} Z ${(p.z / k).toFixed(3)}`);
    let close = null;
    if (a.close_to !== undefined && a.close_to !== '') {
      const target = P(a.close_to);
      const c = closure(trav.points.filter((p) => !p.side).at(-1) || start, target, trav.length);
      close = { misclosure: L(c.linear), dN: L(c.dN), dE: L(c.dE), dz: L(c.dz), precision: Number.isFinite(c.ratio) ? `1:${Math.round(c.ratio)}` : 'exact', direction: quadrant(c.azimuth) };
      report.push(`Closes on ${a.close_to}: misses by ${len(c.linear)} (${close.precision}), dN ${len(c.dN)}, dE ${len(c.dE)}`);
      if (a.adjust === 'compass') {
        trav = compassAdjust(trav, target);
        report.push('Adjusted by the compass rule.');
      }
      const ring = [start, ...trav.points.filter((p) => !p.side)];
      const ar = area(ring);
      close.area = +(ar.area / (k * k)).toFixed(3);
      report.push(`Area ${(ar.area / (k * k)).toFixed(3)} ${u}²`);
    }
    // a leg that closes back on the target is not a new point
    const last = trav.points.filter((p) => !p.side).at(-1);
    const keep = trav.points.filter((p) => !(close && p === last && Math.hypot(p.n - P(a.close_to).n, p.e - P(a.close_to).e) < 0.5 * k));
    const lines = [[start, ...trav.points.filter((p) => !p.side)], ...trav.points.filter((p) => p.side).map((p) => [p.from, p])];
    return { result: { points: trav.points.map(out), new_points: keep.length, length: L(trav.length), ...(close ? { closure: close } : {}) }, points: keep.map((p) => ({ ...p })), lines, report: report.join('\n') };
  }
  if (kind === 'intersect') {
    const how = a.method || (a.direction1 !== undefined && a.direction2 !== undefined ? 'bearing-bearing' : a.direction1 !== undefined ? 'bearing-distance' : a.line1 ? 'lines' : 'distance-distance');
    let sols;
    let A;
    let B;
    if (how === 'lines') {
      const [a1, a2] = a.line1.map(P);
      const [b1, b2] = a.line2.map(P);
      (A = a1), (B = b1);
      sols = bearingBearing(a1, inverse(a1, a2).azimuth, b1, inverse(b1, b2).azimuth);
    } else {
      (A = P(a.point1)), (B = P(a.point2));
      if (how === 'bearing-bearing') sols = bearingBearing(A, direction(a.direction1, opt), B, direction(a.direction2, opt));
      else if (how === 'bearing-distance') sols = bearingDistance(A, direction(a.direction1, opt), B, num(a.distance2) * k);
      else sols = distanceDistance(A, num(a.distance1) * k, B, num(a.distance2) * k);
    }
    if (!sols.length) throw new Error(how === 'bearing-bearing' || how === 'lines' ? 'The lines are parallel: they never meet.' : 'They do not meet: the distances are too short or too long.');
    const pick = a.solution === 2 && sols[1] ? [sols[1]] : a.solution === 'both' ? sols : [sols[0]];
    const lines = pick.flatMap((p) => [[A, p], [B, p]]);
    const report = sols.map((p, i) => `${sols.length > 1 ? `Answer ${i + 1}${p.side ? ` (${p.side} of the line)` : p.ahead === false ? ' (behind)' : ''}: ` : ''}N ${(p.n / k).toFixed(3)} E ${(p.e / k).toFixed(3)}`);
    return { result: { method: how, solutions: sols.map(out) }, points: pick, lines, report: report.join('\n') };
  }
  if (kind === 'station_offset' || kind === 'offset_point') {
    const line = lineOf(doc, a.line, k);
    if (kind === 'station_offset') {
      const qs = (a.points || [a.point]).filter((x) => x !== undefined).map(P);
      if (!qs.length) throw new Error('Give a point.');
      const rows = qs.map((q) => ({ name: q.name, ...stationOffset(line.pts, q, line.start) }));
      const report = rows.map((r) => `${r.name ?? 'Point'}: station ${(r.station / k).toFixed(3)}, ${Math.abs(r.offset / k).toFixed(3)} ${u} ${r.offset >= 0 ? 'right' : 'left'}${r.beyond ? ' (past the end)' : ''}`);
      return { result: rows.map((r) => ({ point: r.name, station: L(r.station), offset: L(r.offset), side: r.offset >= 0 ? 'right' : 'left' })), points: [], lines: [line.pts, ...rows.map((r, i) => [{ ...r.on, z: qs[i].z }, qs[i]])], report: report.join('\n') };
    }
    const st = num(a.station) * k;
    if (!Number.isFinite(st)) throw new Error('Give a station.');
    const p = atStation(line.pts, st, (num(a.offset) || 0) * k, line.start);
    if (a.dz !== undefined || a.z !== undefined) p.z = a.z !== undefined ? +a.z * k : p.z + (+a.dz || 0) * k;
    const on = atStation(line.pts, st, 0, line.start);
    return { result: out(p), points: [p], lines: [line.pts, [on, p]], report: `Station ${(st / k).toFixed(3)}, offset ${((num(a.offset) || 0)).toFixed(3)} ${u}: N ${(p.n / k).toFixed(3)} E ${(p.e / k).toFixed(3)} Z ${(p.z / k).toFixed(3)}` };
  }
  if (kind === 'curve') {
    const given = Object.fromEntries(['radius', 'delta', 'length', 'tangent', 'chord', 'external', 'middle'].map((key) => [key, num(a[key]) === undefined ? undefined : key === 'delta' ? (typeof a.delta === 'string' ? S.parseAngle(a.delta, g.angles) : +a.delta) : num(a[key]) * k]));
    const c = solveCurve(given);
    const r = { radius: L(c.radius), delta: +c.delta.toFixed(6), delta_dms: S.formatAngle(c.delta, 'dms'), length: L(c.length), tangent: L(c.tangent), chord: L(c.chord), external: L(c.external), middle: L(c.middle), degree: +(c.degree * k).toFixed(4) };
    return { result: r, points: [], lines: [], report: `Curve: R ${len(c.radius)}, Δ ${r.delta_dms}, L ${len(c.length)}, T ${len(c.tangent)}, C ${len(c.chord)}, E ${len(c.external)}, M ${len(c.middle)}` };
  }
  if (kind === 'area') {
    const pts = (a.points || []).map(P);
    if (pts.length < 3) throw new Error('An area needs three points or more.');
    const r = area(pts);
    const m2 = r.area;
    return { result: { area: +(m2 / (k * k)).toFixed(4), perimeter: L(r.perimeter), hectares: +(m2 / 1e4).toFixed(4), acres: +(m2 / 4046.8564224).toFixed(4) }, points: [], lines: [[...pts, pts[0]]], report: `Area ${(m2 / (k * k)).toFixed(3)} ${u}² (${(m2 / 1e4).toFixed(4)} ha, ${(m2 / 4046.8564224).toFixed(4)} ac), perimeter ${len(r.perimeter)}` };
  }
  throw new Error(`Unknown COGO calculation "${kind}".`);
}

/** The headline numbers of an answer, for the panel's tiles: [[label, value], …]. u: the project's length unit. */
export function facts(kind, r, u = 'm') {
  const m = (x) => `${(+x).toFixed(3)} ${u}`;
  if (kind === 'inverse') return r.legs ? [['Legs', r.legs.length], ['Total', m(r.total)]] : [['Bearing', r.bearing], ['Horizontal', m(r.hd)], ['Slope', m(r.sd)], ['Height diff.', m(r.dz)], ['Grade', r.grade === null ? '–' : `${r.grade.toFixed(2)} %`]];
  if (kind === 'traverse') return [['New points', r.new_points ?? r.points.length], ['Length', m(r.length)], ...(r.closure ? [['Misses by', m(r.closure.misclosure)], ['Precision', r.closure.precision], ['Area', `${r.closure.area.toFixed(3)} ${u}²`]] : [])];
  if (kind === 'intersect') return r.solutions.flatMap((p, i) => [[`${r.solutions.length > 1 ? `Answer ${i + 1} · ` : ''}N`, m(p.n)], ['E', m(p.e)]]);
  if (kind === 'station_offset') return r.flatMap((x) => [[`${x.point ?? ''} station`.trim(), m(x.station)], ['Offset', `${m(Math.abs(x.offset))} ${x.side}`]]);
  if (kind === 'offset_point') return [['N', m(r.n)], ['E', m(r.e)], ['Z', m(r.z)]];
  if (kind === 'curve') return [['Radius', m(r.radius)], ['Delta', r.delta_dms], ['Arc', m(r.length)], ['Tangent', m(r.tangent)], ['Chord', m(r.chord)], ['External', m(r.external)], ['Middle ord.', m(r.middle)]];
  if (kind === 'area') return [['Area', `${r.area.toFixed(3)} ${u}²`], ['Hectares', r.hectares], ['Acres', r.acres], ['Perimeter', m(r.perimeter)]];
  return [];
}
