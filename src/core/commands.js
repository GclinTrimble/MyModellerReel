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
import * as S from './survey.js';
import * as L from './layers.js';
import * as U from './underlay.js';
import * as DR from './drafting.js';
import * as DW from './drawings.js';
import * as PDF from './pdf.js';
import * as Assets from './assets.js';
import * as F from './formats.js';
import './landxml.js';
import './dxf.js';
import './ifc.js';
import * as TR from './terrain.js';
import { surfaceSampler, surfaceSources, refPoint } from './sitework.js';
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
- Survey and terrain: add_point / import_points (N, E, Z, code; real-world coordinates stay exact around a base
  point), add_breakline / add_boundary, create_surface (a live TIN), check_surface, cut_fill / volume_report,
  create_alignment + create_corridor, design_line_slope / design_plane / design_trench / design_road, a feature library
  (define_feature_code) that turns coded points into lines and objects.
- Drawings: import_pdf (scale "1:500") / import_image (world files, GeoTIFF) place underlays; calibrate_underlay
  (scale by a known distance, orient by a bearing, move onto a survey point) or add_control_pair + georeference_underlay
  (least squares, residuals) put them in place in local project coordinates. extract_linework turns PDF vectors into
  curves on layers (filter by PDF layer, colour, width, window); list_drawing_text reads spot heights. Drafting on
  curves: offset_curve, trim, extend, fillet, chamfer, join_curves, break_curve, simplify_curve, divide_curve.
  To 3D: elevate_linework, linework_to_breaklines, extrude_linework, sweep_linework (by ids or a layer glob).
- Files: import reads LandXML, IFC and DXF (and 3D models) and says what it skipped; export writes landxml, ifc
  (schema IFC4 or IFC4X3; roles in metadata become IFC classes, metadata becomes property sets) and dxf.
  query_features / edit_attributes work on feature layers by attribute values.
- Layers: create_layer / set_layer (colour, lock, current, globs like "C-ROAD/*"), move_to_layer, list_layers,
  merge_layers, map_layers, save_layer_state / restore_layer_state. New geometry goes on the current layer.
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
        if (c.mutates) S.syncPoints(ctx.doc), R.rebuildDerived(ctx.doc), Comp.syncComponents(ctx.doc);
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
    ...(e.point ? { n: r4(e.point.n), e: r4(e.point.e), z: r4(e.point.z), code: e.point.code } : {}),
    ...(e.line ? { kind: e.line.kind, line_points: e.line.points.length, ...(e.line.boundary ? { boundary: e.line.boundary } : {}) } : {}),
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
    tag: args.tag,
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
        const t = L.ensureLayer(doc, a.tag);
        if (t.schema) e.meta = L.applyDefaults(t, e.meta);
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

  // ---------------------------------------------------------------- layers (#138)
  const LAYER = { color: common.color, locked: bool('lock: its entities cannot be picked or edited by hand'), line_type: str('continuous | dashed | dotted | center | hidden | a custom name'), line_weight: num('mm'), description: str('what goes on it'), schema: obj({}, []) };
  LAYER.schema.description = 'feature layer attributes: { field: { type: "string"|"number"|"boolean", default, options: [...] } }';
  def('layers', 'create_layer', 'Create a layer (tags are layers). "/" makes groups: "C-ROAD/Kerbs". current: true draws new geometry on it.', obj({ name: str('layer name'), ...LAYER, visible: bool('default true'), current: bool('make it the current layer') }, ['name']), (a) => {
    const doc = ctx.doc;
    if (L.layerOf(doc, a.name)) throw new Error(`Layer "${a.name}" exists: use set_layer.`);
    const t = L.ensureLayer(doc, a.name);
    for (const k of [...L.FIELDS, 'visible']) if (a[k] !== undefined) t[k] = a[k];
    if (a.current) doc.settings.current_layer = t.name;
    return t;
  }, true);
  def('layers', 'set_layer', 'Change layers by name or glob ("C-ROAD/*"): rename, colour, show/hide, lock, line type / weight, description, attribute schema, make current.', obj({ name: str('layer name or glob'), rename: str('new name (one layer)'), ...LAYER, visible: bool('show / hide'), current: bool('make it the current layer') }, ['name']), (a) => {
    const doc = ctx.doc;
    const hit = L.find(doc, a.name);
    if (a.rename !== undefined) {
      if (hit.length > 1) throw new Error('rename takes one layer, not a glob.');
      if (L.layerOf(doc, a.rename)) throw new Error(`Layer "${a.rename}" exists: use merge_layers.`);
      for (const e of doc.entities) if (e.tag === hit[0].name) e.tag = a.rename;
      if (doc.settings.current_layer === hit[0].name) doc.settings.current_layer = a.rename;
      hit[0].name = a.rename;
    }
    for (const t of hit) for (const k of [...L.FIELDS, 'visible']) if (a[k] !== undefined) t[k] = a[k];
    if (a.current) doc.settings.current_layer = hit[0].name;
    return hit;
  }, true);
  def('layers', 'list_layers', 'Every layer with its colour, visibility, lock, line type, attribute schema, entity count and extent (world box).', obj({ name: str('glob filter') }), (a) => {
    const all = L.listLayers(ctx.doc);
    return a.name ? all.filter((t) => L.matcher(a.name)(t.name)) : all;
  });
  def('layers', 'move_to_layer', 'Put entities on a layer (created if new). by_layer: true makes them take the layer colour.', obj({ ids, layer: str('layer name'), by_layer: bool('use the layer colour') }, ['layer']), (a) => {
    const doc = ctx.doc;
    const t = L.ensureLayer(doc, a.layer);
    const ents = targets(ctx, a);
    for (const e of ents) {
      e.tag = t.name;
      if (a.by_layer !== undefined) e.byLayer = a.by_layer;
      if (t.schema) e.meta = L.applyDefaults(t, e.meta);
    }
    return { layer: t.name, moved: ents.length };
  }, true);
  def('layers', 'merge_layers', 'Move everything on some layers (names or globs) onto one layer and remove the emptied ones.', obj({ from: { type: 'array', items: { type: 'string' }, description: 'layer names or globs' }, to: str('target layer (created if new)') }, ['from', 'to']), (a) => {
    const names = [...new Set(a.from.flatMap((p) => L.find(ctx.doc, p).map((t) => t.name)))];
    return { merged: names, into: a.to, moved: L.mergeLayers(ctx.doc, names, a.to) };
  }, true);
  def('layers', 'map_layers', 'Apply a layer mapping table: [{ from: glob, to: layer }], first match wins (used after imports: "0" → "Untagged", "*KERB*" → "Kerbs").', obj({ rules: { type: 'array', items: obj({ from: str('glob'), to: str('layer') }, ['from', 'to']) } }, ['rules']), (a) => ({ mapped: L.mapLayers(ctx.doc, a.rules) }), true);
  def('layers', 'save_layer_state', 'Save the visibility, colour and lock of every layer under a name.', obj({ name: str('state name') }, ['name']), (a) => {
    (ctx.doc.layerStates ||= {})[a.name] = L.captureState(ctx.doc);
    return { states: Object.keys(ctx.doc.layerStates) };
  }, true);
  def('layers', 'restore_layer_state', 'Bring back a saved layer state.', obj({ name: str('state name') }, ['name']), (a) => {
    const s = ctx.doc.layerStates?.[a.name];
    if (!s) throw new Error(`No layer state "${a.name}". States: ${Object.keys(ctx.doc.layerStates || {}).join(', ') || 'none'}.`);
    L.restoreState(ctx.doc, s);
    return { restored: a.name };
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
      e.meta = { ...(e.meta || {}), ...L.checkAttributes(L.layerOf(ctx.doc, e.tag), a.values || {}) };
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

  // ---------------------------------------------------------------- survey and terrain (#116–#119, #124, #130, #131, #136, #36)
  const pointsByRefs = (refs) => {
    const doc = ctx.doc;
    if (!refs?.length) throw new Error('Give points (names or ids).');
    return refs.map((r) => {
      const p = doc.entities.find((e) => S.isPoint(e) && (e.id === r || e.name === String(r))) || D.resolve(doc, r)[0];
      if (!S.isPoint(p)) throw new Error(`${p.name} is not a survey point.`);
      return p;
    });
  };
  const fmtPt = (p) => ({ id: p.id, name: p.name, n: r4(p.point.n), e: r4(p.point.e), z: r4(p.point.z), code: p.point.code, ...(p.point.desc ? { desc: p.point.desc } : {}), ...(Object.keys(p.point.attrs || {}).length ? { attrs: p.point.attrs } : {}) });
  const afterPoints = () => {
    if (Object.keys(ctx.doc.featureCodes || {}).length) return processCodes();
    return null;
  };
  /** A design / surface input: a point name, a local [x,y,z], or [x, z] on a surface. */
  const designRef = (r) => {
    if (Array.isArray(r) && r.length === 3) return r;
    const [p] = pointsByRefs([r]);
    return { point: p.id };
  };
  const surfaceOf = (ref) => {
    const [s] = D.resolve(ctx.doc, ref);
    if (!s.mesh) throw new Error(`${s.name} is not a surface.`);
    return s;
  };

  def('terrain', 'set_coordinate_system', 'The project coordinate system: an EPSG code and name (recorded and written to GLB exports), and an optional site grid (origin [E, N], rotation in degrees, scale factor) for importing local grid coordinates.', obj({ epsg: num('EPSG code, e.g. 2193'), name: str('name, e.g. NZGD2000 / NZTM'), grid: obj({ origin: { type: 'array', items: { type: 'number' } }, rotation: num('degrees'), scale: num('factor') }, []) }), (a) => {
    const g = S.geo(ctx.doc);
    if (a.epsg !== undefined || a.name !== undefined) g.crs = { epsg: a.epsg ?? g.crs?.epsg ?? null, name: a.name ?? g.crs?.name ?? '' };
    if (a.grid) g.grid = a.grid;
    return g;
  }, true);

  def('terrain', 'set_base_point', 'The project base point the model is drawn around, so real-world coordinates (N 5 400 000) stay precise. The model does not move in the world: everything is re-placed around the new base. auto: the centre of the points.', obj({ e: num('Easting'), n: num('Northing'), z: num('Elevation'), auto: bool('centre of the survey points') }), (a) => {
    const doc = ctx.doc;
    const g = S.geo(doc);
    const old = g.base || [0, 0, 0];
    let nb;
    if (a.auto) {
      const pts = S.points(doc);
      if (!pts.length) throw new Error('No points to centre on.');
      const avg = (k) => pts.reduce((s, p) => s + p.point[k], 0) / pts.length;
      nb = [Math.round(avg('e')), Math.round(avg('n')), Math.round(avg('z'))];
    } else nb = [a.e ?? old[0], a.n ?? old[1], a.z ?? old[2]];
    const d = [old[0] - nb[0], old[2] - nb[2], -(old[1] - nb[1])]; // local shift
    for (const e of doc.entities) if (!e.parent && !S.isPoint(e) && !S.isLinework(e)) e.position = D.round3(G.add(e.position, d));
    g.base = nb;
    S.placePoints(doc);
    return { base: nb };
  }, true);

  def('terrain', 'set_units', 'Units for survey input and output (internally always metres): length m, ft (international) or usft (US survey); angles deg, dms or gon.', obj({ length: str('length unit', Object.keys(S.UNITS)), angles: str('angle format', ['deg', 'dms', 'gon']) }), (a) => {
    const g = S.geo(ctx.doc);
    if (a.length) g.units = a.length;
    if (a.angles) g.angles = a.angles;
    return { units: g.units, angles: g.angles };
  }, true);

  def('terrain', 'add_point', 'Add a survey point: by Northing/Easting/Elevation (project units), at a model point, or by COGO from another point (bearing from north, horizontal distance, height difference). code drives the feature library (KERB, TREE…).', obj({ name: str('point name / number (default: next number)'), n: num('Northing'), e: num('Easting'), z: num('Elevation'), at: v3('or: a model point [x, y, z]'), from: str('or: COGO from this point'), bearing: { description: 'degrees from north, or DMS "45°30\'00\\""' }, distance: num('horizontal, project units'), dz: num('height difference'), grid: bool('n/e are site-grid coordinates'), code: str('feature code (+ string and controls: "KERB 2 B")'), desc: str('description'), attrs: obj({}, []) }), (a) => {
    const doc = ctx.doc;
    const g = S.geo(doc);
    const k = S.UNITS[g.units] || 1;
    let c;
    if (a.at) c = S.toProject(doc, a.at);
    else if (a.from) {
      const [p] = pointsByRefs([a.from]);
      const b = (S.parseAngle(a.bearing ?? 0, g.angles) * Math.PI) / 180;
      const dist = (a.distance ?? 0) * k;
      c = { n: p.point.n + dist * Math.cos(b), e: p.point.e + dist * Math.sin(b), z: p.point.z + (a.dz ?? 0) * k };
    } else {
      if (a.n === undefined || a.e === undefined) throw new Error('Give n and e (and z), or at, or from + bearing + distance.');
      c = { n: a.n * k, e: a.e * k, z: (a.z ?? 0) * k };
      if (a.grid) c = S.gridToProject(doc, c);
    }
    const p = S.addPoint(doc, { ...c, name: a.name, code: a.code || '', desc: a.desc || '', attrs: a.attrs || {} });
    afterPoints();
    ctx.selection.set([p.id]);
    return fmtPt(p);
  }, true);

  def('terrain', 'edit_points', 'Change survey points: set code, description, attributes or coordinates, or raise / lower them (raise in project units). Pick them by names/ids or by code.', obj({ points: { type: 'array', items: { type: 'string' }, description: 'names or ids (default: selection)' }, where_code: str('or: every point with this code'), code: str('new code'), desc: str('new description'), attrs: obj({}, []), n: num('Northing'), e: num('Easting'), z: num('Elevation'), raise: num('add to the elevation') }), (a) => {
    const doc = ctx.doc;
    const k = S.UNITS[S.geo(doc).units] || 1;
    const pts = a.where_code ? S.points(doc).filter((p) => S.parseCode(p.point.code).code === a.where_code.toUpperCase()) : pointsByRefs(a.points || ctx.selection.get());
    if (!pts.length) throw new Error('No points match.');
    for (const p of pts) {
      if (a.code !== undefined) p.point.code = a.code;
      if (a.desc !== undefined) p.point.desc = a.desc;
      if (a.attrs) p.point.attrs = { ...(p.point.attrs || {}), ...a.attrs };
      for (const c of ['n', 'e', 'z']) if (a[c] !== undefined) p.point[c] = a[c] * k;
      if (a.raise) p.point.z += a.raise * k;
      p.position = D.round3(S.toLocal(doc, p.point));
      p.material.color = S.codeColor(doc, p.point.code);
    }
    afterPoints();
    return { edited: pts.length, points: pts.slice(0, 50).map(fmtPt) };
  }, true);

  def('terrain', 'import_points', 'Import survey points from a CSV / TXT file (or text): format gives the column order (PNEZD, PENZD, NEZ…; P name, N northing, E easting, Z elevation, D code), header lines are skipped, units convert to metres. Coded points are processed through the feature library.', obj({ path: str('absolute path of a .csv / .txt file'), text: str('or: the file contents'), format: str('column order, default PNEZD'), delimiter: str('default: detected'), units: str('length unit of the file (default: the project\'s)', Object.keys(S.UNITS)), grid: bool('coordinates are in the site grid') }), async (a) => {
    const doc = ctx.doc;
    let text = a.text;
    if (!text) {
      if (!a.path) throw new Error('Give path or text.');
      if (!ctx.io?.readText) throw new Error('Reading files needs the desktop app; pass text instead.');
      text = await ctx.io.readText(a.path);
    }
    const { rows, skipped } = S.parsePoints(text, { format: a.format || 'PNEZD', delimiter: a.delimiter, units: a.units || S.geo(doc).units });
    if (!rows.length) throw new Error('No points found: check the format (column order) and delimiter.');
    const made = [];
    const renamed = [];
    for (const r of rows) {
      const c = a.grid ? S.gridToProject(doc, r) : r;
      let name = r.name;
      if (name !== undefined && doc.entities.some((x) => S.isPoint(x) && x.name === name)) (renamed.push(name), (name = undefined));
      made.push(S.addPoint(doc, { ...c, name, code: r.code, desc: r.desc }));
    }
    const codes = afterPoints();
    return { imported: made.length, skipped_lines: skipped, renamed_duplicates: renamed, base: S.geo(doc).base, ...(codes ? { lines: codes.lines, objects: codes.objects, warnings: codes.warnings.slice(0, 20) } : {}) };
  }, true);

  def('terrain', 'export_points', 'Export survey points as CSV text (and to a file when path is given): format column order, project units.', obj({ path: str('absolute .csv / .txt path'), format: str('default PNEZD'), points: { type: 'array', items: { type: 'string' }, description: 'only these' }, units: str('default: the project\'s', Object.keys(S.UNITS)) }), async (a) => {
    const doc = ctx.doc;
    const pts = a.points ? pointsByRefs(a.points) : S.points(doc);
    const text = S.formatPoints(doc, pts, { format: a.format || 'PNEZD', units: a.units || S.geo(doc).units });
    if (a.path) {
      if (!ctx.io?.writeText) throw new Error('Writing files needs the desktop app; omit path to get the text.');
      await ctx.io.writeText(a.path, text);
    }
    return { points: pts.length, ...(a.path ? { written: a.path } : { text }) };
  });

  def('terrain', 'query_points', 'Find survey points by code, name pattern, elevation range or distance from a point. Returns names and coordinates (project units).', obj({ code: str('feature code'), name: str('glob, e.g. "MH*"'), near: { description: 'a point name, or [x, z] / [x, y, z] in the model' }, radius: num('m'), min_z: num('elevation at least'), max_z: num('elevation at most'), limit: num('default 200') }), (a) => {
    const doc = ctx.doc;
    let pts = S.points(doc);
    if (a.code) pts = pts.filter((p) => S.parseCode(p.point.code).code === a.code.toUpperCase());
    if (a.name) {
      const re = new RegExp(`^${a.name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
      pts = pts.filter((p) => re.test(p.name));
    }
    if (a.min_z !== undefined) pts = pts.filter((p) => p.point.z >= a.min_z);
    if (a.max_z !== undefined) pts = pts.filter((p) => p.point.z <= a.max_z);
    let c = null;
    if (a.near !== undefined) {
      c = Array.isArray(a.near) ? (a.near.length === 2 ? [a.near[0], 0, a.near[1]] : a.near) : pointsByRefs([a.near])[0].position;
      pts = pts.map((p) => [p, Math.hypot(p.position[0] - c[0], p.position[2] - c[2])]).filter(([, d]) => a.radius === undefined || d <= a.radius).sort((x, y) => x[1] - y[1]).map(([p]) => p);
    }
    return { count: pts.length, points: pts.slice(0, a.limit || 200).map(fmtPt) };
  });

  const addLine = (a, kind) => {
    const doc = ctx.doc;
    const pts = pointsByRefs(a.points || ctx.selection.get());
    if (pts.length < 2) throw new Error('A line needs at least 2 points.');
    const l = D.addEntity(doc, {
      type: 'linework',
      name: a.name || D.uniqueName(doc, kind === 'boundary' ? (a.kind === 'hole' ? 'Hole' : 'Boundary') : 'Breakline'),
      line: { points: pts.map((p) => p.id), kind, ...(kind === 'breakline' ? { mode: a.mode || 'hard' } : { boundary: a.kind || 'outer' }), closed: kind === 'boundary' ? true : !!a.closed, smooth: !!a.smooth },
      tag: a.tag,
      material: { color: kind === 'boundary' ? '#2f6f86' : '#c8553d' },
    });
    ctx.selection.set([l.id]);
    return summary(doc, l);
  };
  def('terrain', 'add_breakline', 'Join survey points into a breakline: the surface follows it (kerbs, ditches, top/toe of bank). It references the points, so moving one moves the line and the surface. smooth: a curve through them.', obj({ points: { type: 'array', items: { type: 'string' }, description: 'point names/ids in order (default: selection)' }, mode: str('hard: no triangle crosses it; soft: honoured but smoothed', ['hard', 'soft']), closed: bool('loop'), smooth: bool('curve through the points'), name: common.name, tag: common.tag }), (a) => addLine(a, 'breakline'), true);
  def('terrain', 'add_boundary', 'A surface boundary through survey points: outer (the surface stops there) or a hole (buildings, ponds).', obj({ points: { type: 'array', items: { type: 'string' }, description: 'point names/ids in order (default: selection)' }, kind: str('outer (default) or hole', ['outer', 'hole']), smooth: bool('curve through the points'), name: common.name, tag: common.tag }), (a) => addLine(a, 'boundary'), true);
  def('terrain', 'edit_linework', 'Edit a breakline / boundary / line: append or insert points, remove points, reverse, split at a point (makes two), join another onto its end, or set all points.', obj({ id, action: str('what to do', ['append', 'insert', 'remove', 'reverse', 'split', 'join', 'set', 'smooth']), points: { type: 'array', items: { type: 'string' }, description: 'point names/ids' }, at: num('insert / split index'), with: str('join: the other linework'), smooth: bool('smooth: on or off') }, ['id', 'action']), (a) => {
    const doc = ctx.doc;
    const [l] = D.resolve(doc, a.id);
    if (!S.isLinework(l)) throw new Error(`${l.name} is not linework.`);
    const ids = a.points ? pointsByRefs(a.points).map((p) => p.id) : [];
    const L = l.line;
    if (a.action === 'append') L.points.push(...ids);
    else if (a.action === 'insert') L.points.splice(a.at ?? 0, 0, ...ids);
    else if (a.action === 'remove') L.points = L.points.filter((x) => !ids.includes(x));
    else if (a.action === 'reverse') L.points.reverse();
    else if (a.action === 'set') L.points = ids;
    else if (a.action === 'smooth') L.smooth = a.smooth !== false;
    else if (a.action === 'split') {
      const i = a.at ?? (ids[0] ? L.points.indexOf(ids[0]) : -1);
      if (i <= 0 || i >= L.points.length - 1) throw new Error('Split at an inner point (index or point).');
      const rest = D.duplicateEntity(doc, l);
      rest.name = D.uniqueName(doc, l.name);
      rest.line.points = L.points.slice(i);
      L.points = L.points.slice(0, i + 1);
    } else if (a.action === 'join') {
      const [o] = D.resolve(doc, a.with);
      if (!S.isLinework(o)) throw new Error(`${o.name} is not linework.`);
      L.points.push(...o.line.points.filter((x, k) => !(k === 0 && x === L.points.at(-1))));
      D.removeEntity(doc, o);
    }
    if (L.points.length < 2) throw new Error('A line needs at least 2 points.');
    return summary(doc, l);
  }, true);

  const surfaceParams = (a) => {
    const p = {};
    if (a.points !== undefined) p.points = Array.isArray(a.points) ? pointsByRefs(a.points).map((x) => x.id) : typeof a.points === 'string' && a.points !== 'all' ? { codes: a.points.split(/[,\s]+/) } : a.points;
    if (a.codes) p.points = { codes: a.codes };
    for (const k of ['breaklines', 'boundaries']) if (a[k] !== undefined) p[k] = Array.isArray(a[k]) ? D.resolve(ctx.doc, a[k]).map((x) => x.id) : a[k];
    if (a.exclude) p.exclude = pointsByRefs(a.exclude).map((x) => x.id);
    for (const k of ['max_edge', 'min_z', 'max_z']) if (a[k] !== undefined) p[k] = a[k];
    return p;
  };
  const SRC = { points: { description: '"all" (default), point names, or codes "GND,KERB"' }, codes: { type: 'array', items: { type: 'string' }, description: 'or: only points with these codes' }, breaklines: { description: '"all" (default), "none" or ids' }, boundaries: { description: '"all" (default), "none" or ids' }, exclude: { type: 'array', items: { type: 'string' }, description: 'points left out' }, max_edge: num('drop triangles with a longer side, m'), min_z: num('ignore points below this elevation'), max_z: num('ignore points above this elevation') };
  def('terrain', 'create_surface', 'A TIN surface (constrained Delaunay) from survey points, breaklines and boundaries. It stays live: move, add or delete a point or a line and it rebuilds. Several surfaces can live side by side (existing ground, design, as-built).', obj({ name: common.name, ...SRC, color: common.color, tag: common.tag }), (a) => {
    const doc = ctx.doc;
    const params = surfaceParams(a);
    R.getGenerator('surface').run({ params, inputs: [], doc }); // bad sources throw before anything changes
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Surface'), tag: a.tag, material: { color: a.color || '#8fae7a', roughness: 0.95 } });
    R.derive(doc, e, 'surface', params, []);
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), surface: { ...TR.surfaceStats(e.mesh), points: e.derived.report.points, duplicates: e.derived.report.duplicates.length, crossing_lines: e.derived.report.crossings.length } };
  }, true);

  def('terrain', 'set_surface_sources', 'Change what a surface is made from (points, codes, breaklines, boundaries, excluded points, max edge, elevation range).', obj({ id, ...SRC }, ['id']), (a) => {
    const s = surfaceOf(a.id);
    if (s.derived?.generator !== 'surface') throw new Error(`${s.name} is not a TIN surface.`);
    return reg.commands.get('set_params').run({ id: s.id, params: { ...s.derived.params, ...surfaceParams(a) } });
  }, true);

  def('terrain', 'rebuild_surface', 'Rebuild a surface now (it also rebuilds by itself when its sources change).', obj({ id }, ['id']), (a) => {
    const s = surfaceOf(a.id);
    if (!s.derived) throw new Error(`${s.name} is not a surface.`);
    R.regenerate(ctx.doc, s);
    return { ...summary(ctx.doc, s), surface: TR.surfaceStats(s.mesh) };
  }, true);

  def('terrain', 'edit_triangles', 'Edit a TIN by hand: delete the triangle at a plan point, swap the edge between two points, add a point on the surface (its elevation from the surface), or restore all.', obj({ id, action: str('what to do', ['delete', 'swap', 'add_point', 'restore']), at: { type: 'array', items: { type: 'number' }, description: 'plan point [x, z] (model)' }, a: str('swap: first point'), b: str('swap: second point'), name: str('add_point: its name'), code: str('add_point: its code') }, ['id', 'action']), (a) => {
    const doc = ctx.doc;
    const s = surfaceOf(a.id);
    if (s.derived?.generator !== 'surface') throw new Error(`${s.name} is not a TIN surface.`);
    const p = { ...s.derived.params };
    if (a.action === 'restore') delete p.deleted, delete p.swaps;
    else if (a.action === 'delete') p.deleted = [...(p.deleted || []), a.at];
    else if (a.action === 'swap') p.swaps = [...(p.swaps || []), pointsByRefs([a.a, a.b]).map((x) => x.id)];
    else {
      const y = surfaceSampler(doc, s).z(a.at[0], a.at[1]);
      if (y === null) throw new Error('That point is outside the surface.');
      const pt = S.addPoint(doc, { ...S.toProject(doc, [a.at[0], y, a.at[1]]), name: a.name, code: a.code || '' });
      if (Array.isArray(p.points)) p.points = [...p.points, pt.id];
    }
    if (!a.at && ['delete', 'add_point'].includes(a.action)) throw new Error('Give at: [x, z].');
    s.derived.params = p;
    R.regenerate(doc, s);
    return { ...summary(doc, s), surface: TR.surfaceStats(s.mesh) };
  }, true);

  def('terrain', 'check_surface', 'Quality checks on a surface: spikes and pits (points far off their neighbours), duplicate points, crossing breaklines, long thin triangles. Each issue names the points to fix (edit_points, delete, or set_surface_sources exclude).', obj({ id, spike: num('flag points more than this far off their neighbours, m (default: automatic)'), min_angle: num('thin-triangle limit, degrees (default 2)') }, ['id']), (a) => {
    const doc = ctx.doc;
    const s = surfaceOf(a.id);
    const rep = s.derived?.report || {};
    const w = D.worldMesh(doc, s);
    const name = (id) => D.getEntity(doc, id)?.name;
    const issues = TR.checkMesh(w, { vertexIds: rep.vertexIds || [], spike: a.spike ?? null, minAngle: a.min_angle ?? 2 }).map((i) => (i.point ? { ...i, name: name(i.point), message: `Point ${name(i.point)}: ${i.message}` } : i));
    for (const d of rep.duplicates || []) issues.push({ kind: 'duplicate', severity: 'warning', point: d.dropped, kept: d.kept, message: `Points ${name(d.kept)} and ${name(d.dropped)} are at the same place${d.dz ? ` (${Math.abs(d.dz)} m apart in height)` : ''}; ${name(d.dropped)} was left out.` });
    const lines = surfaceSources(doc, s.derived?.params || {}).breaklines;
    for (const c of TR.crossings(lines.map((l) => S.lineworkPath(doc, l)))) issues.push({ kind: 'crossing_breaklines', severity: 'error', lines: [lines[c.a].id, lines[c.b].id], at: c.at, message: `Breaklines ${lines[c.a].name} and ${lines[c.b].name} cross at [${c.at.join(', ')}].` });
    return { surface: s.name, issues, ...TR.surfaceStats(w) };
  });

  // feature library
  const processCodes = () => {
    const doc = ctx.doc;
    for (const e of doc.entities.filter((x) => x.fromCodes)) if (D.getEntity(doc, e.id)) D.removeEntity(doc, e);
    const plan = S.planCodes(doc);
    for (const l of plan.lines)
      D.addEntity(doc, { type: 'linework', name: `${l.code}${l.string !== '1' ? ` ${l.string}` : ''}`, fromCodes: true, line: { points: l.points, kind: l.def.breakline ? 'breakline' : 'line', mode: 'hard', closed: l.closed, smooth: l.smooth }, tag: l.def.layer || 'Untagged', material: { color: l.def.color || S.codeColor(doc, l.code) } });
    for (const o of plan.objects) {
      const h = +o.point.point.attrs?.[o.def.object.height_attr] || o.def.object.height || 4;
      const type = o.def.object.type || 'tree';
      const mesh = type === 'tree' ? G.translate(G.cone(h * 0.3, h * 0.7, 12), [0, h * 0.3, 0]) : type === 'post' ? G.cylinder(0.05, h, 8) : G.cylinder(0.5, 0.15, 24);
      const extra = type === 'tree' ? G.cylinder(h * 0.05, h * 0.3, 8) : null;
      const m = extra ? { v: [...mesh.v, ...extra.v], f: [...mesh.f, ...extra.f.map((f) => f.map((i) => i + mesh.v.length))] } : mesh;
      D.addEntity(doc, { name: `${o.code} ${o.point.name}`, fromCodes: true, mesh: m, position: [...o.point.position], tag: o.def.layer || 'Untagged', material: { color: o.def.color || (type === 'tree' ? '#4c7a5a' : '#9aa3ab') } });
    }
    for (const p of S.points(doc)) {
      p.material.color = S.codeColor(doc, p.point.code);
      const layer = doc.featureCodes?.[S.parseCode(p.point.code).code]?.layer;
      if (layer) {
        p.tag = layer;
        if (!doc.tags.some((t) => t.name === layer)) doc.tags.push({ name: layer, visible: true });
      }
    }
    return { lines: plan.lines.length, objects: plan.objects.length, warnings: plan.warnings.map((w) => w.message) };
  };
  def('terrain', 'define_feature_code', 'Add or change a feature code: points coded with it get a layer and colour, join into lines (and breaklines), place an object (tree, post, manhole) sized by an attribute, and must carry the listed attributes.', obj({ code: str('e.g. KERB'), description: str('what it is'), layer: str('tag for its points, lines and objects'), color: str('#rrggbb'), line: bool('points join into lines'), breakline: bool('those lines are breaklines'), object: obj({ type: str('object', ['tree', 'post', 'manhole']), height_attr: str('attribute with the height'), height: num('default height, m') }, []), attrs: { type: 'array', items: obj({ name: str(''), type: str('', ['number', 'text', 'list']), options: { type: 'array', items: { type: 'string' } }, required: bool('') }, ['name']), description: 'attribute fields' } }, ['code']), (a) => {
    const doc = ctx.doc;
    const code = a.code.toUpperCase();
    const old = (doc.featureCodes ||= {})[code] || {};
    const def = { ...old };
    for (const k of ['description', 'layer', 'color', 'line', 'breakline', 'object', 'attrs']) if (a[k] !== undefined) def[k] = a[k];
    doc.featureCodes[code] = def;
    return { code, ...def, processed: processCodes() };
  }, true);
  def('terrain', 'load_feature_library', 'Load a feature library (JSON { CODE: { … } }) from a file or inline, merged into the model\'s, then reprocess the points.', obj({ path: str('absolute .json path'), library: obj({}, []), replace: bool('replace the current library instead of merging') }), async (a) => {
    const doc = ctx.doc;
    let lib = a.library;
    if (!lib) {
      if (!a.path || !ctx.io?.readText) throw new Error('Give library, or a path (in the desktop app).');
      lib = JSON.parse(await ctx.io.readText(a.path));
    }
    const up = Object.fromEntries(Object.entries(lib).map(([k, v]) => [k.toUpperCase(), v]));
    doc.featureCodes = a.replace ? up : { ...(doc.featureCodes || {}), ...up };
    return { codes: Object.keys(doc.featureCodes), processed: processCodes() };
  }, true);
  def('terrain', 'export_feature_library', 'The feature library as JSON (and to a file with path).', obj({ path: str('absolute .json path') }), async (a) => {
    const lib = ctx.doc.featureCodes || {};
    if (a.path) await ctx.io.writeText(a.path, JSON.stringify(lib, null, 2));
    return { codes: Object.keys(lib).length, library: lib };
  });
  def('terrain', 'process_codes', 'Run the feature library over the points again: lines, breaklines, objects, layers and colours (it also runs after importing or editing points). Returns warnings for unknown codes and missing attributes.', obj({}), () => processCodes(), true);

  // earthworks
  const designSampler = (a) => {
    if (a.elevation !== undefined) return a.elevation - (S.geo(ctx.doc).base?.[2] || 0);
    return surfaceSampler(ctx.doc, surfaceOf(a.design));
  };
  const withinPoly = (ref) => {
    if (!ref) return null;
    const [l] = D.resolve(ctx.doc, ref);
    if (!S.isLinework(l)) throw new Error(`${l.name} is not a boundary.`);
    return S.lineworkPath(ctx.doc, l).map((q) => [q[0], q[2]]);
  };
  const volumes = (a) => {
    const doc = ctx.doc;
    const ex = surfaceSampler(doc, surfaceOf(a.existing));
    let design = a.base === 'boundary' ? null : designSampler(a);
    if (a.base === 'boundary') {
      // stockpile: the base is a surface through the boundary's own points
      if (!a.within) throw new Error('base: "boundary" needs within (the boundary around the pile).');
      const [l] = D.resolve(doc, a.within);
      const pts = S.lineworkPath(doc, l);
      const { faces } = TR.triangulate(pts, { outer: [pts.map((q) => [q[0], q[2]])] });
      design = TR.sampler({ v: pts, f: faces });
    }
    if (a.design === undefined && a.elevation === undefined && a.base !== 'boundary') throw new Error('Give design (a surface), elevation, or base: "boundary".');
    const r = TR.cutFill(ex, design, { within: withinPoly(a.within), cell: a.cell || 0 });
    const bulk = a.bulking ?? 1;
    const shrink = a.shrinkage ?? 1;
    return { ...r, adjusted: { cut_loose: r4(r.cut * bulk), fill_compacted_need: r4(r.fill / shrink) } };
  };
  const VOL = { existing: str('existing ground surface'), design: str('design surface'), elevation: num('or: a flat design elevation (project)'), base: str('stockpile: "boundary" (a surface through the boundary points)', ['boundary']), within: str('a boundary to measure inside'), cell: num('grid cell, m (default: automatic)'), bulking: num('cut volume factor, e.g. 1.25'), shrinkage: num('fill factor, e.g. 0.9') };
  def('terrain', 'cut_fill', 'Earthworks between two surfaces (or a surface and a flat elevation): cut, fill, net and area, with bulking / shrinkage, and a coloured cut/fill map (red cut, blue fill). Stockpiles: base "boundary".', obj({ ...VOL, map: bool('make the cut/fill map (default true)'), name: common.name }, ['existing']), (a) => {
    const doc = ctx.doc;
    const r = volumes(a);
    const out = { cut: r.cut, fill: r.fill, net: r.net, area: r.area, cell: r.cell, adjusted: r.adjusted };
    if (a.map !== false && r.cells.length) {
      // colours saturate at the 95th percentile, so a few deep cells do not wash out the rest
      const mags = r.cells.map((c) => Math.abs(c.h)).sort((x, y) => x - y);
      const scale = Math.max(0.05, mags[Math.floor(mags.length * 0.95)] || 0);
      const ground = surfaceSampler(doc, surfaceOf(a.existing)).z;
      const v = [];
      const f = [];
      const fc = [];
      const h = r.cell / 2;
      for (const c of r.cells) {
        // draped on the existing ground (a little above it), so the map reads as one sheet
        const at = (x, z) => [x, (ground(x, z) ?? c.e) + 0.05, z];
        const i = v.length;
        v.push(at(c.x - h, c.z - h), at(c.x + h, c.z - h), at(c.x + h, c.z + h), at(c.x - h, c.z + h));
        f.push([i, i + 3, i + 2], [i, i + 2, i + 1]);
        fc.push(TR.cutFillColor(c.h, scale));
        fc.push(TR.cutFillColor(c.h, scale));
      }
      const { mesh, origin } = G.recenter({ v, f });
      mesh.fc = fc;
      const m = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Cut/fill map'), mesh, position: D.round3(origin), material: { color: '#ffffff', roughness: 1 } });
      out.map = m.id;
      out.legend = { cut: '#c44536 (red)', fill: '#2f6fb8 (blue)', scale_m: r4(scale) };
    }
    return out;
  }, true);

  def('terrain', 'volume_report', 'Earthwork volumes as a table: one row per region (boundaries) or the whole surface, with CSV text and an optional file.', obj({ ...VOL, regions: { type: 'array', items: { type: 'string' }, description: 'boundaries, one row each' }, path: str('absolute .csv path') }, ['existing']), async (a) => {
    const rows = (a.regions?.length ? a.regions : [a.within || null]).map((reg2) => {
      const r = volumes({ ...a, within: reg2 });
      return { region: reg2 ? D.resolve(ctx.doc, reg2)[0].name : 'All', cut: r.cut, fill: r.fill, net: r.net, area: r.area, cut_loose: r.adjusted.cut_loose, fill_need: r.adjusted.fill_compacted_need };
    });
    const csv = `region,cut_m3,fill_m3,net_m3,area_m2,cut_loose_m3,fill_need_m3\n${rows.map((r) => [r.region, r.cut, r.fill, r.net, r.area, r.cut_loose, r.fill_need].join(',')).join('\n')}\n`;
    if (a.path) await ctx.io.writeText(a.path, csv);
    return { rows, csv };
  });

  def('terrain', 'cut_fill_at', 'Cut or fill at one place: the design and existing elevations there and the difference.', obj({ design: str('design surface'), existing: str('existing surface'), at: { description: 'a point name, or [x, z] in the model' } }, ['design', 'existing', 'at']), (a) => {
    const doc = ctx.doc;
    const p = Array.isArray(a.at) ? [a.at[0], 0, a.at.at(-1)] : pointsByRefs([a.at])[0].position;
    const base = S.geo(doc).base?.[2] || 0;
    const d = surfaceSampler(doc, surfaceOf(a.design)).z(p[0], p[2]);
    const e = surfaceSampler(doc, surfaceOf(a.existing)).z(p[0], p[2]);
    if (d === null || e === null) throw new Error('That place is outside one of the surfaces.');
    const h = d - e;
    return { design_z: r4(d + base), existing_z: r4(e + base), difference: r4(h), says: h > 0 ? `fill ${r4(h)} m` : `cut ${r4(-h)} m` };
  });

  // alignments and corridors
  const alignmentPoints = (a) => {
    const doc = ctx.doc;
    const pis = a.points.map((q) => (Array.isArray(q) ? (q.length === 3 ? [q[0], q[2]] : q) : [pointsByRefs([q])[0].position[0], pointsByRefs([q])[0].position[2]]));
    const k = S.UNITS[S.geo(doc).units] || 1;
    const base = S.geo(doc).base?.[2] || 0;
    const geom = TR.alignmentGeometry({ pis, radii: [0, ...(a.radii || [])], pvis: (a.pvis || []).map(([s, z]) => [s * k, z * k - base]), curves: [0, ...(a.curves || [])].map((x) => x * k), start: (a.start_station || 0) * k, step: a.step || 1 });
    const ground = a.surface ? surfaceSampler(doc, surfaceOf(a.surface)).z : null;
    return { geom, points: geom.plan.map(([x, z, s]) => [x, geom.elevation(s) ?? (ground ? ground(x, z) : null) ?? 0, z]) };
  };
  const ALIGN = { points: { type: 'array', description: 'points of intersection: names, [x, z] or [x, y, z]' }, radii: { type: 'array', items: { type: 'number' }, description: 'arc radius at each inner point, m (0 = none)' }, pvis: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'vertical: [[station, elevation], …] (project units)' }, curves: { type: 'array', items: { type: 'number' }, description: 'vertical curve length at each inner PVI' }, start_station: num('station at the start, default 0'), surface: str('no vertical: follow this ground'), step: num('sampling, m (default 1)') };
  def('terrain', 'create_alignment', 'A horizontal alignment (straights with circular arcs at the points of intersection) with a vertical profile (grades and parabolic vertical curves, or following a surface). It is a curve: corridors and animate_along_path use it; stations are labelled.', obj({ name: common.name, ...ALIGN, station_interval: num('label every, m (default 20)') }, ['points']), (a) => {
    const doc = ctx.doc;
    const { geom, points: pts } = alignmentPoints(a);
    const res = reg.commands.get('create_curve').run({ points: pts.map(D.round3), kind: 'polyline', name: a.name || D.uniqueName(doc, 'Alignment'), color: '#d2453c' });
    const e = D.getEntity(doc, res.id);
    e.alignment = { ...a, length: r4(geom.length), interval: a.station_interval || 20 };
    return { ...summary(doc, e), length: r4(geom.length) };
  }, true);
  def('terrain', 'set_alignment', 'Change an alignment (points, radii, vertical profile…); corridors built on it follow.', obj({ id, ...ALIGN, station_interval: num('label every, m') }, ['id']), (a) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, a.id);
    if (!e.alignment) throw new Error(`${e.name} is not an alignment.`);
    const next = { ...e.alignment, ...Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'id' && v !== undefined)) };
    const { geom, points: pts } = alignmentPoints(next);
    reg.commands.get('set_curve').run({ id: e.id, points: pts.map(D.round3) });
    e.alignment = { ...next, length: r4(geom.length), interval: next.station_interval || next.interval || 20 };
    return { ...summary(doc, e), length: r4(geom.length) };
  }, true);
  def('terrain', 'create_corridor', 'A road / channel / embankment: a cross-section template (lanes with crossfall, shoulders, cut and fill batter slopes H:V) swept along an alignment, daylighting to the ground surface. Live: it follows the alignment and the ground.', obj({ alignment: str('alignment'), surface: str('existing ground to daylight to'), template: obj({ lanes: { type: 'array', items: obj({ width: num('m'), crossfall: num('%') }, []) }, shoulder: obj({ width: num('m'), crossfall: num('%') }, []), cut_slope: num('H:V, default 2'), fill_slope: num('H:V, default 3') }, []), interval: num('m between sections, default 5'), name: common.name, color: common.color }, ['alignment']), (a) => {
    const doc = ctx.doc;
    const [al] = D.resolve(doc, a.alignment);
    if (!al.curve) throw new Error(`${al.name} is not an alignment or curve.`);
    const inputs = [al.id, ...(a.surface ? [surfaceOf(a.surface).id] : [])];
    const params = { template: a.template || {}, interval: a.interval || 5 };
    R.getGenerator('corridor').run({ params, inputs: inputs.map((x) => D.getEntity(doc, x)), doc });
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Corridor'), material: { color: a.color || '#6b6f74', roughness: 0.95 } });
    R.derive(doc, e, 'corridor', params, inputs);
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), surface: TR.surfaceStats(e.mesh) };
  }, true);

  // quick field designs
  const makeDesign = (gen, params, name, color) => {
    const doc = ctx.doc;
    R.getGenerator(gen).run({ params, inputs: [], doc });
    const e = D.addEntity(doc, { name: name || D.uniqueName(doc, gen.replace('design_', '').replace(/_/g, ' ')), material: { color: color || '#e8bc5e', roughness: 0.9 } });
    R.derive(doc, e, gen, params, []);
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), surface: TR.surfaceStats(e.mesh) };
  };
  const P3 = (d) => ({ description: `${d}: a point name or [x, y, z] in the model` });
  def('terrain', 'design_line_slope', 'Design surface along a line with a cross slope either side (a pad or road edge).', obj({ from: P3('start'), to: P3('end'), left: num('m, default 5'), right: num('m, default 5'), left_slope: num('%, default −2'), right_slope: num('%, default −2'), name: common.name, color: common.color }, ['from', 'to']), (a) => makeDesign('design_line_slope', { from: designRef(a.from), to: designRef(a.to), left: a.left ?? 5, right: a.right ?? 5, left_slope: a.left_slope ?? -2, right_slope: a.right_slope ?? -2 }, a.name, a.color), true);
  def('terrain', 'design_plane', 'Design plane through three points, or through a point with a slope (%) falling towards a bearing (degrees from north).', obj({ points: { type: 'array', description: 'three point names or [x, y, z]' }, point: P3('or a point'), slope: num('%'), bearing: { description: 'degrees from north, or DMS' }, size: { type: 'array', items: { type: 'number' }, description: '[width, depth] m, default [20, 20]' }, name: common.name, color: common.color }), (a) =>
    makeDesign('design_plane', { ...(a.points ? { points: a.points.map(designRef) } : { point: designRef(a.point), slope: a.slope ?? 0, bearing: S.parseAngle(a.bearing ?? 0, S.geo(ctx.doc).angles) }), size: a.size || [20, 20] }, a.name, a.color), true);
  def('terrain', 'design_trench', 'A trench or ditch from one point to another: bottom width, depth below the ground (or invert levels / a grade), side slopes up to the ground surface. "1.2 m deep trench from MH1 to MH2 at 1% fall with 1:1 sides".', obj({ from: P3('start (e.g. MH1)'), to: P3('end'), bottom: num('bottom width, m (default 0.6)'), depth: num('below the ground at the start, m (default 1)'), grade: num('fall from start to end, % (instead of depth at the end)'), invert_from: num('invert level at the start (project)'), invert_to: num('invert level at the end (project)'), side_slope: num('H:V, default 1'), surface: str('ground surface to cut from'), name: common.name, color: common.color }, ['from', 'to']), (a) => {
    const doc = ctx.doc;
    const base = S.geo(doc).base?.[2] || 0;
    const from = designRef(a.from);
    const to = designRef(a.to);
    const p = { from, to, bottom: a.bottom ?? 0.6, depth: a.depth ?? 1, side_slope: a.side_slope ?? 1, ...(a.surface ? { surface: surfaceOf(a.surface).id } : {}) };
    if (a.invert_from !== undefined) p.invert_a = a.invert_from - base;
    if (a.invert_to !== undefined) p.invert_b = a.invert_to - base;
    if (a.grade !== undefined) {
      // invert at the end from the start's invert and the fall over the plan length
      const A = refPoint(doc, from);
      const B = refPoint(doc, to);
      const g0 = p.surface ? surfaceSampler(doc, D.getEntity(doc, p.surface)).z(A[0], A[2]) ?? A[1] : A[1];
      const ia = p.invert_a ?? g0 - p.depth;
      p.invert_a = ia;
      p.invert_b = ia - (Math.hypot(B[0] - A[0], B[2] - A[2]) * a.grade) / 100;
    }
    return makeDesign('design_trench', p, a.name || D.uniqueName(doc, 'Trench'), a.color || '#b58a57');
  }, true);
  def('terrain', 'design_offset_surface', 'A copy of a surface moved up or down (e.g. 0.3 m below existing ground for a topsoil strip); it follows the source.', obj({ surface: str('source surface'), offset: num('m, negative is below'), name: common.name, color: common.color }, ['surface', 'offset']), (a) => makeDesign('design_offset_surface', { surface: surfaceOf(a.surface).id, offset: a.offset }, a.name, a.color), true);
  def('terrain', 'design_road', 'A simple road surface: centreline points, width, crossfall falling both ways from the crown.', obj({ centre: { type: 'array', description: 'centreline point names or [x, y, z]' }, width: num('m, default 7'), crossfall: num('%, default −2.5'), name: common.name, color: common.color }, ['centre']), (a) => makeDesign('design_road', { centre: a.centre.map(designRef), width: a.width ?? 7, crossfall: a.crossfall ?? -2.5 }, a.name, a.color || '#3c3f44'), true);

  // ---------------------------------------------------------------- drawings: underlays, PDF, images, georeferencing (#140–#146)
  const underlayOf = (ref) => {
    const [e] = ref ? D.resolve(ctx.doc, ref) : targets(ctx, {});
    if (!e || !DW.isUnderlay(e)) throw new Error(`${e?.name ?? 'That'} is not an underlay (a placed PDF page or image).`);
    return e;
  };
  const ON_DRAWING = { description: 'a point on the drawing: [x, y, z] world (picked on it) or { u, v } in drawing units' };
  const TARGET = { description: 'a survey point name, { n, e } (project coordinates) or [x, y, z] world' };
  const PLACE = { scale: { description: 'drawing scale "1:500" (true size on the sheet × 500), or metres per unit (number)' }, dpi: num('scanned images: dots per inch (default 96)'), at: v3('world point for the top-left corner (default: centred on the origin)'), elevation: num('model height of the sheet (default 0)'), layer: str('layer for the underlay (default "Drawings")'), name: common.name };
  const readBytes = async (path) => {
    if (!ctx.io?.readBinary) throw new Error('Reading files needs the desktop app.');
    return new Uint8Array(await ctx.io.readBinary(path));
  };
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  const makeUnderlay = (a, u, size, affine) => {
    const doc = ctx.doc;
    if (!affine) {
      const s = typeof a.scale === 'number' ? a.scale : U.unitScale(u.kind, a.scale ?? 1, a.dpi);
      affine = a.at ? U.placeAffine(s, [a.at[0], -a.at[2]]) : U.placeAffine(s, [(-size[0] * s) / 2, (size[1] * s) / 2]);
    }
    L.ensureLayer(doc, a.layer || 'Drawings');
    return D.addEntity(doc, { type: 'underlay', name: a.name || D.uniqueName(doc, u.title), tag: a.layer || 'Drawings', position: [0, a.elevation ?? (a.at ? a.at[1] : 0), 0], underlay: { ...u, size, affine, opacity: 1, fade: 0, mono: false, control: [] }, material: { color: '#ffffff' } });
  };
  const underlayInfo = (e) => {
    const u = e.underlay;
    const [a, b, , d, ee] = u.affine;
    return { ...summary(ctx.doc, e), kind: u.kind, ...(u.kind === 'pdf' ? { page: u.page } : {}), units: u.kind === 'pdf' ? 'points' : 'pixels', size_units: u.size, metres_per_unit: [r4(Math.hypot(a, d)), r4(Math.hypot(b, ee))], rotation: r4((Math.atan2(d, a) * -180) / Math.PI), opacity: u.opacity, control_pairs: u.control.length, ...(u.georef ? { georef: { method: u.georef.method, rms: r4(u.georef.rms) } } : {}) };
  };

  def('drawings', 'pdf_info', 'Pages (size in points) and layers of a PDF file, before importing it.', obj({ path: str('absolute path of a .pdf') }, ['path']), async (a) => {
    const bytes = await readBytes(a.path);
    return PDF.info(await PDF.open(bytes, Assets.put(bytes, { mime: 'application/pdf', name: baseName(a.path) })));
  });
  def('drawings', 'import_pdf', 'Place PDF pages as underlays (drawings lying in the model to trace and build on). scale "1:500" puts the sheet at true size. Then calibrate_underlay or georeference_underlay, and extract_linework.', obj({ path: str('absolute path of a .pdf'), pages: { type: 'array', items: { type: 'number' }, description: 'page numbers (default [1])' }, hide_layers: { type: 'array', items: { type: 'string' }, description: 'PDF layers to hide' }, ...PLACE }, ['path']), async (a) => {
    const bytes = await readBytes(a.path);
    const asset = Assets.put(bytes, { mime: 'application/pdf', name: baseName(a.path) });
    const pdf = await PDF.open(bytes, asset);
    const inf = await PDF.info(pdf);
    const out = [];
    let dx = 0;
    for (const n of a.pages || [1]) {
      const pg = inf.pages[n - 1];
      if (!pg) throw new Error(`The PDF has ${inf.pages.length} page(s), not page ${n}.`);
      const s = typeof a.scale === 'number' ? a.scale : U.unitScale('pdf', a.scale ?? 1);
      const at = a.at ? [a.at[0] + dx, a.at[1] ?? 0, a.at[2]] : [-(pg.size[0] * s) / 2 + dx, 0, -(pg.size[1] * s) / 2];
      const e = makeUnderlay({ ...a, at, name: a.name || `${baseName(a.path).replace(/\.pdf$/i, '')}${(a.pages || [1]).length > 1 ? ` p${n}` : ''}` }, { kind: 'pdf', asset, page: n, title: baseName(a.path), hidden_layers: a.hide_layers || [] }, pg.size, null);
      dx += pg.size[0] * s * 1.05;
      out.push(underlayInfo(e));
    }
    ctx.selection.set(out.map((x) => x.id));
    return { underlays: out, layers: inf.layers.map((l) => l.name) };
  }, true);
  def('drawings', 'import_image', 'Place an image (PNG, JPG, TIFF / GeoTIFF) as an underlay. A world file next to it (.pgw, .jgw, .tfw, .wld) or GeoTIFF tags place it in project coordinates (local coordinates, no reprojection); otherwise scale it like a drawing.', obj({ path: str('absolute path of the image'), world_file: str('world file path (default: found next to the image)'), ...PLACE }, ['path']), async (a) => {
    const doc = ctx.doc;
    const bytes = await readBytes(a.path);
    let info = DW.imageSize(bytes);
    if (!info) throw new Error('Not an image this app reads: PNG, JPG, GIF, BMP or TIFF.');
    let geoA = null;
    if (info.tiff) {
      if (!ctx.io?.tiffInfo) throw new Error('Reading TIFF needs the desktop app.');
      const t = await ctx.io.tiffInfo(bytes);
      info = { ...info, width: t.width, height: t.height };
      geoA = U.affineFromGeoTiff(t.tags || {});
    }
    const ext = a.path.match(/\.(\w+)$/)?.[1]?.toLowerCase() || '';
    const wfs = a.world_file ? [a.world_file] : [`${ext[0]}${ext.at(-1)}w`, `${ext}w`, 'wld'].map((x) => a.path.replace(/\.\w+$/, `.${x}`));
    let wfUsed = null;
    for (const wf of wfs) {
      try {
        geoA = U.parseWorldFile(await ctx.io.readText(wf));
        wfUsed = wf;
        break;
      } catch (err) {
        if (a.world_file) throw new Error(`World file ${baseName(wf)}: ${err.message}`);
      }
    }
    const size = [info.width, info.height];
    const affine = geoA && !a.scale ? DW.projectToLocal(doc, geoA, size) : null;
    const e = makeUnderlay(a, { kind: 'image', asset: Assets.put(bytes, { mime: info.mime, name: baseName(a.path) }), title: baseName(a.path) }, size, affine);
    if (affine) e.underlay.georef = { method: wfUsed ? 'world file' : 'GeoTIFF', rms: 0 };
    ctx.selection.set([e.id]);
    return { ...underlayInfo(e), placed_by: wfUsed ? `world file ${baseName(wfUsed)}` : affine ? 'GeoTIFF tags' : 'scale' };
  }, true);
  def('drawings', 'list_underlays', 'Every underlay: kind, page, size, scale (metres per drawing unit), rotation, control points and georeference fit.', obj({}), () => ctx.doc.entities.filter(DW.isUnderlay).map(underlayInfo));
  def('drawings', 'set_underlay', 'Change how an underlay shows: opacity, fade (towards white, 0–1), monochrome, height, crop (a polygon of world points, or "none"), draw order, hidden PDF layers.', obj({ id, opacity: num('0–1'), fade: num('0–1'), mono: bool('black and white'), elevation: num('model height'), clip: { description: '[[x, y, z], …] world points (picked on the drawing), [[u, v], …] drawing units with units: "drawing", or "none"' }, units: str('world (default) | drawing', ['world', 'drawing']), draw_order: num('higher draws over lower'), hide_layers: { type: 'array', items: { type: 'string' }, description: 'PDF layers to hide' } }), (a) => {
    const e = underlayOf(a.id);
    const u = e.underlay;
    for (const k of ['opacity', 'fade', 'mono', 'draw_order']) if (a[k] !== undefined) u[k] = a[k];
    if (a.hide_layers) u.hidden_layers = a.hide_layers;
    if (a.elevation !== undefined) e.position[1] = a.elevation;
    if (a.clip === 'none') delete u.clip;
    else if (a.clip) {
      if (a.clip.length < 3) throw new Error('A crop needs 3 points or more.');
      u.clip = a.clip.map((p) => (a.units === 'drawing' ? [p[0], p[1]] : DW.sourcePoint(ctx.doc, e, p))).map((p) => p.map(r4));
    }
    return underlayInfo(e);
  }, true);
  def('drawings', 'calibrate_underlay', 'Put a drawing in place without coordinates: scale (two points and their real distance, or a drawing scale), orient (two points and the bearing of that line, 0 = north), move (a point on the drawing onto a survey point, { n, e } or a model point). Steps given together run in that order.', obj({ id, drawing_scale: str('"1:200": true size on the sheet × 200'), dpi: num('for images with drawing_scale'), scale: obj({ a: ON_DRAWING, b: ON_DRAWING, distance: num('real distance a → b, m') }, ['a', 'b', 'distance']), orient: obj({ a: ON_DRAWING, b: ON_DRAWING, bearing: num('degrees clockwise from north (0 = this line points north)') }, ['a', 'b', 'bearing']), move: obj({ from: ON_DRAWING, to: TARGET }, ['from', 'to']) }), (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    const u = e.underlay;
    const out = {};
    if (a.drawing_scale) {
      const s = U.unitScale(u.kind, a.drawing_scale, a.dpi);
      const [a0, , , d0] = u.affine;
      const k = s / Math.hypot(a0, d0);
      const o = U.apply(u.affine, [0, 0]);
      u.affine = U.compose([k, 0, o[0] * (1 - k), 0, k, o[1] * (1 - k)], u.affine);
      out.drawing_scale = a.drawing_scale;
    }
    const src = (p) => DW.sourcePoint(doc, e, p);
    if (a.scale) {
      const r = U.calibrateScale(u.affine, src(a.scale.a), src(a.scale.b), a.scale.distance);
      u.affine = r.affine;
      out.scale_factor = r4(r.factor);
    }
    if (a.orient) {
      const r = U.calibrateOrient(u.affine, src(a.orient.a), src(a.orient.b), a.orient.bearing);
      u.affine = r.affine;
      out.turned_degrees = r4(r.turned);
    }
    if (a.move) {
      const r = U.calibrateMove(u.affine, src(a.move.from), DW.frame(doc, e).toLocalPlan(DW.targetWorld(doc, a.move.to)));
      u.affine = r.affine;
      out.moved = r.by.map(r4);
    }
    delete u.georef;
    return { ...out, ...underlayInfo(e) };
  }, true);
  def('drawings', 'add_control_pair', 'Georeferencing: a point on the drawing matched to where it really is (a survey point name, { n, e } in project coordinates, or a model point). 2+ pairs, then georeference_underlay.', obj({ id, from: ON_DRAWING, to: TARGET, name: str('label, e.g. "GR1"') }, ['from', 'to']), (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    const [u, v] = DW.sourcePoint(doc, e, a.from);
    const g = S.geo(doc);
    // like the first survey point, the first real coordinate sets the base point so the model stays near the origin
    if (!g.base && Number.isFinite(a.to?.n)) g.base = [Math.round(a.to.e / 100) * 100, Math.round(a.to.n / 100) * 100, 0];
    const w = DW.targetWorld(doc, a.to);
    const { e: E, n: N } = S.toProject(doc, w);
    e.underlay.control.push({ name: a.name || (typeof a.to === 'string' ? a.to : `CP${e.underlay.control.length + 1}`), u: r4(u), v: r4(v), e: r4(E), n: r4(N), enabled: true });
    return { pairs: e.underlay.control.length, pair: e.underlay.control.at(-1) };
  }, true);
  def('drawings', 'edit_control_pair', 'Turn a control pair off / on, move either end, or remove it (by index from 0 or name).', obj({ id, pair: { description: 'index (0-based) or name' }, enabled: bool('use it in the fit'), from: ON_DRAWING, to: TARGET, remove: bool('delete it') }, ['pair']), (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    const c = e.underlay.control;
    const i = typeof a.pair === 'number' ? a.pair : c.findIndex((x) => x.name === a.pair);
    if (!c[i]) throw new Error(`No control pair ${a.pair}: ${c.map((x, k) => `${k} ${x.name}`).join(', ') || 'none yet'}.`);
    if (a.remove) return c.splice(i, 1), { pairs: c.length };
    if (a.enabled !== undefined) c[i].enabled = a.enabled;
    if (a.from) [c[i].u, c[i].v] = DW.sourcePoint(doc, e, a.from).map(r4);
    if (a.to) Object.assign(c[i], (({ e: E, n: N }) => ({ e: r4(E), n: r4(N) }))(S.toProject(doc, DW.targetWorld(doc, a.to))));
    return c[i];
  }, true);
  const georefReport = (e) => {
    const g = e.underlay.georef;
    if (!g?.residuals) return { georeferenced: !!g, ...(g ? { method: g.method } : {}), pairs: e.underlay.control.length };
    const used = e.underlay.control.filter((c) => c.enabled);
    return { method: g.method, rms: r4(g.rms), redundancy: g.redundancy, metres_per_unit: g.scale.map(r4), rotation: r4(g.rotation), pairs: used.map((c, i) => ({ name: c.name, dE: r4(g.residuals[i].dX), dN: r4(g.residuals[i].dY), d: r4(g.residuals[i].d), ...(i === g.worst && g.residuals.length > 2 && g.residuals[i].d > 2 * g.rms ? { flag: 'worst: check or turn off' } : {}) })) };
  };
  def('drawings', 'georeference_underlay', 'Fit the drawing to its control pairs by least squares, in local project coordinates: helmert (scale, rotation, shift; 2+ pairs) or affine (also skew, 3+ pairs). Returns residuals per pair and the RMS.', obj({ id, method: str('auto | similarity | helmert | affine', ['auto', 'similarity', 'helmert', 'affine']) }), (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    const f = DW.frame(doc, e);
    const pairs = e.underlay.control.filter((c) => c.enabled).map((c) => {
      const [X, Y] = f.toLocalPlan(S.toLocal(doc, { n: c.n, e: c.e, z: 0 }));
      return { u: c.u, v: c.v, X, Y };
    });
    const r = U.solve(pairs, a.method || 'auto');
    e.underlay.affine = r.affine;
    e.underlay.georef = { method: r.method, rms: r.rms, residuals: r.residuals, worst: r.worst, redundancy: r.redundancy, scale: r.scale, rotation: r.rotation };
    return georefReport(e);
  }, true);
  def('drawings', 'georef_report', 'The georeference fit of an underlay: residual per control pair, RMS, the worst pair.', obj({ id }), (a) => georefReport(underlayOf(a.id)));
  def('drawings', 'export_world_file', 'Write a world file (.pgw / .jgw / .tfw / .wld: six lines, project E / N) for an underlay, so GIS and CAD place the image too.', obj({ id, path: str('absolute path of the world file') }, ['path']), async (a) => {
    const e = underlayOf(a.id);
    const text = DW.worldFileOf(ctx.doc, e);
    if (!ctx.io?.writeText) throw new Error('Writing files needs the desktop app.');
    await ctx.io.writeText(a.path, text);
    return { path: a.path, world_file: text.trim().split('\n') };
  });

  const pdfContent = async (e) => {
    if (e.underlay.kind !== 'pdf') throw new Error(`${e.name} is an image: it has no vectors (trace it, or vectorise it).`);
    return PDF.content(await PDF.open(Assets.bytes(e.underlay.asset), e.underlay.asset), e.underlay.page);
  };
  const WINDOW = { description: 'only inside this box: two opposite world corners [[x, y, z], [x, y, z]] picked on the drawing' };
  const winOf = (e, w) => w && w.map((p) => DW.sourcePoint(ctx.doc, e, p));
  def('drawings', 'pdf_linework_stats', 'What a PDF underlay holds before extracting: paths per PDF layer, colour and line width, hatching, fills, dashed lines, text count.', obj({ id, window: WINDOW }), async (a) => {
    const e = underlayOf(a.id);
    const c = await pdfContent(e);
    const { kept } = DW.filterPaths(c.paths, { window: winOf(e, a.window), hatch: true, fills: true });
    return { ...DW.pathStats(kept), texts: c.texts.length };
  });
  def('drawings', 'extract_linework', 'Turn a PDF underlay\'s vector lines into curves in the model (on the drawing, georeferenced with it): filter by PDF layer, colour, line width, dashes and a window; ends welded and joined into polylines, duplicates dropped, hatching skipped. Curves land on layers named after the PDF layers (or colours).', obj({ id, layers: { type: 'array', items: { type: 'string' }, description: 'PDF layers to keep' }, colors: { type: 'array', items: { type: 'string' }, description: 'stroke colours to keep, "#ff0000"' }, min_width: num('thinnest line kept, points'), max_width: num('thickest line kept, points'), dashed: bool('only dashed (true) or only solid (false)'), window: WINDOW, tolerance: num('weld / join distance, m (default 0.01)'), join: bool('join touching pieces (default true)'), hatch: bool('keep hatching too'), fills: bool('keep filled shapes\' outlines too'), layer: str('put everything on this layer instead'), prefix: str('layer name prefix (default "PDF ")'), elevation: num('model height of the curves (default: the drawing\'s)') }), async (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    const c = await pdfContent(e);
    const { kept, skipped } = DW.filterPaths(c.paths, { ...a, window: winOf(e, a.window) });
    const lines = DW.cleanLines(kept, e.underlay.affine, { tol: a.tolerance ?? 0.01, join: a.join !== false });
    const f = DW.frame(doc, e);
    const prefix = a.prefix ?? 'PDF ';
    const made = [];
    const y = a.elevation;
    for (const l of lines) {
      const pts = l.pts.map((p) => f.planToWorld(p)).map((p) => D.round3(y === undefined ? p : [p[0], y, p[2]]));
      const layer = a.layer || `${prefix}${l.layer ?? l.color}`;
      const t = L.ensureLayer(doc, layer);
      if (!a.layer && !l.layer && !t.color) t.color = l.color;
      if (!a.layer && l.layer && !t.color) t.color = l.color;
      const { mesh, origin } = G.recenter({ v: pts, f: [] });
      made.push(D.addEntity(doc, { type: 'curve', name: D.uniqueName(doc, layer.replace(prefix, '')), curve: { kind: 'polyline', points: mesh.v, closed: l.closed }, position: D.round3(origin), tag: layer, byLayer: true, material: { color: l.color }, meta: { source: e.name, width_pt: l.width, ...(l.dashed ? { dashed: true } : {}) } }));
    }
    ctx.selection.set(made.map((x) => x.id));
    const byLayer = made.reduce((m, x) => ((m[x.tag] = (m[x.tag] || 0) + 1), m), {});
    return { curves: made.length, from_paths: kept.length, skipped, layers: byLayer };
  }, true);
  def('drawings', 'list_drawing_text', 'The text on a PDF underlay with world positions: spot heights, labels, point numbers, titles. contains filters with a regex.', obj({ id, contains: str('regex, e.g. "^[+]?\\\\d+\\\\.\\\\d+$" for spot heights'), window: WINDOW, limit: num('default 500') }), async (a) => {
    const e = underlayOf(a.id);
    const c = await pdfContent(e);
    const re = a.contains ? new RegExp(a.contains, 'i') : null;
    const w = winOf(e, a.window);
    const t = c.texts.filter((x) => (!re || re.test(x.str)) && (!w || DW.filterPaths([{ pts: [x.at], color: '', width: 0 }], { window: w }).kept.length));
    return { count: t.length, texts: DW.textsInWorld(ctx.doc, e, t.slice(0, a.limit || 500)) };
  });

  // ---------------------------------------------------------------- drafting on curves (#147)
  // world points of a curve; a closed one without its repeated first point (the drafting maths closes it itself)
  const curve2d = (e) => {
    const pts3 = D.curvePoints(ctx.doc, e);
    const closed = !!e.curve.closed;
    if (closed && pts3.length > 3 && G.len(G.sub(pts3[0], pts3.at(-1))) < 1e-9) pts3.pop();
    return { e, pts3, closed };
  };
  const setPts = (e, pts3, closed = e.curve.closed) => {
    const { mesh, origin } = G.recenter({ v: pts3.map(D.round3), f: [] });
    e.curve = { kind: 'polyline', points: mesh.v, closed: !!closed };
    e.position = D.round3(origin);
    e.rotation = [0, 0, 0];
    e.scale = [1, 1, 1];
  };
  const newCurve = (from, pts3, closed, name) => {
    const { mesh, origin } = G.recenter({ v: pts3.map(D.round3), f: [] });
    return D.addEntity(ctx.doc, { type: 'curve', name: name || D.uniqueName(ctx.doc, from.name), curve: { kind: 'polyline', points: mesh.v, closed: !!closed }, position: D.round3(origin), tag: from.tag, byLayer: from.byLayer, material: { ...from.material }, ...(from.meta ? { meta: { ...from.meta } } : {}) });
  };
  const oneCurve = (ref) => {
    const [e] = ref ? D.resolve(ctx.doc, ref) : targets(ctx, {});
    if (!e?.curve) throw new Error(`${e?.name ?? 'That'} is not a curve.`);
    return e;
  };
  const flat = (p) => [p[0], -p[2]];
  const cross2 = (p, q) => p[0] * q[1] - p[1] * q[0];
  const cutters = (except, refs) => (refs ? refs.map((r) => D.resolve(ctx.doc, r)[0]) : ctx.doc.entities.filter((x) => x.curve && x.visible && x.id !== except.id)).filter((x) => x.curve && x.id !== except.id).map((x) => {
    const c = curve2d(x);
    return DR.flat(c.closed ? [...c.pts3, c.pts3[0]] : c.pts3);
  });
  const BOUND = { type: 'array', items: { type: 'string' }, description: 'boundary curves (default: every other visible curve)' };
  const AT = v3('a world point near the piece / end meant (picked)');

  def('drafting', 'offset_curve', 'A parallel copy of a curve at a distance: left or right of its direction (seen from above), both sides, or through a point. Corners are mitred.', obj({ id, distance: num('m'), side: str('left | right | both (default left); closed curves also inside | outside', ['left', 'right', 'both', 'inside', 'outside']), through: v3('or: the copy passes through this world point'), name: common.name }), (a) => {
    const e = oneCurve(a.id);
    const c = curve2d(e);
    const P = DR.flat(c.pts3);
    let ds;
    if (a.through) {
      const h = DR.nearest(P, flat(a.through), c.closed);
      const P2 = c.closed ? [...P, P[0]] : P;
      const t = [P2[h.i + 1][0] - P2[h.i][0], P2[h.i + 1][1] - P2[h.i][1]];
      const q = flat(a.through);
      ds = [Math.sign(t[0] * (q[1] - h.p[1]) - t[1] * (q[0] - h.p[0])) * h.d];
    } else {
      if (!(a.distance > 0)) throw new Error('Give distance (above 0) or through.');
      if ((a.side === 'inside' || a.side === 'outside') && !c.closed) throw new Error(`${e.name} is open: inside / outside need a closed curve (use left or right).`);
      // shoelace: counter-clockwise in plan (seen from above) has its inside on the left
      const ccw = P.reduce((acc, p, i) => acc + cross2(p, P[(i + 1) % P.length]), 0) > 0;
      const inward = ccw ? 1 : -1;
      ds = a.side === 'both' ? [a.distance, -a.distance] : a.side === 'inside' ? [inward * a.distance] : a.side === 'outside' ? [-inward * a.distance] : [a.side === 'right' ? -a.distance : a.distance];
    }
    const made = ds.map((d, i) => newCurve(e, DR.lift(DR.offset(P, d, c.closed), c.pts3, c.closed), c.closed, a.name && ds.length > 1 ? `${a.name} ${i + 1}` : a.name));
    ctx.selection.set(made.map((x) => x.id));
    return made.map((x) => summary(ctx.doc, x));
  }, true);
  def('drafting', 'trim', 'Cut away the piece of a curve between its crossings with boundary curves, the piece nearest `at`.', obj({ id, at: AT, boundaries: BOUND }, ['at']), (a) => {
    const e = oneCurve(a.id);
    const c = curve2d(e);
    const pieces = DR.trim(DR.flat(c.pts3), cutters(e, a.boundaries), flat(a.at), c.closed);
    if (!pieces.length) return D.removeEntity(ctx.doc, e), { removed: e.id };
    setPts(e, DR.lift(pieces[0], c.pts3, c.closed), false);
    const extra = pieces.slice(1).map((p) => newCurve(e, DR.lift(p, c.pts3, c.closed), false));
    return [e, ...extra].map((x) => summary(ctx.doc, x));
  }, true);
  def('drafting', 'extend', 'Extend a curve\'s end straight on to the nearest boundary curve ahead.', obj({ id, end: { description: '"start", "end" (default) or a world point near the end' }, boundaries: BOUND }), (a) => {
    const e = oneCurve(a.id);
    const c = curve2d(e);
    if (c.closed) throw new Error(`${e.name} is closed: it has no ends.`);
    const P = DR.extend(DR.flat(c.pts3), cutters(e, a.boundaries), Array.isArray(a.end) ? flat(a.end) : a.end || 'end');
    setPts(e, DR.lift(P, c.pts3)); // the new end takes the height of the old one
    return summary(ctx.doc, e);
  }, true);
  const corner = (name, cham) => (a) => {
    const ents = targets(ctx, a);
    if (!ents.length || ents.length > 2 || ents.some((x) => !x.curve)) throw new Error(`${name} takes one curve (its corners) or two curves (where they meet).`);
    const dd = cham ? [a.distance, a.distance2 ?? a.distance] : null;
    if (cham ? !(a.distance > 0) : !(a.radius > 0)) throw new Error(cham ? 'distance must be above 0.' : 'radius must be above 0.');
    if (ents.length === 1) {
      const c = curve2d(ents[0]);
      setPts(ents[0], DR.lift(DR.fillet(DR.flat(c.pts3), a.radius, a.vertex ?? null, c.closed, dd), c.pts3, c.closed));
      return summary(ctx.doc, ents[0]);
    }
    const [A, B] = ents.map(curve2d);
    const P = DR.filletPair(DR.flat(A.pts3), DR.flat(B.pts3), a.radius, dd);
    setPts(ents[0], DR.lift(P, [...A.pts3, ...B.pts3]), false);
    D.removeEntity(ctx.doc, ents[1]);
    ctx.selection.set([ents[0].id]);
    return { ...summary(ctx.doc, ents[0]), joined: ents[1].name };
  };
  def('drafting', 'fillet', 'Round corners with a radius: every corner of one curve (or one, by vertex index), or where two curves meet (they are trimmed or stretched to the corner and joined).', obj({ ids, radius: num('m'), vertex: num('one corner only (index)') }, ['radius']), corner('fillet'), true);
  def('drafting', 'chamfer', 'Cut corners straight: every corner of one curve (or one, by vertex), or where two curves meet.', obj({ ids, distance: num('m along the first side'), distance2: num('m along the second side (default the same)'), vertex: num('one corner only (index)') }, ['distance']), corner('chamfer', true), true);
  def('drafting', 'join_curves', 'Join curves whose ends touch (within tolerance) into polylines; a chain that comes back to its start is closed.', obj({ ids, layer: str('or: every curve on layers matching this glob'), tolerance: num('m, default 0.01') }), (a) => {
    const ents = DW.curvesOf(ctx.doc, a.layer ? [] : targets(ctx, a), a.layer);
    const lines = ents.map((e) => ({ pts: curve2d(e).pts3, closed: !!e.curve.closed, key: 0, e }));
    const tol = a.tolerance ?? 0.01;
    const flatLines = lines.map((l) => ({ ...l, pts: DR.flat(l.pts) }));
    const joined = DR.join(flatLines, tol);
    const src3 = lines.flatMap((l) => l.pts);
    for (const e of ents) D.removeEntity(ctx.doc, e);
    const made = joined.map((j) => newCurve(j.e, DR.lift(j.pts, src3), j.closed, j.e.name));
    ctx.selection.set(made.map((x) => x.id));
    return { before: ents.length, after: made.length, closed: made.filter((x) => x.curve.closed).length };
  }, true);
  def('drafting', 'explode_curve', 'Split a polyline into one curve per straight piece.', obj({ id }), (a) => {
    const e = oneCurve(a.id);
    const c = curve2d(e);
    const P = c.closed ? [...c.pts3, c.pts3[0]] : c.pts3;
    const made = P.slice(1).map((p, i) => newCurve(e, [P[i], p], false, `${e.name} ${i + 1}`));
    D.removeEntity(ctx.doc, e);
    ctx.selection.set(made.map((x) => x.id));
    return { pieces: made.length };
  }, true);
  def('drafting', 'break_curve', 'Split a curve at a point (two curves), or take out the part between two points.', obj({ id, at: AT, at2: v3('second point: remove what lies between') }, ['at']), (a) => {
    const e = oneCurve(a.id);
    const c = curve2d(e);
    const pieces = DR.breakAt(DR.flat(c.pts3), flat(a.at), a.at2 ? flat(a.at2) : null, c.closed);
    if (!pieces.length) throw new Error('Nothing left after that break.');
    setPts(e, DR.lift(pieces[0], c.pts3, c.closed), false);
    const extra = pieces.slice(1).map((p) => newCurve(e, DR.lift(p, c.pts3, c.closed), false));
    return [e, ...extra].map((x) => summary(ctx.doc, x));
  }, true);
  def('drafting', 'simplify_curve', 'Fewer points, same shape within a tolerance (Douglas–Peucker); also merges straight runs.', obj({ ids, layer: str('or: every curve on layers matching this glob'), tolerance: num('m, default 0.05') }), (a) => {
    const ents = DW.curvesOf(ctx.doc, a.layer ? [] : targets(ctx, a), a.layer);
    let before = 0;
    let after = 0;
    for (const e of ents) {
      const c = curve2d(e);
      const P = DR.simplify(DR.flat(c.pts3), a.tolerance ?? 0.05, c.closed);
      before += c.pts3.length;
      after += P.length;
      setPts(e, DR.lift(P, c.pts3, c.closed));
    }
    return { curves: ents.length, points_before: before, points_after: after };
  }, true);
  def('drafting', 'divide_curve', 'Points along a curve: count equal parts or every spacing metres. Makes survey points (with a code) unless points: false.', obj({ id, count: num('equal parts'), spacing: num('m between points'), points: bool('make survey points (default true)'), code: str('their code') }), (a) => {
    const e = oneCurve(a.id);
    const c = curve2d(e);
    if (!(a.count > 0) && !(a.spacing > 0)) throw new Error('Give count or spacing.');
    const pts = DR.lift(DR.divide(DR.flat(c.pts3), { count: a.count, spacing: a.spacing }, c.closed), c.pts3, c.closed).map(D.round3);
    if (a.points === false) return { points: pts };
    const made = pts.map((w) => S.addPoint(ctx.doc, { ...S.toProject(ctx.doc, w), code: a.code || '' }));
    ctx.selection.set(made.map((x) => x.id));
    return { points: made.map((p) => p.name) };
  }, true);

  // ---------------------------------------------------------------- linework to model (#148)
  const LW = { ids, layer: str('or: every curve on layers matching this glob ("A-BLDG*")') };
  def('drawings', 'elevate_linework', 'Give 2D linework heights: a constant elevation, draped on a surface, graded between start and end elevations, a slope from the start, or from spot-height text on a PDF underlay (a vertex takes the nearest label; vertices between labels grade evenly). Elevations are project Z.', obj({ ...LW, mode: str('constant | surface | grade | slope | text', ['constant', 'surface', 'grade', 'slope', 'text']), elevation: num('constant: project Z; slope: Z at the start'), start: num('grade: Z at the start'), end: num('grade: Z at the end'), slope: num('slope: % (+ up along the curve)'), surface: str('surface: the TIN to drape on'), underlay: str('text: the PDF underlay with spot heights'), contains: str('text: regex the labels match (default numbers)'), max_distance: num('text: farthest label, m (default 10)') }, ['mode']), async (a) => {
    const doc = ctx.doc;
    const ents = DW.curvesOf(doc, a.layer ? [] : targets(ctx, a), a.layer);
    const baseZ = S.geo(doc).base?.[2] ?? 0;
    let zAt;
    if (a.mode === 'constant') zAt = () => a.elevation - baseZ;
    else if (a.mode === 'surface') {
      const smp = surfaceSampler(doc, surfaceOf(a.surface));
      zAt = (p) => {
        const z = smp.z(p[0], p[2]);
        if (z === null || z === undefined || Number.isNaN(z)) throw new Error('Part of the linework lies off the surface.');
        return z;
      };
    } else if (a.mode === 'text') {
      const e = underlayOf(a.underlay);
      const re = new RegExp(a.contains || '^[+-]?\\d+(?:[.,]\\d+)?$');
      const labels = DW.textsInWorld(doc, e, (await pdfContent(e)).texts.filter((t) => re.test(t.str))).map((t) => ({ at: t.at, z: DW.numberIn(t.str) })).filter((t) => t.z !== null);
      if (!labels.length) throw new Error('No spot-height labels found on that drawing (check contains).');
      const max = a.max_distance ?? 10;
      zAt = (p) => {
        let best = null;
        for (const t of labels) {
          const d = Math.hypot(t.at[0] - p[0], t.at[2] - p[2]);
          if (d <= max && (!best || d < best.d)) best = { d, z: t.z };
        }
        return best ? best.z - baseZ : null; // vertices without a label are filled in along the curve below
      };
    } else if (a.mode !== 'grade' && a.mode !== 'slope') throw new Error('mode: constant, surface, grade, slope or text.');
    const skipped = [];
    for (const e of ents) {
      const c = curve2d(e);
      const P = DR.flat(c.pts3);
      const total = DR.length(P);
      let s = 0;
      const ch = [];
      const ys = c.pts3.map((p, i) => {
        if (i) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        ch.push(s);
        return a.mode === 'grade' ? a.start - baseZ + ((a.end - a.start) * s) / (total || 1) : a.mode === 'slope' ? a.elevation - baseZ + (s * a.slope) / 100 : zAt(p);
      });
      const known = ys.map((y, i) => (y === null ? -1 : i)).filter((i) => i >= 0);
      if (!known.length) {
        skipped.push(e.name);
        continue;
      }
      // between labelled vertices: an even grade; beyond the first and last: level
      ys.forEach((y, i) => {
        if (y !== null) return;
        const lo = known.findLast((k) => k < i);
        const hi = known.find((k) => k > i);
        ys[i] = lo === undefined ? ys[hi] : hi === undefined ? ys[lo] : ys[lo] + ((ys[hi] - ys[lo]) * (ch[i] - ch[lo])) / (ch[hi] - ch[lo] || 1);
      });
      setPts(e, c.pts3.map((p, i) => [p[0], ys[i], p[2]]));
    }
    if (skipped.length === ents.length) throw new Error(`No label within ${a.max_distance ?? 10} m of ${skipped.join(', ')}.`);
    return { curves: ents.length - skipped.length, mode: a.mode, ...(skipped.length ? { skipped_no_labels: skipped } : {}) };
  }, true);
  def('drawings', 'linework_to_breaklines', 'Turn curves into survey breaklines (or surface boundaries): a survey point at each vertex, joined by a breakline the surfaces follow.', obj({ ...LW, kind: str('breakline (default) | boundary | hole', ['breakline', 'boundary', 'hole']), code: str('code of the new points (default BRK)') }), (a) => {
    const doc = ctx.doc;
    const ents = DW.curvesOf(doc, a.layer ? [] : targets(ctx, a), a.layer);
    const made = [];
    for (const e of ents) {
      const c = curve2d(e);
      const pts = c.pts3.map((w) => S.addPoint(doc, { ...S.toProject(doc, w), code: a.code || 'BRK' }));
      const kind = a.kind === 'boundary' || a.kind === 'hole' ? 'boundary' : 'breakline';
      made.push(D.addEntity(doc, { type: 'linework', name: D.uniqueName(doc, `${e.name} ${kind}`), tag: e.tag, line: { points: pts.map((p) => p.id), kind, closed: c.closed || kind === 'boundary', ...(kind === 'boundary' ? { boundary: a.kind === 'hole' ? 'hole' : 'outer' } : {}) }, material: { color: e.material.color } }));
    }
    ctx.selection.set(made.map((x) => x.id));
    return { linework: made.map((x) => x.name), points: made.reduce((s, x) => s + x.line.points.length, 0) };
  }, true);
  def('drawings', 'extrude_linework', 'Extrude closed curves up into solids (footprints → buildings), each staying live on its curve.', obj({ ...LW, height: num('m'), color: common.color }, ['height']), (a) => {
    const doc = ctx.doc;
    const ents = DW.curvesOf(doc, a.layer ? [] : targets(ctx, a), a.layer).filter((e) => e.curve.closed);
    if (!ents.length) throw new Error('No closed curves to extrude (join_curves can close chains).');
    const made = ents.map((c) => {
      const e = D.addEntity(doc, { name: D.uniqueName(doc, `${c.name} block`), tag: c.tag, material: { color: a.color || '#d9d4c7' } });
      R.derive(doc, e, 'extrude_curve', { height: a.height }, [c.id]);
      return e;
    });
    ctx.selection.set(made.map((x) => x.id));
    return { solids: made.length };
  }, true);
  def('drawings', 'sweep_linework', 'Sweep a profile (kerb, wall, pipe…) along every picked curve; each sweep stays live on its curve.', obj({ ...LW, profile: { description: 'profile name (list_profiles) or [[u, v], …]' }, profile_params: obj({}, []), color: common.color }, ['profile']), async (a) => {
    const ents = DW.curvesOf(ctx.doc, a.layer ? [] : targets(ctx, a), a.layer);
    const made = [];
    for (const c of ents) made.push((await reg.run('sweep', { path: c.id, profile: a.profile, profile_params: a.profile_params, color: a.color, tag: c.tag })).id);
    ctx.selection.set(made);
    return { sweeps: made.length };
  }, true);
  reg.commands.get('sweep_linework').compound = true;

  // ---------------------------------------------------------------- curves, sweeps, profiles
  def('create', 'create_curve', 'A path in 3D for sweeps, motion paths and camera moves: polyline (straight legs), spline (smooth through every point) or bezier (point, handle, handle, point, …).', obj({ points: { type: 'array', items: v3('point'), description: '[[x,y,z], …] world points' }, kind: str('polyline (default) | spline | bezier', C.KINDS), closed: bool('loop back to the start'), name: common.name, color: common.color, tag: common.tag }, ['points']), (a) => {
    const doc = ctx.doc;
    const curve = { kind: a.kind || 'polyline', points: a.points, closed: !!a.closed };
    C.checkCurve(curve);
    const { mesh, origin } = G.recenter({ v: a.points, f: [] });
    const count = doc.entities.filter((e) => e.type === 'curve').length + 1;
    const e = D.addEntity(doc, { type: 'curve', name: a.name || `Curve ${count}`, curve: { ...curve, points: mesh.v }, position: D.round3(origin), tag: a.tag, material: { color: a.color || '#2f6f86' } });
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
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, `${typeof params.profile === 'string' ? params.profile.replace(/_/g, ' ') : 'Profile'} sweep`), tag: a.tag, material: a.color ? { color: a.color } : {} });
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
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, a.generator.replace(/_/g, ' ')), tag: a.tag, material: a.color ? { color: a.color } : {} });
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
  def('view', 'set_style', 'Display style: edges, x-ray, wireframe, shadows, grid, sun position, survey point labels.', obj({ point_labels: str('survey point labels', ['name', 'name_z', 'code', 'all', 'none']), edges: bool(''), xray: bool(''), wireframe: bool(''), shadows: bool(''), grid: bool(''), sun: obj({ azimuth: num('degrees from north (−z), clockwise'), elevation: num('degrees above horizon') }) }), (a) => {
    const s = ctx.doc.settings;
    for (const k of ['edges', 'xray', 'wireframe', 'shadows', 'grid', 'point_labels']) if (a[k] !== undefined) s[k] = a[k];
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
  // ---------------------------------------------------------------- files: models and exchange formats (#152)
  const MODEL_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'png', 'video'];
  def('file', 'list_formats', 'File formats this app reads and writes, with their options (LandXML, IFC, DXF and models).', obj({}), () => [...F.listFormats(), { id: 'glb / gltf / obj / stl / fbx', label: '3D models (insert)', import: true, export: true }]);
  def('file', 'import', 'Bring a file into the current model: LandXML (points, surfaces, alignments, linework), IFC (BIM elements with property sets, storeys, layers, georeferencing), DXF (CAD linework, layers, blocks as components, 3D faces) or a 3D model (glb, gltf, obj, stl, fbx). Returns what came in, what was skipped and why.', obj({ path: str('absolute path'), text: str('or: the file contents (text formats)'), format: str('when the extension does not say: landxml | ifc | dxf'), layer: str('put everything on this layer'), coordinates: str('DXF: project (E, N, Z) or local; default: project when the numbers are big', ['project', 'local']), units: str('DXF without units: m | ft | usft'), properties: bool('IFC: read property sets (default true)') }), async (a) => {
    const doc = ctx.doc;
    if (!a.path && a.text === undefined) {
      a.path = await needIO().pick('import', false);
      if (!a.path) return { cancelled: true };
    }
    let fmt = a.format ? F.getFormat(a.format) : a.path ? F.formatFor(a.path) : null;
    if (a.format && !fmt) throw new Error(`Unknown format "${a.format}". list_formats shows them.`);
    if (!fmt && a.path) return needIO().importModel(a.path);
    if (!fmt) throw new Error('Give path, or text with format.');
    if (!fmt.read) throw new Error(`${fmt.label}: export only.`);
    let data = a.text;
    if (data === undefined) data = fmt.binary ? await needIO().readBinary(a.path) : await needIO().readText(a.path);
    if (!a.format && a.path) fmt = F.formatFor(a.path, data); // .xml is shared: look inside
    if (fmt.binary && typeof data === 'string') data = new TextEncoder().encode(data);
    const report = F.newReport();
    const before = new Set(doc.entities.map((e) => e.id));
    const extra = await fmt.read(data, { doc, cmd: (n, x) => reg.commands.get(n).run(x), report, opts: a });
    const made = doc.entities.filter((e) => !before.has(e.id) && (!e.parent || before.has(e.parent)));
    if (!made.length) throw new Error(`Nothing to import in that ${fmt.id.toUpperCase()} file${report.done().skipped.length ? `: ${report.done().skipped.map((x) => x.what).join('; ')}` : ''}.`);
    ctx.selection.set(made.filter((e) => !S.isPoint(e)).map((e) => e.id).slice(0, 2000));
    return report.done({ format: fmt.id, file: a.path ? String(a.path).split(/[\\/]/).pop() : undefined, ...(extra || {}) });
  }, true);
  def('file', 'export', `Export: ${MODEL_FORMATS.join(', ')} (models, viewport image, video) or an exchange format: landxml (points, surfaces, alignments, linework), ifc (BIM: IFC4, or IFC4X3 with schema), dxf (CAD R12: layers, polylines, points, 3D faces, components as blocks). selection: only the selected entities.`, obj({ format: str('format: glb, gltf, obj, stl, png, video, landxml, ifc, dxf'), path: str('absolute output path; omit to be asked'), selection: bool('only the selection (and what is inside it)'), schema: str('IFC: IFC4 (default) or IFC4X3'), coordinates: str('DXF: project (E, N, Z, default) or local', ['project', 'local']), name: str('project name written in the file') }, ['format']), async (a) => {
    const fmt = F.getFormat(a.format);
    if (!fmt) {
      if (!MODEL_FORMATS.includes(a.format)) throw new Error(`Unknown format "${a.format}". list_formats shows them.`);
      return needIO().exportAs(a.format, a.path);
    }
    if (!fmt.write) throw new Error(`${fmt.label}: import only.`);
    const doc = ctx.doc;
    const ents = a.selection ? [...new Set(targets(ctx, {}).flatMap((e) => [e, ...D.descendants(doc, e.id)]))] : doc.entities;
    if (!ents.length) throw new Error('Nothing to export (the selection is empty).');
    const text = fmt.write(doc, { ents, opts: { ...a, version: ctx.version } });
    const io = needIO();
    const path = a.path || (await io.pick(fmt.id, true, `Model.${fmt.extensions[0]}`));
    if (!path) return { cancelled: true };
    await io.writeText(path, text);
    return { path, format: fmt.id, bytes: text.length, entities: ents.length };
  }, true);
  reg.commands.get('import').compound = true;

  // ---------------------------------------------------------------- feature layers and their attribute table (#125)
  const WHERE = { description: 'attribute filters: { field: value | { min, max } | { contains: "text" } }' };
  const featuresOf = (a) => {
    const doc = ctx.doc;
    const match = L.matcher(a.layer || '*');
    let list = (a.ids?.length ? D.resolve(doc, a.ids) : doc.entities.filter((e) => match(e.tag))).filter((e) => !e.parent || !D.getEntity(doc, e.parent)?.component);
    if (a.code) list = list.filter((e) => S.isPoint(e) && S.parseCode(e.point.code).code === a.code.toUpperCase());
    for (const [k, w] of Object.entries(a.where || {})) {
      const val = (e) => (k === 'name' ? e.name : k === 'code' && e.point ? e.point.code : e.meta?.[k]);
      list = list.filter((e) => {
        const v = val(e);
        if (w && typeof w === 'object') return (w.min === undefined || v >= w.min) && (w.max === undefined || v <= w.max) && (w.contains === undefined || String(v ?? '').toLowerCase().includes(String(w.contains).toLowerCase()));
        return String(v) === String(w);
      });
    }
    if (a.min_z !== undefined || a.max_z !== undefined) {
      list = list.filter((e) => {
        const z = S.toProject(doc, D.worldBox(doc, e).min).z;
        return (a.min_z === undefined || z >= a.min_z) && (a.max_z === undefined || z <= a.max_z);
      });
    }
    if (a.inside) {
      const [b] = D.resolve(doc, a.inside);
      const ring = (b.curve ? D.curvePoints(doc, b) : b.line ? S.lineworkPath(doc, b) : null)?.map((p) => [p[0], p[2]]);
      if (!ring || ring.length < 3) throw new Error(`${b.name} is not a closed curve or boundary.`);
      const inRing = ([x, z]) => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > z !== ring[j][1] > z && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
        return c;
      };
      list = list.filter((e) => {
        const bx = D.worldBox(doc, e);
        return inRing([(bx.min[0] + bx.max[0]) / 2, (bx.min[2] + bx.max[2]) / 2]);
      });
    }
    return list;
  };
  def('layers', 'query_features', 'Find features by layer (glob), code, attribute values (equal, range, contains), elevation range or inside a closed boundary; selects them and returns their attributes.', obj({ layer: str('layer name or glob'), code: str('survey code'), where: WHERE, min_z: num('elevation at least (project)'), max_z: num('elevation at most'), inside: str('a closed curve or boundary'), select: bool('select them (default true)'), limit: num('rows returned, default 200') }), (a) => {
    const list = featuresOf(a);
    if (a.select !== false) ctx.selection.set(list.map((e) => e.id));
    return { count: list.length, features: list.slice(0, a.limit || 200).map((e) => ({ id: e.id, name: e.name, layer: e.tag, ...(e.point ? { code: e.point.code } : {}), attributes: e.meta || {} })) };
  });
  def('layers', 'edit_attributes', 'Set attribute values on many features at once: picked by ids, or by layer + where (the same filters as query_features). Values are checked against the layer\'s attribute schema.', obj({ ids, layer: str('layer name or glob'), where: WHERE, code: str('survey code'), values: obj({}, []), remove: { type: 'array', items: { type: 'string' }, description: 'attribute names to delete' } }), (a) => {
    if (!a.ids?.length && !a.layer && !a.where && !a.code) a.ids = ctx.selection.get();
    const list = featuresOf(a);
    if (!list.length) throw new Error('No features match.');
    for (const e of list) {
      e.meta = { ...(e.meta || {}), ...L.checkAttributes(L.layerOf(ctx.doc, e.tag), a.values || {}) };
      for (const k of a.remove || []) delete e.meta[k];
      if (!Object.keys(e.meta).length) delete e.meta;
    }
    return { edited: list.length };
  }, true);
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
