// Elevation from web services and streamed buildings: WCS 2.0 capabilities and GetCoverage per tile, Terrarium and
// Terrain-RGB decoding, height sampling, an area to a surface, buildings brought in as prisms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as O from '../src/core/ogc.js';
import * as E from '../src/core/elevation.js';
import * as GM from '../src/core/geomap.js';

// trimmed from the Dutch AHN WCS (MapServer)
const WCS = `<?xml version="1.0" encoding="UTF-8"?><wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0" xmlns:ows="http://www.opengis.net/ows/2.0" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0.1">
<ows:ServiceIdentification><ows:Title>AHN</ows:Title><ows:Profile>http://www.opengis.net/spec/WCS/2.0/conf/core</ows:Profile><ows:Profile>http://www.opengis.net/spec/GMLCOV_geotiff-coverages/1.0/conf/geotiff-coverage</ows:Profile><ows:Profile>http://www.opengis.net/spec/WCS_service-extension_crs/1.0/conf/crs</ows:Profile><ows:Profile>http://www.opengis.net/spec/WCS_service-extension_scaling/1.0/conf/scaling</ows:Profile></ows:ServiceIdentification>
<ows:ServiceProvider><ows:ProviderName>PDOK</ows:ProviderName></ows:ServiceProvider>
<ows:OperationsMetadata><ows:Operation name="GetCoverage"><ows:DCP><ows:HTTP><ows:Get xlink:href="https://service.example.nl/ahn/wcs?"/></ows:HTTP></ows:DCP></ows:Operation></ows:OperationsMetadata>
<wcs:Contents><wcs:CoverageSummary><wcs:CoverageId>dsm_05m</wcs:CoverageId></wcs:CoverageSummary><wcs:CoverageSummary><wcs:CoverageId>dtm_05m</wcs:CoverageId></wcs:CoverageSummary></wcs:Contents></wcs:Capabilities>`;

test('WCS 2.0: coverages as elevation layers, GetCoverage per Web Mercator tile in GeoTIFF', () => {
  const c = O.readCapabilities(WCS);
  assert.deepEqual([c.kind, c.provider, c.crsExtension, c.scaling, c.geotiff], ['wcs', 'PDOK', true, true, true]);
  assert.deepEqual(c.layers.map((l) => l.id), ['dsm_05m', 'dtm_05m']);
  const L = O.layerFrom(c, { layer: 'dtm_05m' });
  assert.deepEqual([L.type, L.kind, L.encoding], ['wcs', 'elevation', 'geotiff']);
  const u = O.tileUrl(L, 16, 33660, 21538);
  const [a, b, cc, d] = O.tileBounds(16, 33660, 21538);
  assert.ok(u.startsWith('https://service.example.nl/ahn/wcs?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=dtm_05m&FORMAT=image%2Ftiff'));
  assert.ok(u.includes(`&SUBSET=x(${a},${cc})&SUBSET=y(${b},${d})&SCALESIZE=x(256),y(256)`));
  assert.ok(decodeURIComponent(u).includes('SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/3857'));
  assert.throws(() => O.layerFrom({ ...c, crsExtension: false }, { layer: 'dtm_05m' }), /CRS and scaling extensions/);
  const back = O.fromOwsContext(O.toOwsContext([{ ...L, name: 'AHN DTM' }]));
  assert.deepEqual([back[0].type, back[0].kind, back[0].encoding], ['wcs', 'elevation', 'geotiff']);
});

test('Terrarium and Terrain-RGB decode; heights sampled between pixel centres; deeper tiles win', () => {
  // 100.5 m in Terrarium: 32868.5 → r 128, g 100, b 128; in Terrain-RGB: (100.5 + 10000) × 10 = 101005 → r 1, g 138, b 141
  near(E.decodeRgba(Uint8Array.of(128, 100, 128, 255), 1, 1, 'terrarium')[0], 100.5);
  near(E.decodeRgba(Uint8Array.of(1, 138, 141, 255), 1, 1, 'mapbox')[0], 100.5, 1e-3);
  assert.ok(Number.isNaN(E.decodeRgba(Uint8Array.of(1, 2, 3, 0), 1, 1, 'terrarium')[0]), 'transparent: no height');
  assert.throws(() => E.decodeRgba(new Uint8Array(4), 1, 1, 'lerc'), /Unknown elevation encoding/);
  const clean = E.cleanHeights(Float32Array.of(3.2, 3.4028234663852886e38, -9999), -9999);
  assert.deepEqual([clean[0] > 3.19, Number.isNaN(clean[1]), Number.isNaN(clean[2])], [true, true, true]);
  // a 2 × 2 tile: left column 10 m, right column 20 m; west half of the tile at lon −180..0, zoom 1
  const tiles = new Map([['0/0/0', { width: 2, height: 2, values: Float32Array.of(10, 20, 10, 20) }]]);
  near(E.heightAt(tiles, 0, 0), 15, 1e-6);
  near(E.heightAt(tiles, -170, 0), 10, 1e-6);
  tiles.set('1/1/0', { width: 1, height: 1, values: Float32Array.of(99) });
  near(E.heightAt(tiles, 45, 45), 99, 1e-6, 'the deeper tile wins where it has the place');
  near(E.heightAt(tiles, -45, -45), 12.5, 1e-6, "a quarter of the way from the 10 m to the 20 m column");
  assert.ok(Number.isNaN(E.heightAt(new Map(), 0, 0)));
  assert.equal(E.zoomFor(1, 52.37), 17);
  assert.deepEqual(E.tilesIn([4.9, 52.36, 4.91, 52.37], 14).length, 2);
});

test('an elevation area becomes a grid for a surface, sample nodes on the spacing', () => {
  const g = E.areaGrid([1000, 2000, 1010, 2004], 2, (e, n) => [e, n], (lon, lat) => lon / 100 + (lat > 2003 ? NaN : 0));
  assert.deepEqual([g.width, g.height, g.found], [6, 3, 12]);
  assert.equal(g.values[0], -9999, 'the top row (N 2004) has no data');
  near(g.values[2 * 6 + 5], 10.1, 1e-4);
  near(g.affine[2] + g.affine[0] * 0.5, 1000, 1e-9, 'pixel centre 0 sits on E 1000');
  assert.throws(() => E.areaGrid([0, 0, 1e5, 1e5], 1, (e, n) => [e, n], () => 1), /larger spacing/);
});

test('elevation_to_surface: streamed tiles to an editable surface; buildings from a feature layer as prisms', async () => {
  const { ctx, reg } = makeCtx();
  // a fake terrain service: every tile is a slope rising 1 m per pixel column (Terrarium PNG decoded by io.imageRgba)
  const png = (url) => ({ bytes: new TextEncoder().encode(url), type: 'image/png' });
  const buildings = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'b1', properties: { identificatie: 'NL.1', ground: 1.2, roof: 9.7 }, geometry: { type: 'Polygon', coordinates: [[[4.9041, 52.3676], [4.9043, 52.3676], [4.9043, 52.3677], [4.9041, 52.3677], [4.9041, 52.3676]]] } }],
  };
  const WFS = '<?xml version="1.0"?><WFS_Capabilities version="2.0.0" xmlns="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1"><ows:OperationsMetadata><ows:Operation name="GetFeature"><ows:Parameter name="outputFormat"><ows:AllowedValues><ows:Value>application/json</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation></ows:OperationsMetadata><FeatureTypeList><FeatureType><Name>bag:pand</Name><Title>Buildings</Title><DefaultCRS>urn:ogc:def:crs:OGC:1.3:CRS84</DefaultCRS></FeatureType></FeatureTypeList></WFS_Capabilities>';
  ctx.io = {
    ogcGet: async (url, o = {}) => (o.binary ? png(url) : /GetFeature/.test(url) ? { text: JSON.stringify(buildings) } : { text: WFS }),
    imageRgba: async () => {
      const w = 4;
      const rgba = new Uint8Array(w * w * 4);
      for (let i = 0; i < w * w; i++) rgba.set([128, (i % w) + 10, 0, 255], i * 4); // 32768 + col + 10 − 32768 = col + 10 m
      return { width: w, height: w, rgba };
    },
  };
  await reg.run('set_coordinate_system', { epsg: 32631, name: 'WGS 84 / UTM zone 31N' });
  await reg.run('set_base_point', { latitude: 52.3676, longitude: 4.9041, z: 0 });
  const L = await reg.run('add_map_layer', { url: 'https://tiles.example.com/terrarium/{z}/{x}/{y}.png', elevation: 'terrarium', name: 'Terrain' });
  assert.equal(L.kind, 'elevation');
  const s = await reg.run('elevation_to_surface', { layer: 'Terrain', at: [0, 0], radius: 40, spacing: 5, name: 'Existing ground (Terrain)' });
  assert.equal(s.name, 'Existing ground (Terrain)');
  assert.ok(s.triangles > 100);
  const surf = ctx.doc.entities.find((e) => e.name === 'Existing ground (Terrain)');
  assert.ok(surf.meta?.surface, 'a surface: sculpt, pads and cut / fill work on it');
  const ys = surf.mesh.v.map((v) => v[1] + surf.position[1]);
  assert.ok(Math.min(...ys) >= 10 - 1e-6 && Math.max(...ys) <= 13 + 1e-6, 'heights from the tiles');
  // buildings: a feature layer with an extrusion, brought in as prisms from ground to roof
  await reg.run('add_map_layer', { url: 'https://bag.example.nl/wfs?SERVICE=WFS&REQUEST=GetCapabilities', name: 'Buildings', style: { extrude: { base: 'ground', top: 'roof' } } });
  const r = await reg.run('import_features', { layer: 'Buildings', at: [0, 0], radius: 100 });
  assert.equal(r.buildings, 1);
  const b = ctx.doc.entities.find((e) => e.derived?.generator === 'prism');
  assert.equal(b.name, 'NL.1');
  near(b.derived.params.height, 8.5, 1e-6);
  near(b.position[1], 1.2, 1e-6);
  assert.equal(b.meta.roof, 9.7, 'attributes kept');
  assert.equal(b.tag, 'Buildings');
});

test('the job projection and the elevation zoom agree on pixel sizes', () => {
  near(E.pixelSize(17, 52.37), 0.729, 1e-3);
  assert.ok(GM.projection(32631));
});
