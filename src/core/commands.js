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
import * as RV from './review.js';
import * as AN from './annotate.js';
import * as SEC from './section.js';
import * as SHT from './sheet.js';
import * as SUN from './sun.js';
import * as LK from './look.js';
import * as IG from './imagegen.js';
import * as SQ from './sequencing.js';
import * as PH from './physics.js';
import * as MD from './modeling.js';
import * as SVG from './svg.js';
import * as PC from './pointcloud.js';
import * as RS from './raster.js';
import * as DC from './drawingclues.js';
import * as IO2 from './interop.js';
import * as SC from './shortcuts.js';
import * as I18N from './i18n.js';
import { SKILLS, USER_SKILLS, skillPrompt } from './skills.js';
import * as UT from './usertools.js';
import * as HA from './helpask.js';
import * as Topo from './topology.js';
import { stripUi } from './fields.js';
import * as Comp from './components.js';
import * as USD from './usd.js';
import * as S from './survey.js';
import * as CG from './cogo.js';
import * as SK from './sketch.js';
import * as L from './layers.js';
import * as U from './underlay.js';
import * as DR from './drafting.js';
import * as DW from './drawings.js';
import * as PDF from './pdf.js';
import * as Assets from './assets.js';
import * as F from './formats.js';
import * as Units from './units.js';
import * as Clip from './clipboard.js';
import * as TI from './ties.js';
import { TEMPLATES } from './templates.js';
import { HOWTOS, findHowtos } from './howto.js';
import './landxml.js';
import './dxf.js';
import './ifc.js';
import * as TB from './trimble.js';
import './gis.js';
import * as TR from './terrain.js';
import { surfaceSampler, surfaceSources, refPoint } from './sitework.js';
import * as SW from './sitework.js';
import * as SF from './surfaces.js';
import * as D from './document.js';
import * as A from './animation.js';
import * as Q from './query.js';
import { validate } from './schema.js';
import * as LY from './layout.js';
import * as RD from './roads.js';
import * as PL from './planar.js';
import * as TX from './textures.js';
import * as CRS from './crs.js';
import * as GM from './geomap.js';
import * as LEARN from './learning.js';
import * as ACH from './achievements.js';
import { MATERIALS } from './materials.js';
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
- My tools (#242): "save what we just did as a tool called X" → save_tool (the last turn's steps, numbers become
  parameters); it becomes a command anyone can call. "Remember this as a skill" → save_skill (instructions + toolset).
  list_my_tools shows them; delete_my_tool removes one. ask_help answers "how do I" from the help pages.
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
  curves: offset_curve, trim, extend, fillet, chamfer, join_curves, connect_curves (two lines end to end, gap bridged), break_curve (split a line at a point), simplify_curve, divide_curve.
  To 3D: elevate_linework, linework_to_breaklines, extrude_linework, sweep_linework (by ids or a layer glob).
- Files: import reads LandXML, IFC and DXF (and 3D models) and says what it skipped; export writes landxml, ifc
  (schema IFC4 or IFC4X3; roles in metadata become IFC classes, metadata becomes property sets) and dxf.
  query_features / edit_attributes work on feature layers by attribute values.
- Layers: create_layer / set_layer (colour, lock, current, globs like "C-ROAD/*"), move_to_layer, list_layers,
  merge_layers, map_layers, save_layer_state / restore_layer_state. New geometry goes on the current layer.
- Insight: report_quantities (count, area, volume, length, cost by material, tag or metadata), review_model (floating
  parts, collisions, scale errors, plus a vision critique), list_skills / use_skill (domain know-how).
- Agents: list_agents, ask_agent hands a task to another agent profile (it works alongside you), save_agent.
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
const TIES = { type: 'array', items: obj({ vertex: num('vertex index'), point: str('survey point name or id') }, ['vertex', 'point']), description: 'vertices that stay on survey points: [{ vertex, point }]' };
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
        params: stripUi(params), // the form hints stay in the app
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
        if (c.mutates) S.syncPoints(ctx.doc), TI.syncTies(ctx.doc), R.rebuildDerived(ctx.doc), Comp.syncComponents(ctx.doc), SW.syncTerrain(ctx.doc), AN.syncAnnotations(ctx.doc), USD.syncReferences(ctx.doc);
      } catch (e) {
        if (own) ctx.store.rollback(); // a command either happens whole or not at all
        else if (snap) ctx.store.doc = JSON.parse(snap);
        throw e;
      } finally {
        if (c.compound) ctx.batchDepth--, ctx.scriptDepth--;
      }
      if (record) {
        journal(ctx.doc, name, recArgs, result, ctx.agent);
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
function journal(doc, command, args, result, agent) {
  // made: the id the step created, so a user tool replayed later can point later steps at the new one (#242); agent: who ran it (#243)
  (doc.journal ||= []).push({ command, args: structuredClone(args), ...(typeof result?.id === 'string' ? { made: result.id } : {}), ...(agent ? { agent } : {}) });
  if (doc.journal.length > JOURNAL_MAX) doc.journal.splice(0, doc.journal.length - JOURNAL_MAX);
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r3 = (x) => Math.round(x * 1e3) / 1e3;
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
  for (const e of ents) if (SW.fixedInPlace(e)) throw new Error(SW.fixedInPlace(e));
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

  def('create', 'create_face', 'A flat face from 3+ coplanar world points (walls, roofs, any plane). push_pull it to give it thickness.', obj({ points: { type: 'array', items: v3('point'), description: '[[x,y,z],...]' }, normal: v3('which side is the front (push_pull outwards). Default: up for horizontal faces'), name: common.name, color: common.color, tag: common.tag, split: bool('drawn over a flat shape on the same plane: split its faces where they overlap, one shape (default false; the drawing tools set it)'), parent: str('the group it is drawn in (with split)') }, ['points']), (a) => {
    if (a.points.length < 3 || !G.isPlanar(a.points, 1e-3)) throw new Error('Need 3+ points on one plane.');
    const n = G.polygonNormal(a.points);
    const want = a.normal || (Math.abs(n[1]) > 0.99 ? [0, 1, 0] : n);
    // drawn over a flat shape on the same plane (#179): one shape, its faces split where they overlap
    if (a.split) {
      const doc = ctx.doc;
      const N = G.norm(want);
      const d = G.dot(N, a.points[0]);
      const fr = PL.planeFrame(N, a.points[0]);
      const cut2 = a.points.map(fr.to);
      const flatOn = (e) => {
        if (!e.mesh || e.derived || e.component || e.visible === false || e.locked || (e.parent || null) !== (a.parent || null)) return null;
        const wm = D.worldMesh(doc, e);
        if (!wm.f.length || wm.f.some((f, i) => Math.abs(Math.abs(G.dot(G.faceNormal(wm, i), N)) - 1) > 1e-6 || f.some((k) => Math.abs(G.dot(N, wm.v[k]) - d) > 1e-4))) return null;
        const loops = wm.f.map((f) => f.map((k) => wm.v[k]));
        return loops.some((l) => PL.overlaps(l.map(fr.to), cut2)) ? loops : null;
      };
      for (const e of doc.entities) {
        const loops = flatOn(e);
        if (!loops) continue;
        const r = PL.splitFaces(loops, a.points, N);
        const world = PL.meshOfLoops(r.faces);
        const inv = D.worldMatrix(doc, e).clone().invert().elements;
        const local = ([x, y, z]) => [0, 1, 2].map((k) => Math.round((inv[k] * x + inv[4 + k] * y + inv[8 + k] * z + inv[12 + k]) * 1e6) / 1e6);
        e.mesh = { v: world.v.map(local), f: world.f };
        ctx.selection.set([e.id]);
        return { ...summary(doc, e), split: r.kinds.length, regions: r.kinds, note: `Drawn over ${e.name}: its faces are split where the new shape overlaps them; push / pull each part on its own. Group shapes to keep them apart.` };
      }
    }
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
    if (a.copy === false) for (const e of ents) if (SW.fixedInPlace(e)) throw new Error(SW.fixedInPlace(e));
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

  def('edit', 'set_parent', 'Move entities into a group (parent: the group) or out of any group (parent: null or ""): they keep their place in the world (#203).', obj({ ids, parent: str('the group to move them into; empty for none') }), (a) => {
    const doc = ctx.doc;
    const g = a.parent ? D.resolve(doc, a.parent)[0] : null;
    if (g && g.type !== 'group') throw new Error(`${g.name} is not a group.`);
    const moved = [];
    for (const e of targets(ctx, a)) {
      if (g && (e.id === g.id || D.descendants(doc, e.id).some((d) => d.id === g.id))) throw new Error(`${e.name} cannot go inside itself.`);
      const w = D.worldMatrix(doc, e);
      e.parent = g ? g.id : null;
      D.setWorldMatrix(doc, e, w);
      moved.push(e.id);
    }
    return { moved, parent: g ? g.name : null };
  }, true);
  def('edit', 'set_material', 'Colour and finish of shapes (applies to every shape inside groups).', obj({ ids, color: str('#rrggbb'), opacity: num('0..1'), metalness: num('0..1'), roughness: num('0..1'), emissive: str('#rrggbb glow') }), (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a).flatMap((e) => [e, ...D.descendants(doc, e.id)]);
    for (const e of ents) for (const k of ['color', 'opacity', 'metalness', 'roughness', 'emissive']) if (a[k] !== undefined) e.material[k] = a[k];
    return { updated: ents.map((e) => e.id) };
  }, true);

  def('edit', 'set_properties', 'Rename, tag, hide/show or lock entities; line type and weight of curves.', obj({ ids, name: str('new name'), tag: str('tag name (created if new)'), visible: bool('show/hide'), locked: bool('lock'), line_type: str('curves: continuous | dashed | dotted | center | hidden | a define_line_type name | bylayer'), line_weight: num('curves: mm (0: ByLayer)') }), (a) => {
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
      if (a.line_type !== undefined) a.line_type && a.line_type.toLowerCase() !== 'bylayer' ? (e.line_type = a.line_type.toLowerCase()) : delete e.line_type;
      if (a.line_weight !== undefined) a.line_weight > 0 ? (e.line_weight = a.line_weight) : delete e.line_weight;
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
  const LAYER = { color: common.color, locked: bool('lock: its entities cannot be picked or edited by hand'), line_type: str('continuous | dashed | dotted | center | hidden | a custom name'), line_weight: num('mm'), description: str('what goes on it'), folder: str('a folder to group the layer under in the list ("" for none)'), schema: obj({}, []) };
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

  def('terrain', 'suggest_coordinate_systems', 'Coordinate systems to choose from for a place (latitude, longitude; default the model\'s geolocation) or for words (a country, a name, "UTM 31"): the national grids that cover it, its UTM zone, with EPSG codes. set_coordinate_system then records one.', obj({ latitude: num('degrees, north positive'), longitude: num('degrees, east positive'), query: str('a country, a name or a code') }), (a) => {
    const geoloc = ctx.doc.settings.geolocation || {};
    const latitude = a.latitude ?? geoloc.latitude ?? null;
    const longitude = a.longitude ?? geoloc.longitude ?? null;
    if (latitude === null && !a.query) throw new Error('Give a latitude and longitude, set_geolocation first, or words such as a country.');
    return { latitude, longitude, systems: CRS.suggest({ latitude, longitude, query: a.query || '' }) };
  });
  def('terrain', 'set_coordinate_system', 'The project coordinate system: an EPSG code and name (recorded and written to GLB exports), and an optional site grid (origin [E, N], rotation in degrees, scale factor) for importing local grid coordinates.', obj({ epsg: num('EPSG code, e.g. 2193'), name: str('name, e.g. NZGD2000 / NZTM'), grid: obj({ origin: { type: 'array', items: { type: 'number' } }, rotation: num('degrees'), scale: num('factor') }, []) }), (a) => {
    const g = S.geo(ctx.doc);
    if (a.epsg !== undefined || a.name !== undefined) g.crs = { epsg: a.epsg ?? g.crs?.epsg ?? null, name: a.name ?? g.crs?.name ?? '' };
    if (a.grid) g.grid = a.grid;
    return g;
  }, true);

  def('terrain', 'set_base_point', 'The project base point the model is drawn around, so real-world coordinates (N 5 400 000) stay precise. The model does not move in the world: everything is re-placed around the new base. auto: the centre of the points.', obj({ e: num('Easting'), n: num('Northing'), z: num('Elevation'), auto: bool('centre of the survey points'), at: v3('a point of the model (local x, y, z) that has these coordinates: the model stays where it is and is georeferenced around it (#190)'), north_angle: num('grid north: degrees clockwise from the model\'s −z'), latitude: num('a place picked on a map instead of e and n: converted to the coordinate system (its UTM zone when none is set); the model origin (or at) is that place, nothing moves'), longitude: num('with latitude') }), (a) => {
    const doc = ctx.doc;
    const g = S.geo(doc);
    const old = g.base || [0, 0, 0];
    if (a.north_angle !== undefined) ctx.doc.settings.geolocation = { ...(ctx.doc.settings.geolocation || {}), north_angle: a.north_angle };
    if (a.latitude !== undefined || a.longitude !== undefined) {
      if (a.latitude === undefined || a.longitude === undefined) throw new Error('Give both latitude and longitude.');
      if (!g.crs?.epsg) g.crs = (({ epsg, name }) => ({ epsg, name }))(CRS.utmZone(a.longitude, a.latitude));
      const p = GM.projection(g.crs.epsg);
      if (!p) throw new Error(`Cannot convert latitude / longitude to EPSG:${g.crs.epsg} ${g.crs.name || ''} here: give e and n instead (or use a UTM zone).`);
      const [e, n] = p.forward(a.longitude, a.latitude);
      a = { ...a, e: r4(e), n: r4(n), at: a.at || [0, 0, 0] };
      ctx.doc.settings.geolocation = { ...(ctx.doc.settings.geolocation || {}), latitude: a.latitude, longitude: a.longitude };
    }
    if (a.at) {
      // this model point is (E, N, Z): nothing moves; survey points keep their place and take new coordinates
      if ([a.e, a.n].some((x) => x === undefined)) throw new Error('With at, give the point\'s e and n (and z).');
      const [x, y, z] = a.at;
      const nb = [a.e - x, a.n + z, (a.z ?? old[2] + y) - y];
      for (const p of S.points(doc)) {
        const lp = p.parent ? D.worldMatrix(doc, p).elements.slice(12, 15) : p.position;
        Object.assign(p.point, { e: r4(nb[0] + lp[0]), n: r4(nb[1] - lp[2]), z: r4(nb[2] + lp[1]) });
      }
      g.base = nb.map(r4);
      S.placePoints(doc);
      return { base: g.base, at: a.at, ...(a.latitude !== undefined ? { crs: g.crs, latitude: a.latitude, longitude: a.longitude } : {}), ...(a.north_angle !== undefined ? { north_angle: a.north_angle } : {}) };
    }
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
  def('terrain', 'convert_coordinates', 'Latitude / longitude ↔ project grid (Easting, Northing) in the coordinate system (or the EPSG code given): UTM zones, Lambert-93, NZTM, MGA, Irish TM, SWEREF99, web Mercator and a few more. Give latitude and longitude, or e and n.', obj({ latitude: num('degrees'), longitude: num('degrees'), e: num('Easting'), n: num('Northing'), epsg: num('default the project\'s') }), (a) => {
    const epsg = a.epsg ?? S.geo(ctx.doc).crs?.epsg;
    const p = GM.projection(epsg);
    if (!p) throw new Error(epsg ? `Cannot convert EPSG:${epsg} here (UTM zones, Lambert-93, NZTM, MGA… only).` : 'No coordinate system: set_coordinate_system first, or give epsg.');
    if (a.latitude !== undefined && a.longitude !== undefined) {
      const [e, n] = p.forward(a.longitude, a.latitude);
      return { epsg, latitude: a.latitude, longitude: a.longitude, e: r4(e), n: r4(n) };
    }
    if (a.e === undefined || a.n === undefined) throw new Error('Give latitude and longitude, or e and n.');
    const [longitude, latitude] = p.inverse(a.e, a.n);
    return { epsg, e: a.e, n: a.n, latitude: Math.round(latitude * 1e8) / 1e8, longitude: Math.round(longitude * 1e8) / 1e8 };
  });
  def('view', 'set_view_overlay', 'Over the ground of the 3D view, once the model is placed (set_base_point with latitude / longitude, or set_geolocation): a background map (map: OpenStreetMap, imagery: aerial photos, topo, none), a grid with Easting / Northing labels (grid), how far the map reaches (radius, metres) and its opacity. Kept with the model.', obj({ map: str('background map', ['none', ...Object.keys(GM.LAYERS)]), grid: bool('grid with coordinate labels'), radius: num('metres around the model origin (default 300)'), opacity: num('0–1') }), (a) => {
    const s = ctx.doc.settings;
    const v = (s.view_overlay = { map: 'none', grid: false, radius: 300, opacity: 1, ...s.view_overlay });
    for (const k of ['map', 'grid', 'radius', 'opacity']) if (a[k] !== undefined) v[k] = a[k];
    v.radius = Math.max(20, Math.min(5000, v.radius));
    v.opacity = Math.max(0, Math.min(1, v.opacity));
    const placed = GM.placer({ base: S.geo(ctx.doc).base, epsg: S.geo(ctx.doc).crs?.epsg, geolocation: s.geolocation });
    return { ...v, ...(v.map !== 'none' ? { attribution: GM.LAYERS[v.map].attribution } : {}), ...(placed ? {} : { note: 'The model is not placed on Earth yet: set_base_point with latitude and longitude (or set_geolocation) to see the map.' }) };
  }, true);

  def('terrain', 'set_units', 'Units: display (how lengths are shown: auto, mm, cm, m, in, ft, ft-in) and precision (decimals; for ft-in the inch fraction, e.g. 16), and the survey units for coordinates in and out (length m, ft, usft; angles deg, dms, gon). Commands always take and return metres.', obj({ display: str('length display', Units.DISPLAY), precision: num('decimals (ft-in: inch fraction 2–64)'), length: str('survey length unit', Object.keys(S.UNITS)), angles: str('angle format', ['deg', 'dms', 'gon']) }), (a) => {
    if (a.display !== undefined) ctx.doc.settings.display_units = a.display;
    if (a.precision !== undefined) ctx.doc.settings.precision = a.precision;
    const g = S.geo(ctx.doc);
    if (a.length) g.units = a.length;
    if (a.angles) g.angles = a.angles;
    return { display: ctx.doc.settings.display_units || 'auto', precision: ctx.doc.settings.precision ?? null, units: g.units, angles: g.angles };
  }, true);

  def('terrain', 'add_point', 'Add a survey point: by Northing/Easting/Elevation (project units), at a model point, or by COGO from another point (bearing from north, horizontal distance, height difference). code drives the feature library (KERB, TREE…).', { ...obj({ name:str('point name / number (default: next number)'), n: num('Northing'), e: num('Easting'), z: num('Elevation'), at: v3('or: a model point [x, y, z]'), from: { ...str('or: COGO from this point'), ui: { kind: 'point', names: true } }, bearing: { description: 'degrees from north, or DMS "45°30\'00\\""' }, distance: num('horizontal, project units'), dz: num('height difference'), grid: bool('n/e are site-grid coordinates'), code: { ...str('feature code (+ string and controls: "KERB 2 B"); none is fine'), ui: { kind: 'code' } }, desc: str('description'), attrs: obj({}, []) }), ui: { modes: [{ label: 'Coordinates', fields: ['n', 'e', 'z', 'grid'], required: ['n', 'e'] }, { label: 'A model point', fields: ['at'] }, { label: 'From another point', fields: ['from', 'bearing', 'distance', 'dz'], required: ['from', 'bearing', 'distance'] }] } }, (a) => {
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

  // ---------------------------------------------------------------- COGO (#227): the maths is in cogo.js, shared with the COGO panel's preview
  const DIR = 'azimuth (45.5, DMS 45°30\'00"), quadrant bearing (N45°30\'E), or a turn from the last leg: R90 / L45 (deflection), AR270 (angle right)';
  const PT = (d) => ({ description: `${d}: a point name, or [Northing, Easting, Elevation]`, ui: { kind: 'point', names: true } });
  const storeCogo = (sol, a, { first = a.name } = {}) => {
    const made = sol.points.map((p, i) => S.addPoint(ctx.doc, { n: p.n, e: p.e, z: p.z ?? 0, name: i === 0 && first ? first : undefined, code: a.code || '', desc: a.desc || '' }));
    if (made.length) afterPoints(), ctx.selection.set(made.map((p) => p.id));
    return made.map(fmtPt);
  };
  def('terrain', 'cogo_inverse', 'COGO inverse: azimuth, quadrant bearing, horizontal and slope distance, height difference and grade between two survey points, or along a chain of points (with the total).', { ...obj({ from: PT('from'), to: PT('to'), points: { type: 'array', description: 'or: a chain of point names', ui: { kind: 'points', names: true } } }), ui: { modes: [{ label: 'Two points', fields: ['from', 'to'], required: ['from', 'to'] }, { label: 'Along a chain', fields: ['points'] }] } }, (a) => {
    const r = CG.solve(ctx.doc, 'inverse', a);
    return { ...(Array.isArray(r.result) ? { legs: r.result } : r.result), report: r.report };
  });
  def('terrain', 'cogo_traverse', 'COGO traverse and sideshots: from a point, legs of direction + horizontal distance (+ height difference) store new survey points. Directions may be turns from the last leg (needs backsight for the first). close_to checks the closure (misclosure, precision 1:N, area); adjust: compass spreads the error (Bowditch).', { ...obj({ from: PT('start at'), backsight: { description: 'a point name or a direction you arrive with, for turned angles on the first leg' }, legs: { type: 'array', description: 'legs in order', items: obj({ direction: { description: DIR }, distance: num('horizontal, project units'), dz: num('height difference'), side: bool('a sideshot: measure from the current station but do not move on') }, ['direction', 'distance']) }, close_to: str('the point the traverse should end on (e.g. the start point)'), adjust: str('compass: spread the misclosure', ['none', 'compass']), store: bool('store the points, default true'), code: str('feature code for the new points'), name: str('first new point name (default: next number)') }, ['from', 'legs']) }, (a) => {
    const r = CG.solve(ctx.doc, 'traverse', a);
    return { ...r.result, ...(a.store === false ? {} : { stored: storeCogo(r, a) }), report: r.report };
  }, true);
  def('terrain', 'cogo_intersect', 'COGO intersection: a new point where two bearings meet, a bearing meets a distance, two distances meet, or two lines (two points each) cross. Two answers: both are returned, solution picks the one stored (1 or 2).', { ...obj({ point1: PT('first point'), direction1: { description: `from the first point: ${DIR}` }, distance1: num('from the first point, project units'), point2: PT('second point'), direction2: { description: `from the second point: ${DIR}` }, distance2: num('from the second point, project units'), line1: { type: 'array', description: 'two point names', ui: { kind: 'points', names: true, count: 2 } }, line2: { type: 'array', description: 'two point names', ui: { kind: 'points', names: true, count: 2 } }, solution: str('which answer to store when there are two (default 1)', ['1', '2']), store: bool('store the point, default true'), name: str('new point name (default: next number)'), code: str('feature code') }), ui: { modes: [{ label: 'Bearing, bearing', fields: ['point1', 'direction1', 'point2', 'direction2'], required: ['point1', 'direction1', 'point2', 'direction2'] }, { label: 'Bearing, distance', fields: ['point1', 'direction1', 'point2', 'distance2', 'solution'], required: ['point1', 'direction1', 'point2', 'distance2'] }, { label: 'Distance, distance', fields: ['point1', 'distance1', 'point2', 'distance2', 'solution'], required: ['point1', 'distance1', 'point2', 'distance2'] }, { label: 'Two lines', fields: ['line1', 'line2'], required: ['line1', 'line2'] }] } }, (a) => {
    const r = CG.solve(ctx.doc, 'intersect', { ...a, solution: a.solution === undefined ? undefined : +a.solution || a.solution });
    return { ...r.result, ...(a.store === false ? {} : { stored: storeCogo(r, a) }), report: r.report };
  }, true);
  def('terrain', 'cogo_station_offset', 'COGO station and offset: where survey points are along a line (point names), curve, alignment or linework, and how far right (+) or left (−) of it.', { ...obj({ line: { description: 'a curve, alignment or linework name, or two or more point names', ui: { kind: 'points', names: true } }, point: PT('the point'), points: { type: 'array', description: 'or: several point names', ui: { kind: 'points', names: true } } }, ['line']), ui: { main: ['point'] } }, (a) => {
    const r = CG.solve(ctx.doc, 'station_offset', a);
    return { points: r.result, report: r.report };
  });
  def('terrain', 'cogo_offset_point', 'COGO point at a station and offset along a line (point names), curve, alignment or linework: + right, − left. Elevation from the line, or z / dz.', { ...obj({ line: { description: 'a curve, alignment or linework name, or two or more point names', ui: { kind: 'points', names: true } }, station: num('distance along, project units'), offset: num('right (+) or left (−), project units, default 0'), dz: num('height above the line'), z: num('or: the elevation'), name: str('new point name (default: next number)'), code: str('feature code') }, ['line', 'station']), ui: { main: ['offset'] } }, (a) => {
    const r = CG.solve(ctx.doc, 'offset_point', a);
    return { ...r.result, stored: storeCogo(r, a), report: r.report };
  }, true);
  def('terrain', 'cogo_curve', 'COGO curve solver: a circular curve from any two of radius, delta, arc length, tangent, chord, external and middle ordinate; returns all of them and the degree of curve.', { ...obj({ radius: num('project units'), delta: { description: 'deflection angle: degrees or DMS' }, length: num('arc length'), tangent: num('tangent length'), chord: num('long chord'), external: num('external distance'), middle: num('middle ordinate') }), ui: { main: ['radius', 'delta', 'length', 'tangent', 'chord', 'external', 'middle'] } }, (a) => {
    const r = CG.solve(ctx.doc, 'curve', a);
    return { ...r.result, report: r.report };
  });
  def('terrain', 'cogo_area', 'COGO area: the area (project units², hectares, acres) and perimeter of a parcel through survey points in order.', obj({ points: { type: 'array', description: 'three or more point names, in order around', ui: { kind: 'points', names: true } } }, ['points']), (a) => {
    const r = CG.solve(ctx.doc, 'area', a);
    return { ...r.result, report: r.report };
  });

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

  const pointText = async (a) => {
    if (a.text) return a.text;
    if (!a.path) throw new Error('Give path or text.');
    if (!ctx.io?.readText) throw new Error('Reading files needs the desktop app; pass text instead.');
    return ctx.io.readText(a.path);
  };
  const tableArgs = {
    path: str('absolute path of a .csv / .txt file'),
    text: str('or: the file contents'),
    delimiter: str('comma, tab, semicolon, space, or the character itself (default: detected)'),
    header: bool('the first line is column labels (default: detected)'),
    columns: { type: 'array', description: `what each column holds, in order: a role (${S.COLUMN_ROLES.join(', ')}) or { "role": "attr", "name": "Diameter" } for an attribute kept on each point. Default: matched from the header labels, else P N E Z code`, items: { description: 'a role, or { role, name }' } },
    format: str('or: the column order as letters, e.g. PNEZD, PENZD, NEZ'),
    units: str('length unit of the file (default: the project\'s)', Object.keys(S.UNITS)),
  };
  const parseText = (text, a, doc) => {
    const o = { delimiter: a.delimiter || 'auto', header: a.header, units: a.units || S.geo(doc).units };
    return a.format && !a.columns ? S.parsePoints(text, { ...o, format: a.format }) : S.parseTable(text, { ...o, columns: a.columns });
  };

  def('terrain', 'preview_points', 'Look at a CSV / TXT points file before importing it: how its lines split into columns, whether the first line is a header, the column roles guessed (or given) and the first points as they would come in. Changes nothing; pass the same options to import_points.', obj({ ...tableArgs, rows: num('sample lines, default 20') }), async (a) => {
    const text = await pointText(a);
    const r = parseText(text, a, ctx.doc);
    const lines = S.splitTable(text, r.delimiter).rows;
    const n = a.rows || 20;
    return { delimiter: r.delimiter, header: r.header, columns: r.columns, labels: [...r.labels], lines: lines.length, sample: lines.slice(0, n + (r.header ? 1 : 0)).map((c) => [...c]), points: r.rows.length, first_points: r.rows.slice(0, 5), skipped_lines: r.skipped.slice(0, 50) };
  });

  def('terrain', 'import_points', 'Import survey points from a CSV / TXT file (or text). delimiter and header say how lines split; columns says what each column holds (name, e, n, z, code, desc, attr with a name, ignore): attribute columns are kept on every point. Without columns, header labels are matched, else format gives the order (default PNEZD). Units convert to metres. Coded points are processed through the feature library. On an unknown file, call preview_points first.', obj({ ...tableArgs, grid: bool('coordinates are in the site grid') }), async (a) => {
    const doc = ctx.doc;
    const { rows, skipped } = parseText(await pointText(a), a, doc);
    if (!rows.length) throw new Error('No points found: check the delimiter and which columns hold northing and easting.');
    const made = [];
    const renamed = [];
    const taken = new Set(S.points(doc).map((p) => p.name));
    for (const r of rows) {
      const c = a.grid ? S.gridToProject(doc, r) : r;
      let name = r.name;
      if (name !== undefined && taken.has(name)) (renamed.push(name), (name = undefined));
      const p = S.addPoint(doc, { ...c, name, code: r.code, desc: r.desc, attrs: r.attrs }, taken);
      taken.add(p.name);
      made.push(p);
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
    for (const k of ['max_edge', 'min_edge', 'min_z', 'max_z', 'outline', 'voids']) if (a[k] !== undefined) p[k] = a[k];
    return p;
  };
  const SRC = { points: { description: '"all" (default), point names, or codes "GND,KERB"' }, codes: { type: 'array', items: { type: 'string' }, description: 'or: only points with these codes' }, breaklines: { description: '"all" (default), "none" or ids' }, boundaries: { description: '"all" (default), "none" or ids' }, exclude: { type: 'array', items: { type: 'string' }, description: 'points left out' }, max_edge: num('drop triangles with a longer side, m'), min_edge: num('drop triangles with a side shorter than this, m (slivers)'), outline: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'plan outline [[x, z], …] (model) the surface stays inside (#212)' }, voids: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, description: 'areas left out: [[[x, z], …], …] (model)' }, min_z: num('ignore points below this elevation'), max_z: num('ignore points above this elevation') };
  def('terrain', 'create_surface', 'A TIN surface (constrained Delaunay) from survey points, breaklines and boundaries. It stays live: move, add or delete a point or a line and it rebuilds. Several surfaces can live side by side (existing ground, design, as-built).', obj({ name: common.name, ...SRC, color: common.color, tag: common.tag }), (a) => {
    const doc = ctx.doc;
    const params = SW.migrateSurface(surfaceParams(a));
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

  def('terrain', 'edit_triangles', 'Edit a TIN by hand: delete the triangle at a plan point, swap the edge between two points, add a point on the surface (its elevation from the surface), or restore all.', obj({ id, action: str('what to do', ['delete', 'delete_inside', 'swap', 'add_point', 'remove_point', 'restore']), points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'delete_inside: plan corners [[x, z], …] (model): every triangle whose middle is inside goes (ragged edge, no new edges: use surface_boundary add_void for a clean cut)' }, at: { type: 'array', items: { type: 'number' }, description: 'plan point [x, z] (model)' }, a: str('swap: first point'), b: str('swap: second point'), name: str('add_point: its name'), code: str('add_point: its code') }, ['id', 'action']), (a) => {
    const doc = ctx.doc;
    const s = surfaceOf(a.id);
    if (s.derived?.generator !== 'surface') throw new Error(`${s.name} is not a TIN surface.`);
    const p = { ...s.derived.params };
    if (a.action === 'restore') delete p.deleted, delete p.swaps;
    else if (a.action === 'delete') p.deleted = [...(p.deleted || []), a.at];
    else if (a.action === 'delete_inside') {
      if (!(a.points?.length >= 3)) throw new Error('Give points: the corners [[x, z], …] around the triangles to delete.');
      const w = D.worldMesh(doc, s);
      const mids = w.f.map((f) => [0, 2].map((k) => f.reduce((t, i) => t + w.v[i][k], 0) / f.length)).filter((c) => Topo.insidePolygon(c, a.points));
      if (!mids.length) throw new Error('No triangle has its middle inside those corners.');
      p.deleted = [...(p.deleted || []), ...mids];
    }
    else if (a.action === 'swap') p.swaps = [...(p.swaps || []), pointsByRefs([a.a, a.b]).map((x) => x.id)];
    else if (a.action === 'remove_point') {
      // left out of this surface (the survey point itself stays) (#212)
      const pt = a.a ? pointsByRefs([a.a])[0] : null;
      if (!pt) throw new Error('Give a: the point to leave out.');
      p.exclude = [...new Set([...(p.exclude || []), pt.id])];
    } else {
      const y = surfaceSampler(doc, s).z(a.at[0], a.at[1]);
      if (y === null) throw new Error('That point is outside the surface.');
      const pt = S.addPoint(doc, { ...S.toProject(doc, [a.at[0], y, a.at[1]]), name: a.name, code: a.code || '' });
      if (Array.isArray(p.points)) p.points = [...p.points, pt.id];
    }
    if (!a.at && ['delete', 'add_point'].includes(a.action)) throw new Error('Give at: [x, z].');
    if (a.action === 'restore') p.exclude = [];
    s.derived.params = p;
    R.regenerate(doc, s);
    return { ...summary(doc, s), surface: TR.surfaceStats(s.mesh) };
  }, true);

  // ---------------------------------------------------------------- the editable surface definition (#239)
  /** One edit of a TIN's definition: fn changes a copy of its params, then the surface rebuilds (or the command rolls back). */
  const editTin = (ref, fn) => {
    const doc = ctx.doc;
    const s = surfaceOf(ref);
    if (s.derived?.generator !== 'surface') throw new Error(`${s.name} is not a TIN surface (create_surface makes one).`);
    const p = structuredClone(SW.migrateSurface(s.derived.params));
    const note = fn(p, s);
    s.derived.params = p;
    R.regenerate(doc, s);
    return { ...summary(doc, s), surface: TR.surfaceStats(s.mesh), definition: SW.surfaceDefinition(doc, s), ...(note ? { note } : {}) };
  };
  const plan = { type: 'array', items: { type: 'number' }, description: 'plan point [x, z] (model)' };
  const ring = { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'plan corners [[x, z], …] (model)' };
  const ringOf = (a) => {
    if (a.points) return a.points.map((q) => [q[0], q.length === 3 ? q[2] : q[1]].map(r3));
    if (!a.from) throw new Error('Give points [[x, z], …] or from: a closed curve.');
    const pts = D.curvePoints(ctx.doc, D.resolve(ctx.doc, a.from)[0], 8).map((q) => [r3(q[0]), r3(q[2])]);
    if (pts.length > 3 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-3) pts.pop();
    return pts;
  };

  def('terrain', 'surface_definition', 'What a TIN surface is made of: its points (and those left out), breaklines (linework, curves and drawn ones), outline, voids, max / min edge, swapped edges and deleted triangles.', obj({ id }, ['id']), (a) => {
    const s = surfaceOf(a.id);
    if (s.derived?.generator !== 'surface') throw new Error(`${s.name} is not a TIN surface.`);
    return { ...summary(ctx.doc, s), surface: TR.surfaceStats(s.mesh), definition: SW.surfaceDefinition(ctx.doc, s) };
  });

  def('terrain', 'surface_points', 'Edit a TIN surface\'s points; it rebuilds. add: a survey point at a plan point (elevation z, else the surface height there); move: a point to a plan point and / or elevation; delete: remove the survey points; exclude / include: leave points out of this surface or bring them back.', obj({ id, action: str('what to do', ['add', 'move', 'delete', 'exclude', 'include']), at: { ...plan, description: 'add / move: plan point [x, z] (model)' }, z: num('add / move: project elevation'), points: { type: 'array', items: { type: 'string' }, description: 'move / delete / exclude / include: point names or ids' }, name: str('add: its name'), code: str('add: its code') }, ['id', 'action']), (a) => {
    const doc = ctx.doc;
    return editTin(a.id, (p, s) => {
      if (a.action === 'add') {
        if (!a.at) throw new Error('Give at: [x, z].');
        const y = a.z === undefined ? surfaceSampler(doc, s).z(a.at[0], a.at[1]) : null;
        if (a.z === undefined && y === null) throw new Error('That point is outside the surface: give its elevation z.');
        const pr = S.toProject(doc, [a.at[0], y ?? 0, a.at[1]]);
        const pt = S.addPoint(doc, { ...pr, z: a.z ?? pr.z, name: a.name, code: a.code ?? p.points?.codes?.[0] ?? '' });
        if (Array.isArray(p.points)) p.points.push(pt.id);
        return `Added point ${pt.name}.`;
      }
      const pts = pointsByRefs(a.points);
      const ids = new Set(pts.map((x) => x.id));
      if (a.action === 'move') {
        if (!a.at && a.z === undefined) throw new Error('Give at: [x, z] and / or z.');
        for (const pt of pts) {
          if (a.at) Object.assign(pt.point, (({ n, e }) => ({ n, e }))(S.toProject(doc, [a.at[0], 0, a.at[1]])));
          if (a.z !== undefined) pt.point.z = a.z;
          pt.position = D.round3(S.toLocal(doc, pt.point));
        }
      } else if (a.action === 'delete') {
        for (const pt of pts) D.removeEntity(doc, pt);
        if (Array.isArray(p.points)) p.points = p.points.filter((x) => !ids.has(x));
        p.exclude = p.exclude.filter((x) => !ids.has(x));
      } else if (a.action === 'exclude') p.exclude = [...new Set([...p.exclude, ...ids])];
      else if (a.action === 'include') {
        p.exclude = p.exclude.filter((x) => !ids.has(x));
        if (Array.isArray(p.points)) p.points = [...new Set([...p.points, ...ids])]; // a chosen list: existing points join it
      }
      else throw new Error(`Unknown action "${a.action}".`);
    });
  }, true);

  def('terrain', 'surface_breaklines', 'Add or remove a TIN surface\'s breaklines; it rebuilds. add: an existing line (linework or a curve, which stays live) or one drawn through points [[x, y, z], …] (model); remove: a line, or a drawn one by its index.', obj({ id, action: str('what to do', ['add', 'remove']), line: str('a linework or curve id / name'), points: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'add: a drawn breakline [[x, y, z], …] (model)' }, index: num('remove: which drawn breakline (0 first)') }, ['id', 'action']), (a) =>
    editTin(a.id, (p, s) => {
      const listed = () => SW.surfaceSources(ctx.doc, p).breaklines.map((x) => x.id); // "all" as the explicit list it stands for
      if (a.action === 'add' && a.points) {
        if (a.points.length < 2) throw new Error('A breakline needs at least 2 points.');
        p.lines.push(a.points.map((q) => q.map(r3)));
      } else if (a.line) {
        const [l] = D.resolve(ctx.doc, a.line);
        if (!S.isLinework(l) && !l.curve) throw new Error(`${l.name} is not a line.`);
        const now = listed();
        if (a.action === 'add') p.breaklines = now.includes(l.id) ? now : [...now, l.id];
        else if (!now.includes(l.id)) throw new Error(`${l.name} is not a breakline of ${s.name}.`);
        else p.breaklines = now.filter((x) => x !== l.id);
      } else if (a.action === 'remove' && a.index !== undefined) {
        if (!p.lines[a.index]) throw new Error(`There is no drawn breakline ${a.index} (${p.lines.length} drawn).`);
        p.lines.splice(a.index, 1);
      } else throw new Error('Give line (a line to add or remove), points (to draw one) or index (a drawn one to remove).');
    }),
  true);

  def('terrain', 'surface_boundary', 'Edit a TIN surface\'s outline (the boundary it stays inside) and voids (holes); it rebuilds. set / add_void: corners [[x, z], …] or from a closed curve; clear / remove_void; move_vertex, insert_vertex (splits the nearest edge unless index is given), remove_vertex. void picks the hole (0 first); without it the outline is edited.', obj({ id, action: str('what to do', ['set', 'clear', 'add_void', 'remove_void', 'move_vertex', 'insert_vertex', 'remove_vertex']), points: ring, from: str('set / add_void: a closed curve id / name'), void: num('which void (0 first); omit for the outline'), index: num('vertex index (0 first)'), to: plan }, ['id', 'action']), (a) =>
    editTin(a.id, (p) => {
      const v = a.void;
      if (v !== undefined && !p.voids[v]) throw new Error(`There is no void ${v} (${p.voids.length}).`);
      if (a.action === 'set') p.outline = ringOf(a);
      else if (a.action === 'add_void') p.voids.push(ringOf(a));
      else if (a.action === 'clear') delete p.outline;
      else if (a.action === 'remove_void') {
        if (v === undefined) throw new Error('Give void: which one (0 first).');
        p.voids.splice(v, 1);
      } else {
        const r = v === undefined ? p.outline : p.voids[v];
        if (!r) throw new Error('The surface has no outline yet: set one first.');
        if (a.action !== 'remove_vertex' && !a.to) throw new Error('Give to: [x, z].');
        const op = { action: a.action.replace('_vertex', ''), index: a.action === 'insert_vertex' ? (a.index ?? SW.ringInsertIndex(r, a.to)) : a.index, to: a.to?.map(r3) };
        if (v === undefined) p.outline = SW.editRing(r, op);
        else p.voids[v] = SW.editRing(r, op);
      }
      if ((p.outline && p.outline.length < 3) || p.voids.some((x) => x.length < 3)) throw new Error('An outline or void needs at least 3 corners.');
    }),
  true);

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
      const type = o.def.object.type || 'tree';
      if (type === 'component') {
        // a model from the component library at the point (#217); a missing one is a warning, not a failed edit
        if (!doc.components?.[o.def.object.component]) {
          plan.warnings.push({ message: `Point ${o.point.name} (${o.code}): no component "${o.def.object.component}" in the model.` });
          continue;
        }
        const g =Comp.instantiate(doc, o.def.object.component, { position: [...o.point.position] });
        Object.assign(g, { name: `${o.code} ${o.point.name}`, fromCodes: true, tag: o.def.layer || 'Untagged' });
        continue;
      }
      const h = +o.point.point.attrs?.[o.def.object.height_attr] || o.def.object.height || 4;
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
  const CODE_FIELDS = { description: str('what it is'), type: str('point, line or polygon (line and polygon join their points)', TB.FEATURE_TYPES), category: str('group, e.g. Road'), layer: str('tag for its points, lines and objects'), color: str('#rrggbb'), line_style: str('line style name, e.g. Dashed'), line: bool('points join into lines'), breakline: bool('those lines are breaklines'), object: obj({ type: str('object', ['tree', 'post', 'manhole', 'component']), component: str('component name, for type component'), height_attr: str('attribute with the height'), height: num('default height, m') }, []), attrs: { type: 'array', items: obj({ name: str(''), type: str('', ['number', 'text', 'list']), kind: str('Trimble type when it says more', ['integer', 'date', 'time', 'file', 'photo']), options: { type: 'array', items: { type: 'string' } }, default: { description: 'default value' }, required: bool('') }, ['name']), description: 'attribute fields' } };
  def('terrain', 'define_feature_code', 'Add or change a feature code: points coded with it get a layer and colour, join into lines (and breaklines) or polygons, place an object (tree, post, manhole, or a component from the model such as a lamp post) sized by an attribute, and must carry the listed attributes.', obj({ code: str('e.g. KERB'), ...CODE_FIELDS }, ['code']), (a) => {
    const doc = ctx.doc;
    const code = a.code.toUpperCase();
    const def = S.editCode((doc.featureCodes ||= {})[code], a);
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
  def('terrain', 'export_feature_library', "A feature library (the model's, or a saved one by library) as JSON, Trimble FXL or CSV, to a file with path (the format follows its extension).", obj({ library: str("a saved library name (default: the model's codes)"), path: str('absolute .json, .fxl or .csv path'), format: str('default: from the path, else json', ['json', 'fxl', 'csv']) }), async (a) => {
    const lib = a.library ? await codeLibs().call('get', a.library) : { codes: ctx.doc.featureCodes || {}, layers: [] };
    const format = a.format || a.path?.match(/\.(fxl|csv)$/i)?.[1].toLowerCase() || 'json';
    const text = format === 'fxl' ? TB.fxlWrite(lib) : format === 'csv' ? TB.featureCsv(lib.codes) : JSON.stringify(lib.codes, null, 2);
    if (a.path) await ctx.io.writeText(a.path, text);
    return { codes: Object.keys(lib.codes).length, format, ...(a.path ? { path: a.path } : format === 'json' ? { library: lib.codes } : { text }) };
  });
  def('terrain', 'process_codes', 'Run the feature library over the points again: lines, breaklines, objects, layers and colours (it also runs after importing or editing points). Returns warnings for unknown codes and missing attributes.', obj({}), () => processCodes(), true);
  // feature code libraries: named libraries in this computer's store (SQLite in the data folder, through ctx.codelibs);
  // the model keeps the name of the one it uses and a copy of its codes, so the file works on any machine
  const codeLibs = () => {
    if (!ctx.codelibs) throw new Error('Feature code libraries live in the desktop app.');
    return ctx.codelibs;
  };
  const useLibrary = (lib) => {
    ctx.doc.featureLibrary = { name: lib.name, source: lib.source || null, modified: lib.modified };
    ctx.doc.featureCodes = lib.codes;
    return processCodes();
  };
  const usedLibrary = () => ctx.doc.featureLibrary?.name || null;
  const libName = str('library name (feature_libraries lists them)');
  def('terrain', 'feature_libraries', 'The feature code libraries saved on this computer (name, number of codes, where they came from) and the one this model uses.', obj({}), async () => ({ libraries: await codeLibs().call('list'), in_use: usedLibrary() }));
  def('terrain', 'import_feature_library', 'Keep a feature code library on this computer under a name: a Trimble FXL (Feature Definition Manager: codes, descriptions, point / line / polygon, layers, colours, line styles, attributes with their types and pick lists) or a JSON library { CODE: { … } }, from a path or text; with neither, the model\'s own codes. Then use_feature_library makes a model use it.', obj({ path: str('absolute .fxl or .json path'), text: str('or: the file contents'), format: str('when the extension does not say', ['fxl', 'json']), name: str('library name (default: the file name)'), replace: bool('replace a library of that name') }), async (a) => {
    let text = a.text;
    if (a.path && text === undefined) {
      if (!ctx.io?.readText) throw new Error('Reading a path needs the desktop app: give text.');
      text = await ctx.io.readText(a.path);
    }
    const base = a.path ? a.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : null;
    let lib;
    if (text === undefined) {
      if (!Object.keys(ctx.doc.featureCodes || {}).length) throw new Error('Give path or text: this model has no feature codes to keep.');
      lib = { codes: ctx.doc.featureCodes, layers: [], source: 'model' };
    } else if ((a.format || (/\.json$/i.test(a.path || '') || /^\s*\{/.test(text) ? 'json' : 'fxl')) === 'json') {
      const j = JSON.parse(text);
      lib = { codes: Object.fromEntries(Object.entries(j.codes || j).map(([k, v]) => [k.toUpperCase(), v])), layers: j.layers || [], source: a.path || 'json' };
    } else lib = { ...TB.fxlLibrary(text), source: a.path || 'fxl' };
    if (!Object.keys(lib.codes).length) throw new Error('No feature codes in that library.');
    const name = a.name || base || usedLibrary() || 'Feature library';
    const r = await codeLibs().call('save', { ...lib, name }, !!a.replace);
    const types = Object.values(lib.codes).reduce((m, d) => ((m[TB.featureType(d)] = (m[TB.featureType(d)] || 0) + 1), m), {});
    return { ...r, types, layers: lib.layers.length };
  });
  def('terrain', 'feature_library', 'The codes of a saved feature library (or of the model\'s, without name): code, description, type, layer, colour, attributes. search filters by code, description, layer or category.', obj({ name: libName, search: str('text to look for'), limit: num('most codes to return (default 100)') }), async (a) => {
    const lib = a.name ? await codeLibs().call('get', a.name) : { name: usedLibrary(), codes: ctx.doc.featureCodes || {} };
    const found = S.searchCodes(lib.codes, a.search);
    return { name: lib.name, source: lib.source, total: Object.keys(lib.codes).length, found: found.length, codes: found.slice(0, a.limit || 100) };
  });
  def('terrain', 'manage_feature_library', 'Rename, duplicate or delete a saved feature library.', obj({ name: libName, action: str('what to do', ['rename', 'duplicate', 'delete']), to: str('rename / duplicate: the new name') }, ['name', 'action']), async (a) => {
    const L = codeLibs();
    const r = a.action === 'rename' ? await L.call('rename', a.name, a.to) : a.action === 'duplicate' ? await L.call('duplicate', a.name, a.to) : await L.call('remove', a.name);
    if (a.action === 'rename' && usedLibrary()?.toLowerCase() === a.name.toLowerCase()) ctx.doc.featureLibrary.name = r.name;
    return r;
  }, true);
  def('terrain', 'edit_library_code', 'Add, change or remove a code of a saved feature library (the model updates when it uses that library).', obj({ library: libName, code: str('e.g. KERB'), remove: bool('remove this code'), ...CODE_FIELDS }, ['library', 'code']), async (a) => {
    const L = codeLibs();
    const code = a.code.toUpperCase();
    const lib = await L.call('get', a.library);
    if (a.remove) await L.call('setCode', lib.name, code, null);
    else await L.call('setCode', lib.name, code, S.editCode(lib.codes[code], a));
    const r = { library: lib.name, code, ...(a.remove ? { removed: true } : { definition: S.editCode(lib.codes[code], a) }) };
    if (usedLibrary()?.toLowerCase() === lib.name.toLowerCase()) r.processed = useLibrary(await L.call('get', lib.name));
    return r;
  }, true);
  def('terrain', 'use_feature_library', 'Make this model use a saved feature library: its codes replace the model\'s (kept in the file, so it opens anywhere) and the points are processed again. name "" stops following a library (the codes stay).', obj({ name: str('library name; "" for none') }, ['name']), async (a) => {
    if (!a.name) {
      delete ctx.doc.featureLibrary;
      return { in_use: null, codes: Object.keys(ctx.doc.featureCodes || {}).length };
    }
    const lib = await codeLibs().call('get', a.name);
    return { in_use: lib.name, codes: Object.keys(lib.codes).length, processed: useLibrary(lib) };
  }, true);

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
  const SIDE = obj({ cut_slope: num('H:V'), fill_slope: num('H:V') }, []);
  const TEMPLATE = obj({
    lanes: { type: 'array', items: obj({ width: num('m'), crossfall: num('%') }, []) },
    shoulder: obj({ width: num('m'), crossfall: num('%') }, []),
    cut_slope: num('H:V, default 2'),
    fill_slope: num('H:V, default 3'),
    left: SIDE,
    right: SIDE,
    ditch: obj({ width: num('bottom width, m (default 0.5)'), depth: num('m (default 0.6)'), slope: num('fore slope H:V (default 3)') }, []),
    bench: obj({ every: num('m of height between benches (default 5)'), width: num('m (default 2)') }, []),
    layers: { type: 'array', items: obj({ name: str('e.g. Asphalt'), thickness: num('m'), material: str('Asphalt, Crushed stone, Gravel, Concrete…') }, []), description: 'pavement layers under the lanes and shoulders, top down; earthworks are then measured to the bottom of them' },
    superelevation: obj({ rate: num('% on curves (default 6)'), runoff: num('m to reach it before a curve (default 30)') }, []),
  }, []);
  def('terrain', 'create_corridor', 'A road / channel / embankment: a cross-section template (lanes with crossfall, shoulders, cut and fill batter slopes H:V, per side, a ditch at the foot of cuts, benches on high slopes, pavement layers, superelevation on curves) swept along an alignment, daylighting to the ground. Faces are coloured: road grey, cut slopes red-brown, fill slopes blue. Live: it follows the alignment and the ground; the ground itself is not changed (corridor_surface shows the result, apply_corridor writes it).', obj({ alignment: str('alignment'), surface: str('existing ground to daylight to'), template: TEMPLATE, interval: num('m between sections, default 5'), name: common.name, color: common.color }, ['alignment']), (a) => {
    const doc = ctx.doc;
    const [al] = D.resolve(doc, a.alignment);
    if (!al.curve) throw new Error(`${al.name} is not an alignment or curve.`);
    const inputs = [al.id, ...(a.surface ? [surfaceOf(a.surface).id] : [])];
    const params = { template: a.template || {}, interval: a.interval || 5 };
    R.getGenerator('corridor').run({ params, inputs: inputs.map((x) => D.getEntity(doc, x)), doc });
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Corridor'), material: { color: a.color || '#ffffff', roughness: 0.95 } });
    R.derive(doc, e, 'corridor', params, inputs);
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), surface: TR.surfaceStats(e.mesh) };
  }, true);

  // roads through the terrain (#166–#172)
  const corridorArg = (ref) => {
    const [c] = D.resolve(ctx.doc, ref);
    return { c, ...SW.corridorOf(ctx.doc, c) };
  };
  def('terrain', 'set_corridor', 'Change a corridor: its template (merged into the current one: lanes, shoulder, slopes, left / right, ditch, bench, layers, superelevation; null removes a part) or its interval. The finished ground, profile and sections follow.', obj({ id: str('corridor'), template: TEMPLATE, interval: num('m between sections') }, ['id']), (a) => {
    const [c] = D.resolve(ctx.doc, a.id);
    if (c.derived?.generator !== 'corridor') throw new Error(`${c.name} is not a corridor.`);
    const p = c.derived.params;
    if (a.template) {
      p.template = { ...(p.template || {}), ...a.template };
      for (const [k, v] of Object.entries(p.template)) if (v === null) delete p.template[k];
    }
    if (a.interval) p.interval = a.interval;
    R.regenerate(ctx.doc, c);
    return { ...summary(ctx.doc, c), template: RD.normTemplate(p.template), interval: p.interval || 5 };
  }, true);
  def('terrain', 'corridor_surface', 'See the cut a corridor makes through the ground without changing it: a live finished-ground surface (the existing ground with the road let into it) is shown and the existing ground hidden. show: false hides the finished ground and shows the existing one again. apply_corridor writes it into the ground for good.', obj({ corridor: str('corridor'), show: bool('default true'), name: common.name }, ['corridor']), (a) => {
    const doc = ctx.doc;
    const { c, ground, sections } = corridorArg(a.corridor);
    if (!ground) throw new Error(`${c.name} has no ground surface: create_corridor with surface first.`);
    let fg = doc.entities.find((e) => e.derived?.generator === 'finished_ground' && e.derived.inputs[0] === c.id);
    if (!fg) {
      fg = D.addEntity(doc, { name: a.name || D.uniqueName(doc, `${ground.name} with ${c.name}`), material: { ...(ground.material || { color: '#8a9a6b', roughness: 1 }) }, tag: ground.tag, meta: { surface: true } });
      R.derive(doc, fg, 'finished_ground', {}, [c.id, ground.id]);
    }
    const show = a.show !== false;
    fg.visible = show;
    ground.visible = !show;
    c.visible = !show; // the finished ground already carries the road
    const v = RD.corridorVolumes(sections);
    return { id: fg.id, name: fg.name, showing: show ? 'finished ground' : 'existing ground', ground: ground.name, cut: v.totals.cut, fill: v.totals.fill, note: 'The existing ground is only hidden, not changed. apply_corridor writes the finished ground into it.' };
  }, true);
  def('terrain', 'apply_corridor', 'Write a corridor into its ground surface for good (one undo step): the ground becomes the finished ground, and the live finished-ground surface is removed.', obj({ corridor: str('corridor') }, ['corridor']), (a) => {
    const doc = ctx.doc;
    const { c, ground, sections } = corridorArg(a.corridor);
    if (!ground) throw new Error(`${c.name} has no ground surface.`);
    const fin = RD.finishedGround(D.worldMesh(doc, ground), sections, ground.material?.color);
    R.bake(ground);
    const inv = D.worldMatrix(doc, ground).clone().invert().elements;
    const local = (q) => {
      const [x, y, z] = q;
      const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
      return [0, 1, 2].map((k) => D.round3([(inv[k] * x + inv[4 + k] * y + inv[8 + k] * z + inv[12 + k]) / w])[0]);
    };
    ground.mesh = { v: fin.v.map(local), f: fin.f, fc: fin.fc }; // the road keeps its colours in the ground
    ground.visible = true;
    // the corridor and anything live on the old ground now see the new one; the finished-ground preview goes
    for (const e of doc.entities.filter((x) => x.derived?.generator === 'finished_ground' && x.derived.inputs[0] === c.id)) D.removeEntity(doc, e);
    R.bake(c);
    c.visible = false;
    return { ground: ground.name, triangles: fin.f.length, note: `${c.name} is written into ${ground.name}; the corridor is kept (hidden, no longer live). Undo brings the old ground back.` };
  }, true);
  def('terrain', 'road_profile', 'The long section of a corridor (or an alignment over a surface): ground and design elevations every interval, cut (−) / fill (+) depth, and the PVIs and grades.', obj({ corridor: str('corridor'), alignment: str('or: an alignment'), surface: str('with an alignment: the ground'), interval: num('m, default 2') }), (a) => {
    const doc = ctx.doc;
    let path;
    let g;
    let al;
    if (a.corridor) ({ path, groundZ: g, alignment: al } = corridorArg(a.corridor));
    else {
      [al] = D.resolve(doc, a.alignment);
      path = SW.alignmentPath(doc, al);
      g = a.surface ? SW.surfaceSampler(doc, surfaceOf(a.surface)).z : null;
    }
    const samples = RD.profileSamples(path, g, a.interval || 2);
    const pvis = al.alignment?.pvis || [];
    const grades = pvis.slice(1).map((q, i) => ({ from: pvis[i][0], to: q[0], grade_pct: r4(((q[1] - pvis[i][1]) / (q[0] - pvis[i][0])) * 100) }));
    const depths = samples.filter((x) => x.depth !== null).map((x) => x.depth);
    return { alignment: al.name, length: r4(path.at(-1)[3]), samples, pvis, grades, deepest_cut: depths.length ? r4(-Math.min(0, ...depths)) : null, highest_fill: depths.length ? r4(Math.max(0, ...depths)) : null };
  });
  def('terrain', 'road_section', 'The cross-section of a corridor at a station: the design points (offset, elevation, what they are), the ground line, the cut and fill areas (m²), and whether each side is in cut or fill.', obj({ corridor: str('corridor'), station: num('m along the alignment') }, ['corridor', 'station']), (a) => {
    const { path, template, groundZ, c } = corridorArg(a.corridor);
    const len = path.at(-1)[3];
    if (a.station < 0 || a.station > len + 1e-6) throw new Error(`${c.name} runs from station 0 to ${r4(len)}.`);
    const tpl = RD.normTemplate(template);
    const s = RD.sectionAt(path, a.station, tpl, groundZ, tpl.superelevation ? RD.curveRanges(path) : null);
    const pt = (q) => ({ offset: r4(q.o), elevation: r4(q.y), ...(q.code ? { code: q.code } : {}) });
    return { station: a.station, points: s.points.map(pt), ground: s.ground.map(pt), cut_area: r4(s.cut), fill_area: r4(s.fill), left: s.left, right: s.right, width: r4(s.points.at(-1).o - s.points[0].o) };
  });
  def('terrain', 'corridor_volumes', 'Earthwork volumes of a corridor by average end areas: cut and fill areas per station, volumes between stations, running totals, the mass haul ordinate, and the balance (cut left over or fill to bring in) with bulking and shrinkage. With pavement layers, earthworks are measured to the bottom of them. Can save a CSV.', obj({ corridor: str('corridor'), bulking: num('cut volume factor when loose, e.g. 1.25'), shrinkage: num('fill factor when compacted, e.g. 0.9'), csv: str('absolute .csv path') }, ['corridor']), async (a) => {
    const { c, sections } = corridorArg(a.corridor);
    const v = RD.corridorVolumes(sections, { bulking: a.bulking || 1, shrinkage: a.shrinkage || 1 });
    await csvOut(a.csv, RD.volumesCsv(v.rows));
    return { corridor: c.name, stations: v.rows.length, totals: v.totals, rows: v.rows, ...(a.csv ? { csv: a.csv } : {}) };
  });
  def('terrain', 'corridor_solids', 'What a corridor needs, as solids with materials you can see and export: the cut body and the fill body between the ground and the road, one solid per pavement layer (template layers), and the topsoil strip (topsoil m) over the footprint. Returns each volume (m³) and weight (t). Not live: run it again after a change.', obj({ corridor: str('corridor'), topsoil: num('topsoil strip depth, m (0 = none)'), replace: bool('remove the solids made before for this corridor (default true)') }, ['corridor']), (a) => {
    const doc = ctx.doc;
    const { c, sections, template, groundZ } = corridorArg(a.corridor);
    if (a.replace !== false) for (const e of doc.entities.filter((x) => x.meta?.solidsOf === c.id && x.type === 'group')) D.removeEntity(doc, e);
    const solids = RD.corridorSolids(sections, template, groundZ, { topsoil: a.topsoil || 0 });
    const group = D.addEntity(doc, { type: 'group', name: D.uniqueName(doc, `Earthworks: ${c.name}`), meta: { solidsOf: c.id } });
    const look = { cut: { color: '#c4703a', opacity: 0.85 }, fill: { color: '#4f86b0', opacity: 0.85 }, topsoil: { color: '#4e3b2a' }, layer: null };
    const rows = solids.map((s) => {
      const lib = MATERIALS.find((m) => m.name === s.material);
      const { mesh, origin } = G.recenter(s.mesh);
      const e = D.addEntity(doc, { name: s.name, parent: group.id, mesh, position: D.round3(origin), material: { roughness: 1, ...(lib || {}), ...(look[s.kind] || {}), name: s.material }, meta: { volume_m3: r4(s.volume), tonnes: s.tonnes, material: s.material, kind: s.kind } });
      return { id: e.id, name: s.name, material: s.material, volume_m3: r4(s.volume), tonnes: s.tonnes };
    });
    return { group: group.id, solids: rows, note: 'Cut and fill are measured to the bottom of the pavement layers. Run again after changing the corridor.' };
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
  def('terrain', 'design_plane', 'Design plane through three points, or through a point with a slope (%) falling towards a bearing (degrees from north).', { ...obj({ points: { type: 'array', description: 'three point names or [x, y, z]', ui: { count: 3 } }, point: P3('or a point'), slope: num('%, falling towards the bearing, default 0'), bearing: { description: 'degrees from north, or DMS, default 0' }, size: { type: 'array', items: { type: 'number' }, description: '[width, depth] m, default [20, 20]' }, name: common.name, color: common.color }), ui: { modes: [{ label: 'Through three points', fields: ['points'] }, { label: 'Point, slope and bearing', fields: ['point', 'slope', 'bearing'] }] } }, (a) =>
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
  def('terrain', 'offset_surfaces', 'Offset surfaces from a surface, live (they follow it): count copies every distance m up (negative: down), or along its normals (an even thickness on slopes); or with to, count layers spaced evenly between it and another surface (e.g. the layers of a fill).', obj({ surface: str('source surface'), distance: num('m between copies (negative is below)'), count: num('how many (default 1)'), normal: bool('along the surface normals instead of straight up'), to: str('or: the other surface, for layers between the two'), name: common.name, color: common.color }, ['surface']), (a) => {
    const doc = ctx.doc;
    const src = surfaceOf(a.surface);
    const to = a.to ? surfaceOf(a.to) : null;
    const n = Math.round(a.count ?? 1);
    if (!(n >= 1 && n <= 50)) throw new Error('count must be 1…50.');
    if (!to && !a.distance) throw new Error('Give distance (m), or to: another surface.');
    const made = [];
    for (let k = 1; k <= n; k++) {
      const params = to ? { surface: src.id, to: to.id, fraction: r3(k / (n + 1)) } : { surface: src.id, offset: r3(a.distance * k), ...(a.normal ? { normal: true } : {}) };
      const label = to ? `layer ${k}` : `${a.distance * k > 0 ? '+' : ''}${r3(a.distance * k)} m`;
      made.push(makeDesign('design_offset_surface', params, D.uniqueName(doc, `${a.name || src.name} ${label}`), a.color || src.material?.color));
    }
    ctx.selection.set(made.map((m) => m.id));
    return { created: made.map((m) => ({ id: m.id, name: m.name, ...m.surface })) };
  }, true);
  def('terrain', 'show_triangles', 'Draw the triangle edges of surfaces (or any shape) over their shading, to review a TIN; show false hides them again. A display setting of each entity, saved with the model.', obj({ ids, show: bool('default true') }), (a) => {
    const ents = targets(ctx, a).filter((e) => e.mesh);
    if (!ents.length) throw new Error('Pick a surface (or shape) to show its triangles.');
    for (const e of ents) if (a.show === false) delete e.show_triangles;
    else e.show_triangles = true;
    return { ids: ents.map((e) => e.id), show_triangles: a.show !== false };
  }, true);
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
  def('drafting', 'connect_curves', 'Join two lines into one by their ends, even with a gap between them (a straight piece bridges it): the ends nearest `at` / `at2` (picked), else the closest pair. The first line keeps its name.', obj({ ids: { type: 'array', items: { type: 'string' }, description: 'the two curves' }, at: AT, at2: v3('a world point near the second curve\'s end'), closed: bool('also close the result') }, ['ids']), (a) => {
    const [e1, e2] = a.ids.map(oneCurve);
    if (!e2 || e1.id === e2.id) throw new Error('Pick two different curves.');
    if (e1.curve.closed || e2.curve.closed) throw new Error('Closed curves have no ends to join.');
    const pts = DR.connect(curve2d(e1).pts3, curve2d(e2).pts3, a.at, a.at2);
    setPts(e1, pts, !!a.closed);
    D.removeEntity(ctx.doc, e2);
    ctx.selection.set([e1.id]);
    return summary(ctx.doc, e1);
  }, true);
  def('drafting', 'simplify_curve','Fewer points, same shape within a tolerance (Douglas–Peucker); also merges straight runs.', obj({ ids, layer: str('or: every curve on layers matching this glob'), tolerance: num('m, default 0.05') }), (a) => {
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
  def('create', 'create_curve', 'A path in 3D for sweeps, motion paths and camera moves: polyline (straight legs), spline (smooth through every point) or bezier (point, handle, handle, point, …).', obj({ points: { type: 'array', items: v3('point'), description: '[[x,y,z], …] world points' }, kind: str('polyline (default) | spline | bezier', C.KINDS), closed: bool('loop back to the start'), name: common.name, color: common.color, tag: common.tag, ties: TIES }, ['points']), (a) => {
    const doc = ctx.doc;
    const curve = { kind: a.kind || 'polyline', points: a.points, closed: !!a.closed };
    C.checkCurve(curve);
    const { mesh, origin } = G.recenter({ v: a.points, f: [] });
    const count = doc.entities.filter((e) => e.type === 'curve').length + 1;
    const e = D.addEntity(doc, { type: 'curve', name: a.name || `Curve ${count}`, curve: { ...curve, points: mesh.v }, position: D.round3(origin), tag: a.tag, material: { color: a.color || '#2f6f86' } });
    TI.addTies(doc, e, a.ties);
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

  def('edit', 'set_curve', 'Change a curve: new world points, kind or closed. Sweeps and motion along it follow.', obj({ id, points: { type: 'array', items: v3('point'), description: '[[x,y,z], …] world points' }, kind: str('polyline | spline | bezier', C.KINDS), closed: bool('loop'), ties: TIES }, ['id']), (a) => {
    const doc = ctx.doc;
    const [e] = D.resolve(doc, a.id);
    if (!e.curve) throw new Error(`${e.name} is not a curve.`);
    const inv = D.worldMatrix(doc, e).invert();
    const points = a.points ? a.points.map((p) => D.round3(new Vector3(...p).applyMatrix4(inv).toArray())) : e.curve.points;
    const next = { kind: a.kind ?? e.curve.kind, points, closed: a.closed ?? !!e.curve.closed };
    C.checkCurve(next);
    e.curve = next;
    TI.addTies(doc, e, a.ties);
    return summary(doc, e);
  }, true);

  // Point ties: a vertex placed on a survey point stays on it when the point moves (TI.syncTies after every change).
  def('edit', 'tie_vertex', 'Tie a vertex of a curve (or shape) to a survey point: the vertex goes onto the point and follows it when the point moves or is re-imported; breaklines and surfaces built from the curve follow too. Moving the vertex by hand (or the whole curve without its points) unties it; deleting the point leaves the vertex where it is.', obj({ id, vertex: num('vertex index (0 first)'), point: str('survey point name or id') }, ['id', 'vertex', 'point']), (a) => {
    const [e] = D.resolve(ctx.doc, a.id);
    TI.addTies(ctx.doc, e, [{ vertex: a.vertex, point: a.point }]);
    return { id: e.id, ties: TI.listTies(ctx.doc, e) };
  }, true);
  def('edit', 'untie_vertex', 'Untie a vertex from its survey point (without vertex: every tie of the curve). The vertex stays where it is.', obj({ id, vertex: num('vertex index; omit for all') }, ['id']), (a) => {
    const [e] = D.resolve(ctx.doc, a.id);
    return { id: e.id, untied: TI.untie(e, a.vertex) };
  }, true);
  def('edit', 'list_ties', 'Which curve vertices are tied to which survey points (the whole model, or one curve).', obj({ id: str('a curve id / name (default: all)') }), (a) => ({ ties: TI.listTies(ctx.doc, a.id ? D.resolve(ctx.doc, a.id)[0] : null) }));

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
  def('parametric', 'sketch_profile', 'Save a profile for sweeps from a hand sketch (#230): freehand strokes (canvas pixels, y down) become straight lines with tidy angles, closed when the ends meet, scaled to a real width or height (m). Returns the clean [u, v] points.', obj({ name: str('profile name'), strokes: { type: 'array', description: 'strokes, each [[x, y], …] in canvas pixels', items: { type: 'array', items: { type: 'array', items: { type: 'number' } } } }, width: num('real width, m'), height: num('or: real height, m'), snap: num('angle step in degrees, default 15 (0: keep the angles as drawn)'), anchor: str('which point of the profile follows the path, default bottom-center', P.ANCHORS) }, ['name', 'strokes']), async (a) => {
    const o = SK.scaleOutline(SK.cleanSketch(a.strokes, { snap: a.snap ?? 15 }), { width: a.width, height: a.height });
    if (!o.closed) o.points.push(...[...o.points].reverse().map(([x, y]) => [x, Math.round((y - 0.05) * 1000) / 1000])); // an open line becomes a 5 cm thick strip
    await reg.run('define_profile', { name: a.name, points: o.points, anchor: a.anchor || 'bottom-center', description: `sketched, ${o.width} × ${o.height} m` });
    return { name: a.name, closed: o.closed, width: o.width, height: o.height, points: o.points };
  }, true);
  reg.commands.get('sketch_profile').compound = true;

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
    const steps = (a.steps ? structuredClone(a.steps) : (doc.journal || []).slice(a.from || 0).map((s) => ({ command: s.command, args: structuredClone(s.args) }))).flatMap((s) =>
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
        const args = UT.fillParams(s.args || {}, params);
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


  // ---------------------------------------------------------------- my tools and skills (#242), help that answers (#241)
  const myTools = {};
  /** Add a user tool or skill to the registry (and the skill list), without writing its file: startup and saves. */
  reg.userItem = (item) => {
    if (item.kind === 'skill') return (USER_SKILLS[item.name] = item);
    const old = reg.commands.get(item.name);
    if (old && !old.userTool) throw new Error(`"${item.name}" is already a command of the app: give the tool another name.`);
    reg.define(UT.toolCommand(item, (n, x) => reg.run(n, x)));
    return (myTools[item.name] = item);
  };
  const keep = async (item) => {
    reg.userItem(item);
    const file = ctx.userLibrary ? await ctx.userLibrary.save(item) : null;
    ctx.onMyTools?.();
    return file;
  };
  const has = (n) => reg.commands.has(n);

  def('mytools', 'save_tool', 'Save steps as one of the user\'s own tools: a command (named from `name`, e.g. "Kerb return" → kerb_return) that anyone can call, in search, Tools › My tools, the API and MCP. Without steps it takes what the last Plumb turn did; numbers in the steps become parameters (or give params {name: default} and "{{name}}" placeholders in the steps). Saving under an existing tool name replaces it.', obj({ name: str('the tool\'s name, e.g. "Kerb return"'), description: str('what it makes or does'), steps: { type: 'array', items: obj({ command: str('command name'), args: obj({}, []) }, ['command']), description: '[{command, args}, …] (default: the last turn)' }, params: obj({}, []) }, ['name']), async (a) => {
    const steps = a.steps ? structuredClone(a.steps) : UT.lastTurnSteps(ctx.doc.journal, ctx.turnStarts);
    const tool = UT.makeTool({ name: a.name, title: a.name, description: a.description, steps, params: a.params }, has);
    const file = await keep(tool);
    return { tool: tool.name, title: tool.title, params: tool.params, steps: tool.steps.length, ...(file ? { file } : {}) };
  });
  def('mytools', 'save_skill', 'Save instructions and a toolset as one of the user\'s own skills (list_skills / use_skill, and the skill picker): how they like a kind of work done, and the commands it uses.', obj({ name: str('skill name'), label: str('display name'), description: str('one line: when to use it'), prompt: str('the instructions, written to the copilot'), toolset: { type: 'array', items: { type: 'string' }, description: 'commands this skill uses' }, examples: { type: 'array', items: obj({ title: str('title'), code: str('run_script code') }, ['code']), description: 'example scripts' } }, ['name', 'prompt']), async (a) => {
    const skill = UT.makeSkill(a, has);
    const file = await keep(skill);
    return { skill: skill.name, label: skill.label, toolset: skill.toolset, ...(file ? { file } : {}) };
  });
  def('mytools', 'list_my_tools', 'The user\'s own tools (each is also a command) and skills. Give name for one in full (steps, prompt).', obj({ name: str('one tool or skill in full') }), (a) => {
    if (a.name) {
      const x = myTools[a.name] || USER_SKILLS[a.name] || myTools[UT.slug(a.name)] || USER_SKILLS[UT.slug(a.name)];
      if (!x) throw new Error(`No tool or skill "${a.name}". Mine: ${[...Object.keys(myTools), ...Object.keys(USER_SKILLS)].join(', ') || 'none yet'}.`);
      return structuredClone(x);
    }
    return {
      tools: Object.values(myTools).map((t) => ({ name: t.name, title: t.title, description: t.description, params: t.params, steps: t.steps.length })),
      skills: Object.values(USER_SKILLS).map((s) => ({ name: s.name, label: s.label, description: s.description, toolset: s.toolset })),
    };
  });
  def('mytools', 'delete_my_tool', 'Delete one of the user\'s tools or skills (and its file).', obj({ name: str('tool or skill name') }, ['name']), async (a) => {
    const n = myTools[a.name] || USER_SKILLS[a.name] ? a.name : UT.slug(a.name);
    const item = myTools[n] || USER_SKILLS[n];
    if (!item) throw new Error(`No tool or skill "${a.name}".`);
    if (item.kind === 'tool') delete myTools[n], reg.commands.delete(n);
    else {
      delete USER_SKILLS[n];
      if (ctx.skill === n) (ctx.skill = null), ctx.onSkill?.(null);
    }
    await ctx.userLibrary?.remove(item);
    ctx.onMyTools?.();
    return { deleted: n, kind: item.kind };
  });

  def('help', 'ask_help', 'Answer a "how do I…" question from the help pages and the commands: an answer citing the sections it used ([1], [2]), the sections, the matching commands, and what "Show me" would start. Without an AI model it returns the sections only.', obj({ question: str('the question'), tool: str('a tool id the question is about (F1 over a tool)') }, ['question']), async (a) => {
    const ids = HA.pagesFor(a.question, { tool: a.tool });
    const pages = [];
    for (const id of ids) {
      const md = await ctx.help?.read?.(id).catch(() => null);
      if (md) pages.push({ id, md });
    }
    const src = HA.helpSources(a.question, pages, reg.list());
    let answer = null;
    let error;
    if (ctx.ai?.text) {
      try {
        answer = (await ctx.ai.text({ system: HA.HELP_SYSTEM, text: HA.helpPrompt(a.question, src) })) || null;
      } catch (e) {
        error = e.message;
      }
    }
    return { question: a.question, answer, cited: answer ? HA.cited(answer, src).map((s) => s.n) : [], sources: src.sections, commands: src.commands, show: HA.showMe(src, a.tool), ...(error ? { ai_error: error } : {}) };
  });

  // ---------------------------------------------------------------- annotate and document (Phase 11)
  const REF = { description: 'a point [x, y, z], an entity id / name (its middle), { id, point: [x, y, z] } (a point stuck to it), { id, vertex: k } or { id, corner: "min" | "max" | [sx, sy, sz] } (0 min, 1 max of its box)' };
  const annot = (doc, props, layer, color) => {
    L.ensureLayer(doc, layer);
    const e = D.addEntity(doc, { type: 'curve', curve: { kind: 'polyline', points: [[0, 0, 0], [0, 0, 0]], closed: false }, tag: layer, material: { color }, ...props });
    AN.syncAnnotations(doc);
    if (!e.curve.points.length) throw new Error('Nothing to annotate.');
    return e;
  };
  const annotSummary = (doc, e) => ({ ...summary(doc, e), text: e.annotation.text_now, ...(e.annotation.value !== undefined ? { value: e.annotation.value } : {}) });

  def('create', 'create_text', '3D text: signs, logos, titles, labels on a model. Letters extruded depth m; size is the height of a capital letter. Standing (facing +z) or flat on the ground (flat: true). Live: change the text later with set_params.', obj({ text: str('the words; "\\n" for a new line'), size: num('capital height, m (default 0.5)'), depth: num('m (default 0.05)'), align: str('left | center | right', ['left', 'center', 'right']), flat: bool('lie on the ground, reading from the south'), font: str('font name (default sans)'), ...common }, ['text']), (a) => {
    sizeErr(a.size ?? 0.5, a.depth ?? 0.05);
    return place(ctx, null, a, { name: String(a.text).split('\n')[0].slice(0, 30) || 'Text' }, ['text', { text: String(a.text), size: a.size ?? 0.5, depth: a.depth ?? 0.05, align: a.align || 'center', flat: !!a.flat, ...(a.font ? { font: a.font } : {}) }]);
  }, true);

  def('annotate', 'add_dimension', 'A dimension that stays in step with what it measures. linear: between from and to, along axis x | y | z (or aligned, the true distance, without one); radial / diameter: center and a point on the circle; angular: vertex, from and to. Shortcut: id + axis dimensions the size of a shape. offset: m from the geometry (negative: the other side); normal: the side to put it.', obj({ kind: str('linear (default) | radial | diameter | angular', ['linear', 'radial', 'diameter', 'angular']), from: REF, to: REF, center: REF, vertex: REF, id: str('a shape to dimension (with axis)'), axis: str('x | y | z (default: aligned)', ['x', 'y', 'z']), offset: num('m (default 0.5)'), normal: v3('direction to offset towards'), text: str('replace the text; "<>" is the measured value'), name: common.name }), (a) => {
    const doc = ctx.doc;
    const kind = a.kind || 'linear';
    let refs;
    if (a.id && !a.from) {
      const ax = a.axis || 'x';
      const k = { x: 0, y: 1, z: 2 }[ax];
      const lo = [0, 0, 1];
      const hi = [0, 0, 1];
      hi[k] = 1;
      if (ax === 'z') (lo[0] = hi[0] = 1), (lo[2] = 0);
      refs = [AN.makeRef(doc, { id: a.id, corner: lo }), AN.makeRef(doc, { id: a.id, corner: hi })];
    } else if (kind === 'radial' || kind === 'diameter') {
      if (!a.center || !(a.to || a.from)) throw new Error(`A ${kind} dimension needs center and to (a point on the circle).`);
      refs = [AN.makeRef(doc, a.center), AN.makeRef(doc, a.to || a.from)];
    } else if (kind === 'angular') {
      if (!a.vertex || !a.from || !a.to) throw new Error('An angular dimension needs vertex, from and to.');
      refs = [AN.makeRef(doc, a.vertex), AN.makeRef(doc, a.from), AN.makeRef(doc, a.to)];
    } else {
      if (!a.from || !a.to) throw new Error('A linear dimension needs from and to (or id and axis).');
      refs = [AN.makeRef(doc, a.from), AN.makeRef(doc, a.to)];
    }
    const e = annot(doc, { name: a.name || D.uniqueName(doc, 'Dimension'), annotation: { type: 'dimension', kind, refs, ...(a.axis && kind === 'linear' ? { axis: a.axis } : {}), ...(a.offset !== undefined ? { offset: a.offset } : {}), ...(a.normal ? { normal: a.normal } : {}), ...(a.text ? { text_override: a.text } : {}) } }, AN.DIMS, '#1d262c');
    ctx.selection.set([e.id]);
    return annotSummary(doc, e);
  }, true);

  // how a label or dimension text looks (#183)
  const LABEL_STYLE = { leader: bool('a leader line to what it points at (default true); false: the text alone'), size: num('text height in pixels (default 12)'), plate: str('white (default) or none', ['white', 'none']), color: str('text colour, #rrggbb') };
  def('annotate', 'add_label', 'A text label with a leader line pointing at something. text is a template: {name}, {area}, {footprint}, {volume}, {length}, {height}, {elevation}, {tag}, {meta.key}, kept up to date. Default "{name}".', obj({ at: REF, id: str('the entity it points at (its middle) when at is not given'), text: str('template, default "{name}"'), offset: v3('from the point to the text, m (default [0.6, 0.9, 0])'), ...LABEL_STYLE, name: common.name }), (a) => {
    const doc = ctx.doc;
    const ref = AN.makeRef(doc, a.at ?? a.id ?? targets(ctx, {})[0]?.id);
    const style = Object.fromEntries(Object.keys(LABEL_STYLE).filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
    const e = annot(doc, { name: a.name || D.uniqueName(doc, a.leader === false ? 'Text' : 'Label'), annotation: { type: 'label', refs: [ref], text: a.text || '{name}', ...(a.offset ? { offset: a.offset } : {}), ...style } }, AN.DIMS, '#1d262c');
    ctx.selection.set([e.id]);
    return annotSummary(doc, e);
  }, true);

  def('annotate', 'edit_annotation', 'Change a dimension or label after placing it: its text (template), offset (how far a dimension line stands off, or where a label text sits), text_shift (a dimension text slid along its line, m), side, and a label style (leader, size, plate, color).', obj({ id, text: str('label template, or the dimension text ("<>" is the value; "" for the measured value)'), offset: { description: 'dimension: m; label: [x, y, z]' }, text_shift: num('dimension: slide the text along the line, m'), normal: v3('dimension side'), ...LABEL_STYLE }, ['id']), (a) => {
    const doc = ctx.doc;
    const e = D.resolve(doc, a.id)[0];
    if (!e.annotation) throw new Error(`${e.name} is not a dimension or label.`);
    const n = e.annotation;
    if (a.text !== undefined) n.type === 'label' ? (n.text = a.text) : a.text ? (n.text_override = a.text) : delete n.text_override;
    if (a.offset !== undefined) n.offset = a.offset;
    if (a.text_shift !== undefined) n.text_shift = a.text_shift;
    for (const k of Object.keys(LABEL_STYLE)) if (a[k] !== undefined) n[k] = a[k];
    if (a.normal) n.normal = a.normal;
    AN.syncAnnotations(doc);
    return annotSummary(doc, e);
  }, true);

  def('annotate', 'list_annotations', 'Dimensions, labels and guides with their current values and texts.', obj({}), () => ctx.doc.entities.filter((e) => e.annotation).map((e) => ({ id: e.id, name: e.name, type: e.annotation.type, kind: e.annotation.kind, text: e.annotation.text_now, value: e.annotation.value, attached: e.annotation.refs.filter((r) => !Array.isArray(r)).map((r) => D.getEntity(ctx.doc, r.id)?.name).filter(Boolean) })));

  def('annotate', 'add_guide', 'A construction guide: an endless dashed line through point along direction (or through point and to), or a guide point (a cross) with point alone. On the Guides layer: hide it or clear_guides.', obj({ point: REF, to: REF, direction: v3('line direction'), name: common.name }, ['point']), (a) => {
    const doc = ctx.doc;
    const refs = [AN.makeRef(doc, a.point), ...(a.to ? [AN.makeRef(doc, a.to)] : [])];
    const t = L.ensureLayer(doc, AN.GUIDES);
    t.line_type ||= 'dashed';
    const e = annot(doc, { name: a.name || D.uniqueName(doc, 'Guide'), byLayer: true, annotation: { type: 'guide', refs, ...(a.direction ? { direction: a.direction } : {}) } }, AN.GUIDES, '#4b7bb5');
    t.color ||= '#4b7bb5';
    return summary(doc, e);
  }, true);

  def('annotate', 'clear_guides', 'Delete every guide line and point.', obj({}), () => {
    const doc = ctx.doc;
    const g = doc.entities.filter((e) => e.annotation?.type === 'guide');
    for (const e of g) D.removeEntity(doc, e);
    return { removed: g.length };
  }, true);

  def('annotate', 'define_line_type', 'A line type for layers and curves: a repeating pattern of dash and gap lengths in metres ([1, 0.25, 0.25, 0.25] is a centre line). Built in: continuous, dashed, dotted, center, hidden.', obj({ name: str('line type name'), pattern: { type: 'array', items: { type: 'number' }, description: 'dash, gap, dash, gap… (m)' } }, ['name', 'pattern']), (a) => {
    if (!(a.pattern.length >= 2) || a.pattern.some((x) => !(x > 0))) throw new Error('A pattern is dash and gap lengths, all above 0.');
    ctx.doc.settings.line_types = { ...(ctx.doc.settings.line_types || {}), [a.name.toLowerCase()]: a.pattern };
    return { line_types: { ...L.LINE_TYPES, ...ctx.doc.settings.line_types } };
  }, true);

  def('annotate', 'check_clashes', 'Clash check: pairs of solids from different groups that really overlap (more than tolerance m deep), with the overlap volume and where it is. select: select the clashing shapes.', obj({ ids: { type: 'array', items: { type: 'string' }, description: 'only clashes involving these (default: everything visible)' }, tolerance: num('m (default 0.001)'), select: bool('select what clashes') }), (a) => {
    const doc = ctx.doc;
    const ids = a.ids?.length ? a.ids.flatMap((x) => D.resolve(doc, x)).flatMap((e) => [e.id, ...D.descendants(doc, e.id).map((d) => d.id)]) : null;
    const list = RV.clashes(doc, { ids, tolerance: a.tolerance ?? 0.001 });
    if (a.select) ctx.selection.set([...new Set(list.flatMap((c) => c.ids))]);
    return { count: list.length, clashes: list };
  });

  const sectionPlane = (a) => {
    const s = a.normal ? { normal: a.normal, point: a.point || [0, 0, 0] } : ctx.doc.settings.section;
    if (!s) throw new Error('No section plane: give normal and point, or turn on a section first (section).');
    return s;
  };
  def('annotate', 'section_cut', 'What a section plane cuts: per shape, the cut outline (loops, world) and its area. Default: the current section plane.', obj({ normal: v3('the side that is cut away'), point: v3('a point on the plane') }), (a) => {
    const cut = SEC.sectionCut(ctx.doc, sectionPlane(a));
    const ar = (r) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2);
    return { plane: { normal: cut.frame.n, point: cut.point }, cuts: cut.cuts.map((c) => ({ id: c.id, name: c.name, loops: c.loops.length, area: Math.round(c.areas.reduce((s, x) => s + ar(x.outer) - x.holes.reduce((h, y) => h + ar(y), 0), 0) * 1e4) / 1e4 })) };
  });

  def('file', 'export_section', 'Export a section: the cut of the current section plane (or one given) as SVG (filled, to scale) or DXF (closed polylines on each shape\'s layer).', obj({ path: str('absolute .svg or .dxf path'), normal: v3('the side that is cut away'), point: v3('a point on the plane'), scale: num('SVG: 1:scale (default 50)'), title: str('SVG caption'), preview: bool('also return the SVG') }), async (a) => {
    a = { ...a, path: a.path || (await ctx.io?.pick?.('section', true, 'Section.svg')) };
    if (!a.path) return { cancelled: true };
    const cut = SEC.sectionCut(ctx.doc, sectionPlane(a));
    if (!cut.cuts.length) throw new Error('The section plane cuts nothing.');
    const ext = a.path.split('.').pop().toLowerCase();
    let data;
    if (ext === 'svg') data = SEC.sectionSvg(cut, { scale: a.scale || 50, title: a.title || '' });
    else if (ext === 'dxf') {
      // the loops as closed curves in a scratch document, written by the DXF writer in drawing (plan) coordinates
      const tmp = D.newDoc();
      tmp.geo = ctx.doc.geo;
      tmp.tags = ctx.doc.tags;
      for (const c of cut.cuts) for (const l of c.loops) D.addEntity(tmp, { type: 'curve', name: c.name, tag: c.tag, curve: { kind: 'polyline', points: l, closed: true }, material: { color: c.color } });
      data = F.getFormat('dxf').write(tmp, { ents: tmp.entities, opts: { coordinates: 'local' } });
    } else throw new Error('export_section writes .svg or .dxf.');
    if (!ctx.io?.writeText) throw new Error('No file access in this context.');
    await ctx.io.writeText(a.path, data);
    return { path: a.path, shapes: cut.cuts.length, loops: cut.cuts.reduce((s, c) => s + c.loops.length, 0), ...(a.preview && ext === 'svg' ? { preview: data } : {}) };
  });

  def('file', 'export_drawing', 'A drawing sheet: orthographic views (top, front, back, left, right; iso not to scale) at a common scale with overall dimensions and a title block, as PDF or SVG. Hidden layers stay hidden.', obj({ path: str('absolute .pdf or .svg path'), views: { type: 'array', items: { type: 'string', enum: ['top', 'front', 'back', 'left', 'right', 'iso'] }, description: 'default top, front, right, iso' }, sheet: str('A4 | A3 | A2 | A1 | Letter | Tabloid (default A3)', Object.keys(SHT.SHEETS)), scale: num('1:scale (default: the largest that fits)'), title: str('drawing title'), project: str(''), author: str(''), number: str('sheet number'), preview: bool('also return the sheet as SVG') }), async (a) => {
    if (!ctx.view?.orthoShot) throw new Error('No viewport in this context.');
    a = { ...a, path: a.path || (await ctx.io?.pick?.('sheet', true, `${ctx.doc.name || 'Drawing'}.pdf`)) };
    if (!a.path) return { cancelled: true };
    const ext = a.path.split('.').pop().toLowerCase();
    if (!['pdf', 'svg'].includes(ext)) throw new Error('export_drawing writes .pdf or .svg.');
    const doc = ctx.doc;
    const views = [];
    for (const v of a.views?.length ? a.views : ['top', 'front', 'right', 'iso']) views.push({ name: v[0].toUpperCase() + v.slice(1), ortho: v !== 'iso', ...(await ctx.view.orthoShot(v, { pxPerM: 160 })) });
    const L2 = SHT.layoutSheet(views, { sheet: a.sheet || 'A3', scale: a.scale, title: a.title || doc.name || 'Untitled', project: a.project || '', author: a.author || '', number: a.number || '1', date: new Date().toLocaleDateString('sv'), units: (m) => Units.formatLength(m, { unit: doc.settings.display_units || 'auto', precision: doc.settings.precision ?? undefined }) });
    if (ext === 'svg') await ctx.io.writeText(a.path, SHT.sheetSvg(L2));
    else await ctx.io.writeBinary(a.path, SHT.sheetPdf(L2));
    return { path: a.path, sheet: a.sheet || 'A3', scale: `1:${L2.scale}`, views: views.map((v) => v.name), ...(a.preview ? { preview: SHT.sheetSvg(L2) } : {}) };
  });


  // ---------------------------------------------------------------- look: sun, camera, lights, environment, materials, effects, renders (Phase 12)
  const fileBytes = async (path, kind) => {
    if (!ctx.io?.readBinary) throw new Error(`Reading ${kind} files needs the desktop app.`);
    const ext = path.split('.').pop().toLowerCase();
    return Assets.put(await ctx.io.readBinary(path), { mime: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', hdr: 'image/vnd.radiance', exr: 'image/x-exr' }[ext] || 'application/octet-stream', name: path.split(/[\\/]/).pop() });
  };

  def('view', 'set_geolocation', 'Where the model is on Earth, for real sun angles: latitude and longitude (degrees, north and east positive), the time zone (hours from UTC) and north_angle (true north, degrees clockwise from the model\'s −z).', obj({ latitude: num('−90…90'), longitude: num('−180…180'), utc_offset: num('hours (default from the longitude)'), north_angle: num('degrees (default 0: −z is north)'), place: str('a name for it') }), (a) => {
    const g = { ...(ctx.doc.settings.geolocation || {}) };
    for (const k of ['latitude', 'longitude', 'utc_offset', 'north_angle', 'place']) if (a[k] !== undefined) g[k] = a[k];
    if (g.latitude !== undefined && Math.abs(g.latitude) > 90) throw new Error('latitude is between −90 and 90.');
    ctx.doc.settings.geolocation = g;
    const s = ctx.doc.settings.sun;
    if (s.date) Object.assign(s, SUN.modelSun(ctx.doc, s.date, s.time || '12:00'));
    return { geolocation: SUN.geoOf(ctx.doc), sun: s };
  }, true);

  def('view', 'set_sun_time', 'Put the sun where it really is on a date and a local time at the geolocation (set_geolocation): shadows for a shadow study. Below the horizon it is night.', obj({ date: str('YYYY-MM-DD'), time: str('HH:MM local (default 12:00)') }, ['date']), (a) => {
    const s = SUN.modelSun(ctx.doc, a.date, a.time || '12:00');
    ctx.doc.settings.sun = { ...ctx.doc.settings.sun, azimuth: s.azimuth, elevation: s.elevation, date: a.date, time: a.time || '12:00' };
    return { ...ctx.doc.settings.sun, true_azimuth: s.true_azimuth, geolocation: SUN.geoOf(ctx.doc), night: s.elevation < 0 };
  }, true);

  def('animate', 'animate_sun', 'A sun study on the timeline: the clock over a day (date, from, to) or the same hour over a span of dates (time, from_date, to_date), between start and end (s). "off": none.', obj({ date: str('YYYY-MM-DD (a day study)'), from: str('HH:MM (default 06:00)'), to: str('HH:MM (default 20:00)'), time: str('HH:MM (a year study)'), from_date: str('YYYY-MM-DD'), to_date: str('YYYY-MM-DD'), start: T('default 0'), end: T('default start + 8 s'), off: bool('remove the sun study') }), (a) => {
    const doc = ctx.doc;
    if (a.off) return delete doc.animation.sun, { sun: null };
    const start = A.timeOf(doc, a.start, 0);
    const end = A.timeOf(doc, a.end, start + 8);
    if (!(end > start)) throw new Error('end must come after start.');
    const s = a.from_date ? { time: a.time || '12:00', from_date: a.from_date, to_date: a.to_date || a.from_date, start, end } : { date: a.date || doc.settings.sun.date || new Date().toISOString().slice(0, 10), from: a.from || '06:00', to: a.to || '20:00', start, end };
    SUN.localTime(s.date || s.from_date, s.from || s.time); // checks the formats
    doc.animation.sun = s;
    doc.animation.duration = Math.max(doc.animation.duration, end);
    return { sun: s, at_start: SUN.sunAt(doc, start), at_end: SUN.sunAt(doc, end) };
  }, true);

  def('view', 'set_effects', 'Post effects on the view, screenshots and videos: ambient occlusion (ao 0–1), bloom (0–1, glow of bright and emissive things), outline (profiles), depth of field (dof with focus distance m and aperture f-number), exposure, vignette (0–1).', obj({ ao: num('0–1'), bloom: num('0–1'), outline: bool(''), dof: bool(''), focus: num('m (default: the camera target)'), aperture: num('f-number (default 2.8)'), exposure: num('default 1'), vignette: num('0–1') }), (a) => {
    ctx.doc.settings.effects = LK.effectsOf(ctx.doc.settings.effects, a);
    return ctx.doc.settings.effects;
  }, true);

  def('view', 'set_environment', 'Lighting and reflections from the surroundings: default (sky and sun), studio (soft room light, good reflections), sky, sunset, night, or hdri (an .hdr / .exr panorama from path). exposure, rotation (degrees), background (show it behind the model), intensity.', obj({ preset: str('environment', LK.ENVIRONMENTS), path: str('absolute .hdr or .exr path (preset hdri)'), exposure: num('default 1'), rotation: num('degrees'), background: bool('show it behind the model'), intensity: num('default 1') }), async (a) => {
    const env = { ...(ctx.doc.settings.environment || { preset: 'default' }) };
    if (a.path) (env.asset = await fileBytes(a.path, 'HDRI')), (env.preset = 'hdri');
    else if (a.preset) env.preset = a.preset;
    if (env.preset === 'hdri' && !env.asset) throw new Error('preset hdri needs path (an .hdr or .exr file).');
    for (const k of ['exposure', 'rotation', 'background', 'intensity']) if (a[k] !== undefined) env[k] = a[k];
    ctx.doc.settings.environment = env;
    return env;
  }, true);

  def('create', 'create_light', 'A light: point (a bulb), spot (aimed at target, cone angle) or area (a panel facing target), with colour and intensity; animate it (position, colour, visibility; opacity dims it) for night scenes.', obj({ kind: str('point | spot | area', LK.LIGHT_KINDS), position: v3('where it is'), target: v3('what a spot or panel points at'), color: str('#rrggbb (default warm white)'), intensity: num('candela-like (point 20, spot 60, area 8)'), distance: num('m it reaches (0: no limit)'), angle: num('spot cone, degrees'), penumbra: num('spot soft edge 0–1'), width: num('area, m'), height: num('area, m'), shadows: bool('cast shadows (point, spot)'), name: common.name, tag: common.tag }), (a) => {
    const doc = ctx.doc;
    const light = LK.lightOf(a);
    const e = D.addEntity(doc, { type: 'light', name: a.name || D.uniqueName(doc, `${light.kind[0].toUpperCase()}${light.kind.slice(1)} light`), light, position: a.position || [0, 2.5, 0], tag: a.tag, material: { color: light.color } });
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), light };
  }, true);

  def('edit', 'set_light', 'Change a light: colour, intensity, reach, cone, size, aim, shadows.', obj({ id, color: str('#rrggbb'), intensity: num(''), distance: num('m'), angle: num('degrees'), penumbra: num('0–1'), width: num('m'), height: num('m'), target: v3('aim point'), shadows: bool('') }, ['id']), (a) => {
    const e = D.resolve(ctx.doc, a.id)[0];
    if (!e.light) throw new Error(`${e.name} is not a light.`);
    e.light = LK.lightOf({ ...e.light, ...Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'id' && v !== undefined)) });
    e.material.color = e.light.color;
    return { ...summary(ctx.doc, e), light: e.light };
  }, true);

  def('edit', 'set_texture', 'An image on shapes, at real size: path to a PNG / JPG (or asset from generate_texture), projection box (each face from its side), planar (top, front or side) or cylindrical; size [w, h] m of one tile; offset [u, v] tiles; rotation degrees. "none" takes it off.', obj({ ids, path: str('absolute image path, or "none"'), asset: str('an image already in the model (generate_texture returns one)'), projection: str('box | planar | cylindrical', LK.PROJECTIONS), size: { type: 'array', items: { type: 'number' }, description: '[w, h] m of one tile (default [1, 1])' }, offset: { type: 'array', items: { type: 'number' }, description: '[u, v] in tiles' }, rotation: num('degrees'), plane: str('planar: top | front | side', ['top', 'front', 'side']), tint: str('#rrggbb multiplied in (default white)') }), async (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a).flatMap((e) => [e, ...D.descendants(doc, e.id)]).filter((e) => e.mesh);
    if (!ents.length) throw new Error('No shapes to texture.');
    if (a.path === 'none') {
      for (const e of ents) delete e.material.texture;
      return { updated: ents.map((e) => e.id), texture: null };
    }
    const asset = a.asset || (a.path ? await fileBytes(a.path, 'image') : ents[0].material.texture?.asset);
    if (!asset) throw new Error('Give path (an image file) or asset.');
    if (!Assets.get(asset)) throw new Error(`No image ${asset} in this model.`);
    for (const e of ents) {
      const t = { ...(e.material.texture || {}), asset };
      for (const k of ['projection', 'size', 'offset', 'rotation', 'plane']) if (a[k] !== undefined) t[k] = a[k];
      if (t.size && !(t.size.length === 2 && t.size.every((x) => x > 0))) throw new Error('size is [w, h] in m, above 0.');
      e.material.texture = t;
      if (a.tint || a.path || a.asset) e.material.color = a.tint || '#ffffff';
    }
    return { updated: ents.map((e) => e.id), texture: ents[0].material.texture };
  }, true);

  // textured materials made here (#186): colour, normal and roughness images, kept as model assets
  const texCache = new Map();
  const libraryMaps = (name) => {
    const c = texCache.get(name);
    if (c && Assets.get(c.color)) return c;
    const m = TX.makeMaps(name, 512);
    const put = (px, k) => Assets.put(TX.png(px, m.size, m.size), { mime: 'image/png', name: `${name} ${k}.png` });
    const maps = { color: put(m.color, 'colour'), normal: put(m.normal, 'normal'), roughness: put(m.rough, 'roughness') };
    texCache.set(name, maps);
    return maps;
  };
  def('edit', 'list_material_library', 'The textured materials the app makes itself (wood, brick, stone, concrete, plaster, tiles, roof tiles, marble, grass, gravel, asphalt, brushed metal), by category, with the real size of one tile.', obj({}), () =>
    Object.entries(TX.LIBRARY).map(([name, m]) => ({ name, category: m.category, tile_m: m.tile })),
  );
  def('edit', 'apply_material', 'Give shapes a textured material from the library (list_material_library): a colour image, a normal map (relief) and a roughness map, projected at real size. scale: metres one tile covers (default the material\'s own).', obj({ ids, material: str('library material', Object.keys(TX.LIBRARY)), scale: num('m one tile covers'), projection: str('box (default), planar or cylindrical', ['box', 'planar', 'cylindrical']), rotation: num('degrees') }, ['material']), (a) => {
    const doc = ctx.doc;
    const lib = TX.LIBRARY[a.material];
    if (!lib) throw new Error(`No material "${a.material}". Materials: ${Object.keys(TX.LIBRARY).join(', ')}.`);
    const ents = targets(ctx, a).flatMap((e) => [e, ...D.descendants(doc, e.id)]).filter((e) => e.mesh);
    if (!ents.length) throw new Error('Select the shapes to give it to (or pass ids).');
    const maps = libraryMaps(a.material);
    const s = a.scale || lib.tile;
    for (const e of ents)
      e.material = {
        ...e.material,
        name: a.material,
        color: '#ffffff',
        roughness: 1,
        metalness: lib.metalness,
        texture: { asset: maps.color, projection: a.projection || 'box', size: [s, s], ...(a.rotation ? { rotation: a.rotation } : {}) },
        maps: { ...(e.material.maps || {}), normal: maps.normal, roughness: maps.roughness },
      };
    return { updated: ents.map((e) => e.id), material: a.material, tile_m: s };
  }, true);
  def('edit', 'set_material_maps', 'Physical material details: glass (transmission 0–1, ior, thickness m), clear coat, glow strength, and image maps (normal, roughness, ao: absolute image paths, "none" to remove; they use the shape\'s texture projection).', obj({ ids, transmission: num('0–1 (glass)'), ior: num('index of refraction (glass 1.5)'), thickness: num('m'), clearcoat: num('0–1'), clearcoat_roughness: num('0–1'), emissive_intensity: num('glow strength (default 1)'), normal_map: str('path or "none"'), roughness_map: str('path or "none"'), ao_map: str('path or "none"'), normal_scale: num('bumpiness (default 1)') }), async (a) => {
    const doc = ctx.doc;
    const ents = targets(ctx, a).flatMap((e) => [e, ...D.descendants(doc, e.id)]).filter((e) => e.mesh);
    const maps = {};
    for (const k of ['normal', 'roughness', 'ao']) if (a[`${k}_map`] !== undefined) maps[k] = a[`${k}_map`] === 'none' ? null : await fileBytes(a[`${k}_map`], 'map');
    for (const e of ents) {
      for (const k of ['transmission', 'ior', 'thickness', 'clearcoat', 'clearcoat_roughness', 'emissive_intensity', 'normal_scale']) if (a[k] !== undefined) e.material[k] = a[k];
      if (Object.keys(maps).length) e.material.maps = Object.fromEntries(Object.entries({ ...(e.material.maps || {}), ...maps }).filter(([, v]) => v));
    }
    return { updated: ents.map((e) => e.id) };
  }, true);

  def('view', 'render_image', 'A photoreal still: the view path-traced (true reflections, soft shadows, glass) over a number of samples, saved as PNG. Takes from seconds to minutes.', obj({ path: str('absolute .png path'), width: num('px (default 1920)'), height: num('px (default 1080)'), samples: num('default 128 (more: cleaner, slower)'), bounces: num('default 5') }), async (a) => {
    if (!ctx.view?.pathTrace) throw new Error('Path tracing needs the desktop app.');
    const path = a.path || (await ctx.io?.pick?.('png', true, 'Render.png'));
    if (!path) return { cancelled: true };
    const r = await ctx.view.pathTrace({ width: a.width || 1920, height: a.height || 1080, samples: a.samples || 128, bounces: a.bounces || 5 });
    await ctx.io.writeBinary(path, r.bytes);
    return { path, width: r.width, height: r.height, samples: r.samples, seconds: r.seconds };
  });

  def('ai', 'ai_render', 'AI render: the view redrawn by an image model (a local ComfyUI or an OpenAI-compatible images API, set in AI settings) from a prompt, keeping its shapes: materials, planting, sky, people, mood. strength 0–1: how far it may move from the view.', obj({ prompt: str('what it should look like: "brick and timber, spring evening, people walking"'), negative: str('what to avoid'), strength: num('0–1 (default 0.55)'), path: str('absolute .png path to save (default: just shown)') }, ['prompt']), async (a) => {
    if (!ctx.io?.aiImage || !ctx.view) throw new Error('AI render needs the desktop app.');
    const shot = await ctx.view.screenshot({ width: 1024 });
    const r = await ctx.io.aiImage({ prompt: IG.renderPrompt(a.prompt), negative: a.negative, image: shot.split(',')[1], strength: a.strength ?? 0.55 });
    if (a.path) await ctx.io.writeBinary(a.path, Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0)));
    return { image: `data:image/png;base64,${r.b64}`, ...(a.path ? { path: a.path } : {}) };
  });

  def('ai', 'generate_texture', 'AI material: a seamless texture made by the image model from a prompt ("weathered red brick", "oak floor boards"), kept in the model; size m of one tile; applied to ids (or the selection) when given.', obj({ prompt: str('the material'), size: num('m of one tile (default 1)'), apply: bool('put it on the selection (default true when something is selected)'), ids }, ['prompt']), async (a) => {
    if (!ctx.io?.aiImage || !ctx.view?.seamless) throw new Error('AI textures need the desktop app.');
    const r = await ctx.io.aiImage({ prompt: IG.texturePrompt(a.prompt), width: 1024, height: 1024 });
    const png = await ctx.view.seamless(r.b64);
    const asset = Assets.put(png, { mime: 'image/png', name: `${a.prompt.slice(0, 40)}.png` });
    const sel = a.ids?.length ? a.ids : ctx.selection.get();
    if (a.apply !== false && sel.length) await reg.run('set_texture', { ids: sel, asset, projection: 'box', size: [a.size || 1, a.size || 1] });
    return { asset, applied: a.apply !== false ? sel : [], image: `data:image/png;base64,${r.b64}` };
  }, true);


  // ---------------------------------------------------------------- animation depth (Phase 13)
  const baseOf = (target, property) => (target === 'camera' ? ctx.doc.camera[property] : D.getEntity(ctx.doc, target)?.[property]);
  const ids2 = (list) => D.resolve(ctx.doc, list).map((e) => e.id);
  const putKeys = (list) => {
    for (const k of list) A.setKey(ctx.doc, k.target, k.property, k.t, k.v, k.ease || 'ease-in-out', k.bezier || null);
    return list.length;
  };

  def('animate', 'save_clip', 'Save what one or more things do between from and to as a reusable clip ("door opens"). Moves and turns are kept relative, so apply_clip plays it on other things where they are.', obj({ name: str('clip name'), ids, from: T('default 0'), to: T('default: the last key') }, ['name']), (a) => {
    const doc = ctx.doc;
    const targets = targets_(a);
    const from = A.timeOf(doc, a.from, 0);
    const to = A.timeOf(doc, a.to, Math.max(from, ...doc.animation.tracks.filter((t) => targets.includes(t.target)).flatMap((t) => t.keys.map((k) => k.t))));
    const clip = SQ.makeClip(doc, { name: a.name, targets, from, to, base: (t, p) => (A.sample(doc.animation.tracks.find((x) => x.target === t && x.property === p) || { keys: [] }, from) ?? baseOf(t, p)) });
    doc.animation.clips = [...(doc.animation.clips || []).filter((c) => c.name !== a.name), clip];
    return { name: clip.name, duration: clip.duration, roles: clip.roles, tracks: clip.tracks.length };
  }, true);
  const targets_ = (a) => targets(ctx, a).map((e) => e.id);

  def('animate', 'apply_clip', 'Play a saved clip on other things from start (speed 2 is twice as fast). With several things in the clip, give as many ids in the same order; with one, every id gets it (stagger s between them).', obj({ name: str('clip name'), ids, start: T('default: playhead or 0'), speed: num('default 1'), stagger: num('s between ids (default 0)') }, ['name']), (a) => {
    const doc = ctx.doc;
    const clip = (doc.animation.clips || []).find((c) => c.name.toLowerCase() === a.name.toLowerCase());
    if (!clip) throw new Error(`No clip "${a.name}". Clips: ${(doc.animation.clips || []).map((c) => c.name).join(', ') || 'none (save_clip makes one)'}.`);
    const ts = targets_(a);
    const start = A.timeOf(doc, a.start, ctx.timeline?.time ?? 0);
    const groups = clip.roles > 1 ? [ts] : ts.map((t) => [t]);
    let n = 0;
    groups.forEach((g, i) => (n += putKeys(SQ.clipKeys(clip, g, start + i * (a.stagger || 0), { base: baseOf, speed: a.speed || 1 }))));
    return { clip: clip.name, on: ts, keys: n, ends: start + (groups.length - 1) * (a.stagger || 0) + clip.duration / (a.speed || 1) };
  }, true);

  def('animate', 'list_clips', 'Saved animation clips.', obj({}), () => (ctx.doc.animation.clips || []).map((c) => ({ name: c.name, duration: c.duration, roles: c.roles, properties: [...new Set(c.tracks.map((t) => t.property))] })));

  def('animate', 'simulate_physics', 'Rigid-body physics baked to keyframes: the shapes fall, bounce, tumble and settle on the ground and on the colliders (default: every other visible shape). push [x, y, z] m/s throws them (a collapse). Keys from start.', obj({ ids, colliders: { type: 'array', items: { type: 'string' }, description: 'shapes that do not move (default: all other visible shapes)' }, start: T('default 0'), duration: num('s (default 4)'), gravity: num('m/s² (default 9.81)'), bounce: num('0–1 (default 0.15)'), friction: num('0–1 (default 0.6)'), push: v3('starting speed, m/s') }), (a) => {
    const doc = ctx.doc;
    const dyn = targets(ctx, a).filter((e) => e.mesh && !e.parent);
    if (!dyn.length) throw new Error('Select the shapes that fall (top-level shapes).');
    const skip = new Set(dyn.map((e) => e.id));
    const off = new Set(doc.tags.filter((t) => !t.visible).map((t) => t.name));
    const statics = (a.colliders ? D.resolve(doc, a.colliders) : doc.entities.filter((e) => e.mesh && !e.parent && e.visible && !off.has(e.tag))).filter((e) => !skip.has(e.id) && e.mesh);
    const start = A.timeOf(doc, a.start, 0);
    const r = PH.simulate(dyn, statics, { duration: a.duration || 4, gravity: a.gravity ?? 9.81, restitution: a.bounce ?? 0.15, friction: a.friction ?? 0.6, push: a.push });
    for (const [id, list] of Object.entries(r.keys))
      for (const k of list) A.setKey(doc, id, 'position', start + k.t, k.position, 'linear'), A.setKey(doc, id, 'rotation', start + k.t, k.rotation, 'linear');
    return { moved: dyn.map((e) => e.name), colliders: statics.length, settled_at: r.settled === null ? null : start + r.settled, ends: start + (a.duration || 4) };
  }, true);

  def('animate', 'add_shot', 'A camera shot between start and end (cuts between shots, like a storyboard): the camera from position / target (or a saved scene), optionally moving to position_end / target_end over the shot. Shots win over camera keys.', obj({ name: str('shot name'), start: T('s'), end: T('s'), scene: str('a saved scene to take the camera from'), position: v3('eye'), target: v3('look-at'), lens: num('mm'), position_end: v3('eye at the end (a move)'), target_end: v3('look-at at the end') }, ['start', 'end']), (a) => {
    const doc = ctx.doc;
    const start = A.timeOf(doc, a.start, 0);
    const end = A.timeOf(doc, a.end, start + 3);
    if (!(end > start)) throw new Error('end must come after start.');
    const sc = a.scene && (doc.scenes || []).find((s) => s.name.toLowerCase() === a.scene.toLowerCase());
    if (a.scene && !sc) throw new Error(`No scene "${a.scene}".`);
    const now = ctx.view?.getCamera() || doc.camera;
    const cam = { position: a.position || sc?.camera.position || now.position, target: a.target || sc?.camera.target || now.target, fov: a.lens ? Math.round(LK.fovOfLens(a.lens) * 100) / 100 : sc?.camera.fov || now.fov || 45 };
    const shot = { name: a.name || `Shot ${(doc.animation.shots || []).length + 1}`, start, end, camera: cam, ...(a.position_end || a.target_end ? { camera_end: { position: a.position_end || cam.position, target: a.target_end || cam.target, fov: cam.fov } } : {}) };
    doc.animation.shots = [...(doc.animation.shots || []).filter((s) => s.name !== shot.name && (s.end <= start || s.start >= end)), shot].sort((x, y) => x.start - y.start);
    doc.animation.duration = Math.max(doc.animation.duration, Math.ceil(end));
    return { shots: doc.animation.shots.map((s) => ({ name: s.name, start: s.start, end: s.end, moves: !!s.camera_end })) };
  }, true);

  def('animate', 'remove_shot', 'Remove a camera shot by name ("all" for every shot).', obj({ name: str('shot name or "all"') }, ['name']), (a) => {
    const doc = ctx.doc;
    const before = (doc.animation.shots || []).length;
    doc.animation.shots = a.name === 'all' ? [] : (doc.animation.shots || []).filter((s) => s.name.toLowerCase() !== a.name.toLowerCase());
    return { removed: before - doc.animation.shots.length };
  }, true);

  def('animate', 'add_audio', 'Music or a voiceover on the timeline (MP3, WAV, OGG, M4A): from start or a marker, with volume and fades; played with the timeline and mixed into MP4 / WebM renders.', obj({ path: str('absolute audio file path'), start: T('s or a marker (default 0)'), volume: num('0–1 (default 0.8)'), fade_in: num('s'), fade_out: num('s'), name: common.name }, ['path']), async (a) => {
    if (!ctx.io?.readBinary) throw new Error('Audio files need the desktop app.');
    const doc = ctx.doc;
    const ext = a.path.split('.').pop().toLowerCase();
    const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' }[ext];
    if (!mime) throw new Error('Audio: MP3, WAV, OGG, M4A, AAC or FLAC.');
    const asset = Assets.put(await ctx.io.readBinary(a.path), { mime, name: a.path.split(/[\\/]/).pop() });
    const clip = { name: a.name || a.path.split(/[\\/]/).pop().replace(/\.\w+$/, ''), asset, start: A.timeOf(doc, a.start, 0), volume: a.volume ?? 0.8, fade_in: a.fade_in || 0, fade_out: a.fade_out || 0 };
    doc.animation.audio = [...(doc.animation.audio || []).filter((x) => x.name !== clip.name), clip];
    return clip;
  }, true);

  def('animate', 'remove_audio', 'Remove an audio clip by name ("all" for every one).', obj({ name: str('audio name or "all"') }, ['name']), (a) => {
    const doc = ctx.doc;
    const before = (doc.animation.audio || []).length;
    doc.animation.audio = a.name === 'all' ? [] : (doc.animation.audio || []).filter((x) => x.name.toLowerCase() !== a.name.toLowerCase());
    return { removed: before - doc.animation.audio.length };
  }, true);

  def('animate', 'animate_section', 'Section reveal: the section plane sweeps through the model between start and end (from and to: points on the plane, or distances along normal from the model\'s middle). normal: the side that is cut away (default down: a plan cut rising).', obj({ normal: v3('cut-away side (default [0, 1, 0]: everything above is cut)'), from: { description: '[x, y, z] or a distance along normal' }, to: { description: '[x, y, z] or a distance' }, start: T('default 0'), end: T('default start + 4'), ease: str('easing', Object.keys(A.EASES)) }), (a) => {
    const doc = ctx.doc;
    const n = G.norm(a.normal || [0, 1, 0]);
    const box = D.unionBox(doc.entities.filter((e) => e.mesh && !e.parent).map((e) => D.worldBox(doc, e)));
    const mid = box.min[0] === Infinity ? [0, 0, 0] : box.min.map((x, k) => (x + box.max[k]) / 2);
    const half = box.min[0] === Infinity ? 1 : Math.abs(G.dot(G.sub(box.max, box.min), n)) / 2 + 0.01;
    const pt = (v, d) => (Array.isArray(v) ? v : G.add(mid, G.scl(n, v ?? d)));
    const start = A.timeOf(doc, a.start, 0);
    const end = A.timeOf(doc, a.end, start + 4);
    A.setKey(doc, 'section', 'point', start, D.round3(pt(a.from, -half)), 'linear');
    A.setKey(doc, 'section', 'point', end, D.round3(pt(a.to, half)), a.ease || 'ease-in-out');
    A.setKey(doc, 'section', 'normal', start, n.map((x) => Math.round(x * 1e4) / 1e4), 'step');
    return { from: pt(a.from, -half), to: pt(a.to, half), start, end };
  }, true);

  const constraint = (type, a, extra) => {
    const doc = ctx.doc;
    const target = D.resolve(doc, a.id)[0];
    const c = { type, target: target.id, start: A.timeOf(doc, a.start, 0), ...(a.end !== undefined ? { end: A.timeOf(doc, a.end, 0) } : {}), ...extra };
    if (c.end !== undefined && !(c.end > c.start)) throw new Error('end must come after start.');
    doc.animation.constraints = [...(doc.animation.constraints || []), c];
    return c;
  };
  def('animate', 'attach', 'Attach a thing to another from start (and let go at end): it moves and turns with the parent, keeping where it was relative to it (a crane hook picking a beam). After end it stays where it was released.', obj({ id: str('what is carried'), parent: str('what carries it'), start: T('pick-up time (default 0)'), end: T('release time (default: never)') }, ['id', 'parent']), (a) => constraint('attach', a, { parent: D.resolve(ctx.doc, a.parent)[0].id }), true);
  def('animate', 'follow', 'Follow another thing\'s movement (position only, no turning) from start to end.', obj({ id: str('the follower'), parent: str('what it follows'), start: T('default 0'), end: T('default: never') }, ['id', 'parent']), (a) => constraint('follow', a, { parent: D.resolve(ctx.doc, a.parent)[0].id }), true);
  def('animate', 'look_at', 'Keep turning a thing (or the camera rig\'s object) to face another thing or a point from start to end: yaw only (a turret, a person) or with pitch.', obj({ id: str('what turns'), at: { description: 'entity id / name or [x, y, z]' }, pitch: bool('also tilt up and down'), yaw_offset: num('degrees, when its front is not +z'), start: T('default 0'), end: T('default: never') }, ['id', 'at']), (a) => constraint('look_at', a, { at: Array.isArray(a.at) ? a.at : D.resolve(ctx.doc, a.at)[0].id, ...(a.pitch ? { pitch: true } : {}), ...(a.yaw_offset ? { yaw_offset: a.yaw_offset } : {}) }), true);
  def('animate', 'remove_constraints', 'Remove the attach / follow / look_at constraints of a thing (or "all").', obj({ id: str('entity or "all"') }, ['id']), (a) => {
    const doc = ctx.doc;
    const before = (doc.animation.constraints || []).length;
    const id = a.id === 'all' ? null : D.resolve(doc, a.id)[0].id;
    doc.animation.constraints = id ? (doc.animation.constraints || []).filter((c) => c.target !== id) : [];
    return { removed: before - doc.animation.constraints.length };
  }, true);

  def('animate', 'set_ease', 'The easing into a keyframe: a named one, or a custom curve bezier [x1, y1, x2, y2] like CSS cubic-bezier (the graph editor\'s handles). time: the key\'s time (default: every key of the property).', obj({ id: str('entity or "camera"'), property: str('position | rotation | scale | opacity | color | fov | target'), time: T('the key'), ease: str('named easing', Object.keys(A.EASES)), bezier: { type: 'array', items: { type: 'number' }, description: '[x1, y1, x2, y2], x in 0–1' } }, ['id']), (a) => {
    const doc = ctx.doc;
    const target = a.id === 'camera' ? 'camera' : D.resolve(doc, a.id)[0].id;
    if (a.bezier && !(a.bezier.length === 4 && a.bezier[0] >= 0 && a.bezier[0] <= 1 && a.bezier[2] >= 0 && a.bezier[2] <= 1)) throw new Error('bezier is [x1, y1, x2, y2] with x1 and x2 between 0 and 1.');
    const t = a.time !== undefined ? A.timeOf(doc, a.time, 0) : null;
    let n = 0;
    for (const tr of doc.animation.tracks)
      if (tr.target === target && (!a.property || tr.property === a.property))
        for (const k of tr.keys)
          if (t === null || Math.abs(k.t - t) < 1e-3) {
            if (a.bezier) (k.bezier = a.bezier), (k.ease = 'bezier');
            else if (a.ease) (k.ease = a.ease), delete k.bezier;
            n++;
          }
    if (!n) throw new Error('No keyframe there.');
    return { keys: n };
  }, true);

  def('animate', 'retime', 'Dope sheet: scale and shift keyframes in time. Keys of ids (default: everything) between from and to are stretched by scale about from, then moved by offset s (scale 2: twice as slow).', obj({ ids, from: T('default 0'), to: T('default: the end'), scale: num('default 1'), offset: num('s (default 0)') }), (a) => {
    const doc = ctx.doc;
    const ids = a.ids?.length ? ids2(a.ids) : null;
    const n = SQ.retime(doc, { targets: ids, from: A.timeOf(doc, a.from, 0), to: a.to === undefined ? Infinity : A.timeOf(doc, a.to, 0), scale: a.scale ?? 1, offset: a.offset || 0 });
    return { keys: n, duration: doc.animation.duration };
  }, true);

  def('animate', 'copy_keys', 'Dope sheet: copy one thing\'s keyframes (between from and to, some properties) to others, shifted by offset s.', obj({ from_id: str('source entity'), to: { type: 'array', items: { type: 'string' }, description: 'destination entities' }, from: T('default 0'), until: T('default: the end'), offset: num('s (default 0)'), properties: { type: 'array', items: { type: 'string' } } }, ['from_id', 'to']), (a) => {
    const doc = ctx.doc;
    const list = SQ.copyKeys(doc, D.resolve(doc, a.from_id)[0].id, ids2(a.to), { from: A.timeOf(doc, a.from, 0), to: a.until === undefined ? Infinity : A.timeOf(doc, a.until, 0), offset: a.offset || 0, properties: a.properties });
    return { keys: putKeys(list) };
  }, true);

  def('animate', 'delete_keys', 'Dope sheet: delete the keyframes of ids (default: selection) between from and to.', obj({ ids, from: T('default 0'), to: T('default: the end'), property: str('only this property') }), (a) => {
    const doc = ctx.doc;
    const ids = targets_(a);
    const from = A.timeOf(doc, a.from, 0);
    const to = a.to === undefined ? Infinity : A.timeOf(doc, a.to, 0);
    let n = 0;
    for (const tr of doc.animation.tracks)
      if (ids.includes(tr.target) && (!a.property || tr.property === a.property)) {
        const keep = tr.keys.filter((k) => k.t < from - 1e-9 || k.t > to + 1e-9);
        n += tr.keys.length - keep.length;
        tr.keys = keep;
      }
    doc.animation.tracks = doc.animation.tracks.filter((t) => t.keys.length);
    return { deleted: n };
  }, true);

  def('animate', 'import_schedule', 'A 4D sequence from a schedule: CSV (Name, Start, Finish, optional Element / Tag), MS Project XML or Primavera P6 XER. Each task builds the shapes it matches (its Element column, else by layer or name, or a metadata field), between its start and finish; a date caption shows the day and the tasks.', obj({ path: str('absolute .csv / .xml / .xer path'), text: str('the file\'s text instead of path'), match: str('auto | tag | name', ['auto', 'tag', 'name']), field: str('metadata key holding the task id or name'), seconds_per_day: num('timeline seconds per day (default: the schedule in 20 s)'), effect: str('how pieces arrive', ['grow', 'rise', 'fade', 'appear']), caption: bool('show the date and tasks (default true)'), us_dates: bool('month first in 3/1/2027') }), async (a) => {
    const doc = ctx.doc;
    const text = a.text ?? (a.path ? await ctx.io?.readText?.(a.path) : null);
    if (!text) throw new Error('Give path (a schedule file) or text.');
    const tasks = SQ.parseSchedule(text, { us: !!a.us_dates });
    const t0 = tasks[0].start;
    const days = Math.max(1, (Math.max(...tasks.map((x) => x.finish)) - t0) / 86400000);
    const spd = a.seconds_per_day || Math.round((20 / days) * 1000) / 1000;
    const effect = a.effect || 'grow';
    const report = [];
    const seen = new Set();
    for (const task of tasks) {
      const ids = SQ.matchTask(doc, task, { by: a.match || 'auto', field: a.field }).filter((id) => !seen.has(id));
      ids.forEach((id) => seen.add(id));
      const s = SQ.scheduleTime(task.start, t0, spd);
      const f = Math.max(s + 0.2, SQ.scheduleTime(task.finish, t0, spd));
      for (const id of ids) {
        const e = D.getEntity(doc, id);
        A.setKey(doc, id, 'visible', 0, false, 'step');
        A.setKey(doc, id, 'visible', s, true, 'step');
        if (effect === 'grow') A.setKey(doc, id, 'scale', s, [e.scale[0], 0.001, e.scale[2]], 'linear'), A.setKey(doc, id, 'scale', f, e.scale, 'ease-out');
        else if (effect === 'rise') A.setKey(doc, id, 'position', s, G.add(e.position, [0, -3, 0]), 'linear'), A.setKey(doc, id, 'position', f, e.position, 'ease-out');
        else if (effect === 'fade') A.setKey(doc, id, 'opacity', s, 0, 'linear'), A.setKey(doc, id, 'opacity', f, e.material.opacity, 'ease-out');
      }
      report.push({ task: task.name, start: new Date(task.start).toISOString().slice(0, 10), finish: new Date(task.finish).toISOString().slice(0, 10), from: s, to: f, builds: ids.map((id) => D.getEntity(doc, id).name) });
    }
    const end = Math.max(...report.map((r) => r.to));
    doc.animation.duration = Math.max(doc.animation.duration, Math.ceil(end + 1));
    if (a.caption !== false) {
      doc.animation.captions = [...(doc.animation.captions || []).filter((c) => !c.date), { text: '', date: true, start_date: t0, seconds_per_day: spd, tasks: report.map((r) => ({ name: r.task, start: r.from, end: r.to })), start: 0, end: Math.ceil(end + 1), style: 'label', position: 'top-left', fade: 0.01 }];
    }
    return { tasks: report.length, matched: report.filter((r) => r.builds.length).length, unmatched: report.filter((r) => !r.builds.length).map((r) => r.task), seconds_per_day: spd, duration: doc.animation.duration, schedule: report };
  }, true);


  // ---------------------------------------------------------------- modelling power tools (Phase 14)
  const shapeOf = (ref) => {
    const [e] = D.resolve(ctx.doc, ref);
    if (!e.mesh) throw new Error(`${e.name} is not a shape.`);
    return e;
  };
  const faceList = (e, faces) => (faces === undefined ? [] : [].concat(faces).map((f) => pickFace(ctx.doc, e, f)));
  const setMesh = (e, mesh, polygons = true) => {
    R.bake(e);
    e.mesh = polygons ? Topo.repairMesh(mesh, { closeHoles: false }).mesh : mesh;
    return summary(ctx.doc, e);
  };
  const EDGES = { description: 'which edges: all (every sharp convex edge), vertical, horizontal, top, bottom, or [[a, b], …] vertex pairs from list_elements' };

  for (const mode of ['fillet', 'chamfer'])
    def('edit', `${mode}_edges`, mode === 'fillet' ? 'Round the edges of a shape (radius, segments): the most used finish in product design. Works on sharp convex edges between flat faces.' : 'Bevel the edges of a shape by a distance along both faces.', obj({ id, edges: EDGES, [mode === 'fillet' ? 'radius' : 'distance']: num('m'), segments: num('fillet: steps round the curve (default 8)') }, ['id']), (a) => {
      const e = shapeOf(a.id);
      const r = mode === 'fillet' ? a.radius : a.distance;
      if (!(r > 0)) throw new Error(`${mode === 'fillet' ? 'radius' : 'distance'} must be above 0.`);
      R.bake(e);
      const cutters = MD.pickEdges(e.mesh, a.edges ?? 'all').map((ed) => MD.edgeCutter(e.mesh, ed, { radius: r, mode, segments: a.segments || 8 })).filter(Boolean);
      if (!cutters.length) throw new Error('No sharp convex edges there to work on.');
      const out = setMesh(e, booleanMeshes('subtract', e.mesh, cutters));
      return { ...out, edges: cutters.length };
    }, true);

  def('create', 'loft', 'A solid (or surface) through two or more profiles in order: a vase from circles, a duct from a square to a circle, a transition. Profiles: curve ids or point lists; closed rings get end caps.', obj({ profiles: { type: 'array', items: { description: 'curve id / name, or [[x, y, z], …]' }, description: 'in order, two or more' }, caps: bool('close the ends (default true)'), points: num('points round each ring (default: the most of any profile)'), open: bool('the profiles are open lines: a surface'), name: common.name, color: common.color }, ['profiles']), (a) => {
    const doc = ctx.doc;
    const rings = a.profiles.map((p) => (Array.isArray(p) ? p : (() => {
      const [c] = D.resolve(doc, p);
      if (!c.curve) throw new Error(`${c.name} is not a curve.`);
      return D.curvePoints(doc, c);
    })()));
    const closedRing = (r) => !a.open;
    const pts = rings.map((r) => (closedRing(r) && r.length > 2 && G.len(G.sub(r[0], r.at(-1))) < 1e-6 ? r.slice(0, -1) : r));
    const { mesh, origin } = G.recenter(MD.loft(pts, { closed: !a.open, caps: a.caps !== false, points: a.points }));
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Loft'), mesh, position: D.round3(origin), material: a.color ? { color: a.color } : {} });
    ctx.selection.set([e.id]);
    return summary(doc, e);
  }, true);

  def('edit', 'shell', 'Hollow a solid to a wall thickness; open: faces to remove (top for an open box, a tank without a lid).', obj({ id, thickness: num('wall, m'), open: { description: 'face index or name, or a list (default: none, a closed hollow)' } }, ['id', 'thickness']), (a) => {
    const e = shapeOf(a.id);
    R.bake(e);
    return setMesh(e, MD.shell(e.mesh, a.thickness / (e.scale[0] || 1), faceList(e, a.open)));
  }, true);

  def('edit', 'thicken', 'Give a lone face or a surface a thickness: outwards along its normals, or half each way (both).', obj({ id, thickness: num('m'), both: bool('half each side') }, ['id', 'thickness']), (a) => {
    const e = shapeOf(a.id);
    R.bake(e);
    return setMesh(e, MD.thicken(e.mesh, a.thickness / (e.scale[0] || 1), { both: !!a.both }));
  }, true);

  def('edit', 'inset_face', 'Inset a face: a smaller copy inside its outline (the same as offset_face with a positive distance), ready to push or pull.', obj({ id, face: { description: 'face index or name (default top)' }, distance: num('m inwards') }, ['id', 'distance']), async (a) => reg.run('offset_face', { id: a.id, face: a.face ?? 'top', distance: Math.abs(a.distance) }), true);

  def('edit', 'extrude_faces', 'Extrude faces along their normals: together as one region (shared walls) or each on its own (individual): quick detailing, studs, panels.', obj({ id, faces: { description: 'face indices or names' }, distance: num('m (negative: inwards)'), individual: bool('each face on its own') }, ['id', 'faces', 'distance']), (a) => {
    const e = shapeOf(a.id);
    R.bake(e);
    return setMesh(e, MD.extrudeFaces(e.mesh, faceList(e, a.faces), a.distance / (e.scale[0] || 1), { individual: !!a.individual }), false);
  }, true);

  def('edit', 'divide_edge', 'Split an edge into equal parts (new points in both faces along it), to move or draw from them.', obj({ id, edge: { description: '[a, b] vertex indices (list_elements)' }, segments: num('default 2') }, ['id', 'edge']), (a) => {
    const e = shapeOf(a.id);
    R.bake(e);
    return setMesh(e, MD.divideEdge(e.mesh, a.edge[0], a.edge[1], a.segments || 2), false);
  }, true);

  def('edit', 'weld_edges', 'Weld a shape\'s loose seams: points closer than tolerance become one, so edges join up.', obj({ ids, tolerance: num('m (default 0.0001)') }), (a) => {
    const out = [];
    for (const e of targets(ctx, a).filter((x) => x.mesh)) {
      R.bake(e);
      const before = e.mesh.v.length;
      e.mesh = Topo.repairMesh(e.mesh, { tol: a.tolerance ?? 1e-4, merge: false, closeHoles: false }).mesh;
      out.push({ name: e.name, welded: before - e.mesh.v.length });
    }
    return out;
  }, true);

  def('edit', 'split_solid', 'Cut a solid in two along a plane (point and normal): two shapes, each closed.', obj({ id, point: v3('a point on the plane'), normal: v3('the plane normal (default [0, 1, 0])') }, ['id']), (a) => {
    const doc = ctx.doc;
    const e = shapeOf(a.id);
    R.bake(e);
    const w = D.worldMesh(doc, e);
    const b = G.bbox(w);
    const size = Math.max(...b.max.map((x, k) => x - b.min[k])) * 4 + 1;
    const n = G.norm(a.normal || [0, 1, 0]);
    const p = a.point || b.min.map((x, k) => (x + b.max[k]) / 2);
    // a big box on the normal's side of the plane
    const half = G.box(size, size, size);
    const up = [0, 1, 0];
    const axis = G.cross(up, n);
    const ang = Math.acos(Math.max(-1, Math.min(1, G.dot(up, n))));
    const rot = new Matrix4().makeRotationAxis(new Vector3(...(G.len(axis) > 1e-9 ? G.norm(axis) : [1, 0, 0])), ang).setPosition(new Vector3(...p));
    const cutter = { v: half.v.map((q) => new Vector3(...q).applyMatrix4(rot).toArray()), f: half.f };
    const keep = booleanMeshes('subtract', w, [cutter]);
    const other = booleanMeshes('intersect', w, [cutter]);
    const toLocal = (m) => {
      const inv = D.worldMatrix(doc, e).invert();
      return Topo.repairMesh({ v: m.v.map((q) => new Vector3(...q).applyMatrix4(inv).toArray()), f: m.f }, { closeHoles: false }).mesh;
    };
    e.mesh = toLocal(keep);
    const copy = D.duplicateEntity(doc, e);
    copy.name = `${e.name} (cut)`;
    copy.mesh = toLocal(other);
    return { kept: summary(doc, e), cut: summary(doc, copy) };
  }, true);

  def('edit', 'intersect_faces', 'Intersect shapes: curves where their faces cross (like SketchUp\'s Intersect Faces), to push, pull or split from.', obj({ ids: { type: 'array', items: { type: 'string' }, description: 'two or more shapes' } }, ['ids']), (a) => {
    const doc = ctx.doc;
    const ents = D.resolve(doc, a.ids).filter((e) => e.mesh);
    if (ents.length < 2) throw new Error('Give two or more shapes.');
    const made = [];
    for (let i = 0; i < ents.length; i++)
      for (let j = i + 1; j < ents.length; j++)
        for (const line of MD.meshIntersections(D.worldMesh(doc, ents[i]), D.worldMesh(doc, ents[j]))) {
          const closed = line.length > 3 && G.len(G.sub(line[0], line.at(-1))) < 1e-4;
          const { mesh, origin } = G.recenter({ v: closed ? line.slice(0, -1) : line, f: [] });
          made.push(D.addEntity(doc, { type: 'curve', name: D.uniqueName(doc, 'Intersection'), curve: { kind: 'polyline', points: mesh.v, closed }, position: D.round3(origin), material: { color: '#c8553d' } }));
        }
    if (!made.length) throw new Error('Those shapes do not cross.');
    ctx.selection.set(made.map((e) => e.id));
    return { curves: made.length, ids: made.map((e) => e.id) };
  }, true);

  def('edit', 'subdivide', 'Subdivision smoothing (Catmull-Clark, levels 1–3): organic, rounded shapes from a low-poly cage.', obj({ id, levels: num('1–3 (default 2)') }, ['id']), (a) => {
    const e = shapeOf(a.id);
    R.bake(e);
    return setMesh(e, MD.catmullClark(e.mesh, a.levels || 2), false);
  }, true);

  def('edit', 'deform', 'Deform a shape without losing it: taper (amount: how much the far end shrinks, 0.5 = half), twist and bend (degrees end to end) or lattice (8 corner offsets), along x, y or z. Live: change it with set_params; the original is kept hidden.', obj({ id, type: str('taper | twist | bend | lattice', ['taper', 'twist', 'bend', 'lattice']), amount: num('taper 0–1; twist / bend degrees'), axis: str('x | y | z (default y)', ['x', 'y', 'z']), segments: num('points along it (default 16)'), corners: { type: 'array', items: v3('offset'), description: 'lattice: 8 [dx, dy, dz]' }, name: common.name }, ['id', 'type']), (a) => {
    const doc = ctx.doc;
    const src = shapeOf(a.id);
    const params = { type: a.type, amount: a.amount ?? (a.type === 'taper' ? 0.5 : 45), axis: a.axis || 'y', segments: a.segments || 16, ...(a.corners ? { corners: a.corners } : {}) };
    const e = D.addEntity(doc, { name: a.name || `${src.name} (${a.type})`, mesh: { v: [], f: [] }, derived: { generator: 'deform', inputs: [src.id], params }, material: { ...src.material }, tag: src.tag });
    R.regenerate(doc, e);
    src.visible = false;
    ctx.selection.set([e.id]);
    return summary(doc, e);
  }, true);

  def('edit', 'simplify_mesh', 'Fewer faces for lighter files: ratio of the triangles to keep (0.25 = a quarter). Shapes only change by about the size of the merge.', obj({ ids, ratio: num('0–1 (default 0.5)') }), (a) => {
    const out = [];
    for (const e of targets(ctx, a).filter((x) => x.mesh)) {
      R.bake(e);
      const before = [...G.triangles(e.mesh)].length;
      e.mesh = MD.simplify(e.mesh, a.ratio ?? 0.5);
      out.push({ name: e.name, triangles: [before, e.mesh.f.length] });
    }
    return out;
  }, true);

  def('edit', 'set_symmetry', 'Symmetry while editing: push_pull and move_elements also do the mirror-image change across the shape\'s own middle (axis x, y or z). "off" stops it.', obj({ axis: str('x | y | z | off', ['x', 'y', 'z', 'off']) }, ['axis']), (a) => {
    ctx.doc.settings.symmetry = a.axis === 'off' ? null : a.axis;
    return { symmetry: ctx.doc.settings.symmetry };
  }, true);

  def('create', 'create_rectangle', 'A rectangle on any angle from three points: a corner, a point along the first side, and a point that sets the width (a flat face, ready to push or pull).', obj({ points: { type: 'array', items: v3('point'), description: '[corner, along the first side, across]' }, name: common.name, color: common.color }, ['points']), async (a) => {
    if (a.points?.length !== 3) throw new Error('points: three points.');
    return reg.run('create_face', { points: MD.rectangle3(...a.points), name: a.name || 'Rectangle', ...(a.color ? { color: a.color } : {}) });
  }, true);

  def('view', 'set_axes', 'Drawing axes: turn them (angle, degrees about up) and move their origin to draw on a rotated building grid; grid step (m) with snap makes clicks on the ground land on the grid.', obj({ origin: v3('axes origin'), angle: num('degrees about up, from the world x axis'), grid: num('grid step, m (0: the default grid)'), snap: bool('snap ground clicks to the grid'), reset: bool('back to the world axes') }), (a) => {
    const s = ctx.doc.settings;
    if (a.reset) return delete s.axes, { axes: null };
    s.axes = { origin: a.origin || s.axes?.origin || [0, 0, 0], angle: a.angle ?? s.axes?.angle ?? 0, grid: a.grid ?? s.axes?.grid ?? 0, snap: a.snap ?? s.axes?.snap ?? false };
    return { axes: s.axes };
  }, true);

  def('file', 'import_2d', 'A 2D drawing onto the ground for modelling: SVG (paths, shapes; units from its width, or scale m per unit) or DXF (its linework). faces: closed outlines become faces ready to push or pull (a floor plan to walls).', obj({ path: str('absolute .svg or .dxf path'), text: str('the SVG text instead of a path'), scale: num('m per drawing unit (default: from the SVG, else 0.001: mm)'), faces: bool('closed outlines become faces (default false)'), layer: str('layer for the lines (default "2D")') }), async (a) => {
    const doc = ctx.doc;
    if (a.path && /\.dxf$/i.test(a.path)) {
      const before = new Set(doc.entities.map((e) => e.id));
      const r = await reg.run('import', { path: a.path });
      const fresh = doc.entities.filter((e) => !before.has(e.id) && e.curve).map((e) => e.id);
      if (a.faces && fresh.length) await reg.run('curves_to_faces', { ids: fresh }).catch(() => {});
      return r;
    }
    const text = a.text ?? (await ctx.io?.readText?.(a.path));
    if (!text) throw new Error('Give path (an .svg or .dxf) or text.');
    const lines = SVG.svgPolylines(text);
    const k = a.scale || SVG.svgUnit(text) || 0.001;
    // y down in SVG: the drawing's top is north (−z)
    const all = lines.flatMap((l) => l.pts);
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of all) (minX = Math.min(minX, x)), (minY = Math.min(minY, y)), (maxX = Math.max(maxX, x)), (maxY = Math.max(maxY, y));
    const layer = a.layer || '2D';
    L.ensureLayer(doc, layer);
    const made = [];
    for (const l of lines) {
      const pts = l.pts.map(([x, y]) => [(x - minX) * k, 0, (y - minY) * k]);
      if (pts.length < 2) continue;
      const { mesh, origin } = G.recenter({ v: pts.map(D.round3), f: [] });
      made.push(D.addEntity(doc, { type: 'curve', name: D.uniqueName(doc, l.layer || 'Line'), curve: { kind: 'polyline', points: mesh.v, closed: l.closed }, position: D.round3(origin), tag: layer, material: { color: '#1d262c' } }));
    }
    let faces = [];
    if (a.faces) faces = (await reg.run('curves_to_faces', { ids: made.filter((e) => e.curve.closed).map((e) => e.id) })).faces;
    return { curves: made.length, faces: faces.length, scale: k, size: [(maxX - minX) * k, (maxY - minY) * k].map((x) => Math.round(x * 1000) / 1000) };
  }, true);

  def('create', 'curves_to_faces', 'Closed flat curves (a floor plan\'s rooms, outlines) become faces you can push or pull.', obj({ ids, layer: str('every closed curve on this layer') }), async (a) => {
    const doc = ctx.doc;
    const curves = (a.layer ? doc.entities.filter((e) => e.curve && e.tag === a.layer) : targets(ctx, a)).filter((e) => e.curve?.closed || (e.curve && G.len(G.sub(e.curve.points[0], e.curve.points.at(-1))) < 1e-6));
    const faces = [];
    for (const c of curves) {
      let pts = D.curvePoints(doc, c, 4);
      if (G.len(G.sub(pts[0], pts.at(-1))) < 1e-6) pts = pts.slice(0, -1);
      if (pts.length < 3) continue;
      faces.push((await reg.run('create_face', { points: pts.map(D.round3), name: `${c.name} face`, tag: c.tag })).id);
    }
    if (!faces.length) throw new Error('No closed curves there.');
    return { faces };
  }, true);

  def('edit', 'array_grid', 'Copies in a grid: nx × ny × nz of each shape, spacing [dx, dy, dz] m apart (columns on a grid, a façade of windows, seats).', obj({ ids, nx: num('along x (default 1)'), ny: num('up (default 1)'), nz: num('along z (default 1)'), spacing: v3('m between copies (default: the shape size + 0.5)') }), (a) => {
    const doc = ctx.doc;
    const made = [];
    for (const e of targets(ctx, a)) {
      const b = D.worldBox(doc, e);
      const sp = a.spacing || b.max.map((x, k) => x - b.min[k] + 0.5);
      const [nx, ny, nz] = [a.nx || 1, a.ny || 1, a.nz || 1].map((n) => Math.max(1, Math.round(n)));
      if (nx * ny * nz > 2000) throw new Error('At most 2000 copies.');
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++)
          for (let k = 0; k < nz; k++) {
            if (!i && !j && !k) continue;
            const c = D.duplicateEntity(doc, e);
            c.position = D.round3(G.add(e.position, [i * sp[0], j * sp[1], k * sp[2]]));
            c.name = `${e.name} ${i + 1}.${j + 1}.${k + 1}`;
            made.push(c.id);
          }
    }
    return { copies: made.length, ids: made };
  }, true);

  def('edit', 'array_path', 'Copies along a curve: count of each shape spread evenly from start to end, turned to follow it (align) — street lights, fence posts, trees along a road.', obj({ ids, path: str('curve id / name'), count: num('copies (default 10)'), align: bool('turn each to the curve (default true)') }, ['path']), (a) => {
    const doc = ctx.doc;
    const [c] = D.resolve(doc, a.path);
    if (!c.curve) throw new Error(`${c.name} is not a curve.`);
    const places = MD.pathPlacements(D.curvePoints(doc, c), Math.max(1, Math.round(a.count || 10)), { closed: c.curve.closed });
    const made = [];
    for (const e of targets(ctx, { ...a, ids: a.ids?.length ? a.ids : ctx.selection.get().filter((id) => id !== c.id) })) {
      places.forEach((pl, i) => {
        const copy = i === 0 ? e : D.duplicateEntity(doc, e);
        copy.position = pl.position;
        if (a.align !== false) copy.rotation = [e.rotation[0], pl.heading, e.rotation[2]];
        if (i) copy.name = `${e.name} ${i + 1}`;
        made.push(copy.id);
      });
    }
    return { placed: made.length, ids: made };
  }, true);

  def('create', 'insert_asset', 'Put a model from the component library (the library folder: GLB / glTF files) into the scene at a point.', obj({ name: str('file name in the library (list_assets)'), position: v3('where (default: the origin)'), scale: num('uniform scale (default 1)') }, ['name']), async (a) => {
    if (!ctx.io?.libraryPath) throw new Error('The component library needs the desktop app.');
    const path = await ctx.io.libraryPath(a.name);
    const before = new Set(ctx.doc.entities.map((x) => x.id));
    const r = await reg.run('import', { path });
    const e = ctx.doc.entities.find((x) => !before.has(x.id) && !x.parent);
    if (e) {
      if (a.position) e.position = D.round3(a.position);
      if (a.scale) e.scale = [a.scale, a.scale, a.scale];
      e.name = a.name.replace(/\.\w+$/, '');
      ctx.selection.set([e.id]);
    }
    return e ? summary(ctx.doc, e) : r;
  }, true);

  def('scene', 'list_assets', 'The component library: GLB / glTF files in the library folder (put your own there).', obj({}), async () => {
    if (!ctx.io?.listLibrary) throw new Error('The component library needs the desktop app.');
    return ctx.io.listLibrary();
  });

  def('edit', 'save_selection', 'Save the current selection (or ids) as a named selection set, to select it again in one go.', obj({ name: str('set name'), ids }, ['name']), (a) => {
    const doc = ctx.doc;
    const ids = targets(ctx, a).map((e) => e.id);
    doc.selection_sets = { ...(doc.selection_sets || {}), [a.name]: ids };
    return { name: a.name, count: ids.length, sets: Object.keys(doc.selection_sets) };
  }, true);

  def('scene', 'select_set', 'Select a saved selection set.', obj({ name: str('set name') }, ['name']), (a) => {
    const sets = ctx.doc.selection_sets || {};
    const key = Object.keys(sets).find((k) => k.toLowerCase() === a.name.toLowerCase());
    if (!key) throw new Error(`No selection set "${a.name}". Sets: ${Object.keys(sets).join(', ') || 'none (save_selection makes one)'}.`);
    const ids = sets[key].filter((id) => D.getEntity(ctx.doc, id));
    ctx.selection.set(ids);
    return { name: key, selected: ids.length };
  });

  def('edit', 'delete_selection_set', 'Forget a selection set (the shapes stay).', obj({ name: str('set name') }, ['name']), (a) => {
    const sets = { ...(ctx.doc.selection_sets || {}) };
    delete sets[a.name];
    ctx.doc.selection_sets = sets;
    return { sets: Object.keys(sets) };
  }, true);


  // ---------------------------------------------------------------- interop, scale and input (Phase 15)
  const pcPositions = (e) => new Float32Array(Assets.bytes(e.pointcloud.asset).slice().buffer, 0, e.pointcloud.count * 3);

  def('file', 'import_point_cloud', 'A scan or drone point cloud as a reference to model over: PLY, LAS (uncompressed) or XYZ / PTS / CSV text, thinned to max_points, in project coordinates (the base point, or set from the cloud). Snap to it; classify_ground makes a terrain from it.', obj({ path: str('absolute .ply / .las / .xyz / .pts / .csv path'), max_points: num('default 300000'), name: common.name }, ['path']), async (a) => {
    if (!ctx.io?.readBinary) throw new Error('Point clouds need the desktop app.');
    const doc = ctx.doc;
    const pc = PC.parsePointCloud(await ctx.io.readBinary(a.path), a.path);
    const keep = PC.thin(pc, a.max_points || 300000);
    const g = S.geo(doc);
    let base = g.base;
    if (!base) {
      // no base point yet: the cloud's lowest corner becomes it (big coordinates), or at least its floor level
      const [mx, my, mz] = PC.bounds(pc);
      const big = Math.abs(mx) > 1e4 || Math.abs(my) > 1e4;
      base = big ? [Math.round(mx), Math.round(my), Math.floor(mz)] : [0, 0, Math.floor(mz)];
      if (base.some((x) => x)) g.base = base;
    }
    const pos = new Float32Array(keep.length * 3);
    const col = pc.r ? new Uint8Array(keep.length * 3) : null;
    keep.forEach((i, k) => {
      pos[k * 3] = pc.x[i] - base[0];
      pos[k * 3 + 1] = pc.z[i] - base[2];
      pos[k * 3 + 2] = -(pc.y[i] - base[1]);
      if (col) (col[k * 3] = pc.r[i]), (col[k * 3 + 1] = pc.g[i]), (col[k * 3 + 2] = pc.b[i]);
    });
    const bytes = new Uint8Array(pos.byteLength + (col ? col.byteLength : 0));
    bytes.set(new Uint8Array(pos.buffer), 0);
    if (col) bytes.set(col, pos.byteLength);
    const asset = Assets.put(bytes, { mime: 'application/x-mmr-points', name: a.path.split(/[\\/]/).pop() });
    const e = D.addEntity(doc, { type: 'pointcloud', name: a.name || a.path.split(/[\\/]/).pop().replace(/\.\w+$/, ''), pointcloud: { asset, count: keep.length, colors: !!col, format: pc.format, of: pc.count }, material: { color: '#7a8a96' } });
    ctx.selection.set([e.id]);
    return { id: e.id, name: e.name, points: keep.length, in_file: pc.count, format: pc.format, colors: !!col, base };
  }, true);

  def('terrain', 'classify_ground', 'A terrain surface from a point cloud: the ground points found (lowest per cell, within tolerance of the ground and its slope; buildings and trees left out), thinned, triangulated.', obj({ id: str('the point cloud'), cell: num('m (default 1)'), tolerance: num('m above the ground still ground (default 0.25)'), slope: num('rise per m allowed (default 0.3)'), window: num('m, wider than the biggest building (default 20)'), name: common.name }, ['id']), (a) => {
    const doc = ctx.doc;
    const [pcE] = D.resolve(doc, a.id);
    if (!pcE.pointcloud) throw new Error(`${pcE.name} is not a point cloud.`);
    const p = pcPositions(pcE);
    const n = pcE.pointcloud.count;
    const pc = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), count: n };
    for (let i = 0; i < n; i++) (pc.x[i] = p[i * 3]), (pc.y[i] = -p[i * 3 + 2]), (pc.z[i] = p[i * 3 + 1]);
    const idx = PC.classifyGround(pc, { cell: a.cell || 1, tolerance: a.tolerance ?? 0.25, slope: a.slope ?? 0.3, window: a.window || 20 });
    if (idx.length < 3) throw new Error('Too few ground points: try a bigger cell or tolerance.');
    const pts = idx.map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]].map((x) => Math.round(x * 1000) / 1000));
    const { faces } = TR.triangulate(pts, { maxEdge: Math.max((a.cell || 1) * 8, a.window || 20) }); // bridges the footprints
    const { mesh, origin } = G.recenter({ v: pts, f: faces });
    const e = D.addEntity(doc, { name: a.name || `${pcE.name} ground`, mesh, position: D.round3(origin), material: { color: '#8fae7a', roughness: 0.95 }, meta: { surface: true, source: pcE.name } });
    return { ...summary(doc, e), ground_points: pts.length, of: n };
  }, true);

  def('drawings', 'vectorise_underlay', 'Scanned drawing to linework: the image (or PDF page) thresholded, thinned and traced into curves on the drawing, simplified; by window. min_length and simplify in pixels of the scan.', obj({ id, window: WINDOW, threshold: num('0–255, darker is ink (default 128)'), min_length: num('pixels (default 12)'), simplify: num('pixels (default 1.5)'), resolution: num('longest side traced, pixels (default 2000)'), layer: str('layer (default "Scan")') }, ['id']), async (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    if (!ctx.view?.underlayPixels) throw new Error('Vectorising needs the desktop app.');
    const { gray, w, h } = await ctx.view.underlayPixels(e, a.resolution || 2000);
    const [W, H] = e.underlay.size;
    let lines = RS.vectorise(gray, w, h, { threshold: a.threshold ?? 128, minLength: a.min_length ?? 12, tolerance: a.simplify ?? 1.5 }).map((l) => ({ pts: l.map(([x, y]) => [(x / w) * W, (y / h) * H]), color: '#1d262c', layer: 'scan' }));
    const win = winOf(e, a.window);
    if (win) lines = DW.filterPaths(lines, { window: win }).kept;
    const clean = DW.cleanLines(lines, e.underlay.affine, { tol: 0.01, join: true });
    const f = DW.frame(doc, e);
    const layer = a.layer || 'Scan';
    L.ensureLayer(doc, layer);
    const made = clean.map((l) => {
      const { mesh, origin } = G.recenter({ v: l.pts.map((q) => D.round3(f.planToWorld(q))), f: [] });
      return D.addEntity(doc, { type: 'curve', name: D.uniqueName(doc, 'Scan line'), curve: { kind: 'polyline', points: mesh.v, closed: l.closed }, position: D.round3(origin), tag: layer, material: { color: '#1d262c' } });
    });
    if (!made.length) throw new Error('No lines found: try another threshold or window.');
    ctx.selection.set(made.map((x) => x.id));
    return { curves: made.length, traced_at: [w, h] };
  }, true);

  def('drawings', 'read_drawing', 'Plumb\'s first pass on a new drawing: finds its scale, title, date, north and labelled grid lines (control points) from its text, and with use_ai from a picture too. apply: sets the scale, names the drawing and georeferences it from the grid — one undo step.', obj({ id, use_ai: bool('also ask the vision model (default true when one is set)'), apply: bool('apply what was found') }, ['id']), async (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    let texts = [];
    let size = e.underlay.size;
    if (e.underlay.kind === 'pdf') {
      const c = await pdfContent(e);
      texts = c.texts.map((t) => ({ str: t.str, at: t.at, size: t.size }));
      size = c.size || size;
    }
    let clues = DC.readClues(texts, size);
    if (a.use_ai !== false && ctx.ai?.vision && ctx.view?.underlayImage) {
      try {
        const image = await ctx.view.underlayImage(e, 1400);
        const reply = await ctx.ai.vision({ system: DC.READ_PROMPT, text: `Sheet size ${size.map(Math.round).join(' × ')} units. Text on it: ${JSON.stringify(texts.slice(0, 300).map((t) => [t.str, t.at.map(Math.round)]))}`, images: [image] });
        clues = DC.mergeClues(clues, DC.jsonIn(reply));
        clues.ai = true;
      } catch (err) {
        clues.ai_error = err.message;
      }
    }
    const applied = [];
    if (a.apply) {
      if (clues.scale?.ratio && !clues.control.length) await reg.run('calibrate_underlay', { id: e.id, drawing_scale: `1:${clues.scale.ratio}` }), applied.push(`scale 1:${clues.scale.ratio}`);
      if (clues.control.length >= 2) {
        for (const c of clues.control) await reg.run('add_control_pair', { id: e.id, from: { u: c.u, v: c.v }, to: { n: c.n, e: c.e } });
        await reg.run('georeference_underlay', { id: e.id });
        applied.push(`georeferenced from ${clues.control.length} grid crossings`);
      }
      if (clues.title) (e.name = clues.title.slice(0, 80)), applied.push(`named "${e.name}"`);
    }
    return { ...clues, applied };
  }, true);

  def('scene', 'save_version', 'Save a named version of the model inside the file (restore or compare it later).', obj({ name: str('version name (default: the date and time)') }), (a) => {
    const doc = ctx.doc;
    const v = IO2.snapshot(doc, a.name || new Date().toISOString().slice(0, 16).replace('T', ' '));
    doc.versions = [...(doc.versions || []).filter((x) => x.name !== v.name), v];
    return { saved: v.name, versions: doc.versions.map((x) => ({ name: x.name, time: x.time })) };
  }, true);
  def('scene', 'list_versions', 'The named versions saved in this file.', obj({}), () => (ctx.doc.versions || []).map((v) => ({ name: v.name, time: v.time, entities: v.doc.entities.length })));
  const versionOf = (name) => {
    const v = (ctx.doc.versions || []).find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!v) throw new Error(`No version "${name}". Versions: ${(ctx.doc.versions || []).map((x) => x.name).join(', ') || 'none (save_version makes one)'}.`);
    return v;
  };
  def('scene', 'restore_version', 'Go back to a saved version (the versions stay; undo brings the current model back).', obj({ name: str('version name') }, ['name']), (a) => {
    const v = versionOf(a.name);
    const keep = ctx.doc.versions;
    ctx.store.doc = { ...JSON.parse(JSON.stringify(v.doc)), versions: keep };
    return { restored: v.name, entities: ctx.store.doc.entities.length };
  }, true);
  def('scene', 'compare_versions', 'What changed between a version and another one (or the model now): shapes added, changed and removed, by name.', obj({ from: str('version name'), to: str('version name (default: now)') }, ['from']), (a) => {
    const A0 = versionOf(a.from).doc;
    const B0 = a.to ? versionOf(a.to).doc : ctx.doc;
    const d = D.diffDocs(A0, B0);
    const name = (doc, id) => doc.entities.find((e) => e.id === id)?.name || id;
    return { added: d.added.map((id) => name(B0, id)), changed: d.changed.map((id) => name(B0, id)), removed: d.removed.map((id) => name(A0, id)) };
  });
  def('scene', 'delete_version', 'Forget a saved version.', obj({ name: str('version name') }, ['name']), (a) => {
    const v = versionOf(a.name);
    ctx.doc.versions = ctx.doc.versions.filter((x) => x !== v);
    return { versions: ctx.doc.versions.map((x) => x.name) };
  }, true);

  const docsApi = () => {
    if (!ctx.docs) throw new Error('Several documents need the desktop app.');
    return ctx.docs;
  };
  def('scene', 'list_documents', 'The documents open in tabs.', obj({}), () => docsApi().list());
  def('scene', 'new_document', 'Open a new empty document in a tab (copy / paste works between tabs).', obj({ name: common.name }), (a) => docsApi().create(a.name));
  def('scene', 'switch_document', 'Show another open document (by name or tab number from 1).', obj({ name: str('document name or number') }, ['name']), (a) => docsApi().switch(a.name));
  def('scene', 'close_document', 'Close a document tab (the current one by default); unsaved changes are lost unless saved first.', obj({ name: str('document name or number') }), (a) => docsApi().close(a.name));

  def('scene', 'set_shortcut', 'A keyboard shortcut of your own for a menu action, a tool or any command: key like "Ctrl+Shift+F" or "G". Saved in the settings; "none" removes it.', obj({ key: str('the keys'), action: str('a menu action name, tool:<id>, or a command name') }, ['key', 'action']), async (a) => {
    if (!ctx.io?.setSettings) throw new Error('Shortcuts need the desktop app.');
    const key = SC.normalise(a.key);
    const s = { ...(ctx.io.settings?.().shortcuts || {}) };
    if (a.action === 'none') delete s[key];
    else s[key] = a.action;
    await ctx.io.setSettings({ shortcuts: s });
    return { shortcuts: s };
  });
  def('scene', 'list_shortcuts', 'Your keyboard shortcuts (on top of the built-in ones).', obj({}), () => ctx.io?.settings?.().shortcuts || {});
  // learning modules (#213): progress is the user's, kept with the app's settings (not in the model)
  const learnState = () => ctx.io?.settings?.()?.learning || ctx.learning || {};
  const lessonsDone = () => learnState().done || [];
  const tutorialsDone = () => learnState().tutorials || [];
  const saveLearning = async (patch) => {
    if (ctx.io?.setSettings) await ctx.io.setSettings({ learning: patch });
    else ctx.learning = { ...learnState(), ...patch };
  };
  def('scene', 'list_lessons', 'The learning modules (1 Getting started … 5 Presenting): each lesson (a help page), whether it is done, whether it has guided steps (a tutorial) and whether those were finished, and the points, level and badges earned.', obj({}), () => {
    const done = new Set(lessonsDone());
    const tut = new Set(tutorialsDone());
    return { ...LEARN.progress([...done], [...tut]), modules: LEARN.MODULES.map((m) => ({ id: m.id, title: m.title, lessons: m.lessons.map((l) => ({ id: l.id, done: done.has(l.id), guided: !!l.guide, tutorial_done: tut.has(l.id) })) })) };
  });
  def('scene', 'complete_lesson', `Mark a lesson done (or not, done: false). Lessons also complete by themselves when you run one of their commands. tutorial: its guided steps were finished (+${LEARN.TUTORIAL_POINTS} points, once).`, obj({ id: str('lesson (help page id)'), done: bool('default true'), tutorial: bool('the guided steps were finished') }, ['id']), async (a) => {
    const lesson = LEARN.allLessons().find((l) => l.id === a.id);
    if (!lesson) throw new Error(`No lesson "${a.id}".`);
    const done = new Set(lessonsDone());
    const tut = new Set(tutorialsDone());
    if (a.done === false) (done.delete(a.id), tut.delete(a.id));
    else {
      done.add(a.id);
      if (a.tutorial && lesson.guide) tut.add(a.id);
    }
    await saveLearning({ done: [...done], tutorials: [...tut] });
    return LEARN.progress([...done], [...tut]);
  });
  // achievements and insights (#222): counted by the app on this PC (settings.stats), read here
  def('scene', 'my_insights', 'Your achievements and insights: days active, streaks, modelling minutes, commands run, favourite commands, what Plumb did for you (and the time it saved), and the achievement tracks (Draftsman, Builder, Surveyor, Road maker…) with their tier and progress to the next.', obj({}), () => {
    const p = LEARN.progress(lessonsDone(), tutorialsDone());
    return ACH.insights(ctx.io?.settings?.()?.stats || ctx.stats || {}, { lessons: p.lessons, tutorials: p.tutorials });
  });
  // AI setup that connects by itself (#198)
  def('ai', 'detect_local_models', 'Find the AI models on this PC: servers answering on their usual ports (Ollama, LM Studio, llama.cpp / LocalAI, vLLM, Jan, GPT4All) with their models, models downloaded from Hugging Face (they need one of those servers to run), and whether Claude Desktop is installed (for the MCP link).', obj({}), async () => {
    if (!ctx.io?.detectModels) throw new Error('Needs the desktop app.');
    const r = await ctx.io.detectModels();
    const tools = /mistral|qwen|llama3|llama-3|hermes|command-r|granite|gpt-oss|deepseek/i;
    for (const s of r.servers) s.suggested = s.models.find((m) => tools.test(m)) || s.models[0] || null;
    r.installed ||= [];
    r.advice = r.servers.length
      ? `Found ${r.servers.map((s) => `${s.name} (${s.models.length} model${s.models.length === 1 ? '' : 's'})`).join(', ')}. use_ai_model connects one.`
      : r.installed.length
        ? r.installed.map((x) => `${x.name} is installed${x.models.length ? ` with ${x.models.join(', ')}` : ''} but not running. ${x.start}`).join(' ')
        : r.huggingface.length
        ? 'Models are downloaded from Hugging Face, but no server is running them: load one in LM Studio or Ollama and detect again, or download_ai_model gets the built-in model.'
        : 'No local AI server found. The built-in model needs none (Provider: Built-in model, one download); or use Claude or an OpenAI-compatible API key.';
    return r;
  });
  // local AI setup (#224): the steps the setup card shows, for the API and MCP too
  const setupIo = () => {
    if (!ctx.io?.aiSetup) throw new Error('Needs the desktop app.');
    return ctx.io.aiSetup;
  };
  def('ai', 'ai_setup_status', 'Where Plumb\'s local model stands: the built-in model (downloaded or not), or Ollama (running, stopped or not installed, its models); local says which one the setup uses and next what to do (download | start | pull | ready).', obj({}), async () => {
    const s = await setupIo()('status');
    // without Ollama installed, the built-in model (#238) is the way: one download, no second app
    s.local = s.provider === 'builtin' || (s.provider === 'ollama' && s.ollama === 'missing' && s.builtin) ? 'builtin' : s.provider === 'ollama' ? 'ollama' : null;
    s.next = !s.local ? 'ready' : s.local === 'builtin' ? (s.provider === 'builtin' && s.builtin.has_model ? 'ready' : 'download') : s.ollama === 'stopped' ? 'start' : !s.has_model ? 'pull' : 'ready';
    return s;
  });
  def('ai', 'download_ai_model', 'Download the assistant model the app runs itself (default qwen3-4b, about 2.5 GB, once; a stopped download resumes; the file is checked against its SHA-256) and use it for Plumb: it then works offline, with no other app. Progress shows in the app.', obj({ model: str('built-in model id from list_ai_models: qwen3-4b (default), ministral3-3b, ministral3-8b, ministral3-14b') }), async (a) => {
    const r = await setupIo()('download', a.model);
    await ctx.io.setSettings?.({ ai: { provider: 'builtin', builtin: { model: r.model } } });
    return r;
  });
  def('ai', 'list_ai_models', 'The models Plumb can run itself (all Apache 2.0): id, size, a short note, whether each is downloaded, whether this PC has the memory it wants, and which one is in use.', obj({}), async () => {
    const s = await setupIo()('status');
    return { in_use: s.provider === 'builtin' ? s.builtin.model : null, models: s.builtin.models };
  });
  def('ai', 'delete_ai_model', 'Delete a downloaded built-in model from this PC to free its disk space (download_ai_model gets it back).', obj({ model: str('built-in model id from list_ai_models') }, ['model']), (a) => setupIo()('delete', a.model));
  def('ai', 'pause_ai_download', 'Stop the model download in progress (download_ai_model or pull_ai_model); the built-in model resumes where it stopped next time.', obj({}), () => setupIo()('cancel'));
  def('ai', 'start_local_ai', 'Start Ollama on this PC (installed but not running).', obj({}), () => setupIo()('start'));
  def('ai', 'install_local_ai', 'Install Ollama: opens a window running winget (Windows) where the user follows the install, or the download page.', obj({}), () => setupIo()('install'));
  def('ai', 'pull_ai_model', 'Download a model into Ollama (default: Plumb\'s model, e.g. mistral, about 4 GB); progress shows in the app.', obj({ model: str('model name, e.g. mistral, qwen2.5, llama3.1') }), async (a) => setupIo()('pull', a.model || ctx.io.settings?.()?.ai?.ollama?.model || 'mistral'));
  def('ai', 'use_ai_model', 'Use a model for Plumb: provider builtin (the model the app runs itself, see download_ai_model), ollama (a local Ollama), openai (any OpenAI-compatible server: LM Studio, llama.cpp, vLLM, Jan, the Mistral API…) or anthropic (Claude, with its key in Settings), with its base URL and model name.', obj({ provider: str('builtin | ollama | openai | anthropic', ['builtin', 'ollama', 'openai', 'anthropic']), base_url: str('server URL (ollama: http://127.0.0.1:11434; LM Studio: http://127.0.0.1:1234/v1)'), model: str('model name, e.g. mistral') }, ['provider']), async (a) => {
    if (!ctx.io?.setSettings) throw new Error('Needs the desktop app.');
    const part = { ...(a.base_url ? { baseUrl: a.base_url } : {}), ...(a.model ? { model: a.model } : {}) };
    await ctx.io.setSettings({ ai: { provider: a.provider, [a.provider]: part } });
    return { provider: a.provider, ...part };
  });
  def('scene', 'set_language', 'The language of the menus and panels: en (English) or fr (Français).', obj({ lang: str('en | fr', Object.keys(I18N.LANGUAGES)) }, ['lang']), async (a) => {
    if (!ctx.io?.setSettings) throw new Error('Needs the desktop app.');
    await ctx.io.setSettings({ language: a.lang });
    return { language: a.lang };
  });

  def('file', 'export_web_viewer', 'A web page of the model to send to anyone: one HTML file with the model, its animation and orbit controls, three.js inside (no app, no network).', obj({ path: str('absolute .html path'), title: str('the page title') }), async (a) => {
    if (!ctx.io?.webViewerParts) throw new Error('Needs the desktop app.');
    const path = a.path || (await ctx.io.pick('html', true, `${ctx.doc.name || 'Model'}.html`));
    if (!path) return { cancelled: true };
    const parts = await ctx.io.webViewerParts();
    const html = IO2.webViewerHtml({ title: a.title || ctx.doc.name || 'Model', ...parts });
    await ctx.io.writeText(path, html);
    return { path, kb: Math.round(html.length / 1024) };
  });

  def('file', 'compress_glb', 'Make a GLB file smaller: meshopt (fast, lossless for positions) or draco (smallest geometry). Writes it back in place, or to out.', obj({ path: str('absolute .glb path'), method: str('meshopt | draco (default meshopt)', ['meshopt', 'draco']), out: str('absolute .glb path for the result') }, ['path']), async (a) => {
    if (!ctx.io?.compressGlb) throw new Error('Needs the desktop app.');
    return ctx.io.compressGlb(a.path, a.method || 'meshopt', a.out);
  });

  def('file', 'search_assets', 'Free CC0 models, textures and HDRIs from Poly Haven: a search; import_asset brings one in.', obj({ query: str('words'), type: str('models | textures | hdris (default models)', ['models', 'textures', 'hdris']), limit: num('default 12') }), async (a) => {
    if (!ctx.io?.netJson) throw new Error('Needs the desktop app.');
    return IO2.polyhavenSearch(await ctx.io.netJson(IO2.polyhavenList(a.type || 'models')), a.query, a.limit || 12);
  });
  def('file', 'import_asset', 'Bring in a Poly Haven asset by id: a model (glTF), a texture (onto the selection) or an HDRI (as the environment). The licence (CC0) goes into the metadata.', obj({ id: str('asset id from search_assets'), type: str('models | textures | hdris', ['models', 'textures', 'hdris']), resolution: str('1k | 2k | 4k (default 1k)'), size: num('textures: m of one tile (default 2)') }, ['id', 'type']), async (a) => {
    if (!ctx.io?.netDownload) throw new Error('Needs the desktop app.');
    const plan = IO2.polyhavenDownload(await ctx.io.netJson(IO2.polyhavenFiles(a.id)), a.type, a.resolution || '1k');
    const local = await ctx.io.netDownload(plan.files);
    if (plan.kind === 'hdri') return reg.run('set_environment', { path: local[0], background: true });
    if (plan.kind === 'texture') return reg.run('set_texture', { path: local[0], size: [a.size || 2, a.size || 2] });
    const before = new Set(ctx.doc.entities.map((e) => e.id));
    await reg.run('import', { path: local[0] });
    const made = ctx.doc.entities.find((e) => !before.has(e.id) && !e.parent);
    if (made) made.meta = { ...(made.meta || {}), source: `Poly Haven ${a.id}`, licence: 'CC0' };
    return made ? summary(ctx.doc, made) : { imported: a.id };
  }, true);

  def('create', 'generate_mesh', 'Text or image to 3D: a prop or a piece of furniture made by a 3D model service (Tripo, or a local server in AI settings) from words or a picture, brought in as a shape.', obj({ prompt: str('what to make: "a wooden garden chair"'), image: str('or an absolute image path'), position: v3('where'), height: num('scale it to this height, m') }), async (a) => {
    if (!ctx.io?.generateMesh) throw new Error('Needs the desktop app.');
    const path = await ctx.io.generateMesh({ prompt: a.prompt, image: a.image });
    const before = new Set(ctx.doc.entities.map((e) => e.id));
    await reg.run('import', { path });
    const e = ctx.doc.entities.find((x) => !before.has(x.id) && !x.parent);
    if (!e) return { path };
    if (a.height) {
      const b = D.worldBox(ctx.doc, e);
      const k = a.height / Math.max(1e-6, b.max[1] - b.min[1]);
      e.scale = e.scale.map((x) => x * k);
    }
    if (a.position) e.position = D.round3(a.position);
    e.name = (a.prompt || 'Generated').slice(0, 40);
    e.meta = { ...(e.meta || {}), source: 'generated', prompt: a.prompt || a.image };
    return summary(ctx.doc, e);
  }, true);

  def('ai', 'transcribe_audio', 'Speech to text on this PC (MyVoiceReel\'s engine): a recording becomes text, for voice commands to Plumb.', obj({ path: str('absolute audio path (wav, mp3, m4a…)'), lang: str('language code, e.g. fr (default: detected)') }, ['path']), async (a) => {
    if (!ctx.io?.transcribe) throw new Error('Needs the desktop app.');
    return ctx.io.transcribe(a.path, a.lang);
  });

  // agent profiles (#243): several copilots with their own model, skill, instructions and thread, working at once
  const crew = () => {
    if (!ctx.agents) throw new Error('Agents need the desktop app.');
    return ctx.agents;
  };
  const agent = str('agent id or name (default: Plumb)');
  def('ai', 'list_agents', 'The agent profiles (Plumb is the default) with what each is doing (idle, working, queued tasks), and the changes held because two agents touched the same thing.', obj({}), () => crew().list());
  def('ai', 'save_agent', 'Create or change an agent profile. provider / model empty: the app\'s AI settings. skill: a skill id from list_skills. toolset: auto or a toolset name. instructions: what it always keeps in mind.', obj({ id: str('profile id to change (new when absent)'), name: str('display name'), provider: str('builtin | anthropic | openai | ollama (empty: AI settings)'), model: str('model name'), skill: str('skill id'), toolset: str('auto or a toolset'), instructions: str('standing instructions'), color: str('#rrggbb') }), (a) => crew().save(a));
  def('ai', 'remove_agent', 'Delete an agent profile (not Plumb).', obj({ agent }, ['agent']), (a) => crew().remove(a.agent));
  def('ai', 'ask_agent', 'Give an agent a task: it joins that agent\'s queue and runs when the agent is free, alongside other agents. Returns at once (the reply goes to its thread).', obj({ agent, text: str('the task'), ids: { ...ids, description: 'entities to point it at' }, point: v3('a point in the model, world metres') }, ['text']), (a) => crew().ask(a.agent, a.text, { ids: a.ids, point: a.point }));
  def('ai', 'stop_agent', 'Stop an agent\'s running turn and clear its queue (what it did so far stays; undo removes it).', obj({ agent }), (a) => crew().stop(a.agent));
  def('ai', 'retry_agent', 'Run an agent\'s last task again.', obj({ agent }), (a) => crew().retry(a.agent));
  def('ai', 'held_change', 'A change held because two agents touched the same thing: apply it (one undo step) or drop it.', obj({ n: num('its number, from list_agents'), action: str('apply | drop', ['apply', 'drop']) }, ['n', 'action']), (a) => crew().held(a.n, a.action));

  def('view', 'walk_to', 'Stand somewhere at eye height (1.6 m above what is under it) and look towards a point: a walk-through view. The Walk tool moves on from there (arrow keys or WASD, drag to look).', obj({ position: v3('where to stand (x, z; y is found)'), look_at: v3('what to look at'), eye: num('eye height, m (default 1.6)') }, ['position']), (a) => {
    if (!ctx.view?.walkTo) throw new Error('Needs the desktop app.');
    return ctx.view.walkTo(a.position, a.look_at, a.eye ?? 1.6);
  });

  def('view', 'set_snaps', 'Which snaps the drawing tools use (#180): endpoint, midpoint, face, axis (along x / y / z from the last point), grid, drawing (PDF lines, when snap_underlays is on), cloud (point cloud points), survey (survey points), tie (a vertex snapped to a survey point stays tied to it; false: snap without tying). Each true or false; the rest stay as they are.', obj(Object.fromEntries(['endpoint', 'midpoint', 'face', 'axis', 'grid', 'drawing', 'cloud', 'survey', 'tie'].map((k) => [k, bool(`snap to ${k}`)]))), (a) => {
    const s = ctx.doc.settings;
    s.snaps = { ...(s.snaps || {}), ...a };
    return { snaps: { endpoint: true, midpoint: true, face: true, axis: true, grid: true, drawing: true, cloud: true, survey: true, tie: true, ...s.snaps } };
  }, true);
  def('view', 'set_gizmo', 'On-canvas handles on the selection: drag arrows (move), rings (rotate) or boxes (scale). off hides them.', obj({ mode: str('move | rotate | scale | off', ['move', 'rotate', 'scale', 'off']) }, ['mode']), (a) => {
    ctx.doc.settings.gizmo = a.mode === 'off' ? null : a.mode;
    return { gizmo: ctx.doc.settings.gizmo };
  }, true);

  def('scene', 'list_autosaves', 'The automatic copies kept while you work (every five minutes, the last 20), newest first.', obj({}), async () => {
    if (!ctx.io?.autosaves) throw new Error('Needs the desktop app.');
    return ctx.io.autosaves();
  });
  def('scene', 'restore_autosave', 'Bring back an automatic copy (by name from list_autosaves); undo returns to now.', obj({ name: str('autosave name') }, ['name']), async (a) => {
    if (!ctx.io?.readAutosave) throw new Error('Needs the desktop app.');
    const saved = JSON.parse(await ctx.io.readAutosave(a.name));
    Assets.unpack(saved.assets);
    ctx.store.doc = saved.doc;
    return { restored: a.name, entities: saved.doc.entities.length };
  }, true);

  def('scene', 'performance_report', 'How heavy the model is to draw: shapes, triangles, draw calls, frames per second, and what would help.', obj({}), () => {
    const doc = ctx.doc;
    let tris = 0;
    for (const e of doc.entities) if (e.mesh) for (const f of e.mesh.f) tris += Math.max(1, f.length - 2);
    const pts = doc.entities.reduce((s, e) => s + (e.pointcloud?.count || 0), 0);
    const v = ctx.view?.stats?.() || {};
    const tips = [];
    if (tris > 2e6) tips.push('Over 2 million triangles: simplify_mesh on the heaviest imports.');
    if (pts > 2e6) tips.push('A very big point cloud: import it again with a lower max_points.');
    if ((v.calls || 0) > 3000) tips.push('Many separate shapes: make repeated ones components (they share geometry).');
    return { entities: doc.entities.length, triangles: tris, points: pts, ...v, tips };
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

  def('ai', 'list_skills', 'Domain skills: know-how and example scripts for architecture, product design, jobsite / heavy equipment and furniture, and skills the user saved (save_skill). Read one before working in that domain; use_skill gives it to Plumb, the in-app assistant.', obj({ name: str('one skill in full') }), (a) => {
    const all = { ...SKILLS, ...USER_SKILLS };
    if (a.name && !all[a.name]) throw new Error(`No skill "${a.name}". Skills: ${Object.keys(all).join(', ')}.`);
    const pick = a.name ? [[a.name, all[a.name]]] : Object.entries(all);
    return pick.map(([name, s]) => ({ name, label: s.label, description: s.description, ...(USER_SKILLS[name] ? { mine: true } : {}), ...(a.name ? { prompt: s.prompt, examples: s.examples, ...(s.toolset ? { toolset: s.toolset } : {}) } : {}), active: ctx.skill === name }));
  });

  def('ai', 'use_skill', 'Give Plumb, the in-app assistant, a domain skill or a skill the user saved (its know-how joins the system prompt), or none.', obj({ name: str('skill name (list_skills), or none') }, ['name']), (a) => {
    if (a.name !== 'none' && !SKILLS[a.name] && !USER_SKILLS[a.name]) throw new Error(`No skill "${a.name}". Skills: ${[...Object.keys(SKILLS), ...Object.keys(USER_SKILLS)].join(', ')}, none.`);
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
  // multiple views (#160–#164): camera commands act on pane 1 (the main view) unless given another
  const PANE = num('which view pane, 1–4 (default 1, the main view; see set_layout)');
  const inPane = (n, fn) => (n && n !== 1 && ctx.view?.inPane ? ctx.view.inPane(n, fn) : fn());
  const paneCfg = (n) => {
    const L = LY.normalize(ctx.doc.settings.layout);
    if (!Number.isInteger(n) || n < 1 || n > L.count) throw new Error(`There ${L.count === 1 ? 'is 1 pane' : `are ${L.count} panes`}: pane is 1 to ${L.count} (set_layout count adds panes).`);
    return { L, cfg: L.panes[n - 1] };
  };
  def('view', 'set_camera', 'Place the camera: eye position, target, field of view or lens (mm on full frame: 24 wide, 35, 50 normal, 85 portrait), projection (perspective or parallel: no vanishing points) and two_point (verticals stay vertical). pane: another view pane.', obj({ position: v3('eye'), target: v3('look-at point'), fov: num('degrees'), lens: num('mm (sets fov)'), projection: str('perspective | parallel', ['perspective', 'parallel']), two_point: bool('two-point perspective (pane 1)'), pane: PANE }), (a) => {
    if (a.lens) a = { ...a, fov: Math.round(LK.fovOfLens(a.lens) * 100) / 100 };
    if (a.pane > 1) {
      const { L, cfg } = paneCfg(a.pane);
      if (a.projection) cfg.projection = a.projection;
      ctx.doc.settings.layout = { ...ctx.doc.settings.layout, ...L };
    } else for (const k of ['projection', 'two_point']) if (a[k] !== undefined) ctx.doc.settings[k === 'projection' ? 'projection' : 'two_point'] = a[k];
    if (!ctx.view) return ctx.doc.camera;
    return inPane(a.pane, () => (ctx.view.setCamera(a), ctx.view.getCamera()));
  });
  def('view', 'set_view', 'Standard view: top, bottom, front, back, left, right, iso. Zooms to fit. pane: another view pane.', obj({ preset: str('view', ['top', 'bottom', 'front', 'back', 'left', 'right', 'iso']), pane: PANE }, ['preset']), (a) =>
    inPane(a.pane, () => (ctx.view?.setView(a.preset), ctx.view?.getCamera())),
  );
  def('view', 'zoom_extents', 'Fit the model (or the given entities) in the view. pane: another view pane, or "all" to fit every pane.', obj({ ids, pane: { description: 'view pane 1–4, or "all"' } }), (a) => {
    const fit = () => (ctx.view?.zoomExtents(a.ids ? D.resolve(ctx.doc, a.ids).map((e) => e.id) : null), ctx.view?.getCamera());
    if (a.pane !== 'all') return inPane(a.pane, fit);
    const n = LY.normalize(ctx.doc.settings.layout).count;
    return Array.from({ length: n }, (_, i) => inPane(i + 1, fit));
  });
  def('view', 'set_layout', 'Split the view into 1 to 4 panes, each with its own camera: columns (side by side), rows (stacked), grid (2 × 2), main_left / main_right / main_top / main_bottom (one big pane, the others beside it). split: [x, y] where the bars are (fractions 0.15–0.85). max: maximise a pane (1–4), 0 restores. New panes show top, front and right (parallel). show_camera: draw the main camera in the other panes (off by default).', obj({ count: num('panes, 1–4'), arrangement: str('how they sit', LY.ARRANGEMENTS), split: { type: 'array', items: { type: 'number' }, description: '[x, y] fractions' }, max: num('maximise pane 1–4; 0 restores'), show_camera: bool('the main camera drawn in the other panes (default false)') }), (a) => {
    const s = ctx.doc.settings;
    const cur = LY.normalize(s.layout);
    const next = { ...cur, show_camera: s.layout?.camera_mark };
    if (a.count !== undefined) {
      if (a.count !== cur.count && a.arrangement === undefined) next.arrangement = undefined; // the usual arrangement for that many
      next.count = a.count;
      next.max = null;
    }
    if (a.arrangement) next.arrangement = a.arrangement;
    if ((next.count !== cur.count || next.arrangement !== cur.arrangement) && !a.split) delete next.split; // that arrangement's own split
    if (a.split) next.split = a.split;
    if (a.max !== undefined) next.max = a.max > 0 ? a.max - 1 : null;
    if (a.show_camera !== undefined) next.show_camera = a.show_camera;
    s.layout = { ...LY.normalize(next), camera_mark: next.show_camera === true };
    ctx.view?.syncPanes?.();
    return ctx.view?.layoutInfo?.() ?? s.layout;
  }, true);
  def('view', 'set_pane', 'What one view pane shows: view perspective | top | front | back | left | right | bottom | iso (top, front… switch to parallel), a saved scene, or a road drawing: profile (the long section of a corridor) or section (its cross-section at station; panes 2–4); projection perspective | parallel; style shaded | wireframe. station: where the section panes cut the road (all of them).', obj({ pane: PANE, view: str('standard view or road drawing', LY.VIEWS), scene: str('a saved scene to look from'), projection: str('perspective | parallel', ['perspective', 'parallel']), style: str('shaded | wireframe', ['shaded', 'wireframe']), corridor: str('profile / section: the corridor (default the first one)'), station: num('m along the road, for the section panes') }, ['pane']), (a) => {
    const s = ctx.doc.settings;
    const { L, cfg } = paneCfg(a.pane);
    if (LY.ROAD_VIEWS.includes(a.view) && a.pane === 1) throw new Error('Pane 1 stays a 3D view; put the profile or section in pane 2, 3 or 4.');
    if (a.corridor || LY.ROAD_VIEWS.includes(a.view)) {
      const c = a.corridor ? D.resolve(ctx.doc, a.corridor)[0] : ctx.doc.entities.find((e) => e.derived?.generator === 'corridor');
      if (!c || c.derived?.generator !== 'corridor') throw new Error('No corridor to draw: create_corridor first.');
      cfg.corridor = c.id;
    }
    if (a.station !== undefined) L.station = Math.max(0, a.station);
    const scene = a.scene && ctx.doc.scenes.find((x) => x.name === a.scene);
    if (a.scene && !scene) throw new Error(`No scene "${a.scene}". Scenes: ${ctx.doc.scenes.map((x) => x.name).join(', ') || 'none (add_scene)'}.`);
    if (a.view) {
      cfg.view = a.view;
      delete cfg.scene;
      if (a.view === 'perspective') cfg.projection = 'perspective';
      else if (a.view !== 'iso') cfg.projection = 'parallel';
    }
    if (scene) Object.assign(cfg, { view: 'scene', scene: scene.name, projection: scene.camera.projection || 'perspective' });
    if (a.projection) cfg.projection = a.projection;
    if (a.style) cfg.style = a.style;
    if (a.pane === 1 && (a.view || a.scene || a.projection)) s.projection = cfg.projection;
    s.layout = { ...s.layout, ...L };
    if (ctx.view?.syncPanes) {
      ctx.view.syncPanes();
      if (!LY.ROAD_VIEWS.includes(cfg.view))
        inPane(a.pane, () => {
          if (scene) ctx.view.setCamera(scene.camera);
          else if (a.view) ctx.view.setView(a.view === 'perspective' ? 'iso' : a.view);
          else if (a.projection) ctx.view.setCamera({});
        });
    }
    return ctx.view?.layoutInfo?.() ?? s.layout;
  }, true);
  def('view', 'road_views', 'The road layout (#167, #168): four panes with the 3D view, the plan, the profile of a corridor and its cross-section at a station.', obj({ corridor: str('corridor (default the first one)'), station: num('m along the road for the section (default the middle)') }), (a) => {
    const c = a.corridor ? D.resolve(ctx.doc, a.corridor)[0] : ctx.doc.entities.find((e) => e.derived?.generator === 'corridor');
    if (!c || c.derived?.generator !== 'corridor') throw new Error('No corridor: create_corridor first.');
    const len = SW.corridorOf(ctx.doc, c).path.at(-1)[3];
    const cur = LY.normalize(ctx.doc.settings.layout);
    ctx.doc.settings.layout = {
      ...LY.normalize({ count: 4, arrangement: 'grid', panes: [cur.panes[0], { view: 'top', projection: 'parallel' }, { view: 'profile', corridor: c.id }, { view: 'section', corridor: c.id }] }),
      station: a.station ?? Math.round(len / 2),
      camera_mark: ctx.doc.settings.layout?.camera_mark === true,
    };
    if (ctx.view?.syncPanes) {
      ctx.view.syncPanes();
      inPane(2, () => (ctx.view.setView('top'), ctx.view.zoomExtents([c.id]))); // the plan framed on the road
    }
    return ctx.view?.layoutInfo?.() ?? ctx.doc.settings.layout;
  }, true);
  def('view', 'detach_pane', 'Move a view pane (2–4) to its own window, e.g. for a second screen; detached: false docks it back (closing the window docks it too).', obj({ pane: PANE, detached: bool('default true') }, ['pane']), (a) => {
    if (!ctx.view?.detachPane) throw new Error('Needs the desktop app.');
    return ctx.view.detachPane(a.pane, a.detached !== false);
  });
  def('view', 'get_layout', 'The view panes: how many, how they sit, and for each its view, projection, style, camera and whether it is in its own window.', obj({}), () => ctx.view?.layoutInfo?.() ?? LY.normalize(ctx.doc.settings.layout));
  def('view', 'set_style', 'Display style: edges, x-ray, wireframe, shadows, grid, sun position, survey point labels.', obj({ point_labels: str('survey point labels', ['name', 'name_z', 'code', 'all', 'none']), edges: bool(''), xray: bool(''), wireframe: bool(''), render_style: str('shaded (default) | hidden_line (white, black edges) | monochrome | sketchy (hand-drawn edges)', LK.STYLES), color_by: str('material (default) | layer: every shape in its layer colour', ['material', 'layer']), snap_underlays: bool('snap to the line ends and middles of PDF drawings without extracting them'), section_fill: bool('fill where the section plane cuts solids (default on)'), shadows: bool(''), grid: bool(''), sun: obj({ azimuth: num('degrees from north (−z), clockwise'), elevation: num('degrees above horizon') }) }), (a) => {
    const s = ctx.doc.settings;
    for (const k of ['edges', 'xray', 'wireframe', 'shadows', 'grid', 'point_labels', 'section_fill', 'render_style', 'color_by', 'snap_underlays']) if (a[k] !== undefined) s[k] = a[k];
    if (a.sun) s.sun = { ...s.sun, ...a.sun };
    return s;
  }, true);
  // section planes (#187): several kept by name, one cutting at a time (settings.section is the active one)
  const planes = () => (ctx.doc.settings.section_planes ||= []);
  const activate = (name) => {
    const s = ctx.doc.settings;
    const p = name && planes().find((x) => x.name === name);
    s.section_active = p ? p.name : null;
    s.section = p ? { normal: p.normal, point: p.point } : null;
  };
  const planeOf = (name) => {
    const p = planes().find((x) => x.name === name);
    if (!p) throw new Error(`No section plane "${name}". Section planes: ${planes().map((x) => x.name).join(', ') || 'none (section adds one)'}.`);
    return p;
  };
  const sectionList = () => ({ active: ctx.doc.settings.section_active || null, planes: planes().map((p) => ({ ...p, active: p.name === ctx.doc.settings.section_active })) });
  def('view', 'section', 'Cut the model with a section plane to see inside: the plane is kept by name (list_section_planes) and becomes the one that cuts. Disable with enabled:false (the plane stays in the list).', obj({ enabled: bool('default true'), normal: v3('the side that is cut away'), point: v3('a point on the plane'), name: str('name it (default Section 1, 2…)') }), (a) => {
    if (a.enabled === false) {
      activate(null);
      return { section: null, ...sectionList() };
    }
    const name = a.name || D.uniqueName({ entities: planes() }, 'Section');
    const plane = { name, normal: a.normal || [0, -1, 0], point: a.point || [0, 1.2, 0] };
    const i = planes().findIndex((x) => x.name === name);
    if (i >= 0) planes()[i] = plane;
    else planes().push(plane);
    activate(name);
    return { section: ctx.doc.settings.section, ...sectionList() };
  }, true);
  def('view', 'list_section_planes', 'The section planes kept in the model and which one cuts.', obj({}), () => sectionList());
  def('view', 'set_section_plane', 'Change a section plane: turn it on (the one that cuts) or off, flip the side it cuts away, move it along its normal by offset m, put it through a point, or rename it.', obj({ name: str('section plane'), active: bool('cut with it (true) or with none (false)'), flip: bool('cut away the other side'), offset: num('m to move it along its normal (towards the side it cuts away)'), point: v3('a point on the plane'), rename: str('new name') }, ['name']), (a) => {
    const p = planeOf(a.name);
    if (a.flip) p.normal = p.normal.map((x) => -x || 0);
    if (a.offset) p.point = p.point.map((x, k) => Math.round((x + p.normal[k] * a.offset) * 1e4) / 1e4);
    if (a.point) p.point = a.point;
    const wasActive = ctx.doc.settings.section_active === p.name;
    if (a.rename) p.name = a.rename;
    if (a.active === true || (a.active === undefined && wasActive)) activate(p.name);
    else if (a.active === false && wasActive) activate(null);
    return sectionList();
  }, true);
  def('view', 'delete_section_plane', 'Remove a section plane (and its cut, if it was cutting).', obj({ name: str('section plane') }, ['name']), (a) => {
    const p = planeOf(a.name);
    ctx.doc.settings.section_planes = planes().filter((x) => x !== p);
    if (ctx.doc.settings.section_active === p.name) activate(null);
    return sectionList();
  }, true);
  def('view', 'add_scene', 'Save the current camera as a named scene (a shot you can return to or animate between).', obj({ name: str('scene name') }), (a) => {
    const doc = ctx.doc;
    const cam = ctx.view?.getCamera() ?? doc.camera;
    const name = a.name || `Scene ${doc.scenes.length + 1}`;
    doc.scenes = doc.scenes.filter((s) => s.name !== name);
    doc.scenes.push({ name, camera: cam });
    return { scenes: doc.scenes.map((s) => s.name) };
  }, true);
  def('view', 'view_back', 'Back to the previous view (camera), like a browser back button.', obj({}), () => {
    if (!ctx.view?.viewBack) throw new Error('Needs the desktop app.');
    return ctx.view.viewBack();
  });
  def('view', 'view_forward', 'Forward again after view_back.', obj({}), () => {
    if (!ctx.view?.viewForward) throw new Error('Needs the desktop app.');
    return ctx.view.viewForward();
  });
  def('view', 'zoom_window', 'Zoom into a window of the view: corners as fractions of the view (0–1 from the left and top).', obj({ x0: num('left'), y0: num('top'), x1: num('right'), y1: num('bottom'), pane: PANE }, ['x0', 'y0', 'x1', 'y1']), (a) => {
    if (!ctx.view?.zoomWindow) throw new Error('Needs the desktop app.');
    return inPane(a.pane, () => ctx.view.zoomWindow(a.x0, a.y0, a.x1, a.y1));
  });
  def('view', 'go_to_scene', 'Jump the camera to a saved scene.', obj({ name: str('scene name'), pane: PANE }, ['name']), (a) => {
    const s = ctx.doc.scenes.find((x) => x.name === a.name);
    if (!s) throw new Error(`No scene "${a.name}".`);
    inPane(a.pane, () => ctx.view?.setCamera(s.camera));
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
  const MODEL_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'usdz', 'png', 'video'];
  def('file', 'list_formats', 'File formats this app reads and writes, with their options (LandXML, IFC, DXF and models).', obj({}), () => [...F.listFormats(), { id: 'glb / gltf / obj / stl / fbx', label: '3D models (insert)', import: true, export: true }]);
  def('file', 'import', 'Bring a file into the current model: LandXML (points, surfaces, alignments, linework), Trimble JobXML (points) and FXL (feature library), GeoJSON and Shapefile (features with attributes), IFC (BIM elements with property sets, storeys, layers, georeferencing), DXF (CAD linework, layers, blocks as components, 3D faces) or a 3D model (glb, gltf, obj, stl, fbx). Returns what came in, what was skipped and why.', obj({ path: str('absolute path'), text: str('or: the file contents (text formats)'), format: str('when the extension does not say: landxml | jxl | fxl | geojson | shp | ifc | dxf'), layer: str('put everything on this layer'), coordinates: str('DXF: project (E, N, Z) or local; default: project when the numbers are big', ['project', 'local']), units: str('DXF without units: m | ft | usft'), properties: bool('IFC: read property sets (default true)') }), async (a) => {
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
    const extra = await fmt.read(data, { doc, cmd: (n, x) => reg.commands.get(n).run(x), report, opts: a, io: ctx.io });
    const made = doc.entities.filter((e) => !before.has(e.id) && (!e.parent || before.has(e.parent)));
    if (!made.length && !Object.keys(report.done().created).length) throw new Error(`Nothing to import in that ${fmt.id.toUpperCase()} file${report.done().skipped.length ? `: ${report.done().skipped.map((x) => x.what).join('; ')}` : ''}.`);
    ctx.selection.set(made.filter((e) => !S.isPoint(e)).map((e) => e.id).slice(0, 2000));
    return report.done({ format: fmt.id, file: a.path ? String(a.path).split(/[\\/]/).pop() : undefined, ...(extra || {}) });
  }, true);
  def('file', 'export', `Export: ${MODEL_FORMATS.join(', ')} (models, viewport image, video) or an exchange format: landxml (points, surfaces, alignments, linework), ifc (BIM: IFC4, or IFC4X3 with schema), dxf (CAD R12: layers, polylines, points, 3D faces, components as blocks), geojson and shp (points, lines, polygons with attributes). selection: only the selected entities.`, obj({ format: str('format: glb, gltf, obj, stl, png, video, landxml, ifc, dxf, geojson, shp'), path: str('absolute output path; omit to be asked'), selection: bool('only the selection (and what is inside it)'), schema: str('IFC: IFC4 (default) or IFC4X3'), coordinates: str('DXF: project (E, N, Z, default) or local', ['project', 'local']), name: str('project name written in the file'), points: bool('LandXML: write the survey points (CgPoints), default true') }, ['format']), async (a) => {
    const fmt = F.getFormat(a.format);
    if (!fmt) {
      if (!MODEL_FORMATS.includes(a.format)) throw new Error(`Unknown format "${a.format}". list_formats shows them.`);
      return needIO().exportAs(a.format, a.path);
    }
    if (!fmt.write && !fmt.writeFiles) throw new Error(`${fmt.label}: import only.`);
    const doc = ctx.doc;
    const ents = a.selection ? [...new Set(targets(ctx, {}).flatMap((e) => [e, ...D.descendants(doc, e.id)]))] : doc.entities;
    if (!ents.length) throw new Error('Nothing to export (the selection is empty).');
    const io = needIO();
    const path = a.path || (await io.pick(fmt.id, true, `Model.${fmt.extensions[0]}`));
    if (!path) return { cancelled: true };
    if (fmt.writeFiles) {
      // several files (a shapefile is .shp + .shx + .dbf, one set per geometry kind)
      const files = fmt.writeFiles(doc, { ents, opts: a });
      if (!Object.keys(files).length) throw new Error(`Nothing in the ${a.selection ? 'selection' : 'model'} that a ${fmt.id} file can hold.`);
      const stem = path.replace(/[.][A-Za-z0-9]+$/, '');
      const written = [];
      for (const [suffix, bytes] of Object.entries(files)) await io.writeText(stem + suffix, bytes), written.push(stem + suffix);
      return { paths: written, format: fmt.id, entities: ents.length };
    }
    const text = fmt.write(doc, { ents, opts: { ...a, version: ctx.version } });
    await io.writeText(path, text);
    return { path, format: fmt.id, bytes: text.length, entities: ents.length };
  }, true);
  // ---------------------------------------------------------------- live references (#246)
  const refsOf = (a) => (a.ids?.length ? D.resolve(ctx.doc, a.ids) : ctx.doc.entities).filter((e) => e.xref && (!a.path || e.xref.path === a.path));
  def('file', 'reference_file', 'Show another design as a live reference: a .usda (or .usdc, .usdz, .glb, .obj…) shown read-only and snappable, read again whenever its file changes (another window can publish_reference to it). Move, hide or recolour its parts here: those overrides stay in this model and are never written to that file. Its shapes cannot be edited until bind_reference.', obj({ path: str('absolute path'), name: str('name in the Outliner') }), async (a) => {
    a.path ||= await needIO().pick('reference', false);
    if (!a.path) return { cancelled: true };
    const g = D.addEntity(ctx.doc, { type: 'group', name: D.uniqueName(ctx.doc, a.name || String(a.path).split(/[\/]/).pop().replace(/\.\w+$/, '')), xref: { path: a.path, overrides: {} } });
    const r = USD.applyReference(ctx.doc, g, await needIO().referenceParts(a.path));
    ctx.selection.set([g.id]);
    return { id: g.id, name: g.name, ...r };
  }, true);
  def('file', 'reload_reference', 'Read live references again from their files (all of them by default). Overrides made here stay on top.', obj({ ids, path: str('only the references to this file') }), async (a) => {
    const list = refsOf(a);
    if (!list.length && !a.path) throw new Error('No live reference to reload.');
    for (const g of list) USD.applyReference(ctx.doc, g, await needIO().referenceParts(g.xref.path));
    return { reloaded: list.map((g) => g.name) };
  }, true);
  def('file', 'bind_reference', 'Make live references local: their parts become ordinary shapes (overrides included) and the file is no longer followed.', obj({ ids }), (a) => {
    const list = targets(ctx, a).filter((e) => e.xref);
    if (!list.length) throw new Error('Select a live reference (a group read from another file).');
    for (const g of list) USD.bindReference(ctx.doc, g);
    return { bound: list.map((g) => g.name) };
  }, true);
  def('file', 'publish_reference', 'Publish this design as a live reference: write it to a .usda now and again after every change (debounced), so other windows that reference_file it follow along. stop: true stops publishing.', obj({ path: str('absolute .usda path; omit to be asked'), stop: bool('stop publishing') }), async (a) => {
    if (a.stop) return needIO().publish(null);
    a.path ||= await needIO().pick('usda', true, 'Live.usda');
    if (!a.path) return { cancelled: true };
    if (!/\.usda$/i.test(a.path)) throw new Error('Publish to a .usda file.');
    return needIO().publish(a.path);
  });
  reg.commands.get('import').compound = true;
  reg.commands.get('generate_texture').compound = true;
  for (const n of ['inset_face', 'create_rectangle', 'import_2d', 'curves_to_faces', 'insert_asset', 'read_drawing', 'import_asset', 'generate_mesh', 'reference_file', 'reload_reference']) reg.commands.get(n).compound = true;
  // symmetry while editing (#27): the mirror-image push_pull / move_elements across the shape's middle
  const mirrorOf = (e, axis) => {
    const k = { x: 0, y: 1, z: 2 }[axis];
    const b = G.bbox(e.mesh);
    const mid = (b.min[k] + b.max[k]) / 2;
    return { k, flip: (p) => p.map((x, j) => (j === k ? 2 * mid - x : x)) };
  };
  const pp = reg.commands.get('push_pull');
  const ppRun = pp.run;
  pp.run = async (a) => {
    const axis = ctx.doc.settings.symmetry;
    if (!axis) return ppRun(a);
    const [e] = D.resolve(ctx.doc, a.id ?? ctx.selection.get()[0]);
    let twin = -1;
    if (e?.mesh) {
      const fi = pickFace(ctx.doc, e, a.face ?? 'top');
      const { k, flip } = mirrorOf(e, axis);
      const c = flip(G.faceCenter(e.mesh, fi));
      const n = G.faceNormal(e.mesh, fi).map((x, j) => (j === k ? -x : x));
      twin = e.mesh.f.findIndex((_, g) => g !== fi && G.len(G.sub(G.faceCenter(e.mesh, g), c)) < 1e-4 && G.dot(G.faceNormal(e.mesh, g), n) > 0.999);
    }
    const r = await ppRun(a);
    if (twin >= 0) await ppRun({ ...a, id: e.id, face: twin });
    return twin >= 0 ? { ...r, mirrored: true } : r;
  };
  const me = reg.commands.get('move_elements');
  const meRun = me.run;
  me.run = async (a) => {
    const axis = ctx.doc.settings.symmetry;
    if (!axis || !a.by) return meRun(a);
    const e = D.resolve(ctx.doc, a.id)[0];
    if (!e?.mesh) return meRun(a);
    const ids = a.vertices || (a.face !== undefined ? e.mesh.f[pickFace(ctx.doc, e, a.face)] : null);
    if (!ids) return meRun(a);
    const { k, flip } = mirrorOf(e, axis);
    const twins = [];
    const onPlane = [];
    for (const i of ids) {
      const m = flip(e.mesh.v[i]);
      if (G.len(G.sub(m, e.mesh.v[i])) < 1e-6) onPlane.push(i);
      else {
        const j = e.mesh.v.findIndex((p) => G.len(G.sub(p, m)) < 1e-4);
        if (j >= 0 && !ids.includes(j)) twins.push(j);
      }
    }
    const by = a.by.map((x, j) => (j === k && onPlane.length === ids.length ? 0 : x)); // the middle stays on the mirror
    const r = await meRun({ ...a, by });
    if (twins.length) await meRun({ id: e.id, vertices: twins, by: by.map((x, j) => (j === k ? -x : x)) });
    return { ...r, mirrored: twins.length };
  };

  // ---------------------------------------------------------------- model info, purge (#48), clipboard (#39)
  def('scene', 'model_info', 'Statistics of the model: entities by type, faces and vertices, layers, components and instances, materials, curves, survey points, underlays and the size of their files, bounds, base point, journal length.', obj({}), () => {
    const doc = ctx.doc;
    const by = {};
    let faces = 0;
    let verts = 0;
    for (const e of doc.entities) {
      by[e.type] = (by[e.type] || 0) + 1;
      if (e.mesh && !e.compKey) (faces += e.mesh.f.length), (verts += e.mesh.v.length);
    }
    const comps = Object.keys(doc.components || {});
    const box = D.unionBox(doc.entities.filter((e) => !e.parent).map((e) => D.worldBox(doc, e)));
    const assets = [...new Set(doc.entities.filter((e) => e.underlay).map((e) => e.underlay.asset))];
    const size = JSON.stringify(doc, Comp.stripForSave).length;
    return {
      entities: doc.entities.length,
      by_type: by,
      faces,
      vertices: verts,
      layers: doc.tags.length,
      components: comps.map((n) => ({ name: n, instances: Comp.instancesOf(doc, n).length })),
      materials: new Set(doc.entities.filter((e) => e.mesh).map((e) => e.material.color)).size,
      ...(Number.isFinite(box.min[0]) ? { bounds: { min: D.round3(box.min), max: D.round3(box.max), size: D.round3(box.max.map((v, k) => v - box.min[k])) } } : {}),
      ...(S.geo(doc).base ? { base_point: S.geo(doc).base, crs: S.geo(doc).crs } : {}),
      underlay_files: assets.length,
      underlay_bytes: assets.reduce((t, id) => t + (Assets.get(id)?.bytes.length || 0), 0),
      document_bytes: size,
      journal_steps: doc.journal?.length || 0,
      animated: doc.animation.tracks.length,
    };
  });
  def('scene', 'list_howtos', 'Help by intent: how-to pages for what people want to do (put a PDF in place, cut and fill a pad, hinge a door…), each with the clicks, a prompt for Plumb and the commands. query ranks them.', obj({ query: str('what you want to do, in words') }), (a) => findHowtos(a.query || '', 50).map(({ id, area, title, commands }) => ({ id, area, title, commands })));
  def('scene', 'open_howto', 'Open a how-to page in the Help panel (show the person how), and get its text.', obj({ id: str('page id from list_howtos', HOWTOS.map((x) => x.id)) }, ['id']), async (a) => {
    const page = HOWTOS.find((x) => x.id === a.id);
    if (!page) throw new Error(`No page "${a.id}". list_howtos shows them.`);
    ctx.help?.open(a.id);
    const markdown = ctx.io?.readHowto ? await ctx.io.readHowto(a.id).catch(() => null) : null;
    return { ...page, ...(markdown ? { markdown } : {}) };
  });
  def('file', 'list_templates', 'Start templates: small complete models to begin from (house, product turntable, jobsite, construction sequence, empty in metres or feet).', obj({}), () => TEMPLATES.map(({ id, name, description }) => ({ id, name, description })));
  def('file', 'new_from_template', 'Start a new model from a template (list_templates). Replaces the current model (undo brings it back).', obj({ id: str('template id', TEMPLATES.map((t) => t.id)) }, ['id']), async (a) => {
    const t = TEMPLATES.find((x) => x.id === a.id);
    if (!t) throw new Error(`No template "${a.id}": ${TEMPLATES.map((x) => x.id).join(', ')}.`);
    ctx.store.doc = D.newDoc(); // in place, so undo brings the old model back
    for (const [cmd, args] of t.steps()) await reg.run(cmd, args);
    ctx.selection.set([]);
    return { template: t.id, name: t.name, entities: ctx.doc.entities.length };
  }, true);
  reg.commands.get('new_from_template').compound = true;
  def('scene', 'check_for_updates', 'Is a newer version of the app out? Installed builds download it in the background; restart_to_update installs it.', obj({}), async () => {
    if (!ctx.io?.checkUpdates) throw new Error('Needs the desktop app.');
    return ctx.io.checkUpdates();
  });
  def('scene', 'restart_to_update', 'Restart into the downloaded update (the model is kept in the autosave).', obj({}), async () => {
    if (!ctx.io?.installUpdate) throw new Error('Needs the desktop app.');
    return ctx.io.installUpdate();
  });
  def('edit', 'purge', 'Remove what nothing uses: empty layers (not the current one), components with no instances, empty groups, layer states of deleted layers. Says what went.', obj({ layers: bool('empty layers (default true)'), components: bool('unused components (default true)'), groups: bool('empty groups (default true)') }), (a) => {
    const doc = ctx.doc;
    const out = { layers: [], components: [], groups: [] };
    if (a.groups !== false)
      for (let again = true; again; ) {
        again = false;
        for (const g of doc.entities.filter((e) => e.type === 'group' && !e.component && !D.childrenOf(doc, e.id).length)) {
          D.removeEntity(doc, g);
          out.groups.push(g.name);
          again = true;
        }
      }
    if (a.components !== false)
      for (const n of Object.keys(doc.components || {}))
        if (!Comp.instancesOf(doc, n).length) {
          delete doc.components[n];
          out.components.push(n);
        }
    if (a.layers !== false) {
      const used = new Set(doc.entities.map((e) => e.tag));
      for (const t of [...doc.tags]) {
        if (used.has(t.name) || t.name === 'Untagged' || t.name === (doc.settings.current_layer || 'Untagged')) continue;
        doc.tags = doc.tags.filter((x) => x !== t);
        out.layers.push(t.name);
      }
      for (const st of Object.values(doc.layerStates || {})) for (const k of Object.keys(st)) if (!doc.tags.some((t) => t.name === k)) delete st[k];
    }
    return { removed: out, total: out.layers.length + out.components.length + out.groups.length };
  }, true);
  def('edit', 'copy', 'Copy entities (with everything inside them) to the clipboard: paste them here or in another model.', obj({ ids }), async (a) => {
    const ents = targets(ctx, a);
    if (!ents.length) throw new Error('Select something to copy.');
    ctx.clipboard = Clip.copyEntities(ctx.doc, ents.map((e) => e.id));
    await ctx.io?.clipboardWrite?.(JSON.stringify(ctx.clipboard)).catch?.(() => {});
    return { copied: ents.length };
  });
  def('edit', 'cut', 'Copy entities to the clipboard and delete them.', obj({ ids }), async (a) => {
    const ents = targets(ctx, a);
    if (!ents.length) throw new Error('Select something to cut.');
    ctx.clipboard = Clip.copyEntities(ctx.doc, ents.map((e) => e.id));
    await ctx.io?.clipboardWrite?.(JSON.stringify(ctx.clipboard)).catch?.(() => {});
    for (const e of ents) D.removeEntity(ctx.doc, e);
    ctx.selection.set([]);
    return { cut: ents.length };
  }, true);
  def('edit', 'paste', 'Paste what was copied: in place (default, the same real-world spot even from another model), or moved by offset. Pasted entities are selected.', obj({ offset: v3('move by [x, y, z] m'), into: str('a group to paste into (default: the group being edited)') }), async (a) => {
    let clip = ctx.clipboard;
    const text = await ctx.io?.clipboardRead?.().catch?.(() => null);
    if (text && text.startsWith('{"mymodellerreel_clipboard"')) {
      try {
        clip = JSON.parse(text);
      } catch {
        // not ours after all: keep the in-app clipboard
      }
    }
    const parent = a.into ? D.resolve(ctx.doc, a.into)[0].id : ctx.context?.() || null;
    const ids = Clip.pasteEntities(ctx.doc, clip, { offset: a.offset || [0, 0, 0], parent });
    ctx.selection.set(ids);
    return { pasted: ids.length, ids };
  }, true);

  // ---------------------------------------------------------------- terrain depth (#121, #122, #123, #120, #34, #35, #37, #132, #146)
  const allSurfaces = () => ctx.doc.entities.filter((e) => e.mesh && (e.derived?.generator === 'surface' || e.meta?.surface || ['design_surface', 'smoothed_surface', 'contour_surface'].includes(e.derived?.generator)));
  const pathOf = (ref) => {
    if (Array.isArray(ref)) return ref;
    const [c] = D.resolve(ctx.doc, ref);
    if (!c.curve && !c.line) throw new Error(`${c.name} is not a curve, alignment or line.`);
    return c.curve ? D.curvePoints(ctx.doc, c) : S.lineworkPath(ctx.doc, c);
  };
  const projZ = (y) => y + (S.geo(ctx.doc).base?.[2] ?? 0);
  const modelY = (z) => z - (S.geo(ctx.doc).base?.[2] ?? 0);
  const csvOut = async (path, text) => {
    if (!path) return null;
    if (!ctx.io?.writeText) throw new Error('Writing files needs the desktop app.');
    await ctx.io.writeText(path, text);
    return path;
  };

  def('terrain', 'surface_contours', 'Contour lines of a surface every interval (major lines every n), live: they follow the surface. Labels show on major lines. Run again to change the interval.', obj({ id, interval: num('m, default 1'), major_every: num('a major line every n (default 5)'), base: num('a level the contours line up with (project, default 0)'), smooth: num('rounding passes 0–3 (default 1)'), layer: str('layer (default "Contours")'), name: common.name }, ['id']), (a) => {
    const doc = ctx.doc;
    const s = surfaceOf(a.id);
    let g = doc.entities.find((e) => e.contours?.surface === s.id);
    if (!g) {
      L.ensureLayer(doc, a.layer || 'Contours');
      g = D.addEntity(doc, { type: 'group', name: a.name || D.uniqueName(doc, `${s.name} contours`), tag: a.layer || 'Contours', contours: { surface: s.id } });
    }
    Object.assign(g.contours, { interval: a.interval ?? g.contours.interval ?? 1, major_every: a.major_every ?? g.contours.major_every ?? 5, base: a.base ?? g.contours.base ?? 0, smooth: a.smooth ?? g.contours.smooth ?? 1, stamp: null });
    SW.syncTerrain(doc);
    return { id: g.id, name: g.name, levels: g.contours.levels, lines: D.childrenOf(doc, g.id).length };
  }, true);
  def('terrain', 'export_contours', 'Write a contour group as DXF 3D polylines at their elevations (project coordinates).', obj({ id: str('contour group'), path: str('absolute .dxf path') }, ['id', 'path']), async (a) => {
    const [g] = D.resolve(ctx.doc, a.id);
    if (!g.contours) throw new Error(`${g.name} is not a contour group (surface_contours makes one).`);
    const text = F.getFormat('dxf').write(ctx.doc, { ents: D.descendants(ctx.doc, g.id), opts: { coordinates: 'project' } });
    await csvOut(a.path, text);
    return { path: a.path, lines: D.childrenOf(ctx.doc, g.id).length };
  });
  def('terrain', 'analyze_surface', 'Colour a surface by elevation bands, slope classes (% or degrees, your thresholds), aspect (the way it faces), or its difference to another surface; returns the legend. Live. kind "none" removes it.', obj({ id, kind: str('elevation | slope | aspect | difference | none', ['elevation', 'slope', 'aspect', 'difference', 'none']), bands: num('elevation: number of bands (default 8)'), thresholds: { type: 'array', items: { type: 'number' }, description: 'slope: class limits (default 2, 5, 10, 20, 33)' }, units: str('slope: percent | degrees', ['percent', 'degrees']), other: str('difference: the other surface') }, ['id', 'kind']), (a) => {
    const e = surfaceOf(a.id);
    if (a.kind === 'none') {
      delete e.analysis;
      if (e.mesh.fc) e.mesh = { v: e.mesh.v, f: e.mesh.f };
      return { id: e.id, analysis: 'none' };
    }
    e.analysis = { kind: a.kind, ...(a.bands ? { bands: a.bands } : {}), ...(a.thresholds ? { thresholds: a.thresholds } : {}), ...(a.units ? { units: a.units } : {}), ...(a.other ? { other: surfaceOf(a.other).id } : {}) };
    SW.syncTerrain(ctx.doc);
    return { id: e.id, kind: a.kind, legend: e.analysis.legend };
  }, true);
  def('terrain', 'surface_profile', 'A long section: heights of one or more surfaces along a curve, alignment or points, every interval. Returns the samples (chainage, elevations) and can save a CSV.', obj({ path: { description: 'curve / alignment id or name, or [[x, y, z], …]' }, surfaces: { type: 'array', items: { type: 'string' }, description: 'default: every surface' }, interval: num('m, default 1'), csv: str('absolute .csv path to save') }, ['path']), async (a) => {
    const surfs = a.surfaces ? a.surfaces.map(surfaceOf) : allSurfaces();
    if (!surfs.length) throw new Error('No surface to cut: make one first.');
    const p = SF.profile(pathOf(a.path), surfs.map((s) => SW.surfaceSampler(ctx.doc, s).z), a.interval || 1);
    const rows = p.samples.map((q) => ({ chainage: r4(q.s), x: r4(q.x), z: r4(q.z), ...Object.fromEntries(surfs.map((s, i) => [s.name, q.values[i] === null ? null : r4(projZ(q.values[i]))])) }));
    const csv = [['chainage', ...surfs.map((s) => s.name)].join(','), ...rows.map((r) => [r.chainage, ...surfs.map((s) => r[s.name] ?? '')].join(','))].join('\n');
    await csvOut(a.csv, csv);
    return { length: r4(p.length), surfaces: surfs.map((s) => s.name), samples: rows };
  });
  def('terrain', 'cross_sections', 'Cross-sections square to an alignment or curve every interval, from left to right offset, with the heights of one or more surfaces. Returns the sections and can save a CSV.', obj({ path: { description: 'alignment / curve id or name, or points' }, surfaces: { type: 'array', items: { type: 'string' } }, interval: num('m between sections (default 10)'), left: num('m (default 20)'), right: num('m (default 20)'), step: num('m between samples (default 1)'), csv: str('absolute .csv path') }, ['path']), async (a) => {
    const surfs = a.surfaces ? a.surfaces.map(surfaceOf) : allSurfaces();
    if (!surfs.length) throw new Error('No surface to cut: make one first.');
    const xs = SF.sections(pathOf(a.path), surfs.map((s) => SW.surfaceSampler(ctx.doc, s).z), { interval: a.interval || 10, left: a.left ?? 20, right: a.right ?? 20, step: a.step || 1 });
    const out = xs.map((x) => ({ station: x.station, points: x.points.map((q) => ({ offset: q.offset, ...Object.fromEntries(surfs.map((s, i) => [s.name, q.values[i] === null ? null : r4(projZ(q.values[i]))])) })) }));
    const csv = ['station,offset,' + surfs.map((s) => s.name).join(','), ...out.flatMap((x) => x.points.map((q) => [x.station, q.offset, ...surfs.map((s) => q[s.name] ?? '')].join(',')))].join('\n');
    await csvOut(a.csv, csv);
    return { surfaces: surfs.map((s) => s.name), sections: out };
  });
  def('terrain', 'create_pad', 'A building pad or platform: a top at an elevation (or with a grade) inside a closed curve, with cut and fill batter slopes (H:V) running out to the ground (daylighting). Live: change the outline, level or slopes and it follows. merge: also a design surface (ground + pads) for volumes.', obj({ outline: { description: 'a closed curve id / name, or [[x, y, z], …]' }, elevation: num('project elevation of the top'), grade: num('%, default 0'), bearing: num('direction the grade rises, degrees from north'), cut_slope: num('H:V, default 2'), fill_slope: num('H:V, default 2'), surface: str('the ground'), merge: bool('also make the merged design surface'), name: common.name, color: common.color }, ['outline', 'elevation', 'surface']), (a) => {
    const doc = ctx.doc;
    const ground = surfaceOf(a.surface);
    const curve = Array.isArray(a.outline) ? null : D.resolve(doc, a.outline)[0];
    if (curve && !curve.curve) throw new Error(`${curve.name} is not a curve.`);
    const params = { elevation: modelY(a.elevation), grade: a.grade || 0, bearing: a.bearing || 0, cut_slope: a.cut_slope || 2, fill_slope: a.fill_slope || 2, ...(curve ? {} : { outline: a.outline }) };
    const inputs = [curve?.id ?? null, ground.id].filter(Boolean);
    if (!curve) inputs.unshift(null);
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Pad'), material: { color: a.color || '#c9b38f', roughness: 0.9 }, meta: { surface: true } });
    R.derive(doc, e, 'pad', params, curve ? [curve.id, ground.id] : []);
    if (!curve) {
      e.derived.inputs = [];
      e.derived.params.outline = a.outline;
    }
    let merged = null;
    if (a.merge) {
      merged = doc.entities.find((x) => x.derived?.generator === 'design_surface' && x.derived.inputs[0] === ground.id);
      if (merged) {
        merged.derived.inputs.push(e.id);
        R.regenerate(doc, merged);
      } else {
        merged = D.addEntity(doc, { name: D.uniqueName(doc, 'Design surface'), material: { color: '#b7c99a', roughness: 0.95 }, meta: { surface: true } });
        R.derive(doc, merged, 'design_surface', {}, [ground.id, e.id]);
      }
    }
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), ...(merged ? { design_surface: merged.name } : {}) };
  }, true);
  def('terrain', 'set_batter', 'Change a pad: its elevation, grade, or cut and fill batter slopes.', obj({ id, elevation: num('project elevation'), grade: num('%'), bearing: num('degrees'), cut_slope: num('H:V'), fill_slope: num('H:V') }, ['id']), (a) => {
    const [e] = D.resolve(ctx.doc, a.id);
    if (e.derived?.generator !== 'pad') throw new Error(`${e.name} is not a pad.`);
    for (const k of ['grade', 'bearing', 'cut_slope', 'fill_slope']) if (a[k] !== undefined) e.derived.params[k] = a[k];
    if (a.elevation !== undefined) e.derived.params.elevation = modelY(a.elevation);
    R.regenerate(ctx.doc, e);
    return summary(ctx.doc, e);
  }, true);
  def('terrain', 'smooth_surface', 'A smoother copy of a surface for presentation or design: subdivided and smoothed between the surveyed points, which stay exactly where they are. Live on the source surface.', obj({ id, levels: num('subdivisions 1–3 (default 1)'), iterations: num('passes (default 10)'), strength: num('0–1 (default 0.5)'), keep_points: bool('surveyed points stay (default true)'), hide_source: bool('hide the original (default true)'), name: common.name }, ['id']), (a) => {
    const doc = ctx.doc;
    const s = surfaceOf(a.id);
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, `${s.name} smoothed`), tag: s.tag, material: { ...s.material }, meta: { surface: true } });
    R.derive(doc, e, 'smoothed_surface', { levels: a.levels ?? 1, iterations: a.iterations ?? 10, strength: a.strength ?? 0.5, keep_points: a.keep_points !== false }, [s.id]);
    if (a.hide_source !== false) s.visible = false;
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), triangles: e.mesh.f.length };
  }, true);
  def('terrain', 'assign_contour_elevations', 'Give contour lines their heights in one go: in the order given, from start, every interval (project elevations).', obj({ ids, start: num('elevation of the first'), interval: num('step between lines (default 1)') }, ['start']), (a) => {
    const ents = targets(ctx, a);
    ents.forEach((e, i) => {
      if (!e.curve) throw new Error(`${e.name} is not a curve.`);
      const y = modelY(a.start + i * (a.interval ?? 1));
      setPts(e, curve2d(e).pts3.map((p) => [p[0], y, p[2]]));
    });
    return { lines: ents.length };
  }, true);
  def('terrain', 'terrain_from_contours', 'A surface from contour lines (curves at their heights: imported from DXF, extracted from a PDF, or drawn). Flat triangles between two points of one contour are lifted; live: edit a contour and the surface follows.', obj({ ...LW, spacing: num('resample every m (default 2)'), weed: num('drop points within m of a straight line (default 0.05)'), name: common.name }), (a) => {
    const doc = ctx.doc;
    const ents = DW.curvesOf(doc, a.layer ? [] : targets(ctx, a), a.layer);
    if (ents.length < 2) throw new Error('Give two or more contour lines.');
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Surface from contours'), material: { color: '#8fae7a', roughness: 0.95 }, meta: { surface: true } });
    R.derive(doc, e, 'contour_surface', { spacing: a.spacing ?? 2, weed: a.weed ?? 0.05 }, ents.map((c) => c.id));
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), triangles: e.mesh.f.length };
  }, true);
  def('terrain', 'create_terrain', 'A flat grid of ground to sculpt (sculpt_terrain), width × depth m with cells of spacing m, at an elevation.', obj({ width: num('m (default 100)'), depth: num('m (default 100)'), spacing: num('m (default 2)'), elevation: num('project elevation (default 0)'), name: common.name, color: common.color }), (a) => {
    const doc = ctx.doc;
    const m = SF.gridMesh(a.width || 100, a.depth || 100, a.spacing || 2, modelY(a.elevation ?? (S.geo(doc).base?.[2] ?? 0)));
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Terrain'), mesh: m, material: { color: a.color || '#8fae7a', roughness: 0.95 }, meta: { surface: true } });
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), points: m.v.length };
  }, true);
  const BRUSH = { at: v3('world point on the surface (centre of the brush)'), radius: num('outer radius, m (default 5)'), inner: num('full-strength radius, m (default 0)'), shape: str('circle | ellipse | square', ['circle', 'ellipse', 'square']), ratio: num('ellipse: short / long (default 0.5)'), angle: num('ellipse / square: turn, degrees'), falloff: str('linear | smooth | sharp | plateau', ['linear', 'smooth', 'sharp', 'plateau']), strength: num('m per stroke (default 0.5)') };
  def('terrain', 'sculpt_terrain', 'Brush a surface: raise, lower, flatten (to a height), smooth, noise or terrace, with a shape, radius, falloff and strength. On a survey surface the stroke is a design adjustment on top: the surveyed points do not move.', obj({ id, operation: str('raise | lower | flatten | smooth | noise | terrace', ['raise', 'lower', 'flatten', 'smooth', 'noise', 'terrace']), ...BRUSH, height: num('flatten: project elevation (default: the average under the brush)'), step: num('terrace: step height, m (default 1)') }, ['id', 'at']), (a) => {
    const doc = ctx.doc;
    const e = surfaceOf(a.id);
    const op = { at: [a.at[0], a.at[2]], operation: a.operation || 'raise', radius: a.radius ?? 5, inner: a.inner ?? 0, shape: a.shape || 'circle', ratio: a.ratio ?? 0.5, angle: a.angle ?? 0, falloff: a.falloff || 'smooth', strength: a.strength ?? 0.5, ...(a.height !== undefined ? { height: modelY(a.height) } : {}), step: a.step ?? 1 };
    if (e.derived) {
      if (e.derived.generator !== 'surface') throw new Error(`${e.name} is made from other things: sculpt its source, or bake it first.`);
      (e.derived.params.adjustments ||= []).push(op);
      R.regenerate(doc, e);
      return { id: e.id, adjustments: e.derived.params.adjustments.length };
    }
    // a plain mesh: work in its world frame, then back into its local frame
    const w = D.worldMesh(doc, e);
    const out = SF.sculpt(w, op);
    const inv = D.worldMatrix(doc, e).clone().invert().elements;
    e.mesh = { v: out.v.map((p) => [0, 1, 2].map((k) => inv[k] * p[0] + inv[4 + k] * p[1] + inv[8 + k] * p[2] + inv[12 + k])), f: out.f };
    return { id: e.id, touched: out.touched };
  }, true);
  def('terrain', 'stamp', 'Press a flat platform into a surface: inside a closed curve at an elevation, blending to the ground over a width.', obj({ id, outline: str('closed curve'), elevation: num('project elevation'), width: num('blend width outside, m (default 3)') }, ['id', 'outline', 'elevation']), (a) => {
    const doc = ctx.doc;
    const e = surfaceOf(a.id);
    const outline = pathOf(a.outline);
    const op = { outline, y: modelY(a.elevation), width: a.width ?? 3 };
    if (e.derived?.generator === 'surface') {
      (e.derived.params.adjustments ||= []).push(op);
      R.regenerate(doc, e);
      return { id: e.id, adjustments: e.derived.params.adjustments.length };
    }
    if (e.derived) throw new Error(`${e.name} is made from other things: bake it first.`);
    const out = SF.stampMesh(D.worldMesh(doc, e), outline, op);
    const inv = D.worldMatrix(doc, e).clone().invert().elements;
    e.mesh = { v: out.v.map((p) => [0, 1, 2].map((k) => inv[k] * p[0] + inv[4 + k] * p[1] + inv[8 + k] * p[2] + inv[12 + k])), f: out.f };
    return { id: e.id, touched: out.touched };
  }, true);
  def('terrain', 'drape', 'Set things onto a surface: curves take its heights point by point; shapes and groups sit on it (their base at the height under their middle).', obj({ ids, surface: str('the surface'), offset: num('m above it (default 0)') }, ['surface']), (a) => {
    const doc = ctx.doc;
    const z = SW.surfaceSampler(doc, surfaceOf(a.surface)).z;
    const off = a.offset || 0;
    let n = 0;
    for (const e of targets(ctx, a)) {
      if (e.curve) {
        setPts(e, curve2d(e).pts3.map((p) => [p[0], (z(p[0], p[2]) ?? p[1]) + off, p[2]]));
        n++;
      } else {
        const b = D.worldBox(doc, e);
        const h = z((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2);
        if (h === null) continue;
        e.position = D.round3([e.position[0], e.position[1] + h + off - b.min[1], e.position[2]]);
        n++;
      }
    }
    return { draped: n };
  }, true);
  def('terrain', 'water_level', 'A water plane over a surface, rising (or falling) between two project elevations over time: floods, ponds, tides on the timeline.', obj({ surface: str('the surface it covers'), from: num('project elevation at the start'), to: num('at the end'), start: T('default 0'), end: T('default start + 4 s'), name: common.name, color: common.color }, ['surface', 'from', 'to']), (a) => {
    const doc = ctx.doc;
    const b = D.worldBox(doc, surfaceOf(a.surface));
    const [w, d] = [b.max[0] - b.min[0], b.max[2] - b.min[2]];
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, 'Water'), mesh: G.box(w, 0.02, d), position: D.round3([(b.min[0] + b.max[0]) / 2, modelY(a.from), (b.min[2] + b.max[2]) / 2]), material: { color: a.color || '#3a86c8', opacity: 0.55, roughness: 0.1, metalness: 0.1 } });
    const start = at(a.start, 0);
    const end = a.end !== undefined ? at(a.end, start + 4) : start + 4;
    A.setKey(doc, e.id, 'position', start, [...e.position]);
    A.setKey(doc, e.id, 'position', end, [e.position[0], modelY(a.to), e.position[2]]);
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), start, end };
  }, true);
  def('terrain', 'import_terrain', 'Real terrain from an elevation grid: GeoTIFF DEM (.tif) or ESRI ASCII grid (.asc), in project coordinates (no reprojection). Big grids are thinned to max_points.', obj({ path: str('absolute path of a .tif / .tiff / .asc'), step: num('use every n-th sample (default: automatic)'), max_points: num('default 250000'), name: common.name }, ['path']), async (a) => {
    const doc = ctx.doc;
    let grid;
    if (/\.asc$/i.test(a.path)) grid = SF.parseAsciiGrid(await needIO().readText(a.path));
    else {
      if (!ctx.io?.demRead) throw new Error('Reading GeoTIFF needs the desktop app.');
      grid = await ctx.io.demRead(new Uint8Array(await ctx.io.readBinary(a.path)));
      if (!grid.affine) throw new Error('That TIFF has no georeferencing (no GeoTIFF tags).');
    }
    const g = S.geo(doc);
    if (!g.base) {
      const [cx, cy] = [grid.affine[0] * grid.width / 2 + grid.affine[2], grid.affine[4] * grid.height / 2 + grid.affine[5]];
      const vals = [...grid.values].filter((x) => x !== grid.nodata && Number.isFinite(x) && x > -1e30);
      g.base = [Math.round(cx / 100) * 100, Math.round(cy / 100) * 100, Math.round(vals.reduce((s, x) => s + x, 0) / (vals.length || 1))];
    }
    const { mesh, step } = SF.demMesh(grid, (E, N, Z) => S.toLocal(doc, { e: E, n: N, z: Z }), { step: a.step || 1, max_points: a.max_points || 250000 });
    const { mesh: m, origin } = G.recenter(mesh);
    const e = D.addEntity(doc, { name: a.name || D.uniqueName(doc, String(a.path).split(/[\\/]/).pop().replace(/\.\w+$/, '')), mesh: m, position: D.round3(origin), material: { color: '#8fae7a', roughness: 0.95 }, meta: { surface: true, source: 'DEM' } });
    ctx.selection.set([e.id]);
    return { ...summary(doc, e), samples: `${grid.width} × ${grid.height}`, step, triangles: m.f.length };
  }, true);
  def('terrain', 'drape_image', 'Lay a placed image or PDF page (an underlay) onto a surface, like an aerial photo on the ground. "none" takes it off.', obj({ surface: str('the surface'), underlay: str('underlay id / name, or "none"') }, ['surface', 'underlay']), (a) => {
    const e = surfaceOf(a.surface);
    if (a.underlay === 'none') {
      delete e.drape;
      return { surface: e.name, drape: 'none' };
    }
    const u = underlayOf(a.underlay);
    e.drape = { underlay: u.id };
    u.visible = false;
    return { surface: e.name, drape: u.name };
  }, true);
  def('drawings', 'text_to_points', 'Survey points from spot heights printed on a PDF: each label matching the pattern becomes a point at its spot, with its number as the elevation.', obj({ id: str('the PDF underlay'), contains: str('regex the labels match (default: numbers like 101.25)'), code: str('code of the new points (default SPOT)'), window: WINDOW }, ['id']), async (a) => {
    const doc = ctx.doc;
    const e = underlayOf(a.id);
    const c = await pdfContent(e);
    const re = new RegExp(a.contains || '^[+-]?\\d+(?:[.,]\\d+)?$');
    const w = winOf(e, a.window);
    const texts = c.texts.filter((t) => re.test(t.str) && (!w || DW.filterPaths([{ pts: [t.at], color: '', width: 0 }], { window: w }).kept.length));
    const made = [];
    for (const t of DW.textsInWorld(doc, e, texts)) {
      const z = DW.numberIn(t.str);
      if (z === null) continue;
      const p = S.toProject(doc, t.at);
      made.push(S.addPoint(doc, { n: p.n, e: p.e, z, code: a.code || 'SPOT', desc: t.str }));
    }
    if (!made.length) throw new Error('No spot heights found (check contains, or the window).');
    ctx.selection.set(made.map((p) => p.id));
    return { points: made.length };
  }, true);
  def('drawings', 'label_contours', 'Give contour lines their heights from the labels on a PDF: each line takes the number of the nearest label (within max_distance).', obj({ ...LW, underlay: str('the PDF underlay'), contains: str('regex (default numbers)'), max_distance: num('m (default 5)') }, ['underlay']), async (a) => {
    const doc = ctx.doc;
    const ents = DW.curvesOf(doc, a.layer ? [] : targets(ctx, a), a.layer);
    const e = underlayOf(a.underlay);
    const re = new RegExp(a.contains || '^[+-]?\\d+(?:[.,]\\d+)?$');
    const labels = DW.textsInWorld(doc, e, (await pdfContent(e)).texts.filter((t) => re.test(t.str))).map((t) => ({ at: t.at, z: DW.numberIn(t.str) }));
    let done = 0;
    for (const c of ents) {
      const P = DR.flat(curve2d(c).pts3);
      let best = null;
      for (const l of labels) {
        const d = DR.nearest(P, [l.at[0], -l.at[2]], !!c.curve.closed).d;
        if (d <= (a.max_distance ?? 5) && (!best || d < best.d)) best = { d, z: l.z };
      }
      if (!best) continue;
      setPts(c, curve2d(c).pts3.map((p) => [p[0], modelY(best.z), p[2]]));
      done++;
    }
    return { labelled: done, of: ents.length };
  }, true);

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
