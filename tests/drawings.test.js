// Phase 7: layers, underlay maths, georeferencing, PDF reading and drafting (hand-checked numbers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import { makePdf } from './fixtures/make-pdf.js';
import * as U from '../src/core/underlay.js';
import * as DR from '../src/core/drafting.js';
import * as PDF from '../src/core/pdf.js';

test('layers: current layer, ByLayer colour, globs, merge, mapping, schema, states', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_layer', { name: 'C-ROAD/Kerbs', color: '#c8553d', current: true });
  const b = await reg.run('create_box', { width: 1, height: 1, depth: 1 });
  assert.equal(ctx.doc.entities.find((e) => e.id === b.id).tag, 'C-ROAD/Kerbs', 'new geometry lands on the current layer');
  await reg.run('create_layer', { name: 'C-ROAD/Lines' });
  await reg.run('set_layer', { name: 'C-ROAD/*', visible: false });
  assert.deepEqual(ctx.doc.tags.filter((t) => t.name.startsWith('C-ROAD')).map((t) => t.visible), [false, false]);
  await reg.run('move_to_layer', { ids: [b.id], layer: 'C-ROAD/Lines', by_layer: true });
  await reg.run('set_layer', { name: 'C-ROAD/Lines', color: '#123456' });
  const L = await import('../src/core/layers.js');
  assert.equal(L.colorOf(ctx.doc, ctx.doc.entities[0]), '#123456');
  await reg.run('save_layer_state', { name: 'hidden' });
  await reg.run('set_layer', { name: '*', visible: true });
  await reg.run('restore_layer_state', { name: 'hidden' });
  assert.equal(L.layerOf(ctx.doc, 'C-ROAD/Lines').visible, false);
  const m = await reg.run('map_layers', { rules: [{ from: 'C-ROAD/*', to: 'Road' }] });
  assert.equal(m.mapped.length, 2);
  assert.equal(ctx.doc.entities[0].tag, 'Road');
  assert.ok(!L.layerOf(ctx.doc, 'C-ROAD/Kerbs'));
  assert.equal(ctx.doc.settings.current_layer, 'Road', 'the current layer follows a merge');
  await reg.run('set_layer', { name: 'Road', schema: { surface: { type: 'string', options: ['asphalt', 'gravel'], default: 'asphalt' }, width: { type: 'number' } } });
  await reg.run('move_to_layer', { ids: [b.id], layer: 'Road' });
  assert.equal(ctx.doc.entities[0].meta.surface, 'asphalt', 'schema defaults');
  await assert.rejects(reg.run('set_metadata', { ids: [b.id], values: { width: 'wide' } }), /number/);
  const list = await reg.run('list_layers', { name: 'Road' });
  assert.equal(list[0].count, 1);
  nearArr(list[0].extent.max, [0.5, 1, 0.5]);
});

test('underlay maths: scale, orient, move, world files, GeoTIFF tags', () => {
  const A0 = U.placeAffine(U.unitScale('pdf', '1:500')); // 1 pt on paper = 0.17639 m
  near(U.apply(A0, [72, 0])[0], 12.7, 1e-9); // an inch at 1:500
  let A = U.calibrateScale(A0, [0, 0], [100, 0], 50).affine;
  near(U.apply(A, [100, 0])[0], 50, 1e-9);
  A = U.calibrateOrient(A, [0, 0], [100, 0], 0).affine; // that line now points north
  nearArr(U.apply(A, [100, 0]), [0, 50], 1e-9);
  near(U.bearing(U.apply(A, [0, 0]), U.apply(A, [0, 100])), 90, 1e-9, 'v down turns with it: the page is now rotated');
  A = U.calibrateMove(A, [0, 0], [1000, 2000]).affine;
  nearArr(U.apply(A, [100, 0]), [1000, 2050], 1e-9);
  const wf = U.worldFile([0.5, 0, 650000, 0, -0.5, 5400000]);
  assert.equal(wf, '0.5\n0\n0\n-0.5\n650000.25\n5399999.75\n');
  nearArr(U.parseWorldFile(wf), [0.5, 0, 650000, 0, -0.5, 5400000], 1e-9);
  nearArr(U.affineFromGeoTiff({ ModelPixelScale: [2, 2, 0], ModelTiepoint: [0, 0, 0, 650000, 5400000, 0] }), [2, 0, 650000, 0, -2, 5400000]);
  nearArr(U.invert(U.compose(A, U.invert(A))), [1, 0, 0, 0, 1, 0], 1e-9);
});

test('georeferencing: Helmert and affine recover a known transform; residuals flag a bad point', () => {
  const truth = [0.2 * Math.cos(0.3), 0.2 * Math.sin(0.3), 650000, 0.2 * Math.sin(0.3), -0.2 * Math.cos(0.3), 5400000];
  const src = [[10, 20], [900, 40], [880, 700], [30, 650], [450, 330]];
  const noise = [[0.01, -0.02], [-0.015, 0.01], [0.02, 0.005], [-0.01, -0.01], [0, 0.015]];
  const pairs = src.map(([u, v], i) => {
    const [X, Y] = U.apply(truth, [u, v]);
    return { u, v, X: X + noise[i][0], Y: Y + noise[i][1] };
  });
  const h = U.solve(pairs, 'helmert');
  nearArr(h.affine, truth, 0.05);
  assert.ok(h.rms < 0.03, `rms ${h.rms}`);
  near(h.scale[0], 0.2, 1e-4);
  const af = U.solve(pairs, 'affine');
  assert.ok(af.rms <= h.rms + 1e-9, 'more parameters never fit worse');
  pairs[3].X += 5; // a blunder
  const bad = U.solve(pairs, 'helmert');
  assert.equal(bad.worst, 3);
  const two = U.solve(pairs.slice(0, 2), 'similarity');
  near(two.rms, 0, 1e-6, 'two points fit exactly');
  assert.throws(() => U.solve([pairs[0]]), /2 control points/);
  assert.throws(() => U.solve([pairs[0], pairs[0], pairs[0]], 'affine'), /line|top of each other/);
});

test('drafting: offset, trim, extend, fillet, chamfer, join, simplify, divide, break', () => {
  const L = [[0, 0], [10, 0], [10, 10]];
  nearArr(DR.offset(L, 1).flat(), [0, 1, 9, 1, 9, 10].flat(), 1e-9); // left of travel is inside the turn
  nearArr(DR.offset(L, -1).flat(), [0, -1, 11, -1, 11, 10], 1e-9);
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  near(DR.length(DR.offset(sq, -1, true), true), 24, 1e-9, 'outward offset of a closed square');
  // trim the middle of a line between two cutters
  const t = DR.trim([[0, 0], [10, 0]], [[[3, -1], [3, 1]], [[7, -1], [7, 1]]], [5, 0.2]);
  assert.equal(t.length, 2);
  nearArr(t[0].at(-1), [3, 0]);
  nearArr(t[1][0], [7, 0]);
  const tc = DR.trim(sq, [[[2, -1], [2, 1]], [[-1, 2], [1, 2]]], [0, 0], true);
  near(DR.length(tc[0]), 12, 1e-9, 'the corner piece of a closed square goes');
  nearArr(DR.extend([[0, 0], [5, 0]], [[[8, -1], [8, 1]]]).at(-1), [8, 0]);
  nearArr(DR.extend([[0, 0], [5, 0]], [[[-3, -1], [-3, 1]]], 'start')[0], [-3, 0]);
  assert.throws(() => DR.extend([[0, 0], [5, 0]], [[[8, 2], [9, 2]]]), /No boundary/);
  const f = DR.fillet(L, 2, 1);
  nearArr(f[1], [8, 0], 1e-9);
  nearArr(f.at(-2), [10, 2], 1e-9);
  for (const p of f.slice(1, -1)) near(Math.hypot(p[0] - 8, p[1] - 2), 2, 1e-9);
  assert.throws(() => DR.fillet([[0, 0], [1, 0], [1, 1]], 5, 1), /does not fit/);
  const ch = DR.fillet(L, 0, 1, false, [2, 3]);
  nearArr(ch.flat(), [0, 0, 8, 0, 10, 3, 10, 10]);
  // two separate lines that do not meet: stretched to the corner, then rounded
  const fp = DR.filletPair([[0, 0], [8, 0]], [[10, 2], [10, 10]], 2);
  nearArr(fp[0], [0, 0]);
  nearArr(fp.at(-1), [10, 10]);
  nearArr(fp[1], [8, 0], 1e-9);
  const j = DR.join([{ pts: [[0, 0], [1, 0]], key: 'a' }, { pts: [[2, 0], [1, 0.0004]], key: 'a' }, { pts: [[2, 0], [2, 2]], key: 'a' }, { pts: [[2, 2], [3, 3]], key: 'b' }], 1e-3);
  assert.equal(j.length, 2);
  assert.equal(j.find((x) => x.key === 'a').pts.length, 4);
  const jc = DR.join([{ pts: [[0, 0], [1, 0], [1, 1]] }, { pts: [[1, 1], [0, 1], [0, 0]] }]);
  assert.ok(jc[0].closed && jc[0].pts.length === 4);
  assert.equal(DR.dedupe([{ pts: [[0, 0], [1, 0]] }, { pts: [[1, 0], [0, 0]] }, { pts: [[0, 0], [0, 0]] }]).length, 1);
  assert.equal(DR.simplify([[0, 0], [1, 0.0001], [2, 0], [2, 5]], 0.01).length, 3);
  assert.equal(DR.divide([[0, 0], [10, 0]], { spacing: 2.5 }).length, 5);
  assert.equal(DR.divide(sq, { count: 8 }, true).length, 8);
  const br = DR.breakAt([[0, 0], [10, 0]], [3, 1], [6, -1]);
  nearArr(br[0].at(-1), [3, 0]);
  nearArr(br[1][0], [6, 0]);
  nearArr(DR.lift([[5, 0]], [[0, 10, 0], [10, 20, 0]])[0], [5, 15, 0]);
});

test('PDF: layers, paths under transforms, Béziers, hatching, dashes, text', async () => {
  const hatch = Array.from({ length: 8 }, (_, i) => `${400 + i * 5} 500 m ${420 + i * 5} 520 l`).join(' ');
  const bytes = makePdf({
    layers: ['Kerbs', 'Notes'],
    content: `/OC /oc1 BDC 1 0 0 RG 2 w 100 100 m 300 100 l 300 200 l S EMC
0 0 1 RG 0.5 w [4 2] 0 d 100 300 m 150 350 200 350 250 300 c S [] 0 d
q 2 0 0 2 0 0 cm 10 10 50 20 re S Q
${hatch} S
/OC /oc2 BDC BT /F1 12 Tf 100 700 Td (+102.35) Tj ET EMC`,
  });
  const pdf = await PDF.open(bytes, 'test-pdf');
  const info = await PDF.info(pdf);
  assert.deepEqual(info.pages, [{ page: 1, size: [595, 842] }]);
  assert.deepEqual(info.layers.map((l) => l.name), ['Kerbs', 'Notes']);
  const c = await PDF.content(pdf, 1);
  const kerb = c.paths.find((p) => p.layer === 'Kerbs');
  assert.deepEqual(kerb.pts, [[100, 742], [300, 742], [300, 642]], 'page coordinates: top-left origin, v down');
  assert.equal(kerb.color, '#ff0000');
  assert.equal(kerb.width, 2);
  const curve = c.paths.find((p) => p.dashed);
  assert.ok(curve.pts.length > 8, 'Bézier densified');
  nearArr(curve.pts.at(-1), [250, 542]);
  const rect = c.paths.find((p) => p.closed);
  assert.deepEqual(rect.pts, [[20, 822], [120, 822], [120, 782], [20, 782]], 'the cm transform doubles the rectangle');
  assert.equal(rect.width, 1, 'line width (0.5) scales with the transform');
  assert.equal(c.paths.filter((p) => p.hatch).length, 8);
  assert.deepEqual(c.texts.map((t) => [t.str, t.at, t.size]), [['+102.35', [100, 142], 12]]);
});
