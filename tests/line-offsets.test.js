// Offset lines on linework: H and V offsets that follow the line's points and go into the surface as breaklines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as S from '../src/core/survey.js';
import * as D from '../src/core/document.js';

test('a kerb line: offsets follow the points and shape the surface', async () => {
  const { reg, ctx } = makeCtx();
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push(`${i}_${j},${j * 5},${i * 5},0,GND`);
  await reg.run('import_points', { text: pts.join('\n') });
  await reg.run('set_base_point', { e: 0, n: 0, z: 0 });
  // the kerb runs east along N 10: right of it is south (model +z), left is north
  await reg.run('add_breakline', { points: ['1_2', '3_2'], name: 'Kerb' });
  const r = await reg.run('set_line_offsets', { id: 'Kerb', offsets: [{ h: 2, v: 1, name: 'Back' }, { h: -2, v: -1 }, { h: 3, v: 5, surface: false }] });
  assert.equal(r.offsets.length, 3);
  assert.deepEqual(r.offsets[0].start, [5, 1, -8]);
  assert.deepEqual(r.offsets[1].end, [15, -1, -12]);

  const s = await reg.run('create_surface', { name: 'EG' });
  const has = (p) => D.worldMesh(ctx.doc, ctx.doc.entities.find((x) => x.id === s.id)).v.some((v) => v.every((x, k) => Math.abs(x - p[k]) < 1e-6));
  assert.ok(has([5, 1, -8]) && has([15, 1, -8]), 'the right offset is a breakline of the surface');
  assert.ok(has([5, -1, -12]), 'the left one too');
  assert.ok(!has([5, 5, -7]), 'surface: false stays out');

  // move a point of the line: the offsets and the surface rebuild
  await reg.run('edit_points', { points: ['3_2'], raise: 2 });
  const kerb = D.getEntity(ctx.doc, 'Kerb') || ctx.doc.entities.find((x) => x.name === 'Kerb');
  near(S.lineworkOffsets(ctx.doc, kerb)[0].path.at(-1)[1], 3);
  assert.ok(has([15, 3, -8]), 'the surface follows the moved offset');

  // reversing the line keeps the offsets on their side; an empty list removes them
  await reg.run('edit_linework', { id: 'Kerb', action: 'reverse' });
  assert.deepEqual(D.round3(S.lineworkOffsets(ctx.doc, kerb)[0].path[0]), [15, 3, -8]);
  await reg.run('set_line_offsets', { id: 'Kerb', offsets: [] });
  assert.equal(kerb.line.offsets, undefined);
  assert.ok(!has([5, 1, -8]));
  await assert.rejects(reg.run('set_line_offsets', { id: 'Kerb', offsets: [{ h: 'x' }] }));
});
