// Phase 7 through the command registry: PDF / image import, calibration, georeferencing, extraction, drafting,
// linework to model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import { makePdf } from './fixtures/make-pdf.js';
import * as D from '../src/core/document.js';
import * as S from '../src/core/survey.js';

// a PNG header is all import_image reads (the renderer decodes pixels)
const png = (w, h) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const withFiles = (ctx, files, written = {}) => {
  const get = async (p) => {
    if (files[p] === undefined) throw new Error(`no file ${p}`);
    return files[p];
  };
  ctx.io = { readBinary: get, readText: get, writeText: async (p, t) => (written[p] = t) };
  return written;
};

test('import a PDF at 1:500, calibrate, georeference, extract linework, elevate from spot heights', async () => {
  const { ctx, reg } = makeCtx();
  const pdf = makePdf({
    layers: ['Kerbs', 'Levels'],
    content: `/OC /oc1 BDC 1 0 0 RG 1 w 100 100 m 200 100 l S 200 100 m 200 200 l S 0 0 1 RG 300 300 m 350 300 l S EMC
/OC /oc2 BDC BT /F1 8 Tf 100 104 Td (101.50) Tj ET BT /F1 8 Tf 200 204 Td (103.50) Tj ET BT /F1 8 Tf 199 104 Td (102.00) Tj ET EMC`,
  });
  const written = withFiles(ctx, { 'C:/site.pdf': pdf });
  const info = await reg.run('pdf_info', { path: 'C:/site.pdf' });
  assert.deepEqual(info.layers.map((l) => l.name), ['Kerbs', 'Levels']);
  const r = await reg.run('import_pdf', { path: 'C:/site.pdf', scale: '1:500' });
  const u = r.underlays[0];
  assert.equal(u.kind, 'pdf');
  near(u.metres_per_unit[0], (0.0254 / 72) * 500, 1e-4);
  near(u.size[0], 595 * (0.0254 / 72) * 500, 0.01);
  // the kerb starts at page (100, 742): make its first leg 10 m long pointing east, starting on survey point K1
  await reg.run('add_point', { name: 'K1', n: 5400000, e: 650000, z: 100 });
  await reg.run('calibrate_underlay', { id: u.id, scale: { a: { u: 100, v: 742 }, b: { u: 200, v: 742 }, distance: 10 }, orient: { a: { u: 100, v: 742 }, b: { u: 200, v: 742 }, bearing: 90 }, move: { from: { u: 100, v: 742 }, to: 'K1' } });
  const ex = await reg.run('extract_linework', { id: u.id, layers: ['Kerbs'], colors: ['#ff0000'] });
  assert.equal(ex.curves, 1, 'the two touching red pieces join into one polyline; the blue one is filtered out');
  const kerb = ctx.doc.entities.find((e) => e.id === ctx.selection.get()[0]);
  assert.equal(kerb.tag, 'PDF Kerbs');
  const pts = D.curvePoints(ctx.doc, kerb);
  nearArr(pts[0], [0, 0, 0], 1e-3);
  nearArr(pts[1], [10, 0, 0], 1e-3);
  nearArr(pts[2], [10, 0, -10], 1e-3); // up the page is north: −z
  // georeference from two control pairs, then a third that disagrees
  await reg.run('add_control_pair', { id: u.id, from: { u: 100, v: 742 }, to: { n: 5400100, e: 650100 } });
  await reg.run('add_control_pair', { id: u.id, from: { u: 200, v: 742 }, to: { n: 5400100, e: 650120 } });
  const g = await reg.run('georeference_underlay', { id: u.id });
  near(g.metres_per_unit[0], 0.2, 1e-6);
  near(g.rms, 0, 1e-6);
  await reg.run('add_control_pair', { id: u.id, from: { u: 200, v: 642 }, to: { n: 5400121, e: 650120 } });
  near((await reg.run('georeference_underlay', { id: u.id, method: 'affine' })).rms, 0, 1e-6, 'three pairs fit an affine exactly');
  const h3 = await reg.run('georeference_underlay', { id: u.id, method: 'helmert' });
  assert.ok(h3.rms > 0.1 && h3.pairs.length === 3);
  await reg.run('edit_control_pair', { id: u.id, pair: 2, enabled: false });
  near((await reg.run('georeference_underlay', { id: u.id })).rms, 0, 1e-6);
  // spot heights sit next to the kerb vertices
  const t = await reg.run('list_drawing_text', { id: u.id, contains: '^\\d+\\.\\d+$' });
  assert.equal(t.count, 3);
  const ex2 = await reg.run('extract_linework', { id: u.id, layers: ['Kerbs'], colors: ['#ff0000'], layer: 'Kerb 2' });
  assert.equal(ex2.curves, 1);
  const k2 = ctx.doc.entities.find((e) => e.tag === 'Kerb 2');
  await reg.run('elevate_linework', { ids: [k2.id], mode: 'text', underlay: u.id, max_distance: 5 });
  nearArr(D.curvePoints(ctx.doc, k2).map((p) => S.toProject(ctx.doc, p).z), [101.5, 102, 103.5], 1e-3);
  // world file of the georeferenced sheet: 0.2 m per point, east along u
  await reg.run('export_world_file', { id: u.id, path: 'C:/site.pgw' });
  const wf = written['C:/site.pgw'].trim().split('\n').map(Number);
  nearArr(wf.slice(0, 4), [0.2, 0, 0, -0.2], 1e-9);
  near(wf[4], 650100 - 100 * 0.2 + 0.1, 1e-6);
});

test('an image placed by its world file, then cropped and faded', async () => {
  const { ctx, reg } = makeCtx();
  withFiles(ctx, { 'C:/ortho.png': png(1000, 500), 'C:/ortho.pgw': '0.1\n0\n0\n-0.1\n650000.05\n5400049.95\n' });
  const r = await reg.run('import_image', { path: 'C:/ortho.png' });
  assert.equal(r.placed_by, 'world file ortho.pgw');
  assert.deepEqual(S.geo(ctx.doc).base, [650100, 5400000, 0], 'the image centre, rounded, set the base point');
  nearArr(r.min, [-100, 0, -50], 1e-6);
  nearArr(r.max, [0, 0, 0], 1e-6);
  await reg.run('set_underlay', { id: r.id, clip: [[-100, 0, 0], [-50, 0, 0], [-50, 0, -25]], fade: 0.5 });
  const e = ctx.doc.entities.find((x) => x.id === r.id);
  nearArr(e.underlay.clip.flat(), [0, 500, 500, 500, 500, 250], 1e-6);
  assert.equal(e.underlay.fade, 0.5);
  await assert.rejects(reg.run('extract_linework', { id: r.id }), /image/);
  await assert.rejects(reg.run('import_image', { path: 'C:/ortho.png', world_file: 'C:/missing.pgw' }), /World file/);
  const plain = await reg.run('import_image', { path: 'C:/ortho.png', scale: 0.05 });
  near(plain.size[0], 50, 1e-9, 'scale wins over the world file');
});

test('drafting on curves and linework to model', async () => {
  const { ctx, reg } = makeCtx();
  const pts = (ref) => D.curvePoints(ctx.doc, ctx.doc.entities.find((e) => e.id === ref || e.name === ref));
  await reg.run('create_curve', { points: [[0, 0, 0], [10, 0, 0]], name: 'A' });
  await reg.run('create_curve', { points: [[3, 0, -1], [3, 0, 1]], name: 'C1' });
  await reg.run('create_curve', { points: [[7, 0, -1], [7, 0, 1]], name: 'C2' });
  const tr = await reg.run('trim', { id: 'A', at: [5, 0, 0.2] });
  assert.equal(tr.length, 2);
  nearArr(pts('A').at(-1), [3, 0, 0]);
  await reg.run('delete', { ids: [tr[1].id] });
  await reg.run('extend', { id: 'A', boundaries: ['C2'] });
  nearArr(pts('A').at(-1), [7, 0, 0]);
  const o = await reg.run('offset_curve', { id: 'A', distance: 2, side: 'left' });
  nearArr(pts(o[0].id)[0], [0, 0, -2], 1e-9); // left of travel east is north: −z
  const thr = await reg.run('offset_curve', { id: 'A', through: [2, 0, 1.5] });
  nearArr(pts(thr[0].id)[0], [0, 0, 1.5], 1e-9);
  // an L becomes a rounded corner
  await reg.run('create_curve', { points: [[20, 0, 0], [30, 0, 0], [30, 0, -10]], name: 'L' });
  await reg.run('fillet', { ids: ['L'], radius: 3 });
  for (const p of pts('L').slice(1, -1)) near(Math.hypot(p[0] - 27, p[2] + 3), 3, 1e-3);
  // two loose lines meet at a corner and get chamfered
  await reg.run('create_curve', { points: [[40, 0, 0], [48, 0, 0]], name: 'P' });
  await reg.run('create_curve', { points: [[50, 0, -2], [50, 0, -10]], name: 'Q' });
  const ch = await reg.run('chamfer', { ids: ['P', 'Q'], distance: 1 });
  assert.equal(ch.joined, 'Q');
  nearArr(pts('P').flat(), [40, 0, 0, 49, 0, 0, 50, 0, -1, 50, 0, -10], 1e-9);
  // four pieces of a square joined, closed, extruded into a live block
  const sides = [[[60, 0, 0], [64, 0, 0]], [[64, 0, 0], [64, 0, -4]], [[64, 0, -4], [60, 0, -4]], [[60, 0, -4], [60, 0, 0]]];
  for (const [i, s] of sides.entries()) await reg.run('create_curve', { points: s, name: `Sq ${i}`, tag: 'A-BLDG' });
  const j = await reg.run('join_curves', { layer: 'A-BLDG' });
  assert.deepEqual([j.before, j.after, j.closed], [4, 1, 1]);
  const sq = ctx.doc.entities.find((e) => e.tag === 'A-BLDG' && e.curve);
  assert.equal((await reg.run('extrude_linework', { layer: 'A-BLDG', height: 6 })).solids, 1);
  const block = ctx.doc.entities.find((e) => e.derived?.generator === 'extrude_curve');
  nearArr(D.worldBox(ctx.doc, block).max, [64, 6, 0]);
  await reg.run('elevate_linework', { ids: [sq.id], mode: 'constant', elevation: 2 });
  near(D.worldBox(ctx.doc, block).min[1], 2, 1e-9, 'the block follows its footprint');
  near(D.worldBox(ctx.doc, block).max[1], 8, 1e-9);
  await reg.run('elevate_linework', { ids: ['A'], mode: 'grade', start: 100, end: 107 });
  nearArr(pts('A').map((p) => p[1]), [100, 107]);
  assert.equal((await reg.run('linework_to_breaklines', { ids: ['A'], code: 'KERB' })).points, 2);
  assert.equal((await reg.run('divide_curve', { id: 'A', spacing: 3.5, code: 'STK' })).points.length, 3);
  assert.equal((await reg.run('break_curve', { id: 'A', at: [3, 0, 0] })).length, 2);
  await reg.run('create_curve', { points: [[0, 0, 5], [1, 0, 5.0001], [2, 0, 5], [3, 0, 5]], name: 'S' });
  const sim = await reg.run('simplify_curve', { ids: ['S'], tolerance: 0.01 });
  assert.deepEqual([sim.points_before, sim.points_after], [4, 2]);
  assert.ok((await reg.run('explode_curve', { id: 'L' })).pieces > 3);
  await reg.run('create_curve', { points: [[0, 0, 20], [5, 0, 20]], name: 'K', tag: 'Kerbs' });
  assert.equal((await reg.run('sweep_linework', { layer: 'Kerbs', profile: 'kerb' })).sweeps, 1);
  await reg.run('undo');
  assert.ok(!ctx.doc.entities.some((e) => e.derived?.generator === 'sweep'), 'the compound sweep is one undo step');
});
