// Drawings in the model (#140–#148): where an underlay's points are, what a PDF's linework becomes, and the live
// extrusion of closed linework. The maths is in underlay.js, drafting.js and pdf.js.
import { Matrix4, Vector3 } from 'three';
import * as D from './document.js';
import * as G from './geometry.js';
import * as U from './underlay.js';
import * as DR from './drafting.js';
import * as S from './survey.js';
import * as L from './layers.js';
import { registerGenerator } from './derived.js';

export const isUnderlay = (e) => e.type === 'underlay';

/** Source (u, v) ↔ world for one underlay, through its affine and its entity transform. */
export function frame(doc, e) {
  const m = D.worldMatrix(doc, e);
  const inv = new Matrix4().copy(m).invert();
  return {
    toWorld: (p) => {
      const [X, Y] = U.apply(e.underlay.affine, p);
      return new Vector3(X, 0, -Y).applyMatrix4(m).toArray();
    },
    toLocalPlan: (w) => {
      const l = new Vector3(...w).applyMatrix4(inv);
      return [l.x, -l.z];
    },
    toSource(w) {
      return U.apply(U.invert(e.underlay.affine), this.toLocalPlan(w));
    },
    planToWorld: ([X, Y]) => new Vector3(X, 0, -Y).applyMatrix4(m).toArray(),
  };
}

/** A point on the drawing: { u, v } as is, or a world point [x, y, z] (picked on it). */
export function sourcePoint(doc, e, ref) {
  if (ref && !Array.isArray(ref) && Number.isFinite(ref.u)) return [ref.u, ref.v];
  if (Array.isArray(ref) && ref.length === 3) return frame(doc, e).toSource(ref);
  throw new Error('A point on the drawing is { u, v } (drawing units) or a world point [x, y, z].');
}

/** A target in the world: a survey point name, { n, e } (project coordinates) or [x, y, z]. */
export function targetWorld(doc, ref) {
  if (Array.isArray(ref) && ref.length === 3) return ref;
  if (ref && typeof ref === 'object' && Number.isFinite(ref.n) && Number.isFinite(ref.e)) return S.toLocal(doc, { n: ref.n, e: ref.e, z: ref.z ?? 0 });
  if (typeof ref === 'string') {
    const p = S.points(doc).find((x) => x.name === ref) || D.resolve(doc, ref)[0];
    if (p) return D.worldMatrix(doc, p).elements.slice(12, 15);
  }
  throw new Error(`Unknown target ${JSON.stringify(ref)}: a survey point name, { n, e } or [x, y, z].`);
}

/** Bytes of a PNG / JPEG / GIF / BMP to { width, height } (TIFFs are read by the renderer). */
export function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { width: be32(b, 16), height: be32(b, 20), mime: 'image/png' };
  if (b[0] === 0x47 && b[1] === 0x49) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), mime: 'image/gif' };
  if (b[0] === 0x42 && b[1] === 0x4d) return { width: le32(b, 18), height: Math.abs(le32(b, 22) | 0), mime: 'image/bmp' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9; ) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      const n = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6], mime: 'image/jpeg' };
      i += 2 + n;
    }
  }
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return { tiff: true, mime: 'image/tiff' };
  return null;
}
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** An affine in project E / N (world files, GeoTIFF) to local plan metres, through the base point (set if none). */
export function projectToLocal(doc, A, size) {
  const g = S.geo(doc);
  if (!g.base) {
    const [cx, cy] = U.apply(A, [size[0] / 2, size[1] / 2]);
    g.base = [Math.round(cx / 100) * 100, Math.round(cy / 100) * 100, 0];
  }
  const loc = ([u, v]) => {
    const [E, N] = U.apply(A, [u, v]);
    const w = S.toLocal(doc, { n: N, e: E, z: 0 });
    return [w[0], -w[2]];
  };
  const [o, x, y] = [loc([0, 0]), loc([1, 0]), loc([0, 1])];
  return [x[0] - o[0], y[0] - o[0], o[0], x[1] - o[1], y[1] - o[1], o[1]];
}

/** The world file of an underlay, in project E / N (plan underlays: its entity may only be moved, not tilted). */
export function worldFileOf(doc, e) {
  const f = frame(doc, e);
  const proj = (p) => {
    const { e: E, n: N } = S.toProject(doc, f.toWorld(p));
    return [E, N];
  };
  const [o, x, y] = [proj([0, 0]), proj([1, 0]), proj([0, 1])];
  return U.worldFile([x[0] - o[0], y[0] - o[0], o[0], x[1] - o[1], y[1] - o[1], o[1]]);
}

/** Which PDF paths an extraction keeps. window: [[u, v], [u, v]] in drawing units. */
export function filterPaths(paths, o = {}) {
  const lay = o.layers && new Set(o.layers.map((x) => x.toLowerCase()));
  const col = o.colors && new Set(o.colors.map((x) => x.toLowerCase()));
  const [w0, w1] = o.window || [];
  const inWin = (p) => !w0 || (p[0] >= Math.min(w0[0], w1[0]) && p[0] <= Math.max(w0[0], w1[0]) && p[1] >= Math.min(w0[1], w1[1]) && p[1] <= Math.max(w0[1], w1[1]));
  const skipped = { hatch: 0, fill: 0, filtered: 0 };
  const kept = paths.filter((p) => {
    if (p.hatch && !o.hatch) return skipped.hatch++, false;
    if (p.fill && !o.fills) return skipped.fill++, false;
    const ok = (!lay || lay.has(String(p.layer).toLowerCase())) && (!col || col.has(p.color.toLowerCase())) && (o.min_width === undefined || p.width >= o.min_width) && (o.max_width === undefined || p.width <= o.max_width) && (o.dashed === undefined || p.dashed === o.dashed) && p.pts.every(inWin);
    if (!ok) skipped.filtered++;
    return ok;
  });
  return { kept, skipped };
}

/** Counts per layer / colour / width, to choose filters before extracting. */
export function pathStats(paths) {
  const by = (k) => Object.entries(paths.reduce((m, p) => ((m[p[k]] = (m[p[k]] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value: value === 'null' ? null : value, count }));
  return { paths: paths.length, hatch: paths.filter((p) => p.hatch).length, fills: paths.filter((p) => p.fill).length, dashed: paths.filter((p) => p.dashed).length, layers: by('layer'), colors: by('color'), widths: by('width') };
}

/**
 * Kept paths to clean plan polylines (local metres), grouped by `key`: welded within tol, joined, de-duplicated,
 * collinear runs merged.
 */
export function cleanLines(paths, affine, { tol = 0.01, join = true, group = (p) => p.layer ?? p.color } = {}) {
  let lines = paths.map((p) => ({ pts: p.pts.map((q) => U.apply(affine, q)), closed: p.closed, key: group(p), color: p.color, layer: p.layer, width: p.width, dashed: p.dashed }));
  lines = DR.dedupe(lines, tol);
  if (join) lines = DR.join(lines, tol);
  return lines.map((l) => ({ ...l, pts: DR.simplify(l.pts, tol / 10, l.closed) })).filter((l) => l.pts.length > 1);
}

/** Text to world positions. */
export const textsInWorld = (doc, e, texts) => {
  const f = frame(doc, e);
  return texts.map((t) => ({ ...t, at: D.round3(f.toWorld(t.at)) }));
};

/** The first number in a label, or null ("+102.35", "FFL 45.20", "IL98.1"). */
export const numberIn = (s) => {
  const m = String(s).replace(/,/g, '.').match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** Curves picked by ids, or every curve on layers matching a glob. */
export function curvesOf(doc, ents, layer) {
  const list = layer ? doc.entities.filter((e) => e.type === 'curve' && L.matcher(layer)(e.tag)) : ents;
  const bad = list.find((e) => e.type !== 'curve');
  if (bad) throw new Error(`${bad.name} is not a curve.`);
  if (!list.length) throw new Error(layer ? `No curves on layers "${layer}".` : 'Pick curves (ids) or a layer.');
  return list;
}

/** Closed linework extruded up (buildings from footprints); live on its curve. */
registerGenerator('extrude_curve', {
  description: 'A closed curve extruded up by a height (footprint → building); follows the curve',
  world: true,
  params: { height: 'm' },
  run: ({ params, inputs, doc }) => {
    const c = inputs[0];
    if (!c?.curve) throw new Error('Extrusion needs a curve.');
    let pts = D.curvePoints(doc, c);
    if (pts.length > 2 && G.len(G.sub(pts[0], pts.at(-1))) < 1e-6) pts = pts.slice(0, -1);
    if (pts.length < 3) throw new Error(`${c.name} has fewer than 3 points: it cannot be extruded.`);
    if (!(params.height > 0)) throw new Error('height must be above 0.');
    const y0 = Math.min(...pts.map((p) => p[1]));
    const m = G.prism(pts.map((p) => [p[0], p[2]]), params.height);
    return G.recenter(G.orient(G.translate(m, [0, y0, 0])));
  },
});
