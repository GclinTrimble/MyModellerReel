// Plumb works with scans (#302): describe_cloud on the synthetic corridor scan, and every point cloud command's reply
// stays small enough for an AI (under 8 KB) however many slices and clips there are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCloud } from '../src/core/cloudstats.js';
import { makeCtx } from './helpers.js';
import { addScanCloud } from './fixtures/scancloud.js';
import { SITE } from './fixtures/scan.js';

test('describeCloud: bounds, classes, levels and wall bearings of simple shapes', () => {
  // a floor at 0 and a 3 m wall along x (bearing 90°) on a 10 × 10 m patch
  const pos = [];
  for (let x = 0; x < 10; x += 0.1) for (let z = 0; z < 10; z += 0.5) pos.push(x, 0, -z);
  for (let x = 0; x < 10; x += 0.1) for (let y = 0; y < 3; y += 0.1) pos.push(x, y, -5);
  const n = pos.length / 3;
  const cls = new Uint8Array(n).fill(2, 0, 2000).fill(6, 2000);
  const r = describeCloud({ count: n, position: Float32Array.from(pos), classification: cls }, { full: n * 2, base: [1000, 2000, 50] });
  assert.equal(r.points, n * 2);
  assert.deepEqual(r.bounds.project.min.map(Math.round), [1000, 2000, 50]);
  assert.deepEqual(r.bounds.project.max.map(Math.round), [1010, 2010, 53]);
  assert.deepEqual(r.classes.map((c) => c.name), ['Building', 'Ground']);
  assert.equal(r.levels[0].elevation, 50.05);
  assert.deepEqual(r.walls.map((w) => w.bearing), [90]);
  assert.equal(r.ground.median, 50);
  assert.ok(Math.abs(r.density - (n * 2) / 110) < 0.5); // 11 × 10 one-metre cells covered (x runs 0 to 10)
  // keep: nothing passes
  assert.equal(describeCloud({ count: n, position: Float32Array.from(pos) }, { keep: () => false }).bounds, null);
});

test('describe_cloud on the corridor scan: classes, walls along the buildings, project bounds, within a clip', async () => {
  const { reg, ctx } = makeCtx();
  addScanCloud(ctx.doc, { points: 80000 });
  const r = await reg.run('describe_cloud', {});
  assert.ok(JSON.stringify(r).length < 2048, 'under 2 KB');
  assert.equal(r.points, 800000);
  assert.ok(r.classified);
  for (const n of ['Ground', 'Road surface', 'Building', 'High vegetation']) assert.ok(r.classes.some((c) => c.name === n), n);
  assert.deepEqual(r.walls.map((w) => w.bearing).sort((a, b) => a - b), [0, 90]);
  assert.ok(Math.abs(r.bounds.project.min[0] - SITE.origin[0]) < 0.1 && Math.abs(r.bounds.project.max[1] - (SITE.origin[1] + 80)) < 0.1);
  assert.ok(r.attributes.includes('classification') && r.attributes.includes('intensity'));
  // a box around the culvert mouth: only a few hundred points, no buildings
  await reg.run('add_clip', { kind: 'box', name: 'Culvert', center: [80, 0, -33.8], size: [3, 6, 3] });
  const w = await reg.run('describe_cloud', { within: 'Culvert' });
  assert.equal(w.within, 'Culvert');
  assert.ok(w.points > 0 && w.points < r.points / 50, `${w.points}`);
  assert.ok(!w.classes.some((c) => c.name === 'Building'));
});

test('point cloud replies stay under 8 KB with long series and many clips', async () => {
  const { reg, ctx } = makeCtx();
  addScanCloud(ctx.doc, { points: 80000 });
  const calls = [
    ['set_cloud_style', { color_by: 'classification', depth: 'xray' }],
    ['set_cloud_filter', { classes: { hide: [3, 5, 7] } }],
    ['list_cloud_classes', {}],
    ['describe_cloud', {}],
    ['classify_ground', { id: 'Site scan', cell: 2 }],
    ['create_alignment', { name: 'Main road', points: [[0, 0, -40], [100, 0, -40]] }],
    ['add_clip', { kind: 'box', center: [80, 0, -34], size: [3, 3, 3] }],
    ['slice_series', { at: 'station', alignment: 'Main road', from: 0, to: 100, step: 1 }],
    ['slice_series', { at: 'elevation', from: 95, to: 110, step: 0.25 }],
    ['set_clip', { name: 'Box 1', grow: 1 }],
    ['list_clips', {}],
    ['add_slice', { at: 'elevation', z: 1.2, above: 'ground' }],
    ['step_slice', {}],
    ['view_clip', { name: 'Slice 1', pane: 2 }],
    ['slice_points', { name: 'Slice 1' }],
    ['fit_clip', { name: 'Box 1', from: 'model' }],
    ['delete_clip', { name: 'Box 1' }],
    ['detect_planes', { min_points: 50, min_area: 0.2 }],
    ['detect_corners', { min_points: 100 }],
    ['detect_edges', { kind: 'intersections', min_points: 100 }],
    ['detect_edges', { kind: 'kerb', alignment: 'Main road' }],
    ['classify_cloud', { steps: ['noise', 'ground', 'vegetation', 'buildings', 'road'] }],
    ['add_clip', { kind: 'box', name: 'Sel', center: [21, 3, -60], size: [14, 10, 12] }],
    ['select_points', { within: 'Sel', classes: [6] }],
    ['point_selection', {}],
    ['define_point_class', { code: 64, name: 'Kerb', color: '#e0b400' }],
    ['set_point_class', { class: 64 }],
    ['list_cloud_classes', {}],
  ];
  for (const [n, a] of calls) {
    const size = JSON.stringify(await reg.run(n, a)).length;
    assert.ok(size < 8192, `${n}: ${size} bytes`);
  }
  const l = await reg.run('list_clips', {});
  assert.deepEqual(l.series.map((s) => [s.name, s.slices]), [['Station', 101], ['Level', 61]]);
  assert.equal((await reg.run('slice_points', { name: 'Slice 1' })).points, undefined, 'no points unless max asks');
});

test('the scans skill runs on the corridor scan; its MCP prompts start from describe_cloud and propose', async () => {
  const { SKILLS, WORKFLOWS, workflowText } = await import('../src/core/skills.js');
  for (const w of ['scan_to_plan', 'scan_to_kerbs', 'classify_and_clean']) {
    const t = workflowText(w);
    assert.ok(t.includes('describe_cloud') && /propose|ask_user/.test(t), w);
    assert.ok(WORKFLOWS[w].description);
  }
  assert.ok(workflowText('scan_to_kerbs', { alignment: 'Access Road' }).includes("alignment: 'Access Road'"));
  const { reg, ctx } = makeCtx();
  addScanCloud(ctx.doc, { points: 30000 });
  for (const ex of SKILLS.scans.examples) await reg.run('run_script', { code: ex.code });
  assert.ok((ctx.doc.clips || []).some((c) => c.name === 'Culvert side'));
});
