// Generators for site work: TIN surfaces from survey data, corridors, and quick field designs. They are derived
// entities, so a surface rebuilds when a point moves, a corridor when its alignment or the ground changes.
import * as G from './geometry.js';
import * as D from './document.js';
import * as S from './survey.js';
import * as TR from './terrain.js';
import { registerGenerator } from './derived.js';

const wpos = (doc, e) => D.worldMatrix(doc, e).elements.slice(12, 15);
const key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;

/** A world point from a design reference: [x, y, z], or { point: id } (that point, wherever it is now). */
export function refPoint(doc, ref) {
  if (Array.isArray(ref)) return ref;
  if (ref && ref.point) {
    const p = D.getEntity(doc, ref.point);
    if (!p) throw new Error(`The point ${ref.point} was deleted.`);
    return wpos(doc, p);
  }
  throw new Error('A design point is [x, y, z] or a point name.');
}
const refIds = (refs) => refs.filter((r) => r && !Array.isArray(r) && r.point).map((r) => r.point);

/** The point / linework entities a surface is made from. */
export function surfaceSources(doc, p) {
  const excluded = new Set(p.exclude || []);
  let pts;
  if (p.points === undefined || p.points === 'all') pts = S.points(doc);
  else if (Array.isArray(p.points)) pts = p.points.map((id) => D.getEntity(doc, id)).filter(Boolean);
  else if (p.points.codes) {
    const want = new Set(p.points.codes.map((c) => c.toUpperCase()));
    pts = S.points(doc).filter((x) => want.has(S.parseCode(x.point.code).code));
  } else pts = [];
  const lw = (spec, kind) =>
    (spec === undefined || spec === 'all' ? doc.entities.filter((x) => S.isLinework(x) && x.line.kind === kind) : spec === 'none' ? [] : spec.map((id) => D.getEntity(doc, id)).filter(Boolean)).filter((x) => S.isLinework(x));
  return { points: pts.filter((x) => !excluded.has(x.id)), breaklines: lw(p.breaklines, 'breakline'), boundaries: lw(p.boundaries, 'boundary') };
}

/** Build a surface mesh (local coordinates) with its report. */
export function buildSurface(doc, p) {
  const src = surfaceSources(doc, p);
  const base = S.geo(doc).base || [0, 0, 0];
  const v = [];
  const vertexIds = [];
  const index = new Map();
  const duplicates = [];
  for (const pt of src.points) {
    const w = wpos(doc, pt);
    const z = w[1] + base[2];
    if ((p.min_z !== undefined && z < p.min_z) || (p.max_z !== undefined && z > p.max_z)) continue;
    const k = key(w[0], w[2]);
    if (index.has(k)) {
      duplicates.push({ kept: vertexIds[index.get(k)], dropped: pt.id, dz: Math.round((w[1] - v[index.get(k)][1]) * 1000) / 1000 });
      continue;
    }
    index.set(k, v.length);
    v.push(w);
    vertexIds.push(pt.id);
  }
  const vertexOf = (q) => {
    const k = key(q[0], q[2]);
    if (!index.has(k)) index.set(k, v.push(q) - 1), vertexIds.push(null); // a point added along a smooth line
    return index.get(k);
  };
  const constraints = [];
  const owners = [];
  const outer = [];
  const holes = [];
  for (const l of [...src.breaklines, ...src.boundaries]) {
    const path = S.lineworkPath(doc, l);
    const ids = path.map(vertexOf);
    for (let k = 1; k < ids.length; k++) for (const seg of splitAtPoints(v, ids[k - 1], ids[k])) constraints.push(seg), owners.push(l.id);
    if (l.line.kind === 'boundary') (l.line.boundary === 'hole' ? holes : outer).push(path.map((q) => [q[0], q[2]]));
  }
  const { faces, failed } = TR.triangulate(v, { constraints, outer, holes, maxEdge: p.max_edge || 0 });
  let f = faces;
  for (const [x, z] of p.deleted || []) f = f.filter((tri) => !insideTri([x, z], tri.map((i) => v[i])));
  for (const [a, b] of p.swaps || []) TR.swapEdge(f, v, vertexIds.indexOf(a), vertexIds.indexOf(b));
  if (!f.length) throw new Error('No triangles left (check the boundary and max_edge).');
  const used = [...new Set(f.flat())].sort((a, b) => a - b);
  const re = new Map(used.map((o, i) => [o, i]));
  return {
    mesh: { v: used.map((i) => v[i]), f: f.map((tri) => tri.map((i) => re.get(i))) },
    report: { points: src.points.length, duplicates, crossings: [...new Set(failed.map((k) => owners[k]))], vertexIds: used.map((i) => vertexIds[i]) },
  };
}

/** A constraint a→b cut at every vertex lying on it (a breakline through another point), in order along it. */
function splitAtPoints(v, a, b) {
  const [p, q] = [v[a], v[b]];
  const dx = q[0] - p[0];
  const dz = q[2] - p[2];
  const L2 = dx * dx + dz * dz;
  if (L2 < 1e-12) return [];
  const on = [];
  v.forEach((r, i) => {
    if (i === a || i === b) return;
    const t = ((r[0] - p[0]) * dx + (r[2] - p[2]) * dz) / L2;
    if (t <= 1e-9 || t >= 1 - 1e-9) return;
    if (Math.abs((r[0] - p[0]) * dz - (r[2] - p[2]) * dx) / Math.sqrt(L2) < 1e-3) on.push([t, i]);
  });
  const chain = [a, ...on.sort((x, y) => x[0] - y[0]).map(([, i]) => i), b];
  return chain.slice(1).map((i, k) => [chain[k], i]);
}

function insideTri([x, z], [a, b, c]) {
  const s = (p, q) => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

/** World mesh of a surface entity, and a height sampler over it. */
export const surfaceSampler = (doc, e) => TR.sampler(D.worldMesh(doc, e));

const world = (fn) => (args) => {
  const out = fn(args);
  const report = out.report;
  const r = G.recenter(out.mesh || out);
  return report ? { ...r, report } : r;
};

registerGenerator('surface', {
  description: 'TIN surface from survey points, breaklines and boundaries (stays live)',
  world: true,
  params: { points: '"all", point ids, or { codes: [...] }', breaklines: '"all", "none" or ids', boundaries: '"all", "none" or ids', exclude: 'point ids left out', max_edge: 'drop triangles with a longer side, m', min_z: 'ignore points below, m', max_z: 'ignore points above, m', deleted: '[[x, z], …] triangles removed by hand', swaps: '[[point, point], …] edges flipped by hand' },
  inputsFrom: (p, doc) => {
    const s = surfaceSources(doc, p);
    return [...s.points, ...s.breaklines, ...s.boundaries].map((x) => x.id);
  },
  run: world(({ params, doc }) => buildSurface(doc, params)),
});

registerGenerator('corridor', {
  description: 'A cross-section template swept along an alignment, daylighting to the ground',
  world: true,
  params: { template: '{ lanes: [{ width, crossfall }], shoulder: { width, crossfall }, cut_slope, fill_slope }', interval: 'm between sections' },
  run: world(({ params, inputs, doc }) => {
    const [al, ground] = inputs;
    if (!al?.curve) throw new Error('A corridor needs an alignment.');
    const pts = D.curvePoints(doc, al, 8);
    let s = 0;
    const path = pts.map((q, i) => (i && (s += Math.hypot(q[0] - pts[i - 1][0], q[2] - pts[i - 1][2])), [...q, s]));
    return TR.corridorMesh(path, params.template || {}, ground ? surfaceSampler(doc, ground).z : null, params.interval || 5);
  }),
});

const design = (name, description, params, fn, extraInputs = () => []) =>
  registerGenerator(name, {
    description,
    world: true,
    params,
    inputsFrom: (p) => [...refIds(Object.values(p).flat()), ...extraInputs(p)],
    run: world(({ params: p, inputs, doc }) => fn(p, doc, inputs)),
  });
const groundOf = (doc, id) => (id ? surfaceSampler(doc, D.getEntity(doc, id)).z : null);

design('design_line_slope', 'Line with a cross slope either side', { from: 'start', to: 'end', left: 'm', right: 'm', left_slope: '%', right_slope: '%' }, (p, doc) => TR.lineSlope(refPoint(doc, p.from), refPoint(doc, p.to), p));
design('design_plane', 'Plane through three points, or a point with a slope and a bearing', { points: 'three points', point: 'a point', slope: '%', bearing: 'degrees from north', size: '[w, d] m' }, (p, doc) =>
  TR.planeDesign({ ...p, points: p.points ? p.points.map((q) => refPoint(doc, q)) : null, point: p.point ? refPoint(doc, p.point) : null }),
);
design('design_trench', 'Trench along a line: bottom width, depth or inverts, side slopes to the ground', { from: 'start', to: 'end', bottom: 'm', depth: 'm', invert_a: 'm (local)', invert_b: 'm (local)', side_slope: 'H:V', surface: 'ground' }, (p, doc) =>
  TR.trench(refPoint(doc, p.from), refPoint(doc, p.to), { ...p, ground: groundOf(doc, p.surface) }),
(p) => (p.surface ? [p.surface] : []));
design('design_offset_surface', 'A surface moved up or down (e.g. a topsoil strip)', { surface: 'surface id', offset: 'm' }, (p, doc) => {
  const m = D.worldMesh(doc, D.getEntity(doc, p.surface));
  return { v: m.v.map((q) => [q[0], q[1] + (p.offset || 0), q[2]]), f: m.f.map((f) => [...f]) };
}, (p) => [p.surface]);
design('design_road', 'Simple road: centreline, width, crossfall', { centre: 'points', width: 'm', crossfall: '%' }, (p, doc) => TR.roadDesign(p.centre.map((q) => refPoint(doc, q)), p));
