// Phase 18 part 1: snaps, section planes, choosing an AI model (the UI parts are checked in e2e).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';

test('set_snaps keeps the snap kinds in the document, the rest stay on', async () => {
  const { reg, ctx } = makeCtx();
  const r = await reg.run('set_snaps', { midpoint: false, grid: false });
  assert.equal(r.snaps.midpoint, false);
  assert.equal(r.snaps.endpoint, true);
  assert.deepEqual(ctx.doc.settings.snaps, { midpoint: false, grid: false });
  await assert.rejects(reg.run('set_snaps', { edges: true }), /unknown parameter/);
});

test('section planes: several kept, one cuts, flip, move, rename, delete', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('section', { normal: [1, 0, 0], point: [0, 0, 0], name: 'Long' });
  await reg.run('section', { normal: [0, 0, 1], point: [0, 0, 2], name: 'Cross' });
  let l = await reg.run('list_section_planes', {});
  assert.equal(l.planes.length, 2);
  assert.equal(l.active, 'Cross');
  assert.deepEqual(ctx.doc.settings.section.point, [0, 0, 2]);
  await reg.run('set_section_plane', { name: 'Long', active: true });
  assert.deepEqual(ctx.doc.settings.section.normal, [1, 0, 0]);
  await reg.run('set_section_plane', { name: 'Long', flip: true, offset: 0.5 });
  assert.deepEqual(ctx.doc.settings.section.normal, [-1, 0, 0]);
  assert.deepEqual(ctx.doc.settings.section.point, [-0.5, 0, 0]);
  await reg.run('section', { enabled: false });
  assert.equal(ctx.doc.settings.section, null);
  assert.equal((await reg.run('list_section_planes', {})).planes.length, 2, 'turning the cut off keeps the planes');
  await reg.run('set_section_plane', { name: 'Cross', rename: 'Grid C', active: true });
  assert.equal(ctx.doc.settings.section_active, 'Grid C');
  l = await reg.run('delete_section_plane', { name: 'Grid C' });
  assert.equal(l.active, null);
  assert.equal(ctx.doc.settings.section, null);
  await assert.rejects(reg.run('set_section_plane', { name: 'Nope', flip: true }), /No section plane "Nope"/);
});

test('detect_local_models and use_ai_model go through the app (io), and say what to do', async () => {
  const { reg, ctx } = makeCtx();
  let saved = null;
  ctx.io = {
    detectModels: async () => ({ servers: [{ name: 'Ollama', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ['nomic-embed-text', 'mistral:latest'] }], installed: [], huggingface: [], claudeDesktop: false }),
    setSettings: async (p) => (saved = p),
  };
  const r = await reg.run('detect_local_models', {});
  assert.equal(r.servers[0].suggested, 'mistral:latest', 'a model that can call tools is suggested first');
  assert.match(r.advice, /Found Ollama/);
  await reg.run('use_ai_model', { provider: 'ollama', model: 'mistral:latest' });
  assert.deepEqual(saved, { ai: { provider: 'ollama', ollama: { model: 'mistral:latest' } } });
  ctx.io.detectModels = async () => ({ servers: [], installed: [{ name: 'Ollama', models: ['mistral:latest'], start: 'Start Ollama.' }], huggingface: [], claudeDesktop: true });
  assert.match((await reg.run('detect_local_models', {})).advice, /installed with mistral:latest but not running/);
});

test('a rectangle drawn over another on the ground splits it: one shape, three faces, the areas add up', async () => {
  const { reg, ctx } = makeCtx();
  const a = await reg.run('create_face', { points: [[0, 0, 0], [4, 0, 0], [4, 0, -4], [0, 0, -4]], name: 'Slab' });
  const r = await reg.run('create_face', { points: [[2, 0, -2], [6, 0, -2], [6, 0, -6], [2, 0, -6]], split: true });
  assert.equal(r.id, a.id, 'the same shape');
  assert.equal(r.split, 3);
  assert.equal(ctx.doc.entities.filter((e) => e.mesh).length, 1);
  const e = ctx.doc.entities.find((x) => x.id === a.id);
  const area = (f) => f.reduce((s, k, i) => { const p = e.mesh.v[k]; const q = e.mesh.v[f[(i + 1) % f.length]]; return s + (p[2] * q[0] - p[0] * q[2]); }, 0) / 2;
  assert.deepEqual(e.mesh.f.map(area).map((x) => Math.round(x * 100) / 100).sort((x, y) => x - y), [4, 12, 12]);
  // push / pull one part: the others stay flat
  await reg.run('push_pull', { id: a.id, face: e.mesh.f.findIndex((f) => Math.abs(area(f) - 4) < 1e-6), distance: 1 });
  assert.ok(ctx.doc.entities.find((x) => x.id === a.id).mesh.v.some((p) => Math.abs(p[1] - 1) < 1e-9));
  // off the plane or not overlapping: a new shape as before
  const far = await reg.run('create_face', { points: [[10, 0, 0], [12, 0, 0], [12, 0, -2], [10, 0, -2]], split: true });
  assert.notEqual(far.id, a.id);
});

test('dimensions and labels after placing them: offset, sliding text, text alone, style', async () => {
  const { reg, ctx } = makeCtx();
  const d = await reg.run('add_dimension', { from: [0, 0, 0], to: [4, 0, 0] });
  const e = () => ctx.doc.entities.find((x) => x.id === d.id);
  const at0 = e().annotation.at;
  assert.ok(e().annotation.frame, 'its frame, for dragging');
  await reg.run('edit_annotation', { id: d.id, offset: 1.5, text_shift: 1 });
  const at1 = e().annotation.at;
  assert.ok(Math.abs(at1[0] - at0[0] - 1) < 1e-6, 'slid along the line');
  assert.ok(Math.hypot(at1[1] - at0[1], at1[2] - at0[2]) > 0.9, 'and further off');
  await reg.run('create_box', { width: 2, height: 2, depth: 2, name: 'Crate' });
  const l = await reg.run('add_label', { id: 'Crate', text: 'Store', leader: false, size: 18, plate: 'none', color: '#c8553d' });
  const lab = ctx.doc.entities.find((x) => x.id === l.id);
  assert.equal(lab.name, 'Text');
  assert.equal(lab.annotation.size, 18);
  assert.deepEqual(lab.curve.points[0], lab.curve.points[1], 'no leader');
  await reg.run('edit_annotation', { id: l.id, leader: true, plate: 'white' });
  assert.ok(ctx.doc.entities.find((x) => x.id === l.id).curve.points.length === 3, 'a leader again');
});

test('textured materials: tileable maps as PNG assets, applied at real size with relief and roughness', async () => {
  const TX = await import('../src/core/textures.js');
  const m = TX.makeMaps('Red brick', 32);
  assert.equal(m.color.length, 32 * 32 * 4);
  const png = TX.png(m.color, 32, 32);
  assert.deepEqual([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  const { reg, ctx } = makeCtx();
  assert.ok((await reg.run('list_material_library', {})).some((x) => x.name === 'Grass' && x.category === 'Ground'));
  await reg.run('create_box', { width: 2, height: 2, depth: 2, name: 'Wall' });
  const r = await reg.run('apply_material', { ids: ['Wall'], material: 'Red brick', scale: 0.8 });
  const mat = ctx.doc.entities.find((e) => e.name === 'Wall').material;
  assert.equal(r.tile_m, 0.8);
  assert.deepEqual(mat.texture.size, [0.8, 0.8]);
  assert.ok(mat.maps.normal && mat.maps.roughness && mat.texture.asset);
  await assert.rejects(reg.run('apply_material', { ids: ['Wall'], material: 'Plutonium' }), /material must be one of/);
});

test('coordinate systems for a place or words; the base point given at a model point', async () => {
  const CRS = await import('../src/core/crs.js');
  const paris = CRS.suggest({ latitude: 48.85, longitude: 2.35 });
  assert.equal(paris[0].epsg, 2154, 'Lambert-93 first in France');
  assert.ok(paris.some((x) => x.epsg === 25831) && paris.some((x) => x.epsg === 32631), 'its UTM zone 31N');
  assert.equal(CRS.suggest({ latitude: -41.3, longitude: 174.8 })[0].epsg, 2193);
  assert.equal(CRS.utmZone(10, 60).zone, 32, 'the Norway exception');
  assert.equal(CRS.suggest({ query: 'netherlands' })[0].epsg, 28992);
  assert.equal(CRS.suggest({ query: 'UTM 17 S' })[0].epsg, 32717);
  const { reg, ctx } = makeCtx();
  await reg.run('set_geolocation', { latitude: 51.5, longitude: -0.12 });
  assert.equal((await reg.run('suggest_coordinate_systems', {})).systems[0].epsg, 27700);
  // a point already in the model keeps its place and takes coordinates from the new base
  await reg.run('add_point', { name: 'P', at: [2, 0, -3] });
  const r = await reg.run('set_base_point', { at: [2, 0, -3], e: 530000, n: 180000, z: 12, north_angle: 3 });
  const p = ctx.doc.entities.find((e) => e.name === 'P');
  assert.deepEqual([p.point.e, p.point.n, p.point.z], [530000, 180000, 12]);
  assert.deepEqual(p.position, [2, 0, -3], 'nothing moved');
  assert.deepEqual(r.base, [529998, 179997, 12]);
  assert.equal(ctx.doc.settings.geolocation.north_angle, 3);
});
