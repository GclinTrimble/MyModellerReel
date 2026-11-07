// The command registry: the one API surface of MyModellerReel.
// Toolbar buttons, menus, the in-app AI, the HTTP API, the MCP server and plugins all call these commands,
// so anything a person can do, an AI can do, and anything a plugin adds, an AI can call.
import { Matrix4, Vector3, Quaternion } from 'three';
import * as G from './geometry.js';
import * as C from './curves.js';
import * as P from './profiles.js';
import * as R from './derived.js';
import { booleanMeshes } from './csg.js';
import { quantities, toCsv } from './quantities.js';
import { reviewChecks, reviewStats } from './review.js';
import { SKILLS, skillPrompt } from './skills.js';
import * as Topo from './topology.js';
import * as Comp from './components.js';
import * as D from './document.js';
import * as A from './animation.js';
import * as Q from './query.js';
import { validate } from './schema.js';
import { rankCommands, EXAMPLES, TOOLSETS } from './routing.js';

export const GUIDE = `MyModellerReel conventions:
- Units are metres. Y is UP (blue axis). X is red (right), Z is green (towards the viewer). Ground is y = 0.
- Every shape has a pivot ("origin"); new primitives have it at the centre of their base, so position [x,0,z] puts them ON the ground.
- Entities are referenced by id ("e12") or by exact name ("Front door"). Omitting ids uses the current selection.
- Groups hold children; a child's position/rotation/scale are relative to its group.
- push_pull faces are chosen by index or by direction: top, bottom, left(-x), right(+x), back(-z), front(+z).
- Animation: keyframes per property on a timeline in seconds. Use animate for a from→to move, build_sequence for
  construction / assembly sequences, turntable for a camera orbit, add_keyframe to capture the current pose.
  To hinge a door: set_pivot (e.g. "left") then animate rotation.
- Sequencing: add_marker names a moment; every time parameter then takes it ("roof", "roof + 1.5"). add_caption puts
  titles and lower thirds in the video; add_motion adds spin/oscillate/wiggle/orbit/pulse without keys; explode,
  animate_along_path (a curve) and stagger (offsets starts by height, distance, name…) do the choreography.
  render_video renders the timeline frame by frame (mp4, webm, gif, png).
- Place things by relation, not coordinates: place_on (on top of / against a face), against (beside, same floor),
  stack, align, distribute; find_free_space gives an empty spot for a new footprint.
- Ask instead of reading JSON: select_where (by name, colour, tag, size, metadata, similar_to), bounds_of, raycast,
  measure, what_is_at (a point of the screenshot). set_metadata attaches role/cost/phase data to entities.
- Parametric: create_* shapes keep their parameters (set_params changes them later; get_entity shows the recipe).
  sweep runs a profile (list_profiles: pipe, kerb, gutter, i_beam, retaining_wall…) along a path; a sweep along a
  curve entity stays live, so editing the curve updates it. bake freezes a parametric shape.
- create_curve makes paths (polyline, smooth spline, bezier) for sweeps and motion.
- Recipes: save_recipe keeps how the model was built (with {{param}} placeholders); replay_recipe rebuilds it with
  other values. record_macro / stop_macro turn what was just done into a recipe or a plugin command.
- Modelling depth: imprint an outline on a face (or offset_face to inset it), then push_pull it into a recess,
  a boss or a hole; move_elements moves a face, edge ("top front") or corner; repair_mesh cleans imports; create_arc.
  make_component links copies: edit any instance's parts (edit_component) and every instance follows.
- Insight: report_quantities (count, area, volume, length, cost by material, tag or metadata), review_model (floating
  parts, collisions, scale errors, plus a vision critique), list_skills / use_skill (domain know-how).
- list_commands with a query ("hinge a door") finds the right command when you are unsure.
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
      commands.set(spec.name, { category: 'plugin', params: obj({}), journal: !!spec.mutates, ...spec });
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
      if (!c) {
        const near = rankCommands(reg.list(), { query: String(name).replace(/_/g, ' '), limit: 3 }).map((x) => x.name);
        throw new Error(`Unknown command "${name}".${near.length ? ` Did you mean ${near.join(', ')}?` : ''} Call list_commands with a query to find commands.`);
      }
      args = validate(name, c.params, args);
      // The journal records what built the model (for recipes and macros). A command that acts on "the selection"
      // keeps it implicit when the previous recorded step made that selection (so a replay with other parameters acts on
      // what the replay made), and records the ids when the selection was made by hand.
      const record = c.journal && !ctx.scriptDepth;
      const sel = ctx.selection.get();
      const handPicked = JSON.stringify(sel) !== ctx.journalSel;
      const recArgs = record && c.params.properties?.ids && args.ids === undefined && handPicked ? { ...args, ids: [...sel] } : args;
      const own = c.mutates && !ctx.batchDepth;
      // a compound command (script, recipe, plugin command) is all or nothing inside a batch too
      const snap = !own && c.compound ? JSON.stringify(ctx.doc) : null;
      if (own) ctx.store.checkpoint();
      if (c.compound) (ctx.batchDepth = (ctx.batchDepth || 0) + 1), (ctx.scriptDepth = (ctx.scriptDepth || 0) + 1);
      let result;
      try {
        result = await c.run(args, ctx);
        if (c.mutates) R.rebuildDerived(ctx.doc), Comp.syncComponents(ctx.doc);
      } catch (e) {
        if (own) ctx.store.rollback(); // a command either happens whole or not at all
        else if (snap) ctx.store.doc = JSON.parse(snap);
        throw e;
      } finally {
        if (c.compound) ctx.batchDepth--, ctx.scriptDepth--;
      }
      if (record) {
        journal(ctx.doc, name, recArgs);
        ctx.macro?.steps.push({ command: name, args: structuredClone(recArgs) });
        ctx.journalSel = JSON.stringify(ctx.selection.get());
      }
      if (own) ctx.store.changed();
      for (const fn of ctx.afterRun || []) fn(name, args, result);
      return result ?? { ok: true };
    },
  };
  registerCore(reg, ctx);
  return reg;
}

const JOURNAL_MAX = 2000;
function journal(doc, command, args) {
  (doc.journal ||= []).push({ command, args: structuredClone(args) });
  if (doc.journal.length > JOURNAL_MAX) doc.journal.splice(0, doc.journal.length - JOURNAL_MAX);
}

/** Fill "{{expr}}" placeholders in recipe arguments from params (a whole-string placeholder keeps its type). */
function fillParams(v, params) {
  const keys = Object.keys(params);
  const calc = (expr) => {
    try {
      return new Function(...keys, `return (${expr});`)(...keys.map((k) => params[k]));
    } catch (e) {
      throw new Error(`Recipe placeholder {{${expr}}}: ${e.message}`);
    }
  };
  if (typeof v === 'string') {
    const whole = v.match(/^\{\{(.+?)\}\}$/s);
    if (whole) return calc(whole[1]);
    return v.replace(/\{\{(.+?)\}\}/gs, (_, x) => String(calc(x)));
  }
  if (Array.isArray(v)) return v.map((x) => fillParams(x, params));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillParams(x, params)]));
  return v;
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;
/** A time parameter: seconds, or a marker name with an optional offset ("roof", "roof + 1.5"). */
const T = (d) => ({ description: `${d}: seconds, or a marker name ("roof", "roof + 1.5")` });

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
    ...(e.curve
      ? { color: e.material.color, kind: e.curve.kind, points: e.curve.points.length, length: r4(C.polyLength(D.curvePoints(doc, e))) }
      : e.mesh
        ? { color: e.material.color, faces: e.mesh.f.length }
        : { children: D.childrenOf(doc, e.id).length }),
    ...(e.component ? { component: e.component } : {}),
    ...(e.derived ? { generator: e.derived.generator, ...(e.derived.error ? { error: e.derived.error } : {}) } : {}),
    ...(e.material.opacity < 1 ? { opacity: e.material.opacity } : {}),
    ...(e.tag !== 'Untagged' ? { tag: e.tag } : {}),
    ...(!e.visible ? { visible: false } : {}),
    ...(e.locked ? { locked: true } : {}),
    ...(e.meta && Object.keys(e.meta).length ? { meta: e.meta } : {}),
  };
}

/** Add a shape. derived = [generator, params]: a parametric shape built (and later rebuilt) by that generator. */
function place(ctx, mesh, args, defaults = {}, derived = null) {
  const doc = ctx.doc;
  if (args.parent) D.resolve(doc, args.parent);
  if (derived) mesh = R.getGenerator(derived[0]).run({ params: derived[1], inputs: [], doc }).mesh; // bad parameters throw before anything changes
  const e = D.addEntity(doc, {
    name: args.name || D.uniqueName(doc, defaults.name),
    mesh,
    ...(derived ? { derived: { generator: derived[0], inputs: [], params: derived[1] } } : {}),
    position: args.position || [0, 0, 0],
    rotation: args.rotation || [0, 0, 0],
    parent: args.parent ? D.resolve(doc, args.parent)[0].id : null,
    tag: args.tag || 'Untagged',
    material: args.color ? { color: args.color } : {},
  });
  if (derived) R.regenerate(doc, e);
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
  if (!e.mesh) throw new Error(`${e.name} is a ${e.type}; push_pull works on shapes.`);
  if (typeof face === 'string' && /^\d+$/.test(face)) face = +face;
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

const worldMesh = D.worldMesh;

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

  def('scene', 'get_entity', 'Full detail of one entity, including every face (index, world normal, centre, area) for push_pull, a curve\'s world points, and a parametric shape\'s recipe (generator, inputs, params).', obj({ id }, ['id']), ({ id: ref }) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, ref);
    return {
      ...summary(doc, e),
      material: e.material,
      curve: e.curve ? { kind: e.curve.kind, closed: !!e.curve.closed, points: e.curve.points.map((p) => D.round3(new Vector3(...p).applyMatrix4(D.worldMatrix(doc, e)).toArray())) } : undefined,
      derived: e.derived ? { generator: e.derived.generator, inputs: e.derived.inputs, params: e.derived.params, ...(e.derived.error ? { error: e.derived.error } : {}) } : undefined,
      faces: e.mesh ? e.mesh.f.slice(0, 300).map((_, fi) => worldFaceInfo(doc, e, fi)) : undefined,
      children: e.mesh ? undefined : D.childrenOf(doc, e.id).map((c) => summary(doc, c)),
      volume: e.mesh ? Math.round(G.volume(e.mesh) * e.scale.reduce((a, b) => a * b) * 1e4) / 1e4 : undefined,
      tracks: doc.animation.tracks.filter((t) => t.target === e.id),
    };
  });

  def('scene', 'list_commands', 'Commands with their parameters (JSON Schema) and an example call. Narrow it: query ranks commands by what you want to do ("put a lamp on the table"), toolset picks a group.', obj({ query: str('what you want to do, in words'), toolset: str('a named group of commands', Object.keys(TOOLSETS)), category: str('only this category'), limit: num('at most this many') }), ({ query, toolset, category, limit }) =>
    rankCommands(reg.list().filter((c) => !category || c.category === category), { query, toolset, limit })
      .map((c) => (EXAMPLES[c.name] ? { ...c, example: EXAMPLES[c.name] } : c)),
  );

  def('scene', 'select', 'Set, extend or clear the selection. Returns the selection.', obj({ ids, mode: str('set (default), add, remove, all, none, invert', ['set', 'add', 'remove', 'all', 'none', 'invert']) }), ({ ids: refs = [], mode = 'set' }) => {
    const doc = ctx.doc;
    const want = D.resolve(doc, refs).map((e) => e.id);
    const cur = ctx.selection.get();
    const next =
      mode === 'all' ? doc.entities.filter((e) => !e.parent).map((e) => e.id)
      : mode === 'invert' ? doc.entities.filter((e) => !e.parent && !cur.includes(e.id)).map((e) => e.id)
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
    return place(ctx, null, a, { name: 'Box' }, ['box', { width: a.width, height: a.height, depth: a.depth }]);
  }, true);

  def('create', 'create_cylinder', 'Upright cylinder sitting on its base.', obj({ radius: num('m'), height: num('m'), segments: num('default 32'), ...common }, ['radius', 'height']), (a) => {
    sizeErr(a.radius, a.height);
    return place(ctx, null, a, { name: 'Cylinder' }, ['cylinder', { radius: a.radius, height: a.height, segments: a.segments || 32 }]);
  }, true);

  def('create', 'create_cone', 'Upright cone on its base.', obj({ radius: num('m'), height: num('m'), segments: num('default 32'), ...common }, ['radius', 'height']), (a) => {
    sizeErr(a.radius, a.height);
    return place(ctx, null, a, { name: 'Cone' }, ['cone', { radius: a.radius, height: a.height, segments: a.segments || 32 }]);
  }, true);

  def('create', 'create_sphere', 'Sphere resting on the ground at position.', obj({ radius: num('m'), segments: num('default 32'), ...common }, ['radius']), (a) => {
    sizeErr(a.radius);
    return place(ctx, null, a, { name: 'Sphere' }, ['sphere', { radius: a.radius, segments: a.segments || 32 }]);
  }, true);

  def('create', 'create_prism', 'Extrude a 2D outline drawn on the ground. points are [x, z] pairs relative to position; height 0 gives a flat face you can push_pull later.', obj({ points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '[[x,z],...] at least 3' }, height: num('m, default 0'), ...common }, ['points']), (a) => {
    if (a.points.length < 3) throw new Error('Need at least 3 points.');
    return place(ctx, null, a, { name: a.height ? 'Prism' : 'Face' }, ['prism', { points: a.points, height: a.height || 0 }]);
  }, true);

  def('create', 'create_face', 'A flat face from 3+ coplanar world points (walls, roofs, any plane). push_pull it to give it thickness.', obj({ points: { type: 'array', items: v3('point'), description: '[[x,y,z],...]' }, normal: v3('which side is the front (push_pull outwards). Default: up for horizontal faces'), name: common.name, color: common.color, tag: common.tag }, ['points']), (a) => {
    if (a.points.length < 3 || !G.isPlanar(a.points, 1e-3)) throw new Error('Need 3+ points on one plane.');
    const n = G.polygonNormal(a.points);
    const want = a.normal || (Math.abs(n[1]) > 0.99 ? [0, 1, 0] : n);
    const { mesh, origin } = G.recenter(G.flatFace(a.points, want));
    return place(ctx, mesh, { ...a, position: origin }, { name: 'Face' });
  }, true);

  def('create', 'create_lathe', 'Surface of revolution around the vertical axis: vases, columns, domes, bottles. profile is [radius, y] pairs bottom→top.', obj({ profile: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, segments: num('default 32'), ...common }, ['profile']), (a) =>
    place(ctx, null, a, { name: 'Lathe' }, ['lathe', { profile: a.profile, segments: a.segments || 32 }]), true);

  // ---------------------------------------------------------------- edit
  def('edit', 'push_pull', 'Push or pull a face along its normal (positive = outwards). Faces of prisms slide; other faces extrude new walls.', obj({ id, face: { description: 'face index, or top | bottom | left | right | front | back', default: 'top' }, distance: num('metres, negative pushes in') }, ['id', 'distance']), ({ id: ref, face = 'top', distance }) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, ref);
    const fi = pickFace(doc, e, face);
    R.bake(e); // hand edits end the parametric recipe
    const d = distance / (e.scale[0] || 1); // shortcut: assumes uniform scale
    // an imprinted face pushed all the way through the solid becomes a hole
    const n = G.faceNormal(e.mesh, fi);
    const c0 = G.dot(n, G.faceCenter(e.mesh, fi));
    const depth = Math.max(...e.mesh.v.map((p) => c0 - G.dot(n, p)));
    const imprinted = e.mesh.f.some((f, g) => g !== fi && G.dot(G.faceNormal(e.mesh, g), n) > 1 - 1e-6 && Math.abs(G.dot(n, e.mesh.v[f[0]]) - c0) < 1e-6 && f.some((i) => e.mesh.f[fi].includes(i)));
    if (d < 0 && imprinted && -d >= depth - 1e-6) {
      const pts = G.facePoints(e.mesh, fi).map((p) => G.add(p, G.scl(n, 0.01)));
      const cutter = G.extrude(G.flatFace(pts, n), 0, -(depth + 0.02));
      e.mesh = Topo.repairMesh(booleanMeshes('subtract', e.mesh, [G.orient(cutter)]), { closeHoles: false }).mesh;
    } else e.mesh = G.pushPull(e.mesh, fi, d);
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

  def('edit', 'duplicate', 'Copy entities. count copies, each shifted by offset and/or rotated by angle (degrees around Y through center): linear and radial arrays. live: one parametric array shape that follows the original when it changes.', obj({ ids, offset: v3('per copy, default [1,0,0]'), count: num('default 1'), angle: num('degrees per copy (radial array)'), center: v3('centre of the radial array, default [0,0,0]'), live: bool('one live array shape instead of separate copies (linear only)') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    const out = [];
    if (a.live) {
      if (a.angle) throw new Error('Live arrays are linear: use offset, not angle.');
      for (const e of ents) if (!e.mesh) throw new Error(`${e.name} is not a shape; live arrays copy shapes.`);
      for (const e of ents) {
        const params = { count: a.count || 1, offset: a.offset || [1, 0, 0] };
        R.getGenerator('array').run({ params, inputs: [e], doc });
        const c = D.addEntity(doc, { name: `${e.name} array`, material: { ...e.material }, tag: e.tag });
        R.derive(doc, c, 'array', params, [e.id]);
        out.push(c.id);
      }
      ctx.selection.set(out);
      return { created: out };
    }
    for (let k = 1; k <= (a.count || 1); k++)
      for (const e of ents) {
        const c = D.duplicateEntity(doc, e);
        c.name = `${e.name} ${k + 1}`;
        for (const x of [c, ...D.descendants(doc, c.id)]) if (x.derived && R.getGenerator(x.derived.generator)?.world) R.bake(x); // a copied sweep would snap back onto its path
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
    const ents = targets(ctx, a);
    for (const e of ents) if (!e.mesh) throw new Error(`${e.name} is not a shape; mirror the shapes themselves.`);
    for (const e of ents) {
      const b = D.worldBox(doc, e);
      const at = a.at ?? (b.min[k] + b.max[k]) / 2;
      const w = worldMesh(doc, e);
      w.v = w.v.map((p) => p.map((x, j) => (j === k ? 2 * at - x : x)));
      w.f = w.f.map((f) => [...f].reverse());
      const { mesh, origin } = G.recenter(w);
      const target = a.copy === false ? e : D.duplicateEntity(doc, e);
      R.bake(target);
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
    if (e.derived && R.getGenerator(e.derived.generator)?.world) R.bake(e);
    else if (e.derived) {
      // rebuilds keep the pivot; one named by words ("left") stays on that side when the shape is resized
      e.derived.offset = D.round3(G.sub(e.derived.offset || [0, 0, 0], L));
      if (typeof a.pivot === 'string') e.derived.pivot = a.pivot;
      else delete e.derived.pivot;
    }
    if (e.mesh) e.mesh = G.translate(e.mesh, G.scl(L, -1));
    if (e.curve) e.curve.points = e.curve.points.map((p) => G.sub(p, L));
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
    const { mesh, origin } = G.recenter(booleanMeshes(a.op, worldMesh(doc, t), tools.map((x) => worldMesh(doc, x))));
    R.bake(t);
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

  // ---------------------------------------------------------------- query (agents ask, instead of reading JSON)
  def('scene', 'select_where', 'Select by properties: name glob ("Window*") or /regex/, color, tag, type, size range, metadata values, or similar_to an entity. Filters combine (AND). Returns the matches.', obj({ name: str('glob with * or /regex/'), color: str('#rrggbb'), tag: str('tag name'), type: str('kind', ['mesh', 'group', 'curve']), min_size: num('largest dimension at least, m'), max_size: num('largest dimension at most, m'), metadata: obj({}, []), similar_to: str('entity id or name: same kind, face count and size within 10 %'), inside: str('search inside this group'), include_children: bool('also match shapes inside groups'), mode: str('set (default) | add | remove', ['set', 'add', 'remove']), invert: bool('select everything that does NOT match') }), (a) => {
    const doc = ctx.doc;
    let hits = Q.matchEntities(doc, a).map((e) => e.id);
    if (a.invert) {
      const pool = a.inside ? D.descendants(doc, D.resolve(doc, a.inside)[0].id) : a.include_children ? doc.entities : doc.entities.filter((e) => !e.parent);
      hits = pool.filter((e) => !hits.includes(e.id)).map((e) => e.id);
    }
    const cur = ctx.selection.get();
    const next = a.mode === 'add' ? [...new Set([...cur, ...hits])] : a.mode === 'remove' ? cur.filter((x) => !hits.includes(x)) : hits;
    ctx.selection.set(next);
    return { selection: next, count: next.length, names: next.slice(0, 50).map((x) => D.getEntity(doc, x)?.name) };
  });

  def('scene', 'bounds_of', 'World bounds of entities together: min, max, size and centre.', obj({ ids }), (a) => Q.boundsOf(ctx.doc, targets(ctx, a)));

  def('scene', 'raycast', 'Shoot a ray and report what it hits first (or all hits): entity, point, surface normal, distance. Use it to find the floor under a point or what blocks a line of sight.', obj({ origin: v3('start point'), direction: v3('direction, any length'), ids: { ...ids, description: 'only test these (default: every visible shape)' }, all: bool('every entity hit, nearest first'), max_distance: num('m') }, ['origin', 'direction']), (a) => {
    const hits = Q.raycast(ctx.doc, a.origin, a.direction, { ids: a.ids, all: a.all, maxDistance: a.max_distance ?? Infinity });
    return a.all ? { hits } : (hits[0] ?? { hit: null });
  });

  def('scene', 'find_free_space', 'Nearest empty spot on the ground for a footprint, so new things do not overlap old ones. Returns a position for create_*/move.', obj({ size: { type: 'array', items: { type: 'number' }, description: '[width (x), depth (z)] in m' }, like: str('or: use the footprint of this entity'), near: { type: 'array', items: { type: 'number' }, description: '[x, z] to search around, default [0, 0]' }, clearance: num('gap to keep, default 0.1 m') }), (a) => {
    const doc = ctx.doc;
    let size = a.size;
    let skip = [];
    if (a.like) {
      const [e] = D.resolve(doc, a.like);
      const b = D.worldBox(doc, e);
      size = [b.max[0] - b.min[0], b.max[2] - b.min[2]];
      skip = [e.id];
    }
    if (!size || size.length < 2 || !(size[0] > 0 && size[1] > 0)) throw new Error('Give size [width, depth] in metres, or like: an entity.');
    const near = a.near?.length === 3 ? [a.near[0], a.near[2]] : a.near || [0, 0];
    const position = Q.findFreeSpace(doc, size, { near, clearance: a.clearance ?? 0.1, skip });
    if (!position) throw new Error('No free space found within 100 m.');
    return { position, size };
  });

  def('scene', 'what_is_at', 'What is under a point of the viewport (as in the last screenshot): x and y are fractions 0..1 from the left and top. Returns entity, face and world point.', obj({ x: num('0 = left edge, 1 = right edge'), y: num('0 = top edge, 1 = bottom edge') }, ['x', 'y']), (a) => {
    if (!ctx.view?.pickAt) throw new Error('No viewport in this context; use raycast.');
    const hit = ctx.view.pickAt(a.x, a.y);
    if (!hit) return { hit: null };
    const e = D.getEntity(ctx.doc, hit.entityId);
    return { id: e.id, name: e.name, face: hit.faceIndex, point: D.round3(hit.point.toArray()), normal: D.round3(hit.normal.toArray()) };
  });

  def('edit', 'set_metadata', 'Attach key/values to entities (role: window, cost: 420, supplier, phase…). Drives select_where, quantities and 4D mapping. remove deletes keys.', obj({ ids, values: obj({}, []), remove: { type: 'array', items: { type: 'string' }, description: 'keys to delete' } }), (a) => {
    const ents = targets(ctx, a);
    for (const e of ents) {
      e.meta = { ...(e.meta || {}), ...(a.values || {}) };
      for (const k of a.remove || []) delete e.meta[k];
      if (!Object.keys(e.meta).length) delete e.meta;
    }
    return ents.map((e) => ({ id: e.id, name: e.name, meta: e.meta || {} }));
  }, true);

  // ---------------------------------------------------------------- arrange (relations instead of coordinates)
  const AXIS3 = str('world axis', ['x', 'y', 'z']);
  const shift = (ents, offsets) =>
    editTransforms(ctx, ents, () => ents.forEach((e, i) => offsets[i].some((x) => x) && applyWorld(ctx, e, new Matrix4().makeTranslation(...offsets[i]), [0, 0, 0])));
  const boxesOf = (ents) => ents.map((e) => D.worldBox(ctx.doc, e));
  const asPoint = (p) => (p ? (p.length === 2 ? [p[0], 0, p[1]] : p) : null);

  def('arrange', 'align', 'Line entities up on an axis: their min sides, centres or max sides meet. Reference: their joint bounds (default), the first or last one, or another entity.', obj({ ids, axis: AXIS3, to: str('which side lines up', ['min', 'center', 'max']), relative_to: str('selection (default) | first | last | an entity id/name') }, ['axis']), (a) => {
    const ents = targets(ctx, a);
    const boxes = boxesOf(ents);
    const rel = a.relative_to || 'selection';
    const ref = rel === 'selection' ? null : rel === 'first' ? boxes[0] : rel === 'last' ? boxes.at(-1) : D.worldBox(ctx.doc, D.resolve(ctx.doc, rel)[0]);
    shift(ents, Q.alignOffsets(boxes, a.axis, a.to || 'center', ref));
    return ents.map((e) => summary(ctx.doc, e));
  }, true);

  def('arrange', 'distribute', 'Space entities evenly along an axis (equal gaps, outer ones stay), or exactly gap metres apart.', obj({ ids, axis: AXIS3, gap: num('fixed gap in m (default: equal gaps between the outer two)') }, ['axis']), (a) => {
    const ents = targets(ctx, a);
    if (ents.length < 2) throw new Error('distribute needs at least two entities.');
    shift(ents, Q.distributeOffsets(boxesOf(ents), a.axis, a.gap ?? null));
    return ents.map((e) => summary(ctx.doc, e));
  }, true);

  def('arrange', 'place_on', 'Put entities on another one without coordinates: on its top (default) or against any side, centred on it or at a point. face can also be a face index from get_entity (snaps to that face).', obj({ ids, target: str('entity to put things on'), face: { description: 'top (default) | bottom | left | right | front | back, or a face index' }, at: { type: 'array', items: { type: 'number' }, description: 'world point on that face ([x,z] for top), default its centre' }, gap: num('m, default 0') }, ['target']), (a) => {
    const doc = ctx.doc;
    const [t] = D.resolve(doc, a.target);
    const ents = targets(ctx, a).filter((e) => e.id !== t.id);
    const plane = Q.targetFace(doc, t, a.face ?? 'top');
    shift(ents, ents.map((e) => Q.placeOffset(D.worldBox(doc, e), plane, { gap: a.gap || 0, at: asPoint(a.at) })));
    return ents.map((e) => summary(doc, e));
  }, true);

  def('arrange', 'against', 'Push entities flat against a side of another one, keeping their height (a sofa against a wall, a cabinet beside another).', obj({ ids, target: str('entity to stand against'), side: str('side of the target', ['left', 'right', 'front', 'back']), gap: num('m, default 0') }, ['target', 'side']), (a) => {
    const doc = ctx.doc;
    const [t] = D.resolve(doc, a.target);
    const ents = targets(ctx, a).filter((e) => e.id !== t.id);
    const plane = Q.targetFace(doc, t, a.side);
    shift(ents, ents.map((e) => Q.placeOffset(D.worldBox(doc, e), plane, { gap: a.gap || 0, keep: ['y'] })));
    return ents.map((e) => summary(doc, e));
  }, true);

  def('arrange', 'stack', 'Stack entities on top of each other in the given order, centred on the first one.', obj({ ids, gap: num('m between them, default 0') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    for (let i = 1; i < ents.length; i++) {
      const plane = Q.targetFace(doc, ents[i - 1], 'top');
      const c = Q.centerOf(D.worldBox(doc, ents[0]));
      plane.point = [c[0], plane.point[1], c[2]];
      shift([ents[i]], [Q.placeOffset(D.worldBox(doc, ents[i]), plane, { gap: a.gap || 0 })]);
    }
    return ents.map((e) => summary(doc, e));
  }, true);

  // ---------------------------------------------------------------- modelling depth: imprint, offset, repair, elements, arcs
  /** World points → an entity's local mesh space. */
  const toLocal = (e, pts) => {
    const inv = D.worldMatrix(ctx.doc, e).invert();
    return pts.map((p) => new Vector3(...p).applyMatrix4(inv).toArray());
  };
  const meshOf = (ref) => {
    const [e] = D.resolve(ctx.doc, ref);
    if (!e.mesh) throw new Error(`${e.name} is not a shape.`);
    return e;
  };

  def('edit', 'imprint', 'Draw a closed outline onto a face so push_pull can raise or sink just that part (a recess, a boss, or a hole when pushed all the way through) without a boolean. Give world points on the face, or a rectangle / circle centred on it.', obj({ id, face: { description: 'face index or top | bottom | left | right | front | back (default top)' }, points: { type: 'array', items: v3('point'), description: 'closed outline on the face, world [x,y,z]' }, shape: str('or a shape', ['rectangle', 'circle']), size: { type: 'array', items: { type: 'number' }, description: 'rectangle [width, depth] in m, in the face plane' }, radius: num('circle radius, m'), center: v3('shape centre on the face (default: face centre)'), segments: num('circle sides, default 32') }, ['id']), (a) => {
    const doc = ctx.doc;
    const e = meshOf(a.id);
    let fi = pickFace(doc, e, a.face ?? 'top');
    // "top" is the outermost top face; an outline drawn lower down (beside a boss) belongs to the face on its plane
    const anchor = a.points ? toLocal(e, a.points)[0] : a.center ? toLocal(e, [a.center])[0] : null;
    if (anchor && typeof (a.face ?? 'top') === 'string' && !/^\d+$/.test(a.face ?? '')) {
      const n0 = G.faceNormal(e.mesh, fi);
      const on = e.mesh.f.findIndex((f, g) => G.dot(G.faceNormal(e.mesh, g), n0) > 1 - 1e-6 && Math.abs(G.dot(n0, G.sub(anchor, e.mesh.v[f[0]]))) < 1e-4);
      if (on >= 0) fi = on;
    }
    let loop;
    if (a.points) loop = toLocal(e, a.points);
    else {
      if (!a.shape) throw new Error('Give points, or a shape (rectangle with size, circle with radius).');
      const n = G.faceNormal(e.mesh, fi);
      const c = a.center ? toLocal(e, [a.center])[0] : G.faceCenter(e.mesh, fi);
      const fr = Topo.planeFrame(n, c);
      const pts2 =
        a.shape === 'circle'
          ? Array.from({ length: a.segments || 32 }, (_, i) => [a.radius * Math.cos((i / (a.segments || 32)) * 2 * Math.PI), a.radius * Math.sin((i / (a.segments || 32)) * 2 * Math.PI)])
          : [[-a.size[0] / 2, -a.size[1] / 2], [a.size[0] / 2, -a.size[1] / 2], [a.size[0] / 2, a.size[1] / 2], [-a.size[0] / 2, a.size[1] / 2]];
      if (a.shape === 'circle' && !(a.radius > 0)) throw new Error('A circle needs a radius.');
      if (a.shape === 'rectangle' && !(a.size?.[0] > 0 && a.size?.[1] > 0)) throw new Error('A rectangle needs size [width, depth].');
      loop = pts2.map(fr.from);
    }
    const r = Topo.imprint(e.mesh, fi, loop);
    R.bake(e);
    e.mesh = r.mesh;
    return { ...summary(doc, e), face: r.face };
  }, true);

  def('edit', 'offset_face', 'Offset a face\'s outline in its plane: a positive distance insets it (window frames, sills: the inner face is then ready for push_pull), a negative one grows a lone flat face.', obj({ id, face: { description: 'face index or top | bottom | left | right | front | back (default top)' }, distance: num('m, positive = inset') }, ['id', 'distance']), (a) => {
    const doc = ctx.doc;
    const e = meshOf(a.id);
    const fi = pickFace(doc, e, a.face ?? 'top');
    if (!a.distance) throw new Error('distance must not be 0.');
    const loop = Topo.offsetFaceLoop(e.mesh, fi, a.distance);
    R.bake(e);
    if (a.distance > 0) {
      const r = Topo.imprint(e.mesh, fi, loop);
      e.mesh = r.mesh;
      return { ...summary(doc, e), face: r.face };
    }
    if (e.mesh.f.length !== 1) throw new Error('Outsetting works on a lone flat face; on a solid, inset instead.');
    e.mesh = G.flatFace(loop, G.faceNormal(e.mesh, 0));
    return { ...summary(doc, e), face: 0 };
  }, true);

  def('edit', 'repair_mesh', 'Clean shapes after imports and booleans: weld duplicate vertices, drop broken faces, fix flipped faces, merge coplanar triangles into single faces (so push_pull moves a whole face), close holes.', obj({ ids, tolerance: num('weld distance, m (default 0.00001)'), merge: bool('merge coplanar faces (default true)'), close_holes: bool('cap open edges (default true)') }), (a) => {
    const ents = targets(ctx, a).flatMap((e) => [e, ...D.descendants(ctx.doc, e.id)]).filter((e) => e.mesh);
    if (!ents.length) throw new Error('No shapes to repair.');
    return ents.map((e) => {
      const before = e.mesh.f.length;
      const r = Topo.repairMesh(e.mesh, { tol: a.tolerance || 1e-5, merge: a.merge !== false, closeHoles: a.close_holes !== false });
      R.bake(e);
      e.mesh = r.mesh;
      return { id: e.id, name: e.name, faces_before: before, faces: r.mesh.f.length, ...r.report };
    });
  }, true);

  /** Vertex indices named by words: one word = a face, two = an edge, three = a corner ("top front left"). */
  const verticesByWords = (e, words) => {
    const ws = String(words).toLowerCase().split(/[\s,]+/).filter(Boolean);
    const sets = ws.map((w) => new Set(e.mesh.f[pickFace(ctx.doc, e, w)]));
    const out = [...sets[0]].filter((i) => sets.every((s) => s.has(i)));
    if (!out.length) throw new Error(`"${words}" names no part of ${e.name}: those faces do not meet.`);
    return out;
  };
  def('scene', 'list_elements', 'The vertices (index, world point) and faces of a shape, for move_elements.', obj({ id }, ['id']), (a) => {
    const e = meshOf(a.id);
    const m = D.worldMatrix(ctx.doc, e);
    return { id: e.id, vertices: e.mesh.v.map((p, i) => ({ index: i, point: D.round3(new Vector3(...p).applyMatrix4(m).toArray()) })), faces: e.mesh.f.slice(0, 300).map((f, i) => ({ ...worldFaceInfo(ctx.doc, e, i), vertices: f })) };
  });
  def('edit', 'move_elements', 'Move part of a shape: a face, an edge or a corner (by words like "top", "top front", "top front left", or by index), or vertex indices from list_elements. Moving the top front edge up makes a roof slope. Faces that bend are split into triangles.', obj({ id, face: { description: 'face index or word' }, edge: { description: 'two face words ("top front") or [vertex, vertex]' }, vertex: { description: 'three face words ("top front left") or a vertex index' }, vertices: { type: 'array', items: { type: 'number' }, description: 'vertex indices' }, by: v3('world offset [dx,dy,dz]') }, ['id', 'by']), (a) => {
    const doc = ctx.doc;
    const e = meshOf(a.id);
    let ids = a.vertices;
    if (!ids && a.face !== undefined) ids = e.mesh.f[pickFace(doc, e, a.face)];
    if (!ids && a.edge !== undefined) ids = Array.isArray(a.edge) ? a.edge : verticesByWords(e, a.edge);
    if (!ids && a.vertex !== undefined) ids = typeof a.vertex === 'number' || /^\d+$/.test(a.vertex) ? [+a.vertex] : verticesByWords(e, a.vertex);
    if (!ids?.length) throw new Error('Say what to move: face, edge, vertex or vertices.');
    if (ids.some((i) => !e.mesh.v[i])) throw new Error(`${e.name} has vertices 0…${e.mesh.v.length - 1}.`);
    const inv = D.worldMatrix(doc, e).invert();
    const o = new Vector3(0, 0, 0).applyMatrix4(inv);
    const d = new Vector3(...a.by).applyMatrix4(inv).sub(o).toArray();
    R.bake(e);
    e.mesh = Topo.moveVertices(e.mesh, ids, d);
    return { ...summary(doc, e), moved: ids.length };
  }, true);

  def('create', 'create_arc', 'Arc as a curve (or a pie-shaped face): three_point (start, through, end), two_point (start, end, sagitta = bulge height), center (center, radius, start_angle, end_angle in degrees), tangent (continues a curve `from` smoothly, or leaves start along `direction`, to end).', obj({ kind: str('how it is given', ['three_point', 'two_point', 'center', 'tangent']), start: v3('start point'), through: v3('a point on the arc'), end: v3('end point'), sagitta: num('two_point: bulge height, m (sign = side)'), center: v3('centre'), radius: num('m'), start_angle: num('degrees'), end_angle: num('degrees'), normal: v3('plane of the arc (default up: on the ground)'), from: str('tangent: a curve to continue from its end'), direction: v3('tangent: direction at start'), segments: num('points along it (default by angle)'), pie: bool('close it through the centre into a flat face'), name: common.name, color: common.color }, ['kind']), (a) => {
    const doc = ctx.doc;
    let r;
    if (a.kind === 'three_point') r = C.arcThrough(a.start, a.through, a.end, a.segments);
    else if (a.kind === 'two_point') r = C.arcBulge(a.start, a.end, a.sagitta, a.normal, a.segments);
    else if (a.kind === 'center') r = C.arcCenter(a.center, a.radius, a.start_angle ?? 0, a.end_angle ?? 90, a.normal, a.segments);
    else {
      let start = a.start;
      let dir = a.direction;
      if (a.from) {
        const [c] = D.resolve(doc, a.from);
        if (!c.curve) throw new Error(`${c.name} is not a curve.`);
        const pts = D.curvePoints(doc, c);
        start = pts.at(-1);
        dir = G.sub(pts.at(-1), pts.at(-2));
      }
      if (!start || !dir || !a.end) throw new Error('tangent needs from (or start and direction) and end.');
      r = C.arcTangent(start, dir, a.end, a.segments);
    }
    if (!r || r.points.some((p) => p.some((x) => !Number.isFinite(x)))) throw new Error('Give the points this kind of arc needs.');
    if (a.pie) return reg.commands.get('create_face').run({ points: [r.center, ...r.points], name: a.name || D.uniqueName(doc, 'Pie'), color: a.color, normal: a.normal });
    const res = reg.commands.get('create_curve').run({ points: r.points.map(D.round3), kind: 'polyline', name: a.name || `Arc ${doc.entities.filter((x) => x.type === 'curve').length + 1}`, color: a.color });
    return { ...res, radius: r4(r.radius), center: D.round3(r.center), angle: r4((Math.abs(r.sweep) * 180) / Math.PI) };
  }, true);

  // ---------------------------------------------------------------- components (#38)
  def('edit', 'make_component', 'Turn entities into a component: they become one instance, and copies (duplicate, place_component) stay linked. Edit the parts of any instance and every instance updates.', obj({ ids, name: str('component name') }, ['name']), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a);
    if (ents.some((e) => e.component || e.compKey)) throw new Error('Already part of a component: make_unique first.');
    if (new Set(ents.map((e) => e.parent)).size > 1) throw new Error('Pick entities at one level (not some inside a group and some outside).');
    const b = D.unionBox(ents.map((e) => D.worldBox(doc, e)));
    const g = Comp.define(doc, a.name, ents, D.round3([(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2]));
    ctx.selection.set([g.id]);
    return { ...summary(doc, g), component: a.name, parts: D.descendants(doc, g.id).length };
  }, true);

  def('create', 'place_component', 'Place a new instance of a component.', obj({ name: str('component name'), position: common.position, rotation: common.rotation, parent: common.parent }, ['name']), (a) => {
    const g = Comp.instantiate(ctx.doc, a.name, { position: a.position || [0, 0, 0], rotation: a.rotation || [0, 0, 0], parent: a.parent ? D.resolve(ctx.doc, a.parent)[0].id : null });
    ctx.selection.set([g.id]);
    return summary(ctx.doc, g);
  }, true);

  def('edit', 'edit_component', 'The parts of a component instance, selected so they can be edited: any change to them (move, push_pull, set_material, adding or deleting parts) updates every instance.', obj({ id: str('an instance') }, ['id']), (a) => {
    const [g] = D.resolve(ctx.doc, a.id);
    if (!g.component) throw new Error(`${g.name} is not a component instance.`);
    const parts = D.childrenOf(ctx.doc, g.id).map((c) => c.id);
    ctx.selection.set(parts);
    ctx.onEditComponent?.(g.id);
    return { component: g.component, instance: g.id, instances: Comp.instancesOf(ctx.doc, g.component).length, parts: parts.map((x) => ({ id: x, name: D.getEntity(ctx.doc, x).name })) };
  });

  def('edit', 'make_unique', 'Unlink instances from their component: they get their own new component (or none with plain: true), so editing them no longer changes the others.', obj({ ids, name: str('new component name (default: "<name> 2")'), plain: bool('become plain groups instead') }), (a) => {
    const doc = ctx.doc;
    const insts = targets(ctx, a).filter((e) => e.component);
    if (!insts.length) throw new Error('None of them is a component instance.');
    const src = insts[0].component;
    let name = null;
    if (!a.plain) {
      name = a.name || D.uniqueName({ entities: Object.keys(doc.components).map((n) => ({ name: n })) }, src);
      if (doc.components[name]) throw new Error(`There is already a component "${name}".`);
      doc.components[name] = { parts: structuredClone(doc.components[src].parts) };
    }
    for (const g of insts) {
      if (name) g.component = name;
      else {
        delete g.component;
        for (const d of D.descendants(doc, g.id)) delete d.compKey;
      }
    }
    return { instances: insts.map((g) => g.id), component: name };
  }, true);

  def('edit', 'replace_component', 'Swap instances to another component (their place and turn stay).', obj({ ids, with: str('component to use') }, ['with']), (a) => {
    const doc = ctx.doc;
    if (!doc.components?.[a.with]) throw new Error(`No component "${a.with}".`);
    const insts = targets(ctx, a).filter((e) => e.component);
    if (!insts.length) throw new Error('None of them is a component instance.');
    for (const g of insts) {
      g.component = a.with;
      Comp.refill(doc, g);
    }
    return { replaced: insts.map((g) => g.id), with: a.with };
  }, true);

  def('scene', 'list_components', 'Components in the model: name, parts and how many instances.', obj({}), () =>
    Object.entries(ctx.doc.components || {}).map(([name, c]) => ({ name, parts: c.parts.length, instances: Comp.instancesOf(ctx.doc, name).map((g) => g.id) })),
  );

  // ---------------------------------------------------------------- curves, sweeps, profiles
  def('create', 'create_curve', 'A path in 3D for sweeps, motion paths and camera moves: polyline (straight legs), spline (smooth through every point) or bezier (point, handle, handle, point, …).', obj({ points: { type: 'array', items: v3('point'), description: '[[x,y,z], …] world points' }, kind: str('polyline (default) | spline | bezier', C.KINDS), closed: bool('loop back to the start'), name: common.name, color: common.color, tag: common.tag }, ['points']), (a) => {
    const doc = ctx.doc;
    const curve = { kind: a.kind || 'polyline', points: a.points, closed: !!a.closed };
    C.checkCurve(curve);
    const { mesh, origin } = G.recenter({ v: a.points, f: [] });
    const count = doc.entities.filter((e) => e.type === 'curve').length + 1;
    const e = D.addEntity(doc, { type: 'curve', name: a.name || `Curve ${count}`, curve: { ...curve, points: mesh.v }, position: D.round3(origin), tag: a.tag || 'Untagged', material: { color: a.color || '#2f6f86' } });
    ctx.selection.set([e.id]);
    return summary(doc, e);
  }, true);

  def('create', 'sweep', 'Sweep a profile along a path (Follow Me): pipes, kerbs, handrails, gutters, mouldings, beams, walls. path: a curve entity (the sweep stays live: edit the curve and it follows) or points. profile: a name from list_profiles with profile_params, or [[u, v], …] (u to the right of the travel direction, v up).', obj({ path: { description: 'curve id/name, or [[x,y,z], …]' }, profile: { description: 'profile name (default rectangle) or [[u, v], …]' }, profile_params: obj({}, []), anchor: str('which point of the profile follows the path (default: the profile\'s own)', P.ANCHORS), mirror: bool('flip the profile left-right'), name: common.name, color: common.color, tag: common.tag }, ['path']), (a) => {
    const doc = ctx.doc;
    const params = { profile: a.profile ?? 'rectangle', profile_params: a.profile_params || {}, ...(a.anchor ? { anchor: a.anchor } : {}), ...(a.mirror ? { mirror: true } : {}) };
    let path = a.path;
    if (typeof path === 'string' && path.trim().startsWith('[')) path = JSON.parse(path);
    let inputs = [];
    if (Array.isArray(path)) params.path = path;
    else {
      const [c] = D.resolve(doc, path);
      if (!c.curve) throw new Error(`${c.name} is not a curve. Make one with create_curve, or give path points.`);
      inputs = [c.id];
    }
    R.getGenerator('sweep').run({ params, inputs: inputs.map((x) => D.getEntity(doc, x)), doc }); // bad input throws before anything changes
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, `${typeof params.profile === 'string' ? params.profile.replace(/_/g, ' ') : 'Profile'} sweep`), tag: a.tag || 'Untagged', material: a.color ? { color: a.color } : {} });
    R.derive(doc, e, 'sweep', params, inputs);
    ctx.selection.set([e.id]);
    return summary(doc, e);
  }, true);

  def('edit', 'set_curve', 'Change a curve: new world points, kind or closed. Sweeps and motion along it follow.', obj({ id, points: { type: 'array', items: v3('point'), description: '[[x,y,z], …] world points' }, kind: str('polyline | spline | bezier', C.KINDS), closed: bool('loop') }, ['id']), (a) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, a.id);
    if (!e.curve) throw new Error(`${e.name} is not a curve.`);
    const inv = D.worldMatrix(doc, e).invert();
    const points = a.points ? a.points.map((p) => D.round3(new Vector3(...p).applyMatrix4(inv).toArray())) : e.curve.points;
    const next = { kind: a.kind ?? e.curve.kind, points, closed: a.closed ?? !!e.curve.closed };
    C.checkCurve(next);
    e.curve = next;
    return summary(doc, e);
  }, true);

  def('parametric', 'list_profiles', 'Profiles for sweep: built-in parametric ones (pipe, kerb, gutter, i_beam, retaining_wall…) with their parameters and defaults, plus this model\'s own.', obj({}), () => P.listProfiles(ctx.doc));

  def('parametric', 'define_profile', 'Save a profile for sweeps: from [u, v] points, or from a flat face (from_face) as it is drawn. Saved in the model.', obj({ name: str('profile name'), points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '[[u, v], …] u right, v up, metres' }, from_face: str('a flat face entity to take the outline from'), anchor: str('default insertion point', P.ANCHORS), description: str('what it is') }, ['name']), (a) => {
    const doc = ctx.doc;
    if (P.PROFILES[a.name]) throw new Error(`"${a.name}" is a built-in profile; choose another name.`);
    let pts = a.points;
    if (a.from_face) {
      const [f] = D.resolve(doc, a.from_face);
      if (!f.mesh || f.mesh.f.length !== 1) throw new Error(`${f.name} is not a single flat face.`);
      const w = D.worldMesh(doc, f);
      const n = G.faceNormal(w, 0);
      const u = Math.abs(n[1]) > 0.99 ? [1, 0, 0] : G.norm(G.cross([0, 1, 0], n));
      const v = G.cross(n, u);
      const c = G.faceCenter(w, 0);
      pts = G.facePoints(w, 0).map((p) => [r4(G.dot(G.sub(p, c), u)), r4(G.dot(G.sub(p, c), v))]);
    }
    if (!pts || pts.length < 3) throw new Error('Give points (at least 3) or from_face.');
    if (P.area2d(pts) < 0) pts = [...pts].reverse();
    (doc.profiles ||= {})[a.name] = { points: pts, ...(a.anchor ? { anchor: a.anchor } : {}), ...(a.description ? { description: a.description } : {}) };
    return { name: a.name, points: pts.length };
  }, true);

  def('parametric', 'set_params', 'Change a parametric shape\'s parameters (width of a box, steps of a stair, profile of a sweep, count of a live array…); it rebuilds, and so does everything made from it. get_entity shows the current params.', obj({ id, params: obj({}, []) }, ['id', 'params']), (a) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, a.id);
    if (!e.derived) throw new Error(`${e.name} has no parameters (it is a plain shape or was baked). Parametric: create_* shapes, sweeps, live arrays, plugin objects.`);
    const gen = R.getGenerator(e.derived.generator);
    if (!gen) throw new Error(`The generator "${e.derived.generator}" is not loaded (a plugin may be missing).`);
    const unknown = Object.keys(a.params).filter((k) => !(k in gen.params));
    if (unknown.length) throw new Error(`${e.derived.generator} has no parameter ${unknown.join(', ')}. Parameters: ${Object.keys(gen.params).join(', ')}.`);
    const before = e.derived.params;
    e.derived.params = { ...before, ...a.params };
    try {
      R.regenerate(doc, e);
    } catch (err) {
      e.derived.params = before;
      throw err;
    }
    return { ...summary(doc, e), params: e.derived.params };
  }, true);

  def('parametric', 'list_generators', 'Generators of parametric shapes (built in and from plugins) with their parameters, for create_parametric and set_params.', obj({}), () => R.listGenerators());

  def('parametric', 'create_parametric', 'Make a parametric shape from any generator (list_generators), e.g. one a plugin adds. Its parameters stay editable with set_params.', obj({ generator: str('generator name'), params: obj({}, []), inputs: { ...ids, description: 'entities it is made from (for generators that take inputs)' }, ...common }, ['generator']), (a) => {
    const doc = ctx.doc;
    const gen = R.getGenerator(a.generator);
    if (!gen) throw new Error(`No generator "${a.generator}". Generators: ${R.listGenerators().map((g) => g.name).join(', ')}.`);
    const params = a.params || {};
    const unknown = Object.keys(params).filter((k) => !(k in gen.params));
    if (unknown.length) throw new Error(`${a.generator} has no parameter ${unknown.join(', ')}. Parameters: ${Object.keys(gen.params).join(', ')}.`);
    const inputs = a.inputs ? D.resolve(doc, a.inputs).map((e) => e.id) : [];
    if (!gen.world && !inputs.length) return place(ctx, null, a, { name: a.generator.replace(/_/g, ' ') }, [a.generator, params]);
    gen.run({ params, inputs: inputs.map((x) => D.getEntity(doc, x)), doc });
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, a.generator.replace(/_/g, ' ')), tag: a.tag || 'Untagged', material: a.color ? { color: a.color } : {} });
    R.derive(doc, e, a.generator, params, inputs);
    ctx.selection.set([e.id]);
    return summary(doc, e);
  }, true);

  def('parametric', 'get_dependencies', 'How a parametric shape is made and what is made from it: its recipe, its inputs and its dependents.', obj({ id }, ['id']), (a) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, a.id);
    const named = (ids) => ids.map((x) => ({ id: x, name: D.getEntity(doc, x)?.name ?? '(deleted)' }));
    return {
      id: e.id,
      recipe: e.derived ? { generator: e.derived.generator, params: e.derived.params } : null,
      inputs: named(e.derived?.inputs || []),
      dependents: named(R.dependentsOf(doc, e.id)),
      ...(e.derived?.error ? { error: e.derived.error } : {}),
    };
  });

  def('parametric', 'bake', 'Freeze parametric shapes into plain ones: they keep their geometry and stop following parameters and inputs.', obj({ ids }), (a) => {
    const ents = targets(ctx, a).filter((e) => e.derived);
    for (const e of ents) R.bake(e);
    return { baked: ents.map((e) => e.id) };
  }, true);

  // ---------------------------------------------------------------- recipes and macros
  def('recipe', 'save_recipe', 'Save how this model was built as a named, replayable recipe. Without steps it takes the commands that built the current model (from step `from`). Steps may hold "{{expr}}" placeholders over params (e.g. "{{storeys * 3}}"); run_script steps also get `params`.', obj({ name: str('recipe name'), description: str('what it builds'), params: obj({}, []), steps: { type: 'array', items: obj({ command: str('command name'), args: obj({}, []) }, ['command']), description: '[{command, args}, …] (default: the journal)' }, from: num('first journal step (default 0)') }, ['name']), (a) => {
    const doc = ctx.doc;
    const old = doc.recipes?.[a.name];
    const steps = (a.steps ? structuredClone(a.steps) : (doc.journal || []).slice(a.from || 0).map((s) => structuredClone(s))).flatMap((s) =>
      s.command === 'replay_recipe' && s.args?.name === a.name ? (old ? structuredClone(old.steps) : []) : [s],
    );
    if (!steps.length) throw new Error('Nothing to save: no steps given and the journal is empty.');
    for (const s of steps) if (!reg.commands.has(s.command)) throw new Error(`Step "${s.command}" is not a command.`);
    const params = a.params || old?.params || {};
    (doc.recipes ||= {})[a.name] = { description: a.description || old?.description || '', params, steps };
    return { name: a.name, steps: steps.length, params };
  }, true);
  reg.commands.get('save_recipe').journal = false;

  def('recipe', 'list_recipes', 'Recipes saved in this model (name, description, params, step count); give name for one recipe in full.', obj({ name: str('one recipe in full') }), (a) => {
    const all = ctx.doc.recipes || {};
    if (a.name) {
      if (!all[a.name]) throw new Error(`No recipe "${a.name}". Recipes: ${Object.keys(all).join(', ') || 'none'}.`);
      return { name: a.name, ...all[a.name] };
    }
    return Object.entries(all).map(([name, r]) => ({ name, description: r.description, params: r.params, steps: r.steps.length }));
  });

  def('recipe', 'replay_recipe', 'Rebuild from a recipe with other parameter values ("3 storeys instead of 2"). clear (default true) starts from an empty model. One undo step.', obj({ name: str('recipe name'), params: obj({}, []), clear: bool('start from an empty model, default true') }, ['name']), async (a) => {
    const r = ctx.doc.recipes?.[a.name];
    if (!r) throw new Error(`No recipe "${a.name}". Recipes: ${Object.keys(ctx.doc.recipes || {}).join(', ') || 'none'}.`);
    const params = { ...r.params, ...(a.params || {}) };
    if ((ctx.replaying ||= new Set()).has(a.name)) throw new Error(`The recipe "${a.name}" replays itself.`);
    if (a.clear !== false) {
      const keep = { recipes: ctx.doc.recipes, profiles: ctx.doc.profiles, settings: ctx.doc.settings, camera: ctx.doc.camera };
      ctx.store.doc = { ...D.newDoc(), ...structuredClone(keep) };
      ctx.selection.set([]);
    }
    ctx.replaying.add(a.name);
    try {
      for (const [i, s] of r.steps.entries()) {
        const args = fillParams(s.args || {}, params);
        if (s.command === 'run_script') args.params = { ...(args.params || {}), ...params };
        try {
          await reg.run(s.command, args);
        } catch (e) {
          throw new Error(`Recipe ${a.name}, step ${i + 1} (${s.command}): ${e.message}`);
        }
      }
    } finally {
      ctx.replaying.delete(a.name);
    }
    return { recipe: a.name, params, steps: r.steps.length, entities: ctx.doc.entities.length };
  }, true);
  reg.commands.get('replay_recipe').compound = true;

  def('recipe', 'record_macro', 'Start recording: everything done from now (tools, menus, AI, scripts) is captured until stop_macro.', obj({ name: str('macro name') }), (a) => {
    ctx.macro = { name: a.name || `Macro ${Object.keys(ctx.doc.recipes || {}).length + 1}`, steps: [] };
    ctx.onMacro?.(ctx.macro);
    return { recording: ctx.macro.name };
  });

  def('recipe', 'stop_macro', 'Stop recording and keep what was done: as a recipe (replay_recipe), and as a run_script snippet. as: plugin also writes a plugin command that replays it.', obj({ as: str('recipe (default) | plugin', ['recipe', 'plugin']), name: str('override the name') }), async (a) => {
    const m = ctx.macro;
    if (!m) throw new Error('Not recording. Call record_macro first.');
    ctx.macro = null;
    ctx.onMacro?.(null);
    const steps = m.steps;
    if (!steps.length) return { name: m.name, steps: 0, note: 'Nothing was recorded.' };
    const name = a.name || m.name;
    const script = steps.map((s) => `await api.${s.command}(${JSON.stringify(s.args)});`).join('\n');
    await reg.run('save_recipe', { name, steps, description: `Macro recorded ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` });
    let plugin;
    if (a.as === 'plugin') {
      if (!ctx.plugins) throw new Error('Plugins need the desktop app; the macro was saved as a recipe.');
      const cmd = `macro_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
      const code = `// Macro "${name}", recorded in MyModellerReel.\nexport default function (mmr) {\n  mmr.registerCommand({\n    name: ${JSON.stringify(cmd)},\n    description: ${JSON.stringify(`Replays the macro "${name}" (${steps.length} steps).`)},\n    params: { type: 'object', properties: {} },\n    run: (args, mmr) => mmr.run('run_script', { code: ${JSON.stringify(script)} }),\n  });\n}\n`;
      plugin = await ctx.plugins.create(cmd.replace(/_/g, '-'), code);
    }
    return { name, steps: steps.length, script, ...(plugin ? { plugin } : {}) };
  });

  // ---------------------------------------------------------------- insight: quantities, review, skills
  def('scene', 'report_quantities', 'Quantities: count, surface area (m²), volume (m³), length (m: curves and sweeps) and cost (metadata cost) per material, tag, metadata key, name or kind. "How many m³ of concrete?" format csv or a path writes a file.', obj({ group_by: { description: 'material (default) | tag | name | type | none | a metadata key (e.g. phase, or meta.phase)' }, ids: { ...ids, description: 'only these (default: the whole model)' }, include_hidden: bool('count hidden things too'), format: str('json (default) or csv', ['json', 'csv']), path: str('absolute .csv or .json path to write') }), async (a) => {
    const report = quantities(ctx.doc, { by: a.group_by || 'material', ids: a.ids, hidden: !!a.include_hidden });
    const csv = toCsv(report);
    const out = { ...report, rows: report.rows.map(({ ids: x, ...r }) => (x.length <= 50 ? { ...r, ids: x } : r)) };
    if (a.path) {
      if (!ctx.io?.writeText) throw new Error('Writing files needs the desktop app; omit path to get the numbers.');
      await ctx.io.writeText(a.path, /\.json$/i.test(a.path) ? JSON.stringify(out, null, 2) : csv);
      out.written = a.path;
    }
    if (a.format === 'csv') out.csv = csv;
    return out;
  });

  def('ai', 'review_model', 'Design review: finds floating parts, collisions, parts below the ground, unlikely sizes and broken parametric shapes; with a vision model it also critiques four views (iso, front, top, right). include_images returns the four views.', obj({ use_ai: bool('ask the vision model too (default true when one is set up)'), include_images: bool('return the four views as images'), views: bool('take the four screenshots (default true)') }), async (a) => {
    const doc = ctx.doc;
    const issues = reviewChecks(doc);
    const stats = reviewStats(doc);
    const out = { issues, stats };
    const images = ctx.view?.reviewShots && a.views !== false ? await ctx.view.reviewShots() : [];
    if (a.use_ai !== false && ctx.ai?.review && images.length) {
      try {
        out.critique = await ctx.ai.review({ images, issues, stats });
      } catch (e) {
        out.critique_error = e.message;
      }
    }
    if (a.include_images) out.images = images;
    return out;
  });

  def('ai', 'list_skills', 'Domain skills: know-how and example scripts for architecture, product design, jobsite / heavy equipment and furniture. Read one before working in that domain; use_skill gives it to the in-app copilot.', obj({ name: str('one skill in full', Object.keys(SKILLS)) }), (a) => {
    const pick = a.name ? [[a.name, SKILLS[a.name]]] : Object.entries(SKILLS);
    return pick.map(([name, s]) => ({ name, label: s.label, description: s.description, ...(a.name ? { prompt: s.prompt, examples: s.examples } : {}), active: ctx.skill === name }));
  });

  def('ai', 'use_skill', 'Give the in-app copilot a domain skill (its know-how joins the system prompt), or none.', obj({ name: str('skill, or none', [...Object.keys(SKILLS), 'none']) }, ['name']), (a) => {
    ctx.skill = a.name === 'none' ? null : a.name;
    ctx.onSkill?.(ctx.skill);
    return { skill: ctx.skill, prompt: ctx.skill ? skillPrompt(ctx.skill) : '' };
  });

  // ---------------------------------------------------------------- proposals (review AI changes before keeping them)
  def('edit', 'propose', 'Proposal mode. start: the next changes stay a ghost preview the user can accept or reject. accept keeps them, reject throws them away, status lists what is pending.', obj({ action: str('what to do', ['start', 'accept', 'reject', 'status']) }, ['action']), (a) => {
    const s = ctx.store;
    const was = s.proposalDiff();
    const ok = a.action === 'start' ? s.beginProposal() : a.action === 'accept' ? s.acceptProposal() : a.action === 'reject' ? s.rejectProposal() : true;
    const d = a.action === 'status' || a.action === 'start' ? s.proposalDiff() : was;
    if (a.action === 'reject' && ok) ctx.selection.set(ctx.selection.get().filter((x) => D.getEntity(ctx.doc, x)));
    return { action: a.action, done: !!ok, pending: !!s.proposal, ...(d ? { added: d.added, changed: d.changed, removed: d.removed, animation: d.animation } : {}) };
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
  const at = (v, fallback) => {
    const t = A.timeOf(ctx.doc, v, fallback);
    if (!(t >= 0)) throw new Error(`Times must be ≥ 0 seconds; got ${JSON.stringify(v)}.`);
    return t;
  };
  const baseValue = (target, property) => {
    if (target === 'camera') return (ctx.view?.getCamera() ?? ctx.doc.camera)[property];
    const [e] = D.resolve(ctx.doc, target);
    if (property === 'opacity' || property === 'color') return e.material[property];
    return e[property];
  };
  const targetId = (t) => (t === 'camera' ? 'camera' : D.resolve(ctx.doc, t)[0].id);
  const PROPS = ['position', 'rotation', 'scale', 'opacity', 'visible', 'color', 'target', 'fov'];

  def('animate', 'add_keyframe', 'Record a keyframe at a time. Without values it captures the current pose (position, rotation, scale), or for the camera its position and target.', obj({ target: str('entity id/name, or "camera"'), time: T('default: playhead'), values: obj({}, []), ease: str('ease into this key', Object.keys(A.EASES)) }, ['target']), (a) => {
    const tid = targetId(a.target);
    const t = at(a.time, now());
    const values = a.values && Object.keys(a.values).length ? a.values : Object.fromEntries((tid === 'camera' ? ['position', 'target'] : ['position', 'rotation', 'scale']).map((p) => [p, baseValue(a.target, p)]));
    for (const [p, v] of Object.entries(values)) {
      if (!PROPS.includes(p)) throw new Error(`Cannot animate "${p}". Use one of ${PROPS.join(', ')}.`);
      A.setKey(ctx.doc, tid, p, t, v, a.ease);
    }
    return { target: tid, time: t, keyed: Object.keys(values) };
  }, true);

  def('animate', 'animate', 'Animate one property from → to between start and end seconds. position/rotation/scale are [x,y,z] (rotation in degrees), opacity 0..1, color "#rrggbb", visible true/false. Use by for a relative change.', obj({ target: str('entity id/name or "camera"'), property: str('property', PROPS), to: { description: 'end value' }, by: { description: 'relative change instead of to (numbers / [x,y,z])' }, from: { description: 'start value, default: current' }, start: T('default: playhead'), end: T('default start + 1'), ease: str('easing', Object.keys(A.EASES)) }, ['target', 'property']), (a) => {
    const tid = targetId(a.target);
    const start = at(a.start, now());
    const end = at(a.end, start + 1);
    if (end <= start) throw new Error(`end (${end} s) must come after start (${start} s).`);
    const tr = ctx.doc.animation.tracks.find((t) => t.target === tid && t.property === a.property);
    const from = a.from ?? (tr ? A.sample(tr, start) : baseValue(a.target, a.property));
    let to = a.to;
    if (a.by !== undefined) to = Array.isArray(from) ? from.map((x, k) => x + a.by[k]) : from + a.by;
    if (to === undefined) throw new Error('Give `to` or `by`.');
    A.setKey(ctx.doc, tid, a.property, start, from);
    A.setKey(ctx.doc, tid, a.property, end, to, a.ease || 'ease-in-out');
    return { target: tid, property: a.property, start, end, from, to };
  }, true);

  def('animate', 'build_sequence', 'Construction / assembly sequence: entities appear one after another (4D-style). Order: as given, or bottom-up.', obj({ ids, effect: str('how each piece arrives', ['rise', 'drop', 'grow', 'fade', 'slide']), order: str('given | bottom-up | top-down', ['given', 'bottom-up', 'top-down']), start: T('default 0'), duration: num('per piece, default 0.8'), stagger: num('delay between pieces, default 0.4'), distance: num('travel for rise/drop/slide, default 3') }), (a) => {
    const doc = ctx.doc;
    let ents = targets(ctx, a);
    if (a.order === 'bottom-up' || a.order === 'top-down') {
      ents = [...ents].sort((x, y) => D.worldBox(doc, x).min[1] - D.worldBox(doc, y).min[1]);
      if (a.order === 'top-down') ents.reverse();
    }
    const { effect = 'rise', duration = 0.8, stagger = 0.4, distance = 3 } = a;
    const start = at(a.start, 0);
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

  def('animate', 'turntable', 'Camera orbit around the model (or a point) for a presentation reel.', obj({ start: T('default 0'), duration: num('s, default 8'), turns: num('default 1'), center: v3('orbit centre, default model centre'), radius: num('m, default: fits the model'), height: num('camera height, default: current') }), (a) => {
    const doc = ctx.doc;
    const tops = doc.entities.filter((e) => !e.parent);
    const b = tops.length ? D.unionBox(tops.map((e) => D.worldBox(doc, e))) : { min: [-1, 0, -1], max: [1, 1, 1] };
    const c = a.center || b.min.map((x, k) => (x + b.max[k]) / 2);
    const r = a.radius || Math.max(4, G.len(G.sub(b.max, b.min)) * 1.3);
    const cam = ctx.view?.getCamera() ?? doc.camera;
    const h = a.height ?? Math.max(cam.position[1], c[1] + r * 0.45);
    const { duration = 8, turns = 1 } = a;
    const start = at(a.start, 0);
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

  def('animate', 'remove_keyframes', 'Remove keyframes of a target (all, one property, or at one time).', obj({ target: str('entity id/name or "camera"'), property: str('optional'), time: T('optional') }, ['target']), (a) => {
    A.removeKeys(ctx.doc, targetId(a.target), a.property || null, a.time === undefined ? null : at(a.time));
    return { tracks: ctx.doc.animation.tracks.length };
  }, true);

  def('animate', 'set_timeline', 'Timeline length and frame rate.', obj({ duration: num('seconds'), fps: num('frames per second') }), (a) => {
    Object.assign(ctx.doc.animation, Object.fromEntries(Object.entries(a).filter(([, v]) => v > 0)));
    return { duration: ctx.doc.animation.duration, fps: ctx.doc.animation.fps };
  }, true);

  def('animate', 'get_animation', 'All animation tracks and keyframes.', obj({}), () => ctx.doc.animation);

  def('animate', 'playback', 'Play, pause, stop or seek the timeline.', obj({ action: str('play | pause | stop | seek', ['play', 'pause', 'stop', 'seek']), time: T('for seek') }, ['action']), (a) => {
    const tl = ctx.timeline;
    if (!tl) throw new Error('No timeline in this context.');
    if (a.action === 'seek') tl.seek(at(a.time, 0));
    else tl[a.action]();
    return { time: tl.time, playing: tl.playing };
  });

  // ---------------------------------------------------------------- sequencing: markers, captions, motions, explode, paths, stagger
  const anim = () => {
    const a = ctx.doc.animation;
    a.markers ||= [];
    a.captions ||= [];
    a.motions ||= [];
    return a;
  };
  const extend = (t) => {
    const a = ctx.doc.animation;
    if (Number.isFinite(t) && t > a.duration) a.duration = Math.ceil(t);
  };
  const nextId = (list, p) => `${p}${list.reduce((m, x) => Math.max(m, +String(x.id).slice(1) || 0), 0) + 1}`;

  def('animate', 'add_marker', 'Name a moment on the timeline ("roof", "doors open"). Every time parameter then accepts the name, with an optional offset ("roof + 1.5").', obj({ name: str('marker name'), time: T('default: playhead') }, ['name']), (a) => {
    const m = anim();
    const t = at(a.time, now());
    m.markers = m.markers.filter((x) => x.name.toLowerCase() !== a.name.toLowerCase());
    m.markers.push({ name: a.name, t: Math.round(t * 1000) / 1000 });
    m.markers.sort((x, y) => x.t - y.t);
    extend(t);
    return { markers: m.markers };
  }, true);

  def('animate', 'remove_marker', 'Remove a timeline marker.', obj({ name: str('marker name') }, ['name']), (a) => {
    const m = anim();
    const n = m.markers.length;
    m.markers = m.markers.filter((x) => x.name.toLowerCase() !== a.name.toLowerCase());
    if (m.markers.length === n) throw new Error(`No marker "${a.name}".`);
    return { markers: m.markers };
  }, true);

  const POS = ['top', 'center', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  def('animate', 'add_caption', 'Text in the video: titles, phase names, dates, credits. Shows over the view while the timeline is open and is burned into render_video. Styles: title (big, centred band), caption (lower third), label (small pill).', obj({ text: str('the words (\\n for a new line)'), start: T('default: playhead'), end: T('default start + duration'), duration: num('seconds, default 3'), position: str('where on the frame', POS), style: str('look', ['title', 'caption', 'label']), fade: num('fade in/out seconds, default 0.3') }, ['text']), (a) => {
    const m = anim();
    const start = at(a.start, now());
    const end = a.end !== undefined ? at(a.end) : start + (a.duration ?? 3);
    if (end <= start) throw new Error('A caption must end after it starts.');
    const style = a.style || 'caption';
    const c = { id: nextId(m.captions, 'c'), text: a.text, start, end, position: a.position || (style === 'title' ? 'center' : style === 'label' ? 'top-left' : 'bottom-left'), style, fade: a.fade ?? 0.3 };
    m.captions.push(c);
    extend(end);
    return c;
  }, true);

  def('animate', 'remove_caption', 'Remove a caption by id (or by its exact text).', obj({ id: str('caption id or text') }, ['id']), (a) => {
    const m = anim();
    const n = m.captions.length;
    m.captions = m.captions.filter((c) => c.id !== a.id && c.text !== a.id);
    if (m.captions.length === n) throw new Error(`No caption "${a.id}". Captions: ${m.captions.map((c) => `${c.id} "${c.text}"`).join(', ') || 'none'}.`);
    return { captions: m.captions.length };
  }, true);

  def('animate', 'add_motion', 'Procedural motion, no keyframes: spin (speed °/s), oscillate (back and forth), wiggle (smooth shake), orbit (circle; the camera circles its target), pulse (breathing scale). Plays on top of keyframes, from start to end (it holds after end).', obj({ target: str('entity id/name, or "camera"'), type: str('motion', Object.keys(A.MOTIONS)), axis: str('axis (spin default y, others x; wiggle default all)', ['x', 'y', 'z']), property: str('what moves (default by type)', ['position', 'rotation', 'scale']), amplitude: num('how much: m, degrees for rotation, a fraction for pulse; orbit radius'), frequency: num('cycles per second (oscillate, wiggle, pulse)'), speed: num('degrees per second (spin, orbit)'), center: v3('orbit centre'), phase: num('degrees, to offset copies'), start: T('default 0'), end: T('default: forever') }, ['target', 'type']), (a) => {
    const m = anim();
    const target = targetId(a.target);
    const start = at(a.start, 0);
    const end = a.end === undefined ? undefined : at(a.end);
    if (end !== undefined && end <= start) throw new Error('A motion must end after it starts.');
    const mo = { id: nextId(m.motions, 'm'), target, type: a.type, start, ...(end !== undefined ? { end } : {}) };
    for (const k of ['axis', 'property', 'amplitude', 'frequency', 'speed', 'center', 'phase']) if (a[k] !== undefined) mo[k] = a[k];
    m.motions.push(mo);
    extend(end);
    return mo;
  }, true);

  def('animate', 'remove_motion', 'Remove a procedural motion by id, or every motion of a target.', obj({ id: str('motion id, or an entity / "camera"') }, ['id']), (a) => {
    const m = anim();
    const n = m.motions.length;
    let tid = a.id;
    if (!m.motions.some((x) => x.id === a.id)) tid = targetId(a.id);
    m.motions = m.motions.filter((x) => x.id !== a.id && x.target !== tid);
    if (m.motions.length === n) throw new Error(`No motion "${a.id}".`);
    return { motions: m.motions.length };
  }, true);

  /** An entity's local position once its origin moves by a world offset. */
  const localAfter = (doc, e, off) => {
    const pw = D.parentWorldMatrix(doc, e);
    const w = new Vector3(...e.position).applyMatrix4(pw).add(new Vector3(...off));
    return D.round3(w.applyMatrix4(pw.clone().invert()).toArray());
  };

  def('animate', 'explode', 'Exploded view: parts move away from their common centre (or along axes), now (static) or animated out, or out-hold-back in. One group explodes its children.', obj({ ids, factor: num('how far: 1 doubles each part\'s distance from the centre (default 1)'), axes: str('directions parts may move (default all)', ['all', 'x', 'y', 'z', 'xz']), center: v3('explode from this point (default: the parts\' centre)'), mode: str('static | out | out-in (default out)', ['static', 'out', 'out-in']), start: T('default: playhead'), duration: num('seconds, default 1.5'), hold: num('out-in: seconds apart, default 1') }), (a) => {
    const doc = ctx.doc;
    let ents = targets(ctx, a);
    if (ents.length === 1 && ents[0].type === 'group') ents = D.childrenOf(doc, ents[0].id);
    if (ents.length < 2) throw new Error('Explode needs at least two parts (or one group with parts).');
    const boxes = ents.map((e) => D.worldBox(doc, e));
    const c = a.center || Q.centerOf(D.unionBox(boxes));
    const mask = { all: [1, 1, 1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], xz: [1, 0, 1] }[a.axes || 'all'];
    const f = a.factor ?? 1;
    const offs = boxes.map((b) => D.round3(G.sub(Q.centerOf(b), c).map((x, k) => x * f * mask[k])));
    if ((a.mode || 'out') === 'static') {
      shift(ents, offs);
      return { moved: ents.map((e) => e.id) };
    }
    const t0 = at(a.start, now());
    const dur = a.duration ?? 1.5;
    const hold = a.hold ?? 1;
    ents.forEach((e, i) => {
      const p1 = localAfter(doc, e, offs[i]);
      A.setKey(doc, e.id, 'position', t0, e.position, 'linear');
      A.setKey(doc, e.id, 'position', t0 + dur, p1, 'ease-in-out');
      if (a.mode === 'out-in') {
        A.setKey(doc, e.id, 'position', t0 + dur + hold, p1, 'linear');
        A.setKey(doc, e.id, 'position', t0 + 2 * dur + hold, e.position, 'ease-in-out');
      }
    });
    return { parts: ents.map((e) => e.id), start: t0, end: t0 + dur * (a.mode === 'out-in' ? 2 : 1) + (a.mode === 'out-in' ? hold : 0) };
  }, true);

  const FORWARD = { x: (t) => Math.atan2(-t[2], t[0]), '-x': (t) => Math.atan2(t[2], -t[0]), z: (t) => Math.atan2(t[0], t[2]), '-z': (t) => Math.atan2(-t[0], -t[2]) };
  def('animate', 'animate_along_path', 'Move an entity or the camera along a path (trucks, cranes, fly-throughs). It turns to face the direction of travel unless orient is false; the camera looks ahead along the path.', obj({ target: str('entity id/name, or "camera"'), path: { description: 'curve id/name, or [[x,y,z], …] points' }, start: T('default: playhead'), end: T('default start + 5'), orient: bool('face the direction of travel (default true)'), forward: str('the model\'s front axis (default x)', Object.keys(FORWARD)), look_ahead: num('camera: metres ahead it looks (default 3)'), ease: str('speed profile (default ease-in-out)', Object.keys(A.EASES)), keys: num('keys along the path (default 4 per second, at least 8)') }, ['target', 'path']), (a) => {
    const doc = ctx.doc;
    let path = a.path;
    if (typeof path === 'string' && path.trim().startsWith('[')) path = JSON.parse(path);
    let pts;
    if (Array.isArray(path)) pts = path;
    else {
      const [c] = D.resolve(doc, path);
      if (!c.curve) throw new Error(`${c.name} is not a curve. Make one with create_curve, or give path points.`);
      pts = D.curvePoints(doc, c, 24);
    }
    if (pts.length < 2 || C.polyLength(pts) < 1e-6) throw new Error('The path is too short.');
    const t0 = at(a.start, now());
    const t1 = at(a.end, t0 + 5);
    if (t1 <= t0) throw new Error('end must come after start.');
    const n = Math.max(8, Math.round(a.keys ?? (t1 - t0) * 4));
    const ease = A.EASES[a.ease || 'ease-in-out'];
    const len = C.polyLength(pts);
    const tid = targetId(a.target);
    const e = tid === 'camera' ? null : D.getEntity(doc, tid);
    const yawOf = FORWARD[a.forward || 'x'];
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const u = ease(s);
      const t = t0 + s * (t1 - t0);
      const { point, tangent } = C.pointAt(pts, u);
      if (!e) {
        A.setKey(doc, 'camera', 'position', t, D.round3(point), 'linear');
        if (a.orient !== false) {
          const ahead = u + (a.look_ahead ?? 3) / len;
          const look = ahead <= 1 ? C.pointAt(pts, ahead).point : G.add(C.pointAt(pts, 1).point, G.scl(tangent, (ahead - 1) * len));
          A.setKey(doc, 'camera', 'target', t, D.round3(look), 'linear');
        }
        continue;
      }
      A.setKey(doc, e.id, 'position', t, localAfter(doc, { ...e, position: [0, 0, 0] }, point), 'linear');
      if (a.orient !== false && Math.hypot(tangent[0], tangent[2]) > 1e-6) {
        // shortcut: heading only (yaw), in the parent's frame; banking and pitch would need a full frame per key
        let yaw = (yawOf(tangent) * 180) / Math.PI;
        if (prev !== null) yaw += 360 * Math.round((prev - yaw) / 360); // unwrap: never spin the long way round
        prev = yaw;
        A.setKey(doc, e.id, 'rotation', t, [e.rotation[0], r4(yaw), e.rotation[2]], 'linear');
      }
    }
    return { target: tid, start: t0, end: t1, keys: n + 1, length: r4(len) };
  }, true);

  def('animate', 'stagger', 'Offset the animation of entities so each starts delta seconds after the previous one, in an order: selection, height (bottom first), distance from a point, name, x or z. The quickest way to make a sequence look designed.', obj({ ids, delta: num('seconds between starts (default 0.2; negative reverses)'), order: str('default selection', ['selection', 'height', 'distance', 'name', 'x', 'z']), from: v3('order distance: measured from here (default: the centre)') }), (a) => {
    const doc = ctx.doc;
    let ents = targets(ctx, a);
    const animated = (e) => [e, ...D.descendants(doc, e.id)].some((x) => doc.animation.tracks.some((t) => t.target === x.id) || (doc.animation.motions || []).some((m) => m.target === x.id));
    ents = ents.filter(animated);
    if (!ents.length) throw new Error('None of them is animated yet: animate them first (or use build_sequence).');
    const box = (e) => D.worldBox(doc, e);
    const c = a.from || Q.centerOf(D.unionBox(ents.map(box)));
    const key = {
      height: (e) => box(e).min[1],
      distance: (e) => G.len(G.sub(Q.centerOf(box(e)), c)),
      name: (e) => e.name,
      x: (e) => box(e).min[0],
      z: (e) => box(e).min[2],
    }[a.order || 'selection'];
    if (key) ents = [...ents].sort((p, q) => (key(p) < key(q) ? -1 : key(p) > key(q) ? 1 : 0));
    const delta = a.delta ?? 0.2;
    const shiftAll = (e, dt) => [e, ...D.descendants(doc, e.id)].forEach((x) => A.shiftTarget(doc, x.id, dt));
    ents.forEach((e, i) => shiftAll(e, (delta >= 0 ? i : ents.length - 1 - i) * Math.abs(delta)));
    return { order: ents.map((e) => e.name), delta };
  }, true);

  // ---------------------------------------------------------------- file
  const needIO = () => {
    if (!ctx.io) throw new Error('File commands need the desktop app.');
    return ctx.io;
  };
  def('file', 'save', 'Save the model as .glb (geometry + materials + animation; reopens with full editability). Without path it asks.', obj({ path: str('absolute .glb path') }), (a) => needIO().save(a.path));
  def('file', 'open', 'Open a .glb/.gltf (MyModellerReel files reopen fully editable).', obj({ path: str('absolute path') }), (a) => needIO().open(a.path));
  def('file', 'import', 'Insert a model file (glb, gltf, obj, stl, fbx) into the current model.', obj({ path: str('absolute path') }), (a) => needIO().importModel(a.path));
  def('file', 'export', 'Export: glb, gltf, obj, stl, png (viewport image) or video (renders the timeline; render_video has all the options).', obj({ format: str('format', ['glb', 'gltf', 'obj', 'stl', 'png', 'video']), path: str('absolute output path; omit to be asked') }, ['format']), (a) => needIO().exportAs(a.format, a.path));
  def('file', 'render_video', 'Render the timeline frame by frame (no dropped frames at any size): mp4 (H.264), webm (VP9, can be transparent), gif, or a png sequence (name_0001.png …). Captions are burned in.', obj({ path: str('absolute .mp4 / .webm / .gif / .png path; omit to be asked'), format: str('default: from the path', ['mp4', 'webm', 'gif', 'png']), width: num('pixels, default 1920'), height: num('pixels, default 1080'), fps: num('default: the timeline\'s'), from: T('default 0'), to: T('default: the end'), transparent: bool('no background (webm, png, gif)'), quality: str('default high', ['medium', 'high', 'very-high']) }), (a) => {
    const io = needIO();
    const from = at(a.from, 0);
    const to = at(a.to, ctx.doc.animation.duration);
    if (to <= from) throw new Error('to must come after from.');
    return io.renderVideo({ ...a, from, to });
  });

  // ---------------------------------------------------------------- extend
  def('extend', 'run_script', 'Run JavaScript against the API as ONE undo step (all or nothing: an error undoes the whole script). Inside: `await api.create_box({...})` (every command is a function), `api.doc` (the model JSON), `api.geometry`, and `params`. Return a value to see it.', obj({ code: str('async JavaScript body'), params: obj({}, []) }, ['code']), async (a) => {
    const api = new Proxy(
      {
        get doc() {
          return ctx.doc;
        },
        geometry: G,
        run: (n, x) => reg.run(n, x),
      },
      { get: (o, k) => (k in o ? o[k] : typeof k === 'symbol' || k === 'then' ? undefined : (x) => reg.run(k, x)) },
    );
    const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
    try {
      return { result: (await new AsyncFn('api', 'params', a.code)(api, a.params || {})) ?? null };
    } finally {
      ctx.store.changed(); // live view while scripts run inside an AI turn
    }
  }, true);
  reg.commands.get('run_script').compound = true;

  def('extend', 'create_plugin', 'Write and load a plugin that adds new commands (and toolbar buttons) permanently. code is an ES module: export default function (mmr) { mmr.registerCommand({ name, description, params, run: async (args, mmr) => ... }) }', obj({ name: str('file name, letters/digits/-'), code: str('ES module source') }, ['name', 'code']), (a) => {
    if (!ctx.plugins) throw new Error('Plugins need the desktop app.');
    if (!/^[\w-]{1,60}$/.test(a.name)) throw new Error('Plugin name: letters, digits, - or _ only.');
    return ctx.plugins.create(a.name, a.code);
  });

  def('extend', 'list_plugins', 'Plugins loaded and the commands they added.', obj({}), () => ctx.plugins?.list() ?? []);
}
