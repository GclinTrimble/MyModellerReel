// The pictures, GIFs and videos of the how-to pages (#158), made from the running app so the help never shows an
// old UI. Run the app first (npm start, or MMR_TEST=1 MMR_SUITE_URL= MMR_HOME=<dir> npx electron .), then:
//   node scripts/docs-media.mjs [page-id …]          (all pages when none are named)
// Needs ffmpeg on the PATH for the GIFs and the downscaled step images. Look at every frame before committing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'how-to', 'media');
const SAMPLES = path.join(ROOT, 'docs', 'how-to', 'samples').replace(/\\/g, '/');
const HOME = process.env.MMR_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'MyModellerReel');
const { port, token } = JSON.parse(fs.readFileSync(path.join(HOME, 'api.json'), 'utf8'));
const req = async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return p.includes('screenshot') ? Buffer.from(await r.arrayBuffer()) : r.json();
};
const run = async (command, args = {}) => {
  const r = await req('POST', '/api/run', { command, args });
  if (!r.ok) throw new Error(`${command}: ${r.error}`);
  return r.result;
};
const js = async (code) => (await run('run_script', { code })).result;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const camera = (position, target) => run('set_camera', { position, target });
const none = () => run('select', { mode: 'none' });

let dir;
let n = 0;
let last = null;
/** One step: a toast naming it, then a capture that waited for the window to repaint. */
async function shot(label) {
  await js(`document.querySelectorAll('.toast').forEach((t) => t.remove()); ${label ? `const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = ${JSON.stringify(label)}; document.getElementById('toasts').append(t);` : ''} window.mmr.app.ui.setStatus(''); window.mmr.app.viewport.render(); return 1;`);
  let prev = null;
  let png = null;
  for (let i = 0; i < 12; i++) {
    await wait(i ? 900 : 2500);
    const p = await req('GET', '/api/window-screenshot');
    if (p.subarray(1, 4).toString() !== 'PNG') continue;
    if (prev && p.equals(prev) && !(last && p.equals(last))) {
      png = p;
      break;
    }
    prev = p;
  }
  last = png ||= prev;
  const file = path.join(dir, `${String(++n).padStart(2, '0')}.png`);
  fs.writeFileSync(file, png);
  return file;
}
const clean = () => js("document.querySelectorAll('.toast').forEach((t) => t.remove()); for (const d of document.querySelectorAll('#modal, #palette')) if (d.open) d.close(); window.mmr.app.ui.closeMenu(); window.mmr.app.timeline.close(); document.querySelector('.tour')?.remove(); const t = document.querySelector('.chat-input textarea'); if (t) t.value = ''; window.mmr.app.ui.show('ai'); return 1;");
const fresh = async () => {
  await clean();
  await run('new_model');
  await js("window.mmr.app.ai.setPropose(false); return 1;");
};
const hidePoints = async () => run('set_properties', { ids: (await run('get_scene')).entities.filter((e) => e.type === 'point').map((e) => e.id), visible: false });
const panel = (tab) => js(`window.mmr.app.ui.show('${tab}'); return 1;`);

const PAGES = {
  async 'push-pull-and-components'() {
    await fresh();
    await camera([7, 5, 8], [0, 1, 0]);
    await run('create_box', { width: 3, height: 2.4, depth: 2, name: 'Cabin', color: '#e9e4d8' });
    await none();
    await shot('Rectangle (R), then Push/Pull (P): a box');
    const r = await run('imprint', { id: 'Cabin', face: 'front', shape: 'rectangle', size: [1.2, 0.9], center: [0, 1.3, 1] });
    await none();
    await shot('Draw on a face: the outline is imprinted on it');
    await run('push_pull', { id: 'Cabin', face: r.face, distance: -0.15 });
    await none();
    await shot('Push the outline in: a window recess');
    const c = await run('make_component', { ids: ['Cabin'], name: 'Cabin' });
    await run('duplicate', { ids: [c.id], offset: [4, 0, 0], count: 2 });
    await camera([12, 7, 13], [4, 1, 0]);
    await none();
    await shot('Make component, then copy: three linked cabins');
    await run('set_material', { ids: [(await run('get_scene')).entities.filter((e) => e.name === 'Cabin').at(-1).id], color: '#7fb0c2' });
    await none();
    await shot('Change one: every copy follows');
  },
  async 'live-sweep-along-a-curve'() {
    await fresh();
    await camera([8, 9, 12], [3, 0, -1]);
    await run('create_curve', { points: [[-2, 0, 2], [2, 0, 1], [5, 0, -2], [8, 0, -3]], kind: 'spline', name: 'Kerb line' });
    await none();
    await shot('Curve tool (U): a smooth kerb line');
    await run('sweep', { path: 'Kerb line', profile: 'kerb', color: '#b9b2a3' });
    await none();
    await shot('Sweep the kerb profile along it');
    await run('set_curve', { id: 'Kerb line', points: [[-2, 0, 2], [2, 0, 3], [5, 0, -1], [8, 0, -4]] });
    await none();
    await shot('Move the curve: the kerb follows');
  },
  async 'hinge-a-door'() {
    await fresh();
    await camera([3.5, 2.6, 4.5], [0, 1.1, 0]);
    await run('create_box', { width: 1.2, height: 2.3, depth: 0.1, position: [0, 0, -0.06], name: 'Frame', color: '#5e3f2b' });
    await run('create_box', { width: 0.9, height: 2.1, depth: 0.05, position: [0, 0, 0.04], name: 'Door', color: '#c8a77a' });
    await none();
    await shot('A door in its frame');
    await run('set_pivot', { id: 'Door', pivot: 'left' });
    await run('animate', { target: 'Door', property: 'rotation', from: [0, 0, 0], to: [0, -100, 0], start: 0, end: 2, ease: 'ease-in-out' });
    await run('playback', { action: 'seek', time: 1 });
    await shot('set_pivot left, animate rotation 0 → −100° over 2 s');
    await run('playback', { action: 'seek', time: 2 });
    await shot('Open');
    await run('render_video', { path: path.join(dir, 'hinge-a-door.mp4'), width: 960, height: 540, fps: 30 });
  },
  async 'construction-sequence-video'() {
    await fresh();
    await run('new_from_template', { id: 'sequence' });
    await camera([14, 9, 14], [0, 1.6, 0]);
    for (const [t, label] of [[0.4, 'build_sequence: pieces arrive one by one'], [1.8, 'Captions name each phase'], [3.2, ''], [6, 'Render it: MP4, WebM or GIF']]) {
      await run('playback', { action: 'seek', time: t });
      await shot(label);
    }
    await run('render_video', { path: path.join(dir, 'construction-sequence-video.mp4'), width: 960, height: 540, fps: 30 });
  },
  async 'survey-points-to-surface'() {
    await fresh();
    await run('import_points', { path: `${SAMPLES}/site-points.csv` });
    await run('set_style', { point_labels: 'code' });
    await camera([75, 45, 30], [28, 0, -24]);
    await none();
    await shot('Site › Import points: 194 coded points (labels show the codes)');
    await run('define_feature_code', { code: 'KERB', layer: 'Kerbs', color: '#c8553d', line: true, breakline: true });
    await run('define_feature_code', { code: 'TREE', layer: 'Trees', color: '#4c7a5a', object: { type: 'tree', height: 6 } });
    await run('process_codes', {});
    await run('set_style', { point_labels: 'none' });
    await none();
    await shot('Feature codes: KERB joins into a breakline, TREE becomes a tree');
    const s = await run('create_surface', { name: 'Existing ground', codes: ['GND', 'KERB'] });
    await none();
    await shot('Create surface: a live TIN that follows the kerb');
    await js(`window.mmr.app.ui.checkSurfaceDialog(${JSON.stringify(s.id)}); return 1;`);
    await shot('');
  },
  async 'cut-and-fill-for-a-pad'() {
    await fresh();
    await run('import_points', { path: `${SAMPLES}/site-points.csv` });
    await run('create_surface', { name: 'Existing ground' });
    await camera([75, 45, 30], [28, 0, -24]);
    await none();
    await shot('The existing ground');
    const cf = await run('cut_fill', { existing: 'Existing ground', elevation: 102.5, name: 'Pad cut/fill' });
    await run('set_properties', { ids: ['Existing ground'], visible: false });
    await none();
    await shot(`Cut / fill to 102.5: cut ${Math.round(cf.cut)} m³ (red), fill ${Math.round(cf.fill)} m³ (blue)`);
    const v = await run('volume_report', { existing: 'Existing ground', elevation: 102.5 });
    await js(`window.mmr.app.ui.infoDialog('Volume report', ${JSON.stringify(v.csv || v)}); return 1;`);
    await shot('');
  },
  async 'design-an-access-road'() {
    await fresh();
    await run('import_points', { path: `${SAMPLES}/site-points.csv` });
    await run('create_surface', { name: 'Existing ground' });
    await camera([70, 55, 25], [28, 0, -24]);
    await run('create_alignment', { name: 'Access road', points: ['1', '82', '176'], radii: [15] });
    await none();
    await shot('Alignment through three points, a 15 m curve');
    await run('set_alignment', { id: 'Access road', pvis: [[0, 101], [35, 102.5, 20], [70, 104]], station_interval: 10 });
    await none();
    await shot('A vertical profile and stations every 10 m');
    await run('create_corridor', { alignment: 'Access road', surface: 'Existing ground', template: { lanes: [{ width: 3, crossfall: -2.5 }], shoulder: { width: 0.8, crossfall: -4 }, cut_slope: 1.5, fill_slope: 2 }, interval: 2 });
    await none();
    await shot('Corridor: lanes, shoulders, batters that meet the ground');
  },
  async 'put-a-pdf-in-place'() {
    await fresh();
    await run('set_base_point', { n: 5400000, e: 650000, z: 100 });
    await run('import_pdf', { path: `${SAMPLES}/site-plan.pdf`, scale: '1:500', name: 'Site plan', at: [-160, 0, 40] });
    for (const [n2, e2, name] of [[5400000, 650000, 'GR1'], [5400000, 650100, 'GR2'], [5400080, 650000, 'GR3'], [5400080.05, 650100.04, 'GR4']]) await run('add_point', { name, n: n2, e: e2, z: 100, code: 'CP' });
    await run('set_style', { point_labels: 'name' });
    await camera([-20, 300, -19.99], [-20, 0, -20]);
    await none();
    await shot('Drawings › Import PDF at 1:500; GR1–GR4 are where the grid crosses really are');
    const pairs = [[140, 692, 'GR1'], [706.93, 692, 'GR2'], [140, 238.46, 'GR3'], [706.93, 238.46, 'GR4']];
    await run('add_control_pair', { id: 'Site plan', from: { u: 140, v: 692 }, to: 'GR1' });
    await run('calibrate_underlay', { id: 'Site plan', move: { from: { u: 140, v: 692 }, to: 'GR1' } });
    await none();
    await shot('Control points tool (J): click the cross, then GR1. The sheet moves onto it');
    for (const [u, v, name] of pairs.slice(1)) await run('add_control_pair', { id: 'Site plan', from: { u, v }, to: name });
    await run('georeference_underlay', { id: 'Site plan' });
    await camera([50, 260, -29.99], [50, 0, -30]);
    await none();
    await shot('Four points: fitted by least squares');
    await js("window.mmr.app.ui.georefDialog(window.mmr.doc.entities.find((e) => e.name === 'Site plan').id); return 1;");
    await shot('');
  },
  async 'pdf-linework-to-3d'() {
    await fresh();
    await run('set_base_point', { n: 5400000, e: 650000, z: 100 });
    await run('import_pdf', { path: `${SAMPLES}/site-plan.pdf`, scale: '1:500', name: 'Site plan' });
    for (const [u, v, n2, e2] of [[140, 692, 5400000, 650000], [706.93, 692, 5400000, 650100], [140, 238.46, 5400080, 650000]]) await run('add_control_pair', { id: 'Site plan', from: { u, v }, to: { n: n2, e: e2 } });
    await run('georeference_underlay', { id: 'Site plan' });
    const st = await run('pdf_linework_stats', { id: 'Site plan' });
    await camera([55, 200, -37.99], [55, 0, -38]);
    await js(`window.mmr.app.ui.infoDialog('What is in this PDF?', ${JSON.stringify({ paths: st.paths, hatch: st.hatch, layers: st.layers })}); return 1;`);
    await shot('');
    await clean();
    await run('extract_linework', { id: 'Site plan', layers: ['C-KERB', 'A-BLDG', 'BOUNDARY', 'L-TREES'] });
    await run('set_underlay', { id: 'Site plan', fade: 0.75 });
    await none();
    await shot('Extract linework: kerbs, buildings, boundary and trees, on their own layers');
    const b = (await run('get_scene')).entities.find((e) => e.tag === 'PDF BOUNDARY');
    const off = await run('offset_curve', { id: b.id, distance: 3, side: 'inside', name: 'Setback' });
    await run('fillet', { ids: [off[0].id], radius: 6 });
    await none();
    await shot('Draft on it: a 3 m setback inside the boundary, filleted');
    await run('elevate_linework', { layer: 'PDF C-KERB', mode: 'text', underlay: 'Site plan', max_distance: 3 });
    await run('elevate_linework', { layer: 'PDF A-BLDG', mode: 'constant', elevation: 103 });
    await run('extrude_linework', { layer: 'PDF A-BLDG', height: 8, color: '#e9e4d8' });
    await run('sweep_linework', { layer: 'PDF C-KERB', profile: 'kerb', color: '#b9b2a3' });
    await run('set_underlay', { id: 'Site plan', fade: 0.4 });
    await camera([150, 70, 60], [60, 0, -35]);
    await none();
    await shot('To 3D: kerbs graded from the spot levels, buildings extruded, kerbs swept');
  },
  async 'bring-in-landxml-ifc-dxf'() {
    await fresh();
    const lx = await run('import', { path: `${SAMPLES}/survey.xml` });
    await camera([75, 45, 30], [28, 0, -24]);
    await none();
    await js(`window.mmr.app.ui.importReport(${JSON.stringify(lx)}); return 1;`);
    await shot('');
    await clean();
    await run('set_style', { point_labels: 'none' });
    await none();
    await shot('LandXML: points, the surface and the road, live in the model');
    await fresh();
    const dx = await run('import', { path: `${SAMPLES}/site.dxf` });
    await camera([95, 70, 75], [35, 0, -20]);
    await none();
    await js(`window.mmr.app.ui.importReport(${JSON.stringify(dx)}); return 1;`);
    await shot('');
    await clean();
    await panel('outliner');
    await js("[...document.querySelectorAll('.overline')].find((x) => x.textContent === 'Layers').scrollIntoView(); return 1;");
    await none();
    await shot('DXF: layers keep their colours, blocks become linked components');
  },
  async 'share-with-bim-tools'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await camera([16, 9, 18], [0, 1.5, 0]);
    await none();
    await shot('A house whose parts carry roles (wall, door, window) and data');
    await run('select', { ids: ['North wall'] });
    await panel('entity');
    await js("document.querySelector('.meta-row')?.scrollIntoView(); return 1;");
    await shot('Each part: its role and data (fire rating, load bearing)');
    const tmp = path.join(os.tmpdir(), 'mmr-docs-house.ifc').replace(/\\/g, '/');
    await run('export', { format: 'ifc', path: tmp });
    await fresh();
    await run('import', { path: tmp });
    await camera([16, 9, 18], [0, 1.5, 0]);
    await panel('outliner');
    await none();
    await shot('File › Export IFC: walls, doors and windows arrive as IFC classes in their storey');
  },
  async 'organise-with-layers'() {
    await fresh();
    await run('import', { path: `${SAMPLES}/site.dxf` });
    await camera([95, 70, 75], [35, 0, -20]);
    await panel('outliner');
    await js("[...document.querySelectorAll('.overline')].find((x) => x.textContent === 'Layers').scrollIntoView(); return 1;");
    await none();
    await shot('Outliner › Layers: colour, current layer, lock, show / hide');
    await run('set_layer', { name: 'V-TIN', visible: false });
    await run('set_layer', { name: 'V-SURVEY', locked: true });
    await none();
    await shot('Hide the CAD TIN, lock the survey points');
    await run('set_layer', { name: 'L-TREE', schema: { species: { type: 'string', options: ['oak', 'birch', 'lime'] }, height: { type: 'number' } } });
    const trees = (await run('get_scene')).entities.filter((e) => e.component === 'TREE').map((e) => e.id);
    await run('move_to_layer', { ids: trees, layer: 'L-TREE' });
    await run('edit_attributes', { ids: trees, values: { species: 'oak', height: 7 } });
    await js("window.mmr.app.ui.attributeTable('L-TREE'); return 1;");
    await shot('');
  },
  async 'ask-the-copilot'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await camera([16, 9, 18], [0, 1.5, 0]);
    await panel('ai');
    await js("const t = document.querySelector('.chat-input textarea'); t.value = 'Add a 2 m deep terrace along the south wall, and a pergola over it'; return 1;");
    await none();
    await shot('Type what you want in plain words; Enter sends');
    await js("window.mmr.app.ui.openPalette(); const i = document.querySelector('#palette-input'); i.value = 'hinge a door'; i.dispatchEvent(new Event('input')); return 1;");
    await shot('');
  },
  async 'review-and-quantities'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('create_box', { width: 1, height: 1, depth: 1, position: [9, 2, 0], name: 'Floating crate' });
    await camera([18, 10, 20], [2, 1.5, 0]);
    await js('window.mmr.app.ui.quantitiesDialog(); return 1;');
    await shot('');
    await clean();
    await js('window.mmr.app.ui.reviewDialog({ use_ai: false, views: false }); return 1;');
    await shot('');
  },
  async 'read-the-terrain'() {
    await fresh();
    await run('import_points', { path: `${SAMPLES}/site-points.csv` });
    await run('create_surface', { name: 'Existing ground' });
    await hidePoints();
    await camera([75, 45, 30], [28, 0, -24]);
    await none();
    await shot('The existing ground');
    await run('surface_contours', { id: 'Existing ground', interval: 0.25, major_every: 4 });
    await none();
    await shot('Site › Contours: every 0.25 m, a labelled major line every 1 m');
    await run('analyze_surface', { id: 'Existing ground', kind: 'slope', thresholds: [5, 10, 15, 25] });
    await run('select', { ids: ['Existing ground'] });
    await panel('entity');
    await shot('Site › Analysis colours: slope classes, the legend in the Entity panel');
    await run('create_curve', { points: [[2, 0, -4], [26, 0, -22], [54, 0, -44]], name: 'Access road' });
    await run('select', { ids: ['Access road'] });
    await js("window.mmr.app.ui.actions.profile.run(); return 1;");
    await shot('');
    await clean();
    await js("window.mmr.app.reg.run('cross_sections', { path: 'Access road', interval: 10 }).then((r) => window.mmr.app.ui.sectionsDialog(r, 3)); return 1;");
    await shot('');
  },
  async 'design-a-pad'() {
    await fresh();
    await run('import_points', { path: `${SAMPLES}/site-points.csv` });
    await run('create_surface', { name: 'Existing ground' });
    await hidePoints();
    await run('create_curve', { points: [[16, 0, -14], [38, 0, -14], [38, 0, -32], [16, 0, -32]], closed: true, name: 'Pad outline' });
    await camera([75, 45, 30], [28, 0, -24]);
    await none();
    await shot('A closed outline for the pad, on the existing ground');
    await run('create_pad', { outline: 'Pad outline', elevation: 103, surface: 'Existing ground', cut_slope: 2, fill_slope: 3, merge: true, name: 'Pad' });
    await run('set_properties', { ids: ['Existing ground'], visible: false });
    await none();
    await shot('Site › Pad with batters: top at 103.0, 2:1 cut, 3:1 fill, merged into a design surface');
    await run('set_batter', { id: 'Pad', elevation: 102.4 });
    await none();
    await shot('Lower it to 102.4: the batters and the design surface follow');
    await run('set_properties', { ids: ['Existing ground'], visible: true });
    const cf = await run('cut_fill', { existing: 'Existing ground', design: 'Design surface', name: 'Pad cut/fill' });
    await run('set_properties', { ids: ['Existing ground', 'Design surface', 'Pad'], visible: false });
    await none();
    await run('set_style', { edges: false });
    await shot(`Cut / fill against the design surface: cut ${Math.round(cf.cut)} m³, fill ${Math.round(cf.fill)} m³`);
    await run('set_style', { edges: true });
  },
  async 'sculpt-a-terrain'() {
    await fresh();
    await run('create_terrain', { width: 60, depth: 60, spacing: 1, name: 'Ground', color: '#9fb38a' });
    await camera([48, 30, 48], [0, 1, 0]);
    await none();
    await shot('Site › New terrain to sculpt: a flat 60 × 60 m grid');
    await run('sculpt_terrain', { id: 'Ground', at: [0, 0, 0], operation: 'raise', radius: 22, inner: 4, strength: 6, falloff: 'smooth' });
    await run('sculpt_terrain', { id: 'Ground', at: [-18, 0, 16], operation: 'lower', radius: 10, strength: 3, falloff: 'smooth' });
    await run('surface_contours', { id: 'Ground', interval: 0.5, major_every: 4 });
    await run('sculpt_terrain', { id: 'Ground', at: [9, 0, 9], operation: 'terrace', radius: 9, step: 0.75 });
    await none();
    await shot('Sculpt tool (V): raise a mound, lower a hollow, terrace a slope');
    await run('create_curve', { points: [[-6, 5, -6], [6, 5, -6], [6, 5, 6], [-6, 5, 6]], closed: true, name: 'Platform' });
    await run('stamp', { id: 'Ground', outline: 'Platform', elevation: 4.5, width: 4 });
    await run('set_properties', { ids: ['Platform'], visible: false });
    await none();
    await shot('Site › Stamp a platform: flat at 4.5 m, blended into the mound');
    await run('create_box', { width: 8, height: 3, depth: 6, position: [0, 8, 0], name: 'Pavilion', color: '#e9e4d8' });
    await run('drape', { ids: ['Pavilion'], surface: 'Ground' });
    await none();
    await shot('Site › Drape: the pavilion sits on the platform');
  },
  async 'bring-in-field-and-gis-data'() {
    await fresh();
    await run('import', { path: `${SAMPLES}/field.jxl` });
    await run('set_style', { point_labels: 'code' });
    await run('set_view', { preset: 'iso' });
    await run('zoom_extents', {});
    await none();
    await shot('File › Import a JobXML: points with their codes and attributes');
    await run('import', { path: `${SAMPLES}/library.fxl` });
    await run('set_style', { point_labels: 'name' });
    await panel('outliner');
    await none();
    await shot('Import the FXL: codes get their layers and colours, the kerb joins up');
    await run('import', { path: `${SAMPLES}/parcels.geojson` });
    await camera([95, 90, 70], [45, 0, -40]);
    await none();
    await js("window.mmr.app.ui.attributeTable('Parcels'); return 1;");
    await shot('');
    await clean();
    await run('import_terrain', { path: `${SAMPLES}/terrain.asc`, name: 'DEM' });
    await run('analyze_surface', { id: 'DEM', kind: 'elevation', bands: 8 });
    await camera([170, 110, 170], [50, 0, 20]);
    await none();
    await shot('Site › Import terrain: an ASCII grid DEM, coloured by elevation');
  },
  async 'dimension-and-label'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('create_text', { text: 'RIVERSIDE', size: 0.7, depth: 0.15, position: [0, 0, 7.4], color: '#c8553d', name: 'Sign' });
    await camera([14, 9, 19], [0, 1.2, 2]);
    await none();
    await shot('Tools › 3D text: a sign, extruded letters');
    await run('add_dimension', { id: 'Ground slab', axis: 'x', offset: 0.9 });
    await run('add_dimension', { id: 'Ground slab', axis: 'z', offset: 0.9 });
    await run('add_dimension', { id: 'East wall', axis: 'y', offset: 0.6, normal: [0, 0, 1] });
    await none();
    await shot('Dimension the selected shape: width, depth, height');
    await run('set_params', { id: 'Ground slab', params: { width: 13 } });
    await none();
    await shot('Make the slab 13 m wide: its dimension follows');
    await run('add_label', { id: 'Front door', text: '{name}\n{height}', offset: [0.8, 1.2, 0.6] });
    await run('add_label', { at: { id: 'Ground slab', corner: [0.97, 1, 0.97] }, text: '{name}: {footprint}', offset: [0.8, 1.4, 0.4] });
    await none();
    await shot('Label tool (K): {name}, {area}, {height}… kept up to date');
    await run('add_guide', { point: [-8, 0, 9.2], to: [8, 0, 9.2] });
    await run('create_curve', { points: [[-8, 0, 10.2], [8, 0, 10.2]], name: 'Boundary' });
    await run('set_properties', { ids: ['Boundary'], line_type: 'center', line_weight: 0.6 });
    await camera([15, 10, 22], [0, 1, 3]);
    await none();
    await shot('Tape + Ctrl: a guide line. A centre line type on the boundary');
  },
  async 'drawing-sheets-and-sections'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('add_dimension', { id: 'Ground slab', axis: 'x', offset: 0.9 });
    await camera([13, 9, 17], [0, 1.2, 1]);
    await none();
    await js("window.mmr.app.ui.commandDialog('export_drawing', { views: ['top', 'front', 'right', 'iso'], sheet: 'A3', title: 'Riverside pavilion', project: 'Riverside' }); return 1;");
    await shot('');
    await clean();
    const tmp = path.join(os.tmpdir(), 'mmr-docs-sheet.pdf').replace(/\\/g, '/');
    const r = await run('export_drawing', { path: tmp, views: ['top', 'front', 'right', 'iso'], sheet: 'A3', title: 'Riverside pavilion', project: 'Riverside', preview: true });
    await js(`window.mmr.app.ui.svgPreview('Sheet saved: mmr-docs-sheet.pdf · ${r.scale}', ${JSON.stringify(r.preview)}); return 1;`);
    await shot('');
    await clean();
    await run('section', { normal: [0, 1, 0], point: [0, 1.2, 0] });
    await camera([9, 13, 12], [0, 0.5, 0]);
    await none();
    await shot('Section Plane (X): where it cuts, the walls are filled');
    const tsv = path.join(os.tmpdir(), 'mmr-docs-plan.svg').replace(/\\/g, '/');
    const s = await run('export_section', { path: tsv, scale: 50, title: 'Plan at 1.2 m', preview: true });
    await js(`window.mmr.app.ui.svgPreview('Section saved: mmr-docs-plan.svg', ${JSON.stringify(s.preview)}); return 1;`);
    await shot('');
    await clean();
    await run('section', { enabled: false });
  },
  async 'present-a-design'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('set_camera', { position: [14, 7, 16], target: [0, 1.5, 0], lens: 35 });
    await none();
    await shot('The house, shaded');
    await run('set_style', { render_style: 'sketchy' });
    await none();
    await shot('View › Style › Sketchy: a hand-drawn concept');
    await run('set_style', { render_style: 'hidden_line' });
    await run('set_camera', { position: [9, 1.6, 11], target: [0, 2.6, 0], lens: 24, two_point: true });
    await none();
    await shot('Hidden line, a 24 mm lens, two-point perspective: walls stay upright');
    await run('set_style', { render_style: 'shaded' });
    await run('set_camera', { position: [14, 7, 16], target: [0, 1.5, 0], lens: 35, two_point: false });
    await run('set_environment', { preset: 'studio' });
    await run('set_effects', { ao: 0.8, vignette: 0.35 });
    await none();
    await shot('Studio environment, ambient occlusion and a vignette');
    const png = path.join(os.tmpdir(), 'mmr-docs-still.png').replace(/\\/g, '/');
    await run('set_effects', { ao: 0, vignette: 0 });
    await run('render_image', { path: png, width: 1280, height: 720, samples: 160 });
    await js(`window.mmr.app.ui.imagePreview('Render photoreal still: 160 samples', 'data:image/png;base64,${fs.readFileSync(png).toString('base64')}'); return 1;`);
    await shot('');
    await clean();
    await run('set_environment', { preset: 'default' });
  },
  async 'textures-and-materials'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('set_camera', { position: [13, 6, 15], target: [0, 1.5, 0], lens: 35 });
    await run('set_texture', { ids: ['North wall', 'South wall', 'East wall', 'West wall'], path: `${SAMPLES}/brick.png`, size: [0.9, 0.6] });
    await none();
    await shot('Texture from an image: brick at its real size on the walls');
    await run('set_texture', { ids: ['Ground slab'], path: `${SAMPLES}/paving.png`, projection: 'planar', size: [1.2, 1.2], rotation: 45 });
    await run('set_texture', { ids: ['North wall', 'South wall', 'East wall', 'West wall'], size: [0.6, 0.4] });
    await none();
    await shot('Planar paving turned 45°; smaller bricks: change the size');
    await run('create_box', { width: 2.4, height: 1, depth: 0.05, position: [2.5, 0, 5.4], name: 'Balustrade', color: '#cfe8f2' });
    await run('set_material_maps', { ids: ['Balustrade'], transmission: 1, ior: 1.5, thickness: 0.05 });
    await run('set_material', { ids: ['Balustrade'], roughness: 0.05 });
    await run('create_box', { width: 1.8, height: 0.9, depth: 0.9, position: [-3.5, 0, 6.2], name: 'Bench', color: '#7a1f1f' });
    await run('set_material', { ids: ['Bench'], metalness: 0.5, roughness: 0.35 });
    await run('set_material_maps', { ids: ['Bench'], clearcoat: 1 });
    await run('set_environment', { preset: 'studio' });
    await none();
    await shot('Glass, coat and maps: a glass balustrade, a lacquered bench');
    await run('set_environment', { preset: 'default' });
  },
  async 'sun-study-and-night-lights'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('set_geolocation', { latitude: 45.76, longitude: 4.84, utc_offset: 2, place: 'Lyon' });
    await run('set_camera', { position: [15, 11, 17], target: [0, 1, 0], lens: 35 });
    await run('set_sun_time', { date: '2026-06-21', time: '09:00' });
    await none();
    await shot('Lyon, 21 June, 9:00: the real sun');
    await run('animate_sun', { date: '2026-06-21', from: '06:00', to: '22:30', start: 0, end: 6 });
    await run('playback', { action: 'seek', time: 3.6 });
    await shot('Sun study on the timeline: 16:00');
    await run('render_video', { path: path.join(dir, 'sun-study-and-night-lights.mp4'), width: 960, height: 540, fps: 24 });
    await run('playback', { action: 'seek', time: 5.2 });
    await shot('20:30: long evening shadows');
    await run('animate_sun', { off: true });
    await run('set_sun_time', { date: '2026-12-21', time: '19:00' });
    await run('create_light', { kind: 'spot', position: [-1.6, 3.2, 6], target: [-2.2, 0.8, 4.3], intensity: 90, color: '#ffd9a0' });
    await run('create_light', { kind: 'spot', position: [2.6, 3.2, 6], target: [2.2, 0.8, 4.3], intensity: 90, color: '#ffd9a0' });
    await run('create_light', { kind: 'point', position: [0, 1.6, 0], intensity: 25, color: '#ffc27a' });
    await run('set_camera', { position: [11, 4, 15], target: [0, 1.4, 1], lens: 35 });
    await none();
    await shot('After sunset: two spot lights on the front, a warm light inside');
    await run('set_sun_time', { date: '2026-06-21', time: '12:00' });
  },
  async 'ai-render'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('set_camera', { position: [14, 7, 16], target: [0, 1.5, 0], lens: 35 });
    await none();
    await js("window.mmr.app.ui.commandDialog('ai_render', { prompt: 'warm summer evening, landscaped garden, people walking', strength: 0.55 }); return 1;");
    await shot('');
  },
  async 'edit-timing-and-reuse-clips'() {
    await fresh();
    for (let i = 0; i < 4; i++) {
      await run('create_box', { width: 1.2, height: 2.4, depth: 0.12, position: [i * 2.4, 0, -0.08], name: `Frame ${i + 1}`, color: '#5e3f2b' });
      await run('create_box', { width: 0.9, height: 2.1, depth: 0.05, position: [i * 2.4, 0, 0.03], name: `Door ${i + 1}`, color: '#c8a77a' });
      await run('set_pivot', { id: `Door ${i + 1}`, pivot: 'left' });
    }
    await run('animate', { target: 'Door 1', property: 'rotation', from: [0, 0, 0], to: [0, -100, 0], start: 0, end: 1.5 });
    await camera([4, 3.5, 9], [3.6, 1.1, 0]);
    await run('save_clip', { name: 'Door opens', ids: ['Door 1'], from: 0, to: 1.5 });
    await run('apply_clip', { name: 'Door opens', ids: ['Door 2', 'Door 3', 'Door 4'], start: 0.8, stagger: 0.8 });
    await none();
    await run('playback', { action: 'seek', time: 0.05 });
    await shot('One door animated, saved as the clip "Door opens"');
    await run('playback', { action: 'seek', time: 2.2 });
    await shot('Apply the clip to the other doors, 0.8 s apart');
    await js("const tl = window.mmr.app.timeline; tl.selKeys = new Set(window.mmr.doc.animation.tracks.slice(1).map((t) => t.target + '|rotation|' + Math.round(t.keys.at(-1).t * 1000))); tl.layoutNow(); return 1;");
    await shot('Shift-click keyframes: drag them together, Ctrl+C / Ctrl+V, Delete');
    await js("const tl = window.mmr.app.timeline; const tr = window.mmr.doc.animation.tracks[0]; tl.selKey = { track: tr, t: tr.keys[1].t }; tl.selKeys = new Set(); tl.curveDialog(); return 1;");
    await js("[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Overshoot').click(); return 1;");
    await shot('');
  },
  async 'carry-follow-and-fall'() {
    await fresh();
    await run('create_box', { width: 6, height: 2.6, depth: 0.3, position: [4, 0, -2], name: 'Wall', color: '#d8d0c0' });
    await run('create_cylinder', { radius: 0.12, height: 9, position: [-4, 0, 0], name: 'Mast', color: '#e8bc5e' });
    await run('create_box', { width: 0.25, height: 0.25, depth: 0.25, position: [0, 0.25, 0], name: 'Hook', color: '#c8553d' });
    await run('create_box', { width: 4, height: 0.25, depth: 0.25, position: [0, 0, 0], name: 'Beam', color: '#7f8a93' });
    await run('animate', { target: 'Hook', property: 'position', from: [0, 0.25, 0], to: [0, 6.5, 0], start: 1, end: 3 });
    await run('animate', { target: 'Hook', property: 'position', from: [0, 6.5, 0], to: [4, 2.85, -2], start: 3, end: 6 });
    await run('attach', { id: 'Beam', parent: 'Hook', start: 1, end: 6 });
    await run('animate', { target: 'Hook', property: 'position', from: [4, 2.85, -2], to: [4, 6, -2], start: 6.5, end: 8 });
    await camera([10, 7, 13], [1.5, 3, -1]);
    await none();
    await run('playback', { action: 'seek', time: 0 });
    await shot('A hook, a beam on the ground, a wall');
    await run('playback', { action: 'seek', time: 4 });
    await shot('Attach the beam to the hook from 1 s to 6 s: it is carried');
    await run('playback', { action: 'seek', time: 8 });
    await shot('Released at 6 s: it stays on the wall, the hook goes up');
    await clean();
    await fresh();
    await run('create_box', { width: 4, height: 0.3, depth: 4, name: 'Slab', color: '#a7a39a' });
    const names = ['Crate 1', 'Crate 2', 'Crate 3', 'Crate 4'];
    for (const [i, n] of names.entries()) await run('create_box', { width: 0.6, height: 0.6, depth: 0.6, position: [(i % 2) * 0.5 - 0.2, 2.5 + i * 0.9, (i > 1 ? 0.3 : -0.2)], rotation: [i * 17, i * 33, i * 11], name: n, color: ['#c8553d', '#2f6f86', '#e8bc5e', '#5e7f4a'][i] });
    await run('simulate_physics', { ids: names, duration: 4, bounce: 0.25 });
    await camera([6, 4, 7], [0, 0.6, 0]);
    await none();
    await run('playback', { action: 'seek', time: 4 });
    await shot('Physics: four crates dropped, tumbled and settled');
  },
  async 'shots-music-and-section-reveal'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await run('add_shot', { name: 'Wide', start: 0, end: 4, position: [20, 10, 22], target: [0, 1, 0], lens: 24 });
    await run('add_shot', { name: 'Entrance', start: 4, end: 8, position: [8, 2, 10], target: [0, 1.5, 4], position_end: [5, 1.8, 8] });
    await run('add_shot', { name: 'Plan', start: 8, end: 12, position: [10, 14, 12], target: [0, 0.5, 0] });
    await run('animate_section', { normal: [0, 1, 0], from: [0, 5.8, 0], to: [0, 0.6, 0], start: 8.5, end: 11.5 });
    await run('add_audio', { path: `${SAMPLES}/theme.wav`, start: 0, fade_in: 1.5, fade_out: 2 });
    await run('set_timeline', { duration: 12 });
    await none();
    await run('playback', { action: 'seek', time: 1 });
    await shot('Shots: the Shots row shows the cuts (Wide, Entrance, Plan)');
    await run('playback', { action: 'seek', time: 10.2 });
    await shot('Section reveal: the cut comes down through the house');
    await run('playback', { action: 'seek', time: 6 });
    await shot('Music on its own row: it plays with the timeline and goes into the render');
    await run('render_video', { path: path.join(dir, 'shots-music-and-section-reveal.mp4'), width: 960, height: 540, fps: 24 });
  },
  async 'build-a-4d-schedule'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await camera([14, 8, 16], [0, 1.5, 0]);
    await panel('outliner');
    await js("[...document.querySelectorAll('.overline')].find((x) => x.textContent === 'Layers').scrollIntoView(); return 1;");
    await none();
    await shot('Each part on its layer: A-SLAB, A-WALL, A-ROOF, A-DOOR, A-GLAZ');
    const r = await run('import_schedule', { path: `${SAMPLES}/house-schedule.csv`, seconds_per_day: 0.3, effect: 'grow' });
    await js(`window.mmr.app.ui.infoDialog('Schedule imported', ${JSON.stringify(`${r.tasks} tasks, ${r.matched} matched, ${r.seconds_per_day} s per day\n${r.schedule.map((x) => `${x.task}: ${x.start} → ${x.finish} builds ${x.builds.join(', ')}`).join('\n')}`)}); return 1;`);
    await shot('');
    await clean();
    await panel('ai');
    await js('window.mmr.app.timeline.open(); return 1;');
    await run('playback', { action: 'seek', time: 4.4 });
    await shot('The walls going up on 15 March: the date and the tasks under way, top left');
    await run('render_video', { path: path.join(dir, 'build-a-4d-schedule.mp4'), width: 960, height: 540, fps: 24 });
  },
  async 'product-modelling'() {
    await fresh();
    await run('create_box', { width: 0.3, height: 0.3, depth: 0.3, name: 'Case', color: '#2f6f86' });
    await run('fillet_edges', { id: 'Case', edges: 'all', radius: 0.03, segments: 8 });
    await camera([0.55, 0.45, 0.7], [0, 0.12, 0]);
    await none();
    await shot('Fillet edges: a 0.3 m cube with 3 cm rounded edges');
    await run('create_box', { width: 0.3, height: 0.12, depth: 0.2, name: 'Tray', color: '#e8bc5e', position: [0.45, 0, 0] });
    await run('shell', { id: 'Tray', thickness: 0.006, open: 'top' });
    await camera([0.7, 0.5, 0.75], [0.25, 0.08, 0]);
    await none();
    await shot('Shell: a tray hollowed to 6 mm, open at the top');
    const ring = (r, y) => Array.from({ length: 32 }, (_, k) => [r * Math.cos((k / 32) * 2 * Math.PI) - 0.45, y, r * Math.sin((k / 32) * 2 * Math.PI)]);
    await run('create_curve', { points: ring(0.05, 0), closed: true, name: 'Base ring' });
    await run('create_curve', { points: ring(0.09, 0.15), closed: true, name: 'Belly ring' });
    await run('create_curve', { points: ring(0.03, 0.32), closed: true, name: 'Neck ring' });
    await run('create_curve', { points: ring(0.045, 0.36), closed: true, name: 'Lip ring' });
    await run('loft', { profiles: ['Base ring', 'Belly ring', 'Neck ring', 'Lip ring'], color: '#c8553d', name: 'Vase' });
    await run('set_properties', { ids: ['Base ring', 'Belly ring', 'Neck ring', 'Lip ring'], visible: false });
    await camera([0.6, 0.5, 1.1], [0, 0.15, 0]);
    await none();
    await shot('Loft through four rings: a vase');
    await run('create_box', { width: 0.12, height: 0.6, depth: 0.12, name: 'Tower', color: '#9aa3ab', position: [0.9, 0, 0] });
    await run('deform', { id: 'Tower', type: 'twist', amount: 120, segments: 24 });
    await run('create_box', { width: 0.16, height: 0.16, depth: 0.16, name: 'Blob', color: '#5e7f4a', position: [-0.9, 0, 0] });
    await run('subdivide', { id: 'Blob', levels: 3 });
    await camera([0.2, 0.9, 2.2], [0, 0.2, 0]);
    await none();
    await shot('Deform (a live twist) and Subdivide (a cube smoothed into a pebble)');
  },
  async 'floor-plan-to-3d'() {
    await fresh();
    const r = await run('import_2d', { path: `${SAMPLES}/floor-plan.svg`, faces: true });
    await camera([6, 16, 13], [6, 0, 4.5]);
    await none();
    await shot(`Import 2D: a 12 × 9 m plan, ${r.faces} closed outlines made faces`);
    const faces = (await run('get_scene')).entities.filter((e) => e.type === 'mesh').map((e) => e.id);
    for (const id of faces) await run('push_pull', { id, face: 'top', distance: 2.7 });
    await camera([18, 11, 17], [6, 1, 4.5]);
    await none();
    await shot('Push/Pull the faces 2.7 m: walls and a column');
    await run('set_axes', { origin: [14, 0, 0], angle: 25, grid: 0.5, snap: true });
    await run('create_rectangle', { points: [[14, 0, 0], [20.3, 0, -2.94], [15.27, 0, 2.72]], name: 'Wing' });
    await run('push_pull', { id: 'Wing', face: 'top', distance: 3.2 });
    await camera([24, 14, 19], [12, 1, 3]);
    await none();
    await shot('Turned drawing axes and grid (25°): a 3-point rectangle for a rotated wing');
    await run('create_cylinder', { radius: 0.2, height: 3, name: 'Column', position: [3, 0, 11.5], color: '#b9b2a3' });
    await run('array_grid', { ids: ['Column'], nx: 5, nz: 2, spacing: [3, 0, 3] });
    await run('create_curve', { points: [[-2, 0, 16], [8, 0, 18], [18, 0, 15]], kind: 'spline', name: 'Path', color: '#8a8f94' });
    await run('create_cone', { radius: 0.7, height: 3, name: 'Tree', position: [0, 0, 16], color: '#3f6b45' });
    await run('array_path', { ids: ['Tree'], path: 'Path', count: 7 });
    await run('set_axes', { reset: true });
    await camera([26, 16, 30], [9, 0, 10]);
    await none();
    await shot('Grid array of columns; trees along a curve');
  },
  async 'component-library-and-sets'() {
    await fresh();
    await run('create_box', { width: 12, height: 0.15, depth: 9, name: 'Plaza', color: '#c9c2b4', tag: 'L-PAVING' });
    for (const [name, position] of [['Tree.glb', [-4, 0.15, -2.5]], ['Conifer.glb', [4.5, 0.15, -3]], ['Bench.glb', [0, 0.15, -1]], ['Bench.glb', [2.5, 0.15, 1.8]], ['Person.glb', [1, 0.15, 1]], ['Street light.glb', [-5, 0.15, 3.5]], ['Car.glb', [0, 0, 6.5]]]) await run('insert_asset', { name, position });
    await camera([13, 9, 15], [0, 1, 1]);
    await panel('library');
    await none();
    await shot('Library › Components: click or drag a model into the view');
    const benches = (await run('get_scene')).entities.filter((e) => e.name === 'Bench').map((e) => e.id);
    await run('save_selection', { name: 'Benches', ids: benches });
    await run('save_selection', { name: 'Hardscape', ids: ['Plaza', ...benches] });
    await run('select_set', { name: 'Benches' });
    await panel('outliner');
    await js("document.querySelector('.chips')?.scrollIntoView(); return 1;");
    await shot('Selection sets: one click selects the benches again');
    await run('set_layer', { name: 'L-PAVING', folder: 'Landscape', color: '#b9a98c' });
    await run('create_layer', { name: 'L-PLANTING', folder: 'Landscape', color: '#7fae4a' }).catch(() => run('set_layer', { name: 'L-PLANTING', folder: 'Landscape', color: '#7fae4a' }));
    await run('create_layer', { name: 'L-FURNITURE', folder: 'Landscape', color: '#c8553d' }).catch(() => {});
    await run('create_layer', { name: 'V-VEHICLES', folder: 'Vehicles', color: '#2f6f86' }).catch(() => {});
    const under = (names) => js(`const d = window.mmr.doc; const top = d.entities.filter((e) => ${JSON.stringify(names)}.includes(e.name) && !e.parent).map((e) => e.id); const out = []; const walk = (id) => { out.push(id); d.entities.filter((e) => e.parent === id).forEach((e) => walk(e.id)); }; top.forEach(walk); return out;`);
    await run('move_to_layer', { ids: await under(['Tree', 'Conifer']), layer: 'L-PLANTING' });
    await run('move_to_layer', { ids: await under(['Bench']), layer: 'L-FURNITURE' });
    await run('move_to_layer', { ids: await under(['Car']), layer: 'V-VEHICLES' });
    await run('set_style', { color_by: 'layer' });
    await none();
    await js("[...document.querySelectorAll('.overline')].find((x) => x.textContent === 'Layers').scrollIntoView(); return 1;");
    await shot('Layer folders, and colour by layer');
    await run('set_style', { color_by: 'material' });
  },
  async 'scan-to-ground'() {
    await fresh();
    await run('import_point_cloud', { path: `${SAMPLES}/site-scan.ply` });
    await camera([78, 40, 38], [30, 2, -20]);
    await none();
    await shot('Import a point cloud: 38,130 coloured scan points');
    await run('classify_ground', { id: 'site-scan' });
    await none();
    await shot('Ground surface from the cloud: the building and the trees are left out');
    await run('set_properties', { ids: ['site-scan'], visible: false });
    await shot('The ground alone, ready for contours, pads and cut and fill');
    await run('set_properties', { ids: ['site-scan'], visible: true });
    await run('walk_to', { position: [10, 0, -5], look_at: [40, 2, -20] });
    await shot('Walk to: stand at eye height in the scan (Walk tool: arrows / WASD)');
  },
  async 'scanned-drawings-and-reading'() {
    await fresh();
    await run('import_image', { path: `${SAMPLES}/scanned-plan.jpg`, scale: '1:100' });
    await run('set_view', { preset: 'top' });
    await run('zoom_extents', {});
    await none();
    await shot('A scanned plan as an underlay (Drawings › Import image)');
    const scan = (await run('get_scene')).entities.find((e) => e.type === 'underlay').id;
    const v = await run('vectorise_underlay', { id: scan });
    await run('set_properties', { ids: [scan], visible: false });
    await none();
    await shot(`Vectorise: the ink becomes ${v.curves} lines on the layer Scan`);
    await fresh();
    const pdf = (await run('import_pdf', { path: `${SAMPLES}/site-plan.pdf`, name: 'Site plan' })).underlays[0].id;
    await run('set_view', { preset: 'top' });
    await run('zoom_extents', {});
    const r = await run('read_drawing', { id: pdf, use_ai: false });
    await js(`window.mmr.app.ui.readDrawingDialog('${pdf}', ${JSON.stringify(r)}); return 1;`);
    await shot('Read the drawing: its scale, title and north, from its text');
    await clean();
    await run('read_drawing', { id: pdf, use_ai: false, apply: true });
    await run('set_style', { snap_underlays: true });
    await run('zoom_extents', { ids: [pdf] });
    await none();
    await js("window.mmr.app.tools.set('line'); return 1;");
    // the Line tool from one corner of the drawing to the next, with the snap marker showing
    const [a, b] = await js("const v = window.mmr.app.viewport; const V = window.mmr.THREE.Vector3; v.vertexCache = null; v.snapPoints(); await new Promise((r) => setTimeout(r, 2500)); v.vertexCache = null; const ends = v.snapPoints().filter((s) => s.kind === 'Drawing end').map((s) => s.p); const c = new window.mmr.THREE.Box3().setFromPoints(ends).getCenter(new V()); const near = (q, not) => ends.filter((p) => !not || p.distanceTo(not) > 4).reduce((m, p) => (p.distanceTo(q) < m.distanceTo(q) ? p : m)); const a = near(c); const b = near(a.clone().add(new V(15, 0, 0)), a); return [a, b].map((p) => v.toScreen(p));");
    await req('POST', '/api/input', { events: [{ type: 'mouseMove', x: a.x, y: a.y }, { type: 'wait', ms: 200 }, { type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: a.x, y: a.y, button: 'left', clickCount: 1 }, { type: 'wait', ms: 200 }, { type: 'mouseMove', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { type: 'wait', ms: 100 }, { type: 'mouseMove', x: b.x, y: b.y }] });
    await shot('Applied: true size at 1:500; the Line tool snaps to the drawing\'s corners');
    await req('POST', '/api/input', { events: [{ type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }] });
    await js("window.mmr.app.tools.set('select'); return 1;");
  },
  async 'share-viewer-ar-print'() {
    await fresh();
    await run('create_box', { width: 8, height: 3, depth: 6, name: 'House', color: '#e9e4d8' });
    await run('create_box', { width: 8.6, height: 0.3, depth: 6.6, position: [0, 3, 0], name: 'Roof slab', color: '#5e6b73' });
    await run('save_version', { name: 'Scheme A' });
    await run('create_box', { width: 4, height: 2.6, depth: 5, position: [6.5, 0, 0.5], name: 'Garage', color: '#c9c2b4' });
    await run('move', { ids: ['House'], by: [-0.5, 0, 0] });
    await camera([14, 9, 16], [1.5, 1.5, 0]);
    await none();
    await js('window.mmr.app.ui.versionsDialog(); return 1;');
    await shot('File › Versions: saved inside the file');
    await clean();
    const d = await run('compare_versions', { from: 'Scheme A' });
    await js(`window.mmr.app.ui.infoDialog('Scheme A → now', ${JSON.stringify(`Added: ${d.added.join(', ') || '—'}\nChanged: ${d.changed.join(', ') || '—'}\nRemoved: ${d.removed.join(', ') || '—'}`)}); return 1;`);
    await shot('Compare: what was added, changed and removed');
    await clean();
    const html = path.join(dir, 'viewer.html');
    await run('export_web_viewer', { path: html });
    await js(`const f = document.createElement('iframe'); f.id = 'doc-viewer'; f.src = ${JSON.stringify(`file:///${html.replace(/\\/g, '/')}`)}; const r = document.querySelector('.viewport-wrap').getBoundingClientRect(); Object.assign(f.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', border: '0', zIndex: 50, background: '#fff' }); document.body.append(f); return 1;`);
    await wait(3000);
    await shot('Export a web viewer: one HTML file anyone can open and orbit');
    await js("document.getElementById('doc-viewer')?.remove(); return 1;");
    fs.rmSync(html, { force: true });
  },
  async 'free-assets-and-models'() {
    await fresh();
    await run('create_box', { width: 5, height: 0.12, depth: 4, name: 'Deck', color: '#d9d4c7' });
    await camera([4.5, 3.2, 5.5], [0, 0.4, 0]);
    await none();
    await js("window.mmr.app.ui.assetsDialog(); const i = document.querySelector('#modal input'); i.value = 'picnic'; document.querySelector('#modal .btn.primary').click(); return 1;");
    await wait(4000);
    await shot('File › Free assets: search Poly Haven (CC0)');
    await clean();
    await run('import_asset', { id: 'wooden_picnic_table', type: 'models' });
    await run('select', { ids: ['Deck'] });
    await run('import_asset', { id: 'laminate_floor_02', type: 'textures' });
    await none();
    await shot('A model and a texture brought in, with their licence in the metadata');
    await run('import_asset', { id: 'kloofendal_48d_partly_cloudy_puresky', type: 'hdris' }).catch(() => {});
    await run('set_style', { grid: false });
    await none();
    await shot('An HDRI sky as the environment');
    await run('set_style', { grid: true });
    await run('set_environment', { preset: 'default' }).catch(() => {});
  },
  async 'tabs-handles-walk-and-language'() {
    await fresh();
    await run('create_box', { width: 4, height: 3, depth: 4, name: 'Pavilion', color: '#e9e4d8' });
    await run('create_cylinder', { radius: 0.4, height: 3, position: [4, 0, 0], name: 'Column', color: '#b9b2a3' });
    await camera([9, 6, 10], [1.5, 1.2, 0]);
    await run('select', { ids: ['Pavilion'] });
    await run('set_gizmo', { mode: 'move' });
    await shot('Handles: drag an arrow to move (rings rotate, boxes scale)');
    await run('set_gizmo', { mode: 'off' });
    await run('new_document', { name: 'Option B' });
    await run('create_cylinder', { radius: 3, height: 4, name: 'Rotunda', color: '#d9cdb8' });
    await camera([9, 6, 10], [0, 1.5, 0]);
    await none();
    await shot('Document tabs: two models open, copy and paste between them');
    await run('close_document', { name: 'Option B' });
    await run('set_shortcut', { key: 'Ctrl+Shift+F', action: 'fillet_edges' });
    await run('set_language', { lang: 'fr' });
    await panel('settings');
    await js("[...document.querySelectorAll('h3')].find((x) => /Langue|Language/.test(x.textContent))?.scrollIntoView(); return 1;");
    await shot('Settings: menus in French, and your own keyboard shortcuts');
    await run('set_language', { lang: 'en' });
    await run('set_shortcut', { key: 'Ctrl+Shift+F', action: 'none' });
  },
  async 'check-for-clashes'() {
    await fresh();
    await run('create_box', { width: 8, height: 0.5, depth: 0.3, position: [0, 3, 0], name: 'Beam B1', color: '#9aa3ab' });
    await run('create_box', { width: 8, height: 0.5, depth: 0.3, position: [0, 3, 3], name: 'Beam B2', color: '#9aa3ab' });
    await run('create_box', { width: 0.3, height: 3, depth: 0.3, position: [-3.5, 0, 0], name: 'Column C1', color: '#b9b2a3' });
    await run('create_box', { width: 0.3, height: 3, depth: 0.3, position: [3.5, 0, 3], name: 'Column C2', color: '#b9b2a3' });
    await run('create_cylinder', { radius: 0.15, height: 6, position: [1, 3.25, -1.5], rotation: [90, 0, 0], name: 'Duct D1', color: '#c8553d' });
    await run('create_cylinder', { radius: 0.1, height: 6, position: [-1.5, 2.2, -1.5], rotation: [90, 0, 0], name: 'Pipe P1', color: '#2f6f86' });
    await camera([8, 7, 10], [0, 2.5, 1.5]);
    await none();
    await shot('Beams, columns, a duct and a pipe');
    const r = await run('check_clashes', { select: true });
    await js(`window.mmr.app.ui.clashDialog(${JSON.stringify(r)}); return 1;`);
    await shot('');
    await clean();
    await run('zoom_extents', { ids: r.clashes[0].ids });
    await shot(`Show: ${r.clashes[0].names.join(' × ')}, ${(r.clashes[0].depth * 100).toFixed(0)} cm deep`);
  },
};

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
let ffmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  ffmpeg = false;
  console.warn('ffmpeg is not on the PATH: step images stay full size and there are no GIFs.');
}
for (const id of ids) {
  if (!PAGES[id]) throw new Error(`No page "${id}". Pages: ${Object.keys(PAGES).join(', ')}`);
  dir = path.join(OUT, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  n = 0;
  await PAGES[id]();
  await clean();
  if (ffmpeg) {
    const frames = fs.readdirSync(dir).filter((f) => /^\d+\.png$/.test(f));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '0.45', '-start_number', '1', '-i', path.join(dir, '%02d.png'), '-vf', 'scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0', path.join(dir, `${id}.gif`)]);
    for (const f of frames) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, f), '-vf', 'scale=960:-1:flags=lanczos', path.join(dir, f.replace('.png', '.jpg')), '-q:v', '4']);
    for (const f of frames) fs.rmSync(path.join(dir, f));
  }
  console.log(id, fs.readdirSync(dir).join(' '));
}
