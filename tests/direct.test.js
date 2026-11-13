// AIs build in the app: every command is reachable through a toolset, and what looks like a file (points, a schedule,
// a code library) has a direct command, so an AI never has to compose a file to import it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import { TOOLSETS, ALWAYS } from '../src/core/routing.js';
import { GUIDE } from '../src/core/commands.js';

test('every command is in a toolset, and every toolset name is a command', () => {
  const { reg } = makeCtx();
  const reached = new Set(ALWAYS);
  for (const t of Object.values(TOOLSETS)) {
    for (const c of reg.commands.values()) if (t.categories.includes(c.category)) reached.add(c.name);
    t.names.forEach((n) => reached.add(n));
  }
  assert.deepEqual([...reg.commands.keys()].filter((n) => !reached.has(n)), [], 'commands no toolset offers');
  assert.deepEqual([...reached].filter((n) => !reg.commands.has(n)), [], 'toolset names that are not commands');
});

test('the direct commands the GUIDE names instead of files exist', () => {
  const { reg } = makeCtx();
  for (const n of ['add_points', 'create_feature_library', 'edit_library_code', 'create_curve', 'define_surface_material', 'import_schedule']) {
    assert.ok(reg.commands.has(n), n);
    assert.ok(GUIDE.includes(n), `GUIDE names ${n}`);
  }
});

test('add_points enters a list of points in one undo step', async () => {
  const { reg, ctx } = makeCtx();
  const r = await reg.run('add_points', { points: [{ name: 'P1', n: 100, e: 200, z: 10, code: 'TREE' }, { name: 'P2', n: 105, e: 204 }] });
  assert.equal(r.added, 2);
  assert.deepEqual(r.points.map((p) => p.name), ['P1', 'P2']);
  await reg.run('undo', {});
  assert.equal(ctx.doc.entities.filter((e) => e.type === 'point').length, 0, 'one undo removes both');
});

test('import_schedule takes tasks directly, no file', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { name: 'Slab', width: 4, height: 0.3, depth: 4 });
  await reg.run('create_box', { name: 'Wall', width: 4, height: 3, depth: 0.2, position: [0, 0.3, 0] });
  const r = await reg.run('import_schedule', { tasks: [{ name: 'Pour', start: '2027-03-01', finish: '2027-03-05', element: 'Slab' }, { name: 'Build', start: '2027-03-06', finish: '2027-03-12', element: 'Wall' }] });
  assert.deepEqual([r.tasks, r.matched], [2, 2]);
  assert.deepEqual(r.schedule.map((t) => t.builds), [['Slab'], ['Wall']], 'each task builds its element');
});
