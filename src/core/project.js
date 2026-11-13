// Projects (#277): a folder that holds a whole job, laid out for people and for other tools, with one database.
//
//   <Project>/
//     project.gpkg         OGC GeoPackage 1.4: the project database. Settings, coordinate system, feature codes and the
//                          file list as attribute tables (mmr_*); survey points (with source and typed attributes) and
//                          linework as feature tables in project coordinates, so QGIS / ArcGIS open it as is.
//     scene.usda           OpenUSD stage of the 3D scene, for Omniverse, Blender, Houdini (written, not read back)
//     models/<name>.glb    the editable model (geometry, components, animation): what open_project loads
//     survey/              field books and point files as they were imported (JobXML, CSV…), untouched
//     surfaces/<name>.xml  each surface as LandXML 1.2
//     codes/<library>.fxl  the feature library in use (Trimble FXL)
//     drawings/            DXF, IFC, PDF and other source files as imported
//     assets/              the files the model shows (PDF pages, images, textures, photos)
//     README.txt           this layout, in words
//
// The GeoPackage's configuration (coordinate system, feature codes, settings) wins over the model's when a project
// opens, so it is the place to change them from outside. The model file stays the truth for geometry and points.
// Pure module: the commands do the file work through ctx.io.

export const DB = 'project.gpkg';
export const SCENE = 'scene.usda';
export const VERSION = 1;
export const STANDARDS = { database: 'OGC GeoPackage 1.4 (12-128r19)', scene: 'OpenUSD (.usda)', surfaces: 'LandXML 1.2', codes: 'Trimble FXL', model: 'glTF 2.0 binary (.glb)' };

/** A file or folder name from anything: no path characters, no trailing dots. */
export const safeName = (s) => String(s || 'Project').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/[. ]+$/, '').trim() || 'Project';

const ext = (p) => String(p).split('.').pop().toLowerCase();
export const baseName = (p) => String(p).split(/[\\/]/).pop();
export const join = (...parts) => parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');

/** Where an imported source file is kept in the project, by its kind. */
export function folderFor(file) {
  const x = ext(file);
  if (['jxl', 'csv', 'txt', 'xyz', 'pnezd', 'penzd', 'job', 'raw', 'xml', 'landxml'].includes(x)) return 'survey';
  if (x === 'fxl') return 'codes';
  if (['las', 'laz', 'ply', 'e57', 'pts'].includes(x)) return 'survey';
  return 'drawings';
}

/** The project's own record in the document: its name, its folder, the source files it was built from. */
export function projectOf(doc) {
  return (doc.project ||= { name: null, folder: null, files: [] });
}

/** A file brought into the model: kept on the project's list (copied into the folder on the next save). */
export function noteImport(doc, path, { role = null, at = new Date().toISOString() } = {}) {
  if (!path) return null;
  const p = projectOf(doc);
  const abs = String(path).replace(/\\/g, '/');
  let f = p.files.find((x) => x.original === abs || x.path === abs);
  if (!f) p.files.push((f = { path: abs, original: abs, role: role || folderFor(abs), imported: at }));
  return f;
}

/** Is p inside folder (both absolute, any slashes)? */
export const inside = (p, folder) => !!folder && String(p).replace(/\\/g, '/').toLowerCase().startsWith(`${String(folder).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()}/`);

/** Is a surface entity (a live TIN or a finished ground)? */
export const isSurface = (e) => !!e.mesh && (e.meta?.surface || e.derived?.generator === 'surface' || e.derived?.generator === 'finished_ground');

/** The extension an asset is written with, by its type; null keeps it inside the model file (no common file type). */
export function assetExt(mime = '') {
  return { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/tiff': 'tif', 'image/bmp': 'bmp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' }[mime] || null;
}

/** The asset's file name in assets/: its own name when it has one (made unique by its id), else its id. */
export function assetFile(id, a) {
  const x = assetExt(a?.mime);
  if (!x) return null;
  const stem = a?.name ? safeName(String(a.name).replace(/\.[^.]+$/, '')) : '';
  return join('assets', `${stem ? `${stem}-` : ''}${id}.${x}`);
}

/** The key / value rows of mmr_project: everything a project is set up with, values as JSON text. */
export function configRows(doc, { name, version = '' }) {
  const g = doc.geo || {};
  const rows = {
    format: VERSION,
    name,
    app_version: version,
    saved: new Date().toISOString(),
    model: join('models', `${safeName(name)}.glb`),
    scene: SCENE,
    units: g.units || 'm',
    crs: g.crs || null,
    base_point: g.base || null,
    site_grid: g.grid || null,
    feature_library: doc.featureLibrary?.name || null,
    feature_codes: doc.featureCodes || {},
    layers: doc.tags || [],
    components: Object.keys(doc.components || {}),
    settings: doc.settings || {},
    standards: STANDARDS,
  };
  return Object.entries(rows).map(([key, v]) => ({ key, value: JSON.stringify(v ?? null) }));
}

/** Rows of mmr_project back to an object. */
export const readConfig = (rows = []) => Object.fromEntries(rows.map((r) => [r.key, r.value == null ? null : JSON.parse(r.value)]));

/**
 * What a project's database says that the model should follow when it opens: coordinate system, site grid, units,
 * feature codes and library, settings. The base point is not taken (it would move every point); geometry is the model's.
 * Returns the keys taken.
 */
export function applyConfig(doc, cfg) {
  const took = [];
  const none = (v) => (v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) ? null : v);
  const g = (doc.geo ||= {});
  const fields = {
    crs: [() => g.crs, (v) => (g.crs = v)],
    site_grid: [() => g.grid, (v) => (g.grid = v)],
    units: [() => g.units, (v) => (g.units = v)],
    feature_codes: [() => doc.featureCodes, (v) => (doc.featureCodes = v)],
    feature_library: [() => doc.featureLibrary?.name, (v) => (v ? (doc.featureLibrary = { ...(doc.featureLibrary || {}), name: v }) : delete doc.featureLibrary)],
    settings: [() => doc.settings, (v) => (doc.settings = v)],
  };
  for (const [k, [get, set]] of Object.entries(fields)) {
    if (cfg[k] === undefined) continue;
    const want = k === 'settings' ? { ...doc.settings, ...cfg[k] } : cfg[k];
    if (JSON.stringify(none(get())) === JSON.stringify(none(want))) continue; // {} and nothing are the same
    set(want);
    took.push(k);
  }
  return took;
}

/**
 * Survey points as GeoPackage features in project coordinates (E, N, Z): name, code, description, source (the file or
 * field book), every attribute as its own column (prefixed when a name is taken) and all of them as JSON.
 */
export function pointFeatures(doc, sourceOf) {
  const out = [];
  for (const p of doc.entities) {
    if (p.type !== 'point' || p.point?.deleted) continue;
    const q = p.point;
    const props = { name: p.name, code: q.code || null, description: q.desc || null, source: sourceOf(p), layer: p.tag || null };
    for (const [k, v] of Object.entries(q.attrs || {})) props[k in props || /^(fid|geom)$/i.test(k) ? `attr_${k}` : k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    props.attributes = JSON.stringify(q.attrs || {});
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [q.e, q.n, q.z] }, properties: props });
  }
  return out;
}

/** The project's files as rows of mmr_files: path (relative), what it is, where it came from. */
export const fileRows = (files) => files.map((f) => ({ path: f.path, role: f.role, original: f.original || null, imported: f.imported || null, missing: f.missing ? 1 : 0 }));

/** The field books (survey entities) as rows of mmr_field_books. */
export const fieldBookRows = (doc) =>
  doc.entities.filter((e) => e.survey).map((e) => ({ name: e.name, id: e.id, source: e.survey.source || e.survey.file || null, setups: (e.survey.setups || []).length, observations: (e.survey.observations || []).length, points: Object.keys(e.survey.points || {}).length, edits: (e.survey.edits || []).length }));

/** README.txt: the layout of this project, in words, with what is in it. */
export function readme(name, { files = [], surfaces = [], codes = null, assets = 0 }) {
  return [
    `${name}: a MyModellerReel project`,
    '',
    `${DB}  the project database (${STANDARDS.database}). Open it in QGIS or ArcGIS:`,
    '    survey_points, linework   features in the project coordinate system, with their attributes',
    '    mmr_project               settings, coordinate system, feature codes (edit here: the project follows on open)',
    '    mmr_files, mmr_field_books, mmr_assets   what the folders hold',
    `${SCENE}  the 3D scene as OpenUSD, for Omniverse, Blender or Houdini (rewritten on every save)`,
    `models/   the editable model (${STANDARDS.model}); MyModellerReel opens the project from it`,
    `survey/   field books and point files as imported (${files.filter((f) => f.role === 'survey').length})`,
    `surfaces/ each surface as LandXML 1.2 (${surfaces.length})`,
    `codes/    the feature library${codes ? ` (${codes})` : ''}, Trimble FXL`,
    `drawings/ CAD, BIM and other source files as imported (${files.filter((f) => f.role === 'drawings').length})`,
    `assets/   the PDFs, images and media the model shows (${assets})`,
    '',
  ].join('\r\n');
}
