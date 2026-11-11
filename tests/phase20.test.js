// Phase 20: split / join lines (#219), names of copies (#220), tutorial points (#221), achievements (#222),
// the local AI setup commands (#224) and the parametric drafting instruction (#225).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, nearArr } from './helpers.js';
import * as DR from '../src/core/drafting.js';
import * as D from '../src/core/document.js';
import * as LEARN from '../src/core/learning.js';
import * as ACH from '../src/core/achievements.js';
import { systemPrompt } from '../src/core/agent.js';

test('connect: nearest ends meet, a gap is bridged, touching ends merge, picked ends win', () => {
  const a = [[0, 0, 0], [5, 0, 0]];
  const b = [[7, 0, 0], [10, 0, 0]];
  assert.deepEqual(DR.connect(a, b), [[0, 0, 0], [5, 0, 0], [7, 0, 0], [10, 0, 0]]);
  assert.deepEqual(DR.connect(a, [[5, 0, 0], [5, 0, 4]]), [[0, 0, 0], [5, 0, 0], [5, 0, 4]], 'touching ends merge');
  // b reversed: its far end is nearer
  assert.deepEqual(DR.connect(a, [[10, 0, 0], [6, 0, 0]]), [[0, 0, 0], [5, 0, 0], [6, 0, 0], [10, 0, 0]]);
  // the user clicked near a's start: that end joins
  assert.deepEqual(DR.connect(a, b, [0.2, 0, 0]), [[5, 0, 0], [0, 0, 0], [7, 0, 0], [10, 0, 0]]);
});

test('connect_curves and break_curve: join two lines into one, split it again', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_curve', { points: [[0, 0, 0], [5, 0, 0]], name: 'A' });
  await reg.run('create_curve', { points: [[6, 0, 0], [6, 0, 4]], name: 'B' });
  const r = await reg.run('connect_curves', { ids: ['A', 'B'], at: [4.8, 0, 0], at2: [6, 0, 0.1] });
  assert.equal(r.name, 'A');
  assert.ok(!ctx.doc.entities.some((e) => e.name === 'B'), 'the second line is taken in');
  const pts = D.curvePoints(ctx.doc, D.resolve(ctx.doc, 'A')[0]);
  nearArr(pts.at(-1), [6, 0, 4]);
  assert.equal(pts.length, 4);
  await assert.rejects(reg.run('connect_curves', { ids: ['A', 'A'] }), /two different/);
  assert.equal((await reg.run('break_curve', { id: 'A', at: [5.5, 0, 0] })).length, 2);
});

test('a copy of "Rectangle 2" is "Rectangle 3", never "Rectangle 2 2"', () => {
  const doc = { entities: ['Rectangle', 'Rectangle 2'].map((name) => ({ name })) };
  assert.equal(D.uniqueName(doc, 'Rectangle 2'), 'Rectangle 3');
  assert.equal(D.uniqueName(doc, 'Rectangle'), 'Rectangle 3');
  assert.equal(D.uniqueName(doc, 'Door'), 'Door');
});

test('a finished tutorial earns points once, on top of its lesson', async () => {
  const guided = LEARN.allLessons().find((l) => l.guide).id;
  const plain = LEARN.allLessons().find((l) => !l.guide).id;
  assert.equal(LEARN.progress([guided], [guided]).points, LEARN.POINTS + LEARN.TUTORIAL_POINTS);
  assert.equal(LEARN.progress([plain], [plain]).points, LEARN.POINTS, 'no tutorial, no tutorial points');
  const { reg } = makeCtx();
  await reg.run('complete_lesson', { id: guided });
  const p = await reg.run('complete_lesson', { id: guided, tutorial: true });
  assert.equal(p.points, LEARN.POINTS + LEARN.TUTORIAL_POINTS);
  assert.equal(p.tutorials, 1);
  assert.equal((await reg.run('complete_lesson', { id: guided, tutorial: true })).points, p.points, 'once');
  const list = await reg.run('list_lessons', {});
  assert.ok(list.modules.flatMap((m) => m.lessons).find((l) => l.id === guided).tutorial_done);
});

test('achievements: counting, streaks, tiers and insights', () => {
  const day = (d, h = 10) => Date.parse(`2026-11-${String(d).padStart(2, '0')}T${h}:00:00Z`);
  let s = {};
  s = ACH.record(s, 'create_curve', { now: day(9) });
  s = ACH.record(s, 'create_curve', { now: day(9) + 60e3 });
  s = ACH.record(s, 'list_layers', { now: day(10) }); // reads do not count
  s = ACH.record(s, 'create_box', { now: day(10) + 2 * 60e3 });
  s = ACH.record(s, 'set_params', { now: day(11) });
  s = ACH.record(s, null, { now: day(11) + 60e3, ai: { calls: 6 } });
  assert.equal(s.commands.create_curve, 2);
  assert.equal(s.commands.list_layers, undefined);
  assert.equal(s.ai.requests, 1);
  assert.deepEqual(ACH.streaks(s.days, '2026-11-11'), { current: 3, longest: 3 });
  assert.equal(ACH.streaks(s.days, '2026-11-20').current, 0, 'a gap ends the streak');
  assert.equal(s.minutes, 4, 'only gaps under five minutes count as modelling time');
  const r = ACH.insights(s, { lessons: 1, tutorials: 0 }, '2026-11-11');
  assert.equal(r.commands_run, 4);
  assert.equal(r.days_active, 3);
  assert.equal(r.ai_minutes_saved, 3);
  assert.equal(r.favourites[0].name, 'create_curve');
  const draft = r.tracks.find((t) => t.id === 'draftsman');
  assert.equal(draft.name, 'Bronze');
  assert.equal(draft.next, 25);
  assert.equal(r.tracks.find((t) => t.id === 'regular').name, 'Bronze', 'three days in a row');
  assert.deepEqual(ACH.newTiers({}, ACH.record({}, 'create_box')).map((t) => t.label), ['Builder']);
  assert.equal(ACH.tierOf(ACH.TRACKS[0], 1000).progress, 1, 'every tier reached');
});

test('my_insights and the local AI setup commands', async () => {
  const { reg, ctx } = makeCtx();
  ctx.stats = ACH.record({}, 'create_box');
  assert.equal((await reg.run('my_insights', {})).commands_run, 1);
  await assert.rejects(reg.run('ai_setup_status', {}), /desktop app/);
  const calls = [];
  ctx.io = { ...(ctx.io || {}), settings: () => ({ ai: { ollama: { model: 'mistral' } } }), aiSetup: async (step, arg) => (calls.push([step, arg]), step === 'status' ? { provider: 'ollama', ollama: 'running', models: [], model: 'mistral', has_model: false } : { ok: true }) };
  assert.equal((await reg.run('ai_setup_status', {})).next, 'download');
  await reg.run('pull_ai_model', {});
  assert.deepEqual(calls.at(-1), ['pull', 'mistral']);
});

test('the copilot is told to draft parametric, editable work', () => {
  const p = systemPrompt({ doc: { entities: [], animation: { duration: 5, tracks: [] } } });
  assert.match(p, /keep everything editable/);
  assert.match(p, /never bake unless asked/);
});
