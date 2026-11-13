// Phase 22 OGC services (#264–#268, #261): capabilities, tile and feature requests, axis order, OWS Context, SLD,
// GeoPackage, the coordinate engine. Fixtures are trimmed from public services' answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeCtx, near } from './helpers.js';
import * as O from '../src/core/ogc.js';
import * as GP from '../src/core/gpkg.js';
import * as GM from '../src/core/geomap.js';

const WMTS = `<?xml version="1.0"?><Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.0.0">
<ows:ServiceIdentification><ows:Title>Imagery</ows:Title></ows:ServiceIdentification><ows:ServiceProvider><ows:ProviderName>Example Mapping</ows:ProviderName></ows:ServiceProvider>
<ows:OperationsMetadata><ows:Operation name="GetTile"><ows:DCP><ows:HTTP><ows:Get xlink:href="https://maps.example.com/wmts?"/></ows:HTTP></ows:DCP></ows:Operation></ows:OperationsMetadata>
<Contents>
 <Layer><ows:Title>Aerial 2024</ows:Title><ows:Identifier>aerial</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/jpeg</Format>
  <TileMatrixSetLink><TileMatrixSet>NZTM2000Quad</TileMatrixSet></TileMatrixSetLink><TileMatrixSetLink><TileMatrixSet>WebMercatorQuad</TileMatrixSet></TileMatrixSetLink>
  <ResourceURL format="image/jpeg" resourceType="tile" template="https://maps.example.com/tiles/aerial/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.jpg"/></Layer>
 <Layer><ows:Title>Grid only</ows:Title><ows:Identifier>gridonly</ows:Identifier><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>NZTM2000Quad</TileMatrixSet></TileMatrixSetLink></Layer>
 <TileMatrixSet><ows:Identifier>WebMercatorQuad</ows:Identifier><ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>
  <TileMatrix><ows:Identifier>0</ows:Identifier><ScaleDenominator>559082264.0287178</ScaleDenominator><TopLeftCorner>-20037508.3427892 20037508.3427892</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight></TileMatrix>
  <TileMatrix><ows:Identifier>1</ows:Identifier><ScaleDenominator>279541132.0143589</ScaleDenominator><TopLeftCorner>-20037508.3427892 20037508.3427892</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>2</MatrixWidth><MatrixHeight>2</MatrixHeight></TileMatrix>
  <TileMatrix><ows:Identifier>2</ows:Identifier><ScaleDenominator>139770566.0071794</ScaleDenominator><TopLeftCorner>-20037508.3427892 20037508.3427892</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>4</MatrixWidth><MatrixHeight>4</MatrixHeight></TileMatrix></TileMatrixSet>
 <TileMatrixSet><ows:Identifier>NZTM2000Quad</ows:Identifier><ows:SupportedCRS>urn:ogc:def:crs:EPSG::2193</ows:SupportedCRS>
  <TileMatrix><ows:Identifier>0</ows:Identifier><ScaleDenominator>32000000</ScaleDenominator><TopLeftCorner>10438190.1652 -3260586.7284</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>2</MatrixWidth><MatrixHeight>4</MatrixHeight></TileMatrix></TileMatrixSet>
</Contents></Capabilities>`;
const WMS = `<?xml version="1.0"?><WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink"><Service><Name>WMS</Name><Title>OpenStreetMap WMS</Title><ContactInformation><ContactPersonPrimary><ContactOrganization>Example GmbH</ContactOrganization></ContactPersonPrimary></ContactInformation></Service>
<Capability><Request><GetMap><Format>image/png</Format><Format>image/jpeg</Format><DCPType><HTTP><Get><OnlineResource xlink:href="https://ows.example.de/osm/service?"/></Get></HTTP></DCPType></GetMap></Request>
<Layer><Title>Root</Title><CRS>EPSG:3857</CRS><CRS>EPSG:4326</CRS><Layer queryable="1"><Name>OSM-WMS</Name><Title>OpenStreetMap</Title><Style><Name>default</Name></Style><Attribution><Title>© OpenStreetMap contributors</Title></Attribution></Layer></Layer></Capability></WMS_Capabilities>`;
const WFS = `<?xml version="1.0"?><WFS_Capabilities version="2.0.0" xmlns="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink"><ows:ServiceIdentification><ows:Title>Boundaries</ows:Title></ows:ServiceIdentification>
<ows:OperationsMetadata><ows:Operation name="GetFeature"><ows:DCP><ows:HTTP><ows:Get xlink:href="https://service.example.nl/wfs/v1_0?"/></ows:HTTP></ows:DCP><ows:Parameter name="outputFormat"><ows:AllowedValues><ows:Value>application/gml+xml; version=3.2</ows:Value><ows:Value>application/json</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation></ows:OperationsMetadata>
<FeatureTypeList><FeatureType><Name>bg:Gemeentegebied</Name><Title>Municipalities</Title><DefaultCRS>urn:ogc:def:crs:EPSG::28992</DefaultCRS><OtherCRS>urn:ogc:def:crs:EPSG::4326</OtherCRS></FeatureType></FeatureTypeList></WFS_Capabilities>`;

test('WMTS: capabilities, Web Mercator zooms only, RESTful template and KVP tiles', () => {
  const c = O.readCapabilities(WMTS, 'https://maps.example.com/wmts?REQUEST=GetCapabilities');
  assert.deepEqual([c.kind, c.title, c.provider, c.layers.length], ['wmts', 'Imagery', 'Example Mapping', 2]);
  assert.deepEqual(c.sets.WebMercatorQuad.zooms, ['0', '1', '2']);
  assert.equal(c.sets.NZTM2000Quad.zooms, null, 'not Web Mercator: listed, not drawn');
  const L = O.layerFrom(c, { layer: 'aerial' });
  assert.equal(L.set, 'WebMercatorQuad');
  assert.equal(O.tileUrl(L, 2, 3, 1), 'https://maps.example.com/tiles/aerial/WebMercatorQuad/2/3/1.jpg');
  assert.equal(O.tileUrl(L, 9, 3, 1), null, 'no matrix at that zoom');
  assert.match(O.tileUrl({ ...L, template: '' }, 1, 1, 0), /SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=aerial&STYLE=default&FORMAT=image%2Fjpeg&TILEMATRIXSET=WebMercatorQuad&TILEMATRIX=1&TILEROW=0&TILECOL=1/);
  assert.throws(() => O.layerFrom(c, { layer: 'gridonly' }), /no Web Mercator tile matrix set/);
  assert.equal(O.sniff(WMTS), 'wmts');
});

test('WMS 1.3 GetMap per Web Mercator tile; WFS 2.0 GetFeature with OGC axis order; OGC API Features with CQL2', () => {
  const w = O.readCapabilities(WMS);
  assert.equal(w.provider, 'Example GmbH');
  const L = O.layerFrom(w, { layer: 'OSM-WMS' });
  assert.equal(L.attribution, '© OpenStreetMap contributors');
  const u = new URL(O.tileUrl(L, 1, 0, 0));
  assert.deepEqual([u.searchParams.get('CRS'), u.searchParams.get('WIDTH'), u.searchParams.get('LAYERS')], ['EPSG:3857', '256', 'OSM-WMS']);
  near(+u.searchParams.get('BBOX').split(',')[2], 0);
  const f = O.readCapabilities(WFS);
  assert.equal(f.json, true);
  const F = O.layerFrom(f, {});
  const q = new URL(O.featuresUrl(F, [4.85, 52.33, 4.95, 52.4], { limit: 10 }));
  assert.equal(q.searchParams.get('SRSNAME'), 'urn:ogc:def:crs:EPSG::4326');
  assert.equal(q.searchParams.get('BBOX'), '52.33,4.85,52.4,4.95,urn:ogc:def:crs:EPSG::4326', 'EPSG:4326 is latitude first');
  const fe = new URL(O.featuresUrl(F, [0, 0, 1, 1], { where: { naam: 'Ouder-Amstel' } })).searchParams.get('FILTER');
  assert.match(fe, /<fes:PropertyIsEqualTo><fes:ValueReference>naam<\/fes:ValueReference><fes:Literal>Ouder-Amstel<\/fes:Literal>/);
  const api = O.readOgcApi({ title: 'Demo' }, { collections: [{ id: 'lakes', title: 'Lakes', links: [{ rel: 'items', href: 'https://x/collections/lakes/items' }] }] }, 'https://demo.example.org/api/');
  const A = O.layerFrom(api, { layer: 'lakes' });
  assert.equal(A.type, 'ogcapi-features');
  const items = new URL(O.featuresUrl(A, [1, 2, 3, 4], { limit: 5, cql: "name='Lake Ellesmere'" }));
  assert.equal(items.pathname, '/api/collections/lakes/items');
  assert.deepEqual([items.searchParams.get('bbox'), items.searchParams.get('filter'), items.searchParams.get('filter-lang')], ['1,2,3,4', "name='Lake Ellesmere'", 'cql2-text']);
  assert.equal(O.nextLink({ links: [{ rel: 'next', href: 'n' }] }), 'n');
  assert.equal(O.latFirst('urn:ogc:def:crs:EPSG::4326'), true);
  assert.equal(O.latFirst(O.CRS84), false);
});

test('axis order fixed from the answer, GeoJSON projected, touches', () => {
  const fc = { features: [{ geometry: { type: 'Point', coordinates: [52.36, 4.9] } }] };
  assert.equal(O.fixAxes(fc, [4.85, 52.33, 4.95, 52.4]), true);
  assert.deepEqual(fc.features[0].geometry.coordinates, [4.9, 52.36]);
  assert.equal(O.fixAxes({ features: [{ geometry: { type: 'Polygon', coordinates: [[[4.906, 52.25]]] } }] }, [4.85, 52.33, 4.95, 52.4]), false, 'a big polygon starting outside the box is not swapped');
  const p = O.projectGeoJson({ features: [{ geometry: { type: 'LineString', coordinates: [[1, 2, 7], [3, 4]] } }] }, (x, y) => [x * 10, y * 10]);
  assert.deepEqual(p.features[0].geometry.coordinates, [[10, 20, 7], [30, 40]]);
  const parcel = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  assert.equal(O.touches(parcel, [[5, -5], [5, 15]]), true, 'a road across');
  assert.equal(O.touches(parcel, [[20, -5], [20, 15]]), false);
  assert.equal(O.touches(parcel, [[10.3, -5], [10.3, 15]], 0.5), true, 'beside it, within the tolerance');
  assert.equal(O.touches(parcel, [[2, 2], [3, 3]]), true, 'inside');
});

test('OWS Context and SLD / SE both ways', () => {
  const layers = [
    { id: 'ml1', name: 'Aerial', type: 'wmts', kind: 'map', url: 'https://maps.example.com/wmts?', layer: 'aerial', set: 'WebMercatorQuad', zooms: ['0'], opacity: 0.8, attribution: 'Example' },
    { id: 'ml2', name: 'Parcels', type: 'wfs', kind: 'features', url: 'https://wfs.example?', layer: 'parcels', where: { zone: 'R1' }, style: { stroke: '#ff0000', width: 2, fill: '#00ff00', label: 'lot', rules: [{ where: { zone: 'R1' }, fill: '#0000ff' }] }, visible: false },
  ];
  const owc = O.toOwsContext(layers, { title: 'Site maps', bbox: [172, -44, 173, -43] });
  assert.equal(owc.features[0].properties.offerings[0].code, 'http://www.opengis.net/spec/owc-geojson/1.0/req/wmts');
  assert.match(owc.features[1].properties.offerings[0].styles[0].content.text, /<se:LineSymbolizer>/);
  const back = O.fromOwsContext(JSON.stringify(owc));
  assert.deepEqual(back.map((L) => [L.name, L.type, L.visible, L.opacity]), [['Aerial', 'wmts', true, 0.8], ['Parcels', 'wfs', false, 1]]);
  assert.deepEqual(back[1].where, { zone: 'R1' });
  // another writer's context: a WMS offering only
  const other = O.fromOwsContext({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { title: 'Roads', offerings: [{ code: 'http://www.opengis.net/spec/owc-geojson/1.0/req/wms', operations: [{ code: 'GetMap', href: 'https://w.example/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=roads' }] }] } }] });
  assert.deepEqual([other[0].type, other[0].layer], ['wms', 'roads']);
  const s = O.fromSld(O.toSld(layers[1].style, 'parcels'));
  assert.deepEqual({ stroke: s.stroke, width: s.width, fill: s.fill, label: s.label }, { stroke: '#ff0000', width: 2, fill: '#00ff00', label: 'lot' });
  assert.deepEqual(s.rules[0].where, { zone: 'R1' });
  assert.equal(O.styleFor(s, { zone: 'R1' }).fill, '#0000ff');
});

test('GeoPackage 1.4: features with heights and attributes, written and read back', () => {
  const file = path.join(os.tmpdir(), `mmr-${process.pid}.gpkg`);
  fs.rmSync(file, { force: true });
  const r = GP.writeGpkg(DatabaseSync, file, { srs: { epsg: 2193, name: 'NZTM' }, layers: [{ table: 'kerbs', features: [{ geometry: { type: 'LineString', coordinates: [[1570000, 5180000, 10], [1570010, 5180005, 10.5]] }, properties: { code: 'KERB', len: 11.2 } }] }, { table: 'lots', features: [{ geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }, properties: { lot: 'L7' } }] }] });
  assert.equal(r.features, 2);
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare('PRAGMA application_id').get().application_id, 1196444487);
  db.close();
  const back = GP.readGpkg(DatabaseSync, file);
  assert.deepEqual(back.tables.map((t) => [t.table, t.epsg]), [['kerbs', 2193], ['lots', 2193]]);
  assert.deepEqual(back.tables[0].features[0].geometry.coordinates[1], [1570010, 5180005, 10.5]);
  assert.deepEqual(back.tables[1].features[0], { geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }, properties: { lot: 'L7' } });
  fs.rmSync(file, { force: true });
});

test("coordinate engine (#261): a job's own projection, WKT-CRS, ECEF and Helmert, the placer both ways", () => {
  // a Trimble job on a local transverse Mercator circuit (no EPSG code): its WGS 84 point lands on its grid value
  const job = GM.fromJobProjection({ type: 'TransverseMercator', lat0: -43.590555555556, lon0: 172.72694444444, fe: 400000, fn: 800000, k0: 1 });
  const [e, n] = job.forward(172.60500340341, -43.555832526053);
  near(e, 390146.90559138, 0.001);
  near(n, 803850.63946832, 0.001);
  const wkt = 'PROJCRS["NZGD2000 / New Zealand Transverse Mercator 2000",BASEGEOGCRS["NZGD2000",DATUM["New Zealand Geodetic Datum 2000",ELLIPSOID["GRS 1980",6378137,298.257222101]]],CONVERSION["NZTM",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",0],PARAMETER["Longitude of natural origin",173],PARAMETER["Scale factor at natural origin",0.9996],PARAMETER["False easting",1600000],PARAMETER["False northing",10000000]],CS[Cartesian,2],ID["EPSG",2193]]';
  const w = GM.fromWkt(wkt);
  assert.equal(w.epsg, 2193);
  const [a, b] = w.forward(172.6, -43.53);
  const [c, d] = GM.projection(2193).forward(172.6, -43.53);
  near(a, c, 1e-6);
  near(b, d, 1e-6);
  const [lon, lat, h] = GM.fromEcef(...GM.toEcef(172.6, -43.53, 25));
  near(lon, 172.6, 1e-9);
  near(lat, -43.53, 1e-9);
  near(h, 25, 1e-4);
  assert.deepEqual(GM.helmert([1, 2, 3], { tx: 1, ty: -1 }), [2, 1, 3]);
  const pl = GM.placer({ base: [1570000, 5180000, 0], epsg: 2193 });
  const [x, z] = pl.toLocal(...pl.toLonLat(12, -34));
  near(x, 12, 1e-3);
  near(z, -34, 1e-3);
  assert.ok(GM.placer({ base: [390000, 803800, 0], job: { type: 'TransverseMercator', lat0: -43.59, lon0: 172.73, fe: 400000, fn: 800000, k0: 1 } }), 'a job projection places the model');
});

test('map layer commands: add from capabilities, order, style, OWS Context out and in, through a stubbed service', async () => {
  const { ctx, reg } = makeCtx();
  const files = {};
  ctx.io = {
    ogcGet: async (url) => ({ text: /wmts/i.test(url) ? WMTS : /wfs/i.test(url) ? WFS : '<html/>' }),
    writeText: async (p, t) => (files[p] = t),
    readText: async (p) => files[p],
  };
  await reg.run('set_coordinate_system', { epsg: 2193 });
  await reg.run('add_point', { name: 'B', n: 5180000, e: 1570000, z: 0 });
  const list = await reg.run('list_service_layers', { url: 'https://maps.example.com/wmts?SERVICE=WMTS&REQUEST=GetCapabilities' });
  assert.deepEqual(list.layers.map((l) => [l.id, l.drawable]), [['aerial', true], ['gridonly', false]]);
  const a = await reg.run('add_map_layer', { url: 'https://maps.example.com/wmts?SERVICE=WMTS&REQUEST=GetCapabilities', layer: 'aerial', opacity: 0.7 });
  assert.equal(a.standard, 'OGC WMTS 1.0.0');
  const f = await reg.run('add_map_layer', { url: 'https://service.example.nl/wfs?SERVICE=WFS&REQUEST=GetCapabilities', name: 'Parcels', where: { zone: 'R1' } });
  assert.equal(f.kind, 'features');
  await reg.run('set_map_layer', { layer: 'Parcels', order: 0, style: { stroke: '#123456' } });
  const rows = await reg.run('list_map_layers', { sld: true });
  assert.deepEqual(rows.map((r) => r.name), ['Aerial 2024', 'Parcels'], 'top first');
  assert.match(rows[1].sld, /#123456/);
  await reg.run('export_map_context', { path: 'C:/x/ctx.json' });
  await reg.run('remove_map_layer', { layer: 'Parcels' });
  await reg.run('remove_map_layer', { layer: 'Aerial 2024' });
  const back = await reg.run('import_map_context', { path: 'C:/x/ctx.json' });
  assert.deepEqual(back.added, ['Parcels', 'Aerial 2024']);
  ctx.store.undo();
  assert.equal(ctx.doc.settings.map_layers.length, 0, 'undo takes the layers off again');
});

test('docs/standards/ogc.md lists every standard the code says it implements (#270)', () => {
  const page = fs.readFileSync(new URL('../docs/standards/ogc.md', import.meta.url), 'utf8');
  for (const c of O.CONFORMANCE) assert.ok(page.includes(c.standard), `${c.standard} is on the page`);
});

test('feature pages: a server that ignores paging does not repeat features', () => {
  const list = [];
  const seen = new Set();
  const page = [{ id: 'p1', geometry: null, properties: {} }, { id: 'p2', geometry: null, properties: {} }];
  assert.equal(O.addPage(list, seen, page), 2);
  assert.equal(O.addPage(list, seen, page), 0, 'the same page again adds nothing: paging stops');
  assert.equal(list.length, 2);
});
