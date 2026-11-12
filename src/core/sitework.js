// Generators for site work: TIN surfaces from survey data, corridors, and quick field designs. They are derived
// entities, so a surface rebuilds when a point moves, a corridor when its alignment or the ground changes.
import * as G from './geometry.js';
import * as D from './document.js';
import * as S from './survey.js';
import * as TR from './terrain.js';
import { registerGenerator } from './derived.js';
import * as SF from './surfaces.js';
import * as RD from './roads.js';

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
    (spec === undefined || spec === 'all' ? doc.entities.filter((x) => S.isLinework(x) && x.line.kind === kind) : spec === 'none' ? [] : spec.map((id) => D.getEntity(doc, id)).filter(Boolean)).filter((x) => S.isLinework(x) || (kind === 'breakline' && x.curve)); // a listed curve is a breakline too (#239)
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
  const constrain = (path, owner) => {
    const ids = path.map(vertexOf);
    for (let k = 1; k < ids.length; k++) for (const seg of splitAtPoints(v, ids[k - 1], ids[k])) constraints.push(seg), owners.push(owner);
  };
  // breaklines drawn on the surface itself: [[x, y, z], …] in the model (#239)
  (p.lines || []).forEach((path, i) => path.length >= 2 && constrain(path, `line ${i + 1}`));
  for (const l of [...src.breaklines, ...src.boundaries]) {
    const path = l.line ? S.lineworkPath(doc, l) : D.curvePoints(doc, l, 8);
    constrain(path, l.id);
    if (l.line?.kind === 'boundary') (l.line.boundary === 'hole' ? holes : outer).push(path.map((q) => [q[0], q[2]]));
  }
  // a drawn outline and voids in plan (#212), next to the boundaries made of points
  if (p.outline?.length >= 3) outer.push(p.outline);
  for (const h of p.voids || []) if (h.length >= 3) holes.push(h);
  const { faces, failed } = TR.triangulate(v, { constraints, outer, holes, maxEdge: p.max_edge || 0 });
  let f = faces;
  if (p.min_edge > 0) f = f.filter((tri) => tri.every((i, k) => Math.hypot(v[i][0] - v[tri[(k + 1) % 3]][0], v[i][2] - v[tri[(k + 1) % 3]][2]) >= p.min_edge));
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

// ---------------------------------------------------------------- the editable definition (#239)

export const SURFACE_VERSION = 2;

/** Old surface params → the current definition: every list present, unusable rings dropped, no repeats. */
export function migrateSurface(p) {
  if (p.version >= SURFACE_VERSION) return p;
  const ring = (r) => Array.isArray(r) && r.length >= 3;
  const out = { ...p, version: SURFACE_VERSION, exclude: [...new Set(p.exclude || [])], lines: (p.lines || []).filter((l) => l.length >= 2), voids: (p.voids || []).filter(ring) };
  if (!ring(out.outline)) delete out.outline;
  return out;
}

/** Every surface in a document onto the current definition (when a file opens). */
export function migrateSurfaces(doc) {
  for (const e of doc.entities) if (e.derived?.generator === 'surface') e.derived.params = migrateSurface(e.derived.params);
  return doc;
}

/** A plan ring [[x, z], …] after one vertex edit: move (index, to), insert (before index, to), remove (index). */
export function editRing(ring, { action, index, to }) {
  const r = ring.map((q) => [...q]);
  if (action === 'insert') return r.splice(Math.max(0, Math.min(index ?? r.length, r.length)), 0, [to[0], to[1]]), r;
  if (!(index >= 0 && index < r.length)) throw new Error(`No vertex ${index}: the ring has ${r.length} (0–${r.length - 1}).`);
  if (action === 'move') r[index] = [to[0], to[1]];
  else if (action === 'remove') {
    if (r.length <= 3) throw new Error('A ring keeps at least 3 vertices (clear it instead).');
    r.splice(index, 1);
  } else throw new Error(`Unknown ring edit "${action}".`);
  return r;
}

/** Where a new vertex goes so it splits the ring edge nearest the plan point [x, z]. */
export function ringInsertIndex(ring, [x, z]) {
  let best = 0;
  let bestD = Infinity;
  ring.forEach((a, k) => {
    const b = ring[(k + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(a[0] + t * dx - x, a[1] + t * dz - z);
    if (d < bestD) (bestD = d), (best = k + 1);
  });
  return best;
}

/** What a surface is made of, for the panel and the AI: counts and the lists behind them. */
export function surfaceDefinition(doc, e) {
  const p = migrateSurface(e.derived.params);
  const src = surfaceSources(doc, p);
  const name = (id) => D.getEntity(doc, id)?.name || id;
  return {
    points: src.points.length,
    point_source: p.points === undefined || p.points === 'all' ? 'all' : Array.isArray(p.points) ? 'list' : 'codes',
    excluded: p.exclude.map(name),
    breaklines: src.breaklines.map((l) => ({ id: l.id, name: l.name })),
    drawn_breaklines: p.lines.length,
    boundaries: src.boundaries.map((l) => ({ id: l.id, name: l.name, kind: l.line.boundary || 'outer' })),
    outline: p.outline || null,
    voids: p.voids,
    max_edge: p.max_edge || 0,
    min_edge: p.min_edge || 0,
    swaps: (p.swaps || []).map((s) => s.map(name)),
    deleted_triangles: (p.deleted || []).length,
  };
}

/** World mesh of a surface entity, and a height sampler over it. */
export const surfaceSampler = (doc, e) => TR.sampler(D.worldMesh(doc, e));

const world = (fn) => (args) => {
  const out = fn(args);
  const report = out.report;
  const r = G.recenter(out.mesh || out);
  const fc = (out.mesh || out).fc; // per-face colours (a corridor's cut and fill slopes)
  if (fc) r.mesh.fc = fc;
  return report ? { ...r, report } : r;
};

registerGenerator('surface', {
  description: 'TIN surface from survey points, breaklines and boundaries (stays live)',
  world: true,
  params: { version: 'definition version (2)', points: '"all", point ids, or { codes: [...] }', breaklines: '"all", "none" or ids (linework or curves)', lines: 'breaklines drawn on the surface [[[x, y, z], …], …]', boundaries: '"all", "none" or ids', exclude: 'point ids left out', max_edge: 'drop triangles with a longer side, m', min_edge: 'drop triangles with a shorter side, m', outline: 'plan outline [[x, z], …]', voids: 'areas left out [[[x, z], …], …]', min_z: 'ignore points below, m', max_z: 'ignore points above, m', deleted: '[[x, z], …] triangles removed by hand', swaps: '[[point, point], …] edges flipped by hand', adjustments: 'sculpt / stamp operations applied on top (design adjustments)' },
  inputsFrom: (p, doc) => {
    const s = surfaceSources(doc, p);
    return [...s.points, ...s.breaklines, ...s.boundaries].map((x) => x.id);
  },
  run: world(({ params, doc }) => {
    const r = buildSurface(doc, params);
    // sculpting a survey surface is a design adjustment on top: the surveyed points themselves never move
    for (const op of params.adjustments || []) r.mesh = op.outline ? SF.stampMesh(r.mesh, op.outline, op) : SF.sculpt(r.mesh, op);
    return r;
  }),
});

/** The alignment as sampled [x, y, z, station] points. */
export function alignmentPath(doc, al) {
  if (!al?.curve) throw new Error('A corridor needs an alignment.');
  const pts = D.curvePoints(doc, al, 8);
  let s = 0;
  return pts.map((q, i) => (i && (s += Math.hypot(q[0] - pts[i - 1][0], q[2] - pts[i - 1][2])), [...q, s]));
}

/** A corridor's cross-sections, path, alignment and ground (#166–#170). */
export function corridorOf(doc, e) {
  if (e?.derived?.generator !== 'corridor') throw new Error(`${e?.name || 'That'} is not a corridor (create_corridor makes one).`);
  const [al, ground] = e.derived.inputs.map((id) => D.getEntity(doc, id));
  const path = alignmentPath(doc, al);
  const g = ground ? surfaceSampler(doc, ground).z : null;
  const { template = {}, interval = 5 } = e.derived.params;
  return { path, alignment: al, ground, groundZ: g, template, sections: RD.corridorSections(path, template, g, interval) };
}

registerGenerator('corridor', {
  description: 'A cross-section template swept along an alignment, daylighting to the ground: lanes, shoulders, ditches, benches, cut and fill slopes coloured',
  world: true,
  params: { template: '{ lanes: [{ width, crossfall }], shoulder: { width, crossfall }, cut_slope, fill_slope, left / right: { cut_slope, fill_slope }, ditch: { width, depth, slope }, bench: { every, width }, layers: [{ name, thickness, material }], superelevation: { rate, runoff } }', interval: 'm between sections' },
  run: world(({ params, inputs, doc }) => {
    const [al, ground] = inputs;
    const path = alignmentPath(doc, al);
    return RD.corridorMesh(RD.corridorSections(path, params.template || {}, ground ? surfaceSampler(doc, ground).z : null, params.interval || 5));
  }),
});

/** The existing ground with the corridor let into it (#166): live, the ground itself is never edited. */
registerGenerator('finished_ground', {
  description: 'The existing ground with a corridor let into it (the cut and the fill it makes), kept live',
  world: true,
  params: {},
  run: world(({ inputs, doc }) => {
    const [corridor, ground] = inputs;
    return RD.finishedGround(D.worldMesh(doc, ground), corridorOf(doc, corridor).sections, ground.material?.color);
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

// ---------------------------------------------------------------- terrain depth (#121, #123, #120, #34, #35)
const inRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > z !== ring[j][1] > z && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  return c;
};

/** A design pad: a top at an elevation (or a grade) inside a closed curve, batters out to the ground. */
registerGenerator('pad', {
  description: 'Building pad / platform with cut and fill batter slopes to the ground (daylighting); follows its outline and the ground',
  world: true,
  params: { elevation: 'model height of the top', grade: '%', bearing: 'degrees: the direction the grade rises', cut_slope: 'H:V', fill_slope: 'H:V', outline: '[[x, y, z], …] when there is no curve input' },
  run: world(({ params: p, inputs, doc }) => {
    const [curve, ground] = inputs;
    const outline = curve ? D.curvePoints(doc, curve) : p.outline;
    if (!outline) throw new Error('A pad needs an outline (a closed curve).');
    const g = ground ? surfaceSampler(doc, ground).z : () => p.elevation;
    return SF.padMesh(outline, { ...p, ground: g }).mesh;
  }),
});

/** The ground with pads let into it: the ground outside each pad's daylight line, plus the pads. */
registerGenerator('design_surface', {
  description: 'Existing ground merged with design pads: one surface for volumes and views',
  world: true,
  params: {},
  run: world(({ inputs, doc }) => {
    const [ground, ...pads] = inputs;
    const gm = D.worldMesh(doc, ground);
    const padMeshes = pads.map((pd) => D.worldMesh(doc, pd));
    // a pad mesh is its top face, then its daylight ring
    const rings = padMeshes.map((m) => m.v.slice(m.f[0].length));
    const holes = rings.map((r) => r.map((q) => [q[0], q[2]]));
    const v = [...gm.v.filter((q) => !holes.some((h) => inRing(h, q[0], q[2]))), ...rings.flat()];
    const { faces } = TR.triangulate(v, { holes });
    const out = { v, f: [...faces] };
    for (const m of padMeshes) {
      const base = out.v.length;
      out.v = [...out.v, ...m.v];
      out.f.push(...m.f.map((f) => f.map((i) => i + base)));
    }
    return out;
  }),
});

/** A smoother version of a surface: the surveyed points stay, the triangles between them are rounded. */
registerGenerator('smoothed_surface', {
  description: 'A surface subdivided and smoothed between its surveyed points (which stay where they are)',
  world: true,
  params: { levels: 'subdivisions (1–3)', iterations: 'smoothing passes', strength: '0–1', keep_points: 'surveyed points stay (default true)' },
  run: world(({ params: p, inputs, doc }) => SF.smoothMesh(D.worldMesh(doc, inputs[0]), { levels: Math.min(3, p.levels ?? 1), iterations: p.iterations ?? 10, strength: p.strength ?? 0.5, keep: p.keep_points !== false })),
});

/** A surface from contour lines (curves at their elevations); edit a contour and it rebuilds. */
registerGenerator('contour_surface', {
  description: 'TIN from contour lines, with flat triangles lifted; follows the contours',
  world: true,
  params: { spacing: 'resample the contours every m', weed: 'drop contour points closer than m to a straight line' },
  run: world(({ params: p, inputs, doc }) => SF.contourSurface(inputs.map((c) => ({ pts: D.curvePoints(doc, c).slice(0, c.curve.closed ? -1 : undefined), closed: !!c.curve.closed })), p).mesh),
});

/** A cheap fingerprint of where a mesh's points are (it changes when the surface is rebuilt or moved). */
function stampOf(e) {
  let h = e.mesh.v.length;
  const step = Math.max(1, Math.floor(e.mesh.v.length / 500));
  for (let i = 0; i < e.mesh.v.length; i += step) h = (h * 31 + e.mesh.v[i][0] * 7 + e.mesh.v[i][1] * 13 + e.mesh.v[i][2] * 17) % 1e9;
  return `${h.toFixed(3)}|${e.position.join(',')}|${e.mesh.f.length}`;
}

/** After every change: contour groups and analysis colours follow their surfaces. */
export function syncTerrain(doc) {
  const baseZ = S.geo(doc).base?.[2] ?? 0;
  for (const g of doc.entities.filter((x) => x.contours)) {
    const s = D.getEntity(doc, g.contours.surface);
    if (!s?.mesh) continue;
    const c = g.contours;
    const st = `${stampOf(s)}|${c.interval}|${c.major_every}|${c.smooth}|${c.base}`;
    if (c.stamp === st) continue;
    for (const old of D.childrenOf(doc, g.id)) D.removeEntity(doc, old);
    const levels = SF.contours(D.worldMesh(doc, s), { interval: c.interval, base: (c.base ?? 0) - baseZ, major_every: c.major_every ?? 5, smooth: c.smooth ?? 0 });
    for (const lv of levels)
      for (const l of lv.lines) {
        const { mesh, origin } = G.recenter({ v: l.pts.map(D.round3), f: [] });
        const z = Math.round((lv.z + baseZ) * 1000) / 1000;
        D.addEntity(doc, { type: 'curve', parent: g.id, name: z.toFixed(2), tag: g.tag, curve: { kind: 'polyline', points: mesh.v, closed: l.closed }, position: D.round3(origin), material: { color: lv.major ? '#6b4e2e' : '#a88a63' }, meta: { elevation: z, ...(lv.major ? { major: true } : {}) } });
      }
    c.stamp = st;
    c.levels = levels.length;
  }
  for (const e of doc.entities.filter((x) => x.analysis && x.mesh)) {
    const other = e.analysis.other && D.getEntity(doc, e.analysis.other);
    const st = stampOf(e) + (other?.mesh ? stampOf(other) : '');
    if (e.analysis.stamp === st && e.mesh.fc) continue;
    const r = SF.analyze(D.worldMesh(doc, e), { ...e.analysis, base: baseZ, other: other?.mesh ? surfaceSampler(doc, other).z : null });
    e.mesh = { ...e.mesh, fc: r.fc };
    e.analysis.legend = r.legend;
    e.analysis.stamp = st;
  }
}
