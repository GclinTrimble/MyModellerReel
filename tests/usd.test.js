// OpenUSD (#245) and live references (#246).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { USDLoader } from '../node_modules/three/examples/jsm/loaders/USDLoader.js';
import { makeCtx, nearArr } from './helpers.js';
import * as D from '../src/core/document.js';
import * as G from '../src/core/geometry.js';
import * as U from '../src/core/usd.js';
import { formatFor } from '../src/core/formats.js';

function scene() {
  const doc = D.newDoc();
  const g = D.addEntity(doc, { type: 'group', name: 'Block A', position: [1, 0, 0], rotation: [0, 90, 0] });
  const b = D.addEntity(doc, { name: 'Box 1', parent: g.id, mesh: G.box(1, 2, 3), position: [0, 1, 0], material: { color: '#ff0000', roughness: 0.4 } });
  const c = D.addEntity(doc, { name: 'Hidden', mesh: G.box(1, 1, 1), visible: false });
  return { doc, g, b, c };
}

test('usda: stage metadata, stable prim names, transforms, meshes and materials', () => {
  const { doc, b } = scene();
  const t = U.writeUsda(doc);
  assert.match(t, /^#usda 1\.0/);
  assert.match(t, /metersPerUnit = 1/);
  assert.match(t, /upAxis = "Y"/);
  assert.match(t, /def Xform "Block_A_e1"/);
  assert.match(t, /def Mesh "Box_1_e2"/);
  assert.match(t, /token visibility = "invisible"/);
  assert.match(t, /info:id = "UsdPreviewSurface"/);
  assert.match(t, /inputs:roughness = 0\.4/);
  assert.equal(U.primKey('Box_1_e2', '/Root/x'), 'e2');
  assert.equal(U.primLabel('Box_1_e2'), 'Box 1');
  // renaming keeps the key
  b.name = 'Other';
  assert.match(U.writeUsda(doc), /def Mesh "Other_e2"/);
  assert.equal(formatFor('a.usdz').id, 'usda');
});

test('usda reads back in three.js: world placement, polygons, colour', () => {
  const { doc, b } = scene();
  const root = new USDLoader().parse(U.writeUsda(doc));
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  const m = meshes.find((o) => o.name === 'Box_1_e2');
  assert.ok(m, 'the box comes back');
  // a corner of the box lands where the document puts it
  const want = new Vector3(...b.mesh.v[0]).applyMatrix4(D.worldMatrix(doc, b));
  const got = new Vector3().fromBufferAttribute(m.geometry.attributes.position, 0).applyMatrix4(m.matrixWorld);
  const all = [];
  for (let i = 0; i < m.geometry.attributes.position.count; i++) all.push(new Vector3().fromBufferAttribute(m.geometry.attributes.position, i).applyMatrix4(m.matrixWorld));
  assert.ok(all.some((p) => p.distanceTo(want) < 1e-4), `${want.toArray()} among the read corners (first ${got.toArray()})`);
  assert.equal(m.material.color.getHexString(), 'ff0000');
  assert.equal(m.geometry.attributes.position.count / 3, 12, 'six quads → twelve triangles');
});

test('live reference: parts keep their ids across reads, overrides stay on top, shape is read-only, bind', async () => {
  const { ctx, reg } = makeCtx();
  const doc = ctx.doc;
  const part = (key, x, color = '#808080') => ({ key, name: `P ${key}`, mesh: G.box(1, 1, 1), position: [x, 0, 0], material: { color, opacity: 1, metalness: 0, roughness: 0.85 } });
  const g = D.addEntity(doc, { type: 'group', name: 'Ref', xref: { path: 'C:/a.usda', overrides: {} } });
  U.applyReference(doc, g, [part('e1', 0), part('e2', 5)]);
  const [p1, p2] = D.childrenOf(doc, g.id);
  // this window moves one part and hides the other: overrides, not edits of the file
  await reg.run('set_properties', { ids: [p2.id], visible: false });
  await reg.run('move', { ids: [p1.id], by: [0, 2, 0] });
  const G2 = D.getEntity(ctx.doc, g.id);
  assert.deepEqual(G2.xref.overrides.e2, { visible: false });
  assert.deepEqual(G2.xref.overrides.e1.position, [0, 2, 0]);
  // the source changes: e1 moves along x and turns red, e2 is gone, e3 is new
  U.applyReference(ctx.doc, G2, [part('e1', 3, '#ff0000'), part('e3', 9)]);
  const kids = D.childrenOf(ctx.doc, g.id);
  assert.deepEqual(kids.map((k) => k.xprim), ['e1', 'e3']);
  assert.equal(kids[0].id, p1.id, 'same entity');
  assert.deepEqual(kids[0].position, [0, 2, 0], 'the override wins');
  assert.equal(kids[0].material.color, '#ff0000', 'what is not overridden follows the file');
  // a hand edit of a referenced shape is refused (and rolled back)
  const before = JSON.stringify(kids[0].mesh);
  await assert.rejects(reg.run('move_elements', { id: kids[0].id, face: 'top', by: [0, 1, 0] }), /bind the reference/);
  assert.equal(JSON.stringify(D.getEntity(ctx.doc, kids[0].id).mesh), before);
  await reg.run('bind_reference', { ids: [g.id] });
  assert.equal(D.getEntity(ctx.doc, g.id).xref, undefined);
  assert.ok(D.childrenOf(ctx.doc, g.id).every((k) => !k.xprim));
  await reg.run('move_elements', { id: kids[0].id, face: 'top', by: [0, 1, 0] }); // local now
  assert.deepEqual(U.referencePaths(ctx.doc), []);
});
