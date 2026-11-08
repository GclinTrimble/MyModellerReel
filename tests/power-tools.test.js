// Phase 14: fillet / chamfer, loft, shell, thicken, extrude faces, divide / weld / split / intersect, subdivision,
// deformers, decimation, symmetry, 3-point rectangles, axes, 2D import, arrays, selection sets, layer folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as G from '../src/core/geometry.js';
import * as MD from '../src/core/modeling.js';
import * as SVG from '../src/core/svg.js';
import * as D from '../src/core/document.js';
import * as L from '../src/core/layers.js';

const vol = (ctx, id) => Math.abs(G.volume(D.worldMesh(ctx.doc, D.getEntity(ctx.doc, id))));

test('fillet and chamfer edges cut exactly the corner they should', async () => {
  const { reg, ctx } = makeCtx();
  const b = await reg.run('create_box', { width: 2, height: 1, depth: 2, name: 'Block' });
  const f = await reg.run('fillet_edges', { id: 'Block', edges: 'vertical', radius: 0.3, segments: 16 });
  assert.equal(f.edges, 4);
  near(vol(ctx, b.id), 4 - 4 * (0.09 - (Math.PI * 0.09) / 4), 0.002);
  const c = await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Cube', position: [4, 0, 0] });
  await reg.run('chamfer_edges', { id: 'Cube', edges: [[...MD.pickEdges(D.getEntity(ctx.doc, c.id).mesh, 'top')[0]]], distance: 0.2 });
  near(vol(ctx, c.id), 1 - 0.5 * 0.2 * 0.2 * 1, 1e-4);
  await assert.rejects(reg.run('fillet_edges', { id: 'Cube', radius: 0 }), /above 0/);
});

test('loft, shell, thicken, extrude faces and subdivision', async () => {
  const sq = (s, y) => [[-s, y, -s], [s, y, -s], [s, y, s], [-s, y, s]];
  near(G.volume(MD.loft([sq(1, 0), sq(0.5, 2)])), (2 / 3) * (4 + 1 + 2), 1e-9, 'a frustum');
  const circle = (r, y) => Array.from({ length: 24 }, (_, k) => [r * Math.cos((k / 24) * 2 * Math.PI), y, r * Math.sin((k / 24) * 2 * Math.PI)]);
  assert.ok(G.volume(MD.loft([sq(1, 0), circle(0.8, 1.5)])) > 0, 'square to circle, outward');
  const { reg, ctx } = makeCtx();
  await reg.run('create_curve', { points: sq(1, 0), closed: true, name: 'Base' });
  await reg.run('create_curve', { points: circle(0.6, 1), closed: true, name: 'Mid' });
  await reg.run('create_curve', { points: sq(0.8, 2.5), closed: true, name: 'Top' });
  const l = await reg.run('loft', { profiles: ['Base', 'Mid', 'Top'] });
  near(l.size[1], 2.5, 1e-6);
  const box = await reg.run('create_box', { width: 2, height: 1, depth: 2, name: 'Tank', position: [5, 0, 0] });
  await reg.run('shell', { id: 'Tank', thickness: 0.1, open: 'top' });
  near(vol(ctx, box.id), 4 - 1.8 * 1.8 * 0.9, 1e-6);
  const face = await reg.run('create_face', { points: [[0, 0, 10], [2, 0, 10], [2, 0, 12], [0, 0, 12]], name: 'Sheet' });
  await reg.run('thicken', { id: 'Sheet', thickness: 0.2 });
  near(vol(ctx, face.id), 0.8, 1e-6);
  const c = await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Stud', position: [-5, 0, 0] });
  await reg.run('extrude_faces', { id: 'Stud', faces: ['top'], distance: 0.5 });
  near(vol(ctx, c.id), 1.5, 1e-9);
  const s = await reg.run('subdivide', { id: 'Stud', levels: 1 });
  assert.equal(s.faces, 4 * 10, 'every face in four');
});

test('divide, weld, split and intersect', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 2, height: 2, depth: 2, name: 'A' });
  const a = D.getEntity(ctx.doc, ctx.doc.entities[0].id);
  const [e0] = [...MD.edgesOf(a.mesh).values()];
  const d = await reg.run('divide_edge', { id: 'A', edge: [e0.a, e0.b], segments: 4 });
  assert.equal(D.getEntity(ctx.doc, d.id).mesh.v.length, 8 + 3);
  const r = await reg.run('split_solid', { id: 'A', point: [0, 0.5, 0], normal: [0, 1, 0] });
  near(r.kept.size[1] + r.cut.size[1], 2, 1e-6);
  near(vol(ctx, r.kept.id) + vol(ctx, r.cut.id), 8, 1e-6);
  await reg.run('create_box', { width: 1, height: 3, depth: 1, name: 'Post', position: [0.3, -0.5, 0.3] });
  const x = await reg.run('intersect_faces', { ids: [r.kept.id, 'Post'] });
  assert.ok(x.curves >= 1);
  const w = await reg.run('weld_edges', { ids: ['Post'] });
  assert.equal(w[0].welded, 0);
});

test('deformers stay live; decimation; symmetry mirrors edits', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 1, height: 3, depth: 1, name: 'Tower' });
  const t = await reg.run('deform', { id: 'Tower', type: 'taper', amount: 0.5 });
  near(t.size[0], 1, 1e-6);
  const top = D.getEntity(ctx.doc, t.id).mesh;
  const ys = top.v.map((p) => p[1]);
  const topWidth = Math.max(...top.v.filter((p) => p[1] > Math.max(...ys) - 1e-6).map((p) => p[0])) * 2;
  near(topWidth, 0.5, 1e-6, 'the top at half size');
  await reg.run('set_params', { id: t.id, params: { type: 'twist', amount: 90 } });
  near(D.worldBox(ctx.doc, D.getEntity(ctx.doc, t.id)).max[0], Math.SQRT2 / 2, 1e-3, 'twisted: the corner sweeps round');
  assert.equal(D.getEntity(ctx.doc, ctx.doc.entities[0].id).visible, false, 'the source is kept, hidden');
  await reg.run('create_sphere', { radius: 1, segments: 48, name: 'Ball', position: [4, 0, 0] });
  const [s] = await reg.run('simplify_mesh', { ids: ['Ball'], ratio: 0.25 });
  assert.ok(s.triangles[1] < s.triangles[0] * 0.4);
  await reg.run('create_box', { width: 4, height: 1, depth: 1, name: 'Bar', position: [0, 0, 6] });
  await reg.run('set_symmetry', { axis: 'x' });
  const bar = D.getEntity(ctx.doc, ctx.doc.entities.find((e) => e.name === 'Bar').id);
  await reg.run('push_pull', { id: 'Bar', face: 'right', distance: 0.5 });
  const bb = G.bbox(bar.mesh);
  near(bb.min[0], -2.5, 1e-6, 'the left end moved too');
  near(bb.max[0], 2.5, 1e-6);
  await reg.run('set_symmetry', { axis: 'off' });
});

test('3-point rectangle, axes, SVG floor plan to faces, arrays', async () => {
  const r = MD.rectangle3([0, 0, 0], [3, 0, 3], [0, 0, 4]);
  near(G.len(G.sub(r[1], r[0])), Math.sqrt(18), 1e-6);
  near(G.dot(G.sub(r[1], r[0]), G.sub(r[3], r[0])), 0, 1e-9, 'square corners');
  const { reg, ctx } = makeCtx();
  const f = await reg.run('create_rectangle', { points: [[0, 0, 0], [3, 0, 3], [0, 0, 4]] });
  near(Math.abs(G.faceArea(D.getEntity(ctx.doc, f.id).mesh, 0)), Math.sqrt(18) * Math.sqrt(8), 1e-3);
  assert.deepEqual((await reg.run('set_axes', { angle: 30, grid: 0.5, snap: true })).axes, { origin: [0, 0, 0], angle: 30, grid: 0.5, snap: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10m" height="8m" viewBox="0 0 1000 800"><g id="Walls" transform="translate(0 0)"><rect x="0" y="0" width="1000" height="800"/><path d="M 100 100 L 400 100 L 400 300 Z"/></g><circle cx="700" cy="400" r="50"/></svg>';
  assert.equal(SVG.svgUnit(svg), 0.01);
  assert.equal(SVG.svgPolylines(svg).length, 3);
  assert.deepEqual(SVG.pathPolylines('M0 0 h10 v10 h-10 z')[0].pts.length, 4);
  const imp = await reg.run('import_2d', { text: svg, faces: true });
  assert.equal(imp.curves, 3);
  assert.equal(imp.faces, 3);
  assert.deepEqual(imp.size, [10, 8]);
  const col = await reg.run('create_box', { width: 0.3, height: 3, depth: 0.3, name: 'Column', position: [0, 0, 20] });
  const g = await reg.run('array_grid', { ids: [col.id], nx: 4, nz: 3, spacing: [5, 0, 6] });
  assert.equal(g.copies, 11);
  await reg.run('create_curve', { points: [[0, 0, 40], [30, 0, 40]], name: 'Road' });
  await reg.run('create_cylinder', { radius: 0.1, height: 6, name: 'Light', position: [0, 0, 41] });
  const p = await reg.run('array_path', { ids: ['Light'], path: 'Road', count: 4 });
  assert.equal(p.placed, 4);
  near(ctx.doc.entities.find((e) => e.name === 'Light 4').position[0], 30, 1e-6);
});

test('selection sets, layer folders, colour by layer', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'A', tag: 'S-COLS' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'B', tag: 'S-BEAMS' });
  await reg.run('save_selection', { name: 'Structure', ids: ['A', 'B'] });
  await reg.run('select', { mode: 'none' });
  assert.equal((await reg.run('select_set', { name: 'structure' })).selected, 2);
  await reg.run('set_layer', { name: 'S-COLS', folder: 'Structure', color: '#c8553d' });
  assert.equal(L.layerOf(ctx.doc, 'S-COLS').folder, 'Structure');
  await reg.run('set_style', { color_by: 'layer' });
  assert.equal(L.colorOf(ctx.doc, ctx.doc.entities[0]), '#c8553d');
  await reg.run('delete_selection_set', { name: 'Structure' });
  await assert.rejects(reg.run('select_set', { name: 'Structure' }), /No selection set/);
});

test('a deformer on a filleted, shelled shape: no stack overflow, a capped triangle count', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'B' });
  await reg.run('fillet_edges', { id: 'B', edges: 'vertical', radius: 0.1 });
  await reg.run('shell', { id: 'B', thickness: 0.02, open: 'top' });
  const r = await reg.run('deform', { id: 'B', type: 'twist', amount: 45 });
  assert.ok(r.faces > 1000 && r.faces <= 60000 * 4, `${r.faces} triangles`);
});
