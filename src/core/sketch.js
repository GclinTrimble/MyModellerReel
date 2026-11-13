// Hand sketches (#229, #230): freehand strokes become a clean outline: straight lines, tidy angles (snapped to 15°
// steps when they are close), closed when the ends meet, then scaled to a real width or height. Strokes are canvas
// points [x, y] with y down. Pure module, Node-tested.
import { simplify } from './drafting.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DEG = Math.PI / 180;

/** Strokes into one path in drawing order: a stroke that starts (or ends) near where the path ends carries it on. */
export function chain(strokes, tol) {
  const list = strokes.filter((s) => s.length > 1);
  if (!list.length) return [];
  let path = [...list[0]];
  for (const s of list.slice(1)) {
    const end = path.at(-1);
    if (dist(s.at(-1), end) < dist(s[0], end)) s.reverse();
    if (dist(s[0], end) < tol) path.push(...s.slice(1));
    else if (dist(s.at(-1), path[0]) < tol) path = [...s, ...path.slice(1)];
    else path.push(...s);
  }
  return path;
}

/** Where line a (point p, direction d) meets line b. null when parallel. */
function meet(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * A clean outline from strokes. snap: angle step in degrees (0 = off); within `within` degrees of a step a line takes it.
 * Returns { points (y up, origin at the bottom left, sketch units), canvas (the same corners where they were drawn), closed, width, height }.
 */
export function cleanSketch(strokes, { snap = 15, within = 7, detail = 0.035, closeAt = 0.12 } = {}) {
  const all = strokes.flat();
  if (all.length < 2) throw new Error('Draw the outline first.');
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  let path = chain(strokes.map((s) => s.map((p) => [p[0], p[1]])), diag * closeAt);
  const closed = path.length > 3 && dist(path[0], path.at(-1)) < diag * closeAt;
  if (closed) path = path.slice(0, -1);
  let pts = simplify(path, diag * detail, closed);
  if (closed && pts.length > 2 && dist(pts[0], pts.at(-1)) < diag * detail) pts = pts.slice(0, -1);
  // each segment becomes a line through its middle at its (snapped) angle; corners are where the lines meet
  const n = pts.length;
  const segs = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
    if (snap) {
      const s = Math.round(ang / snap) * snap;
      if (Math.abs(ang - s) <= within) ang = s;
    }
    const prev = segs.at(-1);
    if (prev && Math.abs(((ang - prev.ang + 540) % 360) - 180) < 1e-6) {
      prev.b = b; // same direction as the last one: one longer line
      prev.mid = [(prev.a[0] + b[0]) / 2, (prev.a[1] + b[1]) / 2];
      continue;
    }
    segs.push({ a, b, ang, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d: [Math.cos(ang * DEG), Math.sin(ang * DEG)] });
  }
  if (closed && segs.length > 1 && Math.abs(((segs[0].ang - segs.at(-1).ang + 540) % 360) - 180) < 1e-6) {
    const last = segs.pop();
    segs[0].a = last.a;
    segs[0].mid = [(last.a[0] + segs[0].b[0]) / 2, (last.a[1] + segs[0].b[1]) / 2];
  }
  if (segs.length < (closed ? 3 : 1)) throw new Error('Draw a clearer outline: it needs at least three sides, or one line.');
  const proj = (p, s) => {
    const t = (p[0] - s.mid[0]) * s.d[0] + (p[1] - s.mid[1]) * s.d[1];
    return [s.mid[0] + s.d[0] * t, s.mid[1] + s.d[1] * t];
  };
  const out = [];
  if (!closed) out.push(proj(segs[0].a, segs[0]));
  for (let i = closed ? 0 : 1; i < segs.length; i++) {
    const s0 = segs[(i - 1 + segs.length) % segs.length];
    const s1 = segs[i];
    out.push(meet(s0.mid, s0.d, s1.mid, s1.d) || proj(s1.a, s1));
  }
  if (!closed) out.push(proj(segs.at(-1).b, segs.at(-1)));
  // y up, origin at the bottom left
  const minX = Math.min(...out.map((p) => p[0]));
  const maxY = Math.max(...out.map((p) => p[1]));
  const up = out.map((p) => [p[0] - minX, maxY - p[1]]);
  return { points: up, canvas: out, closed, width: Math.max(...up.map((p) => p[0])), height: Math.max(...up.map((p) => p[1])) };
}

/** Scale an outline to a real width or height (m); rounded to the millimetre. Without a size it keeps sketch units. */
export function scaleOutline(o, { width, height } = {}) {
  const k = width > 0 ? width / (o.width || 1) : height > 0 ? height / (o.height || 1) : 1;
  const r = (x) => Math.round(x * k * 1000) / 1000;
  return { ...o, points: o.points.map(([x, y]) => [r(x), r(y)]), width: r(o.width), height: r(o.height), scale: k };
}
