// classify_cloud, select_points, set_point_class, define_point_class, export_point_cloud and classify_ground reusing
// class 2, through the registry on a cloud without an octree (its preview is the whole cloud).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as F from './fixtures/scan.js';
import * as D from '../src/core/document.js';
import * as PC from '../src/core/pointcloud.js';

async function scanCtx(points = 60000) {
  const { reg, ctx } = makeCtx();
  const scan = F.makeScan({ points, seed: 4 });
  scan.classification.fill(1); // as delivered unclassified
  ctx.io = { readBinary: async () => F.writeLas(scan) };
  await reg.run('set_base_point', { e: F.SITE.origin[0], n: F.SITE.origin[1], z: F.SITE.origin[2] });
  const r = await reg.run('import_point_cloud', { path: 'C:/scans/corridor.las', octree: false, max_points: points });
  return { reg, ctx, scan, id: r.id };
}
const counts = async (reg, id) => Object.fromEntries((await reg.run('list_cloud_classes', { id })).classes.map((c) => [c.code, c.count]));

test('classify_cloud on a cloud without an octree: a report, the classes, one undo step', async () => {
  const { reg, ctx, id } = await scanCtx();
  const r = await reg.run('classify_cloud', { id });
  assert.ok(r.changed > 50000);
  const c = r.classes.find((x) => x.code === 2);
  assert.ok(c.after > 30000 && c.before === 0, 'ground found');
  assert.ok(r.classes.find((x) => x.code === 6).after > 2500, `buildings found: ${JSON.stringify(r.classes)}`);
  assert.ok(r.seconds >= 0 && r.steps.includes('ground') && r.params.ground.method === 'pmf');
  const after = await counts(reg, id);
  assert.equal(after[2], c.after);
  assert.equal(D.getEntity(ctx.doc, id).pointcloud.edits.length, 1);
  assert.ok(ctx.doc.journal.some((j) => j.command === 'classify_cloud'), 'journaled with its parameters');
  ctx.store.undo();
  assert.deepEqual(await counts(reg, id), { 1: 60000 }, 'undo: back to unclassified in one step');
  ctx.store.redo();
  assert.equal((await counts(reg, id))[2], c.after);
  // colour by classification works on a cloud that had none
  await reg.run('set_cloud_style', { id, color_by: 'classification' });
});

test('within a clip box only points inside change; hand edits, locks, deletes; ground reuses class 2', async () => {
  const { reg, ctx, id } = await scanCtx();
  // the flat-roofed building in model axes about the base point (x 15–27, y 55–65 of the site)
  await reg.run('add_clip', { kind: 'box', name: 'Box 1', center: [21, 3, -60], size: [14, 14, 14] });
  const r = await reg.run('classify_cloud', { id, within: 'Box 1', steps: ['ground', 'buildings'] });
  const c = await counts(reg, id);
  assert.ok(c[6] > 1000 && c[2] > 0 && c[2] < 10000, `only the box: ${JSON.stringify(c)}`);
  assert.equal(r.changed, 60000 - c[1], 'the rest stays unclassified');
  // select the building points in the box, make them a vehicle (a hand fix), lock them
  const s = await reg.run('select_points', { id, within: 'Box 1', classes: [6] });
  assert.equal(s.selected, c[6]);
  assert.deepEqual(s.classes, [{ code: 6, name: 'Building', points: c[6] }]);
  const e1 = await reg.run('set_point_class', { class: 65, lock: true });
  assert.equal(e1.changed, c[6]);
  assert.equal(e1.class_name, 'Vehicle');
  const c2 = await counts(reg, id);
  assert.equal(c2[65], c[6]);
  assert.equal(c2[6] || 0, 0);
  // a later automatic pass leaves the locked points alone
  await reg.run('classify_cloud', { id });
  assert.equal((await counts(reg, id))[65], c[6], 'locked points keep their class');
  await reg.run('classify_cloud', { id, overwrite: true });
  assert.ok(!(await counts(reg, id))[65], 'overwrite: true takes them too');
  ctx.store.undo();
  assert.equal((await counts(reg, id))[65], c[6]);
  // define a class, grow, invert, delete
  await reg.run('define_point_class', { code: 66, name: 'Manhole', color: '#aa5500' });
  assert.equal((await reg.run('list_cloud_classes', { id })).classes.length > 3, true);
  await assert.rejects(reg.run('define_point_class', { code: 12, name: 'x' }), /64–255/);
  const inv = await reg.run('select_points', { id, mode: 'invert' });
  assert.equal(inv.selected, 60000 - c[6]);
  await reg.run('select_points', { id, classes: [7, 18] });
  const del = await reg.run('set_point_class', { delete: true });
  assert.ok(del.deleted);
  assert.ok(D.getEntity(ctx.doc, id).pointcloud.filter.hide.includes(7), 'deleted points hidden');
  // classify_ground uses class 2 as it is
  const g = await reg.run('classify_ground', { id, cell: 1 });
  assert.equal(g.ground, 'class 2 as classified');
  assert.ok(g.ground_points > 3000);
  // export: LAS 1.4 with the edits, deleted points left out; LAZ says why not
  const out = await reg.run('export_point_cloud', { id, path: 'C:/out/corridor.las' });
  const back = PC.parsePointCloud(out.bytes, 'x.las');
  assert.equal(back.count, 60000 - del.points);
  assert.equal(back.classification.filter((x) => x === 65).length, c[6]);
  assert.ok(Math.abs(back.x[0] - F.SITE.origin[0]) < 200, 'world coordinates');
  await assert.rejects(reg.run('export_point_cloud', { id, path: 'C:/out/corridor.laz' }), /laz-perf/);
  const sel = await reg.run('select_points', { id, classes: [65] });
  const part = await reg.run('export_point_cloud', { id, path: 'C:/out/v.ply', what: 'selection', coordinates: 'project' });
  assert.equal(PC.parsePointCloud(part.bytes, 'v.ply').count, sel.selected);
});
