// Phase 19: learning modules, civil profiles, surface editing by hand, moving things into groups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as LEARN from '../src/core/learning.js';
import * as P from '../src/core/profiles.js';

test('learning: lessons are help pages, points give levels, a module done is a badge', async () => {
  const { HOWTOS } = await import('../src/core/howto.js');
  for (const l of LEARN.allLessons()) assert.ok(HOWTOS.some((h) => h.id === l.id), `${l.id} is a help page`);
  assert.equal(LEARN.progress([]).level, 'Newcomer');
  const m1 = LEARN.MODULES[0].lessons.map((l) => l.id);
  const p = LEARN.progress(m1);
  assert.equal(p.points, m1.length * LEARN.POINTS);
  assert.deepEqual(p.badges, ['Getting started']);
  assert.ok(LEARN.lessonsFor('create_surface').includes('survey-points-to-surface'));
  const { reg } = makeCtx();
  const r = await reg.run('complete_lesson', { id: 'draw-and-edit' });
  assert.equal(r.points, 10);
  assert.equal((await reg.run('list_lessons', {})).modules[1].lessons[0].done, true);
  await assert.rejects(reg.run('complete_lesson', { id: 'juggling' }), /No lesson/);
});

test('civil profiles build closed sections of sensible size', () => {
  for (const k of ['road_crown', 'barrier_kerb', 'mountable_kerb', 'footpath_kerb', 'v_ditch', 'lined_channel', 'u_drain', 'hollow_pipe', 'pipe_trench', 'guard_rail', 'l_wall']) {
    const pts = P.profilePoints(k);
    assert.ok(pts.length >= 3, k);
    assert.ok(Math.abs(P.area2d(pts)) > 1e-4, `${k} has an area`);
  }
  const crown = P.profilePoints('road_crown', { params: { width: 8, crossfall: 2.5, depth: 0.4 } });
  assert.ok(Math.abs(Math.max(...crown.map((p) => p[0])) - Math.min(...crown.map((p) => p[0])) - 8) < 1e-9);
});

test('surface by hand: leave a point out, a minimum side, an outline and a hole', async () => {
  const { reg, ctx } = makeCtx();
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push(`${i}_${j},${j * 5},${i * 5},${(i * j) % 3},GND`);
  await reg.run('import_points', { text: pts.join('\n') });
  await reg.run('set_base_point', { e: 0, n: 0, z: 0 });
  const s = await reg.run('create_surface', { name: 'EG' });
  const faces = () => ctx.doc.entities.find((e) => e.id === s.id).mesh.f.length;
  const n0 = faces();
  await reg.run('edit_triangles', { id: 'EG', action: 'remove_point', a: '2_2' });
  assert.ok(faces() < n0, 'the point is left out');
  await reg.run('edit_triangles', { id: 'EG', action: 'restore' });
  assert.equal(faces(), n0);
  await reg.run('set_surface_sources', { id: 'EG', voids: [[[6, -6], [14, -6], [14, -14], [6, -14]]] });
  assert.ok(faces() < n0, 'a hole');
  await reg.run('set_surface_sources', { id: 'EG', voids: [], outline: [[0, 0], [10, 0], [10, -10], [0, -10]] });
  assert.ok(faces() <= 8, `inside the outline: ${faces()}`);
  // on a 5 m grid every triangle has a 5 m side: a 6 m minimum leaves nothing, which is refused (one undo step back)
  await assert.rejects(reg.run('set_surface_sources', { id: 'EG', outline: [], min_edge: 6 }), /No triangles left/);
  await reg.run('set_surface_sources', { id: 'EG', outline: [], min_edge: 4 });
  assert.equal(faces(), n0);
});

test('set_parent moves things into a group and out, keeping their place', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'A', position: [3, 0, 0] });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'B' });
  const g = await reg.run('group', { ids: ['B'], name: 'G' });
  await reg.run('move', { ids: [g.id], by: [10, 0, 0] });
  await reg.run('set_parent', { ids: ['A'], parent: 'G' });
  const a = () => ctx.doc.entities.find((e) => e.name === 'A');
  assert.equal(a().parent, g.id);
  assert.ok(Math.abs(a().position[0] + 7) < 1e-6, 'local position so the world one stays at x 3');
  await reg.run('set_parent', { ids: ['A'], parent: '' });
  assert.equal(a().parent, null);
  assert.ok(Math.abs(a().position[0] - 3) < 1e-6);
  await assert.rejects(reg.run('set_parent', { ids: ['G'], parent: 'G' }), /inside itself/);
});
