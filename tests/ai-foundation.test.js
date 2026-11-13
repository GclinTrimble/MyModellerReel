// Phase 1 (AI foundation): argument checking, tool routing, arrange, relational placement, smart selection,
// metadata, scene queries, proposals and the shared agent loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import { validate } from '../src/core/schema.js';
import { rankCommands, routeTools, ALWAYS } from '../src/core/routing.js';
import { runTurn, selectTools } from '../src/core/agent.js';

test('arguments: small-model slips are coerced, real mistakes explained', async () => {
  const { reg } = makeCtx();
  const box = await reg.run('create_box', { width: '2', height: 1, depth: '0.5', position: '[1, 0, 0]' });
  assert.deepEqual(box.size, [2, 1, 0.5]);
  assert.deepEqual(box.position, [1, 0, 0]);
  await reg.run('move', { id: box.id, by: [1, 0, 0] }); // `id` where `ids` is expected
  await reg.run('move', { ids: box.id, by: [0, 1, 0] }); // bare string for a list
  assert.deepEqual((await reg.run('get_entity', { id: box.id })).position, [2, 1, 0]);
  await assert.rejects(reg.run('create_box', { width: 'big', height: 1, depth: 1 }), /width must be number/);
  await assert.rejects(reg.run('create_box', { width: 1, height: 1, depth: 1, size: 3 }), /unknown parameter "size".*Valid: width/);
  await assert.rejects(reg.run('set_view', { preset: 'diagonal' }), /one of top, bottom/);
  assert.equal(validate('x', { type: 'object', properties: { p: { type: 'string', enum: ['Top', 'Side'] } } }, { p: 'top' }).p, 'Top');
  await assert.rejects(reg.run('move', { ids: [box.id], by: [1, 0] }), /\[x,y,z\]/);
  await assert.rejects(reg.run('creat_box', {}), /Did you mean create_box/);
});

test('routing: list_commands ranks by intent; small models get a routed subset', async () => {
  const { reg } = makeCtx();
  const top = (await reg.run('list_commands', { query: 'put the lamp on the table', limit: 3 })).map((c) => c.name);
  assert.ok(top.includes('place_on'), top.join());
  assert.equal((await reg.run('list_commands', { query: 'stack boxes', limit: 1 }))[0].name, 'stack');
  const anim = await reg.run('list_commands', { toolset: 'animation' });
  assert.ok(anim.every((c) => c.category === 'animate' || ['get_scene', 'select', 'select_where', 'add_scene', 'go_to_scene'].includes(c.name)));
  assert.ok(anim.some((c) => c.name === 'turntable'));
  assert.ok((await reg.run('list_commands', { query: 'hinge a door' })).slice(0, 5).some((c) => c.name === 'set_pivot'));
  const list = reg.list();
  const routed = routeTools(list, { query: 'make a row of 5 columns spaced 2 m', used: ['set_material'] });
  assert.ok(routed.length <= 18 && routed.length >= ALWAYS.length);
  for (const n of [...ALWAYS, 'set_material', 'duplicate']) assert.ok(routed.some((c) => c.name === n), n);
  assert.equal(selectTools('anthropic', list).length, list.length); // big models see everything
  assert.ok(rankCommands(list, { query: 'zzz qqq' }).length === 0);
});

test('align and distribute', async () => {
  const { reg } = makeCtx();
  const a = await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [0, 0, 0] });
  const b = await reg.run('create_box', { width: 2, height: 1, depth: 1, position: [5, 0, 3] });
  const c = await reg.run('create_box', { width: 1, height: 3, depth: 1, position: [9, 0, -2] });
  const ids = [a.id, b.id, c.id];
  await reg.run('align', { ids, axis: 'z', to: 'max' });
  const bz = (await reg.run('bounds_of', { ids: [b.id] })).max[2];
  for (const id of ids) near((await reg.run('bounds_of', { ids: [id] })).max[2], bz);
  await reg.run('distribute', { ids, axis: 'x' });
  const boxes = await Promise.all(ids.map((id) => reg.run('bounds_of', { ids: [id] })));
  near(boxes[1].min[0] - boxes[0].max[0], boxes[2].min[0] - boxes[1].max[0]);
  near(boxes[0].min[0], -0.5); // the outer ones stay
  near(boxes[2].max[0], 9.5);
  await reg.run('distribute', { ids, axis: 'x', gap: 0.25 });
  const b2 = await Promise.all(ids.map((id) => reg.run('bounds_of', { ids: [id] })));
  near(b2[1].min[0] - b2[0].max[0], 0.25);
  near(b2[2].min[0] - b2[1].max[0], 0.25);
  await reg.run('align', { ids, axis: 'y', to: 'center', relative_to: c.id });
  near((await reg.run('bounds_of', { ids: [a.id] })).center[1], 1.5);
});

test('relational placement: place_on, against, stack, a face index', async () => {
  const { reg } = makeCtx();
  const table = await reg.run('create_box', { width: 1.6, height: 0.75, depth: 0.9, position: [3, 0, 2], name: 'Table' });
  await reg.run('create_cylinder', { radius: 0.1, height: 0.4, position: [-4, 2, 7], name: 'Lamp' });
  const lamp = (await reg.run('place_on', { ids: ['Lamp'], target: 'Table' }))[0];
  nearArr(lamp.min, [2.9, 0.75, 1.9]);
  const moved = (await reg.run('place_on', { ids: ['Lamp'], target: 'Table', at: [3.5, 2.3] }))[0];
  nearArr([moved.position[0], moved.min[1], moved.position[2]], [3.5, 0.75, 2.3]);
  await reg.run('create_box', { width: 4, height: 2.7, depth: 0.2, position: [0, 0, -3], name: 'Wall' });
  await reg.run('create_box', { width: 2, height: 0.8, depth: 0.9, position: [1, 0, 4], name: 'Sofa' });
  const sofa = (await reg.run('against', { ids: ['Sofa'], target: 'Wall', side: 'front' }))[0];
  near(sofa.min[2], -2.9);
  near(sofa.min[1], 0); // keeps its height
  near(sofa.position[0], 0); // centred on the wall
  const faces = (await reg.run('get_entity', { id: 'Wall' })).faces;
  const right = faces.find((f) => f.normal[0] > 0.9).index;
  const snapped = (await reg.run('place_on', { ids: ['Lamp'], target: 'Wall', face: String(right) }))[0];
  near(snapped.min[0], 2);
  const s = [];
  for (let i = 0; i < 3; i++) s.push((await reg.run('create_box', { width: 1 - i * 0.2, height: 0.5, depth: 1, position: [i * 3, 0, 8] })).id);
  const stacked = await reg.run('stack', { ids: s });
  near(stacked[2].min[1], 1);
  near(stacked[2].position[0], 0);
  assert.ok(table.id);
});

test('smart selection and metadata', async () => {
  const { ctx, reg } = makeCtx();
  for (let i = 0; i < 3; i++) await reg.run('create_box', { width: 1, height: 1.2, depth: 0.1, name: `Window ${i + 1}`, color: '#b8dbe2', position: [i * 2, 1, 0] });
  await reg.run('create_box', { width: 6, height: 3, depth: 0.2, name: 'Facade', color: '#e9e4d8', tag: 'Walls' });
  await reg.run('create_box', { width: 1, height: 1.21, depth: 0.1, name: 'Odd one', position: [9, 0, 0] });
  assert.equal((await reg.run('select_where', { name: 'Window*' })).count, 3);
  assert.equal((await reg.run('select_where', { color: '#B8DBE2' })).count, 3);
  assert.equal((await reg.run('select_where', { tag: 'walls' })).count, 1);
  assert.equal((await reg.run('select_where', { min_size: 5 })).count, 1);
  assert.equal((await reg.run('select_where', { similar_to: 'Window 1' })).count, 3); // Window 2, 3 and the odd one (within 10 %)
  assert.equal((await reg.run('select_where', { name: '/^win/i', invert: true })).count, 2);
  await reg.run('set_metadata', { ids: ['Window 1', 'Window 2'], values: { role: 'window', cost: 420 } });
  assert.equal((await reg.run('select_where', { metadata: { role: 'window' } })).count, 2);
  assert.equal((await reg.run('select_where', { metadata: { cost: '*' } })).count, 2);
  await reg.run('set_metadata', { ids: ['Window 2'], remove: ['role', 'cost'] });
  assert.equal(ctx.doc.entities.find((e) => e.name === 'Window 2').meta, undefined);
  assert.deepEqual((await reg.run('get_entity', { id: 'Window 1' })).meta, { role: 'window', cost: 420 });
  await reg.run('select', { ids: ['Facade'] });
  assert.equal((await reg.run('select', { mode: 'invert' })).selection.length, 4);
});

test('scene queries: raycast, bounds_of, find_free_space', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { width: 2, height: 1, depth: 2, name: 'Plinth' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [0, 1, 0], name: 'Cube' });
  const down = await reg.run('raycast', { origin: [0.2, 10, 0.2], direction: [0, -1, 0] });
  assert.equal(down.name, 'Cube');
  near(down.point[1], 2);
  nearArr(down.normal, [0, 1, 0]);
  const all = await reg.run('raycast', { origin: [0.8, 10, 0], direction: [0, -1, 0], all: true });
  assert.deepEqual(all.hits.map((x) => x.name), ['Plinth']); // misses the cube
  assert.deepEqual(await reg.run('raycast', { origin: [5, 10, 5], direction: [0, -1, 0] }), { hit: null });
  const b = await reg.run('bounds_of', { ids: ['Plinth', 'Cube'] });
  assert.deepEqual(b.size, [2, 2, 2]);
  const free = await reg.run('find_free_space', { size: [1, 1] });
  const fb = { min: [free.position[0] - 0.5, free.position[2] - 0.5], max: [free.position[0] + 0.5, free.position[2] + 0.5] };
  assert.ok(fb.min[0] >= 1.1 - 1e-9 || fb.max[0] <= -1.1 + 1e-9 || fb.min[1] >= 1.1 - 1e-9 || fb.max[1] <= -1.1 + 1e-9, JSON.stringify(free));
  assert.ok(Math.hypot(free.position[0], free.position[2]) < 2.5);
  const like = await reg.run('find_free_space', { like: 'Cube', near: [0, 0] });
  assert.ok(Math.abs(like.position[0]) >= 1.5 || Math.abs(like.position[2]) >= 1.5);
});

test('proposals: changes wait for accept; reject restores the model and its history', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Keep' });
  const st = await reg.run('propose', { action: 'start' });
  assert.equal(st.pending, true);
  await reg.run('create_sphere', { radius: 0.5, name: 'New' });
  await reg.run('move', { ids: ['Keep'], by: [1, 0, 0] });
  const s = await reg.run('propose', { action: 'status' });
  assert.equal(s.added.length, 1);
  assert.deepEqual(s.changed, ['e1']);
  await reg.run('propose', { action: 'reject' });
  assert.deepEqual(ctx.doc.entities.map((e) => e.name), ['Keep']);
  assert.deepEqual(ctx.doc.entities[0].position, [0, 0, 0]);
  assert.equal(ctx.store.undo(), true); // back past the box: history inside the proposal is gone
  assert.equal(ctx.doc.entities.length, 0);
  ctx.store.redo();
  await reg.run('propose', { action: 'start' });
  await reg.run('delete', { ids: ['Keep'] });
  assert.deepEqual((await reg.run('propose', { action: 'status' })).removed, ['e1']);
  const acc = await reg.run('propose', { action: 'accept' });
  assert.equal(acc.pending, false);
  assert.equal(ctx.doc.entities.length, 0);
});

test('agent loop: runs tool calls, feeds errors back, routes tools for local models', async () => {
  const { ctx, reg } = makeCtx();
  const script = [
    { tool_calls: [{ function: { name: 'create_box', arguments: '{"width": 2, "height": "1", "depth": 1}' } }] },
    { tool_calls: [{ function: { name: 'place_on', arguments: { target: 'nothing' } } }] },
    { tool_calls: [{ function: { name: 'create_box', arguments: '{bad json' } }] },
    { content: 'Done: one 2 m box.' },
  ];
  const seen = [];
  const history = [{ role: 'user', content: 'Make a 2 m box and put it on the table' }];
  const texts = [];
  const stats = await runTurn({
    protocol: 'ollama',
    chat: async (body) => {
      seen.push(body.tools.map((t) => t.function.name));
      return { message: { role: 'assistant', ...script.shift() } };
    },
    run: (n, a) => reg.run(n, a),
    list: () => reg.list(),
    history,
    system: 'test',
    hooks: { onText: (t) => texts.push(t) },
  });
  assert.equal(ctx.doc.entities.length, 1);
  assert.deepEqual([stats.steps, stats.calls, stats.errors], [4, 3, 2]);
  assert.ok(seen[0].length <= 18 && seen[0].includes('place_on') && seen[0].includes('create_box'));
  assert.ok(history.some((m) => m.role === 'tool' && /No entity .*nothing/.test(m.content)));
  assert.ok(history.some((m) => m.role === 'tool' && /not valid JSON/.test(m.content)));
  assert.deepEqual(texts, ['Done: one 2 m box.']);
});

test('default names are unique, so names can be used as references', async () => {
  const { reg } = makeCtx();
  const names = [];
  for (let i = 0; i < 3; i++) names.push((await reg.run('create_box', { width: 1, height: 1, depth: 1 })).name);
  assert.deepEqual(names, ['Box', 'Box 2', 'Box 3']);
  assert.equal((await reg.run('get_entity', { id: 'box 2' })).id, 'e2');
});
