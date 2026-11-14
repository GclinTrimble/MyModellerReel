// Clip volumes (#290, #291): the pure maths in clip.js and the commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CV from '../src/core/clip.js';
import { newDoc } from '../src/core/document.js';
import { makeCtx, near, nearArr } from './helpers.js';

test('a box rotated 30° about Y cuts along its own faces', () => {
  const b = CV.normalize({ kind: 'box', center: [0, 0, 0], size: [4, 2, 2], rotation: [0, 30, 0] });
  const x = [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6)]; // its local X
  assert.ok(CV.inside(b, x.map((v) => v * 1.9)), 'along its X, inside to 2 m');
  assert.ok(!CV.inside(b, x.map((v) => v * 2.1)));
  // world [1.9, 0, 0] in local: x = 1.9·cos30 = 1.65, z = 1.9·sin30 = 0.95: inside
  assert.ok(CV.inside(b, [1.9, 0, 0]));
  assert.ok(!CV.inside(b, [0, 0, 1 / Math.cos(Math.PI / 6) + 0.01]), 'world Z: local z = z·cos30 leaves at 1.155 m');
  assert.ok(CV.inside(b, [0, 0, 1 / Math.cos(Math.PI / 6) - 0.01]));
  const planes = CV.planesOf(b);
  assert.equal(planes.length, 6);
  const px = planes.find((p) => p.face === '+x');
  nearArr(px.normal, x);
  nearArr(px.point, x.map((v) => v * 2));
  const outside = CV.normalize({ ...b, keep: 'outside' });
  assert.ok(!CV.inside(outside, [0, 0, 0]));
  assert.ok(CV.inside(outside, [5, 0, 0]));
});

test('planes cut their normal side, slabs keep between two planes', () => {
  const p = CV.normalize({ kind: 'plane', point: [0, 1, 0], normal: [0, 2, 0] });
  assert.deepEqual(p.normal, [0, 1, 0]);
  assert.ok(CV.inside(p, [0, 0.5, 0]));
  assert.ok(!CV.inside(p, [0, 1.5, 0]));
  const s = CV.normalize({ kind: 'slab', point: [0, 2, 0], normal: [0, 1, 0], thickness: 1 });
  assert.ok(CV.inside(s, [3, 2.4, 0]));
  assert.ok(!CV.inside(s, [3, 2.6, 0]));
  assert.deepEqual(CV.planesOf(s).map((q) => q.point[1]), [2.5, 1.5]);
  assert.throws(() => CV.normalize({ kind: 'cone' }), /kind must be/);
});

test('visible combines: inside boxes by any / all, planes and outside boxes always cut, scope and panes', () => {
  const doc = newDoc();
  doc.clips = [
    { name: 'A', kind: 'box', center: [0, 0, 0], size: [2, 2, 2] },
    { name: 'B', kind: 'box', center: [1.5, 0, 0], size: [2, 2, 2] },
  ];
  assert.ok(CV.visible(doc, [-0.8, 0, 0]), 'any: in A only');
  assert.ok(CV.visible(doc, [2.2, 0, 0]), 'any: in B only');
  assert.ok(!CV.visible(doc, [5, 0, 0]));
  doc.settings.clip_combine = 'all';
  assert.ok(!CV.visible(doc, [-0.8, 0, 0]));
  assert.ok(CV.visible(doc, [0.8, 0, 0]), 'all: the overlap');
  doc.settings.clip_combine = 'any';
  doc.clips.push({ name: 'Cut', kind: 'plane', point: [0, 0.5, 0], normal: [0, 1, 0] });
  assert.ok(!CV.visible(doc, [2.2, 0.7, 0]), 'the plane cuts both boxes');
  assert.ok(CV.visible(doc, [2.2, 0.3, 0]));
  doc.clips = [{ name: 'P2', kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0], panes: [2] }];
  assert.ok(CV.visible(doc, [0, 1, 0], { pane: 1 }));
  assert.ok(!CV.visible(doc, [0, 1, 0], { pane: 2 }));
  const e = { id: 'e1', name: 'Culvert', tag: 'Drainage' };
  doc.entities.push(e, { id: 'e2', name: 'Road', tag: 'Road' });
  doc.clips = [{ name: 'Only', kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0], ids: ['e1'] }];
  assert.ok(!CV.visible(doc, [0, 1, 0], { entity: e }));
  assert.ok(CV.visible(doc, [0, 1, 0], { entity: doc.entities[1] }));
  doc.clips[0] = { ...doc.clips[0], ids: undefined, layers: ['Road'] };
  assert.ok(!CV.visible(doc, [0, 1, 0], { entity: doc.entities[1] }));
  doc.clips[0].enabled = false;
  assert.ok(CV.visible(doc, [0, 1, 0], { entity: doc.entities[1] }));
});

test('slots and masks for the shader', () => {
  const doc = newDoc();
  doc.entities.push({ id: 'e1', name: 'X', tag: 'Untagged' });
  doc.clips = [
    { name: 'P', kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0] },
    { name: 'S', kind: 'slab', point: [0, 0, 0], normal: [0, 1, 0], thickness: 1, panes: [2] },
    { name: 'B', kind: 'box', center: [0, 0, 0], size: [1, 1, 1], ids: ['e9'] },
  ];
  const sl = CV.slots(doc);
  assert.deepEqual([sl.bit.get('P'), sl.bit.get('S'), sl.bit.get('B')], [0, 8, 12]);
  assert.equal(CV.paneMask(sl, 1), (1 << 0) | (1 << 12));
  assert.equal(CV.paneMask(sl, 2), (1 << 0) | (1 << 8) | (1 << 12));
  assert.equal(CV.scopeMask(doc, sl, doc.entities[0]) & (1 << 12), 0, 'B does not cut e1');
});

test('older files: section planes become plane clips, once, with the same cut', () => {
  const doc = newDoc();
  doc.settings.section_planes = [{ name: 'Long', normal: [1, 0, 0], point: [0, 0, 0] }, { name: 'Cross', normal: [0, 0, 1], point: [0, 0, 2] }];
  doc.settings.section_active = 'Cross';
  doc.settings.section = { normal: [0, 0, 1], point: [0, 0, 2] };
  assert.equal(CV.clipsOf(doc).length, 2, 'read without changing the file');
  assert.equal(doc.clips, undefined);
  CV.migrate(doc);
  assert.deepEqual(doc.clips.map((c) => [c.name, c.kind, c.enabled]), [['Long', 'plane', false], ['Cross', 'plane', true]]);
  assert.equal(doc.settings.section_planes, undefined);
  const old = newDoc();
  old.settings.section = { normal: [0, -1, 0], point: [0, 1, 0] };
  CV.migrate(old);
  assert.deepEqual(old.clips[0].point, [0, 1, 0]);
  assert.equal(old.settings.section_active, 'Section 1');
});

test('section fill: a box fills each face where it cuts a solid, clipped to the face', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 4, depth: 4, height: 4, position: [0, 0, 0] });
  // a 2 m box over the top middle (y 3 to 5): its faces inside the solid get a fill
  const clip = CV.normalize({ kind: 'box', center: [0, 4, 0], size: [2, 2, 2] });
  const caps = CV.capLoops(ctx.doc, clip);
  const filled = caps.filter((f) => f.cuts.length);
  assert.deepEqual(filled.map((f) => f.face).sort(), ['+x', '+z', '-x', '-y', '-z'].sort(), 'not the top face (above the solid)');
  const area = (r) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2);
  near(area(filled.find((f) => f.face === '-y').cuts[0].areas[0].outer), 4, 1e-6);
  near(area(filled.find((f) => f.face === '+x').cuts[0].areas[0].outer), 2, 1e-6); // a side face: 2 × 1 m inside the solid
  const slab = CV.capLoops(ctx.doc, CV.normalize({ kind: 'slab', point: [0, 2, 0], normal: [0, 1, 0], thickness: 1 }));
  assert.equal(slab.filter((f) => f.cuts.length).length, 2, "a slab fills its two faces");
});

test('align and push / pull maths', () => {
  const b = CV.normalize({ kind: 'box', center: [0, 0, 0], size: [4, 2, 2] });
  const r = CV.align(b, 'points', { points: [[0, 0, 0], [3, 0, -3]] });
  near(r.rotation[1], 45);
  const turned = { ...b, ...r };
  nearArr(CV.axes(turned)[0], [Math.SQRT1_2, 0, -Math.SQRT1_2]);
  const lv = CV.align({ ...b, rotation: [10, 45, 5] }, 'level');
  near(lv.rotation[0], 0);
  const f = CV.align(b, 'face', { normal: [0, 0.2, 1] });
  const ax = CV.axes({ ...b, ...f });
  nearArr(ax[2], [0, 0.2, 1].map((v) => v / Math.hypot(0.2, 1)));
  const v = CV.align(b, 'view', { dir: [0, 0, -1] });
  nearArr(CV.axes({ ...b, ...v })[2], [0, 0, 1]);
  const p = CV.align(CV.normalize({ kind: 'plane', normal: [1, 0, 0] }), 'points', { points: [[0, 0, 0], [0, 0, 5]] });
  nearArr(p.normal, [-1, 0, 0].map((x) => -x));
  const top = CV.pushFace(b, '+y', -0.5);
  assert.deepEqual(top, { center: [0, -0.25, 0], size: [4, 1.5, 2] });
  const sym = CV.pushFace(b, '-x', 1, { symmetric: true });
  assert.deepEqual(sym, { center: [0, 0, 0], size: [6, 2, 2] });
  const slab = CV.normalize({ kind: 'slab', point: [0, 2, 0], normal: [0, 1, 0], thickness: 1 });
  assert.deepEqual(CV.pushFace(slab, '-n', 0.5), { point: [0, 1.75, 0], thickness: 1.5 });
  assert.deepEqual(CV.pushFace(slab, '+n', 0.5, { symmetric: true }), { point: [0, 2, 0], thickness: 2 });
  nearArr(CV.fitBox({ min: [0, 0, 0], max: [2, 4, 6] }, 1).size, [4, 6, 8]);
});

test('clip commands: add, set, list, delete, clear; each one undo step; section commands are planes', async () => {
  const { reg, ctx } = makeCtx();
  const culvert = await reg.run('create_box', { width: 2, depth: 6, height: 1.5, position: [10, 0, 0], name: 'Culvert' });
  await reg.run('create_box', { width: 8, depth: 30, height: 0.5, position: [0, 2, 0], name: 'Road' });
  ctx.selection.set([culvert.id]);
  const undo0 = ctx.store.undoStack.length;
  const r = await reg.run('add_clip', { kind: 'box', from: 'selection' });
  assert.equal(ctx.store.undoStack.length, undo0 + 1);
  assert.equal(r.clip.name, 'Box 1');
  nearArr(r.clip.center, [10, 0.75, 0]);
  nearArr(r.clip.size, [3, 2.5, 7]);
  let l = await reg.run('list_clips', {});
  assert.equal(l.clips[0].entities, 1, 'the culvert is inside, the road is not');
  assert.equal(l.clips[0].planes.length, 6);
  await reg.run('set_clip', { name: 'Box 1', keep: 'outside' });
  await reg.run('set_clip', { name: 'Box 1', grow: 0.5 });
  nearArr(ctx.doc.clips[0].size, [4, 3.5, 8]);
  await reg.run('set_clip', { name: 'Box 1', face: '+y', push: -1 });
  nearArr(ctx.doc.clips[0].size, [4, 2.5, 8]);
  await reg.run('add_clip', { kind: 'slab', point: [0, 1, 0], thickness: 2, panes: [2] });
  await reg.run('set_clip', { combine: 'all', name: 'Slab 1' });
  assert.equal(ctx.doc.settings.clip_combine, 'all');
  await reg.run('section', { normal: [1, 0, 0], point: [0, 0, 0], name: 'Long' });
  l = await reg.run('list_clips', {});
  assert.deepEqual(l.clips.map((c) => c.kind), ['box', 'slab', 'plane']);
  assert.equal((await reg.run('list_section_planes', {})).planes.length, 1);
  await reg.run('delete_clip', { name: 'Slab 1' });
  assert.equal(ctx.doc.clips.length, 2);
  await reg.run('align_clip', { name: 'Box 1', to: 'points', points: [[0, 0, 0], [5, 0, 5]] });
  near(ctx.doc.clips[0].rotation[1], -45);
  await reg.run('fit_clip', { name: 'Box 1', ids: ['Road'], margin: 0 });
  nearArr(ctx.doc.clips[0].size, [8, 0.5, 30]);
  ctx.store.undo();
  nearArr(ctx.doc.clips[0].size, [4, 2.5, 8]); // undo restores the box exactly
  await reg.run('clear_clips', {});
  assert.equal(ctx.doc.clips.length, 0);
  assert.equal(ctx.doc.settings.section, null);
  await assert.rejects(reg.run('set_clip', { name: 'Nope', enabled: false }), /No clip "Nope"/);
  for (let i = 0; i < 4; i++) await reg.run('add_clip', { kind: 'slab' });
  await assert.rejects(reg.run('add_clip', { kind: 'slab' }), /4 slabs/);
});

test('align_clip to two survey points of a wall: the box sides follow it, its faces push along the wall normal', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('add_points', { points: [{ name: 'W1', e: 0, n: 0, z: 0 }, { name: 'W2', e: 10, n: 7, z: 0 }] });
  await reg.run('add_clip', { kind: 'box', center: [5, 0, -3], size: [12, 4, 2] });
  await reg.run('align_clip', { name: 'Box 1', to: 'points', points: ['W1', 'W2'] });
  const c = CV.normalize(ctx.doc.clips[0]);
  const wall = [10, 0, -7].map((v) => v / Math.hypot(10, 7)); // north is −z
  const err = (Math.acos(Math.min(1, CV.axes(c)[0].reduce((s, v, k) => s + v * wall[k], 0))) * 180) / Math.PI;
  assert.ok(err < 0.1, String(err));
  const n = (await reg.run('list_clips', {})).clips[0].planes.find((p) => p.face === '+z').normal;
  near(n[0] * wall[0] + n[2] * wall[2], 0, 1e-3); // a side face: square to the wall
  await reg.run('set_clip', { name: 'Box 1', face: '+z', push: 1 });
  near(ctx.doc.clips[0].size[2], 3);
});

test('a clip animates: keys on clip:<name> size', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('add_clip', { kind: 'box', size: [2, 2, 2] });
  await reg.run('animate', { target: 'clip:Box 1', property: 'size', from: [2, 2, 2], to: [10, 4, 10], start: 0, end: 2 });
  const { evaluate } = await import('../src/core/animation.js');
  const pose = evaluate(ctx.doc, 2)['clip:Box 1'];
  assert.deepEqual(pose.size, [10, 4, 10]);
  assert.deepEqual(CV.withPose(ctx.doc.clips[0], pose).size, [10, 4, 10]);
  await assert.rejects(reg.run('animate', { target: 'clip:Nope', property: 'size', to: [1, 1, 1] }), /No clip "Nope"/);
});
