// The command registry: the one API surface of MyModellerReel.
// Toolbar buttons, menus, the in-app AI, the HTTP API, the MCP server and plugins all call these commands,
// so anything a person can do, an AI can do, and anything a plugin adds, an AI can call.
import { Matrix4, Vector3, Quaternion, Euler, BufferGeometry, BufferAttribute } from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import * as G from './geometry.js';
import * as D from './document.js';
import * as A from './animation.js';

export const GUIDE = `MyModellerReel conventions:
- Units are metres. Y is UP (blue axis). X is red (right), Z is green (towards the viewer). Ground is y = 0.
- Every shape has a pivot ("origin"); new primitives have it at the centre of their base, so position [x,0,z] puts them ON the ground.
- Entities are referenced by id ("e12") or by exact name ("Front door"). Omitting ids uses the current selection.
- Groups hold children; a child's position/rotation/scale are relative to its group.
- push_pull faces are chosen by index or by direction: top, bottom, left(-x), right(+x), back(-z), front(+z).
- Animation: keyframes per property on a timeline in seconds. Use animate for a from→to move, build_sequence for
  construction / assembly sequences, turntable for a camera orbit, add_keyframe to capture the current pose.
  To hinge a door: set_pivot (e.g. "left") then animate rotation.
- For repetitive or parametric geometry prefer ONE run_script call (JavaScript; \`api.<command>(args)\` returns results).
- Check your work: get_scene for numbers, screenshot to look at the model.`;

const v3 = (d) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: d });
const num = (d) => ({ type: 'number', description: d });
const str = (d, e) => ({ type: 'string', description: d, ...(e ? { enum: e } : {}) });
const bool = (d) => ({ type: 'boolean', description: d });
const ids = { type: 'array', items: { type: 'string' }, description: 'Entity ids or names. Default: current selection.' };
const id = str('Entity id or name');
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const common = {
  name: str('Display name'),
  position: v3('Where the base centre goes, world metres [x,y,z]. Default [0,0,0]'),
  rotation: v3('Euler degrees [x,y,z]'),
  color: str('Hex colour, e.g. "#c8553d"'),
  tag: str('Tag (layer) name'),
  parent: str('Group id to create inside'),
};
const DIRS = { top: [0, 1, 0], bottom: [0, -1, 0], right: [1, 0, 0], left: [-1, 0, 0], front: [0, 0, 1], back: [0, 0, -1] };
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const D2R = Math.PI / 180;

export function createRegistry(ctx) {
  const commands = new Map();
  const reg = {
    commands,
    define(spec) {
      commands.set(spec.name, { category: 'plugin', params: obj({}), ...spec });
    },
    list: () =>
      [...commands.values()].map(({ name, description, params, category, mutates }) => ({
        name,
        description,
        params,
        category,
        mutates: !!mutates,
      })),
    async run(name, args = {}) {
      const c = commands.get(name);
      if (!c) throw new Error(`Unknown command "${name}". Call list_commands to see what exists.`);
      for (const r of c.params.required || [])
        if (args[r] === undefined) throw new Error(`${name}: missing required parameter "${r}"`);
      if (c.mutates && !ctx.batchDepth) ctx.store.checkpoint();
      const result = await c.run(args || {}, ctx);
      if (c.mutates && !ctx.batchDepth) ctx.store.changed();
      for (const fn of ctx.afterRun || []) fn(name, args, result);
      return result ?? { ok: true };
    },
  };
  registerCore(reg, ctx);
  return reg;
}

function targets(ctx, args) {
  const refs = args.ids ?? (args.id !== undefined ? [args.id] : ctx.selection.get());
  if (!refs.length) throw new Error('Nothing selected and no ids given.');
  return D.resolve(ctx.doc, refs);
}

function summary(doc, e) {
  const b = D.worldBox(doc, e);
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    ...(e.parent ? { parent: e.parent } : {}),
    position: D.round3(e.position),
    ...(e.rotation.some((x) => x) ? { rotation: D.round3(e.rotation) } : {}),
    ...(e.scale.some((x) => x !== 1) ? { scale: D.round3(e.scale) } : {}),
    size: D.round3(b.max.map((x, k) => x - b.min[k])),
    min: b.min,
    max: b.max,
    ...(e.mesh ? { color: e.material.color, faces: e.mesh.f.length } : { children: D.childrenOf(doc, e.id).length }),
    ...(e.material.opacity < 1 ? { opacity: e.material.opacity } : {}),
    ...(e.tag !== 'Untagged' ? { tag: e.tag } : {}),
    ...(!e.visible ? { visible: false } : {}),
    ...(e.locked ? { locked: true } : {}),
  };
}

function place(ctx, mesh, args, defaults = {}) {
  const doc = ctx.doc;
  if (args.parent) D.resolve(doc, args.parent);
  const e = D.addEntity(doc, {
    name: args.name || defaults.name,
    mesh,
    position: args.position || [0, 0, 0],
    rotation: args.rotation || [0, 0, 0],
    parent: args.parent ? D.resolve(doc, args.parent)[0].id : null,
    tag: args.tag || 'Untagged',
    material: args.color ? { color: args.color } : {},
  });
  ctx.selection.set([e.id]);
  return summary(doc, e);
}

/** Bring an animated entity's base pose to what is on screen before editing it, then key it if Auto-key is on. */
function editTransforms(ctx, ents, fn) {
  if (!ctx.timeline?.active) return fn(); // modelling mode: the static model is what you see
  const t = ctx.timeline.time;
  const pose = A.evaluate(ctx.doc, t);
  for (const e of ents) for (const p of ['position', 'rotation', 'scale']) if (pose[e.id]?.[p]) e[p] = [...pose[e.id][p]];
  fn();
  if (ctx.autoKey) for (const e of ents) for (const p of ['position', 'rotation', 'scale']) A.setKey(ctx.doc, e.id, p, t, e[p]);
}

/** World transform about a pivot: M' = T(p) · X · T(-p) · M */
function applyWorld(ctx, e, xform, pivot) {
  const doc = ctx.doc;
  const p = new Vector3(...pivot);
  const m = new Matrix4().makeTranslation(p.x, p.y, p.z).multiply(xform).multiply(new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  D.setWorldMatrix(doc, e, m.multiply(D.worldMatrix(doc, e)));
}

function pivotPoint(doc, e, pivot) {
  if (Array.isArray(pivot)) return pivot;
  const b = D.worldBox(doc, e);
  if (pivot === 'center') return b.min.map((x, k) => (x + b.max[k]) / 2);
  if (pivot === 'base') return [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
  return new Vector3(0, 0, 0).applyMatrix4(D.worldMatrix(doc, e)).toArray(); // the entity's own origin
}

function anchorPoint(doc, e, spec) {
  if (Array.isArray(spec)) return spec;
  const b = D.worldBox(doc, e);
  const mid = b.min.map((x, k) => (x + b.max[k]) / 2);
  const words = String(spec).toLowerCase().split(/[\s,-]+/);
  const p = [...mid];
  if (words.includes('left')) p[0] = b.min[0];
  if (words.includes('right')) p[0] = b.max[0];
  if (words.includes('bottom') || words.includes('base')) p[1] = b.min[1];
  if (words.includes('top')) p[1] = b.max[1];
  if (words.includes('back')) p[2] = b.min[2];
  if (words.includes('front')) p[2] = b.max[2];
  return p;
}

function worldFaceInfo(doc, e, fi) {
  const m = D.worldMatrix(doc, e);
  const nm = new Matrix4().extractRotation(m);
  return {
    index: fi,
    normal: D.round3(new Vector3(...G.faceNormal(e.mesh, fi)).applyMatrix4(nm).normalize().toArray()),
    center: D.round3(new Vector3(...G.faceCenter(e.mesh, fi)).applyMatrix4(m).toArray()),
    area: Math.round(G.faceArea(e.mesh, fi) * 1e4) / 1e4,
    sides: e.mesh.f[fi].length,
  };
}

function pickFace(doc, e, face) {
  if (!e.mesh) throw new Error(`${e.name} is a group; push_pull a shape inside it.`);
  if (typeof face === 'number') {
    if (!e.mesh.f[face]) throw new Error(`Face ${face} does not exist (0..${e.mesh.f.length - 1}).`);
    return face;
  }
  const dir = DIRS[face];
  if (!dir) throw new Error(`face must be an index or one of ${Object.keys(DIRS).join(', ')}`);
  let best = 0;
  let bestDot = -Infinity;
  for (let fi = 0; fi < e.mesh.f.length; fi++) {
    const n = worldFaceInfo(doc, e, fi);
    const s = G.dot(n.normal, dir) + 1e-3 * G.dot(n.center, dir); // tie-break: outermost face
    if (s > bestDot) (bestDot = s), (best = fi);
  }
  return best;
}

function meshToGeometry(mesh) {
  const b = G.toBuffers(mesh);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('normal', new BufferAttribute(b.normal, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((b.position.length / 3) * 2), 2));
  return g;
}

function worldMesh(doc, e) {
  const m = D.worldMatrix(doc, e);
  return { v: e.mesh.v.map((p) => new Vector3(...p).applyMatrix4(m).toArray()), f: e.mesh.f };
}

function registerCore(reg, ctx) {
  const def = (category, name, description, params, run, mutates = false) =>
    reg.define({ category, name, description, params, run, mutates });

  // ---------------------------------------------------------------- scene (read)
  def('scene', 'get_scene', 'Summary of the whole model: entities with ids, names, sizes and bounds; tags; camera; animation; selection.', obj({}), () => {
    const doc = ctx.doc;
    return {
      entities: doc.entities.map((e) => summary(doc, e)),
      tags: doc.tags,
      camera: ctx.view?.getCamera() ?? doc.camera,
      animation: { duration: doc.animation.duration, fps: doc.animation.fps, tracks: doc.animation.tracks.length, time: ctx.timeline?.time ?? 0 },
      selection: ctx.selection.get(),
      settings: doc.settings,
    };
  });

  def('scene', 'get_entity', 'Full detail of one entity, including every face (index, world normal, centre, area) for push_pull.', obj({ id }, ['id']), ({ id: ref }) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, ref);
    return {
      ...summary(doc, e),
      material: e.material,
      faces: e.mesh ? e.mesh.f.slice(0, 300).map((_, fi) => worldFaceInfo(doc, e, fi)) : undefined,
      children: e.mesh ? undefined : D.childrenOf(doc, e.id).map((c) => summary(doc, c)),
      volume: e.mesh ? Math.round(G.volume(e.mesh) * e.scale.reduce((a, b) => a * b) * 1e4) / 1e4 : undefined,
      tracks: doc.animation.tracks.filter((t) => t.target === e.id),
    };
  });

  def('scene', 'list_commands', 'Every command with its parameters (JSON Schema).', obj({ category: str('Only this category') }), ({ category }) =>
    reg.list().filter((c) => !category || c.category === category),
  );

  def('scene', 'select', 'Set, extend or clear the selection. Returns the selection.', obj({ ids, mode: str('set (default), add, remove, all, none', ['set', 'add', 'remove', 'all', 'none']) }), ({ ids: refs = [], mode = 'set' }) => {
    const doc = ctx.doc;
    const want = D.resolve(doc, refs).map((e) => e.id);
    const cur = ctx.selection.get();
    const next =
      mode === 'all' ? doc.entities.filter((e) => !e.parent).map((e) => e.id)
      : mode === 'none' ? []
      : mode === 'add' ? [...new Set([...cur, ...want])]
      : mode === 'remove' ? cur.filter((x) => !want.includes(x))
      : want;
    ctx.selection.set(next);
    return { selection: next };
  });

  def('scene', 'measure', 'Distance between two points or two entities (centre to centre, plus the gap between their bounds).', obj({ from: { description: 'point [x,y,z] or entity id' }, to: { description: 'point [x,y,z] or entity id' } }, ['from', 'to']), ({ from, to }) => {
    const doc = ctx.doc;
    const boxOf = (r) => (Array.isArray(r) ? { min: r, max: r } : D.worldBox(doc, D.resolve(doc, r)[0]));
    const a = boxOf(from);
    const b = boxOf(to);
    const ca = a.min.map((x, k) => (x + a.max[k]) / 2);
    const cb = b.min.map((x, k) => (x + b.max[k]) / 2);
    const gap = [0, 1, 2].map((k) => Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]));
    return { distance: Math.round(G.len(G.sub(ca, cb)) * 1e4) / 1e4, delta: D.round3(G.sub(cb, ca)), gap: Math.round(G.len(gap) * 1e4) / 1e4 };
  });

  def('scene', 'screenshot', 'PNG of the viewport, so a vision model can look at the model.', obj({ width: num('Pixels, default 1024') }), async ({ width = 1024 }) => {
    if (!ctx.view) throw new Error('No viewport in this context.');
    return { image: await ctx.view.screenshot({ width }) };
  });

  // ---------------------------------------------------------------- create
  const sizeErr = (...xs) => {
    if (xs.some((x) => !(x > 0))) throw new Error('Sizes must be positive numbers (metres).');
  };
  def('create', 'create_box', 'Box sitting on its base. width = x, height = y (up), depth = z.', obj({ width: num('x size'), height: num('y size'), depth: num('z size'), ...common }, ['width', 'height', 'depth']), (a) => {
    sizeErr(a.width, a.height, a.depth);
    return place(ctx, G.box(a.width, a.height, a.depth), a, { name: 'Box' });
  }, true);

  def('create', 'create_cylinder', 'Upright cylinder sitting on its base.', obj({ radius: num('m'), height: num('m'), segments: num('default 32'), ...common }, ['radius', 'height']), (a) => {
    sizeErr(a.radius, a.height);
    return place(ctx, G.cylinder(a.radius, a.height, a.segments || 32), a, { name: 'Cylinder' });
  }, true);

  def('create', 'create_cone', 'Upright cone on its base.', obj({ radius: num('m'), height: num('m'), segments: num('default 32'), ...common }, ['radius', 'height']), (a) => {
    sizeErr(a.radius, a.height);
    return place(ctx, G.cone(a.radius, a.height, a.segments || 32), a, { name: 'Cone' });
  }, true);

  def('create', 'create_sphere', 'Sphere resting on the ground at position.', obj({ radius: num('m'), segments: num('default 32'), ...common }, ['radius']), (a) => {
    sizeErr(a.radius);
    const s = a.segments || 32;
    return place(ctx, G.sphere(a.radius, s, Math.max(4, s >> 1)), a, { name: 'Sphere' });
  }, true);

  def('create', 'create_prism', 'Extrude a 2D outline drawn on the ground. points are [x, z] pairs relative to position; height 0 gives a flat face you can push_pull later.', obj({ points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '[[x,z],...] at least 3' }, height: num('m, default 0'), ...common }, ['points']), (a) => {
    if (a.points.length < 3) throw new Error('Need at least 3 points.');
    const face = G.flatFace(a.points.map(([x, z]) => [x, 0, z]));
    return place(ctx, a.height ? G.extrude(face, 0, a.height) : face, a, { name: a.height ? 'Prism' : 'Face' });
  }, true);

  def('create', 'create_face', 'A flat face from 3+ coplanar world points (walls, roofs, any plane). push_pull it to give it thickness.', obj({ points: { type: 'array', items: v3('point'), description: '[[x,y,z],...]' }, normal: v3('which side is the front (push_pull outwards). Default: up for horizontal faces'), name: common.name, color: common.color, tag: common.tag }, ['points']), (a) => {
    if (a.points.length < 3 || !G.isPlanar(a.points, 1e-3)) throw new Error('Need 3+ points on one plane.');
    const n = G.polygonNormal(a.points);
    const want = a.normal || (Math.abs(n[1]) > 0.99 ? [0, 1, 0] : n);
    const { mesh, origin } = G.recenter(G.flatFace(a.points, want));
    return place(ctx, mesh, { ...a, position: origin }, { name: 'Face' });
  }, true);

  def('create', 'create_lathe', 'Surface of revolution around the vertical axis: vases, columns, domes, bottles. profile is [radius, y] pairs bottom→top.', obj({ profile: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, segments: num('default 32'), ...common }, ['profile']), (a) =>
    place(ctx, G.lathe(a.profile, a.segments || 32), a, { name: 'Lathe' }), true);

  // ---------------------------------------------------------------- edit
  def('edit', 'push_pull', 'Push or pull a face along its normal (positive = outwards). Faces of prisms slide; other faces extrude new walls.', obj({ id, face: { description: 'face index, or top | bottom | left | right | front | back', default: 'top' }, distance: num('metres, negative pushes in') }, ['id', 'distance']), ({ id: ref, face = 'top', distance }) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, ref);
    const fi = pickFace(doc, e, face);
    e.mesh = G.pushPull(e.mesh, fi, distance / (e.scale[0] || 1)); // shortcut: assumes uniform scale
    return summary(doc, e);
  }, true);

  def('edit', 'move', 'Move entities by a world offset, or put their base centre at a world point.', obj({ ids, by: v3('offset [dx,dy,dz]'), to: v3('absolute world point for the base centre') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    editTransforms(ctx, ents, () => {
      for (const e of ents) {
        const d = a.to ? G.sub(a.to, pivotPoint(doc, e, 'base')) : a.by || [0, 0, 0];
        applyWorld(ctx, e, new Matrix4().makeTranslation(...d), [0, 0, 0]);
      }
    });
    return ents.map((e) => summary(doc, e));
  }, true);

  def('edit', 'rotate', 'Rotate entities around a world axis through a pivot (default: each entity\'s own origin).', obj({ ids, angle: num('degrees, counter-clockwise looking down the axis'), axis: { description: 'x | y | z or a [x,y,z] direction', default: 'y' }, pivot: { description: 'origin (default) | center | base | [x,y,z]' } }, ['angle']), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    const ax = new Vector3(...(Array.isArray(a.axis) ? a.axis : AXES[a.axis || 'y'])).normalize();
    editTransforms(ctx, ents, () => {
      for (const e of ents) applyWorld(ctx, e, new Matrix4().makeRotationAxis(ax, a.angle * D2R), pivotPoint(doc, e, a.pivot));
    });
    return ents.map((e) => summary(doc, e));
  }, true);

  def('edit', 'scale', 'Scale entities about a pivot (default: base centre).', obj({ ids, factor: { description: 'number, or [sx,sy,sz]' }, pivot: { description: 'base (default) | center | origin | [x,y,z]' } }, ['factor']), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    const f = Array.isArray(a.factor) ? a.factor : [a.factor, a.factor, a.factor];
    if (f.some((x) => !x)) throw new Error('Scale factor cannot be 0.');
    editTransforms(ctx, ents, () => {
      for (const e of ents) {
        // Scale in the entity's own axes so a rotated box stretches along its sides.
        const pv = pivotPoint(doc, e, a.pivot || 'base');
        const w = D.worldMatrix(doc, e);
        const q = new Quaternion();
        w.decompose(new Vector3(), q, new Vector3());
        const r = new Matrix4().makeRotationFromQuaternion(q);
        applyWorld(ctx, e, r.clone().multiply(new Matrix4().makeScale(...f)).multiply(r.clone().invert()), pv);
        e.scale = D.round3(e.scale);
      }
    });
    return ents.map((e) => summary(doc, e));
  }, true);

  def('edit', 'set_transform', 'Set position / rotation (degrees) / scale directly, relative to the parent.', obj({ id, position: v3('m'), rotation: v3('degrees'), scale: v3('factors') }, ['id']), (a) => {
    const [e] = D.resolve(ctx.doc, a.id);
    editTransforms(ctx, [e], () => {
      for (const k of ['position', 'rotation', 'scale']) if (a[k]) e[k] = [...a[k]];
    });
    return summary(ctx.doc, e);
  }, true);

  def('edit', 'duplicate', 'Copy entities. count copies, each shifted by offset and/or rotated by angle (degrees around Y through center): linear and radial arrays.', obj({ ids, offset: v3('per copy, default [1,0,0]'), count: num('default 1'), angle: num('degrees per copy (radial array)'), center: v3('centre of the radial array, default [0,0,0]') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    const out = [];
    for (let k = 1; k <= (a.count || 1); k++)
      for (const e of ents) {
        const c = D.duplicateEntity(doc, e);
        c.name = `${e.name} ${k + 1}`;
        if (a.angle) applyWorld(ctx, c, new Matrix4().makeRotationY(a.angle * k * D2R), a.center || [0, 0, 0]);
        if (a.offset || !a.angle) applyWorld(ctx, c, new Matrix4().makeTranslation(...G.scl(a.offset || [1, 0, 0], k)), [0, 0, 0]);
        out.push(c.id);
      }
    ctx.selection.set(out);
    return { created: out };
  }, true);

  def('edit', 'mirror', 'Mirror shapes across a world plane through their centre (or at `at`). copy keeps the original.', obj({ ids, axis: str('x | y | z: the axis the mirror flips', ['x', 'y', 'z']), at: num('plane coordinate, default: entity centre'), copy: bool('keep the original, default true') }, ['axis']), (a) => {
    const doc = ctx.doc;
    const k = { x: 0, y: 1, z: 2 }[a.axis];
    const out = [];
    for (const e of targets(ctx, a)) {
      if (!e.mesh) throw new Error(`${e.name} is a group; mirror its shapes.`);
      const b = D.worldBox(doc, e);
      const at = a.at ?? (b.min[k] + b.max[k]) / 2;
      const w = worldMesh(doc, e);
      w.v = w.v.map((p) => p.map((x, j) => (j === k ? 2 * at - x : x)));
      w.f = w.f.map((f) => [...f].reverse());
      const { mesh, origin } = G.recenter(w);
      const target = a.copy === false ? e : D.duplicateEntity(doc, e);
      Object.assign(target, { mesh, position: origin, rotation: [0, 0, 0], scale: [1, 1, 1], parent: null });
      if (a.copy !== false) target.name = `${e.name} mirrored`;
      out.push(target.id);
    }
    return { mirrored: out };
  }, true);

  def('edit', 'delete', 'Delete entities (and everything inside groups).', obj({ ids }), (a) => {
    const ents = targets(ctx, a);
    for (const e of ents) D.removeEntity(ctx.doc, e);
    ctx.selection.set([]);
    return { deleted: ents.map((e) => e.id) };
  }, true);

  def('edit', 'group', 'Group entities so they move and animate together.', obj({ ids, name: str('Group name') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    const b = D.unionBox(ents.map((e) => D.worldBox(doc, e)));
    const g = D.addEntity(doc, { type: 'group', name: a.name, position: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2], parent: ents[0].parent });
    for (const e of ents) {
      const w = D.worldMatrix(doc, e);
      e.parent = g.id;
      D.setWorldMatrix(doc, e, w);
    }
    ctx.selection.set([g.id]);
    return summary(doc, g);
  }, true);

  def('edit', 'ungroup', 'Explode a group: its children keep their place and move up one level.', obj({ id }, ['id']), (a) => {
    const doc = ctx.doc;
    const [g] = D.resolve(doc, a.id);
    if (g.type !== 'group') throw new Error(`${g.name} is not a group.`);
    const kids = D.childrenOf(doc, g.id);
    for (const c of kids) {
      const w = D.worldMatrix(doc, c);
      c.parent = g.parent;
      D.setWorldMatrix(doc, c, w);
    }
    doc.entities = doc.entities.filter((e) => e !== g);
    ctx.selection.set(kids.map((c) => c.id));
    return { children: kids.map((c) => c.id) };
  }, true);

  def('edit', 'set_pivot', 'Move an entity\'s pivot (origin) without moving it: hinges for doors, wheel axles. pivot: [x,y,z] world point, or words like "left", "left bottom front", "center", "top".', obj({ id, pivot: { description: '[x,y,z] or anchor words: left/right, bottom/top, back/front, center' } }, ['id', 'pivot']), (a) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, a.id);
    const pw = new Vector3(...anchorPoint(doc, e, a.pivot));
    const L = pw.clone().applyMatrix4(D.worldMatrix(doc, e).invert()).toArray(); // pivot in local space
    if (e.mesh) e.mesh = G.translate(e.mesh, G.scl(L, -1));
    for (const c of D.childrenOf(doc, e.id)) c.position = D.round3(G.sub(c.position, L));
    e.position = D.round3(new Vector3(...L).applyMatrix4(D.localMatrix(e)).toArray());
    return summary(doc, e);
  }, true);

  def('edit', 'set_material', 'Colour and finish of shapes (applies to every shape inside groups).', obj({ ids, color: str('#rrggbb'), opacity: num('0..1'), metalness: num('0..1'), roughness: num('0..1'), emissive: str('#rrggbb glow') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a).flatMap((e) => [e, ...D.descendants(doc, e.id)]);
    for (const e of ents) for (const k of ['color', 'opacity', 'metalness', 'roughness', 'emissive']) if (a[k] !== undefined) e.material[k] = a[k];
    return { updated: ents.map((e) => e.id) };
  }, true);

  def('edit', 'set_properties', 'Rename, tag, hide/show or lock entities.', obj({ ids, name: str('new name'), tag: str('tag name (created if new)'), visible: bool('show/hide'), locked: bool('lock') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    for (const e of ents) {
      if (a.name !== undefined) e.name = ents.length > 1 ? `${a.name} ${ents.indexOf(e) + 1}` : a.name;
      if (a.tag !== undefined) {
        e.tag = a.tag;
        if (!doc.tags.some((t) => t.name === a.tag)) doc.tags.push({ name: a.tag, visible: true });
      }
      if (a.visible !== undefined) e.visible = a.visible;
      if (a.locked !== undefined) e.locked = a.locked;
    }
    return ents.map((e) => summary(doc, e));
  }, true);

  def('edit', 'set_tag_visibility', 'Show or hide every entity with a tag (layer).', obj({ tag: str('tag name'), visible: bool('show') }, ['tag', 'visible']), (a) => {
    const t = ctx.doc.tags.find((x) => x.name === a.tag);
    if (!t) throw new Error(`No tag "${a.tag}".`);
    t.visible = a.visible;
    return t;
  }, true);

  def('edit', 'boolean', 'Solid tools: union, subtract (cut tools out of target, e.g. window openings) or intersect. The result replaces target.', obj({ op: str('union | subtract | intersect', ['union', 'subtract', 'intersect']), target: str('entity to keep'), tools: ids, keep_tools: bool('keep the tool shapes, default false') }, ['op', 'target', 'tools']), (a) => {
    const doc = ctx.doc;
    const [t] = D.resolve(doc, a.target);
    const tools = D.resolve(doc, a.tools);
    if (!t.mesh || tools.some((x) => !x.mesh)) throw new Error('Booleans work on shapes, not groups.');
    const ev = new Evaluator();
    ev.useGroups = false;
    const brush = (e) => {
      const b = new Brush(meshToGeometry(worldMesh(doc, e)));
      b.updateMatrixWorld();
      return b;
    };
    let result = brush(t);
    const op = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION }[a.op];
    for (const x of tools) result = ev.evaluate(result, brush(x), op);
    const g = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry;
    const raw = G.fromTriangles(g.attributes.position.array);
    if (!raw.f.length) throw new Error('The result is empty (the shapes may not overlap).');
    const { mesh, origin } = G.recenter(raw);
    const w = new Vector3(...origin);
    Object.assign(t, { mesh, rotation: [0, 0, 0], scale: [1, 1, 1] });
    t.position = D.round3(w.applyMatrix4(D.parentWorldMatrix(doc, t).invert()).toArray());
    if (!a.keep_tools) for (const x of tools) D.removeEntity(doc, x);
    return summary(doc, t);
  }, true);

  def('edit', 'undo', 'Undo the last change.', obj({}), () => ({ undone: ctx.store.undo() }));
  def('edit', 'redo', 'Redo.', obj({}), () => ({ redone: ctx.store.redo() }));
  def('edit', 'new_model', 'Start an empty model (the old one can be undone only if saved).', obj({}), () => {
    ctx.store.replace(D.newDoc());
    ctx.selection.set([]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- view
  def('view', 'set_camera', 'Place the camera.', obj({ position: v3('eye'), target: v3('look-at point'), fov: num('degrees') }), (a) => {
    if (!ctx.view) return ctx.doc.camera;
    ctx.view.setCamera(a);
    return ctx.view.getCamera();
  });
  def('view', 'set_view', 'Standard view: top, bottom, front, back, left, right, iso. Zooms to fit.', obj({ preset: str('view', ['top', 'bottom', 'front', 'back', 'left', 'right', 'iso']) }, ['preset']), (a) => {
    ctx.view?.setView(a.preset);
    return ctx.view?.getCamera();
  });
  def('view', 'zoom_extents', 'Fit the model (or the given entities) in the view.', obj({ ids }), (a) => {
    ctx.view?.zoomExtents(a.ids ? D.resolve(ctx.doc, a.ids).map((e) => e.id) : null);
    return ctx.view?.getCamera();
  });
  def('view', 'set_style', 'Display style: edges, x-ray, wireframe, shadows, grid, sun position.', obj({ edges: bool(''), xray: bool(''), wireframe: bool(''), shadows: bool(''), grid: bool(''), sun: obj({ azimuth: num('degrees from north (−z), clockwise'), elevation: num('degrees above horizon') }) }), (a) => {
    const s = ctx.doc.settings;
    for (const k of ['edges', 'xray', 'wireframe', 'shadows', 'grid']) if (a[k] !== undefined) s[k] = a[k];
    if (a.sun) s.sun = { ...s.sun, ...a.sun };
    return s;
  }, true);
  def('view', 'section', 'Cut the model with a section plane to see inside. Disable with enabled:false.', obj({ enabled: bool('default true'), normal: v3('the side that is cut away'), point: v3('a point on the plane') }), (a) => {
    ctx.doc.settings.section = a.enabled === false ? null : { normal: a.normal || [0, -1, 0], point: a.point || [0, 1.2, 0] };
    return { section: ctx.doc.settings.section };
  }, true);
  def('view', 'add_scene', 'Save the current camera as a named scene (a shot you can return to or animate between).', obj({ name: str('scene name') }), (a) => {
    const doc = ctx.doc;
    const cam = ctx.view?.getCamera() ?? doc.camera;
    const name = a.name || `Scene ${doc.scenes.length + 1}`;
    doc.scenes = doc.scenes.filter((s) => s.name !== name);
    doc.scenes.push({ name, camera: cam });
    return { scenes: doc.scenes.map((s) => s.name) };
  }, true);
  def('view', 'go_to_scene', 'Jump the camera to a saved scene.', obj({ name: str('scene name') }, ['name']), (a) => {
    const s = ctx.doc.scenes.find((x) => x.name === a.name);
    if (!s) throw new Error(`No scene "${a.name}".`);
    ctx.view?.setCamera(s.camera);
    return s;
  });

  // ---------------------------------------------------------------- animate
  const now = () => ctx.timeline?.time ?? 0;
  const baseValue = (target, property) => {
    if (target === 'camera') return (ctx.view?.getCamera() ?? ctx.doc.camera)[property];
    const [e] = D.resolve(ctx.doc, target);
    if (property === 'opacity' || property === 'color') return e.material[property];
    return e[property];
  };
  const targetId = (t) => (t === 'camera' ? 'camera' : D.resolve(ctx.doc, t)[0].id);
  const PROPS = ['position', 'rotation', 'scale', 'opacity', 'visible', 'color', 'target', 'fov'];

  def('animate', 'add_keyframe', 'Record a keyframe at a time. Without values it captures the current pose (position, rotation, scale), or for the camera its position and target.', obj({ target: str('entity id/name, or "camera"'), time: num('seconds, default: playhead'), values: obj({}, []), ease: str('ease into this key', Object.keys(A.EASES)) }, ['target']), (a) => {
    const tid = targetId(a.target);
    const t = a.time ?? now();
    const values = a.values && Object.keys(a.values).length ? a.values : Object.fromEntries((tid === 'camera' ? ['position', 'target'] : ['position', 'rotation', 'scale']).map((p) => [p, baseValue(a.target, p)]));
    for (const [p, v] of Object.entries(values)) {
      if (!PROPS.includes(p)) throw new Error(`Cannot animate "${p}". Use one of ${PROPS.join(', ')}.`);
      A.setKey(ctx.doc, tid, p, t, v, a.ease);
    }
    return { target: tid, time: t, keyed: Object.keys(values) };
  }, true);

  def('animate', 'animate', 'Animate one property from → to between start and end seconds. position/rotation/scale are [x,y,z] (rotation in degrees), opacity 0..1, color "#rrggbb", visible true/false. Use by for a relative change.', obj({ target: str('entity id/name or "camera"'), property: str('property', PROPS), to: { description: 'end value' }, by: { description: 'relative change instead of to (numbers / [x,y,z])' }, from: { description: 'start value, default: current' }, start: num('seconds, default: playhead'), end: num('seconds, default start + 1'), ease: str('easing', Object.keys(A.EASES)) }, ['target', 'property']), (a) => {
    const tid = targetId(a.target);
    const start = a.start ?? now();
    const end = a.end ?? start + 1;
    const tr = ctx.doc.animation.tracks.find((t) => t.target === tid && t.property === a.property);
    const from = a.from ?? (tr ? A.sample(tr, start) : baseValue(a.target, a.property));
    let to = a.to;
    if (a.by !== undefined) to = Array.isArray(from) ? from.map((x, k) => x + a.by[k]) : from + a.by;
    if (to === undefined) throw new Error('Give `to` or `by`.');
    A.setKey(ctx.doc, tid, a.property, start, from);
    A.setKey(ctx.doc, tid, a.property, end, to, a.ease || 'ease-in-out');
    return { target: tid, property: a.property, start, end, from, to };
  }, true);

  def('animate', 'build_sequence', 'Construction / assembly sequence: entities appear one after another (4D-style). Order: as given, or bottom-up.', obj({ ids, effect: str('how each piece arrives', ['rise', 'drop', 'grow', 'fade', 'slide']), order: str('given | bottom-up | top-down', ['given', 'bottom-up', 'top-down']), start: num('seconds, default 0'), duration: num('per piece, default 0.8'), stagger: num('delay between pieces, default 0.4'), distance: num('travel for rise/drop/slide, default 3') }), (a) => {
    const doc = ctx.doc;
    let ents = targets(ctx, a);
    if (a.order === 'bottom-up' || a.order === 'top-down') {
      ents = [...ents].sort((x, y) => D.worldBox(doc, x).min[1] - D.worldBox(doc, y).min[1]);
      if (a.order === 'top-down') ents.reverse();
    }
    const { effect = 'rise', start = 0, duration = 0.8, stagger = 0.4, distance = 3 } = a;
    ents.forEach((e, i) => {
      const t0 = start + i * stagger;
      const t1 = t0 + duration;
      const off = { rise: [0, -distance, 0], drop: [0, distance, 0], slide: [-distance, 0, 0] }[effect];
      A.setKey(doc, e.id, 'visible', 0, false, 'step');
      A.setKey(doc, e.id, 'visible', t0, true, 'step');
      if (off) {
        A.setKey(doc, e.id, 'position', t0, G.add(e.position, off), 'linear');
        A.setKey(doc, e.id, 'position', t1, e.position, effect === 'drop' ? 'bounce' : 'ease-out');
      } else if (effect === 'grow') {
        A.setKey(doc, e.id, 'scale', t0, [e.scale[0], 0.001, e.scale[2]], 'linear');
        A.setKey(doc, e.id, 'scale', t1, e.scale, 'back');
      } else {
        A.setKey(doc, e.id, 'opacity', t0, 0, 'linear');
        A.setKey(doc, e.id, 'opacity', t1, e.material.opacity, 'ease-out');
      }
    });
    const endT = start + (ents.length - 1) * stagger + duration;
    doc.animation.duration = Math.max(doc.animation.duration, Math.ceil(endT + 1));
    return { pieces: ents.map((e) => e.id), ends: endT };
  }, true);

  def('animate', 'turntable', 'Camera orbit around the model (or a point) for a presentation reel.', obj({ start: num('s, default 0'), duration: num('s, default 8'), turns: num('default 1'), center: v3('orbit centre, default model centre'), radius: num('m, default: fits the model'), height: num('camera height, default: current') }), (a) => {
    const doc = ctx.doc;
    const tops = doc.entities.filter((e) => !e.parent);
    const b = tops.length ? D.unionBox(tops.map((e) => D.worldBox(doc, e))) : { min: [-1, 0, -1], max: [1, 1, 1] };
    const c = a.center || b.min.map((x, k) => (x + b.max[k]) / 2);
    const r = a.radius || Math.max(4, G.len(G.sub(b.max, b.min)) * 1.3);
    const cam = ctx.view?.getCamera() ?? doc.camera;
    const h = a.height ?? Math.max(cam.position[1], c[1] + r * 0.45);
    const { start = 0, duration = 8, turns = 1 } = a;
    const steps = Math.max(8, Math.round(24 * turns));
    const a0 = Math.atan2(cam.position[2] - c[2], cam.position[0] - c[0]);
    for (let i = 0; i <= steps; i++) {
      const t = start + (duration * i) / steps;
      const ang = a0 + (i / steps) * turns * Math.PI * 2;
      A.setKey(doc, 'camera', 'position', t, D.round3([c[0] + r * Math.cos(ang), h, c[2] + r * Math.sin(ang)]), 'linear');
    }
    A.setKey(doc, 'camera', 'target', start, D.round3(c), 'linear');
    A.setKey(doc, 'camera', 'target', start + duration, D.round3(c), 'linear');
    doc.animation.duration = Math.max(doc.animation.duration, Math.ceil(start + duration));
    return { center: c, radius: r, start, end: start + duration };
  }, true);

  def('animate', 'remove_keyframes', 'Remove keyframes of a target (all, one property, or at one time).', obj({ target: str('entity id/name or "camera"'), property: str('optional'), time: num('optional seconds') }, ['target']), (a) => {
    A.removeKeys(ctx.doc, targetId(a.target), a.property || null, a.time ?? null);
    return { tracks: ctx.doc.animation.tracks.length };
  }, true);

  def('animate', 'set_timeline', 'Timeline length and frame rate.', obj({ duration: num('seconds'), fps: num('frames per second') }), (a) => {
    Object.assign(ctx.doc.animation, Object.fromEntries(Object.entries(a).filter(([, v]) => v > 0)));
    return { duration: ctx.doc.animation.duration, fps: ctx.doc.animation.fps };
  }, true);

  def('animate', 'get_animation', 'All animation tracks and keyframes.', obj({}), () => ctx.doc.animation);

  def('animate', 'playback', 'Play, pause, stop or seek the timeline.', obj({ action: str('play | pause | stop | seek', ['play', 'pause', 'stop', 'seek']), time: num('seconds for seek') }, ['action']), (a) => {
    const tl = ctx.timeline;
    if (!tl) throw new Error('No timeline in this context.');
    if (a.action === 'seek') tl.seek(a.time ?? 0);
    else tl[a.action]();
    return { time: tl.time, playing: tl.playing };
  });

  // ---------------------------------------------------------------- file
  const needIO = () => {
    if (!ctx.io) throw new Error('File commands need the desktop app.');
    return ctx.io;
  };
  def('file', 'save', 'Save the model as .glb (geometry + materials + animation; reopens with full editability). Without path it asks.', obj({ path: str('absolute .glb path') }), (a) => needIO().save(a.path));
  def('file', 'open', 'Open a .glb/.gltf (MyModellerReel files reopen fully editable).', obj({ path: str('absolute path') }), (a) => needIO().open(a.path));
  def('file', 'import', 'Insert a model file (glb, gltf, obj, stl, fbx) into the current model.', obj({ path: str('absolute path') }), (a) => needIO().importModel(a.path));
  def('file', 'export', 'Export: glb, gltf, obj, stl, png (viewport image) or video (renders the timeline to mp4/webm).', obj({ format: str('format', ['glb', 'gltf', 'obj', 'stl', 'png', 'video']), path: str('absolute output path; omit to be asked') }, ['format']), (a) => needIO().exportAs(a.format, a.path));

  // ---------------------------------------------------------------- extend
  def('extend', 'run_script', 'Run JavaScript against the API as ONE undo step. Inside: `await api.create_box({...})` (every command is a function), `api.doc` (the model JSON), `api.geometry`. Return a value to see it.', obj({ code: str('async JavaScript body') }, ['code']), async (a) => {
    const api = new Proxy(
      { doc: ctx.doc, geometry: G, run: (n, x) => reg.run(n, x) },
      { get: (o, k) => (k in o ? o[k] : typeof k === 'symbol' || k === 'then' ? undefined : (x) => reg.run(k, x)) },
    );
    const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
    if (!ctx.batchDepth) ctx.store.checkpoint();
    ctx.batchDepth = (ctx.batchDepth || 0) + 1;
    try {
      return { result: (await new AsyncFn('api', a.code)(api)) ?? null };
    } finally {
      ctx.batchDepth--;
      ctx.store.changed();
    }
  });

  def('extend', 'create_plugin', 'Write and load a plugin that adds new commands (and toolbar buttons) permanently. code is an ES module: export default function (mmr) { mmr.registerCommand({ name, description, params, run: async (args, mmr) => ... }) }', obj({ name: str('file name, letters/digits/-'), code: str('ES module source') }, ['name', 'code']), (a) => {
    if (!ctx.plugins) throw new Error('Plugins need the desktop app.');
    if (!/^[\w-]{1,60}$/.test(a.name)) throw new Error('Plugin name: letters, digits, - or _ only.');
    return ctx.plugins.create(a.name, a.code);
  });

  def('extend', 'list_plugins', 'Plugins loaded and the commands they added.', obj({}), () => ctx.plugins?.list() ?? []);
}
