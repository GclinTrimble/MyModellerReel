// Feature code symbols and typed attributes: values checked against their definitions, 2D / 3D symbols placed as linked
// component instances, driven by attributes (scale, rotation, colour), and shown or hidden with set_style symbols.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as S from '../src/core/survey.js';
import * as D from '../src/core/document.js';

test('checkAttr: numbers (decimals, min, max, whole), lists, yes / no, colours, dates, links', () => {
  const dia = { name: 'DIA', type: 'number', decimals: 2, min: 0.3, max: 3 };
  assert.deepEqual(S.checkAttr(dia, '1,234'), { value: 1.23 }, 'a decimal comma, rounded to its decimals');
  assert.match(S.checkAttr(dia, 5).error, /at most 3/);
  assert.match(S.checkAttr(dia, 'abc').error, /a number/);
  assert.match(S.checkAttr({ name: 'N', type: 'number', kind: 'integer' }, 2.5).error, /whole/);
  assert.deepEqual(S.checkAttr({ name: 'C', type: 'list', options: ['Cast iron', 'Concrete'] }, 'concrete'), { value: 'Concrete' });
  assert.match(S.checkAttr({ name: 'C', type: 'list', options: ['A'] }, 'B').error, /one of A/);
  assert.deepEqual(S.checkAttr({ name: 'OK', type: 'boolean' }, 'yes'), { value: true });
  assert.match(S.checkAttr({ name: 'COL', type: 'color' }, 'red').error, /colour/);
  assert.match(S.checkAttr({ name: 'D', type: 'text', kind: 'date' }, '13/11/2026').error, /YYYY-MM-DD/);
  assert.match(S.checkAttr({ name: 'UP', type: 'link', link: 'MH' }, 'X9', ['1', '2']).error, /no MH point named X9/);
  assert.match(S.checkAttr({ name: 'R', required: true }, '').error, /needed/);
  assert.deepEqual(S.checkAttr({ name: 'R' }, ''), { value: undefined });
});

test('symbolTransform: scale, rotation clockwise from north and tint from attributes', () => {
  const t = S.symbolTransform({ scale: 2, scale_attr: 'K', rotation_attr: 'ROT', color_attr: 'COL' }, { K: 1.5, ROT: 90, COL: '#112233' });
  assert.deepEqual(t, { scale: [3, 3, 3], rotation: [0, -90, 0], tint: '#112233', component: undefined, plan: undefined });
  assert.deepEqual(S.symbolTransform({}, {}), { scale: [1, 1, 1], rotation: [0, 0, 0], tint: null, component: undefined, plan: undefined });
});

test('points take checked attributes; codes place 2D and 3D symbols as linked instances', async () => {
  const { ctx, reg } = makeCtx();
  const doc = () => ctx.doc;
  // the symbols: a lamp post (3D) and its plan symbol (a flat square of linework standing in for a CAD block)
  await reg.run('create_cylinder', { radius: 0.1, height: 6, name: 'Lamp' });
  await reg.run('make_component', { ids: ['Lamp'], name: 'Lamp post' });
  await reg.run('create_box', { width: 0.6, height: 0.01, depth: 0.6, name: 'Plan', position: [20, 0, 0] });
  await reg.run('make_component', { ids: ['Plan'], name: 'Lamp plan' });
  await reg.run('define_feature_code', {
    code: 'LP',
    layer: 'Lighting',
    object: { type: 'component', component: 'Lamp post', plan: 'Lamp plan', scale_attr: 'SCALE', rotation_attr: 'ROT', color_attr: 'COLOUR' },
    attrs: [
      { name: 'SCALE', type: 'number', decimals: 1, min: 0.5, max: 3, default: 1 },
      { name: 'ROT', type: 'number', min: 0, max: 360 },
      { name: 'COLOUR', type: 'color' },
      { name: 'LIT', type: 'boolean', default: true },
    ],
  });
  await assert.rejects(reg.run('add_point', { n: 100, e: 200, z: 10, code: 'LP', attrs: { SCALE: 9 } }), /SCALE is at most 3/);
  const p = await reg.run('add_point', { n: 100, e: 200, z: 10, code: 'LP', attrs: { ROT: '45', COLOUR: '#AA0000' } });
  assert.deepEqual(p.attrs, { ROT: 45, COLOUR: '#aa0000', SCALE: 1, LIT: true }, 'cleaned, defaults filled');
  await reg.run('add_point', { n: 110, e: 200, z: 10, code: 'LP', attrs: { SCALE: 2 } });
  const syms = (kind) => doc().entities.filter((e) => e.fromCodes && e.symbol === kind);
  assert.equal(syms('3d').length, 2);
  assert.equal(syms('2d').length, 2);
  const lamp = syms('3d').find((e) => e.name === `LP ${p.name}`);
  assert.equal(lamp.component, 'Lamp post', 'a linked instance, not a copy');
  assert.deepEqual(lamp.rotation, [0, -45, 0]);
  assert.equal(lamp.tint, '#aa0000');
  assert.deepEqual(syms('3d').find((e) => e !== lamp).scale, [2, 2, 2]);

  // only the plan symbols, then only the points
  await reg.run('set_style', { symbols: '2d' });
  assert.deepEqual([syms('2d').length, syms('3d').length], [2, 0]);
  await reg.run('set_style', { symbols: 'points' });
  assert.equal(doc().entities.filter((e) => e.fromCodes && e.symbol).length, 0);
  await reg.run('set_style', { symbols: 'both' });

  // editing the parent component updates every symbol
  const def = doc().components['Lamp post'];
  const part = D.descendants(doc(), syms('3d')[0].id)[0];
  await reg.run('set_material', { ids: [part.id], color: '#336699' });
  assert.equal(def.parts[0].material.color, '#336699');
  for (const s of syms('3d')) assert.equal(D.descendants(doc(), s.id)[0].material.color, '#336699');

  // a value out of range on edit is refused; a code change re-checks
  await assert.rejects(reg.run('edit_points', { points: [p.name], attrs: { ROT: 400 } }), /ROT is at most 360/);
  await reg.run('edit_points', { points: [p.name], attrs: { LIT: 'no' } });
  assert.equal(S.points(doc()).find((x) => x.name === p.name).point.attrs.LIT, false);
});

test('editCode: an emptied symbol is taken off', () => {
  assert.equal(S.editCode({ object: { type: 'tree' } }, { object: {} }).object, undefined);
});

test('set_component_origin: the insertion point moves, placed instances stay, symbols sit on their points', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_cylinder', { radius: 0.1, height: 6, name: 'Pole' });
  await reg.run('create_box', { width: 1.2, height: 0.2, depth: 0.2, name: 'Arm', position: [0.6, 6, 0] });
  const inst = await reg.run('make_component', { ids: ['Pole', 'Arm'], name: 'Lamp post' });
  const box = () => D.worldBox(ctx.doc, D.getEntity(ctx.doc, inst.id));
  const was = box();
  // made from the box of pole + arm, the origin is not at the pole
  assert.ok(Math.abs(D.getEntity(ctx.doc, inst.id).position[0]) > 0.1);
  const r = await reg.run('set_component_origin', { name: 'Lamp post', at: [0, 0, 0] });
  assert.ok(Math.abs(r.moved_by[0]) > 0.1);
  assert.deepEqual(box().min.map((x) => +x.toFixed(6)), was.min.map((x) => +x.toFixed(6)), 'the placed one did not move');
  assert.deepEqual(D.getEntity(ctx.doc, inst.id).position, [0, 0, 0]);
  await reg.run('define_feature_code', { code: 'LP', object: { type: 'component', component: 'Lamp post' } });
  const p = await reg.run('add_point', { n: 100, e: 200, z: 10, code: 'LP' });
  const sym = ctx.doc.entities.find((e) => e.symbol === '3d');
  const pole = D.descendants(ctx.doc, sym.id).find((c) => c.name === 'Pole');
  const pb = D.worldBox(ctx.doc, pole);
  const pt = S.points(ctx.doc).find((x) => x.id === p.id).position;
  assert.ok(Math.abs((pb.min[0] + pb.max[0]) / 2 - pt[0]) < 1e-6 && Math.abs((pb.min[2] + pb.max[2]) / 2 - pt[2]) < 1e-6, 'the pole stands on the point');
  await assert.rejects(reg.run('set_component_origin', { name: 'Pole' }), /not a component/);
});

test('variants: an attribute value picks the symbol; a value without one places nothing', async () => {
  const { ctx, reg } = makeCtx();
  for (const n of ['Single', 'Double']) {
    await reg.run('create_box', { width: 0.2, height: 6, depth: 0.2, name: n });
    await reg.run('make_component', { ids: [n], name: n });
  }
  await reg.run('define_feature_code', { code: 'LP', object: { component: 'Single', type: 'component', variant_attr: 'TYPE', variants: { double: { component: 'Double' } } }, attrs: [{ name: 'TYPE', type: 'list', options: ['Single', 'Double'] }] });
  await reg.run('define_feature_code', { code: 'SIGN', object: { variant_attr: 'KIND', variants: { STOP: { component: 'Single' } } } });
  await reg.run('add_points', { points: [{ n: 0, e: 0, code: 'LP', attrs: { TYPE: 'Double' } }, { n: 0, e: 5, code: 'LP' }, { n: 0, e: 9, code: 'SIGN', attrs: { KIND: 'stop' } }, { n: 0, e: 12, code: 'SIGN', attrs: { KIND: 'GIVE WAY' } }] });
  const syms = ctx.doc.entities.filter((e) => e.fromCodes).map((e) => [e.name.split(' ')[0], e.component || e.mesh && 'mesh']);
  assert.deepEqual(syms.sort(), [['LP', 'Double'], ['LP', 'Single'], ['SIGN', 'Single']]);
});

test('import: points remember their file, attributes are typed by their code, thousands go fast', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_cylinder', { radius: 0.1, height: 6, name: 'Lamp' });
  await reg.run('make_component', { ids: ['Lamp'], name: 'Lamp post' });
  await reg.run('define_feature_code', { code: 'LP', object: { type: 'component', component: 'Lamp post', rotation_attr: 'ROT' }, attrs: [{ name: 'ROT', type: 'number' }, { name: 'LIT', type: 'boolean', default: true }, { name: 'LAMP', type: 'list', options: ['LED', 'Sodium'] }] });
  await reg.run('define_feature_code', { code: 'KERB', line: true });
  const rows = ['P,N,E,Z,CODE,ROT,LAMP'];
  for (let i = 0; i < 10000; i++) rows.push(`${i + 1},${5400000 + (i % 100) * 3},${650000 + Math.floor(i / 100) * 3},10,${i % 2 ? 'KERB' : 'LP'},${i % 360},led`);
  const t = performance.now();
  const r = await reg.run('import_points', { text: rows.join('\n'), header: true, source: 'north-block.csv' });
  const ms = performance.now() - t;
  assert.equal(r.objects, 5000);
  assert.ok(ms < 3000, `10 000 coded points in ${Math.round(ms)} ms (was 8 s when every symbol scanned the model)`);
  const p = S.points(ctx.doc)[0];
  assert.deepEqual([p.point.source, p.point.attrs.LAMP, p.point.attrs.LIT], ['north-block.csv', 'LED', true], 'its file, the list item as written, the default');
  await reg.run('add_point', { n: 1, e: 1, z: 0 });
  assert.equal((await reg.run('query_points', { source: 'north-block' })).count, 10000);
  assert.equal((await reg.run('query_points', { source: 'entered here' })).count, 1);
});
