// Agent profiles and the crew rules for agents working at once (#243).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crew, crewRun, normalizeProfiles, normalizeProfile, DEFAULT_AGENT } from '../src/core/agents.js';
import { makeCtx } from './helpers.js';

test('profiles: Plumb always first, ids unique, fields filled', () => {
  const list = normalizeProfiles([{ name: 'Site Surveyor', provider: 'anthropic', skill: 'survey', color: 'bad' }, { name: 'Site surveyor' }]);
  assert.deepEqual(list.map((p) => p.id), [DEFAULT_AGENT, 'site-surveyor']);
  assert.equal(list[0].name, 'Plumb');
  assert.equal(list[1].provider, 'anthropic');
  assert.equal(list[1].skill, 'survey');
  assert.match(list[1].color, /^#[0-9a-f]{6}$/);
  assert.equal(normalizeProfile({ name: 'X', provider: 'nope', skill: 'none' }).provider, null);
  assert.equal(normalizeProfile({ name: 'X', provider: 'builtin', model: 'qwen3-8b' }).provider, 'builtin', 'the built-in model, per profile (#238)');
  assert.equal(normalizeProfiles([{ id: 'plumb', name: 'Plumb', instructions: 'Be brief.' }])[0].instructions, 'Be brief.');
});

test('crew: first turn opens the batch, last closes it; claims end with the turn', () => {
  const c = new Crew();
  assert.equal(c.start('a'), true);
  assert.equal(c.start('b'), false);
  c.claim('a', ['e1']);
  assert.deepEqual(c.clash('b', ['e2', 'e1']), { entity: 'e1', owner: 'a' });
  assert.equal(c.clash('a', ['e1']), null);
  assert.equal(c.end('a'), false);
  assert.equal(c.clash('b', ['e1']), null);
  assert.equal(c.end('b'), true);
});

test('crew: calls run one at a time, a failure does not block the next', async () => {
  const c = new Crew();
  const order = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await Promise.all([
    c.serial(async () => (order.push('a1'), await wait(20), order.push('a2'))),
    c.serial(async () => { throw new Error('x'); }).catch(() => order.push('fail')),
    c.serial(async () => order.push('b')),
  ]);
  assert.deepEqual(order, ['a1', 'a2', 'fail', 'b']);
});

test('two agents on one document: own edits apply and are journaled by name, a clash is held then applied', async () => {
  const { ctx, reg } = makeCtx();
  const crew = new Crew();
  const A = { id: 'plumb', name: 'Plumb' };
  const B = { id: 'colour', name: 'Colourist' };
  const run = (n, a) => reg.run(n, a);
  ctx.store.checkpoint();
  ctx.batchDepth = 1;
  crew.start(A.id);
  crew.start(B.id);
  await Promise.all([crewRun(crew, ctx, A, run, 'create_box', { width: 1, height: 1, depth: 1, name: 'Box' }), crewRun(crew, ctx, B, run, 'create_sphere', { radius: 0.5, name: 'Ball' })]);
  const held = await crewRun(crew, ctx, B, run, 'set_material', { ids: ['Box'], color: '#ff0000' });
  assert.equal(held.held, 1);
  assert.match(held.message, /another agent \(plumb\)/);
  assert.notEqual(ctx.doc.entities.find((e) => e.name === 'Box').material.color, '#ff0000');
  await crewRun(crew, ctx, B, run, 'set_material', { ids: ['Ball'], color: '#00ff00' });
  await assert.rejects(crewRun(crew, ctx, A, run, 'create_box', { width: 1, height: 1, depth: 1, parent: 'nope' }));
  assert.deepEqual(ctx.doc.journal.map((j) => `${j.agent}:${j.command}`), ['Plumb:create_box', 'Colourist:create_sphere', 'Colourist:set_material']);
  crew.end(A.id);
  crew.end(B.id);
  ctx.batchDepth = 0;
  // the user applies the held change once the turns are over: it runs as its own undo step
  const h = crew.take(1);
  await reg.run(h.command, h.args);
  assert.equal(ctx.doc.entities.find((e) => e.name === 'Box').material.color, '#ff0000');
  assert.equal(crew.held.length, 0);
  // both turns were one undo step, the applied change another
  ctx.store.undo();
  ctx.store.undo();
  assert.equal(ctx.doc.entities.length, 0);
});
