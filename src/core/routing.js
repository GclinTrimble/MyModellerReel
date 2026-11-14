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
  ai: { categories: ['extend', 'ai', 'recipe', 'mytools', 'help'], names: [] },
  maps: { categories: ['maps'], names: ['get_scene', 'set_coordinate_system', 'set_geolocation'] },
  materials: { categories: ['materials'], names: ['get_scene', 'get_entity', 'select_where', 'report_quantities'] },
  drawings: { categories: ['drawings', 'drafting', 'layers'], names: ['get_scene', 'get_entity', 'select_where', 'create_curve', 'set_curve', 'sweep', 'create_surface'] },
  // working in a scan (#302); the commands of #298–#301 join as they land (a name not registered is skipped)
  pointcloud: {
    categories: [],
    names: ['describe_cloud', 'list_cloud_classes', 'set_cloud_filter', 'set_cloud_style', 'classify_cloud', 'select_points', 'set_point_class', 'clear_point_selection', 'point_selection', 'define_point_class', 'detect_planes', 'detect_corners', 'detect_edges', 'add_clip', 'fit_clip', 'align_clip', 'set_clip', 'add_slice', 'slice_series', 'view_clip', 'slice_points', 'screenshot', 'propose', 'classify_ground', 'pick_cloud_point', 'import_point_cloud', 'point_cloud_job', 'export_point_cloud', 'step_slice', 'list_clips'],
    // to add as they land: extract_footprint, trace_slice, extract_edges (#301)
    words: ['scan', 'point cloud', 'las', 'laz', 'copc', 'potree', 'lidar', 'intensity', 'x-ray', 'xray', 'classify'],
    hints: ['slice', 'limit box', 'clip', 'façade', 'facade', 'corner', 'footprint', 'kerb', 'curb', 'edge of pavement', 'wall line'], // also mean other work: a smaller nudge
  },
};

const has = (q, list) => list?.some((w) => new RegExp(`(^|[^a-zç])${w}s?($|[^a-zç])`).test(q));
/** The toolset a request is about (its words: "scan", "point cloud"; or hints: "kerb lines", "slice"), or null; strong: by its words. */
export function toolsetMatch(query) {
  const q = String(query || '').toLowerCase();
  for (const [name, t] of Object.entries(TOOLSETS)) if (has(q, t.words)) return { name, strong: true };
  for (const [name, t] of Object.entries(TOOLSETS)) if (has(q, t.hints)) return { name, strong: false };
  return null;
}
export const toolsetFor = (query) => toolsetMatch(query)?.name || null;

/** Always offered: enough to look, undo and reach every other command. */
export const ALWAYS = ['get_scene', 'get_entity', 'list_commands', 'run_script', 'select', 'undo', 'ask_user'];

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
  set_cloud_style: { id: 'site', color_by: 'intensity', edl: true },
  set_cloud_filter: { id: 'site', classes: { hide: [3, 4, 5] } },
  list_cloud_classes: { id: 'site' },
  point_cloud_job: { id: 'Corridor scan' },
  set_cloud_budget: { points: 5000000 },
  pick_cloud_point: { x: 0.5, y: 0.5 },
  rebuild_point_cloud_octree: { id: 'Corridor scan' },
  classify_cloud: { id: 'Corridor scan', steps: ['noise', 'ground', 'vegetation', 'buildings', 'road'] },
  attach_point_cloud_classes: { id: 'Corridor scan' },
  select_points: { id: 'Corridor scan', polygon: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]], front_only: true },
  set_point_class: { class: 65, lock: true },
  clear_point_selection: {},
  point_selection: {},
  define_point_class: { code: 66, name: 'Manhole', color: '#aa5500' },
  export_point_cloud: { id: 'Corridor scan', path: 'C:/out/corridor.las', what: 'all', coordinates: 'world' },
  read_drawing: { id: 'Site plan', apply: true },
  save_version: { name: 'Scheme A' },
  import_asset: { id: 'wooden_picnic_table', type: 'models' },
  walk_to: { position: [0, 0, 8], look_at: [0, 1.5, 0] },
  set_layout: { count: 4, arrangement: 'grid' },
  set_pane: { pane: 2, view: 'top' },
  detach_pane: { pane: 2 },
  road_views: { corridor: 'Road' },
  set_snaps: { midpoint: false },
  paint_surface: { id: 'Site', material: 'Asphalt', inside: 'Car park boundary' },
  define_surface_material: { name: 'Road base', code: '32 11 23', color: '#9b8f7e', density: 2100, thickness: 0.2, cost: 18 },
  material_takeoff: { path: 'C:/jobs/site/takeoff.csv' },
  show_surface_materials: { names: ['Asphalt'], only: true },
  apply_material: { ids: ['House'], material: 'Red brick' },
  suggest_coordinate_systems: { latitude: 48.85, longitude: 2.35 },
  set_section_plane: { name: 'Section', flip: true },
  add_clip: { kind: 'box', from: 'selection', margin: 1 },
  set_clip: { name: 'Box 1', face: '+y', push: -2.5 },
  align_clip: { name: 'Box 1', to: 'points', points: ['W1', 'W2'] },
  fit_clip: { name: 'Box 1', ids: ['Culvert'] },
  add_slice: { at: 'station', alignment: 'Main road', station: 120, thickness: 0.5 },
  slice_series: { at: 'station', alignment: 'Main road', from: 0, to: 200, step: 20 },
  view_clip: { name: 'Slice 1', pane: 2 },
  slice_points: { name: 'Slice 1', max: 150 },
  detect_planes: { within: 'Box 1', min_area: 2, regularise: true },
  detect_corners: { within: 'Box 1', min_angle: 30 },
  detect_edges: { kind: 'kerb', alignment: 'Main road', spacing: 1 },
  describe_cloud: { id: 'Site scan', within: 'Culvert box' },
  extract_footprint: { id: 'Site scan', classes: [6], layer: 'Footprints', propose: true },
  trace_slice: { name: 'Level 1', layer: 'Walls', propose: true },
  extract_edges: { id: 'Site scan', kind: 'kerb', alignment: 'Main road', layer: 'Kerbs', propose: true },
  use_ai_model: { provider: 'ollama', model: 'mistral' },
  corridor_surface: { corridor: 'Road' },
  corridor_volumes: { corridor: 'Road', bulking: 1.25, shrinkage: 0.9 },
  corridor_solids: { corridor: 'Road', topsoil: 0.2 },
  set_corridor: { id: 'Road', template: { ditch: { width: 0.6, depth: 0.6 }, layers: [{ name: 'Asphalt', thickness: 0.1, material: 'Asphalt' }] } },
  edit_survey_observations: { from: '10:05', to: '10:40', target_height: 1.8 },
  review_survey: {},
  list_survey: { setup: 'STN1' },
  survey_report: { path: 'C:/jobs/site/survey-report.html' },
  list_service_layers: { url: 'https://example.com/wmts/1.0.0/WMTSCapabilities.xml' },
  add_map_layer: { url: 'https://example.com/wfs?SERVICE=WFS&REQUEST=GetCapabilities', layer: 'parcels', name: 'Parcels' },
  query_service_features: { layer: 'Parcels', touching: 'Road centreline' },
  import_features: { layer: 'Parcels', radius: 300 },
  cache_map_area: { radius: 500, max_zoom: 18 },
  elevation_to_surface: { layer: 'AHN DTM', radius: 200, spacing: 1 },
  export_geopackage: { path: 'C:/jobs/site/site.gpkg', layer: 'C-*' },
  run_script: { code: 'for (let i = 0; i < 4; i++) await api.create_box({ width: 1, height: 1, depth: 1, position: [i * 2, 0, 0] });' },
};

const SYNONYMS = {
  rod: ['survey', 'target_height', 'edit_survey_observations', 'review_survey'],
  bust: ['review_survey', 'edit_survey_observations'],
  antenna: ['edit_survey_observations', 'survey'],
  backsight: ['edit_survey_observations', 'list_survey'],
  instrument: ['edit_survey_observations', 'list_survey'],
  jxl: ['import', 'survey'],
  jobxml: ['import', 'survey'],
  fieldbook: ['list_survey', 'edit_survey_observations', 'review_survey'],
  wmts: ['list_service_layers', 'add_map_layer'],
  wcs: ['list_service_layers', 'add_map_layer', 'elevation_to_surface'],
  dtm: ['add_map_layer', 'elevation_to_surface', 'import_terrain'],
  dsm: ['add_map_layer', 'elevation_to_surface'],
  elevation: ['add_map_layer', 'elevation_to_surface', 'import_terrain'],
  buildings: ['add_map_layer', 'import_features', 'set_map_layer'],
  wms: ['list_service_layers', 'add_map_layer'],
  wfs: ['list_service_layers', 'add_map_layer', 'query_service_features', 'import_features'],
  basemap: ['add_map_layer', 'set_view_overlay'],
  cadastre: ['add_map_layer', 'query_service_features', 'import_features'],
  parcels: ['query_service_features', 'import_features', 'add_map_layer'],
  offline: ['cache_map_area', 'map_cache'],
  geopackage: ['export_geopackage', 'import'],
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
  pavement: ['corridor_solids', 'set_corridor', 'edges', 'slice'], // edge of pavement in a scan
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
  clip: ['add_clip', 'set_clip', 'list_clips', 'save_clip', 'apply_clip'], // clip volumes (#290) and animation clips
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
  scan: ['import_point_cloud', 'classify_ground', 'vectorise_underlay', 'cloud', 'describe'],
  la: ['cloud', 'import'], // las, stemmed
  potree: ['cloud', 'octree', 'import'],
  classify: ['cloud', 'classes', 'filter', 'classify_cloud', 'list_cloud_classes', 'set_point_class', 'select_points', 'point_cloud_job', 'classify_ground'],
  facade: ['detect_planes', 'detect_corners', 'planes', 'detect', 'slice', 'clip', 'wall'],
  corner: ['corners', 'detect', 'cloud'],
  footprint: ['extract', 'describe', 'cloud', 'slice'],
  kerb: ['detect_edges', 'edges', 'extract', 'detect', 'slice', 'cloud', 'classify_cloud', 'select_points', 'define_point_class'],
  curb: ['detect_edges', 'kerb', 'edges', 'extract', 'detect', 'slice', 'cloud'],
  lidar: ['import_point_cloud', 'classify_ground', 'set_cloud_style', 'set_cloud_filter', 'list_cloud_classes', 'pick_cloud_point'],
  cloud: ['import_point_cloud', 'classify_ground', 'set_cloud_style', 'set_cloud_filter', 'list_cloud_classes', 'point_cloud_job', 'pick_cloud_point'],
  intensity: ['set_cloud_style', 'cloud', 'style'],
  classification: ['classify_cloud', 'list_cloud_classes', 'set_cloud_filter', 'set_cloud_style', 'select_points', 'set_point_class'],
  classes: ['list_cloud_classes', 'define_point_class', 'set_point_class', 'classify_cloud'],
  vegetation: ['classify_cloud', 'set_cloud_filter'],
  noise: ['classify_cloud', 'select_points', 'set_point_class'],
  kerbs: ['classify_cloud', 'select_points', 'detect_edges'],
  ground: ['classify_cloud', 'classify_ground'],
  reclassify: ['select_points', 'set_point_class', 'clear_point_selection'],
  lasso: ['select_points', 'set_point_class'],
  points: ['select_points', 'point_selection', 'set_point_class'],
  las: ['import_point_cloud', 'export_point_cloud'],
  xray: ['set_cloud_style', 'set_style', 'cloud', 'style'],
  laz: ['import_point_cloud', 'point_cloud_job', 'export_point_cloud'],
  copc: ['import_point_cloud', 'cloud'],
  octree: ['import_point_cloud', 'point_cloud_job', 'rebuild_point_cloud_octree', 'set_cloud_budget'],
  budget: ['set_cloud_budget'],
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
  texture: ['apply_material', 'list_material_library', 'set_texture'],
  textured: ['apply_material', 'list_material_library'],
  brick: ['apply_material'],
  wood: ['apply_material'],
  epsg: ['suggest_coordinate_systems', 'set_coordinate_system'],
  crs: ['suggest_coordinate_systems', 'set_coordinate_system'],
  georeference: ['set_base_point', 'suggest_coordinate_systems'],
  split: ['create_face', 'set_layout', 'set_pane'],
  arc: ['create_arc'],
  text: ['add_label', 'create_text'],
  snaps: ['set_snaps'],
  snapping: ['set_snaps'],
  plane: ['section', 'set_section_plane', 'list_section_planes'],
  planes: ['list_section_planes', 'set_section_plane', 'delete_section_plane'],
  // clip volumes (#290, #291)
  clips: ['list_clips', 'clear_clips', 'delete_clip'],
  box: ['create_box', 'add_clip', 'fit_clip'], // a box to build stays first
  limit: ['add_clip', 'fit_clip', 'clip'],
  crop: ['add_clip', 'fit_clip', 'set_clip'],
  isolate: ['add_clip', 'fit_clip'],
  slab: ['add_slice', 'add_clip', 'set_clip'],
  // slices (#292)
  slice: ['add_slice', 'slice_series', 'view_clip', 'slice_points'],
  slices: ['slice_series', 'step_slice', 'add_slice'],
  cross: ['road_section', 'add_slice'],
  square: ['view_clip'],
  // features in a scan (#300)
  facades: ['detect_planes', 'detect_corners'],
  corners: ['detect_corners', 'detect_planes'],
  eaves: ['detect_edges'],
  detect: ['detect_planes', 'detect_corners', 'detect_edges'],
  ollama: ['detect_local_models', 'use_ai_model'],
  model: ['download_ai_model', 'list_ai_models', 'detect_local_models', 'use_ai_model'],
  local: ['download_ai_model', 'list_ai_models', 'detect_local_models', 'use_ai_model'],
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
    .replace(/x-ray/g, 'xray')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // façade → facade
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
    const auto = !toolset && toolsetMatch(query); // a scan request: its commands come before generic ones
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
      return s && auto && inToolset(c, auto.name) ? s + (auto.strong ? 8 : 2) : s;
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
  const auto = !toolset && toolsetFor(query);
  // a request plainly about a toolset (a scan): its best matches first, then its core in order, then the rest
  if (auto) for (const c of rankCommands(list, { query, toolset: auto }).slice(0, 6)) pick.add(c.name);
  if (auto) for (const n of TOOLSETS[auto].names.slice(0, 4)) if (byName.has(n)) pick.add(n);
  for (const c of rankCommands(list, { query, toolset })) {
    if (pick.size >= limit) break;
    pick.add(c.name);
  }
  if (toolset) for (const c of rankCommands(list, { toolset })) if (pick.size < limit) pick.add(c.name);
  return [...pick].map((n) => byName.get(n));
}

/** Description with its example appended, the form small models get. */
export const describe = (c) => (EXAMPLES[c.name] ? `${c.description} Example: ${JSON.stringify(EXAMPLES[c.name])}` : c.description);
