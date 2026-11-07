// Help by intent (#158): one page per goal, written as what the person wants to do. The pages are Markdown in
// docs/how-to/<id>.md with their media in docs/how-to/media/<id>/ (made by scripts/docs-media.mjs from the app).
export const AREAS = ['Modelling', 'Animation', 'Terrain and survey', 'Drawings', 'Files', 'AI and insight'];

export const HOWTOS = [
  { id: 'push-pull-and-components', area: 'Modelling', title: 'Model a shape with push / pull, then copy it as a component', intent: 'draw rectangle extrude push pull window recess component copies instances edit once', commands: ['create_box', 'imprint', 'push_pull', 'make_component', 'duplicate', 'set_material'], tools: ['rectangle', 'pushpull'] },
  { id: 'live-sweep-along-a-curve', area: 'Modelling', title: 'Run a kerb along a curve that stays live', intent: 'sweep profile kerb pipe along path curve follow me edit curve updates', commands: ['create_curve', 'sweep', 'list_profiles', 'set_curve'], tools: ['curve'] },
  { id: 'hinge-a-door', area: 'Animation', title: 'Hinge a door and animate it opening', intent: 'door hinge pivot rotate animate open keyframe video', commands: ['create_box', 'set_pivot', 'animate', 'render_video'], tools: [], video: true },
  { id: 'construction-sequence-video', area: 'Animation', title: 'Make a construction sequence video', intent: '4d build sequence phases captions video mp4 reel construction', commands: ['build_sequence', 'add_caption', 'add_marker', 'render_video'], tools: [], video: true },
  { id: 'survey-points-to-surface', area: 'Terrain and survey', title: 'Turn survey points into a surface', intent: 'import csv points pnezd codes tin surface ground breaklines check', commands: ['import_points', 'define_feature_code', 'process_codes', 'create_surface', 'check_surface'], tools: ['point'] },
  { id: 'cut-and-fill-for-a-pad', area: 'Terrain and survey', title: 'Work out cut and fill for a building pad', intent: 'earthworks volume cut fill pad level map report', commands: ['cut_fill', 'volume_report'], tools: [] },
  { id: 'design-an-access-road', area: 'Terrain and survey', title: 'Design an access road on the ground', intent: 'alignment road corridor profile stations batters daylight', commands: ['create_alignment', 'set_alignment', 'create_corridor'], tools: [] },
  { id: 'put-a-pdf-in-place', area: 'Drawings', title: 'Put a PDF site plan in place', intent: 'pdf drawing underlay scale georeference control points world file local coordinates', commands: ['import_pdf', 'add_control_pair', 'georeference_underlay', 'georef_report', 'calibrate_underlay'], tools: ['control', 'calibrate'] },
  { id: 'pdf-linework-to-3d', area: 'Drawings', title: 'Turn a PDF plan into a 3D model', intent: 'extract linework pdf layers buildings footprint extrude kerbs spot heights elevate', commands: ['pdf_linework_stats', 'extract_linework', 'elevate_linework', 'extrude_linework', 'sweep_linework', 'offset_curve', 'fillet', 'trim'], tools: ['trim'] },
  { id: 'bring-in-landxml-ifc-dxf', area: 'Files', title: 'Bring in a LandXML, IFC or DXF file', intent: 'import landxml ifc dxf cad bim survey file open exchange layers report', commands: ['import', 'list_formats', 'query_features'], tools: [] },
  { id: 'share-with-bim-tools', area: 'Files', title: 'Export to IFC, DXF or LandXML for BIM and CAD tools', intent: 'export ifc dxf landxml bim cad roles property sets georeference', commands: ['set_metadata', 'export', 'list_layers'], tools: [] },
  { id: 'organise-with-layers', area: 'Modelling', title: 'Organise a model with layers and attributes', intent: 'layers tags colour lock current layer hide attribute table feature layer schema', commands: ['create_layer', 'set_layer', 'move_to_layer', 'save_layer_state', 'query_features', 'edit_attributes'], tools: [] },
  { id: 'ask-the-copilot', area: 'AI and insight', title: 'Ask the copilot to build or change something', intent: 'ai copilot chat prompt claude ollama propose review undo stop', commands: ['propose', 'list_commands', 'screenshot'], tools: [] },
  { id: 'review-and-quantities', area: 'AI and insight', title: 'Check a model and count what is in it', intent: 'review checks floating collisions quantities cost area volume report csv', commands: ['review_model', 'report_quantities', 'model_info', 'purge'], tools: [] },
  { id: 'read-the-terrain', area: 'Terrain and survey', title: 'Read the terrain: contours, slopes, profiles and sections', intent: 'contours labels slope analysis aspect elevation colours legend profile long section cross sections chart', commands: ['surface_contours','analyze_surface','surface_profile','cross_sections','export_contours'], tools: [] },
  { id: 'design-a-pad', area: 'Terrain and survey', title: 'Design a building pad with batter slopes', intent: 'pad platform level batter slope daylight cut fill design surface earthworks volume', commands: ['create_pad','set_batter','cut_fill'], tools: [] },
  { id: 'sculpt-a-terrain', area: 'Terrain and survey', title: 'Sculpt a terrain for a concept', intent: 'sculpt brush raise lower flatten smooth terrace landscape mound terrain grid stamp drape', commands: ['create_terrain','sculpt_terrain','stamp','drape'], tools: ['sculpt'] },
  { id: 'bring-in-field-and-gis-data', area: 'Files', title: 'Bring in field and GIS data: JobXML, FXL, GeoJSON, Shapefile, DEM', intent: 'jobxml jxl controller field fxl feature library geojson shapefile shp gis parcels dem geotiff ascii grid elevation import', commands: ['import','import_terrain','drape_image','query_features'], tools: [] },
];

/** Pages ranked by how well their words match a question ("how do I georeference a pdf"). */
export function findHowtos(query = '', limit = 20) {
  const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['how', 'the', 'and', 'can', 'want', 'with'].includes(w));
  if (!words.length) return HOWTOS.slice(0, limit);
  return HOWTOS.map((h) => {
    const text = `${h.title} ${h.intent} ${h.commands.join(' ')}`.toLowerCase();
    return { h, score: words.reduce((s, w) => s + (text.includes(w) ? (h.title.toLowerCase().includes(w) ? 3 : 1) : 0), 0) };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.h);
}
