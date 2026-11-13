// Surface materials: library, painting faces (brush, fill with breaklines, inside a boundary), show/hide, takeoff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as TK from '../src/core/takeoff.js';
import * as G from '../src/core/geometry.js';

/** A flat 4 × 4 m grid of 1 m squares (16 faces) as a mesh entity. */
async function grid(reg, ctx) {
  const v = [];
  const f = [];
  for (let z = 0; z <= 4; z++) for (let x = 0; x <= 4; x++) v.push([x, 0, z]);
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) f.push([z * 5 + x, (z + 1) * 5 + x, (z + 1) * 5 + x + 1, z * 5 + x + 1]);
  const e = { id: 'g1', name: 'Site', type: 'mesh', mesh: { v, f }, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, tag: 'Untagged', material: { color: '#cccccc' } };
  ctx.doc.entities.push(e);
  return e;
}

test('library: starter materials, define with properties, validation, rename carries paint', async () => {
  const { ctx, reg } = makeCtx();
  await grid(reg, ctx);
  assert.ok(TK.library(ctx.doc).some((m) => m.name === 'Asphalt'));
  await reg.run('define_surface_material', { name: 'Clay', code: '31 23 00', color: '#aa7744', density: 1900, thickness: 0.3, cost: 22 });
  assert.equal(TK.get(ctx.doc, 'clay').density, 1900);
  await assert.rejects(reg.run('define_surface_material', { name: 'Bad', color: 'red' }), /hex/);
  await reg.run('paint_surface', { id: 'Site', material: 'Clay', faces: [0, 1] });
  await reg.run('define_surface_material', { name: 'Clay', rename: 'Red clay' });
  const e = ctx.doc.entities.find((x) => x.id === 'g1'); // the store keeps a fresh copy after each command
  assert.deepEqual(e.fm.slice(0, 3), ['Red clay', 'Red clay', null]);
});

test('paint: brush, inside a boundary, fill stopped by a breakline; colours and hidden faces', async () => {
  const { ctx, reg } = makeCtx();
  await grid(reg, ctx);
  const r = await reg.run('paint_surface', { id: 'Site', material: 'Asphalt', at: [0.5, 0, 0.5], radius: 0.6 });
  assert.equal(r.faces, 1);
  near(r.area, 1);
  let e = ctx.doc.entities.find((x) => x.id === 'g1');
  assert.equal(e.mesh.fc[0], TK.get(ctx.doc, 'Asphalt').color, 'painted faces take the material colour');
  assert.equal(e.mesh.fc[1], '#cccccc', 'unpainted faces keep the entity colour');

  await reg.run('paint_surface', { id: 'Site', material: 'Turf', inside: [[2, 0], [4, 0], [4, 4], [2, 4]] });
  assert.equal(e.fm.filter((x) => x === 'Turf').length, 8);

  // a kerb line at x = 1 stops a fill started on the left column of unpainted faces
  ctx.doc.entities.push({ id: 'k1', name: 'Kerb', type: 'curve', curve: { points: [[1, 0, -1], [1, 0, 5]], closed: false }, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, tag: 'Untagged', material: { color: '#000000' } });
  const fill = await reg.run('paint_surface', { id: 'Site', material: 'Gravel', seed: 4, fill: true, breaklines: ['Kerb'] });
  assert.equal(fill.faces, 3, 'the left column below the asphalt face, not across the kerb');

  await reg.run('show_surface_materials', { names: ['Turf'], visible: false });
  e = ctx.doc.entities.find((x) => x.id === 'g1');
  assert.equal(e.mesh.fc.filter((c) => c === 'none').length, 8);
  const buf = G.toBuffers(e.mesh);
  assert.equal(buf.triFace.length, 8 * 2, 'hidden faces are not drawn');
  await reg.run('show_surface_materials', { all: true });
  e = ctx.doc.entities.find((x) => x.id === 'g1');
  assert.ok(!e.mesh.fc.includes('none'));

  await reg.run('paint_surface', { id: 'Site', material: 'none', all: true });
  e = ctx.doc.entities.find((x) => x.id === 'g1');
  assert.equal(e.fm, undefined);
  assert.equal(e.mesh.fc, undefined, 'clearing all paint gives the plain colour back');
});

test('takeoff: area, plan area, volume, weight and cost; CSV, GeoJSON and library round trip', async () => {
  const { ctx, reg } = makeCtx();
  await grid(reg, ctx);
  await reg.run('define_surface_material', { name: 'Asphalt', thickness: 0.1, density: 2000, cost: 10 });
  await reg.run('paint_surface', { id: 'Site', material: 'Asphalt', faces: [0, 1, 2, 3] });
  const t = await reg.run('material_takeoff', { format: 'csv' });
  const row = t.rows[0];
  assert.equal(row.material, 'Asphalt');
  near(row.area, 4);
  near(row.plan_area, 4);
  near(row.volume, 0.4);
  near(row.weight_t, 0.8);
  near(row.cost, 40);
  assert.match(t.csv, /^material,code,faces,area_m2/);
  assert.match(t.csv, /Total,,,4,4,,0.4,,0.8,,40/);
  const gj = TK.toGeoJson(ctx.doc);
  assert.equal(gj.features.length, 4);
  assert.equal(gj.features[0].geometry.coordinates[0].length, 5, 'closed ring');
  const lib = TK.parseLibrary(TK.libraryCsv(ctx.doc));
  assert.equal(lib.find((m) => m.name === 'Asphalt').thickness, '0.1');
  const r = await reg.run('import_surface_materials', { text: 'name,code,color,density\n"Fill, select",31 23 23,#998877,1950\n' });
  assert.equal(r.imported, 1);
  assert.equal(TK.get(ctx.doc, 'Fill, select').density, 1950);
});
