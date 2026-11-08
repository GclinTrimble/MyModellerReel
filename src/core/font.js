// 3D text (#31): a small TrueType reader (glyph outlines, compound glyphs, advance widths, kerning-free) and text
// meshes extruded from the outlines. Fonts are registered once as bytes (the renderer loads Liberation Sans from
// pdf.js's standard fonts; tests read the same file), so generators can build text synchronously.
import { Vector2, ShapeUtils } from 'three';

const FONTS = new Map();
export const DEFAULT_FONT = 'sans';

/** Register a TrueType font under a name (bytes: ArrayBuffer / Uint8Array). */
export function registerFont(name, bytes) {
  FONTS.set(name, parseTtf(bytes));
  return FONTS.get(name);
}
export const fontNames = () => [...FONTS.keys()];
export function getFont(name = DEFAULT_FONT) {
  const f = FONTS.get(name) || FONTS.get(DEFAULT_FONT) || FONTS.values().next().value;
  if (!f) throw new Error('No font is loaded yet.');
  return f;
}

/** The tables of a TrueType file and a glyph reader. */
export function parseTtf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const T = {};
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    T[String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3])] = dv.getUint32(o + 8);
  }
  for (const t of ['head', 'maxp', 'hhea', 'hmtx', 'loca', 'glyf', 'cmap']) if (T[t] === undefined) throw new Error(`Not a TrueType outline font (no ${t} table).`);
  const unitsPerEm = dv.getUint16(T.head + 18);
  const longLoca = dv.getInt16(T.head + 50) === 1;
  const numGlyphs = dv.getUint16(T.maxp + 4);
  const numHM = dv.getUint16(T.hhea + 34);
  const loca = (g) => (longLoca ? dv.getUint32(T.loca + g * 4) : dv.getUint16(T.loca + g * 2) * 2);
  const advance = (g) => dv.getUint16(T.hmtx + 4 * Math.min(g, numHM - 1));
  // cmap: a Windows Unicode subtable, format 4 (BMP) or 12 (full)
  let map = null;
  const nt = dv.getUint16(T.cmap + 2);
  for (let i = 0; i < nt && !map; i++) {
    const [pid, eid, off] = [dv.getUint16(T.cmap + 4 + i * 8), dv.getUint16(T.cmap + 6 + i * 8), dv.getUint32(T.cmap + 8 + i * 8)];
    if (!(pid === 3 && (eid === 1 || eid === 10)) && pid !== 0) continue;
    const s = T.cmap + off;
    const fmt = dv.getUint16(s);
    if (fmt === 4) {
      const segX2 = dv.getUint16(s + 6);
      const ends = s + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      map = (c) => {
        for (let k = 0; k < segX2; k += 2) {
          if (c > dv.getUint16(ends + k)) continue;
          if (c < dv.getUint16(starts + k)) return 0;
          const ro = dv.getUint16(ranges + k);
          if (!ro) return (c + dv.getInt16(deltas + k)) & 0xffff;
          const g = dv.getUint16(ranges + k + ro + (c - dv.getUint16(starts + k)) * 2);
          return g ? (g + dv.getInt16(deltas + k)) & 0xffff : 0;
        }
        return 0;
      };
    } else if (fmt === 12) {
      const groups = dv.getUint32(s + 12);
      map = (c) => {
        for (let k = 0; k < groups; k++) {
          const o = s + 16 + k * 12;
          if (c >= dv.getUint32(o) && c <= dv.getUint32(o + 4)) return dv.getUint32(o + 8) + c - dv.getUint32(o);
        }
        return 0;
      };
    }
  }
  if (!map) throw new Error('The font has no Unicode character map.');
  /** Contours of a glyph: [[{ x, y, on }], …] in font units. */
  const contours = (g, depth = 0) => {
    if (g >= numGlyphs || depth > 8) return [];
    const start = loca(g);
    if (loca(g + 1) === start) return []; // a space
    let p = T.glyf + start;
    const nc = dv.getInt16(p);
    p += 10;
    if (nc >= 0) {
      const ends = Array.from({ length: nc }, (_, i) => dv.getUint16(p + i * 2));
      p += nc * 2;
      p += 2 + dv.getUint16(p); // instructions
      const count = nc ? ends[nc - 1] + 1 : 0;
      const flags = [];
      while (flags.length < count) {
        const f = u8[p++];
        flags.push(f);
        if (f & 8) for (let r = u8[p++]; r > 0; r--) flags.push(f);
      }
      const read = (short, same) => {
        let v = 0;
        return flags.map((f) => {
          if (f & short) v += f & same ? u8[p++] : -u8[p++];
          else if (!(f & same)) (v += dv.getInt16(p)), (p += 2);
          return v;
        });
      };
      const xs = read(2, 16);
      const ys = read(4, 32);
      const out = [];
      let s = 0;
      for (const e of ends) out.push(xs.slice(s, e + 1).map((x, i) => ({ x, y: ys[s + i], on: !!(flags[s + i] & 1) }))), (s = e + 1);
      return out;
    }
    // compound glyph: parts, each moved (and maybe scaled)
    const out = [];
    let more = true;
    while (more) {
      const fl = dv.getUint16(p);
      const gi = dv.getUint16(p + 2);
      p += 4;
      let dx;
      let dy;
      if (fl & 1) (dx = dv.getInt16(p)), (dy = dv.getInt16(p + 2)), (p += 4);
      else (dx = dv.getInt8(p)), (dy = dv.getInt8(p + 1)), (p += 2);
      let [a, b, c, d] = [1, 0, 0, 1];
      const f2 = (o) => dv.getInt16(o) / 16384;
      if (fl & 8) (a = d = f2(p)), (p += 2);
      else if (fl & 0x40) (a = f2(p)), (d = f2(p + 2)), (p += 4);
      else if (fl & 0x80) (a = f2(p)), (b = f2(p + 2)), (c = f2(p + 4)), (d = f2(p + 6)), (p += 8);
      if (!(fl & 2)) dx = dy = 0; // point-matched parts: rare in text fonts
      for (const ct of contours(gi, depth + 1)) out.push(ct.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })));
      more = !!(fl & 0x20);
    }
    return out;
  };
  return { unitsPerEm, glyph: (ch) => map(ch.codePointAt(0)), advance, contours };
}

/** A contour of on / off-curve points as a polyline (quadratic curves split into steps). */
export function flatten(ct, steps = 4) {
  if (!ct.length) return [];
  // start on an on-curve point (or the midpoint of two off-curve ones)
  let k = ct.findIndex((q) => q.on);
  const pts = k < 0 ? [{ x: (ct[0].x + ct[1].x) / 2, y: (ct[0].y + ct[1].y) / 2, on: true }, ...ct.slice(1), ct[0]] : [...ct.slice(k), ...ct.slice(0, k)];
  const out = [[pts[0].x, pts[0].y]];
  let prev = pts[0];
  const n = pts.length;
  for (let i = 1; i <= n; i++) {
    const q = pts[i % n];
    if (q.on) {
      out.push([q.x, q.y]);
      prev = q;
      continue;
    }
    const nx = pts[(i + 1) % n];
    const end = nx.on ? nx : { x: (q.x + nx.x) / 2, y: (q.y + nx.y) / 2, on: true };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([(1 - t) ** 2 * prev.x + 2 * (1 - t) * t * q.x + t * t * end.x, (1 - t) ** 2 * prev.y + 2 * (1 - t) * t * q.y + t * t * end.y]);
    }
    prev = end;
    if (nx.on) i++;
  }
  // drop the closing duplicate and repeated points
  const clean = out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-6);
  if (clean.length > 1 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) < 1e-6) clean.pop();
  return clean;
}

const area2 = (r) => r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2;
const inside = ([x, y], r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
};

/**
 * Outlines of a text: [{ outer, holes }] in metres, baseline at y = 0, x from 0. size: the height of a capital
 * letter. Lines split on "\n"; align left | center | right.
 */
export function textShapes(text, { size = 1, font, align = 'left', spacing = 0, lineHeight = 1.5, steps = 4 } = {}) {
  const f = getFont(font);
  const H = f.contours(f.glyph('H')).flat();
  const cap = H.length ? Math.max(...H.map((q) => q.y)) : f.unitsPerEm * 0.7;
  const s = size / cap;
  const lines = String(text).split('\n');
  const rings = [];
  const widths = [];
  lines.forEach((line, li) => {
    let pen = 0;
    const start = rings.length;
    for (const ch of line) {
      const g = f.glyph(ch);
      for (const ct of f.contours(g)) {
        const r = flatten(ct, steps).map(([x, y]) => [(x + pen) * s, y * s - li * size * lineHeight]);
        if (r.length > 2 && Math.abs(area2(r)) > 1e-12) rings.push({ r, line: li });
      }
      pen += f.advance(g) + spacing * cap;
    }
    widths[li] = pen * s;
    for (let i = start; i < rings.length; i++) rings[i].line = li;
  });
  const maxW = Math.max(0, ...widths);
  for (const x of rings) {
    const dx = align === 'center' ? -widths[x.line] / 2 : align === 'right' ? -widths[x.line] : 0;
    if (dx) x.r = x.r.map(([a, b]) => [a + dx, b]);
  }
  // an outline is an outer ring when an even number of rings encloses it, a hole otherwise
  const R = rings.map((x) => x.r);
  const depth = R.map((r, i) => R.filter((o, j) => j !== i && inside(r[0], o) && Math.abs(area2(o)) > Math.abs(area2(r))).length);
  const shapes = [];
  R.forEach((r, i) => {
    if (depth[i] % 2) return;
    const outer = area2(r) < 0 ? [...r].reverse() : r; // counter-clockwise
    const holes = R.filter((h, j) => depth[j] === depth[i] + 1 && inside(h[0], r)).map((h) => (area2(h) > 0 ? [...h].reverse() : h));
    shapes.push({ outer, holes });
  });
  return { shapes, width: maxW, height: size + (lines.length - 1) * size * lineHeight, lines: lines.length };
}

/**
 * A text mesh: letters extruded depth m. Standing in the x/y plane facing +z (signs), or flat on the ground facing
 * up. Pivot at the base centre of the first line. Faces CCW around their outward normals.
 */
export function textMesh(text, { size = 1, depth = 0.1, font, align = 'center', flat = false, spacing = 0, lineHeight = 1.5 } = {}) {
  const { shapes } = textShapes(text, { size, font, align, spacing, lineHeight });
  const v = [];
  const f = [];
  const z0 = -depth / 2;
  const z1 = depth / 2;
  for (const { outer, holes } of shapes) {
    const ring = [outer, ...holes];
    const base = v.length;
    const flatPts = ring.flat();
    for (const [x, y] of flatPts) v.push([x, y, z1]);
    for (const [x, y] of flatPts) v.push([x, y, z0]);
    const m = flatPts.length;
    const tris = ShapeUtils.triangulateShape(outer.map(([x, y]) => new Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new Vector2(x, y))));
    for (const [a, b, c] of tris) {
      const ccw = area2([flatPts[a], flatPts[b], flatPts[c]]) > 0;
      f.push(ccw ? [base + a, base + b, base + c] : [base + a, base + c, base + b]); // front faces +z
      f.push(ccw ? [base + m + a, base + m + c, base + m + b] : [base + m + a, base + m + b, base + m + c]); // back faces −z
    }
    // sides: outer rings CCW and holes CW, so (i, j) walked forward has the outside on its right
    let o = 0;
    for (const r of ring) {
      for (let i = 0; i < r.length; i++) {
        const j = (i + 1) % r.length;
        f.push([base + o + i, base + m + o + i, base + m + o + j, base + o + j]);
      }
      o += r.length;
    }
  }
  if (!v.length) throw new Error('The text has no visible characters.');
  const out = { v, f };
  if (flat) out.v = out.v.map(([x, y, z]) => [x, z + depth / 2, -y]); // lie down: the letters' front faces up
  return out;
}
