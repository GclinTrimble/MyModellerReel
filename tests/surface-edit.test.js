// Surfaces as an editable definition (#239): points, breaklines, outline and voids that rebuild the TIN, undoably.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as SW from '../src/core/sitework.js';
import * as D from '../src/core/document.js';

test('ring edits, insert position and the definition migration', () => {
  const sq = [[0, 0], [10, 0], [10, -10], [0, -10]];
  assert.deepEqual(SW.editRing(sq, { action: 'move', index: 1, to: [12, 1] })[1], [12, 1]);
  assert.equal(SW.ringInsertIndex(sq, [5, 0.5]), 1); // nearest the first edge: between vertex 0 and 1
  assert.equal(SW.ringInsertIndex(sq, [-0.5, -5]), 4); // the closing edge: appended
  assert.deepEqual(SW.editRing(sq, { action: 'insert', index: 1, to: [5, 1] })[1], [5, 1]);
  assert.equal(SW.editRing(sq, { action: 'remove', index: 0 }).length, 3);
  assert.throws(() => SW.editRing(sq.slice(0, 3), { action: 'remove', index: 0 }), /at least 3/);
  assert.throws(() => SW.editRing(sq, { action: 'move', index: 9, to: [0, 0] }), /No vertex 9/);
  assert.equal(sq[1][0], 10, 'the input ring is left alone');
  // a surface saved before #239: lists missing, a broken outline, repeats
  const old = { points: 'all', exclude: ['a', 'a'], outline: [[0, 0], [1, 1]], voids: [[[0, 0]], sq] };
  const m = SW.migrateSurface(old);
  assert.deepEqual(m, { points: 'all', version: 2, exclude: ['a'], lines: [], voids: [sq] });
  assert.equal(SW.migrateSurface(m), m, 'already current');
});

test('surface editing commands: points, breaklines, outline, voids, swaps; undo; old documents', async () => {
  const { reg, ctx } = makeCtx();
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push(`${i}_${j},${j * 5},${i * 5},0,GND`);
  await reg.run('import_points', { text: pts.join('\n') });
  await reg.run('set_base_point', { e: 0, n: 0, z: 0 });
  const s = await reg.run('create_surface', { name: 'EG' });
  const E = () => ctx.doc.entities.find((x) => x.id === s.id); // undo swaps the document: look it up each time
  const wv = () => D.worldMesh(ctx.doc, E()).v;
  const top = () => Math.max(...wv().map((v) => v[1]));
  const area = async () => (await reg.run('surface_definition', { id: 'EG' })).surface.area_2d;
  assert.equal(E().derived.params.version, 2);
  near(await area(), 400);

  // points: add with a typed elevation, move it up, leave it out, bring it back, delete it
  const add = await reg.run('surface_points', { id: 'EG', action: 'add', at: [7, -7], z: 3, name: 'P1' });
  near(top(), 3);
  assert.equal(add.definition.points, 26);
  await reg.run('surface_points', { id: 'EG', action: 'move', points: ['P1'], z: 4 });
  near(top(), 4);
  await reg.run('surface_points', { id: 'EG', action: 'move', points: ['P1'], at: [8, -8] });
  assert.ok(wv().some((v) => Math.abs(v[0] - 8) < 1e-6 && Math.abs(v[2] + 8) < 1e-6 && Math.abs(v[1] - 4) < 1e-6), 'moved in plan, kept its height');
  await reg.run('surface_points', { id: 'EG', action: 'exclude', points: ['P1'] });
  near(top(), 0);
  assert.deepEqual((await reg.run('surface_definition', { id: 'EG' })).definition.excluded, ['P1']);
  await reg.run('surface_points', { id: 'EG', action: 'include', points: ['P1'] });
  near(top(), 4);
  await reg.run('surface_points', { id: 'EG', action: 'delete', points: ['P1'] });
  near(top(), 0);
  assert.ok(!ctx.doc.entities.some((x) => x.name === 'P1'));
  ctx.store.undo();
  near(top(), 4, 1e-6); // undo brings the point and the triangles back
  assert.ok(ctx.doc.entities.some((x) => x.name === 'P1'));
  await reg.run('surface_points', { id: 'EG', action: 'delete', points: ['P1'] });
  await assert.rejects(reg.run('surface_points', { id: 'EG', action: 'add', at: [100, -100] }), /outside the surface/);

  // breaklines: a drawn one becomes triangle edges; a curve stays live; both come off again
  const edge = (a, b) => {
    const w = wv();
    const [i, j] = [a, b].map((q) => w.findIndex((v) => Math.hypot(v[0] - q[0], v[2] - q[1]) < 1e-6));
    return i >= 0 && j >= 0 && E().mesh.f.some((f) => f.includes(i) && f.includes(j));
  };
  const drawn = await reg.run('surface_breaklines', { id: 'EG', action: 'add', points: [[2.5, 1, -2.5], [12.5, 1, -12.5]] });
  assert.equal(drawn.definition.drawn_breaklines, 1);
  assert.ok(edge([2.5, -2.5], [5, -5]), 'the drawn breakline splits the triangles');
  await reg.run('surface_breaklines', { id: 'EG', action: 'remove', index: 0 });
  await reg.run('create_curve', { name: 'Ridge', points: [[17.5, 2, -2.5], [17.5, 2, -17.5]] });
  await reg.run('surface_breaklines', { id: 'EG', action: 'add', line: 'Ridge' });
  near(top(), 2);
  await reg.run('move', { ids: ['Ridge'], by: [0, 1, 0] });
  near(top(), 3); // live: the surface followed the curve
  await reg.run('surface_breaklines', { id: 'EG', action: 'remove', line: 'Ridge' });
  near(top(), 0);

  // outline and voids, with grips
  await reg.run('surface_boundary', { id: 'EG', action: 'set', points: [[0, 0], [10, 0], [10, -10], [0, -10]] });
  near(await area(), 100);
  // whole triangles are kept or cut, so a slanted side gives a stepped area: compare, don't match
  await reg.run('surface_boundary', { id: 'EG', action: 'move_vertex', index: 2, to: [20, -20] });
  const a1 = await area();
  assert.ok(a1 > 100, `grew: ${a1}`);
  const ins = await reg.run('surface_boundary', { id: 'EG', action: 'insert_vertex', to: [20, 0] });
  assert.deepEqual(ins.definition.outline[2], [20, 0]); // split the nearest edge
  assert.ok((await area()) > a1);
  await reg.run('surface_boundary', { id: 'EG', action: 'remove_vertex', index: 2 });
  near(await area(), a1);
  await reg.run('surface_boundary', { id: 'EG', action: 'clear' });
  await reg.run('surface_boundary', { id: 'EG', action: 'add_void', points: [[5, -5], [15, -5], [15, -15], [5, -15]] });
  near(await area(), 300);
  await reg.run('surface_boundary', { id: 'EG', action: 'move_vertex', void: 0, index: 1, to: [10, -5] });
  assert.ok((await area()) > 300, 'a smaller hole');
  await reg.run('surface_boundary', { id: 'EG', action: 'remove_void', void: 0 });
  near(await area(), 400);
  await assert.rejects(reg.run('surface_boundary', { id: 'EG', action: 'move_vertex', index: 0, to: [0, 0] }), /no outline/);

  // swap an edge, max edge (edit_triangles and set_surface_sources are part of the same definition)
  const def = await reg.run('edit_triangles', { id: 'EG', action: 'swap', a: '1_1', b: '2_2' }).catch(() => reg.run('edit_triangles', { id: 'EG', action: 'swap', a: '1_2', b: '2_1' }));
  assert.equal(ctx.doc.entities.find((x) => x.id === s.id).derived.params.swaps.length, 1, def.name);

  // an old document (no version, no lists) edits like a new one
  E().derived.params = { points: 'all' };
  SW.migrateSurfaces(ctx.doc);
  assert.equal(E().derived.params.version, 2);
  await reg.run('surface_boundary', { id: 'EG', action: 'add_void', points: [[5, -5], [15, -5], [15, -15], [5, -15]] });
  near(await area(), 300);
});
