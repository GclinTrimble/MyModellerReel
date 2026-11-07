// Phase 3 (sequencing depth): markers as times, captions, procedural motions, exploded views, animation along a
// path and stagger. (The frame-by-frame video render needs the renderer: tests/e2e/features.e2e.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import * as A from '../src/core/animation.js';

test('markers: named times for every time parameter, with offsets', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Roof' });
  await reg.run('add_marker', { name: 'roof', time: 4 });
  await reg.run('add_marker', { name: 'Doors', time: 2 });
  assert.deepEqual(ctx.doc.animation.markers.map((m) => m.name), ['Doors', 'roof']);
  const r = await reg.run('animate', { target: 'Roof', property: 'position', by: [0, 1, 0], start: 'Roof', end: 'roof + 1.5' });
  assert.equal(r.start, 4);
  assert.equal(r.end, 5.5);
  assert.equal(A.timeOf(ctx.doc, 'doors - 0.5'), 1.5);
  assert.equal(A.timeOf(ctx.doc, '3.25'), 3.25);
  await assert.rejects(reg.run('animate', { target: 'Roof', property: 'position', by: [1, 0, 0], start: 'walls' }), /No marker "walls".*Doors, roof/);
  await reg.run('add_marker', { name: 'roof', time: 6 }); // same name moves it
  assert.equal(ctx.doc.animation.markers.length, 2);
  await reg.run('remove_marker', { name: 'DOORS' });
  assert.deepEqual(ctx.doc.animation.markers, [{ name: 'roof', t: 6 }]);
});

test('captions: timing, defaults by style, removal', async () => {
  const { ctx, reg } = makeCtx();
  const c = await reg.run('add_caption', { text: 'Phase 1: foundations', start: 1, duration: 2.5 });
  assert.deepEqual([c.start, c.end, c.style, c.position], [1, 3.5, 'caption', 'bottom-left']);
  const t = await reg.run('add_caption', { text: 'Site office', style: 'title', start: 12, end: 15 });
  assert.equal(t.position, 'center');
  assert.equal(ctx.doc.animation.duration, 15); // the timeline grew to show it
  await assert.rejects(reg.run('add_caption', { text: 'x', start: 3, end: 2 }), /end after/);
  await reg.run('remove_caption', { id: 'Site office' });
  assert.deepEqual(ctx.doc.animation.captions.map((x) => x.id), [c.id]);
});

test('procedural motions add to keyframes and hold after they end', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Fan', position: [2, 0, 0] });
  await reg.run('add_motion', { target: 'Fan', type: 'spin', speed: 90, start: 1, end: 3 });
  assert.equal(A.evaluate(ctx.doc, 0.5).e1?.rotation, undefined); // not started yet
  near(A.evaluate(ctx.doc, 2).e1.rotation[1], 90);
  near(A.evaluate(ctx.doc, 10).e1.rotation[1], 180); // holds after end
  await reg.run('animate', { target: 'Fan', property: 'position', by: [0, 4, 0], start: 0, end: 4, ease: 'linear' });
  await reg.run('add_motion', { target: 'Fan', type: 'oscillate', axis: 'x', amplitude: 0.5, frequency: 0.25 });
  const p = A.evaluate(ctx.doc, 1).e1.position;
  nearArr(p, [2.5, 1, 0]); // sin(π/2) on top of the keyed rise
  await reg.run('add_motion', { target: 'Fan', type: 'pulse', amplitude: 0.2, frequency: 0.25 });
  nearArr(A.evaluate(ctx.doc, 1).e1.scale, [1.2, 1.2, 1.2]);
  const w = await reg.run('add_motion', { target: 'Fan', type: 'wiggle', amplitude: 0.1, start: 0 });
  near(A.evaluate(ctx.doc, 0).e1.position[2], 0); // wiggles fade in: no jump
  const z = [0.5, 1.3, 2.1].map((t) => A.evaluate(ctx.doc, t).e1.position[2]);
  assert.ok(z.every((v) => Math.abs(v) <= 0.1 + 1e-9) && new Set(z.map((v) => v.toFixed(4))).size === 3);
  await reg.run('remove_motion', { id: w.id });
  await reg.run('add_motion', { target: 'camera', type: 'orbit', speed: 90 });
  const cam0 = ctx.doc.camera;
  const r0 = Math.hypot(cam0.position[0] - cam0.target[0], cam0.position[2] - cam0.target[2]);
  const c1 = A.evaluate(ctx.doc, 1).camera.position;
  near(Math.hypot(c1[0] - cam0.target[0], c1[2] - cam0.target[2]), r0, 1e-6); // circles its target
  await reg.run('remove_motion', { id: 'Fan' });
  assert.deepEqual(ctx.doc.animation.motions.map((m) => m.target), ['camera']);
  await reg.run('delete', { ids: ['Fan'] });
  assert.ok(ctx.doc.animation.motions.every((m) => m.target !== 'e1'));
});

test('explode: static moves parts out from the centre; out-in animates and comes back', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [-1, 0, 0], name: 'L' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [1, 0, 0], name: 'R' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [0, 1, 0], name: 'Top' });
  const g = await reg.run('group', { ids: ['L', 'R', 'Top'], name: 'Kit' });
  await reg.run('explode', { ids: [g.id], mode: 'static', factor: 1, axes: 'x' });
  near((await reg.run('bounds_of', { ids: ['L'] })).center[0], -2);
  near((await reg.run('bounds_of', { ids: ['R'] })).center[0], 2);
  near((await reg.run('bounds_of', { ids: ['Top'] })).center[1], 1.5); // y not allowed: stays
  ctx.store.undo();
  const r = await reg.run('explode', { ids: ['L', 'R', 'Top'], mode: 'out-in', start: 1, duration: 1, hold: 2 });
  assert.equal(r.end, 5);
  const L = ctx.doc.entities.find((e) => e.name === 'L');
  const at = (t) => A.evaluate(ctx.doc, t)[L.id].position;
  nearArr(at(1), L.position);
  assert.ok(at(2.5)[0] < L.position[0] - 0.5);
  nearArr(at(5), L.position);
});

test('animate along a path: keys follow the curve, heading turns with it', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_curve', { points: [[0, 0, 0], [10, 0, 0], [10, 0, -10]], name: 'Haul road' });
  await reg.run('create_box', { width: 4, height: 2, depth: 2, name: 'Truck' });
  const r = await reg.run('animate_along_path', { target: 'Truck', path: 'Haul road', start: 0, end: 10, ease: 'linear', keys: 20 });
  assert.equal(r.keys, 21);
  near(r.length, 20);
  const id = ctx.doc.entities.find((e) => e.name === 'Truck').id;
  const pose = (t) => A.evaluate(ctx.doc, t)[id];
  nearArr(pose(2.5).position, [5, 0, 0]);
  near(pose(2.5).rotation[1], 0); // heading +x
  nearArr(pose(7.5).position, [10, 0, -5]);
  near(pose(7.5).rotation[1], 90); // turned left to head -z
  await reg.run('animate_along_path', { target: 'camera', path: [[0, 2, 10], [0, 2, 0]], start: 0, end: 4, ease: 'linear', look_ahead: 2 });
  const cam = A.evaluate(ctx.doc, 2).camera;
  nearArr(cam.position, [0, 2, 5]);
  nearArr(cam.target, [0, 2, 3]);
  await assert.rejects(reg.run('animate_along_path', { target: 'Truck', path: 'Truck' }), /not a curve/);
});

test('stagger: shifts each animated entity by delta in the chosen order', async () => {
  const { ctx, reg } = makeCtx();
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [0, (3 - i) * 2, 0], name: `Floor ${4 - i}` })).id);
  for (const id of ids) await reg.run('animate', { target: id, property: 'opacity', from: 0, to: 1, start: 0, end: 1 });
  const r = await reg.run('stagger', { ids, delta: 0.5, order: 'height' });
  assert.deepEqual(r.order, ['Floor 1', 'Floor 2', 'Floor 3', 'Floor 4']);
  const firstKey = (name) => ctx.doc.animation.tracks.find((t) => t.target === ctx.doc.entities.find((e) => e.name === name).id).keys[0].t;
  assert.deepEqual(['Floor 1', 'Floor 2', 'Floor 3', 'Floor 4'].map(firstKey), [0, 0.5, 1, 1.5]);
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Still' });
  await assert.rejects(reg.run('stagger', { ids: ['Still'] }), /None of them is animated/);
});
