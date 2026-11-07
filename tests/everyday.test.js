// Phase 9: display units, copy / paste between models, model info and purge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import { formatLength, formatArea } from '../src/core/units.js';
import * as D from '../src/core/document.js';
import * as S from '../src/core/survey.js';

test('display units and precision', () => {
  assert.equal(formatLength(3.2), '3.200 m');
  assert.equal(formatLength(0.25), '250 mm');
  assert.equal(formatLength(3.2, { unit: 'mm' }), '3200 mm');
  assert.equal(formatLength(3.2, { unit: 'cm', precision: 0 }), '320 cm');
  assert.equal(formatLength(3.2, { unit: 'm', precision: 1 }), '3.2 m');
  assert.equal(formatLength(0.3048 * 10.5, { unit: 'ft' }), "10.500'");
  assert.equal(formatLength(0.0254 * (126 + 1 / 8), { unit: 'ft-in' }), '10\' 6 1/8"');
  assert.equal(formatLength(0.0254 * 24, { unit: 'ft-in' }), '2\' 0"');
  assert.equal(formatLength(0.0254 * 3.5, { unit: 'ft-in', precision: 2 }), '0\' 3 1/2"');
  assert.equal(formatLength(-0.0004, { unit: 'm' }), '0.000 m', 'no minus zero');
  assert.equal(formatArea(10, { unit: 'ft' }), '107.6 ft²');
});

test('set_units keeps commands in metres and stores how lengths are shown', async () => {
  const { ctx, reg } = makeCtx();
  const r = await reg.run('set_units', { display: 'ft-in', precision: 16 });
  assert.deepEqual([r.display, r.precision], ['ft-in', 16]);
  assert.equal(ctx.doc.settings.display_units, 'ft-in');
  const b = await reg.run('create_box', { width: 1, height: 1, depth: 1 });
  near(b.size[0], 1);
});

test('copy and paste: in place, by an offset, into another model at the same real-world spot, with components', async () => {
  const a = makeCtx();
  await a.reg.run('set_base_point', { n: 5400000, e: 650000, z: 100 });
  await a.reg.run('create_layer', { name: 'Furniture', color: '#5e3f2b', current: true });
  await a.reg.run('create_box', { width: 1, height: 1, depth: 1, position: [10, 0, 0], name: 'Crate' });
  await a.reg.run('create_box', { width: 0.2, height: 2, depth: 0.2, position: [12, 0, 0], name: 'Post' });
  const comp = await a.reg.run('make_component', { ids: ['Post'], name: 'Post' });
  await a.reg.run('group', { ids: ['Crate'], name: 'Box group' });
  await a.reg.run('copy', { ids: ['Box group', comp.id] });
  const p = await a.reg.run('paste', { offset: [0, 0, 5] });
  assert.equal(p.pasted, 2);
  const copy = D.getEntity(a.ctx.doc, p.ids[0]);
  assert.equal(copy.name, 'Box group 2');
  nearArr(D.worldBox(a.ctx.doc, copy).min, [9.5, 0, 4.5]);
  assert.equal(D.childrenOf(a.ctx.doc, copy.id).length, 1, 'the group came with its child');
  assert.equal(a.ctx.doc.entities.filter((e) => e.component === 'Post').length, 2, 'a linked copy of the component');
  // another model with another base point: the paste lands at the same E, N, Z
  const b = makeCtx();
  await b.reg.run('set_base_point', { n: 5400000, e: 649990, z: 100 });
  b.ctx.clipboard = a.ctx.clipboard;
  const q = await b.reg.run('paste', {});
  const crate = D.getEntity(b.ctx.doc, q.ids[0]);
  const w = S.toProject(b.ctx.doc, D.worldBox(b.ctx.doc, crate).min);
  nearArr([w.e, w.n, w.z], [650009.5, 5400000.5, 100], 1e-6);
  assert.ok(b.ctx.doc.components.Post, 'the component definition travelled');
  assert.equal(b.ctx.doc.tags.find((t) => t.name === 'Furniture').color, '#5e3f2b');
  const crates = () => a.ctx.doc.entities.filter((e) => e.name === 'Crate').length;
  assert.equal(crates(), 2);
  await a.reg.run('cut', { ids: ['Crate'] });
  assert.equal(crates(), 1, 'cut removes what it copied');
  await assert.rejects(makeCtx().reg.run('paste', {}), /copy something first/);
});

test('model info and purge', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'A' });
  await reg.run('create_layer', { name: 'Empty layer' });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'P', position: [3, 0, 0] });
  const c = await reg.run('make_component', { ids: ['P'], name: 'Lonely' });
  await reg.run('delete', { ids: [c.id] });
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'G', position: [6, 0, 0] });
  const g = await reg.run('group', { ids: ['G'], name: 'Will be empty' });
  await reg.run('delete', { ids: ['G'] });
  const info = await reg.run('model_info');
  assert.equal(info.by_type.mesh, 1);
  assert.equal(info.faces, 6);
  nearArr(info.bounds.size, [1, 1, 1]);
  const r = await reg.run('purge');
  assert.deepEqual(r.removed, { layers: ['Empty layer'], components: ['Lonely'], groups: ['Will be empty'] });
  assert.ok(!D.getEntity(ctx.doc, g.id));
  assert.equal((await reg.run('purge')).total, 0);
});

test('templates: each builds a complete model; undo brings the previous model back', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Mine' });
  const list = await reg.run('list_templates');
  assert.ok(list.length >= 5);
  for (const t of list) {
    const r = await reg.run('new_from_template', { id: t.id });
    assert.equal(r.template, t.id);
    if (t.id.startsWith('empty')) continue;
    assert.ok(r.entities >= 2, `${t.id}: ${r.entities} entities`);
  }
  assert.ok(ctx.doc.animation.tracks.length > 0, 'the sequence template is animated');
  const house = makeCtx();
  await house.reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Mine' });
  await house.reg.run('new_from_template', { id: 'house' });
  const roof = house.ctx.doc.entities.find((e) => e.name === 'Roof');
  nearArr(D.worldBox(house.ctx.doc, roof).max, [5.4, 5.2, 4.4]);
  await house.reg.run('undo');
  assert.deepEqual(house.ctx.doc.entities.map((e) => e.name), ['Mine']);
});
