// Phase 6 (survey-grade terrain): coordinates, points, linework, live TIN surfaces, checks, feature codes,
// earthworks, alignments, corridors and quick field designs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import * as S from '../src/core/survey.js';
import * as TR from '../src/core/terrain.js';

/** A 5 × 5 grid of points 10 m apart near real-world coordinates, sloping 1 % to the east. */
async function grid(reg, { z0 = 100, code = 'GND' } = {}) {
  const rows = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) rows.push(`G${i}${j},${5400000 + i * 10},${650000 + j * 10},${z0 + j * 0.1},${code}`);
  return reg.run('import_points', { text: rows.join('\n') });
}

test('coordinates: real-world points stay exact around a base point; units, COGO and moves', async () => {
  const { ctx, reg } = makeCtx();
  const a = await reg.run('add_point', { name: 'A', n: 5400123.4567, e: 650987.6543, z: 120.25, code: 'CP' });
  assert.deepEqual(S.geo(ctx.doc).base, [651000, 5400100, 120]);
  nearArr(ctx.doc.entities[0].position, [-12.3457, 0.25, -23.4567], 1e-4); // small numbers in the model
  assert.equal(a.n, 5400123.4567);
  const b = await reg.run('add_point', { name: 'B', from: 'A', bearing: '90°00\'00"', distance: 10, dz: -1 });
  near(b.e, 650997.6543, 1e-6);
  near(b.n, 5400123.4567, 1e-6);
  await reg.run('set_units', { length: 'usft' });
  const c = await reg.run('add_point', { name: 'C', n: 1000, e: 1000, z: 10 });
  near(ctx.doc.entities.find((e) => e.name === 'C').point.z, 10 * (1200 / 3937), 1e-12); // US survey feet, not feet
  await reg.run('set_units', { length: 'm' });
  await reg.run('move', { ids: ['A'], by: [1, 0, 0] });
  near((await reg.run('query_points', { name: 'A' })).points[0].e, 650988.6543, 1e-4); // the model move updated E
  const before = ctx.doc.entities.find((e) => e.name === 'A').position[0];
  await reg.run('set_base_point', { e: 650900, n: 5400000, z: 100 });
  near(ctx.doc.entities.find((e) => e.name === 'A').position[0], before + 100, 1e-6);
  near((await reg.run('query_points', { name: 'A' })).points[0].e, 650988.6543, 1e-4); // same place in the world
  assert.throws(() => S.parseAngle('north'), /Cannot read the angle/);
  assert.equal(S.formatAngle(45.5, 'dms'), '45°30\'00.0"');
});

test('import / export / query points', async () => {
  const { reg } = makeCtx();
  const r = await reg.run('import_points', { text: 'Name,North,East,Elev,Code\n1,100,200,10,MH\n2,110,200,11,MH\n3,105,210,10.5,TREE\nbad,line\n', format: 'PNEZD' });
  assert.equal(r.imported, 3);
  assert.deepEqual(r.skipped_lines, [5]);
  const ft = await reg.run('import_points', { text: '4 328.084 656.168 32.8084 GND', format: 'PNEZD', units: 'ft' });
  assert.equal(ft.imported, 1);
  near((await reg.run('query_points', { name: '4' })).points[0].n, 100, 1e-4);
  assert.equal((await reg.run('query_points', { code: 'mh' })).count, 2);
  const near1 = await reg.run('query_points', { near: '1', radius: 10.5 });
  assert.deepEqual(near1.points.map((p) => p.name), ['1', '4', '2']);
  const out = await reg.run('export_points', { format: 'PENZD' });
  assert.match(out.text, /^1,200\.0000,100\.0000,10\.0000,MH\n/);
});

test('a live TIN: rebuilds when a point moves or is added; breaklines and boundaries shape it', async () => {
  const { ctx, reg } = makeCtx();
  await grid(reg);
  const s = await reg.run('create_surface', { name: 'EG' });
  assert.equal(s.surface.points, 25);
  near(s.surface.area_2d, 1600, 1e-6);
  await reg.run('edit_points', { points: ['G22'], raise: 2 });
  near((await reg.run('get_entity', { id: 'EG' })).max[1], 2 + 0.2 + (100 - 100), 0.01);
  await reg.run('add_point', { name: 'X', n: 5400045, e: 650020, z: 100.2 });
  near((await reg.run('get_entity', { id: 'EG' })).size[2], 45, 1e-6); // grew to the new point
  // a breakline across two cells must appear as an edge
  await reg.run('add_breakline', { points: ['G11', 'G33'] });
  const e = ctx.doc.entities.find((x) => x.name === 'EG');
  const ids = e.derived.report.vertexIds;
  const [a, b] = ['G11', 'G33'].map((n) => ids.indexOf(ctx.doc.entities.find((x) => x.name === n).id));
  const mid = ids.indexOf(ctx.doc.entities.find((x) => x.name === 'G22').id);
  const edge = (p, q) => e.mesh.f.some((f) => f.includes(p) && f.includes(q));
  assert.ok(edge(a, mid) && edge(mid, b), 'the breakline runs through G22 as triangle edges');
  // an outer boundary trims it, a hole cuts it
  await reg.run('add_boundary', { points: ['G00', 'G04', 'G44', 'G40'] });
  near((await reg.run('rebuild_surface', { id: 'EG' })).surface.area_2d, 1600, 1e-6);
  await reg.run('add_boundary', { points: ['G11', 'G13', 'G33', 'G31'], kind: 'hole' });
  near((await reg.run('rebuild_surface', { id: 'EG' })).surface.area_2d, 1600 - 400, 1e-6);
  await reg.run('edit_triangles', { id: 'EG', action: 'delete', at: [e.mesh.v[0][0] + 0.1, e.mesh.v[0][2] + 0.1] });
  assert.ok((await reg.run('get_entity', { id: 'EG' })).faces.length < 50);
  await reg.run('edit_triangles', { id: 'EG', action: 'restore' });
  await reg.run('set_surface_sources', { id: 'EG', boundaries: 'none', exclude: ['X'] });
  near((await reg.run('rebuild_surface', { id: 'EG' })).surface.area_2d, 1600, 1e-6);
});

test('check_surface finds a spike, duplicates and crossing breaklines', async () => {
  const { reg } = makeCtx();
  await grid(reg);
  await reg.run('edit_points', { points: ['G22'], raise: 8 });
  await reg.run('add_point', { name: 'Dup', n: 5400010, e: 650010, z: 100.4 });
  await reg.run('add_breakline', { points: ['G10', 'G32'] });
  await reg.run('add_breakline', { points: ['G30', 'G12'] });
  await reg.run('create_surface', { name: 'EG' });
  const r = await reg.run('check_surface', { id: 'EG' });
  const kinds = r.issues.map((i) => i.kind);
  assert.ok(r.issues.some((i) => i.kind === 'spike' && i.name === 'G22'), JSON.stringify(r.issues.map((i) => i.message)));
  assert.ok(r.issues.some((i) => i.kind === 'duplicate' && /G11 and Dup/.test(i.message)));
  assert.ok(kinds.includes('crossing_breaklines'));
});

test('feature codes draw the drawing: lines, breaklines, trees, layers, warnings', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('define_feature_code', { code: 'KERB', layer: 'Kerbs', color: '#c8553d', line: true, breakline: true });
  await reg.run('define_feature_code', { code: 'TREE', layer: 'Trees', object: { type: 'tree', height_attr: 'height', height: 5 }, attrs: [{ name: 'height', type: 'number', required: true }] });
  const r = await reg.run('import_points', { text: ['1,0,0,10,KERB B', '2,0,10,10,KERB', '3,0,20,10,KERB E', '4,5,0,10,KERB 2', '5,5,10,10,KERB 2', '6,8,8,10,TREE', '7,9,9,10,FENCE'].join('\n') });
  assert.equal(r.lines, 2);
  assert.equal(r.objects, 1);
  assert.ok(r.warnings.some((w) => /no feature code "FENCE"/.test(w)));
  assert.ok(r.warnings.some((w) => /Point 6 \(TREE\): height is needed/.test(w)));
  const lines = ctx.doc.entities.filter((e) => e.type === 'linework');
  assert.deepEqual(lines.map((l) => [l.name, l.line.kind, l.line.points.length, l.tag]), [['KERB', 'breakline', 3, 'Kerbs'], ['KERB 2', 'breakline', 2, 'Kerbs']]);
  await reg.run('edit_points', { points: ['6'], attrs: { height: 9 } });
  const tree = ctx.doc.entities.find((e) => e.name === 'TREE 6');
  near((await reg.run('get_entity', { id: tree.id })).size[1], 9, 1e-6); // reprocessed: sized by its attribute
  assert.equal(ctx.doc.entities.filter((e) => e.fromCodes).length, 3); // no duplicates after reprocessing
  const lib = await reg.run('export_feature_library');
  assert.deepEqual(Object.keys(lib.library), ['KERB', 'TREE']);
});

test('earthworks: surface to elevation, surface to surface, a stockpile, a cut/fill map', async () => {
  const { ctx, reg } = makeCtx();
  const pts = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push(`E${i}_${j},${i * 2},${j * 2},10,GND`);
  await reg.run('import_points', { text: pts.join('\n') });
  await reg.run('create_surface', { name: 'EG' });
  const r = await reg.run('cut_fill', { existing: 'EG', elevation: 11, cell: 0.5 });
  near(r.fill, 400, 1e-6);
  near(r.cut, 0, 1e-9);
  assert.ok(ctx.doc.entities.find((e) => e.id === r.map).mesh.fc.length > 100);
  const off = await reg.run('design_offset_surface', { surface: 'EG', offset: -0.3, name: 'Strip' });
  const c = await reg.run('cut_fill', { existing: 'EG', design: off.id, cell: 0.5, map: false, bulking: 1.2 });
  near(c.cut, 400 * 0.3, 1e-6);
  near(c.adjusted.cut_loose, 400 * 0.3 * 1.2, 1e-4);
  // a 2 m high pyramid pile on a 8 × 8 base, measured above a boundary through its foot
  const { reg: r2 } = makeCtx();
  const pile = ['P1,4,4,10,PILE', 'P2,4,12,10,PILE', 'P3,12,12,10,PILE', 'P4,12,4,10,PILE', 'Top,8,8,12,PILE', 'G1,0,0,10,GND', 'G2,0,16,10,GND', 'G3,16,16,10,GND', 'G4,16,0,10,GND'];
  await r2.run('import_points', { text: pile.join('\n') });
  await r2.run('create_surface', { name: 'Pile' });
  const bnd = await r2.run('add_boundary', { points: ['P1', 'P2', 'P3', 'P4'], name: 'Toe' });
  await r2.run('set_surface_sources', { id: 'Pile', boundaries: 'none' }); // the toe line measures, it does not trim
  const v = await r2.run('volume_report', { existing: 'Pile', base: 'boundary', within: bnd.id, cell: 0.1 });
  near(v.rows[0].cut, (8 * 8 * 2) / 3, 1.5); // pyramid volume, from a 0.1 m grid
  assert.match(v.csv, /^region,cut_m3/);
  const at = await reg.run('cut_fill_at', { design: off.id, existing: 'EG', at: 'E5_5' });
  assert.equal(at.says, 'cut 0.3 m');
});

test('alignment with an arc and a vertical curve; a corridor daylights to the ground', async () => {
  const { reg } = makeCtx();
  const pts = [];
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) pts.push(`${i}_${j},${-30 + i * 10},${-30 + j * 10},0,GND`);
  await reg.run('import_points', { text: pts.join('\n') });
  await reg.run('set_base_point', { e: 0, n: 0, z: 0 });
  await reg.run('create_surface', { name: 'EG' });
  const al = await reg.run('create_alignment', { name: 'Road', points: [[0, 0], [50, 0], [50, -50]], radii: [20], pvis: [[0, 2], [45, 2], [91.42, 2]], curves: [10] });
  near(al.length, 60 + (Math.PI * 20) / 2, 0.05);
  nearArr((await reg.run('get_entity', { id: 'Road' })).max.slice(1, 2), [2], 1e-6);
  const g = TR.alignmentGeometry({ pis: [[0, 0], [100, 0]], pvis: [[0, 0], [50, 5], [100, 0]], curves: [0, 40] });
  near(g.elevation(50), 5 - (0.1 * 40) / 4 - 0 * 0, 0.01); // the curve rounds the crest: 5 − (g1 − g2)·L/8
  const c = await reg.run('create_corridor', { alignment: 'Road', surface: 'EG', template: { lanes: [{ width: 3.5, crossfall: -2 }], shoulder: { width: 1, crossfall: -4 }, fill_slope: 2 }, interval: 5 });
  // 2 m above flat ground with 2:1 fill batters: width ≈ 2 × (4.5 + 2 × ~1.9) ≈ 16.6 m
  near(c.surface.area_2d / al.length, 16.6, 1.2);
  await reg.run('set_alignment', { id: 'Road', pvis: [[0, 4], [91.42, 4]] });
  assert.ok((await reg.run('get_entity', { id: c.id })).surface === undefined);
  const wider = await reg.run('rebuild_surface', { id: c.id });
  assert.ok(wider.surface.area_2d / al.length > 20, 'higher embankment, wider footprint');
});

test('quick field designs: trench at a grade, plane, line with cross slope, road; they follow their points', async () => {
  const { reg } = makeCtx();
  await reg.run('add_point', { name: 'MH1', n: 1000, e: 1000, z: 50 });
  await reg.run('add_point', { name: 'MH2', n: 1000, e: 1040, z: 50 });
  const t = await reg.run('design_trench', { from: 'MH1', to: 'MH2', depth: 1.2, grade: 1, bottom: 0.6, side_slope: 1 });
  near(t.min[1], 0 - 1.2 - 0.4, 1e-6); // base z 50 → local 0; −1.2 at MH1, then 1 % over 40 m
  await reg.run('edit_points', { points: ['MH2'], e: 1060 });
  near((await reg.run('get_entity', { id: t.id })).size[0], 60, 1e-6); // followed MH2 (the batters widen it across, not along)
  const pl = await reg.run('design_plane', { points: [[0, 0, 0], [10, 1, 0], [0, 0, 10]], size: [10, 10] });
  near(pl.size[1], 1, 1e-6); // 10 % in x over 10 m
  const ls = await reg.run('design_line_slope', { from: [0, 0, 20], to: [20, 0, 20], left: 5, right: 5, left_slope: -2, right_slope: -2 });
  near(ls.min[1], -0.1, 1e-6);
  const rd = await reg.run('design_road', { centre: [[0, 0, 40], [30, 0, 40], [60, 3, 40]], width: 8, crossfall: -2.5 });
  near(rd.surface.area_2d, 60 * 8, 1);
});
