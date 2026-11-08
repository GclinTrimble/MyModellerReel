// Live dependency graph for parametric entities. A derived entity keeps its recipe next to its geometry:
//   e.derived = { generator, inputs: [entity ids], params, offset?, stamp, error? }
// After every change, rebuildDerived() regenerates (in dependency order) the entities whose inputs or parameters
// changed. The mesh stays stored too, so files open in any glTF viewer and without the plugin that made them.
import { Matrix4 } from 'three';
import * as FT from './font.js';
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

registerGenerator('text', local((p) => FT.textMesh(String(p.text ?? ''), { size: p.size ?? 0.5, depth: p.depth ?? 0.05, align: p.align || 'center', flat: !!p.flat, font: p.font }), { text: 'the words', size: 'capital height, m', depth: 'm', align: 'left | center | right', flat: 'lie on the ground', font: 'font name' }, 'Extruded 3D text'));
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
  const profile = typeof d.params?.profile === 'string' ? doc.profiles?.[d.params.profile] ?? null : null; // redefined profiles rebuild
  return hash(JSON.stringify([d.generator, d.params, d.offset || null, d.pivot || null, profile, inputs.map((x) => [x.mesh || x.curve || x.line || x.point || null, D.worldMatrix(doc, x).elements.map((v) => Math.round(v * 1e6))])]));
}

/**
 * The axes a set_pivot phrase names (left/right → x, bottom/top → y, back/front → z, center → all) and where they fall
 * on a local mesh's bounds. Those axes follow the shape when it is resized; the others keep their fixed offset.
 */
export function anchorOf(mesh, words) {
  const b = G.bbox(mesh);
  const w = String(words).toLowerCase().split(/[\s,-]+/);
  const p = b.min.map((x, k) => (x + b.max[k]) / 2);
  const axes = new Set(w.includes('center') || w.includes('centre') ? [0, 1, 2] : []);
  const at = (k, v) => ((p[k] = v), axes.add(k));
  if (w.includes('left')) at(0, b.min[0]);
  if (w.includes('right')) at(0, b.max[0]);
  if (w.includes('bottom') || w.includes('base')) at(1, b.min[1]);
  if (w.includes('top')) at(1, b.max[1]);
  if (w.includes('back')) at(2, b.min[2]);
  if (w.includes('front')) at(2, b.max[2]);
  return { p, axes: [...axes] };
}

function apply(doc, e, out) {
  const d = e.derived;
  if (out.report) d.report = out.report; // e.g. a surface's duplicates and crossings, for check_surface
  if (getGenerator(d.generator).world) {
    e.mesh = out.mesh;
    D.setWorldMatrix(doc, e, new Matrix4().makeTranslation(...out.origin));
  } else e.mesh = out.mesh;
  if (d.offset || d.pivot) {
    const off = [...(d.offset || [0, 0, 0])];
    if (d.pivot) {
      const { p, axes } = anchorOf(out.mesh, d.pivot);
      for (const k of axes) off[k] = -p[k];
    }
    e.mesh = G.translate(e.mesh, off);
  }
}

/** Run an entity's generator now. Throws on bad parameters, leaving the entity as it was. */
export function regenerate(doc, e) {
  const d = e.derived;
  const gen = getGenerator(d.generator);
  if (!gen) throw new Error(`The generator "${d.generator}" is not loaded (a plugin may be missing).`);
  if (gen.inputsFrom) d.inputs = gen.inputsFrom(d.params, doc);
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
  // generators that pick their own inputs (a surface of "all points") refresh them first
  for (const e of list) {
    const gen = GENERATORS.get(e.derived.generator);
    if (gen?.inputsFrom) e.derived.inputs = gen.inputsFrom(e.derived.params, doc);
  }
  // Kahn's algorithm over an adjacency map: runs after every command, so it must stay linear in the model size
  const all = new Map(doc.entities.map((e) => [e.id, e]));
  const users = new Map(); // input id → the derived entities that use it (once per use)
  const indeg = new Map();
  for (const e of list) {
    let n = 0;
    for (const i of e.derived.inputs)
      if (all.get(i)?.derived) {
        if (!users.has(i)) users.set(i, []);
        users.get(i).push(e);
        n++;
      }
    indeg.set(e.id, n);
  }
  const order = list.filter((e) => !indeg.get(e.id));
  for (let k = 0; k < order.length; k++)
    for (const x of users.get(order[k].id) || []) {
      indeg.set(x.id, indeg.get(x.id) - 1);
      if (!indeg.get(x.id)) order.push(x);
    }
  const placed = new Set(order);
  for (const e of list) if (!placed.has(e)) e.derived.error = 'It depends on a loop of parametric shapes (one of them uses itself, directly or not).';
  const rebuilt = [];
  for (const e of order) {
    const d = e.derived;
    const inputs = d.inputs.map((id) => all.get(id));
    if (inputs.some((x) => !x)) {
      d.error = `An input was deleted (${d.inputs.filter((i) => !all.has(i)).join(', ')}). Bake it or delete it.`;
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
