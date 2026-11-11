// Calm command forms (#215, #216) and the survey code card (#217).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as F from '../src/core/fields.js';
import * as S from '../src/core/survey.js';

test('fields: the control each schema property gets', () => {
  const { reg } = makeCtx();
  const p = reg.commands.get('design_plane').params;
  assert.equal(F.kindOf(p.properties.points), 'points');
  assert.equal(F.kindOf(p.properties.point), 'point');
  assert.equal(F.kindOf(p.properties.bearing), 'angle');
  assert.equal(F.kindOf(p.properties.slope), null, 'a plain number');
  assert.equal(F.kindOf(p.properties.size), 'tuple');
  assert.deepEqual(F.tupleLabels(p.properties.size), ['width', 'depth']);
  assert.deepEqual(F.defaultOf(p.properties.size), [20, 20]);
  assert.equal(F.defaultOf({ description: '%, default −2' }), -2);
  assert.equal(F.defaultOf({ description: 'm' }), undefined);
  assert.equal(F.exampleOf({ description: 'e.g. KERB' }), 'KERB');
  assert.equal(F.kindOf(reg.commands.get('design_road').params.properties.centre), 'points');
  assert.equal(F.kindOf(reg.commands.get('design_trench').params.properties.from), 'point');
});

test('fields: reading what was typed, with a message when it is wrong', () => {
  const names = new Set(['P1', 'MH 2']);
  assert.deepEqual(F.readPoint('P1', names), { value: 'P1' });
  assert.deepEqual(F.readPoint('MH 2', names), { value: 'MH 2' });
  assert.deepEqual(F.readPoint('1, 2.5, -3', names), { value: [1, 2.5, -3] });
  assert.deepEqual(F.readPoint('[1,2,3]', names), { value: [1, 2, 3] });
  assert.match(F.readPoint('P9', names).error, /No point named "P9"/);
  assert.match(F.readPoint('1, 2, 3', names, { namesOnly: true }).error, /No point/);
  assert.deepEqual(F.readPoint('  ', names), { value: undefined });
  assert.deepEqual(F.readAngle('45.5'), { value: 45.5 });
  assert.deepEqual(F.readAngle('45°30\'00"'), { value: '45°30\'00"' });
  assert.match(F.readAngle('north-ish').error, /degrees/);
  assert.deepEqual(F.readNumber('2,5'), { value: 2.5 });
  assert.deepEqual(F.readNumber('−2'), { value: -2 });
  assert.match(F.readNumber('abc').error, /number/);
  assert.match(F.readNumber('1.5', { type: 'integer' }).error, /whole/);
  assert.match(F.readNumber('-1', { minimum: 0 }).error, /At least 0/);
});

test('form hints stay in the app: AIs, MCP and the API get plain JSON Schema', () => {
  const { reg } = makeCtx();
  const json = JSON.stringify(reg.list());
  assert.ok(!json.includes('"ui"'), 'no ui hints in the listing');
  // every mode names fields the command has
  for (const c of reg.commands.values())
    for (const m of c.params.ui?.modes || []) for (const k of [...m.fields, ...(m.required || [])]) assert.ok(c.params.properties[k], `${c.name}: mode ${m.label} names ${k}`);
  // a property literally called ui survives
  assert.deepEqual(F.stripUi({ properties: { ui: { type: 'string', ui: { kind: 'x' } } }, ui: {} }), { properties: { ui: { type: 'string' } } });
});

test('design plane still runs both ways from what the form sends', async () => {
  const { reg } = makeCtx();
  await reg.run('import_points', { text: 'A,0,0,10\nB,0,10,10\nC,10,0,11' });
  const a = await reg.run('design_plane', { points: ['A', 'B', 'C'], size: [20, 20] });
  assert.ok(a.surface);
  const b = await reg.run('design_plane', { point: 'A', slope: 2, bearing: '45°30\'' });
  assert.ok(b.surface);
});

test('code card: recent codes first, the library next, filtered as you type', async () => {
  let recent = [];
  for (const c of ['GND', 'KERB', 'TREE', 'kerb']) recent = S.rememberCode(recent, c);
  assert.deepEqual(recent, ['kerb', 'TREE', 'GND'], 'most recent first, no duplicates');
  assert.equal(S.rememberCode(recent, '  '), recent);
  assert.equal(S.rememberCode(Array.from({ length: 20 }, (_, i) => `C${i}`), 'X').length, 12);

  const { reg, ctx } = makeCtx();
  await reg.run('define_feature_code', { code: 'TREE', description: 'Tree', object: { type: 'tree' } });
  await reg.run('define_feature_code', { code: 'LAMP', object: { type: 'component', component: 'Lamp' } });
  await reg.run('define_feature_code', { code: 'KERB', line: true });
  const all = S.suggestCodes(ctx.doc, ['GND', 'TREE']).map((x) => x.code);
  assert.deepEqual(all.slice(0, 2), ['GND', 'TREE'], 'recent first');
  assert.ok(all.includes('LAMP') && all.includes('KERB'));
  assert.deepEqual(S.suggestCodes(ctx.doc, ['GND'], 'ke').map((x) => x.code), ['KERB']);
  assert.deepEqual(S.suggestCodes(ctx.doc, [], 'KERB 2 B').map((x) => x.code), ['KERB'], 'the base code of a code with controls');
  assert.equal(S.suggestCodes(ctx.doc, [], 'LAMP')[0].action, 'places Lamp');
  assert.match(S.suggestCodes(ctx.doc, [], 'tree')[0].action, /Tree · places a tree/);
});

test('a code places a component from the model at the point', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('create_box', { width: 0.2, height: 3, depth: 0.2, name: 'Pole' });
  await reg.run('make_component', { ids: ['Pole'], name: 'Lamp' });
  await reg.run('define_feature_code', { code: 'LAMP', object: { type: 'component', component: 'Lamp' } });
  await reg.run('add_point', { at: [5, 0, 5], code: 'LAMP', name: 'L1' });
  const lamp = ctx.doc.entities.find((e) => e.name === 'LAMP L1');
  assert.ok(lamp?.component === 'Lamp' && lamp.fromCodes);
  assert.deepEqual(lamp.position, ctx.doc.entities.find((e) => e.name === 'L1').position);
  // recoding the point takes it away; a missing component is a warning, not a failed edit
  await reg.run('edit_points', { points: ['L1'], code: 'GND' });
  assert.ok(!ctx.doc.entities.some((e) => e.name === 'LAMP L1'));
  await reg.run('define_feature_code', { code: 'BIN', object: { type: 'component', component: 'Bin' } });
  await reg.run('add_point', { at: [6, 0, 6], code: 'BIN', name: 'B1' });
  assert.match((await reg.run('process_codes', {})).warnings.join(), /no component "Bin"/);
});
