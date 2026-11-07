// Phase 10 formats: Trimble JobXML and FXL, GeoJSON and Shapefile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import * as D from '../src/core/document.js';
import * as S from '../src/core/survey.js';
import { fxlColor } from '../src/core/trimble.js';
import { readDbf } from '../src/core/gis.js';

const JXL = `<?xml version="1.0"?>
<JOBFile jobName="Riverside" version="5.70">
  <Environment><CoordinateSystem><SystemName>NZGD2000 / NZTM</SystemName></CoordinateSystem></Environment>
  <FieldBook>
    <PointRecord ID="1"><Name>100</Name><Code>CP</Code><Grid><North>5400100.000</North><East>650100.000</East><Elevation>102.000</Elevation></Grid></PointRecord>
    <PointRecord ID="2"><Name>101</Name><Code>TREE</Code><Grid><North>5400110.000</North><East>650105.000</East><Elevation>102.500</Elevation></Grid>
      <Features><Feature Name="TREE"><Attribute><Name>Height</Name><Value>6.5</Value></Attribute><Attribute><Name>Species</Name><Value>Oak</Value></Attribute></Feature></Features></PointRecord>
    <PointRecord ID="3"><Name>102</Name><Code>X</Code><Grid><North>5400120.000</North><East>650110.000</East><Elevation>103.000</Elevation></Grid></PointRecord>
    <PointRecord ID="4"><Name>102</Name><Deleted>true</Deleted></PointRecord>
    <PointRecord ID="5"><Name>103</Name><Code>KERB</Code><ComputedGrid><North>5400130.000</North><East>650115.000</East><Elevation>103.200</Elevation></ComputedGrid></PointRecord>
  </FieldBook>
</JOBFile>`;

const FXL = `<?xml version="1.0"?>
<FeatureDefinitionLibrary xmlns="http://www.trimble.com/schema/fxl" Version="6">
  <Layers><Layer Name="Vegetation" Color="#2e7d32"/><Layer Name="Kerbs"><Color>255,85,0</Color></Layer></Layers>
  <FeatureDefinitions>
    <PointFeatureDefinition Name="Tree" Code="TREE" Layer="Vegetation" Description="Tree">
      <Attributes><DoubleAttribute Name="Height" Required="true"/><ListAttribute Name="Species"><Item>Oak</Item><Item>Birch</Item></ListAttribute></Attributes>
    </PointFeatureDefinition>
    <LineFeatureDefinition Code="KERB" Layer="Kerbs" Description="Kerb line"/>
    <PolygonFeatureDefinition><Code>BLD</Code><Description>Building</Description><Color>-16776961</Color></PolygonFeatureDefinition>
  </FeatureDefinitions>
</FeatureDefinitionLibrary>`;

test('Trimble JobXML: grid and computed points, deleted points dropped, feature attributes kept', async () => {
  const { ctx, reg } = makeCtx();
  const r = await reg.run('import', { text: JXL, format: 'jxl' });
  assert.equal(r.created.points, 3);
  assert.equal(r.job, 'Riverside');
  assert.ok(r.warnings.some((w) => /NZTM/.test(w)));
  const tree = ctx.doc.entities.find((e) => e.name === '101');
  assert.deepEqual(tree.point.attrs, { Height: 6.5, Species: 'Oak' });
  assert.ok(!ctx.doc.entities.some((e) => e.name === '102'), 'the deleted point stays out');
  near(ctx.doc.entities.find((e) => e.name === '103').point.z, 103.2);
});

test('Trimble FXL: codes, layers and colours, attributes with pick lists and required', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('import', { text: JXL, format: 'jxl' });
  const r = await reg.run('import', { text: FXL, format: 'fxl' });
  assert.deepEqual(r.codes, ['TREE', 'KERB', 'BLD']);
  const fc = ctx.doc.featureCodes;
  assert.equal(fc.TREE.layer, 'Vegetation');
  assert.equal(fc.TREE.color, '#2e7d32', 'the colour of its layer');
  assert.equal(fc.KERB.color, '#ff5500');
  assert.equal(fc.KERB.line, true);
  assert.equal(fc.BLD.color, '#0000ff');
  assert.deepEqual(fc.TREE.attrs, [{ name: 'Height', type: 'number', required: true }, { name: 'Species', type: 'list', options: ['Oak', 'Birch'] }]);
  assert.equal(ctx.doc.entities.find((e) => e.name === '101').tag, 'Vegetation', 'points reprocessed with the library');
  assert.equal(fxlColor('#ff00aa11'), '#00aa11');
});

test('GeoJSON both ways: points with properties, lines, polygons; degrees flagged', async () => {
  const { ctx, reg } = makeCtx();
  const files = {};
  ctx.io = { writeText: async (p, t) => (files[p] = t), readText: async (p) => files[p] };
  const gj = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'MH1', code: 'MH', depth: 2.4, layer: 'Drainage' }, geometry: { type: 'Point', coordinates: [650010, 5400020, 101.5] } },
      { type: 'Feature', properties: { name: 'Pipe 1', diameter: 0.3, layer: 'Drainage' }, geometry: { type: 'LineString', coordinates: [[650010, 5400020, 99.1], [650040, 5400020, 98.8]] } },
      { type: 'Feature', properties: { name: 'Lot 7', owner: 'Smith' }, geometry: { type: 'Polygon', coordinates: [[[650000, 5400000], [650020, 5400000], [650020, 5400015], [650000, 5400015], [650000, 5400000]]] } },
    ],
  };
  const r = await reg.run('import', { text: JSON.stringify(gj), format: 'geojson' });
  assert.deepEqual(r.created, { points: 1, lines: 1, polygons: 1 });
  const mh = ctx.doc.entities.find((e) => e.name === 'MH1');
  assert.deepEqual([mh.point.code, mh.point.attrs.depth, mh.tag], ['MH', 2.4, 'Drainage']);
  const lot = ctx.doc.entities.find((e) => e.name === 'Lot 7');
  assert.ok(lot.curve.closed && lot.curve.points.length === 4);
  assert.equal(lot.meta.owner, 'Smith');
  await reg.run('export', { format: 'geojson', path: 'C:/out.geojson' });
  const back = JSON.parse(files['C:/out.geojson']);
  const pipe = back.features.find((f) => f.properties.name === 'Pipe 1');
  nearArr(pipe.geometry.coordinates[1], [650040, 5400020, 98.8], 1e-4);
  assert.equal(back.features.find((f) => f.properties.name === 'Lot 7').geometry.type, 'Polygon');
  const deg = await makeCtx().reg.run('import', { text: JSON.stringify({ type: 'Point', coordinates: [174.7, -36.8] }), format: 'geojson' });
  assert.ok(deg.warnings.some((w) => /longitude/.test(w)));
});

test('Shapefile both ways: .shp, .shx and .dbf per geometry kind, Z and attributes kept', async () => {
  const { ctx, reg } = makeCtx();
  const files = {};
  ctx.io = { writeText: async (p, t) => (files[p] = t), readBinary: async (p) => files[p], pick: async () => null };
  await reg.run('add_point', { name: 'P1', n: 5400000, e: 650000, z: 100, code: 'CP' });
  await reg.run('add_point', { name: 'P2', n: 5400010, e: 650005, z: 101.25, code: 'GND' });
  await reg.run('create_curve', { points: [[0, 0, 0], [10, 1, 0], [10, 2, -10]], name: 'Fence' });
  await reg.run('set_metadata', { ids: ['Fence'], values: { material: 'timber', height: 1.2 } });
  await reg.run('create_curve', { points: [[20, 0, 0], [30, 0, 0], [30, 0, -10]], closed: true, name: 'Plot' });
  const out = await reg.run('export', { format: 'shp', path: 'C:/site.shp' });
  assert.deepEqual(out.paths.sort(), ['C:/site_lines.dbf', 'C:/site_lines.shp', 'C:/site_lines.shx', 'C:/site_points.dbf', 'C:/site_points.shp', 'C:/site_points.shx', 'C:/site_polygons.dbf', 'C:/site_polygons.shp', 'C:/site_polygons.shx'].sort());
  const rows = readDbf(files['C:/site_points.dbf']);
  assert.deepEqual(rows.map((x) => [x.name, x.code]), [['P1', 'CP'], ['P2', 'GND']]);
  const b = makeCtx();
  b.ctx.io = { readBinary: async (p) => files[p] };
  await b.reg.run('set_base_point', { n: 5400000, e: 650000, z: 100 });
  const rp = await b.reg.run('import', { path: 'C:/site_points.shp' });
  assert.equal(rp.created.points, 2);
  near(b.ctx.doc.entities.find((e) => e.name === 'P2').point.z, 101.25, 1e-6);
  const rl = await b.reg.run('import', { path: 'C:/site_lines.shp' });
  assert.equal(rl.created.lines, 1);
  const fence = b.ctx.doc.entities.find((e) => e.name === 'Fence');
  assert.deepEqual([fence.meta.material, fence.meta.height, fence.tag], ['timber', 1.2, 'site_lines']);
  nearArr(S.toProject(b.ctx.doc, D.curvePoints(b.ctx.doc, fence)[2]) && Object.values(S.toProject(b.ctx.doc, D.curvePoints(b.ctx.doc, fence)[2])), [650010, 5400010, 102], 1e-4);
  const rg = await b.reg.run('import', { path: 'C:/site_polygons.shp' });
  assert.equal(rg.created.polygons, 1);
  assert.equal(b.ctx.doc.entities.find((e) => e.name === 'Plot').curve.points.length, 3, 'the closing point is not doubled');
});
