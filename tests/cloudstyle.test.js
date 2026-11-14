// Point cloud display (#295–#297): class table, ramps, ranges, style per pane, the filter predicate, and the
// commands over a synthetic street scan with intensity, classes and returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as CS from '../src/core/cloudstyle.js';
import * as D from '../src/core/document.js';
import * as Assets from '../src/core/assets.js';
import { streetScan } from './fixtures/streetscan.js';

test('class table, ramps and the class / ramp textures', () => {
  assert.equal(CS.className(2), 'Ground');
  assert.equal(CS.className(6), 'Building');
  assert.equal(CS.className(70), 'User class 70');
  assert.equal(CS.classColor(6, { 6: '#000000' }), '#000000');
  assert.deepEqual(CS.sampleRamp('grey', 0), [0, 0, 0]);
  assert.deepEqual(CS.sampleRamp('grey', 1), [1, 1, 1]);
  near(CS.sampleRamp(['#000000', '#ffffff'], 0.25)[0], 0.25, 1e-9);
  near(CS.sampleRamp(['#ff0000', '#00ff00', '#0000ff'], 0.5)[1], 1, 1e-9, 'three stops: the middle one at 0.5');
  assert.equal(CS.rampBytes('viridis').length, 1024);
  const lut = CS.classBytes({}, [3, 4, 5]);
  assert.equal(lut[2 * 4 + 3], 255, 'ground shown');
  assert.equal(lut[5 * 4 + 3], 0, 'high vegetation hidden');
  assert.deepEqual([...lut.subarray(6 * 4, 6 * 4 + 3)], [0xe0, 0x53, 0x3d], 'building in its ASPRS colour');
  assert.equal(CS.rampFor({ color_by: 'intensity' }), 'grey');
  assert.equal(CS.rampFor({ color_by: 'depth' }), 'warm_cool');
});

test('percentile range ignores the outliers', () => {
  const v = Array.from({ length: 1000 }, (_, i) => i);
  v.push(1e6);
  const [lo, hi] = CS.percentileRange(v);
  assert.ok(lo < 40 && hi < 1100, `${lo} ${hi}`);
  assert.deepEqual(CS.percentileRange([5, 5, 5]), [5, 5]);
});

test('passes(): classes, heights, intensity, returns, time, source, density, spacing', () => {
  const p = { index: 3, y: 2, hag: 0.5, classification: 5, intensity: 30000, returnNumber: 1, numberOfReturns: 2, gpsTime: 12, pointSource: 2, spacing: 0.08 };
  assert.ok(CS.passes(p, {}));
  assert.ok(!CS.passes(p, { hide: [3, 4, 5] }));
  assert.ok(CS.passes(p, { hide: [2] }));
  assert.ok(!CS.passes(p, { elevation: [3, 9] }));
  assert.ok(CS.passes(p, { elevation: [0, 1], above_ground: true }), 'half a metre above the ground');
  assert.ok(!CS.passes(p, { intensity: [0, 20000] }));
  assert.ok(CS.passes(p, { returns: 'first' }));
  assert.ok(!CS.passes(p, { returns: 'last' }));
  assert.ok(!CS.passes(p, { returns: 'only' }));
  assert.ok(!CS.passes(p, { time: [0, 10] }));
  assert.ok(!CS.passes(p, { source: [1] }));
  assert.ok(!CS.passes(p, { spacing: 0.1 }));
  assert.ok(CS.passes({ index: 1 }, { hide: [2], intensity: [0, 1], returns: 'last' }), 'absent attributes pass');
  // density: a stable quarter
  let n = 0;
  for (let i = 0; i < 20000; i++) n += CS.passes({ index: i }, { density: 25 }) ? 1 : 0;
  near(n / 20000, 0.25, 0.02);
  assert.equal(CS.passes({ index: 77 }, { density: 25 }), CS.passes({ index: 77 }, { density: 25 }));
});

test('spacing ranks and heights above the ground', () => {
  // 100 points 1 cm apart on a line: at 4 cm, about one in four is left
  const pos = new Float32Array(300);
  for (let i = 0; i < 100; i++) pos[i * 3] = i * 0.01 + 0.001;
  const r = CS.spacingRanks(pos, 100);
  const kept = [...r].filter((s) => s >= 0.04).length;
  assert.ok(kept >= 20 && kept <= 30, `${kept}`);
  const g = new Float32Array([0, 0, 0, 0.5, 3, 0.5, 5, 1, 5]);
  const hag = CS.heightAboveGround(g, 3, Uint8Array.from([2, 5, 2]));
  near(hag[1], 3, 1e-6);
  near(hag[0], 0, 1e-6);
});

test('style and filter per pane; merge clears with null', () => {
  const e = { pointcloud: { colors: true, attributes: { intensity: true }, style: { color_by: 'rgb', panes: { 2: { color_by: 'intensity' } } } }, material: { color: '#777777' } };
  assert.equal(CS.styleOf(e, 1).color_by, 'rgb');
  assert.equal(CS.styleOf(e, 2).color_by, 'intensity');
  assert.equal(CS.styleOf({ pointcloud: { attributes: { classification: true } } }).color_by, 'classification', 'no rgb: classes when there are some');
  const s = CS.merge({ size: 3, shape: 'round' }, { shape: null }, 1);
  assert.deepEqual(s, { size: 3 });
  const f = CS.merge({}, { hide: [2] }, 3);
  assert.deepEqual(CS.filterOf({ pointcloud: { filter: f } }, 3), { hide: [2] });
  assert.deepEqual(CS.filterOf({ pointcloud: { filter: f } }, 1), {});
  const L = CS.legend({ color_by: 'intensity' }, [100, 40000]);
  assert.equal(L.kind, 'ramp');
  assert.equal(L.high, '40000');
  assert.equal(CS.legend({ color_by: 'classification' }, [0, 1], [{ code: 2, name: 'Ground', visible: true }]).items[0].color, '#a0703c');
});

async function scanCtx() {
  const { reg, ctx } = makeCtx();
  const scan = streetScan();
  ctx.io = { readBinary: async () => scan.bytes };
  await reg.run('set_base_point', { n: 5400000, e: 650000, z: 100 });
  const r = await reg.run('import_point_cloud', { path: 'C:/scans/street.las' });
  return { reg, ctx, scan, r };
}

test('the preview keeps intensity, classes, returns, time and source; old layouts still load', async () => {
  const { ctx, scan, r } = await scanCtx();
  const e = D.getEntity(ctx.doc, r.id);
  assert.equal(r.points, scan.total);
  assert.equal(e.pointcloud.layout, 2);
  assert.deepEqual(Object.keys(e.pointcloud.attributes).sort(), ['classification', 'intensity', 'returns', 'source', 'time', 'time0']);
  const d = CS.decodePreview(e.pointcloud, Assets.bytes(e.pointcloud.asset));
  assert.equal(d.classification.length, scan.total);
  assert.ok(d.intensity.some((v) => v > 35000), 'bright lane markings');
  assert.ok(d.gpsTime[0] >= 0 && d.gpsTime[0] < 200, 'times after the first point');
  // a layout 1 asset (xyz + rgb only) decodes as before
  const old = CS.decodePreview({ count: 1, colors: true }, new Uint8Array([...new Uint8Array(new Float32Array([1, 2, 3]).buffer), 9, 8, 7]));
  assert.deepEqual([...old.position], [1, 2, 3]);
  assert.deepEqual([...old.rgb], [9, 8, 7]);
  assert.equal(old.intensity, undefined);
});

test('set_cloud_style: modes, ranges, per pane, checks', async () => {
  const { reg, r } = await scanCtx();
  const s = await reg.run('set_cloud_style', { id: r.id, color_by: 'intensity' });
  assert.ok(s.range[1] > 20000 && s.range[0] < 15000, `auto 2–98 % range ${s.range}`);
  const el = await reg.run('set_cloud_style', { id: r.id, color_by: 'elevation', ramp: 'terrain' });
  assert.ok(el.range[0] < -0.5 && el.range[1] > 10, 'from the ditch to the roofs');
  const p2 = await reg.run('set_cloud_style', { id: r.id, pane: 2, color_by: 'rgb', size_mode: 'attenuated', size: 0.03, shape: 'paraboloid', edl: true, depth: 'xray' });
  assert.equal(p2.style.color_by, 'rgb');
  assert.equal((await reg.run('set_cloud_style', { id: r.id })).style.color_by, 'elevation', 'pane 1 keeps its own');
  await assert.rejects(reg.run('set_cloud_style', { id: r.id, ramp: 'rainbow' }), /No ramp/);
  await assert.rejects(reg.run('set_cloud_style', { id: r.id, range: [5, 1] }), /range/);
  await assert.rejects(reg.run('set_cloud_style', { id: r.id, color_by: 'nothing' }));
});

test('set_cloud_filter and list_cloud_classes: vegetation, returns, intensity, density, per pane', async () => {
  const { reg, scan, r } = await scanCtx();
  const c = await reg.run('list_cloud_classes', { id: r.id });
  assert.deepEqual(Object.fromEntries(c.classes.map((x) => [x.code, x.count])), Object.fromEntries(Object.entries(scan.counts).map(([k, v]) => [+k, v])), 'counts match the ground truth');
  const veg = scan.counts[3] + scan.counts[4] + scan.counts[5];
  const f = await reg.run('set_cloud_filter', { id: r.id, classes: { hide: [3, 4, 5] } });
  assert.equal(f.shown, scan.total - veg);
  assert.equal((await reg.run('list_cloud_classes', { id: r.id })).classes.find((x) => x.code === 5).visible, false);
  const only = await reg.run('set_cloud_filter', { id: r.id, classes: { show: [2] } });
  assert.equal(only.shown, scan.counts[2]);
  await reg.run('set_cloud_filter', { id: r.id, classes: { show: 'all' } });
  assert.equal((await reg.run('set_cloud_filter', { id: r.id, returns: 'last' })).shown, scan.last);
  await reg.run('set_cloud_filter', { id: r.id, returns: 'all' });
  const band = await reg.run('set_cloud_filter', { id: r.id, intensity: [35000, 65535] });
  near(band.shown, scan.markings, scan.markings * 0.1, 'only the markings');
  await reg.run('set_cloud_filter', { id: r.id, intensity: null });
  const q = await reg.run('set_cloud_filter', { id: r.id, density: 25 });
  near(q.shown / scan.total, 0.25, 0.02);
  await reg.run('set_cloud_filter', { id: r.id, density: null });
  // the plan pane ground only, the 3D pane everything
  const g = await reg.run('set_cloud_filter', { id: r.id, pane: 2, classes: { show: [2, 11] } });
  assert.equal(g.shown, scan.counts[2] + scan.counts[11]);
  assert.equal((await reg.run('list_cloud_classes', { id: r.id })).shown, scan.total);
  // analysis uses what is shown, narrowed by classes
  const s = await reg.run('classify_ground', { id: r.id, classes: [2, 11], cell: 1 });
  assert.ok(s.ground_points > 500);
  assert.equal(s.of, scan.counts[2] + scan.counts[11]);
});
