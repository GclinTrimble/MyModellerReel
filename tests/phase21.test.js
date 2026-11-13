// Phase 21: copilot feedback as training data (#232) and UI the copilot brings up (#233).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as FB from '../src/core/feedback.js';
import * as ACH from '../src/core/achievements.js';
import { ALWAYS } from '../src/core/routing.js';
import { systemPrompt } from '../src/core/agent.js';

const doc = (n = 1) => ({ name: 'M', journal: [{ name: 'create_box' }], entities: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `Box ${i}`, type: 'mesh', mesh: { positions: [0, 0, 0, 1, 1, 1] } })) });

test('a turn becomes a training record: steps clipped, journal dropped, huge models trimmed', () => {
  const r = FB.turnRecord({ prompt: 'a box', steps: [{ name: 'create_box', args: { width: 2 }, result: { id: 'e1', blob: 'x'.repeat(9000) } }, { name: 'fillet', args: {}, error: 'No edge.' }], answer: 'Done.', before: doc(0), after: doc(1), provider: 'ollama', model: 'mistral' });
  assert.equal(r.schema, FB.SCHEMA);
  assert.equal(r.rating, null);
  assert.equal(r.before.journal, undefined, 'the journal is not training data');
  assert.equal(r.after.entities.length, 1);
  assert.ok(typeof r.steps[0].result === 'string' && r.steps[0].result.length < 4100, 'big results are clipped');
  assert.equal(r.steps[1].error, 'No edge.');
  const big = { name: 'Big', entities: Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, name: 'B', type: 'mesh', mesh: { positions: 'x'.repeat(FB.MAX_DOC) } })) };
  const t = FB.trimDoc(big);
  assert.ok(t.trimmed && t.entities[0].geometry === 'omitted' && !t.entities[0].mesh);
});

test('rating, summary, JSONL and the upload row', () => {
  const a = FB.rate(FB.turnRecord({ prompt: 'a', provider: 'ollama', model: 'mistral' }), { rating: 'good' });
  const b = FB.rate(FB.turnRecord({ prompt: 'b', provider: 'ollama', model: 'mistral' }), { rating: 'bad', tags: ['wrong size', 'slow'], comment: 'Too big' });
  const c = FB.turnRecord({ prompt: 'c' });
  assert.throws(() => FB.rate(c, { rating: 'meh' }), /good or bad/);
  assert.throws(() => FB.rate(c, { rating: 'bad', tags: ['ugly'] }), /Unknown tag/);
  const s = FB.summary([a, b, c]);
  assert.deepEqual([s.rated, s.good, s.bad, s.good_rate, s.with_comment], [2, 1, 1, 50, 1]);
  assert.equal(s.top_tags[0].count, 1);
  assert.deepEqual(s.by_model, [{ model: 'ollama/mistral', rated: 2, good: 1 }]);
  const lines = FB.toJsonl([a, b, c]).trim().split('\n');
  assert.equal(lines.length, 2, 'only rated turns are training data');
  assert.equal(JSON.parse(lines[1]).comment, 'Too big');
  const row = FB.uploadRow(b);
  assert.equal(row.app, 'MyModellerReel');
  assert.deepEqual(row.tags, ['wrong size', 'slow']);
  assert.equal(row.record.id, b.id);
});

test('rate_ai_turn, list_ai_feedback and export_ai_feedback through the registry', async () => {
  const { reg, ctx } = makeCtx();
  await assert.rejects(reg.run('rate_ai_turn', { rating: 'good' }), /desktop app|No copilot answer/);
  const saved = {};
  ctx.io = { ...(ctx.io || {}), settings: () => ({ ai: { shareFeedback: false } }), feedback: async (step, x, text) => (step === 'save' ? ((saved[x.id] = structuredClone(x)), { saved: x.id, shared: false }) : step === 'list' ? Object.values(saved) : step === 'export' ? ((saved.__jsonl = text), { path: x }) : {}) };
  ctx.aiTurns = [FB.turnRecord({ id: 't1', prompt: 'wall' }), FB.turnRecord({ id: 't2', prompt: 'roof' })];
  assert.equal((await reg.run('rate_ai_turn', { rating: 'good' })).id, 't2', 'the last turn by default');
  await assert.rejects(reg.run('rate_ai_turn', { rating: 'bad', turn: 'nope' }), /No copilot answer/);
  const r = await reg.run('rate_ai_turn', { rating: 'bad', tags: ['misunderstood'], comment: 'I meant a hip roof', turn: 't1' });
  assert.equal(r.rating, 'bad');
  assert.equal(saved.t1.comment, 'I meant a hip roof');
  const l = await reg.run('list_ai_feedback', {});
  assert.equal(l.rated, 2);
  assert.equal(l.sharing, false);
  const x = await reg.run('export_ai_feedback', { path: 'C:/tmp/f.jsonl' });
  assert.equal(x.records, 2);
  assert.equal(saved.__jsonl.trim().split('\n').length, 2);
});

test('ask_user, show_form, pick_in_view and show_panel wait on the UI hooks', async () => {
  const { reg, ctx } = makeCtx();
  await assert.rejects(reg.run('ask_user', { question: 'Which wall?' }), /desktop app/);
  const seen = [];
  ctx.ui = {
    ask: async (q) => (seen.push(q), q.choices[1]),
    form: async (name, values) => (name === 'create_box' ? reg.run(name, values) : undefined),
    pick: async (what) => (what === 'object' ? ctx.doc.entities[0]?.id : [[1, 0, 2]]),
    panel: (p) => seen.push(p),
  };
  assert.deepEqual(await reg.run('ask_user', { question: 'Which wall?', choices: ['North', 'South'] }), { answer: 'South' });
  assert.equal(seen[0].allowText, false, 'choices only: no text box unless asked');
  const f = await reg.run('show_form', { command: 'create_box', values: { width: 3, height: 2, depth: 2, name: 'Shed' } });
  assert.equal(f.result.name, 'Shed');
  assert.deepEqual(await reg.run('show_form', { command: 'design_trench' }), { cancelled: true });
  await assert.rejects(reg.run('show_form', { command: 'nope' }), /No command/);
  assert.deepEqual(await reg.run('pick_in_view', { what: 'point' }), { points: [[1, 0, 2]] });
  assert.equal((await reg.run('pick_in_view', { what: 'object' })).name, 'Shed');
  assert.deepEqual(await reg.run('show_panel', { panel: 'entity', id: 'Shed' }), { shown: 'entity' });
  assert.equal(seen.at(-1), 'entity');
});

test('the copilot is told to ask, always has ask_user, and rating earns the Trainer track', () => {
  assert.ok(ALWAYS.includes('ask_user'));
  const p = systemPrompt({ doc: { entities: [], animation: { duration: 5, tracks: [] } } });
  assert.match(p, /ask_user/);
  assert.match(p, /show_form/);
  let s = ACH.record({}, 'ask_user');
  assert.equal(Object.keys(s.commands).length, 0, 'asking is not a thing done');
  s = ACH.record(s, 'rate_ai_turn');
  assert.equal(ACH.insights(s).tracks.find((t) => t.id === 'trainer').name, 'Bronze');
});
