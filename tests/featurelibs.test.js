// Feature code libraries: the FXL reader / writer (schema 9, Feature Definition Manager), the SQLite library store and
// the commands that manage libraries and pick the model's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { makeCtx } from './helpers.js';
import { fxlLibrary, fxlWrite, featureCsv } from '../src/core/trimble.js';
import * as S from '../src/core/survey.js';

const FXL = fs.readFileSync(new URL('./fixtures/sample.fxl', import.meta.url), 'utf8');
const { CodeLibs } = createRequire(import.meta.url)('../src/main/codelibs.cjs');

/** A registry wired to an in-memory store, the way the page reaches the real one over IPC. */
function withStore() {
  const r = makeCtx();
  const store = new CodeLibs(':memory:');
  const files = {};
  r.ctx.codelibs = { call: async (op, ...args) => structuredClone(store[op](...args)) };
  r.ctx.io = { readText: async (p) => files[p], writeText: async (p, t) => (files[p] = t) };
  return { ...r, store, files };
}

test('FXL schema 9: codes, types, categories, layers and by-layer colours, line styles, typed attributes', () => {
  const { codes, layers } = fxlLibrary(FXL);
  assert.deepEqual(Object.keys(codes), ['VETRE', 'SUBEN', 'ROKERB', 'BUOUT'], 'codes upper-cased, point / line / polygon');
  assert.deepEqual(layers.map((l) => l.name), ['0', 'WS-Veg_Tree', 'WS-Road_Kerb']);
  const tree = codes.VETRE;
  assert.equal(tree.description, 'Tree');
  assert.equal(tree.type, 'point');
  assert.equal(tree.category, 'Vegetation - VE');
  assert.equal(tree.color, '#2e7d32', 'FE000000 is by layer: the layer colour');
  assert.deepEqual(tree.attrs, [
    { name: 'Type', type: 'list', options: ['Unknown', 'Kōwhai', 'Rimu'], required: true, description: 'type of tree', default: 'Kōwhai' },
    { name: 'Height', type: 'number', required: true, description: 'height of the tree', default: 2, min: 0, decimals: 1 },
    { name: 'Trunk', type: 'number', kind: 'integer', min: 0 },
    { name: 'Photo', type: 'text', kind: 'photo' },
  ], 'only <Attributes>: the symbol\'s empty ListAttribute stays out');
  assert.deepEqual(codes.ROKERB, { description: 'Back-Of-Kerb', type: 'line', category: 'Road - RO', layer: 'WS-Road_Kerb', color: '#ff5500', lineStyle: 'Dashed', line: true });
  assert.equal(codes.BUOUT.type, 'polygon');
  assert.equal(codes.BUOUT.color, '#8000ff', 'polygons: the border colour');
  assert.ok(codes.BUOUT.closed && codes.BUOUT.line);
  assert.equal(codes.SUBEN.color, undefined, 'a white layer leaves the code uncoloured');
});

test('FXL written back reads the same; CSV has a row per code', () => {
  const lib = fxlLibrary(FXL);
  const again = fxlLibrary(fxlWrite(lib));
  assert.deepEqual(again.codes, lib.codes);
  const csv = featureCsv(lib.codes).trim().split('\n');
  assert.equal(csv.length, 5);
  assert.equal(csv[0], 'code,description,type,category,layer,color,line_style,attributes');
  assert.match(csv[1], /^VETRE,Tree,point,Vegetation - VE,WS-Veg_Tree,#2e7d32,,Type:list\[Unknown\|Kōwhai\|Rimu\]\*; Height:number\*; Trunk:integer; Photo:photo$/);
});

test('the older FeatureDefinitionLibrary layout still reads', () => {
  const { codes } = fxlLibrary('<FeatureDefinitionLibrary><Layers><Layer Name="K" Color="#ff5500"/></Layers><LineFeatureDefinition Code="KERB" Layer="K" Description="Kerb"/></FeatureDefinitionLibrary>');
  assert.deepEqual(codes.KERB, { description: 'Kerb', type: 'line', layer: 'K', color: '#ff5500', line: true });
});

test('library store: save, list, rename, duplicate, edit a code, delete (SQLite)', () => {
  const s = new CodeLibs(':memory:');
  s.save({ name: 'Beca', source: 'x.fxl', ...fxlLibrary(FXL) });
  assert.throws(() => s.save({ name: 'beca', codes: {} }), /exists already/, 'names are case-blind');
  s.duplicate('Beca', 'Beca 2');
  s.rename('Beca 2', 'Mine');
  assert.throws(() => s.rename('Mine', 'BECA'), /exists already/);
  s.setCode('Mine', 'gnd', { description: 'Ground', type: 'point' });
  s.setCode('Mine', 'SUBEN', null);
  assert.throws(() => s.setCode('Mine', 'NOPE', null), /not in Mine/);
  assert.deepEqual(s.list().map((l) => [l.name, l.codes]), [['Beca', 4], ['Mine', 4]]);
  assert.deepEqual(Object.keys(s.get('Mine').codes), ['BUOUT', 'GND', 'ROKERB', 'VETRE']);
  assert.equal(s.get('Beca').layers.length, 3);
  s.remove('Beca');
  assert.throws(() => s.get('Beca'), /No feature library named "Beca"\. Libraries: Mine/);
  assert.equal(s.save({ name: 'Mine', codes: { A: {} } }, true).codes, 1, 'replace');
});

test('commands: import an FXL, use it in the model (with a snapshot), edit, export, manage', async () => {
  const { ctx, reg, files } = withStore();
  files['C:/libs/Beca.fxl'] = FXL;
  const r = await reg.run('import_feature_library', { path: 'C:/libs/Beca.fxl' });
  assert.deepEqual([r.name, r.codes, r.types], ['Beca', 4, { point: 2, line: 1, polygon: 1 }]);
  await reg.run('add_point', { n: 100, e: 200, z: 10, code: 'VETRE' });
  await reg.run('add_point', { n: 101, e: 201, z: 10 }); // no code at all
  const used = await reg.run('use_feature_library', { name: 'beca' });
  assert.equal(used.in_use, 'Beca');
  assert.equal(ctx.doc.featureLibrary.name, 'Beca');
  assert.equal(ctx.doc.featureCodes.ROKERB.lineStyle, 'Dashed', 'the codes are kept in the model');
  assert.equal(ctx.doc.entities.find((e) => e.point?.code === 'VETRE').tag, 'WS-Veg_Tree');
  assert.equal(ctx.doc.entities.filter((e) => e.type === 'point' && !e.point.code).length, 1, 'a point without a code');

  const found = await reg.run('feature_library', { name: 'Beca', search: 'kerb' });
  assert.deepEqual(found.codes.map((c) => c.code), ['ROKERB']);
  assert.equal((await reg.run('feature_library', {})).total, 4, 'the model\'s codes');

  await reg.run('edit_library_code', { library: 'Beca', code: 'gnd', description: 'Ground shot', type: 'point', color: '#884400' });
  assert.equal(ctx.doc.featureCodes.GND.description, 'Ground shot', 'the model follows its library');
  await reg.run('edit_library_code', { library: 'Beca', code: 'ROKERB', type: 'polygon' });
  assert.ok(ctx.doc.featureCodes.ROKERB.closed);
  await reg.run('edit_library_code', { library: 'Beca', code: 'GND', remove: true });
  assert.equal(ctx.doc.featureCodes.GND, undefined);

  await reg.run('manage_feature_library', { name: 'Beca', action: 'duplicate', to: 'Copy' });
  await reg.run('manage_feature_library', { name: 'Beca', action: 'rename', to: 'Beca 2016' });
  assert.equal(ctx.doc.featureLibrary.name, 'Beca 2016', 'the model follows the rename');
  await reg.run('manage_feature_library', { name: 'Copy', action: 'delete' });
  const list = await reg.run('feature_libraries', {});
  assert.deepEqual([list.libraries.map((l) => l.name), list.in_use], [['Beca 2016'], 'Beca 2016']);

  await reg.run('export_feature_library', { library: 'Beca 2016', path: 'C:/out/b.fxl' });
  assert.deepEqual(fxlLibrary(files['C:/out/b.fxl']).codes.VETRE, fxlLibrary(FXL).codes.VETRE);
  await reg.run('export_feature_library', { path: 'C:/out/b.csv' });
  assert.match(files['C:/out/b.csv'], /^code,description/);
  const json = await reg.run('export_feature_library', {});
  assert.ok(json.library.VETRE);

  // a model opened on another machine: keep its codes as a library there
  await reg.run('import_feature_library', { name: 'From the model' });
  assert.equal((await reg.run('feature_library', { name: 'From the model' })).total, 4);
  await reg.run('use_feature_library', { name: '' });
  assert.equal(ctx.doc.featureLibrary, undefined);
  assert.equal(Object.keys(ctx.doc.featureCodes).length, 4, 'the codes stay');
});

test('editCode and searchCodes', () => {
  assert.deepEqual(S.editCode({ description: 'K', type: 'line', line: true }, { type: 'point', line_style: 'Dashed' }), { description: 'K', type: 'point', lineStyle: 'Dashed' });
  assert.deepEqual(S.editCode({ type: 'point' }, { line: true }), { type: 'line', line: true });
  const codes = { TREE: { description: 'Tree' }, KERB: { description: 'Kerb', layer: 'Roads' }, BTREE: { description: 'Big tree' } };
  assert.deepEqual(S.searchCodes(codes, 'tr').map((r) => r.code), ['TREE', 'BTREE']);
  assert.deepEqual(S.searchCodes(codes, 'roads').map((r) => r.code), ['KERB']);
});
