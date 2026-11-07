// Phase 10: surface tools on shapes with known answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near, nearArr } from './helpers.js';
import * as SF from '../src/core/surfaces.js';
import * as TR from '../src/core/terrain.js';

// a plane rising 1 m per 10 m to the east (x), 40 × 40 m, a 2 m grid
const plane = () => {
  const m = SF.gridMesh(40, 40, 2, 0);
  m.v.forEach((p) => (p[1] = 100 + p[0] / 10));
  return m;
};

test('contours of an inclined plane are straight north-south lines at the right x', () => {
  const c = SF.contours(plane(), { interval: 1, major_every: 2 });
  assert.deepEqual(c.map((x) => x.z), [99, 100, 101, 102], 'a level exactly at the lowest corner has no line');
  for (const level of c) {
    assert.equal(level.lines.length, 1);
    const l = level.lines[0];
    for (const p of l.pts) near(p[0], (level.z - 100) * 10, 1e-6);
    near(Math.abs(l.pts[0][2] - l.pts.at(-1)[2]), 40, 1e-6);
    assert.equal(level.lines[0].pts.length, 2, 'collinear pieces merged');
  }
  assert.deepEqual(c.filter((x) => x.major).map((x) => x.z), [100, 102]);
  assert.throws(() => SF.contours(plane(), { interval: 0.0001 }), /2000/);
});

test('a cone gives closed circular contours; Chaikin keeps them round', () => {
  const v = [[0, 10, 0]];
  const ring = 36;
  for (let r = 1; r <= 3; r++) for (let k = 0; k < ring; k++) v.push([r * 5 * Math.cos((k * 2 * Math.PI) / ring), 10 - r * 3, r * 5 * Math.sin((k * 2 * Math.PI) / ring)]);
  const { faces } = TR.triangulate(v);
  const c = SF.contours({ v, f: faces }, { interval: 3, base: 1, smooth: 1 });
  const lvl = c.find((x) => x.z === 4);
  assert.equal(lvl.lines.length, 1);
  assert.ok(lvl.lines[0].closed);
  for (const p of lvl.lines[0].pts) near(Math.hypot(p[0], p[2]), 10, 0.3);
});

test('analysis: slope classes, aspect, elevation bands, difference', () => {
  const m = plane(); // 10 % slope, facing west (downhill to −x)
  const s = SF.analyze(m, { kind: 'slope', thresholds: [5, 15] });
  assert.ok(s.fc.every((c) => c === s.fc[0]));
  assert.equal(s.legend[1].label, '5 – 15%');
  assert.equal(s.fc[0], s.legend[1].color);
  const a = SF.analyze(m, { kind: 'aspect' });
  assert.equal(a.fc[0], a.legend.find((l) => l.label === 'faces W').color);
  const e = SF.analyze(m, { kind: 'elevation', bands: 4, base: 0 });
  assert.equal(e.legend.length, 4);
  const d = SF.analyze(m, { kind: 'difference', other: (x) => 100 + x / 10 - 0.5 });
  assert.match(d.legend[0].label, /\+0.50/);
});

test('profile and cross-sections read the surface', () => {
  const z = TR.sampler(plane()).z;
  const p = SF.profile([[-10, 0, 0], [10, 0, 0]], [z], 5);
  assert.equal(p.samples.length, 5);
  near(p.length, 20);
  nearArr(p.samples.map((x) => x.values[0]), [99, 99.5, 100, 100.5, 101], 1e-9);
  const xs = SF.sections([[0, 0, 10], [0, 0, -10]], [z], { interval: 10, left: 10, right: 10, step: 5 });
  assert.equal(xs.length, 3);
  // walking north, right is east: higher
  nearArr(xs[0].points.map((q) => q.values[0]), [99, 99.5, 100, 100.5, 101], 1e-9);
});

test('a pad at 100.0 on the inclined plane: fill on the low side, cut on the high side, batters meet the ground', () => {
  const ground = TR.sampler(plane()).z;
  const sq = [[-4, 0, -4], [4, 0, -4], [4, 0, 4], [-4, 0, 4]];
  const { mesh, daylight } = SF.padMesh(sq, { elevation: 100, cut_slope: 2, fill_slope: 3, ground });
  for (const p of daylight) near(p[1], ground(p[0], p[2]), 1e-3);
  const west = daylight.filter((p) => p[0] < 0); // ground below the pad: fill, 3:1 slopes reach further
  const east = daylight.filter((p) => p[0] > 0);
  assert.ok(west.every((p) => p[1] < 100) && east.every((p) => p[1] > 100));
  assert.ok(Math.abs(west[0][0]) > Math.abs(east[0][0]), 'the 3:1 fill reaches further than the 2:1 cut');
  assert.equal(mesh.f.length, 1 + 2 * 16, "the top, and the batter as triangles every 2 m");
  assert.ok(mesh.f.every((f) => {
    let ny = 0;
    f.forEach((i, k) => {
      const [p, q] = [mesh.v[i], mesh.v[f[(k + 1) % f.length]]];
      ny += (p[2] - q[2]) * (p[0] + q[0]);
    });
    return ny >= -1e-9;
  }), 'every face faces up');
  const graded = SF.padMesh(sq, { elevation: 100.5, grade: 2, bearing: 90, ground });
  near(graded.mesh.v[4][1] - graded.mesh.v[0][1], 0.16, 1e-9, '2 % over 8 m to the east');
});

test('smoothing keeps the surveyed points and the boundary; contours to a surface; sculpting; grids', () => {
  const v = [[0, 0, 0], [10, 0, 0], [0, 0, 10], [10, 0, 10], [5, 3, 5]];
  const m = { v, f: [[0, 4, 1], [1, 4, 3], [3, 4, 2], [2, 4, 0]] };
  const s = SF.smoothMesh(m, { levels: 2, iterations: 20 });
  for (const p of v) assert.ok(s.v.some((q) => q.every((x, k) => Math.abs(x - p[k]) < 1e-9)), 'surveyed points kept');
  assert.equal(s.f.length, 4 * 16);
  // two rings of contours become a hill; the flat top is lifted
  const ringPts = (r, y) => Array.from({ length: 24 }, (_, k) => [r * Math.cos((k * Math.PI) / 12), y, r * Math.sin((k * Math.PI) / 12)]);
  const cs = SF.contourSurface([{ pts: ringPts(20, 100), closed: true }, { pts: ringPts(10, 101), closed: true }], { spacing: 3 });
  assert.ok(cs.lifted > 0, 'flat triangles inside the top contour got points between the levels');
  const z = TR.sampler(cs.mesh).z;
  near(z(15, 0), 100.5, 0.2);
  // brushes
  const g = SF.gridMesh(20, 20, 1, 0);
  const up = SF.sculpt(g, { at: [0, 0], radius: 5, inner: 1, operation: 'raise', strength: 1 });
  near(Math.max(...up.v.map((p) => p[1])), 1);
  assert.equal(up.v.find((p) => Math.hypot(p[0], p[2]) >= 5)?.[1], 0, 'nothing outside the radius');
  const flat = SF.sculpt(up, { at: [0, 0], radius: 8, operation: 'flatten', strength: 1, height: 0.25 });
  near(flat.v.find((p) => p[0] === 0 && p[2] === 0)[1], 0.25);
  near(SF.brushWeight([3, 0], { radius: 4, shape: 'square' }), SF.brushWeight([3, 3], { radius: 4, shape: 'square' }), 1e-12);
  assert.equal(SF.brushWeight([3, 0], { radius: 4, shape: 'ellipse', ratio: 0.5, angle: 90 }), SF.brushWeight([0, 3], { radius: 4, shape: 'ellipse', ratio: 0.5 }));
  assert.throws(() => SF.sculpt(g, { at: [100, 100], radius: 2 }), /touches no point/);
  // an ESRI ASCII grid in project coordinates
  const asc = 'ncols 3\nnrows 2\nxllcorner 650000\nyllcorner 5400000\ncellsize 10\nNODATA_value -9999\n100 101 102\n103 -9999 105\n';
  const grid = SF.parseAsciiGrid(asc);
  nearArr(grid.affine, [10, 0, 650000, 0, -10, 5400020]);
  const dm = SF.demMesh(grid, (E, N, Z) => [E - 650000, Z, -(N - 5400000)]);
  assert.equal(dm.mesh.v.length, 5);
  nearArr(dm.mesh.v[0], [5, 100, -15]);
  assert.equal(dm.mesh.f.length, 2, 'no triangles over the hole');
});
