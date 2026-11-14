// Features in a scan (#300): planes, corners and kerb edges found in the synthetic corridor scan, against its truth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CF from '../src/core/cloudfeatures.js';
import { makeScan, SITE, PARTS, groundAt } from './fixtures/scan.js';

const O = SITE.origin;
/** The fixture (x east, y north, z up) in model space (x east, y up, z south), base point at its origin. */
export function modelPoints(b) {
  const pts = new Float32Array(b.count * 3);
  for (let i = 0; i < b.count; i++) (pts[i * 3] = b.x[i] - O[0]), (pts[i * 3 + 1] = b.z[i] - O[2]), (pts[i * 3 + 2] = -(b.y[i] - O[1]));
  return pts;
}
const ground = (x, n) => groundAt(O[0] + x, O[1] + n) - O[2]; // model x, north
const deg = (a, b) => (Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

let scan = null;
const site = () => {
  if (scan) return scan;
  const b = makeScan({ points: 2e6, seed: 1 });
  const pts = modelPoints(b);
  const t0 = Date.now();
  const r = CF.detectPlanes(pts, { minPoints: 300 });
  return (scan = { b, pts, ...r, ms: Date.now() - t0 });
};

// the truth: each building wall and roof face as { normal, point } in model space
function truthFaces() {
  const out = [];
  for (const B of SITE.buildings) {
    const [[x0, n0], , [x1, n1]] = B.footprint.map(([e, n]) => [e - O[0], n - O[1]]);
    const base = B.base - O[2];
    const mx = (x0 + x1) / 2;
    const mn = (n0 + n1) / 2;
    out.push({ name: 'west wall', normal: [1, 0, 0], point: [x0, base + 1, -mn] }, { name: 'east wall', normal: [1, 0, 0], point: [x1, base + 1, -mn] });
    out.push({ name: 'south wall', normal: [0, 0, 1], point: [mx, base + 1, -n0] }, { name: 'north wall', normal: [0, 0, 1], point: [mx, base + 1, -n1] });
    if (B.roof === 'flat') out.push({ name: 'flat roof', normal: [0, 1, 0], point: [mx, B.height + base, -mn] });
    else {
      const eaves = base + 5;
      const k = 3 / ((n1 - n0) / 2); // rise over half the depth
      const L = Math.hypot(1, k);
      out.push({ name: 'south roof', normal: [0, 1 / L, k / L], point: [mx, eaves, -n0] }, { name: 'north roof', normal: [0, 1 / L, -k / L], point: [mx, eaves, -n1] });
    }
  }
  return out;
}

test('eigen3 and the neighbourhood helpers', () => {
  const e = CF.eigen3([4, 0, 0, 2, 0, 1]);
  assert.deepEqual(e.values, [4, 2, 1]);
  assert.deepEqual(e.vectors[2].map(Math.abs), [0, 0, 1]);
  const r = CF.eigen3([2, 1, 0, 2, 0, 3]); // eigenvalues 3, 3, 1
  assert.ok(Math.abs(r.values[2] - 1) < 1e-9 && Math.abs(r.values[0] - 3) < 1e-9);
  const pts = new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 5, 5, 5]);
  const g = CF.voxelGrid(pts, 0.5);
  assert.equal(g.count, 2);
  assert.deepEqual(CF.neighbours(g, pts, [0, 0, 0], 0.2).sort(), [0, 1, 2]);
  const f = CF.covarianceFeatures(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0.5, 0, 0.5]), [0, 1, 2, 3, 4]);
  assert.ok(f.normal[1] > 0.999 && f.planarity > 0.9 && f.verticality < 1e-6);
});

test('every wall and roof face of the buildings: normal within 0.5°, offset within 1 cm; no plane in the trees', () => {
  const { planes, b, ms, voxel } = site();
  for (const t of truthFaces()) {
    const off = (p) => Math.abs(t.normal[0] * p.centroid[0] + t.normal[1] * p.centroid[1] + t.normal[2] * p.centroid[2] - (t.normal[0] * t.point[0] + t.normal[1] * t.point[1] + t.normal[2] * t.point[2]));
    // the plane facing that way nearest the face's point
    const p = planes.filter((q) => deg(q.normal, t.normal) < 5).sort((a, c) => Math.abs(a.d * (a.normal[0] * t.normal[0] + a.normal[1] * t.normal[1] + a.normal[2] * t.normal[2] > 0 ? 1 : -1) - (t.normal[0] * t.point[0] + t.normal[1] * t.point[1] + t.normal[2] * t.point[2])) - Math.abs(c.d * (c.normal[0] * t.normal[0] + c.normal[1] * t.normal[1] + c.normal[2] * t.normal[2] > 0 ? 1 : -1) - (t.normal[0] * t.point[0] + t.normal[1] * t.point[1] + t.normal[2] * t.point[2])))[0];
    assert.ok(p, `${t.name}: no plane`);
    assert.ok(deg(p.normal, t.normal) < 0.5, `${t.name}: normal off by ${deg(p.normal, t.normal).toFixed(3)}°`);
    assert.ok(off(p) < 0.01, `${t.name}: offset off by ${off(p).toFixed(4)} m`);
    assert.equal(p.type, t.normal[1] === 0 ? 'vertical' : t.normal[1] === 1 ? 'horizontal' : 'sloped');
  }
  const tree = PARTS.indexOf('tree');
  for (const p of planes) {
    let n = 0;
    for (const i of p.inliers) n += b.part[i] === tree;
    assert.ok(n < p.count / 2, `a plane in the trees at ${p.centroid.map((x) => x.toFixed(1))}`);
  }
  assert.ok(voxel > 0.15 && voxel < 1);
  console.log(`  2 M points: ${planes.length} planes in ${ms} ms (voxel ${voxel.toFixed(2)} m)`);
});

test('the corners of each building within 3 cm in plan, spanning the wall height within 10 cm', () => {
  const { pts, planes, grid } = site();
  const corners = CF.detectCorners(pts, planes, { grid });
  const truth = SITE.buildings.flatMap((B) => B.footprint.map(([e, n]) => ({ x: e - O[0], n: n - O[1], base: B.base - O[2], top: B.base - O[2] + (B.roof === 'flat' ? B.height : 5) })));
  assert.equal(corners.length, truth.length, 'one corner per building corner');
  for (const t of truth) {
    const c = corners.find((k) => Math.hypot(k.base[0] - t.x, -k.base[2] - t.n) < 0.03);
    assert.ok(c, `no corner within 3 cm of ${t.x}, ${t.n}`);
    assert.ok(Math.hypot(c.top[0] - t.x, -c.top[2] - t.n) < 0.03);
    // the wall's foot: its base, or the ground where the ground hides the bottom of it
    const foot = Math.min(Math.abs(c.base[1] - t.base), Math.abs(c.base[1] - Math.max(t.base, ground(t.x, t.n))));
    assert.ok(foot < 0.1, `corner ${t.x}, ${t.n}: foot at ${c.base[1].toFixed(3)}, wall from ${t.base.toFixed(3)}`);
    assert.ok(Math.abs(c.top[1] - t.top) < 0.1, `corner ${t.x}, ${t.n}: top at ${c.top[1].toFixed(3)}, wall to ${t.top.toFixed(3)}`);
    assert.ok(Math.abs(c.angle - 90) < 0.5);
  }
  // in a horizontal slice 1 m above the first building's base: the same corners at that level
  const lvl = truth[0].base + 1;
  const at = CF.detectCorners(pts, planes, { grid, level: lvl });
  assert.ok(at.length >= 4 && at.every((k) => Math.abs(k.point[1] - lvl) < 1e-9));
});

test('plane edges: the ridge, eaves and the flat roof edges; wall tops', () => {
  const { pts, planes } = site();
  const edges = CF.planeEdges(pts, planes);
  const B2 = SITE.buildings[1];
  const ridgeY = B2.base - O[2] + 8;
  const ridge = edges.find((e) => Math.abs(e.from[1] - ridgeY) < 0.05 && Math.abs(e.to[1] - ridgeY) < 0.05 && Math.abs(e.from[2] + 57) < 0.05);
  assert.ok(ridge, 'the ridge');
  assert.ok(Math.abs(ridge.length - 12) < 0.2, `ridge length ${ridge.length}`);
  const B1 = SITE.buildings[0];
  const roofY = B1.base - O[2] + 6;
  assert.equal(edges.filter((e) => Math.abs(e.from[1] - roofY) < 0.03 && Math.abs(e.to[1] - roofY) < 0.03 && e.length > 9).length, 4, 'the flat roof meets its four walls');
  const tops = CF.wallTops(pts, planes);
  const south = tops.find((t) => planes[t.plane].type === 'vertical' && Math.abs(planes[t.plane].d * planes[t.plane].normal[2] + 55) < 0.05);
  assert.ok(south.points.every((p) => Math.abs(p[1] - roofY) < 0.05), 'the south wall of the flat-roofed building tops out at its roof');
});

test('kerb top and bottom along the road within 3 cm in plan and 1 cm in height', () => {
  const { pts } = site();
  const [[e0, n0], [e1]] = SITE.road.centreline;
  const path = [[e0 - O[0], 0, -(n0 - O[1]), 0], [e1 - O[0], 0, -(n0 - O[1]), e1 - e0]];
  const t0 = Date.now();
  const steps = CF.stepEdges(pts, path, { spacing: 1 });
  const ms = Date.now() - t0;
  assert.equal(steps.length, 2, 'two kerbs, nothing else');
  for (const s of steps) {
    assert.ok(Math.abs(Math.abs(s.offset) - 3.5) < 0.03);
    assert.ok(Math.abs(s.height - 0.15) < 0.01);
    assert.ok(s.stations >= 99);
    const north = 40 - s.offset; // right of an eastbound road is south
    for (const [k, line] of [['bottom', s.bottom], ['top', s.top]])
      for (const p of line) {
        if (p[0] < 1 || p[0] > 99) continue; // the end profiles reach past the scan
        assert.ok(Math.abs(-p[2] - north) < 0.03, `${k} off in plan at x ${p[0]}`);
        const z = ground(p[0], k === 'bottom' ? 40 + Math.sign(-s.offset) * 3.5 : 40 + Math.sign(-s.offset) * 3.6);
        assert.ok(Math.abs(p[1] - z) < 0.01, `${k} off by ${(p[1] - z).toFixed(4)} m at x ${p[0].toFixed(1)}`);
      }
  }
  console.log(`  kerbs: ${steps.map((s) => `${s.stations} profiles, ${s.top.length} vertices`).join('; ')} in ${ms} ms`);
});

test('a slope break is no step; a lone point does not make one', () => {
  const prof = [];
  for (let o = -3; o <= 3; o += 0.01) prof.push([o, Math.abs(o) * 0.5]);
  assert.equal(CF.profileSteps(prof).length, 0);
  const kerb = [];
  for (let o = -3; o <= 3; o += 0.01) kerb.push([o, o > 0 ? 0.15 : 0]);
  kerb.push([1, 9]);
  const s = CF.profileSteps(kerb);
  assert.equal(s.length, 1);
  assert.ok(Math.abs(s[0].offset) < 0.03 && Math.abs(s[0].height - 0.15) < 1e-6 && s[0].side === 1);
});

test('regularise: near-vertical walls made vertical and square to the main direction', () => {
  const c = (x, z) => [x, 1, z];
  const tilt = (h, t) => [Math.cos(h) * Math.cos(t), Math.sin(t), Math.sin(h) * Math.cos(t)];
  const planes = [
    { normal: tilt(0.02, 0.03), centroid: c(0, 0), count: 1000, type: 'vertical' },
    { normal: tilt(Math.PI / 2 + 0.03, -0.02), centroid: c(5, 5), count: 800, type: 'vertical' },
    { normal: [0, 1, 0], centroid: c(0, 3), count: 500, type: 'horizontal' },
  ];
  const out = CF.regularisePlanes(planes, { tolerance: 5 });
  assert.equal(out[0].normal[1], 0);
  assert.ok(Math.abs(out[0].normal[0] * out[1].normal[0] + out[0].normal[2] * out[1].normal[2]) < 1e-12, 'square to each other');
  assert.deepEqual(out[2].normal, [0, 1, 0]);
});

test('point normals: up on the ground, level on the walls', () => {
  const { pts, b, voxel } = site();
  const t0 = Date.now();
  const N = CF.pointNormals(pts, { voxel });
  console.log(`  normals of 2 M points in ${Date.now() - t0} ms`);
  const n = b.count;
  let [gOk, gAll, wOk, wAll] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (PARTS[b.part[i]] === 'road') (gAll++, (gOk += N[i * 3 + 1] > 0.98));
    if (PARTS[b.part[i]] === 'building') (wAll++, (wOk += Math.abs(N[i * 3 + 1]) < 0.2));
  }
  assert.ok(gOk / gAll > 0.95 && wOk / wAll > 0.8, `${gOk}/${gAll} road, ${wOk}/${wAll} walls`);
});

// ---------------------------------------------------------------- the commands, on the same scan as a cloud entity

import * as D from '../src/core/document.js';
import * as Assets from '../src/core/assets.js';
import * as S from '../src/core/survey.js';
import * as CV from '../src/core/clip.js';
import { makeCtx } from './helpers.js';

function sceneWithScan() {
  const { ctx, reg } = makeCtx();
  const { pts } = site();
  S.geo(ctx.doc).base = [...O]; // project coordinates = the fixture's
  D.addEntity(ctx.doc, { type: 'pointcloud', name: 'Corridor scan', pointcloud: { asset: Assets.put(new Uint8Array(Float32Array.from(pts).buffer), { mime: 'application/x-mmr-points' }), count: pts.length / 3, colors: false }, material: { color: '#7a8a96' } });
  return { ctx, reg };
}

test('detect_planes inside a clip box: faces on the Detected layer that align a clip; propose then reject leaves nothing', async () => {
  const { ctx, reg } = sceneWithScan();
  // a box around the gable-roofed building
  await reg.run('add_clip', { kind: 'box', name: 'Depot', center: [66, 5, -57], size: [16, 14, 14] });
  const r = await reg.run('detect_planes', { within: 'Depot', min_points: 300 });
  assert.ok(r.by_type.vertical >= 4 && r.by_type.sloped >= 2, JSON.stringify(r.by_type));
  const roof = r.planes.find((p) => p.type === 'sloped');
  const e = D.getEntity(ctx.doc, roof.id);
  assert.equal(e.tag, 'Detected');
  assert.ok(e.material.opacity < 1 && e.meta.plane.rms < 0.02 && e.mesh.f.length === 1);
  // a box aligned to the roof face: one of its axes along the roof's normal
  await reg.run('add_clip', { kind: 'box', name: 'Roof box', center: [66, 10, -57], size: [4, 4, 4] });
  await reg.run('align_clip', { name: 'Roof box', to: 'face', id: roof.id, face: 0 });
  const box = ctx.doc.clips.find((c) => c.name === 'Roof box');
  assert.ok(CV.axes(box).some((ax) => Math.abs(ax[0] * roof.normal[0] + ax[1] * roof.normal[1] + ax[2] * roof.normal[2]) > 0.9999), 'an axis along the roof normal');
  // proposal mode: the corners and their planes stay pending; reject removes every one of them
  const before = ctx.doc.entities.length;
  const c = await reg.run('detect_corners', { within: 'Depot', min_points: 300, propose: true });
  assert.equal(c.count, 4);
  assert.equal(c.proposal, true);
  assert.ok(ctx.store.proposal, 'a pending proposal');
  assert.ok(ctx.doc.entities.length > before);
  const rej = await reg.run('propose', { action: 'reject' });
  assert.ok(rej.done);
  assert.equal(ctx.doc.entities.length, before, 'every detected entity of the proposal is gone');
});

test('detect_corners: CORNER points at the building corners, lines up the walls; detect_edges kerb along Main road', async () => {
  const { ctx, reg } = sceneWithScan();
  const c = await reg.run('detect_corners', { min_points: 300, classes: undefined });
  assert.equal(c.count, 8);
  for (const B of SITE.buildings)
    for (const [e, n] of B.footprint) {
      const k = c.corners.find((x) => Math.hypot(x.at[0] - e, x.at[1] - n) < 0.03);
      assert.ok(k, `a CORNER point at ${e}, ${n}`);
      const pt = ctx.doc.entities.find((x) => x.name === k.point);
      assert.equal(pt.point.code, 'CORNER');
      assert.equal(pt.tag, 'Detected');
      // the point sits on its line's foot: drawing from corner to corner lands on them
      const line = D.getEntity(ctx.doc, k.id);
      const foot = D.curvePoints(ctx.doc, line)[0];
      assert.ok(Math.hypot(...foot.map((v, i) => v - pt.position[i])) < 2e-3);
    }
  // the kerbs along the road's centreline
  const [[e0, n0], [e1, n1]] = SITE.road.centreline;
  await reg.run('create_curve', { name: 'Main road', points: [[e0 - O[0], 0, -(n0 - O[1])], [e1 - O[0], 0, -(n1 - O[1])]] });
  const k = await reg.run('detect_edges', { kind: 'kerb', alignment: 'Main road' });
  assert.equal(k.count, 4, 'kerb top and bottom, both sides');
  for (const m of k.edges) {
    const e = D.getEntity(ctx.doc, m.id);
    assert.ok(Math.abs(e.meta.edge.height - 0.15) < 0.01 && e.tag === 'Detected');
    for (const p of D.curvePoints(ctx.doc, e)) {
      if (p[0] < 1 || p[0] > 99) continue;
      const north = -p[2];
      assert.ok(Math.abs(Math.abs(north - 40) - 3.5) < 0.03, `in plan: ${north}`);
      const z = ground(p[0], 40 + Math.sign(north - 40) * (m.part === 'bottom' ? 3.5 : 3.6));
      assert.ok(Math.abs(p[1] - z) < 0.01, `${m.part} height off by ${(p[1] - z).toFixed(4)}`);
    }
  }
});

test('inliersOf: the points of known planes, read under their extents only', () => {
  const { pts, planes } = site();
  const given = planes.slice(0, 12).map(({ normal, d, extent, type }) => ({ normal, d, extent, type }));
  const t0 = Date.now();
  const got = CF.inliersOf(pts, given, 0.03);
  const ms = Date.now() - t0;
  got.forEach((g, k) => assert.ok(g.count >= planes[k].count * 0.9, `${g.count} vs ${planes[k].count}`));
  assert.ok(ms < 5000, `${ms} ms`);
});
