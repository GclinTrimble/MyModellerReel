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
