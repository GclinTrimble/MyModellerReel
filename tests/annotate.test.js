// Phase 11: 3D text, dimensions and labels that follow the geometry, guides, line types, clashes, section cuts and
// drawing sheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCtx, near } from './helpers.js';
import * as D from '../src/core/document.js';
import * as G from '../src/core/geometry.js';
import * as F from '../src/core/font.js';
import * as C from '../src/core/curves.js';
import * as L from '../src/core/layers.js';
import * as SEC from '../src/core/section.js';
import * as SHT from '../src/core/sheet.js';
import * as PDF from '../src/core/pdf.js';

F.registerFont('sans', fs.readFileSync(new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url)));

test('3D text: letters with holes and accents, closed and outward, a live parameter', async () => {
  for (const t of ['H', 'B', 'é', 'Hi 2026']) {
    const m = F.textMesh(t, { size: 1, depth: 0.2 });
    assert.ok(G.volume(m) > 0, `${t} faces outward`);
  }
  const o = F.textShapes('O', { size: 1 });
  assert.equal(o.shapes.length, 1);
  assert.equal(o.shapes[0].holes.length, 1, 'the O has a hole');
  const { reg, ctx } = makeCtx();
  const e = await reg.run('create_text', { text: 'SITE', size: 2, depth: 0.3 });
  const b = D.worldBox(ctx.doc, D.getEntity(ctx.doc, e.id));
  near(b.max[1] - b.min[1], 2, 0.1, 'capital height (round letters overshoot a little)');
  near(b.max[2] - b.min[2], 0.3, 1e-6);
  await reg.run('set_params', { id: e.id, params: { text: 'SITE OFFICE' } });
  assert.ok(D.worldBox(ctx.doc, D.getEntity(ctx.doc, e.id)).max[0] > b.max[0] * 1.5, 'longer text, wider shape');
  const flat = await reg.run('create_text', { text: 'N', size: 1, depth: 0.1, flat: true });
  const fb = D.worldBox(ctx.doc, D.getEntity(ctx.doc, flat.id));
  near(fb.max[1] - fb.min[1], 0.1, 1e-6, 'lying down: as tall as it is deep');
});

test('dimensions follow what they measure; labels keep their text up to date', async () => {
  const { reg, ctx } = makeCtx();
  const box = await reg.run('create_box', { width: 4, height: 3, depth: 2, name: 'Shed' });
  const w = await reg.run('add_dimension', { id: 'Shed', axis: 'x' });
  near(w.value, 4);
  assert.equal(w.text, '4.000 m');
  const h = await reg.run('add_dimension', { id: 'Shed', axis: 'y' });
  near(h.value, 3);
  const free = await reg.run('add_dimension', { from: { id: 'Shed', corner: [0, 0, 0] }, to: [10, 0, -1] });
  near(free.value, 12, 1e-6, 'aligned from the corner at x = −2 to a fixed point');
  await reg.run('set_params', { id: box.id, params: { width: 6 } });
  await reg.run('move', { ids: [box.id], by: [1, 0, 0] });
  const list = await reg.run('list_annotations', {});
  near(list.find((x) => x.name === w.name).value, 6, 1e-6, 'the width dimension follows the new size');
  near(list.find((x) => x.name === free.name).value, 12, 1e-6, 'corner moved from −2 to −2: (6 wide, moved 1)');
  const lab = await reg.run('add_label', { id: 'Shed', text: '{name}: {footprint}' });
  assert.equal(lab.text, 'Shed: 12.00 m²');
  await reg.run('set_properties', { ids: [box.id], name: 'Store' });
  assert.equal((await reg.run('list_annotations', {})).find((x) => x.type === 'label').text, 'Store: 12.00 m²');
  const ang = await reg.run('add_dimension', { kind: 'angular', vertex: [0, 0, 0], from: [1, 0, 0], to: [0, 0, -1] });
  near(ang.value, 90, 1e-6);
  assert.equal(ang.text, '90.0°');
  const rad = await reg.run('add_dimension', { kind: 'diameter', center: [0, 0, 0], to: [0.5, 0, 0] });
  assert.equal(rad.text, 'Ø 1.000 m');
  await reg.run('edit_annotation', { id: w.name, text: 'W = <>' });
  assert.match((await reg.run('list_annotations', {})).find((x) => x.name === w.name).text, /^W = 6\.000 m$/);
  // the shape goes: the dimension stays where it was
  await reg.run('delete', { ids: [box.id] });
  assert.ok(D.getEntity(ctx.doc, (await reg.run('list_annotations', {})).find((x) => x.name === w.name).id).curve.points.length > 2);
});

test('guides and line types: dashes continue round corners, ByLayer', async () => {
  const segs = C.dashify([[0, 0, 0], [1, 0, 0], [1, 0, 1]], [0.3, 0.1]);
  assert.deepEqual(segs.map(([a, b]) => Math.round(G.len(G.sub(b, a)) * 100) / 100), [0.3, 0.3, 0.2, 0.1, 0.3, 0.3]);
  const { reg, ctx } = makeCtx();
  const g = await reg.run('add_guide', { point: [0, 0, 0], to: [1, 0, 1] });
  const e = D.getEntity(ctx.doc, g.id);
  assert.equal(e.tag, 'Guides');
  assert.equal(L.lineStyle(ctx.doc, e).name, 'dashed');
  near(G.len(G.sub(...D.curvePoints(ctx.doc, e).slice(0, 2))), 400, 1e-3, 'a long line both ways');
  await reg.run('add_guide', { point: [2, 0, 2] });
  assert.equal((await reg.run('clear_guides', {})).removed, 2);
  const c = await reg.run('create_curve', { points: [[0, 0, 0], [5, 0, 0]] });
  await reg.run('define_line_type', { name: 'Fence', pattern: [1, 0.3, 0.1, 0.3] });
  await reg.run('set_properties', { ids: [c.id], line_type: 'fence', line_weight: 0.5 });
  const st = L.lineStyle(ctx.doc, D.getEntity(ctx.doc, c.id));
  assert.deepEqual(st, { name: 'fence', pattern: [1, 0.3, 0.1, 0.3], weight: 0.5 });
  await reg.run('set_properties', { ids: [c.id], line_type: 'ByLayer' });
  assert.equal(L.lineStyle(ctx.doc, D.getEntity(ctx.doc, c.id)).name, 'continuous');
});

test('clash check: real overlaps only, touching is fine, parts of one group are fine', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { width: 2, height: 2, depth: 2, name: 'A' });
  await reg.run('create_box', { width: 2, height: 2, depth: 2, name: 'B', position: [1.5, 0, 0] });
  await reg.run('create_box', { width: 2, height: 2, depth: 2, name: 'C', position: [-2, 0, 0] }); // touches A
  await reg.run('create_cylinder', { radius: 0.3, height: 3, name: 'Pipe', position: [3.5, 0, 3] }); // boxes would clash, the shapes do not
  const r = await reg.run('check_clashes', {});
  assert.equal(r.count, 1);
  assert.deepEqual(r.clashes[0].names, ['A', 'B']);
  near(r.clashes[0].volume, 0.5 * 2 * 2, 1e-6);
  near(r.clashes[0].depth, 0.5, 1e-6);
});

test('section cuts: loops nested into areas with holes, SVG and DXF', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 4, height: 3, depth: 4, name: 'Block' });
  await reg.run('create_box', { width: 2, height: 1, depth: 2, name: 'Hole', position: [0, 1, 0] });
  await reg.run('boolean', { op: 'subtract', target: 'Block', tools: ['Hole'] });
  const cut = await reg.run('section_cut', { normal: [0, 0, 1], point: [0, 0, 0] });
  near(cut.cuts[0].area, 4 * 3 - 2 * 1, 1e-6, 'a frame: the hole is a hole');
  const plan = SEC.sectionCut(ctx.doc, { normal: [0, 1, 0], point: [0, 1.5, 0] });
  assert.equal(plan.cuts[0].areas[0].holes.length, 1);
  const svg = SEC.sectionSvg(plan, { scale: 50, title: 'Plan at 1.5' });
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /width="100\.0mm"/, '4 m at 1:50 is 80 mm, plus 2 × 10 mm');
  let written;
  ctx.io = { writeText: async (p, d) => (written = { p, d }) };
  await reg.run('section', { normal: [0, 1, 0], point: [0, 1.5, 0] });
  const r = await reg.run('export_section', { path: 'C:/out/plan.dxf' });
  assert.equal(r.loops, 2);
  assert.match(written.d, /POLYLINE/);
});

test('drawing sheets: views at a common scale, title block, a PDF pdf.js can read', async () => {
  const jpg = new Uint8Array(fs.readFileSync(new URL('./fixtures/view.jpg', import.meta.url)));
  const views = [
    { name: 'Top', ortho: true, image: jpg, px: [16, 12], extent: [12, 9], model: [10, 7] },
    { name: 'Front', ortho: true, image: jpg, px: [16, 12], extent: [12, 5], model: [10, 3] },
    { name: 'Iso', ortho: false, image: jpg, px: [16, 12], extent: [15, 11] },
  ];
  const L2 = SHT.layoutSheet(views, { sheet: 'A3', title: 'Riverside pavilion', project: 'Demo', units: (m) => `${m.toFixed(2)} m` });
  assert.equal(L2.scale, 100, '12 m in a ~176 mm cell needs 1:100');
  near(L2.cells[0].w, 120, 1e-9, '12 m at 1:100');
  assert.equal(L2.cells[0].dims.w, '10.00 m');
  const svg = SHT.sheetSvg(L2);
  assert.match(svg, /Riverside pavilion/);
  assert.match(svg, /data:image\/jpeg;base64,/);
  const pdf = SHT.sheetPdf(L2);
  const doc = await PDF.open(pdf);
  const c = await PDF.content(doc);
  assert.deepEqual(c.size.map(Math.round), [1191, 842], 'A3 landscape in points');
  const words = c.texts.map((t) => t.str).join(' ');
  for (const w of ['Riverside pavilion', 'Top', '1:100', '10.00 m']) assert.ok(words.includes(w), `${w} in the PDF`);
});
