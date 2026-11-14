// Point cloud classification (#298): the neighbourhood API, features, and accuracy on the scan fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core/classify.js';

const rnd = ((s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296))(9);
const interleave = (pts) => Float64Array.from(pts.flat());

test('voxel grid neighbours: radius and k nearest match brute force', () => {
  const pts = Array.from({ length: 3000 }, () => [rnd() * 20, rnd() * 20, rnd() * 5]);
  const pos = interleave(pts);
  const g = C.voxelGrid(pos, 0.7);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (const i of [0, 17, 999, 2999]) {
    const byR = [...C.neighbours(g, i, { r: 1.3 })].sort((a, b) => a - b);
    const brute = pts.map((p, j) => [j, d2(p, pts[i])]).filter(([, d]) => d <= 1.69).map(([j]) => j);
    assert.deepEqual(byR, brute);
    const k = [...C.neighbours(g, i, { k: 10 })].map((j) => d2(pts[j], pts[i])).sort((a, b) => a - b);
    const bk = pts.map((p) => d2(p, pts[i])).sort((a, b) => a - b).slice(0, 10);
    assert.deepEqual(k, bk);
  }
  assert.equal(C.neighboursAt(g, 10, 10, 2.5, { k: 5 }).length, 5);
});

test('covariance features: a floor is planar, a pole linear and vertical, a wall vertical', () => {
  const plane = interleave(Array.from({ length: 400 }, () => [rnd() * 2, rnd() * 2, 0.001 * rnd()]));
  const f = C.covarianceFeatures(plane, Uint32Array.from({ length: 400 }, (_, i) => i));
  assert.ok(f.planarity > 0.8 && f.verticality < 0.01 && f.normal[2] > 0.99);
  const line = interleave(Array.from({ length: 100 }, () => [0.01 * rnd(), 0.01 * rnd(), rnd() * 5]));
  const l = C.covarianceFeatures(line, Uint32Array.from({ length: 100 }, (_, i) => i));
  assert.ok(l.linearity > 0.95 && Math.abs(l.direction[2]) > 0.99);
  const wall = interleave(Array.from({ length: 300 }, () => [rnd() * 3, 0.002 * rnd(), rnd() * 3]));
  const w = C.covarianceFeatures(wall, Uint32Array.from({ length: 300 }, (_, i) => i));
  assert.ok(w.verticality > 0.99 && Math.abs(w.normal[1]) > 0.99);
});

test('growPlane stops at a corner: one wall of two', () => {
  const pts = [];
  for (let i = 0; i < 4000; i++) pts.push(rnd() < 0.5 ? [rnd() * 6, 0, rnd() * 3] : [0, rnd() * 6, rnd() * 3]);
  const pos = interleave(pts);
  const g = C.voxelGrid(pos, 0.3);
  const f = C.pointFeatures(g, { r: 0.4 });
  const seed = pts.findIndex((p) => p[0] > 3 && p[2] > 1);
  const got = C.growPlane(g, f.normal, seed, { angle: 15, distance: 0.05 });
  const onWall = pts.filter((p) => p[1] === 0 && p[0] > 0.4).length;
  const wrong = got.filter((j) => pts[j][0] < 0.01 && pts[j][1] > 0.4).length;
  assert.equal(wrong, 0, 'nothing of the other wall');
  assert.ok(got.length > onWall * 0.95, `${got.length} of ${onWall}`);
});
