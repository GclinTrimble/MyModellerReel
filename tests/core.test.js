import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/core/geometry.js';
import { Store, newDoc } from '../src/core/document.js';
import * as A from '../src/core/animation.js';
import { createRegistry } from '../src/core/commands.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function makeCtx() {
  const store = new Store(newDoc());
  let sel = [];
  const ctx = {
    store,
    get doc() {
      return store.doc;
    },
    selection: { get: () => sel, set: (x) => (sel = x) },
  };
  return { ctx, reg: createRegistry(ctx) };
}

test('primitives are closed and outward facing', () => {
  near(G.volume(G.box(2, 3, 4)), 24);
  near(G.volume(G.cylinder(1, 2, 64)), Math.PI * 2, 0.02);
  near(G.volume(G.cone(1, 3, 64)), Math.PI, 0.02);
  near(G.volume(G.sphere(1, 48, 24)), (4 / 3) * Math.PI, 0.05);
  const b = G.bbox(G.sphere(1));
  near(b.min[1], 0);
  near(b.max[1], 2);
});

test('push/pull slides a prism face, extrudes otherwise', () => {
  const box = G.box(1, 1, 1);
  const top = box.f.findIndex((_, i) => G.faceNormal(box, i)[1] > 0.9);
  const taller = G.pushPull(box, top, 2);
  assert.equal(taller.f.length, box.f.length); // slid, no new faces
  near(G.volume(taller), 3);
  const face = G.flatFace(G.rectPoints(2, 2));
  const slab = G.pushPull(face, 0, 0.5);
  near(G.volume(slab), 2);
  const down = G.pushPull(face, 0, -0.5); // extrude below the ground: still outward
  near(G.volume(down), 2);
});

test('concave faces triangulate', () => {
  const L = G.prism([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 1);
  near(G.volume(L), 3);
});

test('animation samples with easing, steps booleans and lerps colours', () => {
  const doc = newDoc();
  A.setKey(doc, 'e1', 'position', 0, [0, 0, 0]);
  A.setKey(doc, 'e1', 'position', 2, [10, 0, 0], 'linear');
  A.setKey(doc, 'e1', 'visible', 1, true, 'step');
  A.setKey(doc, 'e1', 'visible', 0, false, 'step');
  A.setKey(doc, 'e1', 'color', 0, '#000000');
  A.setKey(doc, 'e1', 'color', 2, '#ffffff', 'linear');
  const at = A.evaluate(doc, 1);
  assert.deepEqual(at.e1.position, [5, 0, 0]);
  assert.equal(at.e1.visible, true);
  assert.equal(A.evaluate(doc, 0.5).e1.visible, false);
  assert.equal(at.e1.color, '#808080');
});

test('registry: model, push/pull, group, pivot, undo', async () => {
  const { ctx, reg } = makeCtx();
  const box = await reg.run('create_box', { width: 2, height: 1, depth: 1, position: [1, 0, 0], name: 'Wall' });
  assert.deepEqual(box.size, [2, 1, 1]);
  const pulled = await reg.run('push_pull', { id: 'Wall', face: 'top', distance: 2 });
  assert.deepEqual(pulled.size, [2, 3, 1]);
  await reg.run('create_cylinder', { radius: 0.5, height: 1, position: [5, 0, 0] });
  const g = await reg.run('group', { ids: ['e1', 'e2'], name: 'Kit' });
  assert.equal(g.type, 'group');
  await reg.run('move', { ids: ['Kit'], by: [0, 1, 0] });
  const scene = await reg.run('get_scene');
  near(scene.entities.find((e) => e.id === 'e1').min[1], 1);
  await reg.run('set_pivot', { id: 'Wall', pivot: 'left' });
  const wall = scene.entities.find((e) => e.id === 'e1');
  const after = (await reg.run('get_scene')).entities.find((e) => e.id === 'e1');
  assert.deepEqual(after.min, wall.min); // pivot moved, the wall did not
  await reg.run('rotate', { ids: ['Wall'], angle: 90 });
  const rotated = (await reg.run('get_entity', { id: 'Wall' }));
  near(rotated.min[0], -0.5, 1e-3); // hinged on its left edge (mid-thickness), so it swings to x ∈ [-0.5, 0.5]
  near(rotated.max[0], 0.5, 1e-3);
  ctx.store.undo();
  assert.deepEqual(ctx.doc.entities.find((e) => e.id === 'e1').rotation, [0, 0, 0]);
});

test('registry: boolean subtract cuts an opening', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { width: 4, height: 3, depth: 0.2, name: 'Wall' });
  await reg.run('create_box', { width: 1, height: 1.2, depth: 1, position: [0, 1, 0], name: 'Hole' });
  const r = await reg.run('boolean', { op: 'subtract', target: 'Wall', tools: ['Hole'] });
  const e = await reg.run('get_entity', { id: 'Wall' });
  near(e.volume, 4 * 3 * 0.2 - 1 * 1.2 * 0.2, 1e-3);
  assert.equal((await reg.run('get_scene')).entities.length, 1);
  assert.deepEqual(r.size, [4, 3, 0.2]);
});

test('registry: run_script is one undo step; animation macros', async () => {
  const { ctx, reg } = makeCtx();
  const out = await reg.run('run_script', {
    code: `const ids = [];
      for (let i = 0; i < 5; i++) ids.push((await api.create_box({ width: 1, height: 0.2, depth: 0.3, position: [0, i * 0.2, i * 0.3] })).id);
      return ids;`,
  });
  assert.equal(out.result.length, 5);
  await reg.run('build_sequence', { ids: out.result, effect: 'drop', order: 'bottom-up' });
  await reg.run('turntable', { duration: 6 });
  assert.ok(ctx.doc.animation.tracks.some((t) => t.target === 'camera'));
  assert.equal(A.evaluate(ctx.doc, 0).e5.visible, false); // top step waits its turn
  assert.equal(A.evaluate(ctx.doc, 5).e5.visible, true);
  ctx.store.undo(); // build_sequence
  ctx.store.undo(); // turntable... order: turntable was last
  ctx.store.undo(); // the script
  assert.equal(ctx.doc.entities.length, 0);
});

test('registry: unknown commands and missing params explain themselves', async () => {
  const { reg } = makeCtx();
  await assert.rejects(reg.run('nope'), /list_commands/);
  await assert.rejects(reg.run('create_box', { width: 1 }), /height/);
});
