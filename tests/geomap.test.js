// Maps, projections and the view grid (geomap.js), the map / grid commands, and a guard on swallowed keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCtx } from './helpers.js';
import * as M from '../src/core/geomap.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('tiles: lat/long ↔ tile', () => {
  assert.deepEqual(M.lonLatToTile(0, 0, 1), { x: 1, y: 1 });
  assert.deepEqual(M.tileToLonLat(1, 1, 1), [0, 0]);
  const t = M.lonLatToTile(2.2945, 48.8582, 15);
  const [lon, lat] = M.tileToLonLat(t.x, t.y, 15);
  near(lon, 2.2945, 1e-9, 'lon');
  near(lat, 48.8582, 1e-9, 'lat');
  assert.equal(M.tileUrl('map', 3, 4, 2), 'https://tile.openstreetmap.org/3/4/2.png');
  assert.match(M.tileUrl('imagery', 3, 4, 2), /tile\/3\/2\/4$/);
  const a = M.tilesAround(2.2945, 48.8582, 300);
  assert.ok(a.x1 - a.x0 <= 6 && a.x1 >= a.x0 && a.z >= 14, JSON.stringify(a));
});

test('projections: known points and round trips', () => {
  const utm13 = M.projection(32613);
  const [e, n] = utm13.forward(-105, 40);
  near(e, 500000, 1e-6, 'central meridian E');
  near(n, 4427757.22, 1, 'UTM N at 40°N'); // 0.9996 × meridian arc 4 429 529.03
  const [x, y] = M.projection(2154).forward(3, 46.5);
  near(x, 700000, 1e-6, 'Lambert-93 origin E');
  near(y, 6600000, 1e-6, 'Lambert-93 origin N');
  near(M.projection(2154).forward(2.3499, 48.853)[0], 652000, 1500, 'Paris in Lambert-93'); // Notre-Dame ≈ 652 000, 6 862 000
  for (const [epsg, lon, lat] of [[32631, 2.29, 48.86], [32760, 174.8, -41.3], [2193, 174.78, -41.29], [2154, -1.55, 47.22], [3857, 151.2, -33.87], [2157, -6.26, 53.35], [7856, 151.2, -33.87], [3812, 4.35, 50.85]]) {
    const p = M.projection(epsg);
    const [ee, nn] = p.forward(lon, lat);
    const [lo, la] = p.inverse(ee, nn);
    near(lo, lon, 1e-7, `${epsg} lon`);
    near(la, lat, 1e-7, `${epsg} lat`);
  }
  assert.equal(M.projection(27700), null); // British grid needs a datum shift: not offered
});

test('placer: lat/longs in the model', () => {
  const p = M.projection(32631);
  const base = p.forward(2.2945, 48.8582);
  const pl = M.placer({ base, epsg: 32631 });
  assert.ok(pl.grid);
  near(pl.origin[0], 2.2945, 1e-8, 'origin lon');
  const [x, z] = pl.toLocal(2.2945, 48.8592); // 0.001° north ≈ 111 m
  near(x, 0, 2, 'north stays on x 0 (small convergence)');
  near(z, -111.2, 0.5, 'north is −z');
  const g = M.placer({ geolocation: { latitude: 48.8582, longitude: 2.2945 } });
  assert.equal(g.grid, false);
  near(g.toLocal(2.2945, 48.8592)[1], -111.2, 0.5, 'local plane');
  assert.equal(M.placer({}), null);
});

test('grid lines and labels', () => {
  assert.equal(M.gridStep(100), 20);
  assert.equal(M.gridStep(8), 1);
  assert.deepEqual(M.gridValues(-25, 45, 20), [-20, 0, 20, 40]);
  assert.equal(M.gridLabel('E', 512300, 100), 'E 512 300');
  assert.equal(M.gridLabel('N', 5400050.5, 0.5), 'N 5 400 050.5');
});

test('commands: set_base_point from lat/long, convert_coordinates, set_view_overlay', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 2, height: 2, depth: 2 });
  const before = ctx.doc.entities[0].position.slice();
  const r = await reg.run('set_base_point', { latitude: 48.8582, longitude: 2.2945, z: 35 });
  assert.equal(ctx.doc.geo.crs.epsg, 32631); // no system yet: the UTM zone of the place
  near(r.base[0], 448252, 30, 'E');
  near(r.base[1], 5411935, 30, 'N');
  assert.equal(r.base[2], 35);
  assert.deepEqual(ctx.doc.entities[0].position, before); // nothing moves: the model origin is that place
  assert.equal(ctx.doc.settings.geolocation.latitude, 48.8582);
  const c = await reg.run('convert_coordinates', { e: r.base[0], n: r.base[1] });
  near(c.latitude, 48.8582, 1e-6, 'back to lat');
  const v = await reg.run('set_view_overlay', { map: 'imagery', grid: true });
  assert.deepEqual(ctx.doc.settings.view_overlay, { map: 'imagery', grid: true, radius: 300, opacity: 1 });
  assert.match(v.attribution, /Esri/);
  await reg.run('set_coordinate_system', { epsg: 27700 });
  await assert.rejects(reg.run('set_base_point', { latitude: 51.5, longitude: -0.12 }), /cannot convert|e and n/i);
});

test('no on-key property handler returns false (it swallows every other key)', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const bad = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => /\.onkey(down|press)\s*=\s*\(?\w*\)?\s*=>\s*\(?\s*\w+\.(key|ctrlKey)\b[^?]*&&/.test(l));
    assert.deepEqual(bad, [], `${f}: use \`(e) => void (…)\` or a body`);
  }
});
