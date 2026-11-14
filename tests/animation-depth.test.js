// Phase 13 (animation depth): easing curves, clips, physics, shots, audio, section reveal, constraints, 4D schedules, key editing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import * as A from '../src/core/animation.js';
import * as SQ from '../src/core/sequencing.js';
import * as D from '../src/core/document.js';

const byName = (ctx, n) => ctx.doc.entities.find((e) => e.name === n);

test('custom easing curves: cubic-bezier keys', async () => {
  near(SQ.cubicBezier([0, 0, 1, 1])(0.3), 0.3, 1e-6);
  near(SQ.cubicBezier([0.42, 0, 0.58, 1])(0.5), 0.5, 1e-6);
  assert.ok(SQ.cubicBezier([0, 0, 0.2, 1])(0.2) > 0.35, 'ease-out is fast at first');
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'B' });
  await reg.run('animate', { target: 'B', property: 'position', from: [0, 0, 0], to: [10, 0, 0], start: 0, end: 1 });
  await reg.run('set_ease', { id: 'B', property: 'position', time: 1, bezier: [0.3, 1.4, 0.6, 1] });
  const x = A.evaluate(ctx.doc, 0.7)[byName(ctx, 'B').id].position[0];
  assert.ok(x > 10, `overshoot: ${x}`);
  await assert.rejects(reg.run('set_ease', { id: 'B', bezier: [2, 0, 0.5, 1] }), /between 0 and 1/);
});

test('clips: a door opening saved once, played on other doors where they are', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 0.9, height: 2.1, depth: 0.05, name: 'Door A' });
  await reg.run('create_box', { width: 0.9, height: 2.1, depth: 0.05, name: 'Door B', position: [5, 0, 0], rotation: [0, 90, 0] });
  await reg.run('animate', { target: 'Door A', property: 'rotation', from: [0, 0, 0], to: [0, -100, 0], start: 1, end: 3 });
  const c = await reg.run('save_clip', { name: 'Door opens', ids: ['Door A'], from: 1, to: 3 });
  assert.equal(c.duration, 2);
  await reg.run('apply_clip', { name: 'door opens', ids: ['Door B'], start: 5, speed: 2 });
  const b = byName(ctx, 'Door B').id;
  nearArr(A.evaluate(ctx.doc, 5)[b].rotation, [0, 90, 0]);
  nearArr(A.evaluate(ctx.doc, 6)[b].rotation, [0, -10, 0], 1e-6);
  assert.deepEqual((await reg.run('list_animation_clips', {}))[0].properties, ['rotation']);
  await assert.rejects(reg.run('apply_clip', { name: 'window slides', ids: ['Door B'] }), /No clip/);
});

test('physics: shapes fall, tumble and settle on the ground and on each other', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 4, height: 0.5, depth: 4, name: 'Table' });
  await reg.run('create_box', { width: 0.5, height: 0.5, depth: 0.5, name: 'Crate', position: [0, 3, 0], rotation: [25, 0, 40] });
  const r = await reg.run('simulate_physics', { ids: ['Crate'], duration: 3 });
  assert.equal(r.colliders, 1);
  const end = A.evaluate(ctx.doc, 3)[byName(ctx, 'Crate').id];
  near(end.position[1], 0.5, 0.05, 'rests on the table top');
  assert.ok(Math.abs(Math.abs(end.rotation[0]) % 90) < 5 || Math.abs(Math.abs(end.rotation[0]) % 90) > 85, 'lies flat');
});

test('shots cut the camera; a moving shot glides; section reveal; audio clips', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('add_shot', { name: 'Wide', start: 0, end: 3, position: [20, 10, 20], target: [0, 0, 0], lens: 24 });
  await reg.run('add_shot', { name: 'Push in', start: 3, end: 6, position: [10, 3, 10], target: [0, 1, 0], position_end: [5, 2, 5] });
  assert.deepEqual(A.evaluate(ctx.doc, 1).camera.position, [20, 10, 20]);
  assert.equal(A.evaluate(ctx.doc, 1).camera.shot, 'Wide');
  nearArr(A.evaluate(ctx.doc, 4.5).camera.position, [7.5, 2.5, 7.5], 1e-6);
  await reg.run('add_shot', { name: 'Detail', start: 2, end: 4, position: [1, 1, 1], target: [0, 0, 0] });
  assert.deepEqual(ctx.doc.animation.shots.map((s) => s.name), ['Detail'], 'a new shot replaces the ones it overlaps');
  await reg.run('create_box', { width: 2, height: 4, depth: 2 });
  const s = await reg.run('animate_section', { start: 0, end: 4 });
  near(s.from[1], -0.01, 1e-6);
  near(A.evaluate(ctx.doc, 4).section.point[1], 4.01, 1e-6);
  assert.deepEqual(A.evaluate(ctx.doc, 2).section.normal, [0, 1, 0]);
  ctx.io = { readBinary: async () => new Uint8Array([1, 2, 3, 4]) };
  const au = await reg.run('add_audio', { path: 'C:/music/theme.mp3', start: 1.5, fade_in: 1 });
  assert.equal(au.name, 'theme');
  await assert.rejects(reg.run('add_audio', { path: 'C:/music/theme.mid' }), /MP3/);
  assert.equal((await reg.run('remove_audio', { name: 'all' })).removed, 1);
});

test('attach and release (a crane picks a beam), follow, look at', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 0.3, height: 0.3, depth: 0.3, name: 'Hook', position: [0, 5, 0] });
  await reg.run('create_box', { width: 4, height: 0.3, depth: 0.3, name: 'Beam', position: [0, 4.7, 0] });
  await reg.run('animate', { target: 'Hook', property: 'position', from: [0, 5, 0], to: [6, 8, 0], start: 1, end: 3 });
  await reg.run('attach', { id: 'Beam', parent: 'Hook', start: 1, end: 3 });
  const beam = byName(ctx, 'Beam').id;
  nearArr(A.evaluate(ctx.doc, 2)[beam].position, [3, 6.2, 0], 1e-6);
  nearArr(A.evaluate(ctx.doc, 5)[beam].position, [6, 7.7, 0], 1e-6, 'released at 3 s where it was');
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Turret' });
  await reg.run('look_at', { id: 'Turret', at: 'Hook' });
  near(A.evaluate(ctx.doc, 3)[byName(ctx, 'Turret').id].rotation[1], 90, 1e-3, 'faces +x');
  await reg.run('remove_constraints', { id: 'all' });
  assert.equal(A.evaluate(ctx.doc, 2)[beam], undefined);
});

test('4D schedules: CSV, MS Project XML and P6 XER; tasks build what they match; a date caption', async () => {
  const csv = 'Task,Start,Finish,Element\nFoundations,2027-03-01,2027-03-05,Footings\nFrame,02/03/2027,12/03/2027,\nRoof,2027-03-15,2027-03-19,Roof';
  const t = SQ.parseSchedule(csv);
  assert.deepEqual(t.map((x) => x.name), ['Foundations', 'Frame', 'Roof']);
  assert.equal(new Date(t[1].start).toISOString().slice(0, 10), '2027-03-02', 'day first');
  const xml = '<Project><Tasks><Task><UID>0</UID><Name>Project</Name><Summary>1</Summary><Start>2027-03-01T08:00:00</Start><Finish>2027-03-19T17:00:00</Finish></Task><Task><UID>1</UID><Name>Frame</Name><Start>2027-03-02T08:00:00</Start><Finish>2027-03-12T17:00:00</Finish></Task></Tasks></Project>';
  assert.deepEqual(SQ.parseSchedule(xml).map((x) => x.name), ['Frame']);
  const xer = 'ERMHDR\t19.12\n%T\tTASK\n%F\ttask_id\ttask_code\ttask_name\ttarget_start_date\ttarget_end_date\n%R\t1\tA100\tRoof\t2027-03-15 08:00\t2027-03-19 17:00\n%E';
  assert.equal(SQ.parseSchedule(xer)[0].id, 'A100');
  const { reg, ctx } = makeCtx();
  for (const [name, tag] of [['Footings', 'Substructure'], ['Column', 'Frame'], ['Roof', 'Roof']]) await reg.run('create_box', { width: 1, height: 1, depth: 1, name, tag });
  const r = await reg.run('import_schedule', { text: csv, seconds_per_day: 1 });
  assert.equal(r.matched, 3);
  assert.deepEqual(r.schedule.map((x) => x.builds), [['Footings'], ['Column'], ['Roof']], 'by element, by layer, by element');
  const col = byName(ctx, 'Column').id;
  assert.equal(A.evaluate(ctx.doc, 0.5)[col].visible, false);
  assert.equal(A.evaluate(ctx.doc, 2)[col].visible, true);
  const cap = ctx.doc.animation.captions.find((c) => c.date);
  assert.equal(SQ.dateText(cap, 2.5), 'Wed 3 Mar 2027 · Foundations, Frame');
  await assert.rejects(reg.run('import_schedule', { text: 'a,b\n1,2' }), /Name/);
});

test('dope sheet: retime, copy and delete keys', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'A' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'B' });
  await reg.run('animate', { target: 'A', property: 'position', from: [0, 0, 0], to: [4, 0, 0], start: 1, end: 3 });
  assert.equal((await reg.run('retime', { ids: ['A'], from: 1, scale: 2 })).keys, 2);
  assert.deepEqual(ctx.doc.animation.tracks[0].keys.map((k) => k.t), [1, 5]);
  await reg.run('copy_keys', { from_id: 'A', to: ['B'], offset: 2 });
  assert.deepEqual(ctx.doc.animation.tracks.find((t) => t.target === byName(ctx, 'B').id).keys.map((k) => k.t), [3, 7]);
  assert.equal((await reg.run('delete_keys', { ids: ['B'], from: 6 })).deleted, 1);
  await assert.rejects(reg.run('retime', { scale: 0 }), /above 0/);
  void D;
});
