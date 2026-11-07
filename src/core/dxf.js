// DXF (#154): CAD linework, layers, blocks and faces both ways. Reading covers LINE, LWPOLYLINE (bulges become
// arcs), POLYLINE (2D, 3D, polyface), ARC, CIRCLE, ELLIPSE, SPLINE, POINT, INSERT (blocks become components) and
// 3DFACE; writing is plain R12 (AC1009) that every CAD tool opens. DXF is X east, Y north, Z up.
import * as D from './document.js';
import * as G from './geometry.js';
import * as S from './survey.js';
import * as L from './layers.js';
import * as Comp from './components.js';
import { addCurve } from './landxml.js';
import { registerFormat } from './formats.js';

const INSUNITS = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 21: 1200 / 3937 };

/** The AutoCAD colour index palette (1–255) as hex. */
export const ACI = (() => {
  const t = [null, '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#808080', '#c0c0c0'];
  const hsv = (h, s, v) => {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  };
  const V = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3];
  for (let i = 10; i < 250; i++) t[i] = hsv((Math.floor((i - 10) / 10) * 15) % 360, i % 2 ? 0.5 : 1, V[i % 10]);
  [0x33, 0x5b, 0x84, 0xad, 0xd6, 0xff].forEach((g, k) => (t[250 + k] = `#${g.toString(16).repeat(3)}`));
  return t;
})();
export function nearestAci(hex) {
  const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  let best = 7;
  let bd = Infinity;
  for (let i = 1; i < 256; i++) {
    const d = [1, 3, 5].reduce((s, k, j) => s + (parseInt(ACI[i].slice(k, k + 2), 16) - c[j]) ** 2, 0);
    if (d < bd) (bd = d), (best = i);
  }
  return best;
}
const trueColor = (v) => `#${(+v & 0xffffff).toString(16).padStart(6, '0')}`;

/** Group-code pairs to sections of entity records: { type, codes: [[code, value], …] }. */
export function parseDxf(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1].trim()]);
  const sections = {};
  let sec = null;
  let rec = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') {
      sec = pairs[i + 1][1];
      sections[sec] = [];
      rec = null;
      i++;
      continue;
    }
    if (c === 0 && v === 'ENDSEC') {
      sec = rec = null;
      continue;
    }
    if (!sec) continue;
    if (c === 0) sections[sec].push((rec = { type: v, codes: [] }));
    else if (rec) rec.codes.push([c, v]);
    else (sections[sec].head ||= []).push([c, v]);
  }
  return sections;
}
const get = (r, c, d) => {
  const p = r.codes.find((x) => x[0] === c);
  return p ? p[1] : d;
};
const num = (r, c, d = 0) => +get(r, c, d);
const all = (r, c) => r.codes.filter((x) => x[0] === c).map((x) => x[1]);

/** Points of a bulged segment p → q (bulge = tan(sweep / 4), positive counter-clockwise). */
function bulgeArc(p, q, b) {
  if (!b) return [q];
  const sw = 4 * Math.atan(b);
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const r = d / (2 * Math.sin(Math.abs(sw) / 2));
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2)) * Math.sign(b) * (Math.abs(sw) > Math.PI ? -1 : 1);
  const n = [-(q[1] - p[1]) / d, (q[0] - p[0]) / d];
  const c = [mid[0] + n[0] * h, mid[1] + n[1] * h];
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  const segs = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 36)));
  const out = [];
  for (let i = 1; i <= segs; i++) out.push([c[0] + r * Math.cos(a0 + (sw * i) / segs), c[1] + r * Math.sin(a0 + (sw * i) / segs), p[2] + ((q[2] ?? p[2]) - p[2]) * (i / segs)]);
  return out;
}
const arcPts = (c, r, a0, a1, z = 0) => {
  let sw = ((a1 - a0) * Math.PI) / 180;
  if (sw <= 0) sw += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(sw / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos((a0 * Math.PI) / 180 + (sw * i) / n), c[1] + r * Math.sin((a0 * Math.PI) / 180 + (sw * i) / n), z]);
};

/** One entity record to geometry in DXF units: { kind: 'line', pts, closed } | { kind: 'face', pts } | … */
function geometryOf(r, report) {
  const P = (k = 0) => [num(r, 10 + k), num(r, 20 + k), num(r, 30 + k)];
  switch (r.type) {
    case 'LINE':
      return { kind: 'line', pts: [P(0), P(1)] };
    case 'LWPOLYLINE': {
      const z = num(r, 38);
      const pts = [];
      let cur = null;
      for (const [c, v] of r.codes) {
        if (c === 10) pts.push((cur = { p: [+v, 0, z], b: 0 }));
        else if (c === 20 && cur) cur.p[1] = +v;
        else if (c === 42 && cur) cur.b = +v;
      }
      const closed = (num(r, 70) & 1) === 1;
      const out = [pts[0].p];
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) out.push(...bulgeArc(pts[i].p, pts[(i + 1) % pts.length].p, pts[i].b));
      if (closed) out.pop();
      return { kind: 'line', pts: out, closed };
    }
    case 'ARC':
      return { kind: 'line', pts: arcPts(P(), num(r, 40), num(r, 50), num(r, 51), num(r, 30)) };
    case 'CIRCLE': {
      const pts = arcPts(P(), num(r, 40), 0, 360, num(r, 30));
      pts.pop();
      return { kind: 'line', pts, closed: true };
    }
    case 'ELLIPSE': {
      const c = P();
      const m = P(1);
      const k = num(r, 40, 1);
      const [t0, t1] = [num(r, 41, 0), num(r, 42, 2 * Math.PI)];
      const minor = [-m[1] * k, m[0] * k];
      let sw = t1 - t0;
      if (sw <= 0) sw += 2 * Math.PI;
      const n = Math.max(8, Math.ceil(sw / (Math.PI / 36)));
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const t = t0 + (sw * i) / n;
        return [c[0] + m[0] * Math.cos(t) + minor[0] * Math.sin(t), c[1] + m[1] * Math.cos(t) + minor[1] * Math.sin(t), c[2]];
      });
      const closed = Math.abs(sw - 2 * Math.PI) < 1e-6;
      if (closed) pts.pop();
      return { kind: 'line', pts, closed };
    }
    case 'SPLINE': {
      const fit = all(r, 11).map((x, i) => [+x, +all(r, 21)[i], +(all(r, 31)[i] ?? 0)]);
      const ctl = all(r, 10).map((x, i) => [+x, +all(r, 20)[i], +(all(r, 30)[i] ?? 0)]);
      if (!fit.length) report.warn('SPLINE without fit points: drawn through its control points (close, not exact).');
      return { kind: 'spline', pts: fit.length ? fit : ctl, closed: (num(r, 70) & 1) === 1 };
    }
    case 'POINT':
      return { kind: 'point', pts: [P()] };
    case '3DFACE': {
      const pts = [P(0), P(1), P(2), P(3)];
      if (G.len(G.sub(pts[3], pts[2])) < 1e-9) pts.pop();
      return { kind: 'face', pts };
    }
    default:
      return null;
  }
}

/** POLYLINE … VERTEX … SEQEND runs folded into one record (a polyline, or a polyface mesh). */
function foldPolylines(recs) {
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type !== 'POLYLINE') {
      out.push(r);
      continue;
    }
    const verts = [];
    while (recs[i + 1] && recs[i + 1].type === 'VERTEX') verts.push(recs[++i]);
    if (recs[i + 1]?.type === 'SEQEND') i++;
    const flags = num(r, 70);
    const layer = get(r, 8, '0');
    const color = r.codes.filter((c) => c[0] === 62 || c[0] === 420);
    if (flags & 64) {
      const v = verts.filter((x) => num(x, 70) & 64).map((x) => [num(x, 10), num(x, 20), num(x, 30)]);
      const faces = verts.filter((x) => (num(x, 70) & 128) && !(num(x, 70) & 64)).map((x) => [71, 72, 73, 74].map((c) => Math.abs(num(x, c))).filter(Boolean).map((k) => k - 1));
      out.push({ type: 'POLYFACE', codes: [[8, layer], ...color], mesh: { v, f: faces } });
    } else {
      const pts = [];
      const v = verts.map((x) => ({ p: [num(x, 10), num(x, 20), num(x, 30) || num(r, 30)], b: num(x, 42) }));
      const closed = (flags & 1) === 1;
      if (v.length) pts.push(v[0].p);
      for (let k = 0; k < (closed ? v.length : v.length - 1); k++) pts.push(...bulgeArc(v[k].p, v[(k + 1) % v.length].p, v[k].b));
      if (closed && pts.length > 1) pts.pop();
      out.push({ type: 'POLYLINE_FOLDED', codes: [[8, layer], ...color], pts, closed });
    }
  }
  return out;
}

export function readDxf(text, { doc, report, opts = {} }) {
  const sec = parseDxf(text);
  if (!sec.ENTITIES) throw new Error('Not a DXF file (no ENTITIES section).');
  const head = sec.HEADER?.head || [];
  const insIdx = head.findIndex((p) => p[0] === 9 && p[1] === '$INSUNITS');
  const insunits = insIdx >= 0 ? +head[insIdx + 1][1] : 0;
  const u = opts.units ? (S.UNITS[opts.units] ?? INSUNITS[opts.units] ?? 1) : (INSUNITS[insunits] ?? 1);
  if (!insunits && !opts.units) report.warn('The DXF does not say its units: read as metres (pass units to change).');
  // layers
  for (const r of sec.TABLES || []) {
    if (r.type !== 'LAYER') continue;
    const name = get(r, 2, '0');
    const t = L.ensureLayer(doc, name);
    const c = num(r, 62, 7);
    t.color = get(r, 420) ? trueColor(get(r, 420)) : ACI[Math.abs(c)] || '#ffffff';
    if (t.color === '#ffffff') t.color = '#1d262c'; // colour 7 is "white on black, black on white": dark on our light view
    t.visible = c >= 0 && !(num(r, 70) & 1);
    if (num(r, 70) & 4) t.locked = true;
    const lt = get(r, 6);
    if (lt && !/^continuous$/i.test(lt)) t.line_type = lt.toLowerCase();
    const lw = num(r, 370, -3);
    if (lw > 0) t.line_weight = lw / 100;
    report.layer(name);
  }
  const recs = foldPolylines(sec.ENTITIES);
  // where the drawing is: project coordinates (big numbers) or a local drawing
  const xs = [];
  for (const r of recs) if (get(r, 10) !== undefined) xs.push([num(r, 10), num(r, 20)]);
  for (const r of recs) if (r.pts?.[0]) xs.push(r.pts[0]);
  const big = xs.some(([x, y]) => Math.abs(x * u) > 1e5 || Math.abs(y * u) > 1e5);
  const project = opts.coordinates === 'project' || (opts.coordinates !== 'local' && big);
  const g = S.geo(doc);
  if (project && !g.base && xs.length) {
    const [cx, cy] = [xs.reduce((s, p) => s + p[0], 0) / xs.length, xs.reduce((s, p) => s + p[1], 0) / xs.length].map((v) => v * u);
    const zs = recs.flatMap((r) => (r.pts ? r.pts.map((p) => p[2]) : r.codes.filter((c) => c[0] === 30 || c[0] === 38).map((c) => +c[1]))).filter(Number.isFinite);
    g.base = [Math.round(cx / 100) * 100, Math.round(cy / 100) * 100, zs.length ? Math.round(((zs.reduce((t, z) => t + z, 0) / zs.length) * u) / 10) * 10 : 0];
  }
  const k = u / S.UNITS[g.units || 'm'];
  const world = ([X, Y, Z = 0]) => (project ? S.toLocal(doc, { e: X * k, n: Y * k, z: Z * k }) : [X * u, Z * u, -Y * u]);
  const local = ([X, Y, Z = 0]) => [X * u, Z * u, -Y * u];
  const look = (r) => {
    const tc = get(r, 420);
    const c = num(r, 62, 256);
    return tc ? { material: { color: trueColor(tc) } } : c > 0 && c < 256 ? { material: { color: ACI[c] } } : { byLayer: true };
  };
  const faces = new Map(); // layer → { v, f }
  const build = (r, at) => {
    const layer = get(r, 8, '0');
    L.ensureLayer(doc, layer);
    if (r.type === 'POLYFACE') {
      const m = { v: r.mesh.v.map(at), f: r.mesh.f.filter((f) => f.length >= 3) };
      const { mesh, origin } = G.recenter(m);
      report.add('meshes');
      return D.addEntity(doc, { name: D.uniqueName(doc, `${layer} mesh`), mesh, position: D.round3(origin), tag: layer, ...look(r) });
    }
    if (r.type === 'POLYLINE_FOLDED') {
      if (r.pts.length < 2) return report.skip('POLYLINE', 'fewer than 2 vertices');
      report.add('curves');
      return addCurve(doc, r.pts.map(at), { name: D.uniqueName(doc, layer), tag: layer, closed: r.closed, ...look(r) });
    }
    const geo = geometryOf(r, report);
    if (!geo) return report.skip(r.type, ['TEXT', 'MTEXT'].includes(r.type) ? 'text is not modelled yet (#31)' : ['HATCH', 'SOLID'].includes(r.type) ? 'fills are not read' : 'not read');
    if (geo.kind === 'face') {
      const m = faces.get(layer) || faces.set(layer, { v: [], f: [], layer, r }).get(layer);
      m.f.push(geo.pts.map((p) => m.v.push(at(p)) - 1));
      return null;
    }
    if (geo.kind === 'point') {
      const [X, Y, Z] = geo.pts[0];
      const p = project ? S.addPoint(doc, { e: X * k, n: Y * k, z: Z * k, code: layer }) : S.addPoint(doc, { ...S.toProject(doc, world(geo.pts[0])), code: layer });
      p.tag = layer;
      report.add('points');
      return p;
    }
    if (geo.pts.length < 2) return report.skip(r.type, 'no length');
    report.add('curves');
    const e = addCurve(doc, geo.pts.map(at), { name: D.uniqueName(doc, layer), tag: layer, closed: geo.closed, ...look(r) });
    if (geo.kind === 'spline') e.curve.kind = geo.pts.length > 2 ? 'spline' : 'polyline';
    return e;
  };
  const flushFaces = () => {
    for (const m of faces.values()) {
      const { mesh, origin } = G.recenter({ v: m.v, f: m.f });
      D.addEntity(doc, { name: D.uniqueName(doc, `${m.layer} faces`), mesh, position: D.round3(origin), tag: m.layer, ...look(m.r) });
      report.add('meshes');
    }
    faces.clear();
  };
  // blocks → components (made the first time an INSERT uses them)
  const blocks = new Map();
  let cur = null;
  for (const r of sec.BLOCKS || []) {
    if (r.type === 'BLOCK') blocks.set(get(r, 2), (cur = { base: [num(r, 10), num(r, 20), num(r, 30)], recs: [] }));
    else if (r.type === 'ENDBLK') cur = null;
    else if (cur) cur.recs.push(r);
  }
  for (const b of blocks.values()) b.recs = foldPolylines(b.recs);
  const made = new Set();
  for (const r of recs) {
    if (r.type !== 'INSERT') {
      build(r, world);
      continue;
    }
    const name = get(r, 2);
    const b = blocks.get(name);
    if (!b || name.startsWith('*')) {
      report.skip('INSERT', name?.startsWith('*') ? 'anonymous block (dimension, hatch)' : `block "${name}" is missing`);
      continue;
    }
    const pos = world([num(r, 10), num(r, 20), num(r, 30)]);
    const tr = { position: D.round3(pos), rotation: [0, num(r, 50), 0], scale: [num(r, 41, 1), num(r, 43, 1), num(r, 42, 1)] };
    const compName = `${name}`;
    if (!made.has(name) && !doc.components?.[compName]) {
      flushFaces();
      const before = doc.entities.length;
      const at = (p) => local([p[0] - b.base[0], p[1] - b.base[1], p[2] - b.base[2]]);
      for (const x of b.recs) x.type === 'INSERT' ? report.skip('INSERT', 'blocks inside blocks are not read yet') : x.type === 'POINT' ? report.skip('POINT', 'inside a block') : build(x, at);
      flushFaces();
      const ents = doc.entities.slice(before).filter((e) => !e.parent);
      if (!ents.length) {
        report.skip('INSERT', `block "${name}" is empty or unreadable`);
        made.add(name);
        continue;
      }
      const grp = Comp.define(doc, compName, ents, [0, 0, 0]);
      Object.assign(grp, tr, { tag: get(r, 8, '0') });
      made.add(name);
      report.add('components');
    } else if (doc.components?.[compName]) {
      Comp.instantiate(doc, compName, tr).tag = get(r, 8, '0');
    }
    report.add('instances');
  }
  flushFaces();
  report.add('layers_in_file', (sec.TABLES || []).filter((r) => r.type === 'LAYER').length);
  return { coordinates: project ? 'project' : 'local', units: u };
}

/** R12 DXF of the given entities: curves and linework as 3D polylines, points with their names, meshes as 3D faces. */
export function writeDxf(doc, { ents, opts = {} }) {
  const out = [];
  const w = (c, v) => out.push(String(c), String(v));
  const project = opts.coordinates !== 'local';
  const xyz = (p) => {
    if (!project) return [p[0], -p[2], p[1]];
    const q = S.toProject(doc, p);
    return [q.e, q.n, q.z];
  };
  const P3 = (q, base = 10) => q.forEach((v, i) => w(base + i * 10, +v.toFixed(6)));
  const P = (p, base = 10) => P3(xyz(p), base);
  const layers = new Set(ents.map((e) => e.tag));
  const aci = (e) => (e.byLayer ? 256 : nearestAci(e.material?.color || '#ffffff'));
  const dxfName = (n) => String(n).replace(/[<>/\\":;?*|=`]/g, '_');
  w(0, 'SECTION');
  w(2, 'HEADER');
  w(9, '$ACADVER');
  w(1, 'AC1009');
  w(9, '$INSUNITS');
  w(70, 6);
  w(0, 'ENDSEC');
  w(0, 'SECTION');
  w(2, 'TABLES');
  w(0, 'TABLE');
  w(2, 'LTYPE');
  w(70, 2);
  for (const [n, d, pat] of [['CONTINUOUS', 'Solid line', []], ['DASHED', '__ __ __', [0.5, -0.25]]]) {
    w(0, 'LTYPE');
    w(2, n);
    w(70, 0);
    w(3, d);
    w(72, 65);
    w(73, pat.length);
    w(40, pat.reduce((s, x) => s + Math.abs(x), 0));
    for (const x of pat) w(49, x);
  }
  w(0, 'ENDTAB');
  w(0, 'TABLE');
  w(2, 'LAYER');
  w(70, layers.size);
  for (const n of layers) {
    const t = L.layerOf(doc, n) || {};
    w(0, 'LAYER');
    w(2, dxfName(n === 'Untagged' ? '0' : n));
    w(70, t.locked ? 4 : 0);
    w(62, (t.visible === false ? -1 : 1) * (t.color ? nearestAci(t.color) : 7));
    w(6, /dash/i.test(t.line_type || '') ? 'DASHED' : 'CONTINUOUS');
  }
  w(0, 'ENDTAB');
  w(0, 'ENDSEC');
  const lay = (e) => dxfName(e.tag === 'Untagged' ? '0' : e.tag);
  const poly = (e, pts, closed, toDxf = xyz) => {
    w(0, 'POLYLINE');
    w(8, lay(e));
    w(62, aci(e));
    w(66, 1);
    w(10, 0);
    w(20, 0);
    w(30, 0);
    w(70, 8 | (closed ? 1 : 0));
    for (const p of pts) {
      w(0, 'VERTEX');
      w(8, lay(e));
      P3(toDxf(p));
      w(70, 32);
    }
    w(0, 'SEQEND');
    w(8, lay(e));
  };
  const faces = (e, m, toDxf = xyz) => {
    for (let fi = 0; fi < m.f.length; fi++)
      for (const t of m.f[fi].length <= 4 ? [m.f[fi]] : G.triangulateFace(m, fi)) {
        w(0, '3DFACE');
        w(8, lay(e));
        w(62, aci(e));
        const q = [...t, ...(t.length === 3 ? [t[2]] : [])];
        q.forEach((i, k) => P3(toDxf(m.v[i]), 10 + k));
      }
  };
  // components as blocks (in their own coordinates), instances as INSERT
  const comps = [...new Set(ents.filter((e) => e.component).map((e) => e.component))];
  if (comps.length) {
    w(0, 'SECTION');
    w(2, 'BLOCKS');
    for (const name of comps) {
      const inst = ents.find((e) => e.component === name);
      w(0, 'BLOCK');
      w(8, '0');
      w(2, dxfName(name));
      w(70, 0);
      w(10, 0);
      w(20, 0);
      w(30, 0);
      const inv = D.worldMatrix(doc, inst).clone().invert();
      for (const c of D.descendants(doc, inst.id)) {
        // part → instance coordinates (the block's own), then DXF axes: x, −z, y
        const rel = inv.clone().multiply(D.worldMatrix(doc, c));
        const toDxf = (p) => {
          const q = applyM(rel, p);
          return [q[0], -q[2], q[1]];
        };
        if (c.mesh) faces(c, c.mesh, toDxf);
        else if (c.curve) poly(c, D.curvePoints(doc, c).map((p) => applyM(inv, p)), c.curve.closed, (q) => [q[0], -q[2], q[1]]);
      }
      w(0, 'ENDBLK');
      w(8, '0');
    }
    w(0, 'ENDSEC');
  }
  w(0, 'SECTION');
  w(2, 'ENTITIES');
  const inComponent = (e) => {
    for (let x = e.parent && D.getEntity(doc, e.parent); x; x = x.parent && D.getEntity(doc, x.parent)) if (x.component) return true;
    return false;
  };
  for (const e of ents) {
    if (inComponent(e)) continue;
    if (e.component) {
      w(0, 'INSERT');
      w(8, lay(e));
      w(2, dxfName(e.component));
      P(D.worldMatrix(doc, e).elements.slice(12, 15));
      w(41, e.scale[0]);
      w(42, e.scale[2]);
      w(43, e.scale[1]);
      w(50, e.rotation[1]);
    } else if (e.curve) poly(e, D.curvePoints(doc, e).slice(0, e.curve.closed ? -1 : undefined), e.curve.closed);
    else if (S.isLinework(e)) poly(e, S.lineworkPath(doc, e), e.line.closed);
    else if (S.isPoint(e)) {
      const p = D.worldMatrix(doc, e).elements.slice(12, 15);
      w(0, 'POINT');
      w(8, lay(e));
      P(p);
      w(0, 'TEXT');
      w(8, lay(e));
      P(p);
      w(40, opts.text_height || 0.5);
      w(1, e.name);
    } else if (e.mesh) faces(e, D.worldMesh(doc, e));
  }
  w(0, 'ENDSEC');
  w(0, 'EOF');
  return `${out.join('\n')}\n`;
}

const applyM = (m, p) => {
  const e = m.elements;
  return [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]];
};

registerFormat({
  id: 'dxf',
  label: 'DXF (CAD linework, layers, blocks, 3D faces)',
  extensions: ['dxf'],
  options: { coordinates: '"project" (E, N, Z: default when the numbers are big) or "local"', units: 'file units when the DXF does not say: m, ft, usft' },
  read: readDxf,
  write: writeDxf,
});
