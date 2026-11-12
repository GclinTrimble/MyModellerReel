// Pick first (#234, #235): which arguments are picked in the view, and what can be typed while picking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as F from '../src/core/fields.js';

test('pick steps: the point arguments a command needs, from its schema', () => {
  const { reg } = makeCtx();
  const p = (n) => reg.commands.get(n).params;
  assert.deepEqual(F.pickSteps(p('design_trench')), [{ key: 'from', count: 1, many: false, names: false }, { key: 'to', count: 1, many: false, names: false }]);
  assert.deepEqual(F.pickSteps(p('design_trench'), { from: 'MH1' }).map((s) => s.key), ['to'], 'given: not picked');
  assert.deepEqual(F.pickSteps(p('design_plane')), [{ key: 'points', count: 3, many: true, names: false }], 'the first mode');
  assert.equal(F.pickSteps(p('design_road'))[0].count, Infinity, 'until Enter');
  assert.deepEqual(F.pickSteps(p('create_box')), [], 'no needed points: the form, or run at once');
});

test('typed while picking: x, y, z, @dx, dy, dz, or a distance along the rubber band', () => {
  assert.deepEqual(F.readTyped('1, 2, 3'), { value: [1, 2, 3] });
  assert.deepEqual(F.readTyped('[1 2 −3]'), { value: [1, 2, -3] });
  assert.deepEqual(F.readTyped('  '), { value: undefined });
  assert.deepEqual(F.readTyped('@1, 0, -2', { from: [10, 5, 5] }), { value: [11, 5, 3] });
  assert.deepEqual(F.readTyped('＠0,1,0', { from: [1, 1, 1] }), { value: [1, 2, 1] });
  assert.match(F.readTyped('@1,0,0').error, /relative/i);
  assert.deepEqual(F.readTyped('5', { from: [0, 0, 0], toward: [3, 0, 4] }), { value: [3, 0, 4] });
  assert.deepEqual(F.readTyped('500mm', { from: [1, 0, 0], toward: [9, 0, 0] }), { value: [1.5, 0, 0] });
  assert.match(F.readTyped('5').error, /first point/);
  assert.match(F.readTyped('5', { from: [0, 0, 0], toward: [0, 0, 0] }).error, /direction/);
  assert.match(F.readTyped('a, b, c').error, /numbers/);
  assert.match(F.readTyped('1, 2').error, /x, y, z/);
  assert.match(F.readTyped('@5', { from: [0, 0, 0] }).error, /@dx/);
});
