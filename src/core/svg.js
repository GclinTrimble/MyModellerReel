// SVG linework for floor plans (#33): paths, polylines, polygons, rects, circles, ellipses and lines, with their
// group transforms, flattened to polylines in drawing units (y down, as SVG draws). import_2d lays them on a plane.
import { parse } from './xml.js';

const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const app = (M, [x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
const I = [1, 0, 0, 1, 0, 0];

/** "translate(10 20) scale(2) rotate(30) matrix(…)" → a 2D affine [a, b, c, d, e, f]. */
export function transformOf(s) {
  let M = I;
  for (const [, fn, args] of String(s || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let T = I;
    if (fn === 'matrix' && n.length === 6) T = n;
    else if (fn === 'translate') T = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    else if (fn === 'scale') T = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
    else if (fn === 'rotate') {
      const a = ((n[0] || 0) * Math.PI) / 180;
      const R = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
      T = n.length === 3 ? mul(mul([1, 0, 0, 1, n[1], n[2]], R), [1, 0, 0, 1, -n[1], -n[2]]) : R;
    }
    M = mul(M, T);
  }
  return M;
}

/** A path's d attribute → polylines [{ pts: [[x, y]…], closed }] (curves split into steps). */
export function pathPolylines(d, steps = 12) {
  const tok = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let last = null; // the last control point, for S / T
  let i = 0;
  const num = () => +tok[i++];
  const isNum = () => i < tok.length && !/[a-zA-Z]/.test(tok[i]);
  const to = (nx, ny) => ((x = nx), (y = ny), cur.pts.push([x, y]));
  const start = (nx, ny) => {
    if (cur && cur.pts.length > 1) out.push(cur);
    cur = { pts: [[nx, ny]], closed: false };
    (x = nx), (y = ny), (sx = nx), (sy = ny);
  };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'M') {
      start(num() + ox, num() + oy);
      cmd = rel ? 'l' : 'L'; // more pairs after M are lines
    } else if (C === 'L') to(num() + ox, num() + oy);
    else if (C === 'H') to(num() + ox, y);
    else if (C === 'V') to(x, num() + oy);
    else if (C === 'C' || C === 'S' || C === 'Q' || C === 'T') {
      const p0 = [x, y];
      let c1;
      let c2;
      let p;
      if (C === 'C') (c1 = [num() + ox, num() + oy]), (c2 = [num() + ox, num() + oy]), (p = [num() + ox, num() + oy]);
      else if (C === 'S') (c1 = last ? [2 * x - last[0], 2 * y - last[1]] : p0), (c2 = [num() + ox, num() + oy]), (p = [num() + ox, num() + oy]);
      else if (C === 'Q') (c1 = [num() + ox, num() + oy]), (p = [num() + ox, num() + oy]);
      else (c1 = last ? [2 * x - last[0], 2 * y - last[1]] : p0), (p = [num() + ox, num() + oy]);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        const q = c2 ? [0, 1].map((j) => u ** 3 * p0[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t ** 3 * p[j]) : [0, 1].map((j) => u * u * p0[j] + 2 * u * t * c1[j] + t * t * p[j]);
        cur.pts.push(q);
      }
      [x, y] = p;
      last = c2 || c1;
      if (!isNum() && !/[CSQTcsqt]/.test(tok[i] || '')) last = null;
      continue;
    } else if (C === 'A') {
      // shortcut: arcs become a few straight steps through the end point's half-way bulge; fine for plan drawings
      const [rx, ry] = [num(), num()];
      num(), num(), num(); // rotation, large-arc, sweep
      const p = [num() + ox, num() + oy];
      void rx, void ry;
      to(p[0], p[1]);
    } else if (C === 'Z') {
      cur.closed = true;
      (x = sx), (y = sy);
      if (cur.pts.length > 1) out.push(cur);
      cur = { pts: [[x, y]], closed: false };
      continue;
    } else i++;
    last = null;
  }
  if (cur && cur.pts.length > 1) out.push(cur);
  return out;
}

/** Every drawable shape of an SVG as polylines in its user units: [{ pts, closed, layer }]. layer: the nearest group id. */
export function svgPolylines(text) {
  const root = parse(text);
  const out = [];
  const circle = (cx, cy, rx, ry, M, layer) => {
    const pts = Array.from({ length: 32 }, (_, k) => app(M, [cx + rx * Math.cos((k / 32) * 2 * Math.PI), cy + ry * Math.sin((k / 32) * 2 * Math.PI)]));
    out.push({ pts, closed: true, layer });
  };
  const walk = (el, M, layer) => {
    const name = el.name.replace(/^.*:/, '');
    const a = el.attrs;
    const T = a.transform ? mul(M, transformOf(a.transform)) : M;
    const L = name === 'g' && (a['inkscape:label'] || a.id) ? a['inkscape:label'] || a.id : layer;
    const n = (k) => parseFloat(a[k] || 0);
    if (name === 'path' && a.d) for (const p of pathPolylines(a.d)) out.push({ pts: p.pts.map((q) => app(T, q)), closed: p.closed, layer: L });
    else if (name === 'polyline' || name === 'polygon') {
      const v = String(a.points || '').split(/[\s,]+/).filter(Boolean).map(Number);
      const pts = [];
      for (let k = 0; k + 1 < v.length; k += 2) pts.push(app(T, [v[k], v[k + 1]]));
      if (pts.length > 1) out.push({ pts, closed: name === 'polygon', layer: L });
    } else if (name === 'rect') out.push({ pts: [[n('x'), n('y')], [n('x') + n('width'), n('y')], [n('x') + n('width'), n('y') + n('height')], [n('x'), n('y') + n('height')]].map((q) => app(T, q)), closed: true, layer: L });
    else if (name === 'line') out.push({ pts: [app(T, [n('x1'), n('y1')]), app(T, [n('x2'), n('y2')])], closed: false, layer: L });
    else if (name === 'circle') circle(n('cx'), n('cy'), n('r'), n('r'), T, L);
    else if (name === 'ellipse') circle(n('cx'), n('cy'), n('rx'), n('ry'), T, L);
    if (!['defs', 'clipPath', 'mask', 'symbol', 'style', 'title'].includes(name)) for (const c of el.children) walk(c, T, L);
  };
  walk(root, I, '');
  if (!out.length) throw new Error('No lines, paths or shapes in that SVG.');
  return out;
}

/** The SVG's unit in metres when its width says so ("210mm", "8.5in"), else null (user units). */
export function svgUnit(text) {
  const root = parse(text);
  const svg = root.children.find((c) => c.name.replace(/^.*:/, '') === 'svg');
  if (!svg) return null;
  const w = String(svg.attrs.width || '').match(/^([\d.]+)\s*(mm|cm|m|in|pt|px)?$/);
  const vb = String(svg.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  if (!w || !w[2] || vb.length !== 4 || !vb[2]) return null;
  const m = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, pt: 0.0254 / 72, px: 0.0254 / 96 }[w[2]];
  return (parseFloat(w[1]) * m) / vb[2];
}
