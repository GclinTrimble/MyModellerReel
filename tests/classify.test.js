// Point cloud classification (#298): the neighbourhood API, features, and accuracy on the scan fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core/classify.js';
import * as F from './fixtures/scan.js';

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

/** F1 of predicted (pred(i)) against truth (truth(i)) over n points. */
function f1(n, pred, truth) {
  let [tp, fp, fn] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [p, t] = [pred(i), truth(i)];
    if (p && t) tp++;
    else if (p) fp++;
    else if (t) fn++;
  }
  return (2 * tp) / (2 * tp + fp + fn);
}

test('classification of the scan fixture: ground ≥ 97 %, buildings ≥ 90 %, high vegetation ≥ 85 % (F1)', () => {
  const s = F.makeScan({ points: 200000 });
  const pos = new Float64Array(s.count * 3);
  for (let i = 0; i < s.count; i++) (pos[i * 3] = s.x[i]), (pos[i * 3 + 1] = s.y[i]), (pos[i * 3 + 2] = s.z[i]);
  const t0 = performance.now();
  const r = C.classifyPoints({ count: s.count, pos, intensity: s.intensity, classification: new Uint8Array(s.count).fill(1) }, { steps: [...C.DEFAULT_STEPS, 'road'] });
  const ms = performance.now() - t0;
  const P = Object.fromEntries(F.PARTS.map((p, i) => [p, i]));
  const c = r.classes;
  const part = s.part;
  const scores = {
    ground: f1(s.count, (i) => [2, 11, 64].includes(c[i]), (i) => [P.terrain, P.road, P.kerb, P.ditch].includes(part[i])),
    buildings: f1(s.count, (i) => c[i] === 6, (i) => part[i] === P.building || part[i] === P.roof),
    high_vegetation: f1(s.count, (i) => c[i] === 5, (i) => part[i] === P.tree),
    noise: f1(s.count, (i) => c[i] === 7 || c[i] === 18, (i) => part[i] === P.noise),
    road: f1(s.count, (i) => c[i] === 11, (i) => part[i] === P.road),
    kerb: f1(s.count, (i) => c[i] === 64, (i) => part[i] === P.kerb),
  };
  console.log('fixture F1 %', JSON.stringify(Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.round(v * 1000) / 10]))), `${Math.round(ms)} ms for ${s.count} points`);
  assert.ok(scores.ground >= 0.97, `ground ${scores.ground}`);
  assert.ok(scores.buildings >= 0.9, `buildings ${scores.buildings}`);
  assert.ok(scores.high_vegetation >= 0.85, `high vegetation ${scores.high_vegetation}`);
  assert.ok(scores.noise >= 0.8, `noise ${scores.noise}`);
});
