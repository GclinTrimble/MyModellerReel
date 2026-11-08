// Tool routing: pick the few commands that matter for a request, so small local models are not handed 100 tools.
// Keyword scoring over names, descriptions and categories, plus named toolsets and one-line examples per command.

/** Named toolsets: categories and/or command names. A command can be in several. */
export const TOOLSETS = {
  modelling: { categories: ['create', 'edit', 'arrange', 'parametric'], names: ['get_scene', 'get_entity', 'select', 'select_where', 'measure'] },
  recipes: { categories: ['recipe'], names: ['get_scene'] },
  terrain: { categories: ['terrain'], names: ['get_scene', 'get_entity', 'select_where', 'measure'] },
  animation: { categories: ['animate'], names: ['get_scene', 'select', 'select_where', 'add_scene', 'go_to_scene'] },
  query: { categories: ['scene'], names: ['set_metadata'] },
  view: { categories: ['view'], names: ['screenshot'] },
  files: { categories: ['file'], names: ['report_quantities'] },
  insight: { categories: [], names: ['report_quantities', 'review_model', 'check_clashes', 'section_cut', 'bounds_of', 'measure', 'select_where', 'list_skills'] },
  look: { categories: [], names: ['set_style', 'set_camera', 'set_effects', 'set_environment', 'create_light', 'set_light', 'set_texture', 'set_material', 'set_material_maps', 'set_geolocation', 'set_sun_time', 'animate_sun', 'render_image', 'ai_render', 'generate_texture', 'get_scene', 'select_where'] },
  annotate: { categories: ['annotate'], names: ['get_scene', 'get_entity', 'select_where', 'measure', 'create_text', 'section', 'export_section', 'export_drawing'] },
  ai: { categories: ['extend', 'ai', 'recipe'], names: [] },
  drawings: { categories: ['drawings', 'drafting', 'layers'], names: ['get_scene', 'get_entity', 'select_where', 'create_curve', 'set_curve', 'sweep', 'create_surface'] },
};

/** Always offered: enough to look, undo and reach every other command. */
export const ALWAYS = ['get_scene', 'get_entity', 'list_commands', 'run_script', 'select', 'undo'];

/** One example call per command: small models copy the shape of an example far better than they read a schema. */
export const EXAMPLES = {
  create_box: { width: 2, height: 1, depth: 1, position: [0, 0, 0], name: 'Crate', color: '#b58a57' },
  create_cylinder: { radius: 0.3, height: 3, position: [2, 0, 0], name: 'Column' },
  create_sphere: { radius: 0.5, position: [0, 1, 0] },
  create_prism: { points: [[0, 0], [4, 0], [4, 3], [0, 3]], height: 2.7, name: 'Room' },
  push_pull: { id: 'Room', face: 'top', distance: 0.5 },
  move: { ids: ['Crate'], by: [1, 0, 0] },
  rotate: { ids: ['Door'], angle: 90, axis: 'y' },
  scale: { ids: ['Crate'], factor: 2 },
  duplicate: { ids: ['Column'], offset: [2, 0, 0], count: 4 },
  set_material: { ids: ['Crate'], color: '#c8553d' },
  set_pivot: { id: 'Door', pivot: 'left' },
  group: { ids: ['e1', 'e2'], name: 'Table' },
  boolean: { op: 'subtract', target: 'Wall', tools: ['Hole'] },
  align: { ids: ['e1', 'e2', 'e3'], axis: 'x', to: 'center' },
  distribute: { ids: ['e1', 'e2', 'e3'], axis: 'x' },
  place_on: { id: 'Lamp', target: 'Table' },
  against: { id: 'Sofa', target: 'Wall', side: 'front' },
  stack: { ids: ['Box 1', 'Box 2', 'Box 3'] },
  select_where: { color: '#c8553d' },
  set_metadata: { ids: ['Window 1'], values: { role: 'window', cost: 420 } },
  raycast: { origin: [0, 10, 0], direction: [0, -1, 0] },
  find_free_space: { size: [2, 1], near: [0, 0] },
  animate: { target: 'Door', property: 'rotation', by: [0, 90, 0], start: 0, end: 2 },
  build_sequence: { ids: ['e1', 'e2', 'e3'], effect: 'rise', order: 'bottom-up' },
  turntable: { duration: 8 },
  import_point_cloud: { path: 'C:/scans/site.las' },
  classify_ground: { id: 'site', cell: 1 },
  read_drawing: { id: 'Site plan', apply: true },
  save_version: { name: 'Scheme A' },
  import_asset: { id: 'wooden_picnic_table', type: 'models' },
  walk_to: { position: [0, 0, 8], look_at: [0, 1.5, 0] },
  set_layout: { count: 4, arrangement: 'grid' },
  set_pane: { pane: 2, view: 'top' },
  detach_pane: { pane: 2 },
  road_views: { corridor: 'Road' },
  set_snaps: { midpoint: false },
  set_section_plane: { name: 'Section', flip: true },
  use_ai_model: { provider: 'ollama', model: 'mistral' },
  corridor_surface: { corridor: 'Road' },
  corridor_volumes: { corridor: 'Road', bulking: 1.25, shrinkage: 0.9 },
  corridor_solids: { corridor: 'Road', topsoil: 0.2 },
  set_corridor: { id: 'Road', template: { ditch: { width: 0.6, depth: 0.6 }, layers: [{ name: 'Asphalt', thickness: 0.1, material: 'Asphalt' }] } },
  run_script: { code: 'for (let i = 0; i < 4; i++) await api.create_box({ width: 1, height: 1, depth: 1, position: [i * 2, 0, 0] });' },
};

const SYNONYMS = {
  door: ['pivot', 'rotate', 'boolean', 'animate'],
  window: ['boolean', 'wall'],
  hinge: ['pivot', 'rotate'],
  open: ['rotate', 'animate', 'pivot'],
  colour: ['color', 'material'],
  color: ['material'],
  paint: ['material'],
  put: ['place', 'move'],
  on: ['place'],
  top: ['place', 'stack'],
  next: ['against', 'place'],
  line: ['align', 'distribute'],
  row: ['duplicate', 'distribute'],
  array: ['duplicate'],
  copy: ['duplicate'],
  copies: ['duplicate'],
  spin: ['animate', 'rotate', 'motion'],
  sequence: ['build', 'stagger'],
  build: ['sequence', 'create'],
  hole: ['boolean', 'subtract'],
  cut: ['boolean', 'subtract', 'section', 'corridor_surface', 'corridor_volumes'],
  road: ['create_alignment', 'create_corridor', 'road_views', 'corridor_surface', 'corridor_volumes', 'corridor_solids'],
  corridor: ['create_corridor', 'set_corridor', 'corridor_surface', 'corridor_volumes', 'corridor_solids', 'apply_corridor'],
  fill: ['corridor_volumes', 'cut_fill', 'corridor_solids'],
  earthwork: ['corridor_volumes', 'corridor_solids', 'cut_fill'],
  earthworks: ['corridor_volumes', 'corridor_solids', 'cut_fill'],
  embankment: ['create_corridor', 'set_corridor'],
  ditch: ['set_corridor', 'create_corridor'],
  pavement: ['corridor_solids', 'set_corridor'],
  asphalt: ['corridor_solids', 'set_corridor'],
  superelevation: ['set_corridor'],
  haul: ['corridor_volumes'],
  profile: ['road_profile', 'road_views', 'surface_profile'],
  find: ['select', 'query', 'raycast'],
  where: ['raycast', 'bounds', 'select'],
  space: ['free', 'find'],
  height: ['measure', 'bounds'],
  far: ['measure'],
  distance: ['measure'],
  camera: ['view', 'turntable', 'scene'],
  video: ['export', 'render'],
  save: ['file'],
  load: ['open', 'import'],
  dimension: ['add_dimension', 'annotate'],
  dimensions: ['add_dimension', 'annotate'],
  label: ['add_label', 'annotate'],
  text: ['create_text', 'label'],
  sign: ['create_text'],
  guide: ['add_guide'],
  clash: ['check_clashes'],
  clashes: ['check_clashes'],
  overlap: ['check_clashes'],
  drawing: ['export_drawing', 'section'],
  sheet: ['export_drawing'],
  plan: ['export_drawing', 'section'],
  dashed: ['line_type', 'properties'],
  render: ['render_image', 'ai_render', 'effects', 'environment'],
  clip: ['save_clip', 'apply_clip'],
  fillet: ['fillet_edges'],
  round: ['fillet_edges'],
  chamfer: ['chamfer_edges'],
  bevel: ['chamfer_edges', 'fillet_edges'],
  hollow: ['shell'],
  loft: ['loft'],
  vase: ['loft'],
  smooth: ['subdivide'],
  twist: ['deform'],
  taper: ['deform'],
  bend: ['deform'],
  plan: ['import_2d', 'export_drawing'],
  library: ['insert_asset', 'list_assets'],
  tree: ['insert_asset'],
  columns: ['array_grid'],
  physics: ['simulate_physics'],
  fall: ['simulate_physics'],
  drop: ['simulate_physics'],
  shot: ['add_shot'],
  shots: ['add_shot'],
  music: ['add_audio'],
  audio: ['add_audio'],
  voiceover: ['add_audio'],
  crane: ['attach'],
  carry: ['attach'],
  schedule: ['import_schedule'],
  slower: ['retime'],
  faster: ['retime'],
  photoreal: ['render_image', 'environment'],
  texture: ['set_texture', 'generate_texture'],
  brick: ['set_texture', 'generate_texture'],
  glass: ['set_material_maps'],
  light: ['create_light', 'set_light'],
  lights: ['create_light'],
  lamp: ['create_light'],
  night: ['create_light', 'set_sun_time'],
  sun: ['set_sun_time', 'animate_sun', 'set_geolocation'],
  shadow: ['set_sun_time', 'animate_sun'],
  shadows: ['set_sun_time', 'animate_sun'],
  sketch: ['set_style'],
  lens: ['set_camera'],
  scan: ['import_point_cloud', 'classify_ground', 'vectorise_underlay'],
  lidar: ['import_point_cloud', 'classify_ground'],
  cloud: ['import_point_cloud', 'classify_ground'],
  scanned: ['vectorise_underlay', 'import_image'],
  share: ['export_web_viewer', 'export'],
  print: ['export', 'compress_glb'],
  version: ['save_version', 'restore_version', 'compare_versions'],
  versions: ['save_version', 'list_versions', 'compare_versions'],
  tab: ['new_document', 'switch_document'],
  free: ['search_assets', 'import_asset'],
  walk: ['walk_to'],
  french: ['set_language'],
  snap: ['set_snaps'],
  snaps: ['set_snaps'],
  snapping: ['set_snaps'],
  plane: ['section', 'set_section_plane', 'list_section_planes'],
  planes: ['list_section_planes', 'set_section_plane', 'delete_section_plane'],
  ollama: ['detect_local_models', 'use_ai_model'],
  model: ['detect_local_models', 'use_ai_model'],
  local: ['detect_local_models', 'use_ai_model'],
  split: ['set_layout', 'set_pane'],
  pane: ['set_layout', 'set_pane', 'detach_pane'],
  panes: ['set_layout', 'set_pane', 'get_layout'],
  quad: ['set_layout'],
  views: ['set_layout', 'set_pane'],
  detach: ['detach_pane'],
  screen: ['detach_pane'],
  monitor: ['detach_pane'],
};

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'it', 'is', 'with', 'for', 'by', 'me', 'my', 'please', 'make', 'this', 'that', 'them']);
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;
export const tokens = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);

function inToolset(c, name) {
  const t = TOOLSETS[name];
  if (!t) throw new Error(`Unknown toolset "${name}". Toolsets: ${Object.keys(TOOLSETS).join(', ')}.`);
  return t.categories.includes(c.category) || t.names.includes(c.name);
}

/** Commands in a toolset (or every command), ranked against a free-text query when one is given. */
export function rankCommands(list, { query = '', toolset = null, limit = 0 } = {}) {
  let cmds = toolset ? list.filter((c) => inToolset(c, toolset)) : list;
  const q = tokens(query);
  if (q.length) {
    const want = new Set(q.flatMap((w) => [w, ...(SYNONYMS[w] || []).map(stem)]));
    const score = (c) => {
      const name = tokens(c.name.replace(/_/g, ' '));
      const desc = tokens(c.description);
      let s = 0;
      for (const w of want) {
        if (name[0] === w) s += 4; // the verb: "stack boxes" wants stack before create_box
        else if (name.includes(w)) s += 2;
        if (c.category === w) s += 1;
        s += Math.min(2, desc.filter((d) => d === w).length);
      }
      return s;
    };
    cmds = cmds
      .map((c) => [c, score(c)])
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }
  return limit > 0 ? cmds.slice(0, limit) : cmds;
}

/**
 * The tools a small model gets for one request: the always-on core, the commands it already used in this chat,
 * and the best matches for what the user asked. Plugins come along when they match too.
 */
export function routeTools(list, { query = '', used = [], toolset = null, limit = 18 } = {}) {
  const byName = new Map(list.map((c) => [c.name, c]));
  const pick = new Set([...ALWAYS, ...used].filter((n) => byName.has(n)));
  for (const c of rankCommands(list, { query, toolset })) {
    if (pick.size >= limit) break;
    pick.add(c.name);
  }
  if (toolset) for (const c of rankCommands(list, { toolset })) if (pick.size < limit) pick.add(c.name);
  return [...pick].map((n) => byName.get(n));
}

/** Description with its example appended, the form small models get. */
export const describe = (c) => (EXAMPLES[c.name] ? `${c.description} Example: ${JSON.stringify(EXAMPLES[c.name])}` : c.description);
