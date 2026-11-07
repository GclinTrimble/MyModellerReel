// Phase 2 (parametric core): curves, sweeps, profiles, the live dependency graph, parametric objects, recipes and
// the macro recorder, plus all-or-nothing commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near, nearArr } from './helpers.js';
import * as G from '../src/core/geometry.js';
import * as C from '../src/core/curves.js';
import * as P from '../src/core/profiles.js';
import * as R from '../src/core/derived.js';

test('curves: splines pass through their points, beziers need 3k+1, closed polylines loop', () => {
  const pts = [[0, 0, 0], [2, 1, 0], [4, 0, 1], [6, 2, 0]];
  const s = C.samplePoints({ kind: 'spline', points: pts }, 8);
  for (const p of pts) assert.ok(s.some((q) => G.len(G.sub(p, q)) < 1e-9), `spline misses ${p}`);
  assert.throws(() => C.samplePoints({ kind: 'bezier', points: pts.slice(0, 3) }), /3k\+1/);
  const b = C.samplePoints({ kind: 'bezier', points: pts }, 10);
  nearArr(b.at(-1), pts[3]);
  const loop = C.samplePoints({ kind: 'polyline', points: [[0, 0, 0], [1, 0, 0], [1, 0, 1]], closed: true });
  assert.equal(loop.length, 4);
  near(C.polyLength(loop), 2 + Math.SQRT2);
  const mid = C.pointAt([[0, 0, 0], [10, 0, 0]], 0.25);
  nearArr(mid.point, [2.5, 0, 0]);
  nearArr(mid.tangent, [1, 0, 0]);
});

test('sweep: true sections, mitred corners, closed rings, outward faces', () => {
  const sq = P.profilePoints('rectangle', { params: { width: 0.2, height: 0.1 } });
  near(G.volume(C.sweep(sq, [[0, 0, 0], [5, 0, 0]])), 0.02 * 5);
  // an L: the centreline is 4 + 3 m; mitring keeps the section true on both legs
  near(G.volume(C.sweep(P.profilePoints('rectangle', { params: { width: 0.2, height: 0.2 }, anchor: 'center' }), [[0, 0, 0], [4, 0, 0], [4, 0, 3]])), 0.04 * 7, 1e-6);
  // a closed square ring of a centred section
  const ring = C.sweep(P.profilePoints('rectangle', { params: { width: 0.1, height: 0.1 }, anchor: 'center' }), [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2], [0, 0, 0]]);
  near(G.volume(ring), 0.01 * 8, 1e-6);
  // vertical runs keep their section too
  near(G.volume(C.sweep(sq, [[0, 0, 0], [0, 3, 0]])), 0.02 * 3);
  const pipe = C.sweep(P.profilePoints('pipe', { params: { diameter: 0.5, segments: 48 } }), C.samplePoints({ kind: 'spline', points: [[0, 0, 0], [3, 1, 2], [6, 0, 0]] }));
  assert.ok(G.volume(pipe) > 0);
});

test('profiles: every built-in builds counter-clockwise with its anchor at the origin', () => {
  for (const p of P.listProfiles(null)) {
    const pts = P.profilePoints(p.name);
    assert.ok(P.area2d(pts) > 0, p.name);
    assert.ok(new Set(pts.map((q) => q.join())).size === pts.length, `${p.name} repeats a point`);
  }
  const k = P.profilePoints('kerb', { anchor: 'bottom-left' });
  near(Math.min(...k.map((q) => q[0])), 0);
  near(Math.min(...k.map((q) => q[1])), 0);
  const m = P.profilePoints('angle', { mirror: true });
  assert.ok(Math.max(...m.map((q) => q[0])) <= 1e-12);
  assert.throws(() => P.profilePoints('pipe', { params: { radius: 1 } }), /no parameter radius.*diameter/);
  assert.throws(() => P.profilePoints('nope'), /No profile "nope".*kerb/);
  near(P.area2d(P.profilePoints('i_beam')), 2 * 0.15 * 0.0107 + (0.3 - 2 * 0.0107) * 0.0071, 1e-9);
});

test('sweep command: along a curve it stays live; a named profile with parameters', async () => {
  const { ctx, reg } = makeCtx();
  const curve = await reg.run('create_curve', { points: [[0, 0, 0], [4, 0, 0], [4, 0, 3]], name: 'Edge' });
  assert.equal(curve.type, 'curve');
  near(curve.length, 7);
  const kerb = await reg.run('sweep', { path: 'Edge', profile: 'kerb', profile_params: { height: 0.3 } });
  assert.equal(kerb.generator, 'sweep');
  near(kerb.size[1], 0.3);
  await reg.run('move', { ids: ['Edge'], by: [0, 0, 10] });
  near((await reg.run('get_entity', { id: kerb.id })).min[2], 10 - 0.15, 1e-3); // followed the path
  await reg.run('set_curve', { id: 'Edge', points: [[0, 0, 10], [8, 0, 10]] });
  near((await reg.run('get_entity', { id: kerb.id })).size[0], 8, 1e-3);
  const vol = (await reg.run('get_entity', { id: kerb.id })).volume;
  near(vol, P.area2d(P.profilePoints('kerb', { params: { height: 0.3 } })) * 8, 1e-4);
  await reg.run('set_params', { id: kerb.id, params: { profile: 'pipe', profile_params: { diameter: 0.4 } } });
  near((await reg.run('get_entity', { id: kerb.id })).size[1], 0.4, 1e-3);
  await assert.rejects(reg.run('sweep', { path: [[0, 0, 0]], profile: 'pipe' }), /too short/);
  assert.equal(ctx.doc.entities.length, 2); // the failed sweep left nothing behind
  const raw = await reg.run('sweep', { path: [[0, 0, 0], [0, 0, 2]], profile: [[0, 0], [0.2, 0], [0.1, 0.3]] });
  near((await reg.run('get_entity', { id: raw.id })).volume, 0.03 * 2, 1e-6);
});

test('dependency graph: a chain of three rebuilds in order, cycles and missing inputs are errors, undo restores it all', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_curve', { points: [[0, 0, 0], [2, 0, 0]], name: 'Path' });
  const beam = await reg.run('sweep', { path: 'Path', profile: 'rectangle', profile_params: { width: 0.2, height: 0.4 }, name: 'Beam' });
  const row = (await reg.run('duplicate', { ids: ['Beam'], live: true, count: 3, offset: [0, 0, 1] })).created[0];
  const grid = (await reg.run('duplicate', { ids: [row], live: true, count: 2, offset: [0, 1, 0] })).created[0];
  assert.deepEqual((await reg.run('get_dependencies', { id: beam.id })).dependents.map((d) => d.id), [row, grid]);
  const before = (await reg.run('get_entity', { id: grid })).volume;
  near(before, 0.08 * 2 * 3 * 2, 1e-6);
  await reg.run('set_curve', { id: 'Path', points: [[0, 0, 0], [5, 0, 0]] });
  near((await reg.run('get_entity', { id: grid })).volume, 0.08 * 5 * 6, 1e-6); // the whole chain followed
  await reg.run('set_params', { id: row, params: { count: 1 } });
  near((await reg.run('get_entity', { id: grid })).volume, 0.08 * 5 * 2, 1e-6);
  ctx.store.undo();
  ctx.store.undo();
  near((await reg.run('get_entity', { id: grid })).volume, before, 1e-6);
  // a cycle: make the beam depend on the grid
  ctx.doc.entities.find((e) => e.id === beam.id).derived.inputs = [grid];
  R.rebuildDerived(ctx.doc);
  assert.match((await reg.run('get_entity', { id: grid })).error, /cycle/);
  ctx.doc.entities.find((e) => e.id === beam.id).derived.inputs = ['e1']; // undo the hand-made cycle
  R.rebuildDerived(ctx.doc);
  assert.equal((await reg.run('get_entity', { id: grid })).error, undefined);
  await reg.run('delete', { ids: ['Path'] });
  assert.match((await reg.run('get_entity', { id: beam.id })).error, /input was deleted/);
  assert.match((await reg.run('get_entity', { id: grid })).error, /inputs has an error/);
  await reg.run('bake', { ids: [beam.id] });
  assert.equal((await reg.run('get_entity', { id: grid })).error, undefined);
});

test('parametric objects: set_params rebuilds, keeps the pivot; hand edits bake', async () => {
  const { reg } = makeCtx();
  const box = await reg.run('create_box', { width: 1, height: 2, depth: 0.1, name: 'Door', position: [3, 0, 0] });
  assert.equal(box.generator, 'box');
  await reg.run('set_pivot', { id: 'Door', pivot: 'left' });
  const hinged = await reg.run('get_entity', { id: 'Door' });
  await reg.run('set_params', { id: 'Door', params: { height: 2.1 } });
  const taller = await reg.run('get_entity', { id: 'Door' });
  nearArr(taller.min, [hinged.min[0], 0, hinged.min[2]]);
  near(taller.size[1], 2.1);
  assert.deepEqual(taller.derived.params, { width: 1, height: 2.1, depth: 0.1 });
  await assert.rejects(reg.run('set_params', { id: 'Door', params: { width: -1 } }), /width must be a positive/);
  near((await reg.run('get_entity', { id: 'Door' })).size[0], 1); // unchanged after the error
  await assert.rejects(reg.run('set_params', { id: 'Door', params: { legs: 4 } }), /no parameter legs.*width, height, depth/);
  await reg.run('push_pull', { id: 'Door', face: 'top', distance: 0.1 });
  assert.equal((await reg.run('get_entity', { id: 'Door' })).derived, undefined);
  await assert.rejects(reg.run('set_params', { id: 'Door', params: { width: 2 } }), /no parameters/);
  const cyl = await reg.run('create_cylinder', { radius: 0.5, height: 1 });
  await reg.run('set_params', { id: cyl.id, params: { radius: 1, segments: 64 } });
  near((await reg.run('get_entity', { id: cyl.id })).volume, Math.PI, 0.01);
});

test('commands are all or nothing: a failing script or command leaves the model and undo history as they were', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1 });
  const depth = ctx.store.undoStack.length;
  await assert.rejects(reg.run('run_script', { code: "await api.create_sphere({ radius: 1 }); await api.create_box({ width: 'x', height: 1, depth: 1 });" }), /width must be number/);
  assert.equal(ctx.doc.entities.length, 1);
  assert.equal(ctx.store.undoStack.length, depth);
  await assert.rejects(reg.run('boolean', { op: 'subtract', target: 'e1', tools: ['nope'] }), /No entity/);
  assert.equal(ctx.store.undoStack.length, depth);
});

test('recipes: the journal replays with new parameters; placeholders and run_script params', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('run_script', { code: 'for (let i = 0; i < 2; i++) await api.create_box({ width: 6, height: 3, depth: 4, position: [0, i * 3, 0], name: `Storey ${i + 1}` });' });
  await reg.run('select', { ids: ['Storey 1', 'Storey 2'] });
  await reg.run('set_material', { color: '#a8553c' }); // implicit selection gets recorded explicitly
  assert.deepEqual(ctx.doc.journal.map((s) => s.command), ['run_script', 'set_material']);
  assert.deepEqual(ctx.doc.journal[1].args.ids, ['e1', 'e2']);
  await reg.run('save_recipe', {
    name: 'House',
    params: { storeys: 2, height: 3 },
    steps: [
      { command: 'run_script', args: { code: 'for (let i = 0; i < params.storeys; i++) await api.create_box({ width: 6, height: params.height, depth: 4, position: [0, i * params.height, 0], name: `Storey ${i + 1}` });' } },
      { command: 'create_cone', args: { radius: 4, height: 2, position: [0, '{{storeys * height}}', 0], name: 'Roof' } },
    ],
  });
  const r = await reg.run('replay_recipe', { name: 'House', params: { storeys: 3 } });
  assert.equal(r.entities, 4);
  near((await reg.run('get_entity', { id: 'Roof' })).min[1], 9);
  assert.ok(ctx.doc.recipes.House, 'recipes survive a clearing replay');
  ctx.store.undo();
  assert.equal(ctx.doc.entities.length, 2); // one undo step
  await reg.run('save_recipe', { name: 'As built' });
  await reg.run('replay_recipe', { name: 'As built' });
  assert.deepEqual(ctx.doc.entities.map((e) => [e.name, e.material.color]), [['Storey 1', '#a8553c'], ['Storey 2', '#a8553c']]);
  assert.deepEqual((await reg.run('list_recipes')).map((x) => x.name), ['House', 'As built']);
  await assert.rejects(reg.run('replay_recipe', { name: 'Nope' }), /No recipe "Nope".*House/);
});

test('macro recorder: what was done becomes a recipe and a script', async () => {
  const { ctx, reg } = makeCtx();
  await reg.run('create_box', { width: 1, height: 1, depth: 1, name: 'Before' });
  await reg.run('record_macro', { name: 'Shelf' });
  await reg.run('create_box', { width: 1.2, height: 0.02, depth: 0.3, position: [0, 0.4, 0], name: 'Board' });
  await reg.run('duplicate', { ids: ['Board'], offset: [0, 0.4, 0], count: 2 });
  const m = await reg.run('stop_macro');
  assert.equal(m.steps, 2);
  assert.match(m.script, /await api\.create_box\(\{"width":1\.2/);
  assert.equal(ctx.doc.recipes.Shelf.steps.length, 2);
  await reg.run('new_model');
  await reg.run('run_script', { code: m.script });
  assert.equal(ctx.doc.entities.length, 3);
  await assert.rejects(reg.run('stop_macro'), /Not recording/);
});

test('plugin generators: stairs and walls keep their parameters', async () => {
  const { reg } = makeCtx();
  const { default: architecture } = await import('../plugins/architecture.js');
  const { booleanMeshes } = await import('../src/core/csg.js');
  architecture({
    geometry: G,
    csg: { booleanMeshes },
    registerGenerator: R.registerGenerator,
    registerCommand: (spec) => reg.define({ category: 'plugin', mutates: true, ...spec, run: (a) => spec.run(a, { run: reg.run }) }),
    run: reg.run,
    addToolbarButton() {},
  });
  const stairs = await reg.run('create_stairs', { steps: 10 });
  near(stairs.size[1], 1.8);
  await reg.run('set_params', { id: stairs.id, params: { steps: 5 } });
  near((await reg.run('get_entity', { id: stairs.id })).size[1], 0.9);
  const sep = await reg.run('create_stairs', { steps: 3, separate: true });
  assert.equal(sep.children, 3);
  const wall = await reg.run('create_wall', { from: [0, 0], to: [4, 0], openings: [{ at: 2, width: 1, height: 1.2, sill: 1 }] });
  near((await reg.run('get_entity', { id: wall.id })).volume, 4 * 2.7 * 0.2 - 1.2 * 0.2, 1e-3);
  await reg.run('set_params', { id: wall.id, params: { to: [0, 6], openings: [] } });
  const w = await reg.run('get_entity', { id: wall.id });
  near(w.size[2], 6, 1e-3);
  near(w.volume, 6 * 2.7 * 0.2, 1e-3);
});
