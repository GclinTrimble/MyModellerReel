// Phase 10 through the registry: live contours and analysis, profiles, pads, smoothing, contours to surface,
// sculpting, draping, water, DEMs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as D from '../src/core/document.js';
import * as S from '../src/core/survey.js';

// a 60 × 60 m field rising 1 m per 10 m to the east, points every 10 m
async function field() {
  const m = makeCtx();
  const rows = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) rows.push(`${i * 7 + j + 1},${5400000 + i * 10},${650000 + j * 10},${(100 + j).toFixed(3)},GND`);
  await m.reg.run('import_points', { text: rows.join('\n') });
  const s = await m.reg.run('create_surface', { name: 'EG' });
  return { ...m, s };
}
const byName = (ctx, n) => ctx.doc.entities.find((e) => e.name === n);

test('contours and analysis follow the surface when a point moves', async () => {
  const { ctx, reg, s } = await field();
  const c = await reg.run('surface_contours', { id: s.id, interval: 1, major_every: 2, smooth: 0 });
  assert.equal(c.levels, 6, '101 … 106: the level on the lowest edge has no line');
  const lines = () => D.childrenOf(ctx.doc, c.id);
  const z103 = lines().find((l) => l.meta.elevation === 103);
  assert.ok(z103.meta.major === undefined && lines().find((l) => l.meta.elevation === 104).meta.major);
  for (const p of D.curvePoints(ctx.doc, z103)) near(S.toProject(ctx.doc, p).e, 650030, 1e-6);
  const a = await reg.run('analyze_surface', { id: s.id, kind: 'slope', thresholds: [5, 15] });
  assert.equal(a.legend.length, 3);
  await reg.run('edit_points', { points: ['25'], raise: 3 }); // a bump in the middle
  assert.ok(lines().length > 6, 'the bump adds closed rings around it');
  assert.ok(byName(ctx, 'EG').mesh.fc, 'the slope colours were made again');
  await reg.run('analyze_surface', { id: s.id, kind: 'none' });
  assert.ok(!byName(ctx, 'EG').mesh.fc);
});

test('profile and cross-sections with CSV out', async () => {
  const { ctx, reg } = await field();
  const files = {};
  ctx.io = { writeText: async (p, t) => (files[p] = t) };
  await reg.run('create_curve', { points: [[0, 0, -30], [60, 0, -30]], name: 'Line' });
  const p = await reg.run('surface_profile', { path: 'Line', interval: 10, csv: 'C:/p.csv' });
  assert.deepEqual(p.samples.map((x) => x.EG), [100, 101, 102, 103, 104, 105, 106]);
  assert.match(files['C:/p.csv'], /^chainage,EG\n0,100/);
  const xs = await reg.run('cross_sections', { path: [[30, 0, 0], [30, 0, -60]], interval: 30, left: 10, right: 10, step: 10 });
  assert.equal(xs.sections.length, 3);
  assert.deepEqual(xs.sections[1].points.map((q) => q.EG), [102, 103, 104], 'walking north, right is east');
});

test('a pad with batters, merged into a design surface; volumes; set_batter', async () => {
  const { ctx, reg, s } = await field();
  await reg.run('create_curve', { points: [[25, 0, -25], [35, 0, -25], [35, 0, -35], [25, 0, -35]], closed: true, name: 'Pad outline' });
  const pad = await reg.run('create_pad', { outline: 'Pad outline', elevation: 103, surface: s.id, cut_slope: 2, fill_slope: 2, merge: true });
  assert.equal(pad.design_surface, 'Design surface');
  const pm = D.worldMesh(ctx.doc, byName(ctx, 'Pad'));
  const top = pm.v.slice(0, 4).map((p) => S.toProject(ctx.doc, p).z);
  for (const z of top) near(z, 103, 1e-3);
  const cf = await reg.run('cut_fill', { existing: s.id, design: 'Design surface', map: false });
  assert.ok(cf.cut > 0 && cf.fill > 0, `cut ${cf.cut} fill ${cf.fill}`);
  near(cf.cut, cf.fill, Math.max(cf.cut, cf.fill) * 0.35, 'a pad at the middle height roughly balances');
  await reg.run('set_batter', { id: 'Pad', fill_slope: 4 });
  const pm2 = D.worldMesh(ctx.doc, byName(ctx, 'Pad'));
  const reach = (m) => Math.min(...m.v.slice(4).map((p) => p[0]));
  assert.ok(reach(pm2) < reach(pm), 'flatter fill reaches further');
  // the outline moves: the pad follows
  await reg.run('move', { ids: ['Pad outline'], by: [5, 0, 0] });
  near(Math.min(...D.worldMesh(ctx.doc, byName(ctx, 'Pad')).v.slice(0, 4).map((p) => p[0])), 30, 1e-3);
});

test('smoothing keeps the points; a surface from contours with elevations assigned in one go', async () => {
  const { ctx, reg, s } = await field();
  const sm = await reg.run('smooth_surface', { id: s.id, levels: 1 });
  assert.equal(byName(ctx, 'EG').visible, false);
  const z = (await import('../src/core/sitework.js')).surfaceSampler(ctx.doc, byName(ctx, sm.name)).z;
  const p = byName(ctx, '25').position;
  near(z(p[0], p[2]), p[1], 1e-6);
  const b = makeCtx();
  for (const r of [30, 20, 10]) {
    const pts = Array.from({ length: 16 }, (_, k) => [r * Math.cos((k * Math.PI) / 8), 0, r * Math.sin((k * Math.PI) / 8)]);
    await b.reg.run('create_curve', { points: pts, closed: true, name: `C${r}`, tag: 'Contours' });
  }
  await b.reg.run('assign_contour_elevations', { ids: ['C30', 'C20', 'C10'], start: 100, interval: 2 });
  const t = await b.reg.run('terrain_from_contours', { layer: 'Contours', spacing: 4 });
  assert.ok(t.triangles > 20);
  const zz = (await import('../src/core/sitework.js')).surfaceSampler(b.ctx.doc, byName(b.ctx, t.name)).z;
  near(zz(25, 0), 101, 0.3);
  await b.reg.run('set_curve', { id: 'C10', points: D.curvePoints(b.ctx.doc, byName(b.ctx, 'C10')).slice(0, -1).map((q) => [q[0], 110, q[2]]) });
  assert.ok(zz(0, 0) < (await import('../src/core/sitework.js')).surfaceSampler(b.ctx.doc, byName(b.ctx, t.name)).z(0, 0), 'the surface follows the raised contour');
});

test('sculpting: a grid changes, a survey surface gets an adjustment layer; stamp, drape, water, DEM', async () => {
  const { ctx, reg, s } = await field();
  const t = await reg.run('create_terrain', { width: 20, depth: 20, spacing: 1, elevation: 100, name: 'Grid' });
  const c0 = t.max[1];
  await reg.run('sculpt_terrain', { id: 'Grid', at: [0, 0, 0], radius: 4, operation: 'raise', strength: 2 });
  near(D.worldBox(ctx.doc, byName(ctx, 'Grid')).max[1] - c0, 2, 1e-9);
  const before = byName(ctx, '25').point.z;
  const r = await reg.run('sculpt_terrain', { id: s.id, at: byName(ctx, '25').position, radius: 12, operation: 'lower', strength: 1 });
  assert.equal(r.adjustments, 1);
  assert.equal(byName(ctx, '25').point.z, before, 'the surveyed point did not move');
  assert.ok(D.worldBox(ctx.doc, byName(ctx, 'EG')).min[1] < D.worldBox(ctx.doc, byName(ctx, '1')).min[1] + 0.001);
  await reg.run('create_curve', { points: [[-3, 0, -3], [3, 0, -3], [3, 0, 3], [-3, 0, 3]], closed: true, name: 'Plot' });
  await reg.run('stamp', { id: 'Grid', outline: 'Plot', elevation: 99 });
  const zg = (await import('../src/core/sitework.js')).surfaceSampler(ctx.doc, byName(ctx, 'Grid')).z;
  near(S.toProject(ctx.doc, [0, zg(0, 0), 0]).z, 99, 1e-6);
  await reg.run('create_box', { width: 1, height: 1, depth: 1, position: [40, 50, -20], name: 'Hut' });
  await reg.run('drape', { ids: ['Hut'], surface: s.id });
  near(S.toProject(ctx.doc, D.worldBox(ctx.doc, byName(ctx, 'Hut')).min).z, 104, 1e-6);
  const w = await reg.run('water_level', { surface: s.id, from: 100, to: 103, end: 4 });
  assert.equal(ctx.doc.animation.tracks.find((tr) => tr.target === w.id).keys.length, 2);
  // an ESRI ASCII grid, read through the app's file access
  const b = makeCtx();
  b.ctx.io = { readText: async () => 'ncols 4\nnrows 3\nxllcorner 650000\nyllcorner 5400000\ncellsize 5\nNODATA_value -9999\n10 11 12 13\n11 12 13 14\n12 13 14 15\n' };
  const dem = await b.reg.run('import_terrain', { path: 'C:/dem.asc' });
  assert.equal(dem.triangles, 12);
  assert.deepEqual(S.geo(b.ctx.doc).base, [650000, 5400000, 13]);
});
