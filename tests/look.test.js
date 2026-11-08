// Phase 12: sun by place and time, sun studies, texture projection, lights, effects, environment, materials, and
// the image-model requests behind AI render and AI textures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCtx, near } from './helpers.js';
import * as SUN from '../src/core/sun.js';
import * as LK from '../src/core/look.js';
import * as IG from '../src/core/imagegen.js';
import * as A from '../src/core/animation.js';
import * as Assets from '../src/core/assets.js';
import * as D from '../src/core/document.js';

test('the sun: noon height at the solstice, sunrise in the north-east, north angle, a day study', async () => {
  const noon = SUN.sunPosition(Date.UTC(2026, 5, 21, 12, 0), 51.5, -0.12);
  near(noon.elevation, 90 - 51.5 + 23.44, 0.1);
  near(noon.azimuth, 180, 1.5);
  const sydney = SUN.sunPosition(SUN.localTime('2026-12-21', '13:00', 11), -33.87, 151.21);
  assert.ok(sydney.elevation > 75 && (sydney.azimuth < 60 || sydney.azimuth > 300), 'southern summer: high, to the north');
  const { reg, ctx } = makeCtx();
  await reg.run('set_geolocation', { latitude: 51.5, longitude: -0.12, utc_offset: 1, north_angle: 30 });
  const s = await reg.run('set_sun_time', { date: '2026-06-21', time: '05:30' });
  assert.ok(s.elevation > 0 && s.elevation < 10 && s.true_azimuth > 40 && s.true_azimuth < 70, 'just after sunrise, north-east');
  near(s.azimuth, (s.true_azimuth + 30) % 360, 0.02, 'model north turned by 30°');
  const night = await reg.run('set_sun_time', { date: '2026-06-21', time: '23:30' });
  assert.equal(night.night, true);
  await reg.run('animate_sun', { date: '2026-06-21', from: '06:00', to: '20:00', start: 0, end: 7 });
  const mid = A.evaluate(ctx.doc, 3.5).sun;
  assert.equal(mid.time, '13:00');
  assert.ok(mid.elevation > 55);
  await assert.rejects(reg.run('set_sun_time', { date: '21/06/2026' }), /YYYY-MM-DD/);
  await reg.run('animate_sun', { off: true });
  assert.equal(A.evaluate(ctx.doc, 1).sun, undefined);
});

test('texture projection: box picks the face plane, real size, rotation, cylinder around y', () => {
  const opts = { size: [0.5, 0.25] };
  assert.deepEqual(LK.uvFor([1, 0.5, 0], [0, 0, 1], opts), [2, 2], 'front face: x and y over the tile size');
  assert.deepEqual(LK.uvFor([0.5, 0, -1], [0, 1, 0], opts), [1, 4], 'top face: x and −z');
  const r = LK.uvFor([1, 0, 0], [0, 0, 1], { rotation: 90 });
  near(r[0], 0, 1e-12);
  near(r[1], 1, 1e-12);
  const c = LK.uvFor([0, 2, 1], [0, 0, 1], { projection: 'cylindrical', radius: 1 });
  assert.deepEqual(c, [0, 2]);
  near(LK.uvFor([1, 0, 0], [1, 0, 0], { projection: 'cylindrical', radius: 1 })[0], Math.PI / 2, 1e-12, 'a quarter round: a quarter of the circumference');
});

test('lights, effects, environment, camera lens, materials and textures through the registry', async () => {
  const { reg, ctx } = makeCtx();
  const l = await reg.run('create_light', { kind: 'spot', position: [0, 3, 0], target: [0, 0, 2], shadows: true });
  assert.deepEqual(l.light, { kind: 'spot', color: '#ffd9a0', intensity: 60, distance: 0, angle: 35, penumbra: 0.4, target: [0, 0, 2], shadows: true });
  const e = D.getEntity(ctx.doc, l.id);
  assert.equal(e.type, 'light');
  await reg.run('set_light', { id: l.id, intensity: 120, color: '#ffffff' });
  assert.equal(e.light.intensity, 120);
  assert.equal(e.material.color, '#ffffff', 'colour tracks animate it');
  await assert.rejects(reg.run('create_light', { kind: 'laser' }), /kind must be/);
  const fx = await reg.run('set_effects', { ao: 0.6, bloom: 2, dof: true, focus: 12, aperture: 1.4 });
  assert.deepEqual([fx.ao, fx.bloom, fx.dof, fx.focus, fx.aperture], [0.6, 1, true, 12, 1.4]);
  assert.ok(LK.effectsOn(fx));
  assert.ok(!LK.effectsOn(LK.effectsOf({}, {})));
  await assert.rejects(reg.run('set_environment', { preset: 'hdri' }), /needs path/);
  assert.equal((await reg.run('set_environment', { preset: 'studio', rotation: 90 })).rotation, 90);
  near(LK.fovOfLens(50), 26.99, 0.01);
  near(LK.lensOfFov(LK.fovOfLens(24)), 24, 1e-9);
  // a texture from a file (the bytes go to the asset store, the document keeps the id) and glass
  const png = new Uint8Array(fs.readFileSync(new URL('./fixtures/view.jpg', import.meta.url)));
  ctx.io = { readBinary: async () => png };
  const box = await reg.run('create_box', { width: 2, height: 1, depth: 1 });
  const t = await reg.run('set_texture', { ids: [box.id], path: 'C:/tex/brick.jpg', size: [0.9, 0.45], rotation: 10 });
  assert.equal(Assets.get(t.texture.asset).mime, 'image/jpeg');
  assert.deepEqual(LK.lookAssets(ctx.doc), new Set([t.texture.asset]));
  assert.ok(Assets.pack(ctx.doc)[t.texture.asset], 'saved with the file');
  assert.equal(D.getEntity(ctx.doc, box.id).material.color, '#ffffff');
  await assert.rejects(reg.run('set_texture', { ids: [box.id], path: 'C:/tex/brick.jpg', size: [0, 1] }), /above 0/);
  await reg.run('set_material_maps', { ids: [box.id], transmission: 1, ior: 1.5, normal_map: 'C:/tex/n.jpg' });
  const m = D.getEntity(ctx.doc, box.id).material;
  assert.equal(m.transmission, 1);
  assert.equal(m.maps.normal, t.texture.asset, 'the same bytes, the same asset');
  await reg.run('set_material_maps', { ids: [box.id], normal_map: 'none' });
  assert.deepEqual(D.getEntity(ctx.doc, box.id).material.maps, {});
  await reg.run('set_texture', { ids: [box.id], path: 'none' });
  assert.equal(D.getEntity(ctx.doc, box.id).material.texture, undefined);
  await reg.run('set_style', { render_style: 'sketchy' });
  assert.equal(ctx.doc.settings.render_style, 'sketchy');
});

test('image models: ComfyUI workflows and replies, OpenAI-compatible requests', () => {
  const i2i = IG.comfyWorkflow({ prompt: 'brick house', image: 'view.png', strength: 0.4, checkpoint: 'sdxl.safetensors', seed: 7 });
  assert.equal(i2i[3].inputs.denoise, 0.4);
  assert.deepEqual(i2i[3].inputs.latent_image, ['11', 0]);
  assert.equal(i2i[10].inputs.image, 'view.png');
  const t2i = IG.comfyWorkflow({ prompt: 'oak boards', checkpoint: 'sdxl.safetensors', width: 768, height: 768 });
  assert.equal(t2i[3].inputs.denoise, 1);
  assert.equal(t2i[5].inputs.width, 768);
  assert.throws(() => IG.comfyWorkflow({ prompt: 'x' }), /checkpoint/);
  assert.equal(IG.comfyResult({}, 'p1'), null, 'still running');
  assert.deepEqual(IG.comfyResult({ p1: { outputs: { 9: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }, 'p1'), { filename: 'a.png', subfolder: '', type: 'output' });
  assert.throws(() => IG.comfyResult({ p1: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'out of memory' }]] } } }, 'p1'), /out of memory/);
  const edit = IG.openaiImageRequest({ prompt: 'p', image: 'b64' });
  assert.match(edit.url, /\/images\/edits$/);
  assert.equal(edit.file.field, 'image');
  assert.deepEqual(IG.openaiImageRequest({ prompt: 'p' }).json, { model: 'gpt-image-1', prompt: 'p', size: '1024x1024', n: 1 });
  assert.deepEqual(IG.openaiImageResult({ data: [{ b64_json: 'QUJD' }] }), { b64: 'QUJD' });
  assert.throws(() => IG.openaiImageResult({ error: { message: 'billing' } }), /billing/);
  assert.match(IG.texturePrompt('red brick'), /seamless tileable/);
});
