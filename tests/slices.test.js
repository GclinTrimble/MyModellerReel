// Slices (#292): slices.js maths and the slice commands on synthetic scans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SL from '../src/core/slices.js';
import * as G from '../src/core/geometry.js';
import * as D from '../src/core/document.js';
import * as Assets from '../src/core/assets.js';
import { siteScan, BUILDINGS, ground } from '../scripts/slice-scan.mjs';
import { makeCtx, near, nearArr } from './helpers.js';

/** A point cloud entity from model [x, y, z, …] positions. */
const cloud = (doc, pos, name = 'Scan') => D.addEntity(doc, { type: 'pointcloud', name, pointcloud: { asset: Assets.put(new Uint8Array(Float32Array.from(pos).buffer), { mime: 'application/x-mmr-points' }), count: pos.length / 3, colors: false }, material: { color: '#7a8a96' } });

/** 10 × 5 columns 1 m apart, each with points at 0, 1.15, 1.2, 1.25 and 2.5 m: a level slab at 1.2 holds 150. */
function columns() {
  const pos = [];
  for (let x = 0; x < 10; x++) for (let z = 0; z < 5; z++) for (const y of [0, 1.15, 1.2, 1.25, 2.5]) pos.push(x, y, z);
  return pos;
}

test('frames: a level slab looks down with north up, an upright one keeps up, a line runs left to right', () => {
  const lv = SL.frame({ kind: 'slab', point: [0, 1, 0], normal: [0, 1, 0] });
  assert.deepEqual([lv.u, lv.v], [[1, 0, 0], [0, 0, -1]]);
  const s = { kind: 'slab', ...SL.alongLine([0, 0, 0], [10, 0, 0]) };
  const f = SL.frame(s);
  nearArr(f.u, [1, 0, 0]);
  nearArr(f.v, [0, 1, 0]);
  nearArr(s.point, [5, 0, 0]);
  nearArr(SL.to2d(f, [8, 2, 0.05]), [3, 2]);
  nearArr(SL.to3d(f, [3, 2]), [8, 2, 0]);
  assert.throws(() => SL.alongLine([1, 0, 1], [1, 5, 1]), /one vertical/);
  // across a road heading east: seen looking ahead, so right of the road (south, +z) is right in the view
  const path = [[0, 0, 0, 0], [100, 0, 0, 100]];
  const x = SL.atStation(path, 40);
  nearArr(x.point, [40, 0, 0]);
  nearArr(SL.frame({ kind: 'slab', ...x }).u, [0, 0, 1]);
  const al = SL.atStation(path, 40, { along: true });
  nearArr(SL.frame({ kind: 'slab', ...al }).u, [1, 0, 0], 1e-6);
  assert.throws(() => SL.atStation(path, 120), /runs from station 0 to 100/);
  // stepping keeps the camera where it stands relative to the slab: 20 m further along
  const cam = SL.carry({ kind: 'slab', ...x }, { kind: 'slab', ...SL.atStation(path, 60) }, { position: [30, 2, 1], target: [40, 1, 1] });
  assert.deepEqual(cam, { position: [50, 2, 1], target: [60, 1, 1] });
  assert.deepEqual(SL.seriesValues(0, 12, 3), [0, 3, 6, 9, 12]);
  assert.deepEqual(SL.seriesValues(0, 50, 20), [0, 20, 40]);
  assert.throws(() => SL.seriesValues(0, 1000, 1), /200 at most/);
  assert.equal(SL.stepIndex(4, 1, 5), 4);
  assert.equal(SL.stepIndex(0, -1, 5), 0);
});

test('pointsInClip and stats match a hand count', () => {
  const { ctx } = makeCtx();
  const e = cloud(ctx.doc, columns());
  const slab = { kind: 'slab', point: [4.5, 1.2, 2], normal: [0, 1, 0], thickness: 0.2 };
  const r = SL.pointsInClip(e, slab);
  assert.equal(r.count, 150);
  const st = SL.stats(slab, r.points);
  assert.equal(st.count, 150);
  assert.deepEqual(st.bounds, { min: [-4.5, -2], max: [4.5, 2] });
  assert.equal(st.area, 36);
  near(st.density, 150 / 36, 1e-3);
  assert.deepEqual(st.histogram.counts, [0, 0, 50, 0, 0, 50, 0, 50, 0, 0]);
  near(st.histogram.from, 1.1);
  // a sample: every k-th point, the whole count kept, the histogram scaled back
  const s = SL.pointsInClip(e, slab, { max: 30 });
  assert.equal(s.count, 150);
  assert.equal(s.points.length, 90);
  const ss = SL.stats(slab, s.points, { count: s.count });
  assert.equal(ss.sampled, 30);
  assert.equal(ss.histogram.counts.reduce((a, b) => a + b), 150);
  // a moved entity: world positions
  e.position = [0, 100, 0]; // a level slab is endless across: lift the cloud
  assert.equal(SL.pointsInClip(e, slab, { matrix: D.worldMatrix(ctx.doc, e).elements }).count, 0);
  assert.equal(SL.pointsInClip(e, { ...slab, point: [4.5, 101.2, 2] }, { matrix: D.worldMatrix(ctx.doc, e).elements }).count, 150);
  // upright across x = 3: one column row of 5 × 5
  assert.equal(SL.pointsInClip({ ...e, position: [0, 0, 0] }, { kind: 'slab', point: [3, 0, 0], normal: [1, 0, 0], thickness: 0.2 }).count, 25);
  assert.equal(SL.pointsInClip(e, null).count, 250);
});

test('add_slice, slice_points, view_clip and a scene through the registry', async () => {
  const { reg, ctx } = makeCtx();
  cloud(ctx.doc, columns());
  const r = await reg.run('add_slice', { at: 'elevation', z: 1.2, thickness: 0.2 });
  assert.equal(r.clip.name, 'Slice 1');
  assert.equal(r.clip.kind, 'slab');
  assert.equal(r.stats.count, 150);
  assert.deepEqual(r.stats.histogram.counts, [0, 0, 50, 0, 0, 50, 0, 50, 0, 0]);
  // above: ground: the low points are at 0, so 1.2 above them is the same slab
  const g = await reg.run('add_slice', { at: 'elevation', z: 1.2, above: 'ground', name: 'Above ground' });
  near(g.clip.point[1], 1.2);
  assert.equal(g.stats.count, 150);
  const p = await reg.run('slice_points', { name: 'Slice 1', max: 20 });
  assert.equal(p.points.length, 20);
  assert.ok(p.points.every(([u, v]) => Math.abs(u) <= 4.5 && Math.abs(v) <= 2));
  const kept = await reg.run('slice_points', { name: 'Slice 1', store: true });
  assert.equal(kept.stored, 150);
  const pts = D.getEntity(ctx.doc, kept.id);
  assert.equal(pts.type, 'pointcloud');
  const flat = SL.previewPositions(pts);
  assert.ok([...flat].filter((_, i) => i % 3 === 1).every((y) => Math.abs(y - 1.2) < 1e-5), 'flattened onto the slab middle');
  // no viewport: view_clip still says where the camera goes, and sets pane 2 to a parallel view of the slice
  const v = await reg.run('view_clip', { name: 'Slice 1', pane: 2 });
  nearArr(v.camera.target, [4.5, 1.2, 2]);
  assert.ok(v.camera.position[1] > 5);
  const L = ctx.doc.settings.layout;
  assert.equal(L.count, 2);
  assert.equal(L.panes[1].projection, 'parallel');
  assert.equal(L.panes[1].slice, 'Slice 1');
  await assert.rejects(reg.run('view_clip', { name: 'Nope' }), /No clip "Nope"/);
  // a scene keeps the clips that cut; going back turns later ones off and brings the slice back
  await reg.run('add_scene', { name: 'Level 1 slice' });
  await reg.run('set_clip', { name: 'Slice 1', enabled: false });
  await reg.run('add_clip', { kind: 'box', center: [0, 0, 0], size: [2, 2, 2] });
  await reg.run('go_to_scene', { name: 'Level 1 slice' });
  const clips = Object.fromEntries((await reg.run('list_clips')).clips.map((c) => [c.name, c.enabled !== false]));
  assert.deepEqual(clips, { 'Slice 1': true, 'Above ground': true, 'Box 1': false });
  // the sweep: keys on clip:<name> point, from the bottom of the model to its top along the normal
  const sw = await reg.run('animate_section', { clip: 'Slice 1', start: 0, end: 4 });
  near(sw.from[1], 0);
  near(sw.to[1], 2.5);
  assert.ok(ctx.doc.animation.tracks.some((t) => t.target === 'clip:Slice 1' && t.property === 'point' && t.keys.length === 2));
});

test('a scan of two buildings and a road: the wall rings at 1.2 m above ground, cross-sections every 20 m', async () => {
  const { reg, ctx } = makeCtx();
  const s = siteScan();
  const pos = new Float32Array(s.xyz.length);
  for (let i = 0; i < s.count; i++) (pos[i * 3] = s.xyz[i * 3]), (pos[i * 3 + 1] = s.xyz[i * 3 + 2]), (pos[i * 3 + 2] = -s.xyz[i * 3 + 1]); // x east, y up, z south
  cloud(ctx.doc, pos, 'Site scan');
  const r = await reg.run('add_slice', { at: 'elevation', z: 1.2, above: 'ground', thickness: 0.2 });
  near(r.clip.point[1], ground(0, 0) + 1.2, 0.15);
  assert.ok(r.stats.count > 1000, `${r.stats.count} wall points`);
  const { points, frame } = await reg.run('slice_points', { name: 'Slice 1', max: 1e6 });
  assert.equal(points.length, r.stats.count);
  const onWall = (b, [x, y]) => {
    const [dx, dy] = [Math.abs(x - b.cx) - b.w / 2, Math.abs(y - b.cy) - b.d / 2];
    return Math.max(dx, dy) <= 0.05 && Math.max(dx, dy) >= -0.05;
  };
  const hits = BUILDINGS.map(() => 0);
  for (const [u, v] of points) {
    const w = SL.to3d(frame, [u, v]);
    const i = BUILDINGS.findIndex((b) => onWall(b, [w[0], -w[2]]));
    assert.ok(i >= 0, `a slice point off the walls at ${w}`);
    hits[i]++;
  }
  assert.ok(hits.every((n) => n > 400), `both rings: ${hits}`);
  // the road: an alignment along its centre, a cross-section at 120 square to it, a series every 20 m
  await reg.run('create_alignment', { name: 'Main road', points: [[-60, 25], [60, 15]] });
  const x = await reg.run('add_slice', { at: 'station', alignment: 'Main road', station: 60, thickness: 0.5 });
  const t = G.norm([120, 0, -10]);
  near(Math.abs(G.dot(x.clip.normal, t)), 1, 1e-4);
  assert.ok(x.stats.count > 50 && x.stats.width > 70, `across the site: ${x.stats.count} points, ${x.stats.width} m`);
  await reg.run('delete_clip', { name: 'Slice 1' });
  await reg.run('delete_clip', { name: 'Slice 2' });
  const series = await reg.run('slice_series', { at: 'station', alignment: 'Main road', from: 0, to: 120, step: 20 });
  assert.deepEqual(series.slices.map((c) => c.station), [0, 20, 40, 60, 80, 100, 120]);
  assert.equal(series.active, 'Station 0');
  const on = async () => (await reg.run('list_clips')).clips.filter((c) => c.enabled !== false).map((c) => c.name);
  assert.deepEqual(await on(), ['Station 0']);
  const st = await reg.run('step_slice', { by: 1 });
  assert.equal(st.name, 'Station 20');
  assert.ok(st.stats.count > 0);
  assert.deepEqual(await on(), ['Station 20']);
  await reg.run('step_slice', { by: -5 });
  assert.deepEqual(await on(), ['Station 0']);
  await reg.run('step_slice', { index: 6 });
  assert.deepEqual(await on(), ['Station 120']);
  // levels from 0 to 6 m above ground every 3 m: a second series
  const lv = await reg.run('slice_series', { at: 'elevation', above: 'ground', from: 0.5, to: 6.5, step: 3, name: 'Floor' });
  assert.deepEqual(lv.slices.map((c) => c.name), ['Floor 0.5', 'Floor 3.5', 'Floor 6.5']);
  assert.equal((await reg.run('step_slice', { series: 'Floor' })).name, 'Floor 3.5');
  await assert.rejects(reg.run('step_slice', { series: 'Roofs' }), /No slice series "Roofs"/);
});
