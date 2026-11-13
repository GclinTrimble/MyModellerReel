// Surface review and layers: voids cut along their own edges, offset surfaces, the transform guard, triangle display,
// members added later, and LandXML surface export read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as TR from '../src/core/terrain.js';
import * as SF from '../src/core/surfaces.js';
import * as D from '../src/core/document.js';

// a 20 × 20 m grid of points on a plane rising 0.1 m per metre east: y = x / 10
async function slope() {
  const { reg, ctx } = makeCtx();
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push(`${i}_${j},${i * 5},${j * 5},${(j * 5) / 10},GND`);
  await reg.run('import_points', { text: pts.join('\n') });
  await reg.run('set_base_point', { e: 0, n: 0, z: 0 });
  const s = await reg.run('create_surface', { name: 'EG' });
  return { reg, ctx, E: () => ctx.doc.entities.find((x) => x.id === s.id), W: () => D.worldMesh(ctx.doc, ctx.doc.entities.find((x) => x.id === s.id)) };
}

test('drapeRing: corners and edge crossings at the surface height, corners off the surface dropped', () => {
  const pts = [[0, 0, 0], [10, 1, 0], [10, 1, 10], [0, 0, 10]];
  const faces = TR.triangulate(pts).faces;
  const r = TR.drapeRing([[2, 2], [8, 2], [8, 8], [-5, 8]], pts, faces);
  for (const p of r) near(p[1], p[0] / 10);
  assert.ok(!r.some((p) => p[0] < 0), 'the corner outside is left out');
  assert.ok(r.length > 3, 'the crossings of the diagonal are in');
});

test('a void is cut along its own edges, which follow the ground; delete_inside leaves a ragged edge', async () => {
  const { reg, E, W } = await slope();
  await reg.run('surface_boundary', { id: 'EG', action: 'add_void', points: [[6, -6], [13, -6], [13, -13], [6, -13]] });
  const st = (await reg.run('surface_definition', { id: 'EG' })).surface;
  near(st.area_2d, 400 - 49, 1e-6);
  const w = W();
  const edge = w.v.filter((v) => [6, 13].some((x) => Math.abs(v[0] - x) < 1e-6) && v[2] <= -6 && v[2] >= -13);
  assert.ok(edge.length >= 4, 'new vertices along the void edges');
  for (const v of w.v) near(v[1], v[0] / 10, 1e-6); // every vertex, the new ones too, sits on the plane
  assert.equal(E().derived.params.voids.length, 1);
  await reg.run('surface_boundary', { id: 'EG', action: 'remove_void', void: 0 });
  near((await reg.run('surface_definition', { id: 'EG' })).surface.area_2d, 400);
  // the outline is cut the same way, and may run past the points
  await reg.run('surface_boundary', { id: 'EG', action: 'set', points: [[-5, 5], [12, 5], [12, -12], [-5, -12]] });
  near((await reg.run('surface_definition', { id: 'EG' })).surface.area_2d, 12 * 12, 1e-6);
  await reg.run('surface_boundary', { id: 'EG', action: 'clear' });
  // deleting triangles: whole triangles go, no new vertices
  const n = W().v.length;
  await reg.run('edit_triangles', { id: 'EG', action: 'delete_inside', points: [[0, 0], [10, 0], [10, -10], [0, -10]] });
  assert.equal(E().derived.params.deleted.length, 8);
  near((await reg.run('surface_definition', { id: 'EG' })).surface.area_2d, 300);
  assert.ok(W().v.length <= n);
  await assert.rejects(reg.run('edit_triangles', { id: 'EG', action: 'delete_inside', points: [[50, 50], [60, 50], [60, 60]] }), /No triangle/);
});

test('offset surfaces: up, along normals, layers between two; they follow the source', async () => {
  const { reg, ctx, W } = await slope();
  const r = await reg.run('offset_surfaces', { surface: 'EG', distance: -0.3, count: 3 });
  assert.equal(r.created.length, 3);
  const mesh = (id) => D.worldMesh(ctx.doc, ctx.doc.entities.find((x) => x.id === id));
  const top = (m) => Math.max(...m.v.map((v) => v[1]));
  near(top(mesh(r.created[2].id)), 2 - 0.9, 1e-6);
  // the source changes: every offset follows
  await reg.run('surface_points', { id: 'EG', action: 'move', points: ['4_4'], z: 5 });
  near(top(mesh(r.created[0].id)), 5 - 0.3, 1e-6);
  await reg.run('surface_points', { id: 'EG', action: 'move', points: ['4_4'], z: 2 });
  // along the normals: on a plane of slope 0.1 the vertical gap is d·√(1 + 0.01)
  const nrm = await reg.run('offset_surfaces', { surface: 'EG', distance: 1, normal: true });
  const sampleN = TR.sampler(mesh(nrm.created[0].id)).z;
  near(sampleN(10, -10) - 1, Math.sqrt(1.01), 1e-3); // vertices are stored to the mm
  // layers between two surfaces: evenly spaced
  await reg.run('design_offset_surface', { surface: 'EG', offset: -2, name: 'Bottom' });
  const lay = await reg.run('offset_surfaces', { surface: 'EG', to: 'Bottom', count: 3 });
  const ys = lay.created.map((c) => TR.sampler(mesh(c.id)).z(10, -10));
  ys.forEach((y, k) => near(y, 1 - 0.5 * (k + 1), 1e-6));
  assert.ok(W().v.length);
  await assert.rejects(reg.run('offset_surfaces', { surface: 'EG' }), /distance/);
  // the maths alone
  const m = SF.offsetMesh({ v: [[0, 0, 0], [1, 0, 0], [0, 0, -1]], f: [[0, 1, 2]] }, { distance: 2, normal: true });
  near(m.v[0][1], 2);
});

test('a surveyed surface stays where it was measured; its triangles can be shown', async () => {
  const { reg, ctx, E } = await slope();
  const at = [...E().position];
  for (const [cmd, args] of [['move', { by: [1, 0, 0] }], ['rotate', { angle: 10 }], ['scale', { factor: 2 }], ['set_transform', { position: [1, 0, 0] }], ['mirror', { axis: 'x', copy: false }]])
    await assert.rejects(reg.run(cmd, { [cmd === 'set_transform' ? 'id' : 'ids']: cmd === 'set_transform' ? 'EG' : ['EG'], ...args }), /surveyed surface/, cmd);
  assert.deepEqual(E().position, at);
  await reg.run('mirror', { ids: ['EG'], axis: 'x' }); // a copy is baked: free to place
  await reg.run('show_triangles', { ids: ['EG'] });
  assert.equal(E().show_triangles, true);
  ctx.store.undo();
  assert.equal(E().show_triangles, undefined);
});

test('members added later: existing points join a chosen list; LandXML surface out and back', async () => {
  const { reg, ctx } = makeCtx();
  const files = {};
  ctx.io = { writeText: async (p, t) => (files[p] = t), readText: async (p) => files[p], pick: async () => null };
  await reg.run('import_points', { text: ['A,0,0,1', 'B,0,10,2', 'C,10,0,3', 'D,10,10,4'].join('\n') });
  await reg.run('set_base_point', { e: 0, n: 0, z: 0 });
  await reg.run('create_surface', { name: 'S', points: ['A', 'B', 'C'] });
  assert.equal((await reg.run('surface_definition', { id: 'S' })).definition.points, 3);
  await reg.run('surface_points', { id: 'S', action: 'include', points: ['D'] });
  assert.equal((await reg.run('surface_definition', { id: 'S' })).definition.points, 4);

  await reg.run('export', { format: 'landxml', path: 'C:/s.xml', points: false });
  const out = files['C:/s.xml'];
  assert.ok(!/CgPoint/.test(out), 'no points when asked');
  assert.match(out, /<Surface name="S">/);
  const b = makeCtx();
  await b.reg.run('import', { text: out, format: 'landxml' });
  const a = D.worldMesh(ctx.doc, ctx.doc.entities.find((e) => e.name === 'S'));
  const back = D.worldMesh(b.ctx.doc, b.ctx.doc.entities.find((e) => e.name === 'S'));
  assert.equal(back.f.length, a.f.length);
  const key = (m) => m.v.map((v) => v.map((x) => x.toFixed(3)).join(' ')).sort();
  assert.deepEqual(key(back), key(a));
  await reg.run('offset_surfaces', { surface: 'S', distance: -0.5 });
  await reg.run('export', { format: 'landxml', path: 'C:/p.xml' });
  assert.match(files['C:/p.xml'], /<Surface name="S -0.5 m">/, 'offset layers are surfaces too');
  assert.match(files['C:/p.xml'], /<CgPoint name="D"/);
});
