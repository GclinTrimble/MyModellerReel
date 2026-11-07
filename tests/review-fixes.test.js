// Regressions for the findings of the v0.5.0 code review: atomic commands inside batches, Stop mid-turn, plugin
// commands, macros, copies of sweeps, vertical sweeps, proposals as one undo step, recipe replays, profiles, markers,
// hinges, rollback and free space.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as G from '../src/core/geometry.js';
import * as C from '../src/core/curves.js';
import * as P from '../src/core/profiles.js';
import { runTurn } from '../src/core/agent.js';
import { findFreeSpace } from '../src/core/query.js';

test('inside a batch (an AI turn), scripts, recipes and mixed mirrors are still all or nothing', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'A' });
  await reg.run('group', { ids: ['A'], name: 'G' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'B', position: [3, 0, 0] });
  ctx.batchDepth = 1;
  const n = ctx.doc.entities.length;
  await assert.rejects(reg.run('run_script', { code: "await api.create_box({ width: 1, height: 1, depth: 1 }); throw new Error('boom');" }), /boom/);
  assert.equal(ctx.doc.entities.length, n);
  await assert.rejects(reg.run('mirror', { ids: ['B', 'G'], axis: 'x' }), /not a shape/);
  assert.equal(ctx.doc.entities.length, n);
  await reg.run('save_recipe', { name: 'Bad', steps: [{ command: 'create_box', args: { width: 1, height: 1, depth: 1 } }, { command: 'create_box', args: { width: -1, height: 1, depth: 1 } }] });
  await assert.rejects(reg.run('replay_recipe', { name: 'Bad' }), /step 2/);
  assert.equal(ctx.doc.entities.length, n); // the clearing replay did not wipe the model
  ctx.batchDepth = 0;
});

test('Stop in the middle of a turn still answers every tool call', async () => {
  const { reg } = makeCtx();
  let stop = false;
  const history = [{ role: 'user', content: 'two boxes' }];
  await runTurn({
    protocol: 'anthropic',
    chat: async () => ({ content: [{ type: 'tool_use', id: 't1', name: 'create_box', input: { width: 1, height: 1, depth: 1 } }, { type: 'tool_use', id: 't2', name: 'create_box', input: { width: 1, height: 1, depth: 1 } }] }),
    run: async (name, args) => {
      stop = true; // the user presses Stop while the first call runs
      return reg.run(name, args);
    },
    list: () => reg.list(),
    history,
    system: 's',
    hooks: { stopped: () => stop },
  });
  const results = history.at(-1).content;
  assert.deepEqual(results.map((r) => r.tool_use_id), ['t1', 't2']);
  assert.equal(results[1].is_error, true);
});

test('a plugin command is one undo step and one journal entry, and replays once', async () => {
  const { ctx, reg } = makeCtx();
  reg.define({ name: 'make_two', category: 'plugin', mutates: true, compound: true, run: async () => {
    await reg.run('create_box', { width: 1, height: 1, depth: 1 });
    await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [2, 0, 0] });
  } });
  await reg.run('make_two');
  assert.deepEqual(ctx.doc.journal.map((s) => s.command), ['make_two']);
  assert.equal(ctx.store.undoStack.length, 1);
  await reg.run('save_recipe', { name: 'Two' });
  await reg.run('replay_recipe', { name: 'Two' });
  assert.equal(ctx.doc.entities.length, 2);
});

test('macros record what was done even when the journal is full or undone', async () => {
  const { ctx, reg } = makeCtx();
  ctx.doc.journal = Array.from({ length: 2000 }, () => ({ command: 'set_style', args: {} }));
  await reg.run('record_macro', { name: 'M' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1 });
  assert.equal((await reg.run('stop_macro')).steps, 1);
});

test('a copied group keeps its copied sweep where it was put', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_curve', { points: [[0, 0, 0], [3, 0, 0]], name: 'Path' });
  const s = await reg.run('sweep', { path: 'Path', profile: 'pipe' });
  await reg.run('group', { ids: [s.id], name: 'G' });
  await reg.run('duplicate', { ids: ['G'], offset: [0, 0, 5] });
  await reg.run('set_curve', { id: 'Path', points: [[0, 0, 0], [4, 0, 0]] });
  const copy = ctx.doc.entities.find((e) => e.parent && e.parent !== ctx.doc.entities.find((x) => x.name === 'G').id && e.mesh);
  near((await reg.run('bounds_of', { ids: [copy.id] })).center[2], 5, 1e-3);
});

test('a sweep that rises and then turns keeps its section', () => {
  const sq = P.profilePoints('rectangle', { params: { width: 0.2, height: 0.2 }, anchor: 'center' });
  near(G.volume(C.sweep(sq, [[0, 0, 0], [0, 3, 0], [2, 3, 0]])), 0.04 * 5, 1e-6);
  near(G.volume(C.sweep(sq, [[0, 0, 0], [0, 3, 0], [0, 3, 2]])), 0.04 * 5, 1e-6);
});

test('an accepted proposal is one undo step; a failed command keeps the redo history', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('propose', { action: 'start' });
  for (let i = 0; i < 3; i++) await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [i * 2, 0, 0] });
  await reg.run('propose', { action: 'accept' });
  ctx.store.undo();
  assert.equal(ctx.doc.entities.length, 0);
  ctx.store.redo();
  ctx.store.undo();
  assert.equal(ctx.store.redoStack.length, 1);
  await assert.rejects(reg.run('create_box', { width: -1, height: 1, depth: 1 }));
  assert.equal(ctx.store.redoStack.length, 1);
});

test('recipes: a replay with more copies acts on the new ones; saving over the same name keeps the steps', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Unit' });
  await reg.run('save_recipe', { name: 'Row', params: { n: 2 }, steps: [
    { command: 'create_box', args: { width: 1, height: 1, depth: 1, name: 'Unit' } },
    { command: 'duplicate', args: { ids: ['Unit'], count: '{{n}}', offset: [2, 0, 0] } },
    { command: 'set_material', args: { color: '#a8553c' } },
  ] });
  await reg.run('replay_recipe', { name: 'Row', params: { n: 4 } });
  assert.equal(ctx.doc.entities.filter((e) => e.material.color === '#a8553c').length, 4);
  await reg.run('save_recipe', { name: 'Row' }); // the journal is now just "replay Row"
  assert.equal(ctx.doc.recipes.Row.steps.length, 3);
  await reg.run('replay_recipe', { name: 'Row' });
  assert.equal(ctx.doc.entities.length, 3);
});

test('a redefined profile rebuilds its sweeps; markers may contain dashes; hinges survive resizing', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('define_profile', { name: 'Bar', points: [[-0.1, 0], [0.1, 0], [0.1, 0.2], [-0.1, 0.2]] });
  const s = await reg.run('sweep', { path: [[0, 0, 0], [2, 0, 0]], profile: 'Bar' });
  await reg.run('define_profile', { name: 'Bar', points: [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]] });
  near((await reg.run('get_entity', { id: s.id })).size[1], 1, 1e-6);
  await reg.run('add_marker', { name: 'Level-2', time: 4 });
  assert.equal((await reg.run('add_caption', { text: 'x', start: 'Level-2' })).start, 4);
  assert.equal((await reg.run('add_caption', { text: 'y', start: 'Level-2 + 1' })).start, 5);
  await reg.run('create_box', { width: 2, height: 2, depth: 0.1, name: 'Door', position: [5, 0, 0] });
  await reg.run('set_pivot', { id: 'Door', pivot: 'left' });
  await reg.run('set_params', { id: 'Door', params: { width: 4, height: 2.2 } });
  const d = await reg.run('get_entity', { id: 'Door' });
  near(d.min[0], 4); // still hinged at the old left edge
  near(d.max[0], 8);
  near(d.min[1], 0); // and still on the floor
  assert.ok(ctx.doc.entities.length);
});

test('find_free_space returns the nearest free spot, not just the first ring with one', () => {
  const doc = { entities: [], tags: [{ name: 'Untagged', visible: true }] };
  // a wall of blockers leaves a gap straight ahead at 4 m and a farther corner at (3, 3)
  const box = (x0, x1, z0, z1) => ({ id: `b${doc.entities.length}`, name: 'b', type: 'mesh', parent: null, visible: true, tag: 'Untagged', position: [(x0 + x1) / 2, 0, (z0 + z1) / 2], rotation: [0, 0, 0], scale: [1, 1, 1], material: {}, mesh: G.box(x1 - x0, 1, z1 - z0) });
  doc.entities.push(box(-2.6, 2.6, -2.6, 2.6));
  const p = findFreeSpace(doc, [1, 1], { near: [0, 0], clearance: 0 });
  near(Math.hypot(p[0], p[2]), 3.5, 0.26); // straight out to an edge, not out along a diagonal
});

test('the journal keeps "the selection" implicit when the previous step made it, explicit when picked by hand', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Unit' });
  await reg.run('duplicate', { ids: ['Unit'], count: 2, offset: [2, 0, 0] });
  await reg.run('set_material', { color: '#a8553c' }); // acts on the copies duplicate just selected
  ctx.selection.set(['e1']); // a click in the viewport (not a command)
  await reg.run('set_material', { color: '#4c7a5a' });
  const [, , implicit, picked] = ctx.doc.journal;
  assert.equal(implicit.args.ids, undefined);
  assert.deepEqual(picked.args.ids, ['e1']);
});
