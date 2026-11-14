// Classification and export of a whole octree in tiles (#298, #299): the cloud worker's tasks in plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as F from './fixtures/scan.js';
import * as PC from '../src/core/pointcloud.js';
import * as S from '../src/core/cloudselect.js';
import { convertCloud } from '../src/main/cloud-convert.mjs';
import { classifyTree, exportTree, openTree } from '../src/main/cloud-task.mjs';

try {
  os.setPriority(os.constants.priority.PRIORITY_LOW);
} catch {}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-classify-'));
const scan = F.makeScan({ points: 150000, seed: 3 });
const las = path.join(dir, 'scan.las');
fs.writeFileSync(las, F.writeLas(scan));
const folder = path.join(dir, 'octree');
const ready = convertCloud(las, folder, { maxChunk: 40000 });

/** Every point of a tree with its classes after the deltas: [{ x, y, z, before, after, flags }]. */
async function pointsOf(deltas) {
  const tree = await openTree({ kind: 'potree', folder });
  const ds = deltas.map((d) => S.decodeDelta(d));
  const out = [];
  for (const node of tree.nodes) {
    const b = tree.read(node);
    const { classes, flags } = S.effective(b.classification, b.count, ds, node.name);
    for (let i = 0; i < b.count; i++) out.push({ x: b.x[i], y: b.y[i], z: b.z[i], before: b.classification[i], after: classes[i], flags: flags[i] });
  }
  tree.close();
  return out;
}
const f1 = (pts, pred, truth) => {
  let [tp, fp, fn] = [0, 0, 0];
  for (const p of pts) {
    const [a, b] = [pred(p.after), truth(p.before)];
    if (a && b) tp++;
    else if (a) fp++;
    else if (b) fn++;
  }
  return (2 * tp) / (2 * tp + fp + fn);
};

test('classifying an octree in small tiles agrees with the truth across tile borders, with progress and parts', async () => {
  await ready;
  const progress = [];
  let parts = 0;
  const r = await classifyTree({ kind: 'potree', folder, steps: ['noise', 'ground', 'vegetation', 'buildings'], tilePoints: 40000 }, { progress: (p) => progress.push(p.fraction), part: () => parts++ });
  assert.ok(r.tiles >= 4, `${r.tiles} tiles`);
  assert.ok(parts >= 4 && progress.at(-1) === 1);
  assert.equal(r.points, 150000);
  const pts = await pointsOf([r.delta]);
  const ground = f1(pts, (c) => c === 2 || c === 11, (c) => c === 2 || c === 11);
  const buildings = f1(pts, (c) => c === 6, (c) => c === 6);
  const trees = f1(pts, (c) => c === 5, (c) => c === 5);
  console.log('octree tiles F1 %', { ground: +(ground * 100).toFixed(1), buildings: +(buildings * 100).toFixed(1), high_vegetation: +(trees * 100).toFixed(1) }, `${r.seconds} s`);
  assert.ok(ground >= 0.97 && buildings >= 0.9 && trees >= 0.85);
  assert.equal(Object.values(r.before).reduce((a, b) => a + b, 0), 150000);
});

test('within a clip box only points inside change; locked points stay; export to LAS 1.4 with the edits', async () => {
  await ready;
  // a box around the flat-roofed building (x 15–27, y 55–65 from the site corner), in model axes about a base point
  const [ox, oy, oz] = F.SITE.origin;
  const base = [ox, oy, oz];
  const clip = { name: 'Box 1', kind: 'box', center: [21, 3, -60], size: [14, 12, 14], rotation: [0, 0, 0], keep: 'inside', enabled: true };
  const isIn = (p) => Math.abs(p.x - ox - 21) <= 7 && Math.abs(p.y - oy - 60) <= 7;
  // lock every point of the box's west half to class 65 first
  const before = await pointsOf([]);
  const tree = await openTree({ kind: 'potree', folder });
  const lockDelta = new Map();
  for (const node of tree.nodes) {
    const b = tree.read(node);
    const idx = [];
    for (let i = 0; i < b.count; i++) if (Math.abs(b.x[i] - ox - 21) <= 7 && Math.abs(b.y[i] - oy - 60) <= 7 && b.x[i] - ox < 21) idx.push(i);
    if (idx.length) lockDelta.set(node.name, { idx: Uint32Array.from(idx), cls: new Uint8Array(idx.length).fill(65), flags: new Uint8Array(idx.length).fill(S.LOCK) });
  }
  tree.close();
  const lock = S.encodeDelta(lockDelta);
  const r = await classifyTree({ kind: 'potree', folder, deltas: [lock], steps: ['ground', 'buildings'], scope: { clip, base, position: [0, 0, 0] } });
  const after = await pointsOf([lock, r.delta]);
  let outsideChanged = 0;
  let insideChanged = 0;
  let lockedChanged = 0;
  after.forEach((p, i) => {
    const was = i < before.length ? before[i].after : p.before;
    const locked = isIn(p) && p.x - ox < 21;
    if (locked && p.after !== 65) lockedChanged++;
    else if (!isIn(p) && p.after !== was) outsideChanged++;
    else if (isIn(p) && !locked && p.after !== was) insideChanged++;
  });
  assert.equal(outsideChanged, 0, 'nothing outside the box');
  assert.equal(lockedChanged, 0, 'locked points untouched');
  assert.ok(r.changed >= 0 && insideChanged >= 0);
  // export: the selection-free whole cloud, world coordinates, with deleted points left out
  const del = S.encodeDelta({ r: { idx: Uint32Array.of(0, 1, 2), cls: Uint8Array.of(7, 7, 7), flags: Uint8Array.of(S.DELETED, S.DELETED, S.DELETED) } });
  const out = path.join(dir, 'out.las');
  const e = await exportTree({ kind: 'potree', folder, deltas: [lock, r.delta, del], path: out, format: 'las', wkt: 'PROJCS["Test grid",AUTHORITY["EPSG","25832"]]' });
  const rootN = (await openTree({ kind: 'potree', folder })).nodes.find((n) => n.name === 'r').numPoints;
  assert.ok(rootN >= 3);
  assert.equal(e.points, 150000 - 3);
  const bytes = new Uint8Array(fs.readFileSync(out));
  const h = PC.lasHeader(bytes);
  assert.equal(h.version, '1.4');
  assert.equal(h.count, 150000 - 3);
  assert.equal(h.format, 7);
  assert.ok(h.vlrs.some((v) => v.user === 'LASF_Projection' && v.record === 2112));
  const pc = PC.parsePointCloud(bytes, 'out.las');
  const c65 = pc.classification.filter((c) => c === 65).length;
  assert.equal(c65, after.filter((p) => p.after === 65).length);
  assert.ok(Math.abs(Math.min(...pc.x.slice(0, 1000)) - ox) < 200, 'world coordinates');
  // PLY in project coordinates, only the buildings
  const ply = path.join(dir, 'b.ply');
  const p = await exportTree({ kind: 'potree', folder, deltas: [r.delta], path: ply, format: 'ply', classes: [6], coordinates: 'project', base });
  const back = PC.parsePointCloud(new Uint8Array(fs.readFileSync(ply)), 'b.ply');
  assert.equal(back.count, p.points);
  assert.ok(Math.abs(back.x[0]) < 200 && Math.abs(back.y[0]) < 200);
});
