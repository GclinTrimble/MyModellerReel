// Phase 15: point clouds and ground, vectorising scans, reading drawings, versions, 3MF, the web viewer page, CC0
// assets, text to 3D requests, shortcuts and French.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { makeCtx, near } from './helpers.js';
import * as PC from '../src/core/pointcloud.js';
import * as RS from '../src/core/raster.js';
import * as DC from '../src/core/drawingclues.js';
import * as IO2 from '../src/core/interop.js';
import * as SC from '../src/core/shortcuts.js';
import * as I18N from '../src/core/i18n.js';
import * as D from '../src/core/document.js';

const enc = (s) => new TextEncoder().encode(s);

/** A LAS 1.2 file, point format 2 (xyz + rgb), from points. */
function las(points) {
  const recLen = 26;
  const buf = new ArrayBuffer(227 + points.length * recLen);
  const dv = new DataView(buf);
  'LASF'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint8(24, 1);
  dv.setUint8(25, 2);
  dv.setUint16(94, 227, true);
  dv.setUint32(96, 227, true);
  dv.setUint8(104, 2);
  dv.setUint16(105, recLen, true);
  dv.setUint32(107, points.length, true);
  [0.001, 0.001, 0.001, 650000, 5400000, 100].forEach((v, k) => dv.setFloat64(131 + k * 8, v, true));
  points.forEach(([x, y, z], i) => {
    const p = 227 + i * recLen;
    dv.setInt32(p, Math.round((x - 650000) / 0.001), true);
    dv.setInt32(p + 4, Math.round((y - 5400000) / 0.001), true);
    dv.setInt32(p + 8, Math.round((z - 100) / 0.001), true);
    dv.setUint16(p + 20, 200 << 8, true);
  });
  return new Uint8Array(buf);
}

test('point clouds: PLY (ASCII, binary), LAS and XYZ; thinning; ground found under a building', () => {
  const ply = enc('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 2 0 0 255\n');
  const a = PC.parsePointCloud(ply, 'scan.ply');
  assert.equal(a.count, 3);
  assert.equal(a.z[2], 2);
  assert.equal(a.b[2], 255);
  const head = enc('ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n');
  const body = new Float32Array([1, 2, 3, 4, 5, 6]);
  const bin = new Uint8Array(head.length + body.byteLength);
  bin.set(head);
  bin.set(new Uint8Array(body.buffer), head.length);
  const b = PC.parsePointCloud(bin, 'scan.ply');
  assert.deepEqual([b.x[1], b.y[1], b.z[1]], [4, 5, 6]);
  const l = PC.parsePointCloud(las([[650010, 5400020, 101.5]]), 'site.las');
  near(l.x[0], 650010, 1e-6);
  near(l.z[0], 101.5, 1e-6);
  assert.equal(l.r[0], 200);
  const x = PC.parsePointCloud(enc('10 20 30\n11 21 31 255 128 0\n'), 'p.xyz');
  assert.equal(x.count, 2);
  assert.throws(() => PC.parsePointCloud(new Uint8Array(4), 'a.laz'), /compressed/);
  // a 40 × 40 m field at z 0 (0.5 m spacing) with a 10 × 10 × 6 m block of points on top
  const pts = [];
  // no field points under the block: a scanner never sees under a roof
  for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) if (!(i >= 20 && i < 40 && j >= 20 && j < 40)) pts.push([i * 0.5, j * 0.5, 0.02 * Math.sin(i)]);
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) pts.push([10 + i * 0.5, 10 + j * 0.5, 6]);
  const pc = { x: Float64Array.from(pts, (p) => p[0]), y: Float64Array.from(pts, (p) => p[1]), z: Float64Array.from(pts, (p) => p[2]), count: pts.length };
  assert.ok(PC.thin(pc, 1000).length <= 1000);
  const g = PC.classifyGround(pc, { cell: 2, tolerance: 0.3 });
  assert.ok(g.every((i) => pc.z[i] < 0.5), 'the roof is not ground');
  assert.ok(g.length > 250, "most of the 375 field cells keep a point");
});

test('point cloud import and a ground surface through the registry', async () => {
  const { reg, ctx } = makeCtx();
  const pts = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) pts.push([650000 + i, 5400000 + j, 100 + i * 0.05]);
  ctx.io = { readBinary: async () => las(pts) };
  await reg.run('set_base_point', { n: 5400000, e: 650000, z: 100 });
  const r = await reg.run('import_point_cloud', { path: 'C:/scan/site.las' });
  assert.equal(r.points, 900);
  const cloud = D.getEntity(ctx.doc, r.id);
  assert.equal(cloud.type, 'pointcloud');
  const s = await reg.run('classify_ground', { id: r.id, cell: 1 });
  assert.ok(s.ground_points > 800);
  near(s.size[1], 29 * 0.05, 0.01, 'the surface rises with the cloud');
});

test('vectorising a scan; reading a drawing\'s scale, title and grid', () => {
  const w = 80;
  const h = 60;
  const g = new Uint8Array(w * h).fill(255);
  for (let y = 20; y <= 22; y++) for (let x = 10; x <= 70; x++) g[y * w + x] = 0;
  const lines = RS.vectorise(g, w, h, { minLength: 10 });
  assert.equal(lines.length, 1);
  near(Math.abs(lines[0][0][0] - lines[0].at(-1)[0]), 58, 3);
  const texts = [
    { str: 'Riverside site plan', at: [600, 780], size: 18 },
    { str: 'Scale 1:500', at: [600, 800], size: 9 },
    { str: '2027-03-01', at: [600, 815], size: 8 },
    { str: 'E 650000', at: [100, 20], size: 7 },
    { str: 'E 650100', at: [700, 20], size: 7 },
    { str: 'N 5400080', at: [15, 100], size: 7 },
    { str: 'N 5400000', at: [15, 700], size: 7 },
  ];
  const c = DC.readClues(texts, [842, 842]);
  assert.equal(c.scale.ratio, 500);
  assert.equal(c.title, 'Riverside site plan');
  assert.equal(c.date, '2027-03-01');
  assert.equal(c.control.length, 4);
  assert.deepEqual(c.control[0], { u: 100, v: 100, e: 650000, n: 5400080 });
  const m = DC.mergeClues(c, DC.jsonIn('Here: {"scale": 250, "north_angle": 12, "title": "Plan"} done'));
  assert.deepEqual([m.scale.ratio, m.north_angle, m.title], [250, 12, 'Plan']);
});

test('versions saved in the file: compare and restore', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Shed' });
  await reg.run('save_version', { name: 'Scheme A' });
  await reg.run('create_box', { width: 2, height: 1, depth: 1, name: 'Garage' });
  await reg.run('set_properties', { ids: ['Shed'], name: 'Shed' });
  await reg.run('move', { ids: ['Shed'], by: [1, 0, 0] });
  const d = await reg.run('compare_versions', { from: 'Scheme A' });
  assert.deepEqual(d.added, ['Garage']);
  assert.deepEqual(d.changed, ['Shed']);
  const r = await reg.run('restore_version', { name: 'scheme a' });
  assert.equal(r.entities, 1);
  assert.equal((await reg.run('list_versions', {})).length, 1, 'the versions survive a restore');
  await assert.rejects(reg.run('restore_version', { name: 'Scheme B' }), /No version/);
});

test('3MF for printing, the web viewer page, CC0 asset plans, text-to-3D replies', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 1, height: 2, depth: 1, name: 'Block', color: '#c8553d' });
  let written;
  ctx.io = { writeText: async (p, d) => (written = d), pick: async () => 'C:/out/block.3mf' };
  const r = await reg.run('export', { format: '3mf', path: 'C:/out/block.3mf' });
  assert.equal(r.format, '3mf');
  const files = unzipSync(written);
  const model = strFromU8(files['3D/3dmodel.model']);
  assert.match(model, /unit="meter"/);
  assert.match(model, /displaycolor="#C8553D"/);
  assert.equal((model.match(/<triangle /g) || []).length, 12);
  assert.match(model, /z="2"/, 'up is z in the file');
  const html = IO2.webViewerHtml({ title: 'Shed', glb64: 'AAAA', three: "import { A } from './three.core.js'; export { A };", core: 'export const A = 1;', addons: { 'GLTFLoader.js': "import { B } from '../utils/BufferGeometryUtils.js';", 'BufferGeometryUtils.js': 'export const B = 2;', 'OrbitControls.js': '' } });
  assert.match(html, /<title>Shed<\/title>/);
  assert.ok(html.includes("from 'three-core'") && html.includes("from 'three/addons/BufferGeometryUtils.js'"), 'relative imports rewritten');
  const found = IO2.polyhavenSearch({ red_brick_03: { name: 'Red Brick 03', tags: ['brick', 'wall'], categories: ['brick'] }, oak_floor: { name: 'Oak Floor', tags: ['wood'], categories: ['floor'] } }, 'brick');
  assert.deepEqual(found.map((f) => f.id), ['red_brick_03']);
  const plan = IO2.polyhavenDownload({ gltf: { '1k': { gltf: { url: 'https://dl.polyhaven.org/a/chair_1k.gltf', include: { 'chair.bin': { url: 'https://dl.polyhaven.org/a/chair.bin' }, 'textures/chair_diff_1k.jpg': { url: 'https://dl.polyhaven.org/a/t.jpg' } } } } } }, 'models');
  assert.deepEqual(plan.files.map((f) => f.path), ['chair_1k.gltf', 'chair.bin', 'textures/chair_diff_1k.jpg']);
  assert.deepEqual(IO2.meshTask({ prompt: 'a chair' }), { type: 'text_to_model', prompt: 'a chair' });
  assert.equal(IO2.meshResult({ data: { status: 'running' } }), null);
  assert.equal(IO2.meshResult({ data: { status: 'success', output: { model: 'https://x/m.glb' } } }), 'https://x/m.glb');
  assert.throws(() => IO2.meshResult({ data: { status: 'failed' } }), /failed/);
});

test('shortcuts written one way; French menus', () => {
  assert.equal(SC.normalise('shift+ctrl+f'), 'Ctrl+Shift+F');
  assert.equal(SC.normalise('g'), 'G');
  assert.equal(SC.comboOf({ key: 'f', ctrlKey: true, shiftKey: true, altKey: false }), 'Ctrl+Shift+F');
  assert.ok(I18N.coverage(['File', 'Edit', 'Arrange', 'View', 'Tools', 'Animate', 'Site', 'Drawings', 'AI', 'Help']) === 1, 'every menu has a French name');
  I18N.setLanguage('fr');
  assert.equal(I18N.t('File'), 'Fichier');
  assert.equal(I18N.t('Something new'), 'Something new');
  I18N.setLanguage('en');
  assert.equal(I18N.t('File'), 'File');
});
