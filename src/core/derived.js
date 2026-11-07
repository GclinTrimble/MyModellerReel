// Live dependency graph for parametric entities. A derived entity keeps its recipe next to its geometry:
//   e.derived = { generator, inputs: [entity ids], params, offset?, stamp, error? }
// After every change, rebuildDerived() regenerates (in dependency order) the entities whose inputs or parameters
// changed. The mesh stays stored too, so files open in any glTF viewer and without the plugin that made them.
import { Matrix4 } from 'three';
import * as G from './geometry.js';
import * as D from './document.js';
import * as C from './curves.js';
import * as P from './profiles.js';

const GENERATORS = new Map();

/**
 * spec: { description, params: { name: description }, world: bool, run({ params, inputs, doc }) → { mesh } }.
 * world generators (sweeps, arrays) build in world space and also return the world `origin` of their base centre;
 * the others build in local space and leave the entity's transform alone.
 */
export function registerGenerator(name, spec) {
  if (!/^[\w-]{1,60}$/.test(name) || typeof spec?.run !== 'function') throw new Error('registerGenerator(name, { description, params, run })');
  GENERATORS.set(name, { params: {}, ...spec });
}
export const getGenerator = (name) => GENERATORS.get(name);
export const listGenerators = () => [...GENERATORS].map(([name, g]) => ({ name, description: g.description, params: g.params, world: !!g.world }));

const positive = (o, ...ks) => ks.forEach((k) => {
  if (!(o[k] > 0)) throw new Error(`${k} must be a positive number (metres).`);
});
const local = (fn, params, description) => ({ description, params, run: ({ params: p }) => ({ mesh: fn(p) }) });

registerGenerator('box', local((p) => (positive(p, 'width', 'height', 'depth'), G.box(p.width, p.height, p.depth)), { width: 'x size', height: 'y size', depth: 'z size' }, 'Box on its base'));
registerGenerator('cylinder', local((p) => (positive(p, 'radius', 'height'), G.cylinder(p.radius, p.height, Math.max(3, Math.round(p.segments || 32)))), { radius: 'm', height: 'm', segments: 'sides' }, 'Upright cylinder'));
registerGenerator('cone', local((p) => (positive(p, 'radius', 'height'), G.cone(p.radius, p.height, Math.max(3, Math.round(p.segments || 32)))), { radius: 'm', height: 'm', segments: 'sides' }, 'Upright cone'));
registerGenerator('sphere', local((p) => {
  positive(p, 'radius');
  const s = Math.max(4, Math.round(p.segments || 32));
  return G.sphere(p.radius, s, Math.max(4, s >> 1));
}, { radius: 'm', segments: 'smoothness' }, 'Sphere resting on its base'));
registerGenerator('prism', local((p) => {
  if (!(p.points?.length >= 3)) throw new Error('A prism needs at least 3 [x, z] points.');
  const face = G.flatFace(p.points.map(([x, z]) => [x, 0, z]));
  return p.height ? G.extrude(face, 0, p.height) : face;
}, { points: '[[x, z], …] outline', height: 'm (0: a flat face)' }, 'Outline extruded upwards'));
registerGenerator('lathe', local((p) => {
  if (!(p.profile?.length >= 2)) throw new Error('A lathe needs a profile of at least 2 [radius, y] pairs.');
  return G.lathe(p.profile, Math.max(3, Math.round(p.segments || 32)));
}, { profile: '[[radius, y], …] bottom to top', segments: 'sides' }, 'Surface of revolution'));

/** World points of a curve entity, sampled. */
export function curveWorldPoints(doc, e) {
  if (!e.curve) throw new Error(`${e.name} is not a curve.`);
  return D.curvePoints(doc, e);
}

registerGenerator('sweep', {
  description: 'Profile swept along a path (a curve entity input, or path points)',
  world: true,
  params: { profile: 'profile name or [[u, v], …]', profile_params: 'parameters of a named profile', anchor: 'insertion point', mirror: 'flip left-right', path: '[[x, y, z], …] when there is no curve input' },
  run: ({ params: p, inputs, doc }) => {
    const path = inputs[0] ? curveWorldPoints(doc, inputs[0]) : p.path;
    if (!path) throw new Error('A sweep needs a path: a curve entity or path points.');
    const outline = P.profilePoints(p.profile ?? 'rectangle', { params: p.profile_params || {}, anchor: p.anchor, mirror: p.mirror, doc });
    return G.recenter(C.sweep(outline, path));
  },
});

registerGenerator('array', {
  description: 'Copies of another shape, each shifted by offset',
  world: true,
  params: { count: 'number of copies', offset: '[dx, dy, dz] per copy' },
  run: ({ params: p, inputs, doc }) => {
    const src = inputs[0];
    if (!src?.mesh) throw new Error('An array needs a shape as its input.');
    const n = Math.round(p.count || 1);
    if (n < 1 || n > 1000) throw new Error('count must be 1…1000.');
    const w = D.worldMesh(doc, src);
    const v = [];
    const f = [];
    for (let k = 1; k <= n; k++) {
      const d = G.scl(p.offset || [1, 0, 0], k);
      f.push(...w.f.map((face) => face.map((i) => i + v.length)));
      v.push(...w.v.map((q) => G.add(q, d)));
    }
    return G.recenter({ v, f });
  },
});

// FNV-1a over the inputs that matter: cheap change detection without keeping copies.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
function stampOf(doc, e, inputs) {
  const d = e.derived;
  return hash(JSON.stringify([d.generator, d.params, d.offset || null, inputs.map((x) => [x.mesh || x.curve || null, D.worldMatrix(doc, x).elements.map((v) => Math.round(v * 1e6))])]));
}

function apply(doc, e, out) {
  const off = e.derived.offset;
  if (getGenerator(e.derived.generator).world) {
    e.mesh = out.mesh;
    D.setWorldMatrix(doc, e, new Matrix4().makeTranslation(...out.origin));
  } else e.mesh = out.mesh;
  if (off) e.mesh = G.translate(e.mesh, off);
}

/** Run an entity's generator now. Throws on bad parameters, leaving the entity as it was. */
export function regenerate(doc, e) {
  const d = e.derived;
  const gen = getGenerator(d.generator);
  if (!gen) throw new Error(`The generator "${d.generator}" is not loaded (a plugin may be missing).`);
  const inputs = d.inputs.map((id) => {
    const x = D.getEntity(doc, id);
    if (!x) throw new Error(`Its input ${id} was deleted.`);
    if (x.derived?.error) throw new Error(`Its input ${x.name} has an error.`);
    return x;
  });
  apply(doc, e, gen.run({ params: d.params, inputs, doc }));
  d.stamp = stampOf(doc, e, inputs);
  delete d.error;
}

/** Make e a derived entity and build its geometry. */
export function derive(doc, e, generator, params, inputs = []) {
  e.derived = { generator, inputs, params };
  regenerate(doc, e);
  return e;
}

/** Ids that use e (directly or further down the chain). */
export function dependentsOf(doc, id) {
  const out = [];
  const walk = (x) => {
    for (const e of doc.entities) if (e.derived?.inputs.includes(x) && !out.includes(e.id)) out.push(e.id), walk(e.id);
  };
  walk(id);
  return out;
}

/**
 * Regenerate what changed, inputs before the entities that use them. A cycle, a missing input or a failing
 * generator puts an error on the entity (shown in the UI, returned by the commands) instead of throwing.
 * Returns the ids rebuilt.
 */
export function rebuildDerived(doc) {
  const list = doc.entities.filter((e) => e.derived);
  if (!list.length) return [];
  const ids = new Set(list.map((e) => e.id));
  const indeg = new Map(list.map((e) => [e.id, e.derived.inputs.filter((i) => ids.has(i)).length]));
  const queue = list.filter((e) => !indeg.get(e.id));
  const order = [];
  while (queue.length) {
    const e = queue.shift();
    order.push(e);
    for (const x of list) {
      const uses = x.derived.inputs.filter((i) => i === e.id).length;
      if (!uses) continue;
      indeg.set(x.id, indeg.get(x.id) - uses);
      if (!indeg.get(x.id)) queue.push(x);
    }
  }
  for (const e of list) if (!order.includes(e)) e.derived.error = 'Its inputs form a cycle (it depends on itself).';
  const rebuilt = [];
  for (const e of order) {
    const d = e.derived;
    const inputs = d.inputs.map((id) => D.getEntity(doc, id));
    if (inputs.some((x) => !x)) {
      d.error = `An input was deleted (${d.inputs.filter((i) => !D.getEntity(doc, i)).join(', ')}). Bake it or delete it.`;
      continue;
    }
    if (inputs.some((x) => x.derived?.error)) {
      d.error = 'One of its inputs has an error.';
      continue;
    }
    if (!d.error && d.stamp === stampOf(doc, e, inputs)) continue;
    try {
      regenerate(doc, e);
      rebuilt.push(e.id);
    } catch (err) {
      d.error = err.message;
    }
  }
  return rebuilt;
}

/** Freeze a derived entity into a plain shape. */
export const bake = (e) => delete e.derived;
