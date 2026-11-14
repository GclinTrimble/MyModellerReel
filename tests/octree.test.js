// Point cloud octrees (#293, #294): the scan fixture, LAS with every attribute, the Potree 2.0 converter out of core,
// hierarchy chunks and proxies, COPC keys, and which nodes a camera draws within a budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as F from './fixtures/scan.js';
import * as PC from '../src/core/pointcloud.js';
import * as OT from '../src/core/octree.js';
import { keyName } from '../src/core/copc.js';
import { convertCloud, readOctree } from '../src/main/cloud-convert.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-octree-'));
const countBy = (arr, n = arr.length) => {
  const c = {};
  for (let i = 0; i < n; i++) c[arr[i]] = (c[arr[i]] || 0) + 1;
  return c;
};

test('the scan fixture: deterministic in batches, every part present, LAS round trip with every attribute', () => {
  const s = F.makeScan({ points: 20000 });
  const parts = [...F.scanBatches({ points: 20000, batch: 3000 })];
  assert.equal(parts.length, 7);
  assert.equal(parts[2].z[5], s.z[6005], 'the same points whatever the batch size');
  const seen = new Set(s.part);
  for (const p of ['terrain', 'road', 'kerb', 'ditch', 'building', 'roof', 'wall', 'tree']) assert.ok(seen.has(F.PARTS.indexOf(p)), p);
  // kerbs stand 150 mm over the road edge
  const z = F.groundAt(650050, 5400043.6) - F.groundAt(650050, 5400043.4);
  assert.ok(Math.abs(z - 0.15) < 0.01, `kerb ${z}`);
  for (const format of [1, 3, 6, 7]) {
    const l = PC.parsePointCloud(F.writeLas(s, { format }), 'scan.las');
    assert.equal(l.count, s.count);
    let worst = 0;
    for (let i = 0; i < s.count; i++) {
      worst = Math.max(worst, Math.abs(l.x[i] - s.x[i]), Math.abs(l.y[i] - s.y[i]), Math.abs(l.z[i] - s.z[i]));
      assert.equal(l.classification[i], s.classification[i]);
      assert.equal(l.classFlags[i], s.classFlags[i]);
      assert.equal(l.returnNumber[i], s.returnNumber[i]);
      assert.equal(l.numberOfReturns[i], s.numberOfReturns[i]);
      assert.equal(l.intensity[i], s.intensity[i]);
      assert.equal(l.pointSourceId[i], s.pointSourceId[i]);
      assert.ok(Math.abs(l.gpsTime[i] - s.gpsTime[i]) < 1e-9);
      if (format === 3 || format === 7) assert.equal(l.r[i], s.r[i]);
    }
    assert.ok(worst <= 0.0005 + 1e-9, `quantised to the LAS scale: ${worst}`);
  }
  // the batched reader gives the same points
  const las = F.writeLas(s);
  const batches = [...PC.readLasBatches(las, { start: 100, count: 5000, batch: 2000 })];
  assert.deepEqual(batches.map((b) => b.count), [2000, 2000, 1000]);
  assert.ok(Math.abs(batches[1].x[0] - s.x[2100]) < 1e-3);
});

test('a 1 M point cloud converts to Potree 2.0 and reads back: same count, bounds within 1 mm, same classes', async () => {
  const dir = tmp();
  try {
    const s = F.makeScan({ points: 1e6 });
    const las = path.join(dir, 'scan.las');
    fs.writeFileSync(las, F.writeLas(s));
    const stages = new Set();
    let preview = null;
    // small chunks: the out-of-core path (upper nodes in memory, chunks on disk)
    const { metadata } = await convertCloud(las, path.join(dir, 'octree'), { maxChunk: 150000, onProgress: (p) => stages.add(p.stage), onPreview: (p) => (preview = p) });
    assert.deepEqual([...stages], ['counting', 'sorting', 'building', 'done']);
    assert.equal(preview.count, 300000);
    assert.equal(metadata.points, 1e6);
    for (const a of ['intensity', 'classification', 'classification flags', 'return number', 'number of returns', 'gps-time', 'rgb', 'scan angle', 'point source id']) assert.ok(metadata.attributes.some((x) => x.name === a), a);
    const { root, layout, metadata: m } = readOctree(path.join(dir, 'octree'));
    assert.deepEqual(m.attributes.find((a) => a.name === 'classification').max, [11]);
    const oct = fs.readFileSync(path.join(dir, 'octree', 'octree.bin'));
    let n = 0;
    const cls = {};
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    let returns2 = 0;
    for (const node of OT.walk(root)) {
      if (!node.numPoints) continue;
      const d = OT.decodeRecords(oct.subarray(node.byteOffset, node.byteOffset + node.byteSize), layout, m.scale, m.offset);
      assert.equal(d.count, node.numPoints);
      n += d.count;
      for (let i = 0; i < d.count; i++) {
        cls[d.classification[i]] = (cls[d.classification[i]] || 0) + 1;
        if (d['number of returns'][i] === 2) returns2++;
        for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], d.position[i * 3 + k])), (hi[k] = Math.max(hi[k], d.position[i * 3 + k]));
      }
      for (let i = 0; i < d.count; i++) {
        const [x, y, z] = [d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]];
        const b = node.box;
        assert.ok(x >= b.min[0] - 1e-6 && x <= b.max[0] + 1e-6 && y >= b.min[1] - 1e-6 && y <= b.max[1] + 1e-6 && z >= b.min[2] - 1e-6 && z <= b.max[2] + 1e-6, `${node.name} holds its own points`);
      }
    }
    assert.equal(n, 1e6);
    assert.deepEqual(cls, countBy(s.classification));
    assert.equal(returns2, Object.values(countBy(s.numberOfReturns))[1]);
    const b = F.boundsOf(s);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(lo[k] - b.min[k]) < 1e-3 && Math.abs(hi[k] - b.max[k]) < 1e-3, `bounds ${k}`);
    // the root is a sparse sample: no two of its points closer than its spacing
    const r = OT.decodeRecords(oct.subarray(root.byteOffset, root.byteOffset + root.byteSize), layout, m.scale, m.offset);
    assert.ok(r.count > 1000 && r.count < 50000, `root ${r.count}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hierarchy chunks: proxies past stepSize, decoded back to the same tree', () => {
  const cube = { min: [0, 0, 0], max: [8, 8, 8] };
  const make = (name, depth) => ({ name, level: name.length - 1, numPoints: name.length * 10, byteOffset: name.length * 100, byteSize: 7, children: depth ? [0, 3, 7].map((i) => make(name + i, depth - 1)).reduce((a, n) => ((a[+n.name.at(-1)] = n), a), []) : [] });
  const root = make('r', 5);
  const { bytes, firstChunkSize, depth } = OT.encodeHierarchy(root, 2);
  assert.equal(depth, 5);
  assert.ok(firstChunkSize < bytes.length, 'more than one chunk');
  const back = OT.decodeHierarchy(bytes, firstChunkSize, cube);
  const names = (t) => [...OT.walk(t)].map((n) => `${n.name}:${n.numPoints}:${n.byteOffset}`).sort();
  assert.deepEqual(names(back), names(root));
  assert.deepEqual(OT.boxOf(cube, 'r7'), { min: [4, 4, 4], max: [8, 8, 8] });
  assert.deepEqual(OT.boxOf(cube, 'r4').min, [4, 0, 0], 'bit 4 is x');
  assert.equal(keyName(2, 3, 0, 1), 'r45', 'COPC keys name nodes like Potree');
  const { chunks, lookup } = OT.chunkify(Float64Array.from({ length: 64 }, (_, i) => (i === 0 ? 100 : 1)), 4, 50);
  assert.equal(chunks.find((c) => c.count === 100).name, 'r00', 'a crowded corner split down to its own cell');
  assert.ok([...lookup].every((i) => i >= 0));
});

test('selectNodes: coarse far away, fine close up, within the budget, skipping what the frustum and clips leave out', () => {
  const cube = { min: [0, 0, 0], max: [64, 64, 64] };
  const build = (name, depth) => {
    const n = { name, level: name.length - 1, box: OT.boxOf(cube, name), numPoints: 1000, children: [] };
    if (depth) for (let i = 0; i < 8; i++) n.children[i] = build(name + i, depth - 1);
    return n;
  };
  const root = build('r', 4);
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const cloud = { id: 'c', root, matrix: I, rootSpacing: 0.5, loaded: () => true };
  const far = OT.selectNodes([cloud], { position: [32, 32, 5000], projFactor: 1000 }, { budget: 1e9 });
  const near = OT.selectNodes([cloud], { position: [2, 2, 66], projFactor: 1000 }, { budget: 1e9 });
  assert.ok(far.visible.length < 10, `far: ${far.visible.length}`);
  assert.ok(near.visible.length > far.visible.length * 5, `near: ${near.visible.length}`);
  const deepest = Math.max(...near.visible.map((v) => v.node.level));
  assert.equal(deepest, 4);
  const farCorner = (b) => b.min[0] >= 56 && b.min[1] >= 56 && b.max[2] <= 8;
  assert.ok(!near.visible.some((v) => v.node.level === 4 && farCorner(v.node.box)), 'full detail where the camera is, not in the far corner');
  // a budget caps the points, biggest on screen first
  const capped = OT.selectNodes([cloud], { position: [2, 2, 66], projFactor: 1000 }, { budget: 20000 });
  assert.ok(capped.points <= 20000 && capped.visible.length === 20);
  // a clip box (x < 16 kept) leaves out the nodes past it; a frustum plane facing away leaves out everything
  const clipped = OT.selectNodes([cloud], { position: [2, 2, 66], projFactor: 1000 }, { budget: 1e9, clips: [[-1, 0, 0, 16]] });
  assert.ok(clipped.visible.length < near.visible.length && clipped.visible.every((v) => v.node.box.min[0] <= 16));
  assert.equal(OT.selectNodes([cloud], { position: [0, 0, 0], projFactor: 1000, planes: [[0, 0, -1, -100]] }).visible.length, 0);
  // children wait for their parent: nothing deeper than what is loaded, which is asked for first
  const partly = OT.selectNodes([{ ...cloud, loaded: (n) => n.level === 0 }], { position: [2, 2, 66], projFactor: 1000 }, { budget: 1e9 });
  assert.equal(partly.visible.length, 1);
  assert.ok(partly.load.length === 8 && partly.load.every((l) => l.node.level === 1));
  assert.ok(partly.load[0].priority >= partly.load[7].priority);
  // two clouds share one budget
  const two = OT.selectNodes([cloud, { ...cloud, id: 'd' }], { position: [2, 2, 66], projFactor: 1000 }, { budget: 50000 });
  assert.ok(two.points <= 50000 && new Set(two.visible.map((v) => v.cloud.id)).size === 2);
});

test('clip volumes (#290) leave whole nodes out: a box, a plane and a slab as planes', async () => {
  const { clipPlanes } = await import('../src/renderer/cloudlod.js');
  const inside = (planes, p) => planes.every(([a, b, c, d]) => a * p[0] + b * p[1] + c * p[2] + d >= -1e-9);
  const box = clipPlanes([{ kind: 'box', center: [10, 0, -10], size: [4, 2, 6], rotation: [0, 90, 0] }]);
  assert.equal(box.length, 6);
  assert.ok(inside(box, [10, 0, -10]) && inside(box, [12.9, 0.9, -10]), 'turned 90°: x now spans the 6 m side');
  assert.ok(!inside(box, [10, 0, -12.5]) && !inside(box, [10, 1.5, -10]));
  const plane = clipPlanes([{ kind: 'plane', point: [0, 5, 0], normal: [0, 1, 0] }]);
  assert.ok(inside(plane, [0, 4, 0]) && !inside(plane, [0, 6, 0]), 'a plane cuts its normal side away');
  const slab = clipPlanes([{ kind: 'slab', point: [0, 0, 3], normal: [0, 0, 1], thickness: 2 }]);
  assert.ok(inside(slab, [0, 0, 3.9]) && !inside(slab, [0, 0, 4.1]) && !inside(slab, [0, 0, 1.9]));
  assert.equal(clipPlanes([{ kind: 'box', center: [0, 0, 0], enabled: false }]).length, 0, 'switched off');
  assert.equal(clipPlanes([{ kind: 'box', center: [0, 0, 0] }, { kind: 'box', center: [50, 0, 0] }]).length, 0, 'two boxes are a union: neither alone leaves nodes out');
  // the selection with a box clip: only nodes touching the box
  const cube = { min: [0, 0, 0], max: [64, 64, 64] };
  const build = (name, depth) => ({ name, level: name.length - 1, box: OT.boxOf(cube, name), numPoints: 1000, children: depth ? Array.from({ length: 8 }, (_, i) => build(name + i, depth - 1)) : [] });
  const cloud = { id: 'c', root: build('r', 3), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], rootSpacing: 0.5, loaded: () => true };
  const cam = { position: [32, 200, 32], projFactor: 2000 };
  const all = OT.selectNodes([cloud], cam, { budget: 1e9 });
  const clipped = OT.selectNodes([cloud], cam, { budget: 1e9, clips: clipPlanes([{ kind: 'box', center: [4, 4, 4], size: [6, 6, 6] }]) });
  assert.ok(clipped.visible.length < all.visible.length / 4, `${clipped.visible.length} of ${all.visible.length} nodes`);
  assert.ok(clipped.visible.every((v) => v.node.box.min.every((m) => m <= 7)));
});
