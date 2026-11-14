// Point classes by hand (#299): deltas, selections (lasso, front only, attributes, grow), edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as S from '../src/core/cloudselect.js';

const rnd = ((a) => () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
})(5);

/** A source of nodes made of point lists [[x, y, z, class]]. */
function sourceOf(groups) {
  const nodes = Object.entries(groups).map(([name, pts]) => {
    const exact = Float64Array.from(pts.flatMap((p) => p.slice(0, 3)));
    const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
    const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
    return { name, count: pts.length, box: { min, max }, v: { count: pts.length, exact, classification: Uint8Array.from(pts, (p) => p[3] ?? 1), intensity: Uint16Array.from(pts, () => 1000) } };
  });
  return { nodes, view: async (n) => n.v };
}

const facade = (y, n, cls = 6) => Array.from({ length: n }, () => [rnd() * 10, y, rnd() * 6, cls]);

test('deltas: round trip, applied in order, the last one wins', () => {
  const a = S.encodeDelta(new Map([['r0', { dense: Uint8Array.from([2, 2, 5, 6]) }]]));
  const b = S.encodeDelta({ r0: { idx: Uint32Array.from([1, 3]), cls: Uint8Array.from([65, 7]), flags: Uint8Array.from([S.LOCK, S.DELETED]) } });
  const da = S.decodeDelta(a);
  assert.deepEqual([...da.get('r0').dense], [2, 2, 5, 6]);
  const { classes, flags } = S.effective(Uint8Array.from([1, 1, 1, 1]), 4, [da, S.decodeDelta(b)], 'r0');
  assert.deepEqual([...classes], [2, 65, 5, 7]);
  assert.deepEqual([...flags], [0, S.LOCK, 0, S.DELETED]);
  assert.notDeepEqual(S.encodeDelta({ x: { dense: Uint8Array.of(1) } }), S.encodeDelta({ x: { dense: Uint8Array.of(1) } }), 'a fresh nonce each time');
});

test('a lasso through everything takes both façades; front only takes the one facing the camera', async () => {
  const src = sourceOf({ r0: facade(0, 3000), r1: facade(10, 3000) });
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  cam.up.set(0, 0, 1);
  cam.position.set(5, -25, 3);
  cam.lookAt(5, 0, 3);
  cam.updateMatrixWorld();
  const camera = { view: cam.matrixWorldInverse.elements, proj: cam.projectionMatrix.elements };
  const polygon = [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]];
  const all = await S.select(src, { screen: { camera, polygon } });
  assert.equal(S.countOf(all), 6000);
  const front = await S.select(src, { screen: { camera, polygon }, front_only: true, pixels: [1600, 900] });
  assert.ok(front.nodes.get('r0').idx.length === 3000, 'the near façade whole');
  assert.ok((front.nodes.get('r1')?.idx.length || 0) < 150, `little of the far one: ${front.nodes.get('r1')?.idx.length}`);
  // a lasso around the left half only
  const half = await S.select(src, { screen: { camera, polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] } });
  const xs = [...half.nodes.get('r0').idx].map((i) => src.nodes[0].v.exact[i * 3]);
  assert.ok(xs.every((x) => x < 5.01) && xs.length > 1000);
});

test('select by attributes, combine add / remove, invert, statistics', async () => {
  const src = sourceOf({ r0: [...facade(0, 100, 6), ...facade(0, 50, 2)] });
  const b = await S.select(src, { classes: [6] });
  assert.equal(S.countOf(b), 100);
  const low = await S.select(src, { elevation: [0, 1] });
  const both = S.combine(b, low, 'add');
  const only = S.combine(b, low, 'remove');
  assert.ok(S.countOf(both) > 100 && S.countOf(only) < 100);
  assert.equal(S.countOf(both) + 0, S.countOf(only) + S.countOf(low));
  const inv = await S.invert(src, b);
  assert.equal(S.countOf(inv), 50);
  const st = S.selectionStats(b);
  assert.deepEqual(st.classes, { 6: 100 });
  assert.equal(st.mean_intensity, 1000);
});

test('grow from a point on a wall takes that wall and stops at the corner', async () => {
  const pts = [];
  for (let i = 0; i < 6000; i++) pts.push([rnd() * 8, 0, rnd() * 4, 6]); // the wall along x
  for (let i = 0; i < 6000; i++) pts.push([0, rnd() * 8, rnd() * 4, 6]); // the wall along y, meeting it at the origin
  for (let i = 0; i < 6000; i++) pts.push([rnd() * 8, rnd() * 8, 0, 2]); // the ground
  const src = sourceOf({ r0: pts.slice(0, 9000), r1: pts.slice(9000) });
  const sel = await S.grow(src, [5, 0, 2], { angle: 15, distance: 0.05 });
  const got = [];
  for (const [name, e] of sel.nodes) for (const i of e.idx) got.push(pts[(name === 'r1' ? 9000 : 0) + i]);
  const wall = got.filter((p) => p[1] === 0 && p[2] > 0.3 && p[0] > 0.3).length;
  const other = got.filter((p) => (p[0] === 0 && p[1] > 0.3) || (p[2] === 0 && p[1] > 0.3)).length;
  assert.equal(other, 0, 'nothing of the other wall or the ground');
  assert.ok(wall > 6000 * 0.85, `${wall} of the wall`);
});

test('an edit: the delta, the counts, locks and deletes', async () => {
  const src = sourceOf({ r0: facade(0, 20, 6) });
  const sel = await S.select(src, {});
  const e = S.editOf(sel, { cls: 65, lock: true });
  assert.equal(e.changed, 20);
  assert.deepEqual(e.counts, { 6: -20, 65: 20 });
  assert.ok([...e.delta.get('r0').flags].every((f) => f === S.LOCK));
  S.afterEdit(sel, e.delta);
  assert.equal(S.editOf(sel, { cls: 65 }).changed, 0, 'pressing the key again changes nothing');
  const d = S.editOf(sel, { deleted: true });
  assert.ok([...d.delta.get('r0').cls].every((c) => c === 7) && [...d.delta.get('r0').flags].every((f) => f === (S.LOCK | S.DELETED)));
});
