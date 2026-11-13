// COGO (#227): the maths against hand-worked answers, and the commands on a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as C from '../src/core/cogo.js';
import * as F from '../src/core/fields.js';

test('cogo: directions in the forms a field book uses', () => {
  near(C.direction('N45°30\'E'), 45.5);
  near(C.direction('S 30 E'), 150);
  near(C.direction('S30W'), 210);
  near(C.direction('n 10 w'), 350);
  near(C.direction('123°30\'36"'), 123.51);
  near(C.direction(400), 40);
  near(C.direction('R90', { prev: 10 }), 100);
  near(C.direction('L45', { prev: 10 }), 325);
  near(C.direction('AR270', { prev: 0 }), 90, 1e-9); // backsight is 180, +270 clockwise = 90
  assert.throws(() => C.direction('R90'), /needs a direction before it/);
  assert.throws(() => C.direction('N95E'), /0 to 90/);
  assert.equal(C.quadrant(210), 'S 30°00\'00.0" W');
  assert.deepEqual(F.readAngle('N45E'), { value: 'N45E' });
  assert.deepEqual(F.readAngle('L12'), { value: 'L12' });
  assert.ok(F.readAngle('north').error);
});

test('cogo: inverse, polar and area', () => {
  const r = C.inverse({ n: 0, e: 0, z: 10 }, { n: -30, e: -40, z: 12 });
  near(r.hd, 50);
  near(r.azimuth, 180 + (Math.atan2(40, 30) * 180) / Math.PI);
  near(r.dz, 2);
  near(r.grade, 4);
  near(r.sd, Math.hypot(50, 2));
  const p = C.polar({ n: 100, e: 200, z: 0 }, 90, 25, 1);
  near(p.e, 225);
  near(p.n, 100);
  near(p.z, 1);
  const a = C.area([{ n: 0, e: 0 }, { n: 0, e: 20 }, { n: 10, e: 20 }, { n: 10, e: 0 }]);
  near(a.area, 200);
  near(a.perimeter, 60);
});

test('cogo: a closed traverse, its closure and the compass rule', () => {
  // a 100 m square with a 0.04 m error on the last leg
  const start = { n: 1000, e: 500, z: 0 };
  const legs = [{ dir: 'N0E', dist: 100 }, { dir: 'R90', dist: 100 }, { dir: 'R90', dist: 100 }, { dir: 'R90', dist: 100.04 }, { dir: 45, dist: 10, side: true }];
  const t = C.traverse(start, legs);
  near(t.length, 400.04);
  const c = C.closure(t.points[3], start, t.length);
  near(c.linear, 0.04);
  near(c.ratio, 400.04 / 0.04, 1e-3);
  const adj = C.compassAdjust(t, start);
  near(adj.points[3].e, 500, 1e-9);
  near(adj.points[3].n, 1000, 1e-9);
  near(adj.points[1].e, 600 + 0.04 * (200 / 400.04), 1e-9); // the error spread by distance travelled
  near(adj.points[4].e - adj.points[3].e, Math.sin(Math.PI / 4) * 10, 1e-9); // the sideshot moved with its station
});

test('cogo: intersections, one or two answers', () => {
  const A = { n: 0, e: 0 };
  const B = { n: 0, e: 100 };
  const [x] = C.bearingBearing(A, 45, B, 315);
  near(x.e, 50);
  near(x.n, 50);
  assert.equal(C.bearingBearing(A, 0, B, 180).length, 0, 'parallel');
  const two = C.distanceDistance(A, 50, B, 50);
  assert.equal(two.length, 1, 'touching circles: one answer');
  const dd = C.distanceDistance(A, 60, B, 80);
  assert.equal(dd.length, 2);
  for (const p of dd) near(Math.hypot(p.e, p.n), 60), near(Math.hypot(p.e - 100, p.n), 80);
  assert.ok(dd[0].n > 0 && dd[0].side === 'left', 'left of A→B (east) is north');
  const bd = C.bearingDistance(A, 90, B, 30);
  assert.deepEqual(bd.map((p) => Math.round(p.e)), [70, 130], 'the nearer first');
  assert.equal(C.distanceDistance(A, 10, B, 10).length, 0, 'too short');
});

test('cogo: station and offset along a line, and back', () => {
  const line = [{ n: 0, e: 0, z: 0 }, { n: 0, e: 100, z: 10 }, { n: 100, e: 100, z: 10 }];
  const so = C.stationOffset(line, { n: -5, e: 40 }, 1000);
  near(so.station, 1040);
  near(so.offset, 5, 1e-9); // south of an eastward line is right
  const so2 = C.stationOffset(line, { n: 50, e: 90 });
  near(so2.station, 150);
  near(so2.offset, -10, 1e-9); // west of a northward line is left
  const p = C.atStation(line, 150, 10);
  near(p.e, 110);
  near(p.n, 50);
  const q = C.atStation(line, 40, -5);
  near(q.n, 5);
  near(q.z, 4);
});

test('cogo: the curve solver from any two parts', () => {
  const ref = C.solveCurve({ radius: 100, delta: 60 });
  near(ref.length, (100 * Math.PI) / 3);
  near(ref.tangent, 100 * Math.tan(Math.PI / 6));
  near(ref.chord, 100);
  for (const [a, b] of [['radius', 'tangent'], ['delta', 'chord'], ['length', 'chord'], ['tangent', 'external'], ['chord', 'middle'], ['radius', 'middle']]) {
    const c = C.solveCurve({ [a]: ref[a], [b]: ref[b] });
    near(c.radius, 100, 1e-6);
    near(c.delta, 60, 1e-6);
  }
  assert.throws(() => C.solveCurve({ radius: 10 }), /exactly two/);
  assert.throws(() => C.solveCurve({ radius: 10, chord: 30 }), /No curve/);
});

test('cogo commands: traverse stores points, intersect and offset points, reports for the AI', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('add_point', { name: 'CP1', n: 5000, e: 2000, z: 50 });
  await reg.run('add_point', { name: 'CP2', n: 5000, e: 2100, z: 51 });
  const inv = await reg.run('cogo_inverse', { from: 'CP1', to: 'CP2' });
  assert.equal(inv.bearing, 'N 90°00\'00.0" E');
  assert.equal(inv.hd, 100);
  assert.match(inv.report, /CP1 → CP2: N 90°00'00.0" E/);
  const tr = await reg.run('cogo_traverse', { from: 'CP1', backsight: 'CP2', legs: [{ direction: 'R90', distance: 50 }, { direction: 'R90', distance: 100 }, { direction: 'R90', distance: 50 }], close_to: 'CP2', code: 'TRAV' });
  assert.equal(tr.closure.misclosure, 0);
  assert.equal(tr.closure.area, 5000);
  assert.equal(tr.stored.length, 2, 'the leg that closes on CP2 is not a new point');
  assert.equal(tr.stored[0].n, 5050);
  assert.equal(tr.stored[0].code, 'TRAV');
  const x = await reg.run('cogo_intersect', { point1: 'CP1', distance1: 60, point2: 'CP2', distance2: 80, solution: 2, name: 'X' });
  assert.equal(x.solutions.length, 2);
  assert.equal(x.stored[0].name, 'X');
  assert.ok(x.stored[0].n < 5000, 'answer 2 is right of CP1→CP2: south');
  const o = await reg.run('cogo_offset_point', { line: ['CP1', 'CP2'], station: 25, offset: -3 });
  assert.equal(o.n, 5003);
  assert.equal(o.e, 2025);
  near(o.z, 50.25);
  const so = await reg.run('cogo_station_offset', { line: ['CP1', 'CP2'], point: o.stored[0].name });
  assert.deepEqual(so.points[0], { point: o.stored[0].name, station: 25, offset: -3, side: 'left' });
  const ar = await reg.run('cogo_area', { points: ['CP1', 'CP2', tr.stored[1].name, tr.stored[0].name] });
  assert.equal(ar.area, 5000);
  assert.equal(ar.hectares, 0.5);
  const cv = await reg.run('cogo_curve', { radius: 100, delta: '60°00\'00"' });
  near(cv.chord, 100, 1e-3);
  // the AI's view of the schemas: plain JSON Schema, the UI hints stripped
  const listed = reg.list().find((c) => c.name === 'cogo_intersect');
  assert.ok(!JSON.stringify(listed.params).includes('"ui"'));
  assert.equal(ctx.doc.entities.filter((e) => e.type === 'point').length, 6);
});
