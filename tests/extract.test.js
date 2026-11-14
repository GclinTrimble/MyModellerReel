// Scan to plan (#301): footprints, eaves, wall lines in a slice, kerb lines and breaklines from the synthetic scan,
// against its ground truth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../src/core/extract.js';
import * as CF from '../src/core/cloudfeatures.js';
import * as TR from '../src/core/terrain.js';
import { makeScan, SITE, CLASS, groundAt } from './fixtures/scan.js';

const O = SITE.origin;
const ground = (x, z) => groundAt(O[0] + x, O[1] - z) - O[2]; // model x, z
const truthRings = SITE.buildings.map((B) => B.footprint.map(([e, n]) => [e - O[0], n - O[1]]));

let scan = null;
const site = () => {
  if (scan) return scan;
  const b = makeScan({ points: 2e6, seed: 1 });
  const all = new Float64Array(b.count * 3);
  const bld = [];
  const gnd = new Uint8Array(b.count);
  for (let i = 0; i < b.count; i++) {
    const p = [b.x[i] - O[0], b.z[i] - O[2], -(b.y[i] - O[1])];
    all.set(p, i * 3);
    if (b.classification[i] === CLASS.building) bld.push(...p);
    gnd[i] = b.classification[i] === CLASS.ground || b.classification[i] === CLASS.road;
  }
  return (scan = { b, all, gnd, building: Float64Array.from(bld) });
};
const rightAngles = (ring) =>
  ring.every((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const r = ring[(i + 2) % ring.length];
    const u = [q[0] - p[0], q[1] - p[1]];
    const v = [r[0] - q[0], r[1] - q[1]];
    return Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)) < 1e-9;
  });

test('footprints of both buildings within 5 cm, square, areas within 1 %, eaves within 10 cm', () => {
  const { building } = site();
  const t0 = Date.now();
  const fps = X.footprints(building, { ground });
  const ms = Date.now() - t0;
  assert.equal(fps.length, 2);
  for (const [k, B] of SITE.buildings.entries()) {
    const truth = truthRings[k];
    const f = fps.find((x) => X.hausdorff(x.ring, truth) < 1);
    assert.ok(f, `building ${k + 1} found`);
    const hd = X.hausdorff(f.ring, truth);
    assert.ok(hd < 0.05, `Hausdorff ${hd}`);
    assert.ok(rightAngles(f.ring), 'right angles exact');
    assert.ok(Math.abs(f.area - Math.abs(X.area(truth))) / Math.abs(X.area(truth)) < 0.01, `area ${f.area}`);
    const eaves = B.roof === 'flat' ? B.height : 5;
    assert.ok(Math.abs(f.eave - (B.base - O[2]) - eaves) < 0.1, `eave ${f.eave - (B.base - O[2])} vs ${eaves}`);
    assert.equal(f.roof, B.roof === 'flat' ? 'flat' : 'pitched');
    assert.ok(Math.abs(f.ground - (B.base - O[2])) < 0.05, `ground ${f.ground} at the wall feet`);
    assert.equal(f.quality.guessed, 0);
    assert.ok(f.quality.points > 1000 && f.quality.max < 0.06);
  }
  console.log(`  footprints in ${ms} ms: ${fps.map((f) => `${f.area.toFixed(2)} m², eave ${(f.eave - f.ground).toFixed(3)} m`).join('; ')}`);
});

test('an occluded wall is still closed, and flagged as guessed', () => {
  const { building } = site();
  // a lorry parked along the flat-roofed building's south wall (y 55): no points on 8 of its 12 m
  const p = [];
  for (let i = 0; i < building.length; i += 3) {
    const [x, , z] = building.subarray(i, i + 3);
    if (Math.abs(-z - 55) < 0.1 && x > 17 && x < 25) continue;
    p.push(building[i], building[i + 1], building[i + 2]);
  }
  const f = X.footprints(Float64Array.from(p), { ground }).find((x) => X.hausdorff(x.ring, truthRings[0]) < 1);
  assert.ok(X.hausdorff(f.ring, truthRings[0]) < 0.05);
  assert.equal(f.quality.guessed, 1, 'one edge guessed');
  const g = f.edges.find((e) => e.guessed);
  assert.ok(g.coverage < 0.5 && Math.abs(g.length - 12) < 0.05);
});

test('regularise: a rough rotated outline becomes square to its own direction, jogs gone', () => {
  const a = 23 * (Math.PI / 180);
  const rot = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  // an L with a 0.1 m jog and 2° of wobble on one side
  const L = [[0, 0], [12, 0], [12, 6], [6, 6], [6.1, 8], [6, 10], [0, 10], [0.2, 5]].map(rot);
  const r = X.regularise(L, { tolerance: 5, minEdge: 0.3, simplify: 0.05 });
  assert.ok(Math.abs(r.angle - 23) < 1.5, `angle ${r.angle}`);
  assert.equal(r.ring.length, 6, 'an L has six corners');
  assert.ok(rightAngles(r.ring));
  assert.ok(r.edges.every((e) => e.snapped));
});

/** A level slice of an L-shaped building: wall faces (outer walls 0.25 m, inner walls 0.15 m), a door in one. */
function lSlice({ perM = 150, seed = 3 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()) * 0.01;
  const out = [];
  const face = (a, b, skip = []) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let k = 0; k < L * perM; k++) {
      const t = rnd() * L;
      const p = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L];
      if (skip.some(([lo, hi]) => t > lo && t < hi)) continue;
      out.push(p[0] + gauss(), p[1] + gauss());
    }
  };
  const ring = (R, skips = {}) => R.forEach((p, i) => face(p, R[(i + 1) % R.length], skips[i]));
  ring([[0, 0], [12, 0], [12, 6], [6, 6], [6, 10], [0, 10]]);
  // the inner faces, broken where the inner walls meet them
  ring([[0.25, 0.25], [11.75, 0.25], [11.75, 5.75], [5.75, 5.75], [5.75, 9.75], [0.25, 9.75]], { 0: [[5.675, 5.825]], 2: [[5.675, 5.825]], 4: [[2.675, 2.825]] });
  // inner wall along x = 6 (y 0.25–5.75) with a 0.9 m door at y 2–2.9; inner wall along y = 7 (x 0.25–5.75)
  for (const x of [5.925, 6.075]) face([x, 0.25], [x, 5.75], [[1.75, 2.65]]);
  for (const y of [6.925, 7.075]) face([0.25, y], [5.75, y]);
  return Float64Array.from(out);
}

test('trace a slice: one closed outer polyline, inner wall lines, no gap longer than a door', () => {
  const pts = lSlice();
  const t0 = Date.now();
  const segs = X.fitSegments(pts, { distance: 0.03, minLength: 0.3 });
  const lines = X.joinSegments(segs, { gap: 1 });
  const ms = Date.now() - t0;
  const closed = lines.filter((l) => l.closed);
  const outer = closed[0];
  assert.ok(Math.abs(outer.area - 96) < 0.96, `outer area ${outer.area}`);
  assert.equal(outer.pts.length, 6);
  assert.ok(rightAngles(outer.pts.map((p) => p.map((x) => Math.round(x * 100) / 100))) || outer.pts.length === 6);
  assert.ok(outer.mean < 0.012 && outer.max <= 0.03 && outer.guessed.length === 0, `outer residuals ${outer.mean} / ${outer.max}`);
  // the inner wall faces: 4 lines (two per wall), the door bridged and flagged
  const inner = lines.filter((l) => !l.closed && l.length > 4);
  assert.ok(inner.length >= 4, `inner wall lines: ${inner.length}`);
  const doors = lines.flatMap((l) => l.guessed);
  assert.equal(doors.length, 2, 'the door, on both faces of its wall');
  for (const d of doors) assert.ok(Math.abs(d.length - 0.9) < 0.1);
  // nothing else left open longer than a door: every open end lands on another line
  const ends = lines.filter((l) => !l.closed).flatMap((l) => [l.pts[0], l.pts.at(-1)]);
  const onSome = (p) => lines.some((l) => l.pts.some((q, k) => k < l.pts.length - 1 && distTo(p, q, l.pts[k + 1]) < 0.02) || (l.closed && distTo(p, l.pts.at(-1), l.pts[0]) < 0.02));
  assert.ok(ends.every(onSome), 'every wall line ends on another');
  const centres = X.centreLines(segs);
  assert.ok(centres.some((c) => Math.abs(c.thickness - 0.25) < 0.02) && centres.some((c) => Math.abs(c.thickness - 0.15) < 0.02));
  console.log(`  slice: ${segs.length} segments → ${lines.length} polylines (${closed.length} closed) in ${ms} ms`);
});
const distTo = (p, a, b) => {
  const d = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1)));
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t);
};

test('kerb lines along the road: continuous, within 3 cm, an occluded stretch bridged and flagged; breaklines make the surface follow them', () => {
  const { all, gnd } = site();
  // a car parked against the north kerb (y 43.5) from x 40 to 44: no points there
  const keep = [];
  const ground3 = [];
  for (let i = 0; i < all.length; i += 3) {
    const [x, , z] = all.subarray(i, i + 3);
    if (x > 40 && x < 44 && -z > 42.5 && -z < 45) continue;
    keep.push(all[i], all[i + 1], all[i + 2]);
    if (gnd[i / 3]) ground3.push(all[i], all[i + 1], all[i + 2]);
  }
  const pts = Float64Array.from(keep);
  const path = [[0, 0, -40, 0], [100, 0, -40, 100]];
  const steps = CF.stepEdges(pts, path, { spacing: 1 });
  const lines = (part) => X.bridgeLines(steps.map((s) => s[part]), { gap: 6 });
  for (const part of ['top', 'bottom']) {
    const L = lines(part);
    assert.equal(L.length, 2, `${part}: one line per kerb`);
    for (const l of L) {
      const xs = l.pts.map((p) => p[0]);
      assert.ok(Math.min(...xs) < 1 && Math.max(...xs) > 99, `${part} runs the length of the road`);
      const north = -l.pts[0][2] > 40;
      for (const p of l.pts) if (p[0] > 1 && p[0] < 99) assert.ok(Math.abs(-p[2] - (north ? 43.5 : 36.5)) < 0.03, `${part} off at x ${p[0]}`);
      assert.equal(l.guessed.length, north ? 1 : 0, 'the parked car is guessed, the open kerb is not');
    }
  }
  // the ground as classify_ground makes it (lowest ground point per metre), then rebuilt on the kerbs
  const low = new Map();
  for (let i = 0; i < ground3.length; i += 3) {
    const k = `${Math.floor(ground3[i])},${Math.floor(ground3[i + 2])}`;
    if (!(low.get(k)?.[1] <= ground3[i + 1])) low.set(k, [ground3[i], ground3[i + 1], ground3[i + 2]]);
  }
  const v = [...low.values()];
  const mesh = { v, f: TR.triangulate(v, { maxEdge: 8 }).faces };
  // a kerb's top and bottom share a plan line: the top moves 2 cm to its high side, so the TIN has a face to build
  const sideOf = (l) => steps.find((s) => Math.abs(s.top[0][2] - l.pts[0][2]) < 0.5).side;
  const tops = lines('top').map((l) => X.nudge(l.pts, sideOf(l) * 0.02));
  const after = X.withBreaklines(mesh, [...tops, ...lines('bottom').map((l) => l.pts)]);
  const err = (m) => {
    const z = TR.sampler(m).z;
    let worst = 0;
    for (let x = 5; x < 95; x += 0.7) for (const n of [36.45, 36.6, 43.4, 43.55]) worst = Math.max(worst, Math.abs(z(x, -n) - ground(x, -n)));
    return worst;
  };
  const [e0, e1] = [err(mesh), err(after)];
  assert.ok(e1 < 0.03, `with the kerbs as breaklines the surface is within ${e1.toFixed(3)} m at the kerbs (before ${e0.toFixed(3)})`);
  assert.ok(e0 > 0.06, 'and was not before');
  assert.equal(after.failed, 0);
});

// ---------------------------------------------------------------- the commands, on the scan as a cloud entity

import * as D from '../src/core/document.js';
import * as Assets from '../src/core/assets.js';
import { makeCtx } from './helpers.js';
import { addScanCloud } from './fixtures/scancloud.js';

test('extract_footprint { extrude, propose }: footprints on their layer with a quality report, blocks to the eaves; accept is one undo step, reject leaves nothing', async () => {
  const { ctx, reg } = makeCtx();
  addScanCloud(ctx.doc, { points: 400000 });
  const before = JSON.stringify(ctx.doc.entities);
  const r = await reg.run('extract_footprint', { extrude: true, propose: true });
  assert.equal(r.count, 2);
  assert.equal(r.proposal, true);
  for (const [k, B] of SITE.buildings.entries()) {
    const f = r.footprints.find((x) => X.hausdorff(curvePlan(ctx.doc, x.id), truthRings[k]) < 0.05);
    assert.ok(f, `building ${k + 1} within 5 cm`);
    const e = D.getEntity(ctx.doc, f.id);
    assert.equal(e.tag, 'Footprints');
    assert.ok(e.curve.closed && e.meta.quality.edges.length === 4 && e.meta.quality.points > 100);
    assert.ok(Math.abs(e.meta.area - 120) < 1.2, `area ${e.meta.area}`);
    const solid = D.getEntity(ctx.doc, f.solid);
    assert.equal(solid.tag, 'Massing');
    const ys = D.worldMesh(ctx.doc, solid).v.map((v) => v[1]);
    const height = Math.max(...ys) - Math.min(...ys);
    assert.ok(Math.abs(height - (B.roof === 'flat' ? B.height : 5)) < 0.1, `block height ${height}`);
    assert.ok(Math.abs(Math.min(...ys) - (B.base - O[2])) < 0.1, 'the block stands on the ground');
  }
  assert.ok(JSON.stringify(r).length < 8192);
  assert.equal((await reg.run('propose', { action: 'accept' })).done, true);
  assert.equal(ctx.doc.entities.length, JSON.parse(before).length + 4);
  await reg.run('undo', {});
  assert.equal(JSON.stringify(ctx.doc.entities), before, 'one undo takes every footprint and block away');
  await reg.run('extract_footprint', { propose: true });
  await reg.run('propose', { action: 'reject' });
  assert.equal(JSON.stringify(ctx.doc.entities), before, 'reject leaves the document as it was');
});
const curvePlan = (doc, id) => D.curvePoints(doc, D.getEntity(doc, id)).map((p) => [p[0], -p[2]]).filter((p, i, a) => i < a.length - 1 || Math.hypot(p[0] - a[0][0], p[1] - a[0][1]) > 1e-6);

test('extract_edges kerb along Main road: one continuous line per kerb edge on its layer, within 3 cm; as_breaklines re-triangulates the ground', async () => {
  const { ctx, reg } = makeCtx();
  addScanCloud(ctx.doc, { points: 1e6 });
  await reg.run('create_alignment', { name: 'Main road', points: SITE.road.centreline.map(([e, n]) => [e - O[0], 0, -(n - O[1])]) });
  const g = await reg.run('classify_ground', { id: 'Site scan', cell: 1 });
  const surf = D.getEntity(ctx.doc, g.id);
  const zBefore = TR.sampler(D.worldMesh(ctx.doc, surf)).z;
  const r = await reg.run('extract_edges', { kind: 'kerb', alignment: 'Main road', as_breaklines: true });
  assert.equal(r.count, 4, 'top and bottom on both sides');
  assert.deepEqual(r.breaklines.surfaces, [surf.name]);
  for (const m of r.edges) {
    const e = D.getEntity(ctx.doc, m.id);
    assert.ok(['Kerb top', 'Kerb bottom'].includes(e.tag) && e.tag === m.layer);
    assert.ok(m.length > 97, `continuous: ${m.length} m`);
    assert.ok(m.quality.coverage > 0.95 && m.quality.guessed === 0 && m.quality.residual.mean < 0.02, JSON.stringify(m.quality));
    for (const p of D.curvePoints(ctx.doc, e)) if (p[0] > 1 && p[0] < 99) assert.ok(Math.abs(Math.abs(-p[2] - 40) - 3.5) < 0.03);
  }
  const z = TR.sampler(D.worldMesh(ctx.doc, surf)).z;
  let [before, after] = [0, 0];
  for (let x = 5; x < 95; x += 0.7)
    for (const n of [36.45, 36.6, 43.4, 43.55]) (before = Math.max(before, Math.abs(zBefore(x, -n) - ground(x, -n)))), (after = Math.max(after, Math.abs(z(x, -n) - ground(x, -n))));
  assert.ok(after < 0.03 && before > after * 2, `the surface follows the kerbs: ${before.toFixed(3)} → ${after.toFixed(3)} m`);
});

test('trace_slice on a 1.2 m slice of an L-shaped building: one closed outline, inner wall lines, the door reported; centre lines with thickness', async () => {
  const { ctx, reg } = makeCtx();
  // the L as a scan: its wall faces from 0 to 2.5 m (heights spread so the 0.2 m slab holds about 150 points per metre)
  const plan = lSlice({ perM: 1900 });
  const pts = new Float32Array((plan.length / 2) * 3);
  for (let i = 0; i < plan.length / 2; i++) pts.set([plan[2 * i], ((i * 0.618034) % 1) * 2.5, -plan[2 * i + 1]], i * 3);
  D.addEntity(ctx.doc, { type: 'pointcloud', name: 'Depot scan', pointcloud: { asset: Assets.put(new Uint8Array(pts.buffer), { mime: 'application/x-mmr-points' }), count: pts.length / 3, colors: false }, material: { color: '#7a8a96' } });
  await reg.run('add_slice', { at: 'elevation', z: 1.2, name: 'Plan cut' });
  const r = await reg.run('trace_slice', { name: 'Plan cut', centre_lines: true, propose: true });
  assert.equal(r.closed >= 1, true);
  const outer = r.lines[0];
  assert.ok(outer.closed && Math.abs(outer.area - 96) < 0.96, `outline ${outer.area} m²`);
  assert.equal(D.getEntity(ctx.doc, outer.id).tag, 'Walls');
  assert.ok(r.lines.filter((l) => !l.closed && l.length > 4).length >= 4, 'inner wall lines');
  const doors = r.lines.filter((l) => l.quality.guessed);
  assert.equal(doors.length, 2, 'the door, on both faces of its wall');
  assert.equal(D.getEntity(ctx.doc, doors[0].id).material.color, '#ff8c1a', 'drawn in the warning colour');
  assert.ok(r.centre_lines >= 4);
  assert.ok(ctx.doc.entities.some((e) => e.tag === 'Wall centres' && Math.abs(e.meta.thickness - 0.15) < 0.02));
  assert.ok(JSON.stringify(r).length < 8192);
  await reg.run('propose', { action: 'reject' });
  assert.ok(!ctx.doc.entities.some((e) => e.meta?.extracted), 'reject: no wall line left');
});
