// Point ties: a curve vertex snapped to a survey point follows the point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, nearArr } from './helpers.js';
import * as D from '../src/core/document.js';
import * as Clip from '../src/core/clipboard.js';
import * as TI from '../src/core/ties.js';

const worldVerts = (doc, e) => D.curvePoints(doc, e, 1);
const at = (doc, name) => D.worldMatrix(doc, doc.entities.find((x) => x.name === name)).elements.slice(12, 15);

async function setup() {
  const { reg, ctx } = makeCtx();
  await reg.run('add_point', { name: 'A', at: [0, 0, 0], code: 'EP' });
  await reg.run('add_point', { name: 'B', at: [10, 0, 0] });
  const c = await reg.run('create_curve', { points: [[0, 0, 0], [10, 0, 0], [10, 0, 5]], name: 'Kerb', ties: [{ vertex: 0, point: 'A' }, { vertex: 1, point: 'B' }] });
  return { reg, ctx, id: c.id };
}

test('a tied vertex follows its point, undo puts both back, a deleted point leaves the vertex', async () => {
  const { reg, ctx, id } = await setup();
  const doc = () => ctx.doc;
  const curve = () => D.getEntity(doc(), id);
  assert.equal(TI.listTies(doc()).length, 2);
  assert.equal((await reg.run('list_ties', { id: 'Kerb' })).ties[0].code, 'EP');

  await reg.run('move', { ids: ['B'], by: [0, 2, 3] });
  nearArr(at(doc(), 'B'), [10, 2, 3]);
  const w = worldVerts(doc(), curve());
  nearArr(w[1], [10, 2, 3], 1e-3);
  nearArr(w[0], [0, 0, 0], 1e-3);
  nearArr(w[2], [10, 0, 5], 1e-3); // untied vertices stay

  await reg.run('undo');
  nearArr(worldVerts(doc(), curve())[1], [10, 0, 0], 1e-3);

  await reg.run('delete', { ids: ['A'] });
  assert.deepEqual(curve().ties.map((t) => t.vertex), [1], 'the tie to A is dropped');
  nearArr(worldVerts(doc(), curve())[0], [0, 0, 0], 1e-3);
});

test('editing the vertex by hand unties it; untie and tie by command; snap without tying', async () => {
  const { reg, ctx, id } = await setup();
  const curve = () => D.getEntity(ctx.doc, id);
  await reg.run('set_curve', { id, points: [[0, 0, 0], [12, 0, 0], [10, 0, 5]] });
  assert.deepEqual(curve().ties.map((t) => t.vertex), [0], 'vertex 1 was moved off B: it lets go');
  nearArr(worldVerts(ctx.doc, curve())[1], [12, 0, 0], 1e-3);

  await reg.run('tie_vertex', { id: 'Kerb', vertex: 2, point: 'B' });
  nearArr(worldVerts(ctx.doc, curve())[2], [10, 0, 0], 1e-3, 'tying puts the vertex on the point');
  assert.equal((await reg.run('untie_vertex', { id })).untied, 2);
  assert.equal(curve().ties, undefined);
  assert.equal((await reg.run('set_snaps', { tie: false })).snaps.tie, false);
  await assert.rejects(reg.run('tie_vertex', { id, vertex: 9, point: 'A' }), /vertices 0/);
});

test('ties survive a save round trip; paste keeps them only with the points', async () => {
  const { reg, ctx, id } = await setup();
  const saved = JSON.parse(JSON.stringify(ctx.doc));
  assert.equal(D.getEntity(saved, id).ties.length, 2);

  const alone = Clip.copyEntities(ctx.doc, [id]);
  const [p1] = Clip.pasteEntities(ctx.doc, alone, { offset: [0, 0, 20] });
  assert.equal(D.getEntity(ctx.doc, p1).ties, undefined, 'pasted without its points: untied');

  const ptIds = ctx.doc.entities.filter((e) => e.type === 'point').map((e) => e.id);
  const both = Clip.copyEntities(ctx.doc, [id, ...ptIds]);
  const tops = Clip.pasteEntities(ctx.doc, both, { offset: [0, 0, 40] });
  const copy = tops.map((x) => D.getEntity(ctx.doc, x)).find((e) => e.curve);
  assert.ok(copy.ties.every((t) => tops.includes(t.point)), 'ties point at the pasted points');
  TI.syncTies(ctx.doc);
  assert.equal(copy.ties.length, 2, 'and stay tied after a sync');
});

test('a surface using the tied line as a breakline rebuilds when the point moves', async () => {
  const { reg, ctx, id } = await setup();
  await reg.run('add_point', { name: 'C', at: [5, 0, 8] });
  await reg.run('add_point', { name: 'D', at: [5, 0, -8] });
  const s = await reg.run('create_surface', { name: 'EG', breaklines: [id] });
  const surf = () => D.getEntity(ctx.doc, s.id);
  const top = () => Math.max(...D.worldMesh(ctx.doc, surf()).v.map((v) => v[1]));
  await reg.run('move', { ids: ['B'], by: [0, 3, 0] });
  nearArr(worldVerts(ctx.doc, D.getEntity(ctx.doc, id))[1], [10, 3, 0], 1e-3);
  assert.ok(top() > 2.9, 'the surface rose with the point');
});
