// Phase 16: multiple views — pane rectangles, splitters and the layout commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';
import * as LY from '../src/core/layout.js';

const area = (rs) => rs.filter(Boolean).reduce((s, r) => s + r.w * r.h, 0);

test('panes tile the view area for every arrangement and count', () => {
  for (const arrangement of LY.ARRANGEMENTS)
    for (let count = 1; count <= 4; count++) {
      const rs = LY.paneRects({ count, arrangement, split: [0.3, 0.7] });
      assert.equal(rs.length, count, `${arrangement} ${count}`);
      assert.ok(Math.abs(area(rs) - 1) < 1e-9, `${arrangement} ${count} covers the area`);
      for (const r of rs) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9);
    }
});

test('defaults: four panes are a grid of 3D, top, front and right; a maximised pane fills the area', () => {
  const l = LY.normalize({ count: 4 });
  assert.equal(l.arrangement, 'grid');
  assert.deepEqual(l.panes.map((p) => p.view), ['perspective', 'top', 'front', 'right']);
  assert.equal(l.panes[1].projection, 'parallel');
  const rs = LY.paneRects({ count: 4, max: 2 });
  assert.deepEqual(rs[2], { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(rs.filter(Boolean).length, 1);
  assert.equal(LY.normalize({ count: 9 }).count, 4);
  assert.equal(LY.normalize({ count: 2, arrangement: 'grid' }).arrangement, 'columns');
});

test('dragging a bar moves the split, clamped, and a right-hand main pane grows to the left', () => {
  const l = { count: 2, arrangement: 'columns' };
  const [bar] = LY.splitters(l);
  assert.equal(bar.axis, 'x');
  assert.deepEqual(LY.dragSplit(l, bar, 0.7), [0.7, 0.5]);
  assert.equal(LY.dragSplit(l, bar, 0.99)[0], 0.85);
  const r = { count: 3, arrangement: 'main_right' };
  const [b] = LY.splitters(r);
  const split = LY.dragSplit(r, b, 0.3);
  assert.ok(Math.abs(split[0] - 0.7) < 1e-9);
  assert.ok(Math.abs(LY.paneRects({ ...r, split })[0].w - 0.7) < 1e-9);
  assert.deepEqual(LY.splitters({ count: 4, arrangement: 'grid' }).map((s) => s.axis), ['x', 'y']);
});

test('set_layout and set_pane keep the layout in the document; pane numbers are checked', async () => {
  const { reg, ctx } = makeCtx();
  const r = await reg.run('set_layout', { count: 4 });
  assert.equal(r.count, 4);
  assert.equal(ctx.doc.settings.layout.arrangement, 'grid');
  await reg.run('set_pane', { pane: 3, view: 'left' });
  assert.equal(ctx.doc.settings.layout.panes[2].view, 'left');
  assert.equal(ctx.doc.settings.layout.panes[2].projection, 'parallel');
  await reg.run('set_pane', { pane: 1, view: 'top' });
  assert.equal(ctx.doc.settings.projection, 'parallel');
  await reg.run('set_layout', { max: 2 });
  assert.equal(ctx.doc.settings.layout.max, 1);
  await reg.run('set_layout', { max: 0 });
  assert.equal(ctx.doc.settings.layout.max, null);
  await assert.rejects(reg.run('set_pane', { pane: 5, view: 'top' }), /pane is 1 to 4/);
  await reg.run('set_layout', { count: 2 });
  assert.equal(ctx.doc.settings.layout.arrangement, 'columns');
  await reg.run('undo');
  assert.equal(ctx.doc.settings.layout?.count ?? 1, 4);
});
