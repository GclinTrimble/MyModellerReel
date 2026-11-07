// Phase 5 (modelling depth): imprint, offset, mesh repair, sub-object editing, arcs and components.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import * as G from '../src/core/geometry.js';
import * as Topo from '../src/core/topology.js';
import * as Comp from '../src/core/components.js';

const vol = async (reg, id) => (await reg.run('get_entity', { id })).volume;

test('imprint + push_pull: recess, boss and a hole straight through, no boolean needed', async () => {
  const { reg } = makeCtx();
  const b = await reg.run('create_box', { width: 2, height: 1, depth: 2, name: 'Slab' });
  const r = await reg.run('imprint', { id: 'Slab', face: 'top', shape: 'rectangle', size: [0.5, 0.5] });
  await reg.run('push_pull', { id: 'Slab', face: r.face, distance: -0.3 });
  near(await vol(reg, b.id), 4 - 0.075, 1e-6);
  const c = await reg.run('imprint', { id: 'Slab', face: 'top', shape: 'circle', radius: 0.2, center: [0.6, 1, 0.6], segments: 48 });
  await reg.run('push_pull', { id: 'Slab', face: c.face, distance: 0.5 });
  const disc = Math.PI * 0.04 * 0.5;
  near(await vol(reg, b.id), 4 - 0.075 + disc, 0.01);
  const h = await reg.run('imprint', { id: 'Slab', face: 'top', points: [[-0.9, 1, -0.9], [-0.5, 1, -0.9], [-0.5, 1, -0.5], [-0.9, 1, -0.5]] });
  await reg.run('push_pull', { id: 'Slab', face: h.face, distance: -1 });
  near(await vol(reg, b.id), 4 - 0.075 + disc - 0.16, 0.01);
  const down = await reg.run('raycast', { origin: [-0.7, 5, -0.7], direction: [0, -1, 0] });
  assert.deepEqual(down, { hit: null }); // light through the hole
  await assert.rejects(reg.run('imprint', { id: 'Slab', face: 'top', shape: 'rectangle', size: [5, 5] }), /inside the face/);
});

test('offset_face: inset a frame, then sink the pane', async () => {
  const { reg } = makeCtx();
  const w = await reg.run('create_box', { width: 1, height: 1, depth: 0.1, name: 'Window' });
  const r = await reg.run('offset_face', { id: 'Window', face: 'front', distance: 0.1 });
  const face = (await reg.run('get_entity', { id: 'Window' })).faces[r.face];
  near(face.area, 0.64, 1e-6);
  await reg.run('push_pull', { id: 'Window', face: r.face, distance: -0.04 });
  near(await vol(reg, w.id), 0.1 - 0.64 * 0.04, 1e-6);
  await reg.run('create_prism', { points: [[0, 0], [2, 0], [2, 2], [0, 2]], name: 'Pad', position: [5, 0, 0] });
  await reg.run('offset_face', { id: 'Pad', face: 0, distance: -0.5 });
  near((await reg.run('get_entity', { id: 'Pad' })).faces[0].area, 9, 1e-6);
  await assert.rejects(reg.run('offset_face', { id: 'Window', face: 'top', distance: 0.2 }), /wider than the face/);
});

test('repair_mesh: welds an imported triangle soup back into clean faces, flips, closes holes', () => {
  const box = G.box(1, 2, 3);
  const soup = G.fromTriangles(G.toBuffers(box).position);
  assert.equal(soup.f.length, 12);
  const r = Topo.repairMesh(soup);
  assert.equal(r.mesh.f.length, 6);
  assert.equal(r.report.merged, 6);
  near(G.volume(r.mesh), 6);
  const broken = G.clone(box);
  broken.f.splice(0, 1); // a hole
  broken.f[2] = [...broken.f[2]].reverse(); // a flipped face
  const fixed = Topo.repairMesh(broken);
  assert.equal(fixed.report.holes, 1);
  assert.ok(fixed.report.flipped >= 1);
  near(G.volume(fixed.mesh), 6);
});

test('repair_mesh command: an imported face pushes as one face afterwards', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Imported' });
  const e = ctx.doc.entities[0];
  delete e.derived;
  e.mesh = G.fromTriangles(G.toBuffers(e.mesh).position);
  const [rep] = await reg.run('repair_mesh', { ids: ['Imported'] });
  assert.deepEqual([rep.faces_before, rep.faces], [12, 6]);
  await reg.run('push_pull', { id: 'Imported', face: 'top', distance: 1 });
  near(await vol(reg, 'Imported'), 2);
});

test('move_elements: the top front edge up makes a roof slope; corners and faces by words', async () => {
  const { reg } = makeCtx();
  await reg.run('create_box', { width: 4, height: 2, depth: 4, name: 'Shed' });
  const r = await reg.run('move_elements', { id: 'Shed', edge: 'top back', by: [0, 1, 0] });
  assert.equal(r.moved, 2);
  near(await vol(reg, 'Shed'), 32 + (1 * 4 * 4) / 2, 1e-6);
  nearArr((await reg.run('get_entity', { id: 'Shed' })).max, [2, 3, 2]);
  await reg.run('move_elements', { id: 'Shed', vertex: 'bottom front right', by: [0.5, 0, 0] });
  await reg.run('move_elements', { id: 'Shed', face: 'left', by: [-1, 0, 0] });
  nearArr((await reg.run('get_entity', { id: 'Shed' })).min, [-3, 0, -2]);
  const els = await reg.run('list_elements', { id: 'Shed' });
  assert.equal(els.vertices.length, 8);
  await assert.rejects(reg.run('move_elements', { id: 'Shed', edge: 'top bottom', by: [0, 1, 0] }), /do not meet/);
});

test('arcs: three points, centre and pie, two-point bulge, tangent continuation', async () => {
  const { ctx, reg } = makeCtx();
  const a = await reg.run('create_arc', { kind: 'three_point', start: [-1, 0, 0], through: [0, 0, -1], end: [1, 0, 0] });
  near(a.radius, 1);
  near(a.angle, 180);
  near(a.length, Math.PI, 0.01);
  const pie = await reg.run('create_arc', { kind: 'center', center: [5, 0, 0], radius: 2, start_angle: 0, end_angle: 90, pie: true, segments: 64 });
  near((await reg.run('get_entity', { id: pie.id })).faces[0].area, Math.PI, 0.01);
  const bulge = await reg.run('create_arc', { kind: 'two_point', start: [0, 0, 5], end: [4, 0, 5], sagitta: 1 });
  near(bulge.radius, (4 + 1) / 2, 1e-6); // r = (c²/4 + s²) / 2s with chord 4, sagitta 1
  await reg.run('create_curve', { points: [[0, 0, 10], [3, 0, 10]], name: 'Straight' });
  const t = await reg.run('create_arc', { kind: 'tangent', from: 'Straight', end: [5, 0, 8] });
  const pts = (await reg.run('get_entity', { id: t.id })).curve.points;
  const d0 = G.norm(G.sub(pts[1], pts[0]));
  assert.ok(d0[0] > 0.99, `leaves along +x: ${d0}`);
  nearArr(pts.at(-1), [5, 0, 8], 1e-3);
  await assert.rejects(reg.run('create_arc', { kind: 'three_point', start: [0, 0, 0], through: [1, 0, 0], end: [2, 0, 0] }), /in a line/);
  assert.ok(ctx.doc.entities.length >= 5);
});

test('components: edit one instance and every copy follows; unique, replace, light saves', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1.2, depth: 0.1, name: 'Frame', color: '#e9e4d8' });
  await reg.run('create_box', { width: 0.8, height: 1, depth: 0.05, position: [0, 0.1, 0], name: 'Glass', color: '#b8dbe2' });
  const w1 = await reg.run('make_component', { ids: ['Frame', 'Glass'], name: 'Window' });
  assert.equal(w1.component, 'Window');
  const w2 = (await reg.run('duplicate', { ids: [w1.id], offset: [2, 0, 0] })).created[0];
  const w3 = await reg.run('place_component', { name: 'Window', position: [5, 0, 0], rotation: [0, 90, 0] });
  const part = (inst, key) => ctx.doc.entities.find((e) => e.parent === inst && e.compKey === key);
  const glassKey = ctx.doc.entities.find((e) => e.name === 'Glass').compKey;
  await reg.run('set_material', { ids: [part(w2, glassKey).id], color: '#3f879c' });
  for (const g of [w1.id, w2, w3.id]) assert.equal(part(g, glassKey).material.color, '#3f879c');
  const frameKey = ctx.doc.entities.find((e) => e.name === 'Frame').compKey;
  await reg.run('push_pull', { id: part(w3.id, frameKey).id, face: 'top', distance: 0.3 });
  for (const g of [w1.id, w2]) near((await reg.run('get_entity', { id: part(g, frameKey).id })).size[1], 1.5);
  assert.equal(part(w1.id, frameKey).mesh, part(w2, frameKey).mesh); // one mesh object, shared
  await reg.run('create_box', { width: 0.1, height: 0.1, depth: 0.1, parent: w2, name: 'Handle' });
  assert.equal(ctx.doc.entities.filter((e) => e.name === 'Handle').length, 3);
  const eds = await reg.run('edit_component', { id: w3.id });
  assert.equal(eds.instances, 3);
  assert.equal(eds.parts.length, 3);
  // light saves: parts' meshes are stored once, and come back
  const json = JSON.stringify(ctx.doc, Comp.stripForSave);
  const back = JSON.parse(json);
  assert.equal(back.entities.filter((e) => e.compKey && e.mesh).length, 0); // meshes only in the definition
  assert.ok(back.components.Window.parts.every((p) => p.mesh));
  Comp.hydrate(back);
  assert.ok(back.entities.filter((e) => e.compKey).every((e) => e.mesh));
  // unique and replace
  await reg.run('make_unique', { ids: [w3.id], name: 'Wide window' });
  await reg.run('set_material', { ids: [part(w3.id, glassKey).id], color: '#000000' });
  assert.equal(part(w1.id, glassKey).material.color, '#3f879c');
  await reg.run('replace_component', { ids: [w1.id], with: 'Wide window' });
  assert.equal(part(w1.id, glassKey).material.color, '#000000');
  assert.deepEqual((await reg.run('list_components')).map((c) => [c.name, c.instances.length]), [['Window', 1], ['Wide window', 2]]);
  ctx.store.undo();
  assert.equal(part(w1.id, glassKey).material.color, '#3f879c'); // undo restores the link and the look
  await reg.run('ungroup', { id: w2 });
  assert.ok(ctx.doc.entities.filter((e) => !e.parent && e.compKey).length === 0); // unlinked parts are plain again
});

test('an imprinted outline shows as edges; seams between triangles do not', () => {
  const box = G.box(2, 1, 2);
  const top = box.f.findIndex((_, i) => G.faceNormal(box, i)[1] > 0.9);
  const r = Topo.imprint(box, top, [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]]);
  assert.equal(G.imprintEdges(r.mesh).length, 4);
  assert.equal(G.imprintEdges(G.fromTriangles(G.toBuffers(box).position)).length, 0);
});
