// Phase 8: exchange formats through the command registry, with round trips (import → export → import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import { LANDXML_C3D, LANDXML_TBC, DXF_MM } from './fixtures/formats.js';
import * as D from '../src/core/document.js';
import * as S from '../src/core/survey.js';
import * as X from '../src/core/xml.js';
import { ACI, nearestAci } from '../src/core/dxf.js';
import { guid } from '../src/core/ifc.js';

const withFiles = (ctx) => {
  const files = {};
  ctx.io = {
    readText: async (p) => files[p],
    readBinary: async (p) => new TextEncoder().encode(files[p]),
    writeText: async (p, t) => (files[p] = t),
    pick: async () => null,
  };
  return files;
};
const byName = (ctx, n) => ctx.doc.entities.find((e) => e.name === n);

test('xml: attributes, entities, CDATA, self-closing, prefixes; write and read back', () => {
  const t = X.parse('<?xml version="1.0"?><!-- c --><a:Root x="1 &amp; 2"><B/><C>t&lt;1<![CDATA[<raw>]]></C></a:Root>');
  const r = X.kid(t, 'Root');
  assert.equal(r.attrs.x, '1 & 2');
  assert.equal(X.kid(r, 'C').text, 't<1<raw>');
  assert.throws(() => X.parse('<a><b></a>'), /closes/);
  const back = X.parse(X.write(X.el('A', { q: '"x"' }, [X.el('B', {}, 'v & w')])));
  assert.equal(X.kid(X.kid(back, 'A'), 'B').text, 'v & w');
});

test('LandXML (Civil 3D style): surface without its hidden face, breakline, alignment with curve and profile', async () => {
  const { ctx, reg } = makeCtx();
  const r = await reg.run('import', { text: LANDXML_C3D, format: 'landxml' });
  assert.deepEqual(r.created, { surfaces: 1, triangles: 2, breaklines: 1, alignments: 1 });
  assert.ok(r.warnings.some((w) => /Spiral/.test(w)));
  assert.ok(r.skipped.some((s) => /Parcels/.test(s.what)));
  assert.equal(S.geo(ctx.doc).crs, 'EPSG:32631');
  const eg = byName(ctx, 'EG');
  assert.equal(eg.mesh.f.length, 2);
  const box = D.worldBox(ctx.doc, eg);
  const lo = S.toProject(ctx.doc, box.min);
  near(lo.z, 100, 1e-6);
  for (const fi of eg.mesh.f.keys()) assert.ok((await import('../src/core/geometry.js')).faceNormal(eg.mesh, fi)[1] > 0, 'faces point up');
  const al = byName(ctx, 'Access road');
  assert.equal(al.alignment.start_station, 1000);
  assert.ok(al.curve.points.length > 20, 'the arc is sampled');
  const pts = D.curvePoints(ctx.doc, al);
  const end = S.toProject(ctx.doc, pts.at(-1));
  nearArr([end.n, end.e], [5400020, 650030], 1e-3);
  const z0 = S.toProject(ctx.doc, pts[0]).z;
  near(z0, 100, 0.01);
});

test('LandXML (TBC style): coded points, 3D plan feature; export and read back', async () => {
  const { ctx, reg } = makeCtx();
  const files = withFiles(ctx);
  const r = await reg.run('import', { text: LANDXML_TBC, format: 'landxml' });
  assert.deepEqual(r.created, { points: 3, features: 1 });
  assert.equal(r.skipped[0].count, 1, 'the point reference');
  const p = byName(ctx, '1002');
  assert.equal(p.point.code, 'KERB B');
  near(p.point.z, 102.4, 1e-9);
  const fence = byName(ctx, 'Fence');
  near(S.toProject(ctx.doc, D.curvePoints(ctx.doc, fence).at(-1)).z, 101.4, 1e-6);
  // a surface from the points, then everything out to LandXML and into a new model
  await reg.run('create_surface', { name: 'Ground' });
  await reg.run('export', { format: 'landxml', path: 'C:/out.xml' });
  const out = files['C:/out.xml'];
  assert.match(out, /<CgPoint name="1002" code="KERB B">5400105 650110 102.4<\/CgPoint>/);
  const b = makeCtx();
  const back = await b.reg.run('import', { text: out, format: 'landxml' });
  assert.deepEqual([back.created.points, back.created.surfaces, back.created.features], [3, 1, 1]);
  near(byName(b.ctx, '1003').point.e, 650120, 1e-6);
  assert.equal(byName(b.ctx, 'Ground').mesh.f.length, ctx.doc.entities.find((e) => e.name === 'Ground').mesh.f.length);
});

test('DXF in millimetres: layers and their states, bulge arc, circle, blocks → components, faces, point; text and hatch skipped', async () => {
  const { ctx, reg } = makeCtx();
  const r = await reg.run('import', { text: DXF_MM, format: 'dxf' });
  assert.equal(r.coordinates, 'local');
  assert.equal(r.created.components, 1);
  assert.equal(r.created.instances, 2);
  assert.equal(r.created.points, 1);
  assert.ok(r.skipped.some((s) => /TEXT/.test(s.what)) && r.skipped.some((s) => /HATCH/.test(s.what)));
  const L = (n) => ctx.doc.tags.find((t) => t.name === n);
  assert.equal(L('C-KERB').color, '#ff0000');
  assert.equal(L('NOTES').visible, false);
  assert.equal(L('A-FURN').locked, true);
  assert.equal(L('C-CL').line_type, 'dashed');
  const kerb = ctx.doc.entities.find((e) => e.tag === 'C-KERB' && e.curve && !e.curve.closed);
  const k = D.curvePoints(ctx.doc, kerb);
  nearArr(k[0], [0, 0, 0]);
  nearArr(k.at(-1), [10, 0, -10], 1e-6); // 10 m east, 10 m north (−z)
  for (const q of k.slice(2, -1)) near(Math.hypot(q[0] - 10, q[2] + 5), 5, 1e-3); // the half-circle bulge
  const circle = ctx.doc.entities.find((e) => e.tag === 'C-KERB' && e.curve?.closed);
  near(D.worldBox(ctx.doc, circle).max[0], 32, 1e-6);
  const posts = ctx.doc.entities.filter((e) => e.component === 'POST');
  assert.equal(posts.length, 2);
  near(posts[0].rotation[1], 90);
  const post = D.worldBox(ctx.doc, posts[1]);
  nearArr([post.min[0], post.max[1], post.min[2]], [8, 1, -5], 1e-6);
  const faces = ctx.doc.entities.find((e) => e.name === 'C-KERB faces');
  near(D.worldBox(ctx.doc, faces).max[1], 0.5, 1e-9);
  near(byName(ctx, '1').point.z, 0.3, 1e-9);
});

test('DXF round trip in project coordinates: layers, curves, points, faces and component blocks', async () => {
  const { ctx, reg } = makeCtx();
  const files = withFiles(ctx);
  await reg.run('set_base_point', { n: 5400000, e: 650000, z: 100 });
  await reg.run('create_layer', { name: 'Kerbs', color: '#c8553d', line_type: 'dashed', current: true });
  await reg.run('create_curve', { points: [[0, 1, 0], [10, 1.5, 0], [10, 2, -10]], name: 'Kerb' });
  await reg.run('add_point', { name: 'CP1', n: 5400005, e: 650003, z: 101 });
  await reg.run('create_layer', { name: 'Blocks', current: true });
  await reg.run('create_box', { width: 1, height: 2, depth: 1, position: [20, 0, 0], name: 'Post' });
  const c = await reg.run('make_component', { ids: ['Post'], name: 'Post' });
  await reg.run('duplicate', { ids: [c.id], offset: [3, 0, 0] });
  await reg.run('export', { format: 'dxf', path: 'C:/out.dxf' });
  const out = files['C:/out.dxf'];
  assert.match(out, /AC1009/);
  assert.match(out, /\nBLOCK\n/);
  const b = makeCtx();
  const r = await b.reg.run('import', { text: out, format: 'dxf' });
  assert.equal(r.coordinates, 'project');
  assert.deepEqual(S.geo(b.ctx.doc).base, [650000, 5400000, 100], 'base height from the drawing (rounded to 10 m)');
  const kerb = b.ctx.doc.entities.find((e) => e.tag === 'Kerbs' && e.curve);
  const p = D.curvePoints(b.ctx.doc, kerb).map((q) => S.toProject(b.ctx.doc, q));
  nearArr([p[2].e, p[2].n, p[2].z], [650010, 5400010, 102], 1e-4);
  assert.equal(b.ctx.doc.tags.find((t) => t.name === 'Kerbs').line_type, 'dashed');
  assert.equal(b.ctx.doc.tags.find((t) => t.name === 'Kerbs').color, ACI[nearestAci('#c8553d')]);
  near(b.ctx.doc.entities.find((e) => S.isPoint(e)).point.z, 101, 1e-6);
  const inst = b.ctx.doc.entities.filter((e) => e.component);
  assert.equal(inst.length, 2);
  const bx = D.worldBox(b.ctx.doc, inst.find((e) => S.toProject(b.ctx.doc, e.position).e > 650021));
  near(S.toProject(b.ctx.doc, bx.max).z - S.toProject(b.ctx.doc, bx.min).z, 2, 1e-6);
});

test('IFC round trip: classes from roles, storeys, property sets, layers, colours, georeferencing', async () => {
  const { ctx, reg } = makeCtx();
  const files = withFiles(ctx);
  await reg.run('set_base_point', { n: 5400000, e: 650000, z: 100 });
  await reg.run('create_layer', { name: 'A-WALL', current: true });
  await reg.run('create_box', { width: 4, height: 3, depth: 0.2, name: 'North wall', color: '#c8553d' });
  await reg.run('set_metadata', { ids: ['North wall'], values: { role: 'wall', fire_rating: 'EI60', cost: 1200 } });
  await reg.run('create_box', { width: 1, height: 2.1, depth: 0.1, name: 'Front door', position: [6, 0, 0] });
  await reg.run('export', { format: 'ifc', path: 'C:/out.ifc' });
  const out = files['C:/out.ifc'];
  assert.match(out, /FILE_SCHEMA\(\('IFC4'\)\)/);
  assert.match(out, /IFCMAPCONVERSION\(#\d+,#\d+,650000\.,5400000\.,100\.,/);
  assert.match(out, /IFCWALL\(/);
  assert.match(out, /IFCDOOR\(/);
  const b = makeCtx();
  const r = await b.reg.run('import', { text: out, format: 'ifc' });
  assert.equal(r.created.elements, 2);
  assert.deepEqual(S.geo(b.ctx.doc).base, [650000, 5400000, 100]);
  const wall = b.ctx.doc.entities.find((e) => e.name === 'North wall');
  assert.equal(wall.meta.ifc_class, 'IfcWall');
  assert.equal(wall.meta['Pset_MyModellerReel.fire_rating'], 'EI60');
  near(wall.meta['Pset_MyModellerReel.cost'], 1200);
  assert.equal(wall.tag, 'A-WALL');
  assert.equal(wall.material.color, '#c8553d');
  const storey = D.getEntity(b.ctx.doc, wall.parent);
  assert.equal(storey.meta.ifc_class, 'IfcBuildingStorey');
  nearArr(D.worldBox(b.ctx.doc, wall).max, [2, 3, 0.1], 1e-6);
  nearArr(D.worldBox(b.ctx.doc, b.ctx.doc.entities.find((e) => e.name === 'Front door')).min, [5.5, 0, -0.05], 1e-6);
  assert.equal(guid('x').length, 22);
  assert.equal(guid('x'), guid('x'));
  await reg.run('export', { format: 'ifc', path: 'C:/x3.ifc', schema: 'IFC4X3' });
  assert.match(files['C:/x3.ifc'], /IFC4X3_ADD2/);
  await reg.run('create_box', { width: 5, height: 0.15, depth: 0.3, name: 'Kerb run' });
  await reg.run('export', { format: 'ifc', path: 'C:/k4.ifc' });
  await reg.run('export', { format: 'ifc', path: 'C:/k3.ifc', schema: 'IFC4X3' });
  assert.doesNotMatch(files['C:/k4.ifc'], /IFCKERB/, 'IFC4 has no kerb class');
  assert.match(files['C:/k4.ifc'], /'IfcKerb',#/);
  assert.match(files["C:/k3.ifc"], /IFCKERB[(]/);
});

test('feature layers: query by attributes, range, inside a boundary; bulk edit checked against the schema', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_layer', { name: 'Trees', schema: { species: { type: 'string' }, height: { type: 'number' }, keep: { type: 'boolean', default: true } } });
  for (const [i, x] of [0, 10, 20, 30].entries()) {
    await reg.run('create_cylinder', { radius: 0.3, height: 5, position: [x, 0, 0], name: `Tree ${i}`, tag: 'Trees' });
    await reg.run('set_metadata', { ids: [`Tree ${i}`], values: { species: i % 2 ? 'oak' : 'birch', height: 4 + i } });
  }
  const oaks = await reg.run('query_features', { layer: 'Trees', where: { species: 'oak' } });
  assert.deepEqual(oaks.features.map((f) => f.name), ['Tree 1', 'Tree 3']);
  assert.deepEqual(ctx.selection.get().length, 2);
  assert.equal((await reg.run('query_features', { layer: 'Tr*', where: { height: { min: 5, max: 6 } } })).count, 2);
  await reg.run('create_curve', { points: [[-5, 0, -5], [15, 0, -5], [15, 0, 5], [-5, 0, 5]], closed: true, name: 'Zone' });
  assert.equal((await reg.run('query_features', { layer: 'Trees', inside: 'Zone' })).count, 2);
  const e = await reg.run('edit_attributes', { layer: 'Trees', where: { species: 'birch' }, values: { keep: false } });
  assert.equal(e.edited, 2);
  assert.equal(byName(ctx, 'Tree 2').meta.keep, false);
  await assert.rejects(reg.run('edit_attributes', { layer: 'Trees', values: { height: 'tall' } }), /number/);
  assert.ok((await reg.run('list_formats')).some((f) => f.id === 'landxml' && f.import && f.export));
});
