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
const req = async (method, p, body, again = true) => {
  // a kept-alive socket the server already closed: try once more on a fresh one
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch((e) => (again && e.cause?.code === 'ECONNRESET' ? null : Promise.reject(e)));
  if (!r) return req(method, p, body, false);
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
/** One step: a toast naming it, then a capture that waited for the window to repaint (moving: a view that never
 * settles, e.g. a running turn's clock, is taken once). */
async function shot(label, { moving = false } = {}) {
  await js(`document.querySelectorAll('.toast').forEach((t) => t.remove()); ${label ? `const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = ${JSON.stringify(label)}; document.getElementById('toasts').append(t);` : ''} window.mmr.app.ui.setStatus(''); window.mmr.app.viewport.render(); return 1;`);
  let prev = null;
  let png = null;
  for (let i = 0; i < 12; i++) {
    await wait(i ? 900 : 2500);
    const p = await req('GET', '/api/window-screenshot');
    if (p.subarray(1, 4).toString() !== 'PNG') continue;
    if (moving) {
      png = p;
      break;
    }
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

/** A rolling ground with a ridge, a road alignment over it, and (with a template) its corridor. */
async function roadScene(template = null) {
  await run('create_terrain', { width: 220, depth: 140, spacing: 4, name: 'Ground', color: '#8a9a6b' });
  await js("const e = api.doc.entities.find((x) => x.name === 'Ground'); delete e.derived; e.mesh.v = e.mesh.v.map(([x, y, z]) => { const X = x + e.position[0], Z = z + e.position[2]; return [x, 9 * Math.exp(-(X * X) / (2 * 38 * 38)) + 0.05 * Z - 2.5 + 1.2 * Math.sin(X / 23) * Math.cos(Z / 31), z]; }); e.meta = { ...(e.meta || {}), surface: true }; return 1;");
  await run('set_style', { grid: false });
  await run('create_alignment', { name: 'Main road', points: [[-95, 25], [0, 0], [95, 15]], radii: [70], pvis: [[0, 1.5], [100, 4], [200, 1]], curves: [80] });
  if (template) await run('create_corridor', { alignment: 'Main road', surface: 'Ground', name: 'Road', interval: 5, template });
}
const ROAD = { lanes: [{ width: 3.5, crossfall: -2.5 }], shoulder: { width: 1.5, crossfall: -4 }, cut_slope: 1.5, fill_slope: 2, ditch: { width: 0.6, depth: 0.6 }, layers: [{ name: 'Asphalt', thickness: 0.1, material: 'Asphalt' }, { name: 'Base course', thickness: 0.3, material: 'Crushed stone' }], superelevation: { rate: 5, runoff: 25 } };

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
  async 'work-with-several-agents'() {
    await fresh();
    await run('new_from_template', { id: 'house' });
    await camera([16, 9, 18], [0, 1.5, 0]);
    await run('save_agent', { name: 'Site surveyor', skill: 'survey', instructions: 'You check levels and drainage; answer in short lists.', color: '#e0a458' });
    await run('save_agent', { name: 'Landscaper', instructions: 'You plant and pave around buildings.', color: '#9ece6a' });
    await panel('agents');
    await none();
    await shot('The Agents panel: Plumb and your own agents, each with its model, skill and thread');
    await js("window.mmr.app.agents.editDialog(window.mmr.app.agents.profiles[1]); return 1;");
    await shot('Each agent: name, model, skill, tools, standing instructions and colour');
    await js("document.getElementById('modal').close(); const r = window.mmr.app.viewport.canvas.getBoundingClientRect(); const p = window.mmr.app.agents.askAt(r.left + r.width * 0.45, r.top + r.height * 0.55); p.querySelector('select').value = 'landscaper'; p.querySelector('input').value = 'Put a paved terrace here, 3 m deep'; return 1;");
    await shot('Ctrl+Space or right-click › Ask…: a prompt where you point, with the point and the selection');
    await js("window.mmr.app.agents.closeAsk(); return 1;");
    await run('remove_agent', { agent: 'Site surveyor' });
    await run('remove_agent', { agent: 'Landscaper' });
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
    await clean();
    // a running turn (#257), from a scripted model so it needs none: reasoning, then commands landing one by one
    await js(`const a = window.mmr.app, t = a.agents.current, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const call = (n, x) => ({ function: { name: n, arguments: x } });
      const plan = [
        { think: 'The house is 10 m wide. A 2 m terrace along the south wall, then four posts and two beams for the pergola.', calls: [call('create_box', { width: 10, height: 0.15, depth: 2, position: [0, 0, 5], name: 'Terrace' })] },
        { calls: [-4.8, 4.8].flatMap((x) => [call('create_cylinder', { radius: 0.08, height: 2.6, position: [x, 0.15, 5.8], name: 'Post' })]) },
        { calls: [call('create_box', { width: 10, height: 0.2, depth: 0.12, position: [0, 2.75, 5.8], name: 'Beam' })] },
        { text: 'Done: a 10 × 2 m terrace and a pergola over it.' },
      ];
      window.__realChat = a.chat;
      a.chat = async () => {
        const s = plan.shift();
        if (s.think) { t.delta('<think>'); for (const w of s.think.split(' ')) (t.delta(w + ' '), await sleep(70)); t.delta('</think>'); }
        await sleep(2500);
        return s.calls ? { message: { role: 'assistant', content: '', tool_calls: s.calls }, prompt_eval_count: 2400, eval_count: 60 } : { message: { role: 'assistant', content: s.text }, prompt_eval_count: 300, eval_count: 20 };
      };
      t.reset();
      t.send('Add a 2 m deep terrace along the south wall, and a pergola over it');
      return 1;`);
    await wait(4000);
    await shot('While Plumb works: what it does now, the time so far, each command as it runs, and Stop', { moving: true });
    await wait(9000);
    await js('window.mmr.app.chat = window.__realChat; return 1;');
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
  async 'import-survey-points'() {
    await fresh();
    await run('import_points', { path: `${SAMPLES}/site-points.csv` });
    await run('set_style', { point_labels: 'code' });
    await camera([75, 45, 30], [28, 0, -24]);
    await js(`window.mmr.app.ui.importPointsDialog(${JSON.stringify(`${SAMPLES}/utilities.csv`)}); return 1;`);
    await wait(800);
    await shot('Site › Import points: the file split into columns, a role per column');
    // the crew column is not worth keeping
    await js("const s = document.querySelector('#modal select[aria-label=\"Column 9\"]'); s.value = 'ignore'; s.dispatchEvent(new Event('change')); return 1;");
    await wait(500);
    await js("document.querySelector('#modal .points-wizard').scrollLeft = 9999; return 1;");
    await wait(500);
    await wait(500);
    await shot('Pick what each column holds: Diameter, Material and Inspected stay as attributes, Crew is ignored');
    await js("document.querySelector('#modal footer .btn.primary').click(); return 1;");
    await wait(800);
    await run('select', { ids: ['U1'] });
    await panel('entity');
    await shot('Each point keeps its attributes: the Entity panel shows and edits them');
    await clean();
    await run('import', { path: `${SAMPLES}/field.jxl` });
    await run('zoom_extents', {});
    await none();
    await shot('JobXML and LandXML points come in through Import points too, with codes and attributes');
    },
  async 'feature-code-libraries'() {
    await fresh();
    await run('import_feature_library', { path: `${SAMPLES}/site-codes.fxl`, name: 'Site codes', replace: true });
    await run('import_feature_library', { path: `${SAMPLES}/library.fxl`, name: 'Old library', replace: true });
    await js("window.mmr.app.ui.featureLibrariesDialog('Site codes'); return 1;");
    await shot('Site › Feature code libraries: an FXL from Feature Definition Manager, kept by name');
    await js('window.mmr.app.ui.closeModal(); return 1;');
    const at = (n, e, code) => run('add_point', { n: 5400000 + n, e: 650000 + e, z: 10, ...(code ? { code } : {}) });
    for (const [n, e] of [[0, 0], [0, 12], [0, 24], [2, 34]]) await at(n, e, 'ROKERB');
    for (const [n, e] of [[8, 4], [9, 18], [7, 30]]) await at(n, e, 'VETRE');
    await at(5, 10, 'SUBEN');
    await at(4, 20);
    await run('use_feature_library', { name: 'Site codes' });
    await run('set_style', { point_labels: 'code' });
    await run('set_view', { preset: 'top' });
    await run('zoom_extents', {});
    await none();
    await shot('Use in this model: the kerb joins up, codes take their layers and colours');
    await js("window.mmr.app.tools.set('point'); window.mmr.app.ui.codeCard({ clientX: innerWidth * 0.35, clientY: innerHeight * 0.3 }, '', 'Code of the new point'); setTimeout(() => { const i = document.querySelector('.code-card input'); i.value = 'kerb'; i.dispatchEvent(new Event('input')); document.querySelector('.code-browse').click(); }, 300); return 1;");
    await shot('Survey point: ▦ browses the library; Enter with no code places a point without one');
    await js("document.querySelector('.code-card input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.mmr.app.tools.set('select'); return 1;");
    await js("window.mmr.app.ui.commandDialog('edit_library_code', { library: 'Site codes', code: 'ROKERB', description: 'Back of kerb', type: 'line', layer: 'WS-Road_Kerb', color: '#ff5500', line_style: 'Dashed' }, { form: true }); return 1;");
    await shot('Edit a code: description, type, layer, colour, line style, attributes');
    await js('window.mmr.app.ui.closeModal(); return 1;');
    await run('manage_feature_library', { name: 'Old library', action: 'delete' });
  },
  async 'project-folders'() {
    await fresh();
    const dir = path.join(os.tmpdir(), 'mmr-docs-project', 'Riverside upgrade').replace(/\\/g, '/');
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    await run('set_coordinate_system', { epsg: 2193, name: 'NZGD2000 / NZTM' });
    await run('import', { path: `${SAMPLES}/field.jxl` });
    await run('create_surface', { name: 'EG' });
    await run('set_view', { preset: 'iso' });
    await run('zoom_extents', {});
    await none();
    await js("[...document.querySelectorAll('[aria-haspopup=menu]')].find((b) => b.textContent.trim() === 'File').click(); return 1;");
    await shot('File › Save as project folder…: one folder for the whole job');
    await clean();
    const r = await run('save_project', { path: dir });
    await run('new_document', {});
    await run('open_project', { path: dir });
    await run('zoom_extents', {});
    await none();
    await js("window.mmr.app.ui.outline = { by: 'hierarchy', q: '', open: new Set(['Survey points', 'Surfaces']) }; window.mmr.app.ui.show('outliner'); return 1;");
    await shot(`Open project…: the model, its field book and surface; ${r.tables.length} tables in project.gpkg`);
    await js("window.mmr.app.ui.show('ai'); return 1;");
  },
  async 'feature-code-symbols'() {
    await fresh();
    // the symbols: a lamp post (3D) and a flat plan block (2D), each made a component once
    await run('create_cylinder', { radius: 0.12, height: 6, name: 'Pole', position: [0, 0, -40] });
    await run('create_box', { width: 1.2, height: 0.15, depth: 0.3, name: 'Head', position: [0.5, 6, -40] });
    await run('make_component', { ids: ['Pole', 'Head'], name: 'Lamp post' });
    await run('set_component_origin', { name: 'Lamp post', at: [0, 0, -40] }); // the foot of the pole, not the middle of pole + arm
    await run('create_cylinder', { radius: 0.12, height: 6, name: 'Pole 2', position: [6, 0, -40] });
    await run('create_box', { width: 2.4, height: 0.15, depth: 0.3, name: 'Heads', position: [6, 6, -40] });
    await run('make_component', { ids: ['Pole 2', 'Heads'], name: 'Lamp post double' });
    await run('create_box', { width: 1, height: 0.02, depth: 1, name: 'Plan block', position: [12, 0, -40] });
    await run('make_component', { ids: ['Plan block'], name: 'Lamp plan' });
    const code = { code: 'LP', description: 'Lamp post', layer: 'Lighting', color: '#e8bc5e', object: { type: 'component', component: 'Lamp post', plan: 'Lamp plan', scale_attr: 'SCALE', rotation_attr: 'ROT', color_attr: 'COLOUR', variant_attr: 'TYPE', variants: { Double: { component: 'Lamp post double' } } }, attrs: [{ name: 'TYPE', type: 'list', options: ['Single', 'Double'], default: 'Single' }, { name: 'SCALE', type: 'number', decimals: 1, min: 0.5, max: 2, default: 1 }, { name: 'ROT', type: 'number', min: 0, max: 360, description: 'arm direction, ° from north' }, { name: 'COLOUR', type: 'color' }, { name: 'LAMP', type: 'list', options: ['LED', 'Sodium'], required: true }, { name: 'WORKING', type: 'boolean', default: true }] };
    await js(`window.mmr.app.ui.commandDialog('define_feature_code', ${JSON.stringify(code)}, { form: true }); setTimeout(() => document.querySelector('[data-field=object]')?.scrollIntoView(), 300); return 1;`);
    await shot('Site › Define feature code: its 2D and 3D symbols, and typed attributes');
    await js('window.mmr.app.ui.closeModal(); return 1;');
    await run('define_feature_code', code);
    for (const [i, rot, col, k] of [[0, 0, '#2f6f86', 1], [1, 45, '#c8553d', 1.5], [2, 90, '#4c7a5a', 1], [3, 180, '#2f6f86', 2]]) await run('add_point', { n: 5400000 + i * 8, e: 650000 + i * 6, z: 10, code: 'LP', attrs: { ROT: rot, COLOUR: col, SCALE: k, LAMP: 'LED', TYPE: i === 2 ? 'Double' : 'Single' } });
    await run('set_style', { point_labels: 'code' });
    await run('set_view', { preset: 'top' });
    await run('zoom_extents', {});
    await none();
    await js("window.mmr.app.tools.set('point'); const d = window.mmr.app.store.doc.featureCodes.LP.attrs; window.mmr.app.ui.attrCard({ clientX: innerWidth * 0.45, clientY: innerHeight * 0.4 }, d, {}, 'LP · new point'); setTimeout(() => { const i = document.querySelector('.attr-card input'); i.value = '5'; i.dispatchEvent(new Event('change')); }, 300); return 1;");
    await shot('Survey point: after the code, its attributes next to the cursor (Tab, Enter)');
    await js("document.querySelector('.attr-card')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.mmr.app.tools.set('select'); return 1;");
    await run('set_style', { point_labels: 'attrs', symbols: '3d' });
    await run('set_view', { preset: 'iso' });
    await run('zoom_extents', {});
    await none();
    await shot('Symbols 3D, labels Code + attributes: scaled, turned and tinted by their attributes');
    await run('set_style', { symbols: '2d', point_labels: 'code' });
    await run('set_view', { preset: 'top' });
    await run('zoom_extents', {});
    await none();
    await shot('Symbols 2D: the plan block at each point');
    await run('set_style', { symbols: 'both', point_labels: 'name' });
    const rows = ['P,N,E,Z,CODE,ROT,LAMP,TYPE'];
    for (let i = 0; i < 40; i++) rows.push(`B${i + 1},${5400040 + (i % 8) * 6},${650000 + Math.floor(i / 8) * 7},10,LP,${(i * 30) % 360},led,${i % 3 ? 'single' : 'double'}`);
    await run('import_points', { text: rows.join('\n'), header: true, source: 'north-block.csv' });
    await run('import', { path: `${SAMPLES}/field.jxl` });
    await run('set_view', { preset: 'iso' });
    await run('zoom_extents', {});
    await none();
    await js("window.mmr.app.ui.outline = { by: 'hierarchy', q: '', open: new Set(['Survey points', 'Survey points/File: north-block.csv']) }; window.mmr.app.ui.show('outliner'); return 1;");
    await shot('Import a file: codes map by themselves; the Outliner folds points by field book and file');
    await js("window.mmr.app.ui.show('ai'); return 1;");
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
  async 'point-cloud-display'() {
    await fresh();
    const { streetScan } = await import('../tests/fixtures/streetscan.js');
    const file = path.join(os.tmpdir(), 'street-scan.las');
    fs.writeFileSync(file, streetScan().bytes);
    await run('import_point_cloud', { path: file.split(path.sep).join('/') });
    await run('set_style', { grid: false });
    const iso = () => camera([75, 32, 22], [28, 2, -24]);
    const style = (a) => run('set_cloud_style', { id: 'street-scan', ...a });
    const filter = (a) => run('set_cloud_filter', { id: 'street-scan', ...a });
    await iso();
    await none();
    await style({ size: 3 });
    await shot('A street scan in its own colours (RGB)');
    await style({ color_by: 'intensity' });
    await shot('Colour by intensity: the lane markings stand out; the legend gives the range (2–98 %)');
    await style({ color_by: 'elevation', ramp: 'terrain' });
    await shot('Colour by elevation: from the ditch to the roofs');
    await style({ color_by: 'classification', ramp: null });
    await shot('Colour by classification: the ASPRS classes, with their legend');
    await style({ color_by: 'single', color: '#c8c4ba' });
    await shot('One colour: walls and trees are hard to read…');
    await style({ edl: true });
    await shot('…eye-dome lighting shades depth steps: edges and depth without normals');
    await camera([33, 6, -6], [22, 4, -16]);
    await style({ edl: false, color_by: 'rgb', shape: 'paraboloid', size_mode: 'attenuated', size: 0.12 });
    await shot('Paraboloid points, 12 cm in the world (attenuated): a wall reads as a surface');
    await style({ shape: 'square', size_mode: 'fixed', size: 3 });
    await iso();
    await run('set_layout', { count: 2, arrangement: 'columns' });
    await run('set_pane', { pane: 2, view: 'top' });
    await run('zoom_extents', { pane: 2 });
    await style({ pane: 2, color_by: 'intensity', size: 2 });
    await filter({ pane: 2, classes: { show: [2, 11] } });
    await shot('Per pane: RGB in 3D, intensity and ground only in the plan');
    await run('set_layout', { count: 1 });
    // reading depth
    await run('set_view', { preset: 'top' });
    await run('set_camera', { projection: 'parallel' });
    await run('zoom_extents', {});
    await style({ depth: 'xray' });
    await shot('X-ray: walls seen edge on build up into dark lines, roofs and ground stay light');
    await run('set_camera', { projection: 'perspective', position: [30, 4, -1], target: [30, 4, -40] });
    await style({ depth: 'depth' });
    await shot('Depth colour: near warm, far cool; the tree in front of the far building');
    await style({ depth: 'fog', focus: 20, fog_near: 2, fog_far: 12 });
    await shot('Fog: points past the focus fade (hold Alt over a point to focus on it)');
    await style({ depth: 'off', focus: 'cursor', outside: 'ghost', color_by: 'classification' });
    await iso();
    await run('section', { normal: [0, 1, 0], point: [0, 4, 0], name: 'Ground floor' });
    await shot('A section with the outside as a ghost: what is cut away stays faint, only the rest snaps');
    await run('section', { enabled: false });
    await style({ outside: null });
    // show and hide
    await filter({ classes: { hide: [3, 4, 5] } });
    await shot('Show and hide: vegetation (classes 3–5) hidden, from the view and from snapping');
    await filter({ classes: { show: 'all' }, returns: 'last' });
    await shot('Last returns only: the ground under the trees, not the canopy');
    await filter({ returns: 'all', density: 25 });
    await shot('Density 25 %: the same quarter of the points every frame');
    await filter({ density: null });
    await run('select', { ids: ['street-scan'] });
    await panel('entity');
    await js("document.querySelector('.cloud-classes')?.scrollIntoView({ block: 'center' }); return 1;");
    await shot('The Point cloud panel: style, depth, and the classes with their counts');
  },
  async 'large-point-clouds'() {
    await fresh();
    await run('set_layout', { count: 1 });
    // the synthetic corridor scan of the tests (road, kerbs, ditch, buildings, wall, trees), a new file each run
    const F = await import('../tests/fixtures/scan.js');
    const file = path.join(os.tmpdir(), `corridor-scan-${Date.now()}.las`).replace(/\\/g, '/');
    fs.writeFileSync(file, F.writeLas(F.makeScan({ points: 6e6 })));
    const cloud = "api.doc.entities.find((e) => e.name === 'Corridor scan')";
    try {
      await run('import_point_cloud', { path: file, name: 'Corridor scan' });
      while (!(await js(`return ${cloud}?.pointcloud.count || 0;`))) await wait(200);
      const base = await js(`return ${cloud}.pointcloud.base;`);
      const at = (e, n, up = 0) => [e - base[0], F.groundAt(e, n) - base[2] + up, -(n - base[1])];
      await none();
      await camera(at(650120, 5399990, 60), at(650050, 5400040));
      await shot('Converting in the background: the preview first, the progress in the status bar', { moving: true });
      while ((await run('point_cloud_job', { id: 'Corridor scan' })).octree !== 'ready') await wait(300);
      await js('await window.mmr.app.viewport.clouds.settle(() => window.mmr.app.viewport.render()); return 1;');
      await shot('The octree streams: 6 M points, the whole corridor within the point budget');
      await camera(at(650052, 5400041.2, 0.55), at(650049, 5400043.6, 0.1));
      await js('await window.mmr.app.viewport.clouds.settle(() => window.mmr.app.viewport.render()); return 1;');
      const p = await run('pick_cloud_point', { x: 0.5, y: 0.6 });
      const cls = { 2: 'ground', 11: 'road surface' }[p.classification] || `class ${p.classification}`;
      await shot(p.project ? `Close to the kerb: every point. Picked ${p.project[0].toFixed(3)} E, ${p.project[1].toFixed(3)} N, ${p.project[2].toFixed(3)} m, ${cls}, intensity ${p.intensity}` : 'Close to the kerb: every point of the scan');
      await camera(at(650120, 5399990, 60), at(650050, 5400040));
      await run('set_layout', { count: 4, arrangement: 'grid' });
      await run('set_pane', { pane: 2, view: 'top' });
      await run('zoom_extents', { pane: 2 });
      await run('set_camera', { pane: 3, position: at(650030, 5400045, 6), target: at(650020, 5400058, 3) });
      await run('set_camera', { pane: 4, position: at(650051, 5400040.4, 1.4), target: at(650049.5, 5400043.6) });
      await js('await window.mmr.app.viewport.clouds.settle(() => window.mmr.app.viewport.render()); return 1;');
      await shot('Four panes, each refining for its own camera, one budget and one cache');
      await run('set_layout', { count: 1 });
      await camera(at(650036, 5400032, 9), at(650024, 5400056, 3));
      await run('set_cloud_budget', { points: 500000 });
      await js('await window.mmr.app.viewport.clouds.settle(() => window.mmr.app.viewport.render()); return 1;');
      await shot('Site › Point cloud budget: 0.5 M points at once (3 M by default), the nearest nodes first');
    } finally {
      await run('set_cloud_budget', { points: 3000000 });
      fs.rmSync(file, { force: true });
    }
  },
  async 'classify-a-point-cloud'() {
    await fresh();
    await run('set_layout', { count: 1 });
    // the synthetic corridor scan of the tests delivered unclassified, with a box van parked on the north verge
    const F = await import('../tests/fixtures/scan.js');
    const T = await import('../tests/fixtures/truck.js');
    const file = path.join(os.tmpdir(), `corridor-unclassified-${Date.now()}.las`).replace(/\\/g, '/');
    fs.writeFileSync(file, F.writeLas(T.withTruck(F.makeScan({ points: 1500000, seed: 2 }))));
    const id = 'Corridor scan';
    const settle = () => js('await window.mmr.app.viewport.clouds.settle(() => window.mmr.app.viewport.render()); return 1;');
    try {
      await run('import_point_cloud', { path: file, name: id, octree: true });
      while ((await run('point_cloud_job', { id })).octree !== 'ready') await wait(300);
      await run('set_style', { grid: false });
      const base = await js(`return api.doc.entities.find((e) => e.name === '${id}').pointcloud.base;`);
      const at = (e, n, up = 0) => [e - base[0], F.groundAt(e, n) - base[2] + up, -(n - base[1])];
      const [ox, oy] = F.SITE.origin;
      const wide = () => camera(at(ox + 105, oy - 12, 55), at(ox + 50, oy + 42));
      await wide();
      await none();
      await settle();
      await shot('A scan delivered unclassified: every point class 1');
      await run('classify_cloud', { id, steps: ['noise', 'ground', 'vegetation', 'buildings', 'road'] });
      await run('set_cloud_style', { id, color_by: 'classification' });
      await wait(2500);
      await shot('Site › Classify point cloud: it runs in the background, tile by tile, with its progress below', { moving: true });
      while ((await js(`return api.doc.entities.find((e) => e.name === '${id}').pointcloud.classify.status;`)) === 'running') await wait(500);
      await settle();
      await shot('Ground, road surface, kerbs, buildings, trees and noise in their ASPRS colours; the legend counts every point');
      // the van, tagged building: a hand fix
      const [vx, vy] = [(T.TRUCK.min[0] + T.TRUCK.max[0]) / 2, (T.TRUCK.min[1] + T.TRUCK.max[1]) / 2];
      await camera(at(vx + 12, vy - 13, 9), at(vx, vy, 1.4));
      await settle();
      await shot('A parked van, tagged building: no classifier is right everywhere');
      await js("window.mmr.app.tools.set('pointselect'); return 1;");
      const corners = [];
      for (const x of [T.TRUCK.min[0], T.TRUCK.max[0]]) for (const y of [T.TRUCK.min[1], T.TRUCK.max[1]]) for (const z of [0.2, 3]) corners.push(at(x, y, z));
      const sc = await js(`const vp = window.mmr.app.viewport; return ${JSON.stringify(corners)}.map((p) => { const v = vp.camera.position.clone().set(...p).project(vp.camera); return [(v.x + 1) / 2, (1 - v.y) / 2]; });`);
      const [x0, x1, y0, y1] = [Math.min(...sc.map((p) => p[0])) - 0.02, Math.max(...sc.map((p) => p[0])) + 0.02, Math.min(...sc.map((p) => p[1])) - 0.02, Math.max(...sc.map((p) => p[1])) + 0.02];
      const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
      const lasso = [[x0, my], [x0 + 0.02, y0], [mx, y0 - 0.02], [x1 - 0.01, y0], [x1 + 0.01, my], [x1, y1], [mx, y1 + 0.02], [x0 + 0.01, y1]];
      // the lasso as the tool draws it, then the same selection through select_points
      await js(`const t = window.mmr.app.tools.tool; t.outline(${JSON.stringify(lasso)}); return 1;`);
      const sel = await run('select_points', { id, polygon: lasso, classes: [6] });
      await shot(`Point Select (Site menu): a lasso around the van, only its building points: ${sel.selected.toLocaleString()} selected`);
      await js("window.mmr.app.tools.tool.outline([]); return 1;");
      await run('set_point_class', { class: 65 });
      await run('clear_point_selection');
      await shot('Press 0: the van is a vehicle (user class 65); the legend counts follow, one undo step');
      // grow over a wall of the flat-roofed building
      const b = F.SITE.buildings[0];
      await camera(at(ox + 36, oy + 38, 9), at(ox + 21, oy + 56, 2));
      await settle();
      const g = await run('select_points', { id, grow_from: [ox + 21, oy + 55, b.base + 3], tolerance: 12, distance: 0.08 });
      await shot(`Grow from a point on a wall: the wall's plane, stopping at the corners (${g.selected.toLocaleString()} points)`);
      await run('clear_point_selection');
      await js("window.mmr.app.tools.set('select'); return 1;");
      // the terrain from class 2
      await run('set_cloud_filter', { id, classes: { hide: [3, 4, 5, 6, 7, 18, 65] } });
      await wide();
      await settle();
      await shot('Hide vegetation, buildings, vehicles and noise: the bare earth');
      await run('classify_ground', { id, cell: 1, name: 'Ground from scan' });
      await run('set_properties', { ids: [id], visible: false });
      await none();
      await shot('Ground surface from a point cloud: class 2 as it is, no search again');
    } finally {
      fs.rmSync(file, { force: true });
    }
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
  async 'multiple-views'() {
    await fresh();
    await run('create_box', { width: 6, height: 3, depth: 4, name: 'Studio', color: '#e9e4d8' });
    await run('create_box', { width: 2, height: 5, depth: 2, position: [4.5, 0, -1], name: 'Tower', color: '#b9b2a3' });
    await run('create_cylinder', { radius: 0.8, height: 2.5, position: [-5, 0, 2], name: 'Tank', color: '#9aa3ab' });
    await camera([12, 8, 13], [0, 1.5, 0]);
    await none();
    await shot('One view: the model in 3D');
    await run('set_layout', { count: 4, arrangement: 'grid' });
    await run('zoom_extents', { pane: 'all' });
    await shot('View › Four views: 3D, plan, front and right side, each with its own camera');
    // draw a rectangle in the plan (pane 2) with real clicks
    const r = await js("window.mmr.app.tools.set('rectangle'); const b = window.mmr.app.panes.extra[0].canvas.getBoundingClientRect(); return [b.left, b.top, b.width, b.height];");
    const at = (fx, fy) => [Math.round(r[0] + r[2] * fx), Math.round(r[1] + r[3] * fy)];
    const [x0, y0] = at(0.18, 0.72);
    const [x1, y1] = at(0.5, 0.88);
    await req('POST', '/api/input', { events: [
      { type: 'mouseMove', x: x0, y: y0 }, { type: 'wait', ms: 150 },
      { type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: x0, y: y0, button: 'left', clickCount: 1 }, { type: 'wait', ms: 150 },
      { type: 'mouseMove', x: (x0 + x1) >> 1, y: (y0 + y1) >> 1 }, { type: 'wait', ms: 100 }, { type: 'mouseMove', x: x1, y: y1 }, { type: 'wait', ms: 150 },
      { type: 'mouseDown', x: x1, y: y1, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 }, { type: 'wait', ms: 300 },
    ] });
    await js("window.mmr.app.tools.set('select'); return 1;");
    await none();
    await shot('Draw in the plan: the rectangle shows in every view');
    await run('set_layout', { count: 3, arrangement: 'main_left', split: [0.66, 0.5] });
    await run('set_pane', { pane: 3, view: 'iso', projection: 'perspective', style: 'wireframe' });
    await run('zoom_extents', { pane: 'all' });
    await shot('Three views: each pane chooses its view and style; drag the bar to resize');
    await run('set_layout', { max: 2 });
    await run('zoom_extents', { pane: 2 });
    await shot('Double-click a title to maximise a pane, again to restore');
    await run('set_layout', { max: 0 });
    await run('detach_pane', { pane: 2 });
    await run('zoom_extents', { pane: 2 });
    const file = await shot('Pane 2 in its own window (bottom right): put it on a second screen');
    const det = await req('GET', '/api/window-screenshot?title=View%202');
    if (ffmpeg && det.subarray(1, 4).toString() === 'PNG') {
      // the two real windows in one frame: the detached one in the corner, as on a second screen
      const tmp = path.join(dir, 'detached.png');
      const out = path.join(dir, 'pip.png');
      fs.writeFileSync(tmp, det);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-i', tmp, '-filter_complex', '[1]scale=iw*0.42:-1,pad=iw+6:ih+6:3:3:color=0x1d262c[d];[0][d]overlay=W-w-60:H-h-70', out]);
      fs.renameSync(out, file);
      fs.rmSync(tmp);
    }
    await run('detach_pane', { pane: 2, detached: false });
    await run('set_layout', { count: 1 });
  },
  async 'road-through-terrain'() {
    await fresh();
    await roadScene();
    await camera([10, 120, 105], [0, 0, 12]);
    await none();
    await shot('An alignment over the ground: straights, an arc and a vertical curve');
    await run('create_corridor', { alignment: 'Main road', surface: 'Ground', name: 'Road', interval: 5, template: { lanes: [{ width: 3.5, crossfall: -2.5 }], shoulder: { width: 1.5, crossfall: -4 }, cut_slope: 1.5, fill_slope: 2 } });
    await camera([38, 30, 62], [0, 2, 12]);
    await none();
    await shot('Site › Corridor: the road with its side slopes, red-brown in cut, blue in fill');
    await run('road_views', { corridor: 'Road', station: 100 });
    await camera([45, 32, 70], [0, 2, 12]);
    await none();
    await shot('Road views: 3D, plan, the profile and the cross-section, side by side');
    // a real click in the profile cuts the section there
    const b = await js("const p = window.mmr.app.panes.extra[1]; const r = p.board.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, p.view2d.map.X(165)];");
    const [x, y] = [Math.round(b[4] + b[0]), Math.round(b[1] + b[3] * 0.6)];
    await req('POST', '/api/input', { events: [{ type: 'mouseMove', x, y }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }, { type: 'wait', ms: 400 }] });
    await shot('Click the profile to cut a section there; the plan and 3D show where');
    await run('set_corridor', { id: 'Road', template: { ditch: { width: 0.6, depth: 0.6 }, bench: { every: 3, width: 2 }, right: { cut_slope: 1 } } });
    await run('set_pane', { pane: 4, station: 100 });
    await shot('Change the template: a ditch in cut, a bench every 3 m, a steeper right side');
    await run('set_layout', { count: 1 });
    await run('corridor_surface', { corridor: 'Road' });
    await camera([-40, 22, 50], [8, 3, 10]);
    await none();
    await shot('See the cut through the ground: the finished ground is shown, the survey is untouched');
    await run('set_style', { grid: true });
  },
  async 'road-earthworks'() {
    await fresh();
    await roadScene(ROAD);
    const v = await run('corridor_volumes', { corridor: 'Road', bulking: 1.25, shrinkage: 0.9 });
    await camera([60, 45, 85], [0, 2, 12]);
    await none();
    await js(`window.mmr.app.ui.roadVolumesDialog(${JSON.stringify(v)}); return 1;`);
    await shot('Site › Road earthwork volumes: cut and fill station by station, and the balance');
    await clean();
    const s = await run('corridor_solids', { corridor: 'Road' });
    await run('set_properties', { ids: ['Ground', 'Road'], visible: false });
    await run('set_style', { edges: false });
    await camera([40, 60, 95], [0, 0, 12]);
    await none();
    await shot('The cut (red-brown), the fill (blue) and the pavement layers as solids with their materials');
    // a section plane across the fill shows the layers: asphalt, base course, then the fill body
    await run('section', { normal: [-1, 0, 0], point: [-60, 0, 0] });
    await camera([-70, 4.5, 8], [-60, 1.4, 15.8]);
    await shot('Cut across: asphalt over the base course, on the fill body');
    await run('section', { enabled: false });
    await run('set_style', { edges: true });
    await js(`window.mmr.app.ui.roadSolidsDialog(${JSON.stringify(s)}); return 1;`);
    await shot('Quantities: each solid with its volume and weight');
    await clean();
    await run('set_style', { grid: true });
  },
  async 'work-faster'() {
    await fresh();
    await run('create_box', { width: 4, height: 3, depth: 4, name: 'Pavilion', color: '#e9e4d8' });
    await run('create_box', { width: 2, height: 5, depth: 2, position: [4, 0, -1], name: 'Tower', color: '#b9b2a3' });
    for (const [n, e, z] of [['101', -6, 0], ['102', -6, 6], ['103', -1, 7], ['104', 1, 3], ['105', -3, 2]]) await run('add_point', { name: n, e, n: z + 2, z: 0.2 * e });
    await camera([10, 9, 14], [-1, 1, 1]);
    await none();
    const click = (sel, k = 0, type = 'click') => js(`const b = document.querySelectorAll('${sel}')[${k}]; b.dispatchEvent(new MouseEvent('${type}', { bubbles: true, clientX: b.getBoundingClientRect().left + 4, clientY: b.getBoundingClientRect().top + 4 })); return 1;`);
    await click('.toolbar .slot', 2, 'contextmenu');
    await shot('A shorter toolbar: variants share a button; right-click (or click again) to choose');
    await clean();
    await click('#viewbar .drop', 0);
    await shot('Views: standard views, projection, wireframe and panes, for the pane you work in');
    await clean();
    await click('#viewbar .drop', 2);
    await shot('Display: switch edges, x-ray, style… on and off; the list stays open');
    await clean();
    await click('#viewbar .drop', 1);
    await shot('Navigate: on a touchpad, Alt + drag orbits and Alt + Shift + drag pans');
    await clean();
    const [x, y] = await js("const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(0, 1.5, 2)); return [Math.round(s.x), Math.round(s.y)];");
    await req('POST', '/api/input', { events: [{ type: 'mouseMove', x, y }, { type: 'mouseDown', x, y, button: 'right', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'right', clickCount: 1 }, { type: 'wait', ms: 300 }] });
    await shot('Right-click a shape: group, component, hide, isolate, export it, its properties');
    await clean();
    await run('select', { ids: ['101', '102', '103', '104', '105'] });
    const [px, py] = await js("const p = window.mmr.doc.entities.find((e) => e.name === '103'); const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...p.position)); return [Math.round(s.x), Math.round(s.y)];");
    await req('POST', '/api/input', { events: [{ type: 'mouseMove', x: px, y: py }, { type: 'mouseDown', x: px, y: py, button: 'right', clickCount: 1 }, { type: 'mouseUp', x: px, y: py, button: 'right', clickCount: 1 }, { type: 'wait', ms: 300 }] });
    await shot('Right-click selected survey points: create a surface from them');
    await clean();
    await run('section', { normal: [0, 0, -1], point: [0, 0, 0.5], name: 'Front cut' });
    await run('section', { normal: [-1, 0, 0], point: [4, 0, 0], name: 'Tower cut' });
    await run('set_section_plane', { name: 'Front cut', active: true });
    await none();
    await js('window.mmr.app.ui.sectionPlanesDialog(); return 1;');
    await shot('View › Section planes: which one cuts, flip, move, delete');
    await clean();
    await run('section', { enabled: false });
    await run('select', { ids: ['Tower'] });
    await js('window.mmr.app.ui.exportDialog(); return 1;');
    await shot('File › Export: choose what, then the format');
    await clean();
    await panel('settings');
    await js("document.querySelector('.ai-finder')?.scrollIntoView(); return 1;");
    await shot('Settings › AI: the models on this PC, found for you; connect one in a click');
  },
  async 'draw-and-edit'() {
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    const slab = await run('create_face', { points: [[-3, 0, 2], [3, 0, 2], [3, 0, -2], [-3, 0, -2]], name: 'Slab' });
    await run('create_face', { points: [[1, 0, 0], [5, 0, 0], [5, 0, -4], [1, 0, -4]], split: true });
    await camera([5, 9, 10], [1, 0, -1]);
    await run('select', { ids: ['Slab'] });
    await shot('Draw over a face: it splits; one shape, three faces');
    const e = await js(`const e = window.mmr.doc.entities.find((x) => x.name === 'Slab'); const v = e.mesh.v; return e.mesh.f.map((f) => f.map((k) => v[k]));`);
    const area = (l) => Math.abs(l.reduce((s, p, i) => s + (p[2] * l[(i + 1) % l.length][0] - p[0] * l[(i + 1) % l.length][2]), 0) / 2);
    const overlap = e.findIndex((l) => Math.abs(area(l) - 4) < 1e-3);
    await run('push_pull', { id: slab.id, face: overlap, distance: 1.2 });
    await run('select', { ids: ['Slab'] });
    await shot('Push/Pull one part: the others stay flat');
    await js("window.mmr.app.tools.set('select'); window.mmr.app.select(['Slab']); return 1;");
    await shot('Selected: grips on its corners and edge middles; drag one to move it');
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    await run('create_arc', { kind: 'three_point', start: [-4, 0, 0], through: [-2.5, 0, -1.5], end: [-1, 0, 0] });
    await run('create_arc', { kind: 'three_point', start: [1, 0, 0], through: [2.4, 0, -1.4], end: [3, 0, 0.6] });
    await camera([0, 9, 7], [0, 0, 0.3]);
    await none();
    // a line with the real Line tool: two straight clicks, A, an arc segment, Enter
    await js("window.mmr.app.tools.set('line'); return 1;");
    const at = (p) => js(`const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(${p.join(',')})); return [Math.round(s.x), Math.round(s.y)];`);
    const click = async (p) => {
      const [x, y] = await at(p);
      return [{ type: 'mouseMove', x: x + 3, y }, { type: 'mouseMove', x, y }, { type: 'wait', ms: 80 }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }, { type: 'wait', ms: 120 }];
    };
    await req('POST', '/api/input', { events: [...(await click([-4, 0, 2.2])), ...(await click([-0.8, 0, 2.2])), { type: 'keyDown', keyCode: 'A' }, { type: 'keyUp', keyCode: 'A' }, { type: 'wait', ms: 100 }, ...(await click([1.6, 0, -0.6])), { type: 'keyDown', keyCode: 'Return' }, { type: 'keyUp', keyCode: 'Return' }, { type: 'wait', ms: 300 }] });
    await js("window.mmr.app.tools.set('select'); return 1;");
    await none();
    await js("const b = document.querySelectorAll('.toolbar .slot')[4]; b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); return 1;");
    await shot('Arcs: start-end-bulge, through three points, from the centre; in a line, A switches to arc segments');
    await clean();
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    await run('create_box', { width: 4, height: 2.4, depth: 3, name: 'Shed', color: '#e9e4d8' });
    await run('add_dimension', { from: [-2, 0, 1.5], to: [2, 0, 1.5], name: 'Width', offset: 0.8 });
    await run('edit_annotation', { id: 'Width', text_shift: 0.9 });
    await run('add_label', { id: 'Shed', text: 'Garden shed', leader: false, size: 22, color: '#2f6f86', plate: 'none', offset: [0, 2.2, 0] });
    await run('add_label', { at: [2, 1.2, 1.5], text: 'Door here', size: 13 });
    await camera([5, 5, 8], [0, 1, 0]);
    await run('select', { ids: ['Width'] });
    await panel('entity');
    await shot('Dimensions and labels stay editable: drag the text, change the offset, text alone, size and colour');
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    await run('create_box', { width: 6, height: 3, depth: 4, name: 'House' });
    await run('create_box', { width: 6.6, height: 0.3, depth: 4.6, position: [0, 3, 0], name: 'Roof' });
    await run('create_face', { points: [[-9, 0, 7], [9, 0, 7], [9, 0, -6], [-9, 0, -6]], name: 'Yard' });
    await run('create_box', { width: 1.2, height: 0.05, depth: 6, position: [0, 0, 5], name: 'Path' });
    await run('apply_material', { ids: ['House'], material: 'Red brick' });
    await run('apply_material', { ids: ['Roof'], material: 'Roof tiles' });
    await run('apply_material', { ids: ['Yard'], material: 'Grass' });
    await run('apply_material', { ids: ['Path'], material: 'Gravel' });
    await camera([9, 6, 13], [0, 1.5, 0]);
    await none();
    await panel('materials');
    await shot('Textured materials: brick, roof tiles, grass, gravel… with relief, at real size');
  },
  async 'site-setup'() {
    await fresh();
    await roadScene();
    await camera([60, 70, 110], [0, 0, 10]);
    await none();
    await js("window.mmr.app.ui.setRibbon('Site', 'Survey'); return 1;");
    await shot('Site › Site ribbon: survey, surfaces, design, roads and earthworks, as tabs');
    await js("window.mmr.app.ui.setRibbon('Site', 'Roads'); return 1;");
    await shot('Roads: alignment, corridor, road views, the cut, the profile');
    await js("window.mmr.app.ui.setRibbon('Drawings', '2 Scale'); return 1;");
    await shot('Drawings ribbon: a PDF from bringing it in to the model, step by step');
    await js("window.mmr.app.ui.setRibbon('Site', 'Survey'); return 1;");
    await run('set_geolocation', { latitude: 48.85, longitude: 2.35 });
    await js('window.mmr.app.ui.crsDialog(); return 1;');
    await shot('Coordinate system: the systems used where the project is, with their EPSG codes');
    await clean();
    await js('window.mmr.app.ui.basePointDialog([12.5, 3.1, -4]); return 1;');
    await shot('Base point: click a point you know, type its coordinates and grid north');
    await clean();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    await run('set_style', { grid: true });
  },
  async 'place-on-a-map'() {
    await fresh();
    await run('create_box', { width: 12, height: 9, depth: 8, name: 'Pavilion', color: '#e9e4d8', position: [40, 0, 60] });
    await js("window.mmr.app.pickLocation(); return 1;");
    await wait(800);
    await js("const d = document.querySelector('#modal'); const [la, lo] = d.querySelectorAll('input'); la.value = '48.8582'; lo.value = '2.2945'; la.dispatchEvent(new Event('change')); return 1;");
    await shot('Site › Base point from a map: click where the model origin is; the coordinate system is suggested');
    await js("document.querySelector('#modal footer .btn.primary').click(); return 1;");
    await camera([150, 160, 230], [0, 0, 0]);
    await shot('The map under the model: the origin is where you clicked');
    await run('set_view_overlay', { map: 'imagery', grid: true });
    await camera([30, 420, 60], [30, 0, 30]);
    await shot('Imagery and the grid: Easting and Northing in Lambert-93');
    await js("window.mmr.app.groundMap.open = true; window.mmr.app.groundMap.sync(); return 1;");
    await run('set_view_overlay', { map: 'topo' });
    await camera([-180, 170, 240], [0, 0, 0]);
    await shot('Layers (bottom left): Map, Imagery, Topo, None and the grid');
    await js("window.mmr.app.groundMap.open = false; return 1;");
    await run('set_view_overlay', { map: 'none', grid: false });
  },
  async 'everyday-workflow'() {
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); window.mmr.app.ui.setSideToolbar(true); return 1;");
    await run('create_box', { width: 4, height: 3, depth: 4, name: 'Studio', color: '#e9e4d8' });
    await run('create_box', { width: 1, height: 1, depth: 1, position: [4, 0, 2], name: 'Crate' });
    await run('make_component', { ids: ['Crate'], name: 'Crate' });
    await run('create_cylinder', { radius: 0.6, height: 2.5, position: [-4, 0, 1], name: 'Tank' });
    await run('group', { ids: ['Studio', 'Tank'], name: 'Site buildings' });
    for (let i = 1; i <= 6; i++) await run('add_point', { e: i * 1.5 - 5, n: 6, z: 0 });
    await camera([10, 8, 13], [0, 1, 0]);
    await none();
    await js("window.mmr.app.ui.commandDialog('create_layer', { name: 'C-ROAD/Kerbs' }); return 1;");
    await shot('New layer: a name, a colour, a line type you can see; the rest under More options');
    await clean();
    await js("window.mmr.app.ui.commandDialog('create_corridor', { alignment: 'Main road' }); return 1;");
    await shot('Every form in plain words: the right control for each value, tips, More options folded');
    await clean();
    await panel('outliner');
    await js("window.mmr.app.ui.outline = { by: 'hierarchy', q: '', open: new Set(['Survey points']) }; window.mmr.app.ui.renderDock(); return 1;");
    await shot('The outliner as a tree: folders, search, group by type or layer, drag onto a group');
    const r = await run('place_component', { name: 'Crate' });
    await js(`setTimeout(() => window.mmr.app.tools.place(['${r.id}'])); return 1;`);
    await wait(400);
    const [x, y] = await js("const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(-1, 0, 4)); return [Math.round(s.x), Math.round(s.y)];");
    await req('POST', '/api/input', { events: [{ type: 'mouseMove', x: x - 40, y }, { type: 'mouseMove', x, y }, { type: 'wait', ms: 300 }] });
    await shot('Placing a component: it follows the mouse, lands on faces and the ground, click to drop');
    await req('POST', '/api/input', { events: [{ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }, { type: 'wait', ms: 300 }] });
    await none();
    await js("const b = [...document.querySelectorAll('#menubar button')].find((x) => x.textContent === 'View'); b.click(); const row = [...document.querySelectorAll('#menu-pop .has-sub')].find((x) => x.textContent.includes('Display')); row.dispatchEvent(new MouseEvent('mouseenter')); return 1;");
    await shot('Long menus in groups: View › Display, Style, Sections, Handles…');
    await clean();
    await js("window.mmr.app.ui.setRibbon('Draw and modify', 'Draw'); return 1;");
    await shot('Any menu as a ribbon: Draw and modify, Edit, View, Animate, Site, Drawings');
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
  },
  async 'tie-lines-to-points'() {
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    await run('import_points', { text: ['100,0,0,0,EP', '101,5,10,0.5,EP', '102,0,10,0,GND', '103,5,0,0.4,GND'].join('\n') });
    await run('set_base_point', { e: 0, n: 0, z: 0 });
    await run('set_style', { grid: false }).catch(() => {});
    await camera([5, 18, 8], [5, 0, -2.5]);
    await js("window.mmr.app.tools.set('line'); return 1;");
    const at = (name) => js(`const p = window.mmr.doc.entities.find((e) => e.name === '${name}'); const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...p.position)); return [Math.round(s.x), Math.round(s.y)];`);
    const [a, b] = [await at('100'), await at('101')];
    const down = (x, y) => [{ type: 'mouseMove', x, y }, { type: 'wait', ms: 150 }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }, { type: 'wait', ms: 150 }];
    await req('POST', '/api/input', { events: [{ type: 'mouseMove', x: a[0] + 30, y: a[1] + 30 }, { type: 'wait', ms: 100 }, { type: 'mouseMove', x: a[0] + 4, y: a[1] - 3 }] });
    await shot('Line tool: the cursor snaps to a survey point and names it (point · code)');
    await req('POST', '/api/input', { events: [...down(a[0] + 4, a[1] - 3), ...down(b[0] - 3, b[1] + 4), { type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }] });
    await js("window.mmr.app.tools.set('select'); window.mmr.app.select([window.mmr.doc.entities.find((e) => e.type === 'curve').id]); return 1;");
    await shot('Each end is tied to its point: orange rings on the selected line');
    await run('edit_points', { points: ['101'], e: 7, n: 1.5, z: 1.5 });
    await shot('Point 101 moves (edited or dragged): the line follows');
    await js("window.mmr.app.tools.set('select'); return 1;");
  },
  async 'edit-a-surface-by-hand'() {
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    const pts = [];
    for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) pts.push(`${i}_${j},${j * 5},${i * 5},${(Math.sin(i) + Math.cos(j)).toFixed(2)},GND`);
    await run('import_points', { text: pts.join('\n') });
    await run('set_base_point', { e: 0, n: 0, z: 0 });
    await run('create_surface', { name: 'Existing ground' });
    await camera([12.5, 45, -12.49], [12.5, 0, -12.5]);
    await run('set_camera', { projection: 'parallel' });
    await js("window.mmr.app.select([window.mmr.doc.entities.find((e) => e.name === 'Existing ground').id]); window.mmr.app.tools.set('surfedit'); return 1;");
    await shot('Site › Edit surface: the keys for each edit are in the status bar');
    await run('edit_triangles', { id: 'Existing ground', action: 'delete', at: [7, -8] });
    await run('edit_triangles', { id: 'Existing ground', action: 'swap', a: '2_2', b: '3_3' }).catch(() => run('edit_triangles', { id: 'Existing ground', action: 'swap', a: '2_3', b: '3_2' }));
    await shot('Delete a triangle (D), swap an edge (W), add (A) or leave out (R) a point');
    await run('set_surface_sources', { id: 'Existing ground', voids: [[[14, -14], [21, -14], [21, -21], [14, -21]]] });
    await shot('Draw a hole (H): a pond or a building left out of the surface');
    await run('set_surface_sources', { id: 'Existing ground', outline: [[0, -2], [25, 0], [25, -25], [3, -22]] });
    await shot('Draw the outline (B); "max 30" or "min 0.5" limits the triangle sides');
    await run('surface_breaklines', { id: 'Existing ground', action: 'add', points: [[2, 1.5, -20], [12, 1.5, -12], [22, 1.5, -4]] });
    await camera([12.5, 22, 18], [12.5, 0, -12.5]);
    await run('set_camera', { projection: 'perspective' });
    await shot('Draw a breakline (L): the triangles follow it');
    await camera([12.5, 45, -12.49], [12.5, 0, -12.5]);
    await js("window.mmr.app.tools.set('select'); window.mmr.app.select([window.mmr.doc.entities.find((e) => e.name === 'Existing ground').id]); window.mmr.app.ui.show('entity'); window.mmr.app.tools.set('surfedit'); window.mmr.app.tools.tool.setMode('grips'); return 1;");
    await shot('The Entity panel lists the points, breaklines, outline and holes; G drags their corners');
    await run('set_camera', { projection: 'perspective' });
    await js("window.mmr.app.tools.set('select'); return 1;");
  },
  async 'review-and-layer-a-surface'() {
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    const pts = [];
    let k = 1;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push([k++, (1000 + i * 4 + (j % 2) * 0.7).toFixed(3), (2000 + j * 4 + (i % 3) * 0.5).toFixed(3), (100 + 2 * Math.sin(i / 3) + 1.5 * Math.cos(j / 4)).toFixed(3), 'GND'].join(','));
    for (let i = 0; i <= 8; i++) pts.push([`K${i}`, (1002 + i * 4.5).toFixed(3), '2019.5', (100.5 + i * 0.2).toFixed(3), 'KERB'].join(','));
    await run('import_points', { text: pts.join('\n'), format: 'PNEZD' });
    await run('add_breakline', { points: Array.from({ length: 9 }, (_, i) => `K${i}`), name: 'Kerb line', tag: 'Kerbs' });
    const s = await run('create_surface', { name: 'Existing ground' });
    await run('show_triangles', { ids: [s.id] });
    await camera([20.5, 38, 22], [20.5, -1, -20.3]);
    await js(`window.mmr.app.select(['${s.id}']); window.mmr.app.ui.show('entity'); return 1;`);
    await shot('Show triangles: every edge of the TIN over its shading');
    // the clicks run after this command, so the rebuild it causes does not clear the highlight
    const click = (sel, text) => js(`setTimeout(() => [...document.querySelectorAll('${sel}')].find((x) => x.textContent.includes('${text}'))?.click(), 400); return 1;`);
    const panelTo = () => js("document.querySelector('.surf-members')?.scrollIntoView({ block: 'start' }); return 1;");
    await click('.surf-count', 'Points');
    await wait(600);
    await click('.surf-group-head span', 'KERB');
    await wait(600);
    await panelTo();
    await shot('Points 130, by code: click KERB and its points light up');
    await run('surface_boundary', { id: s.id, action: 'add_void', points: [[8, -14], [17, -11], [22, -20], [14, -27], [7, -22]] });
    await click('.surf-count', 'Voids');
    await wait(600);
    await click('.surf-item', 'Void 1');
    await wait(600);
    await panelTo();
    await shot('A void is cut along the outline you draw, at the ground height');
    await run('offset_surfaces', { surface: s.id, distance: -1.5, count: 2, color: '#b58a57' });
    await camera([62, 8, 12], [20.5, -2.5, -20.3]);
    await js(`window.mmr.app.select(['${s.id}']); return 1;`);
    await shot('Offset… two layers 1.5 m apart under the ground, live');
    await camera([20.5, 38, 22], [20.5, -1, -20.3]);
    await run('move', { ids: [s.id], by: [5, 0, 0] }).catch((e) => js(`window.mmr.app.ui.toast(${JSON.stringify(e.message.replace(/^move: /, ''))}, 'danger'); return 1;`));
    await wait(300);
    await js("document.querySelectorAll('.toast').forEach((t, i, all) => i < all.length - 1 && t.remove()); window.mmr.app.viewport.render(); return 1;");
    await wait(2500);
    const file = path.join(dir, `${String(++n).padStart(2, '0')}.png`);
    fs.writeFileSync(file, await req('GET', '/api/window-screenshot'));
  },
  async 'learn-step-by-step'() {
    await fresh();
    await js("window.mmr.app.ui.setRibbon(null); return 1;");
    for (const id of ['draw-and-edit', 'work-faster', 'multiple-views']) await run('complete_lesson', { id, done: false });
    await run('complete_lesson', { id: 'multiple-views' });
    await camera([8, 10, 12], [0, 0, 0]);
    await js("window.mmr.app.learning.open.add('m2'); window.mmr.app.help.page = null; window.mmr.app.ui.show('help'); return 1;");
    await shot('Help › Learn: five modules of lessons, points and levels');
    await js("window.mmr.app.learning.start('draw-and-edit'); return 1;");
    await shot('Guide me: the next thing to click is highlighted');
    await js("window.mmr.app.tools.set('rectangle'); return 1;");
    await wait(800);
    const ev = await js("const v = window.mmr.app.viewport; const ev = []; for (const p of [[-2, 0, 2], [2, 0, -2]]) { const s = v.toScreen(new window.mmr.THREE.Vector3(...p)); const x = Math.round(s.x), y = Math.round(s.y); ev.push({ type: 'mouseMove', x: x + 2, y }, { type: 'mouseMove', x, y }, { type: 'wait', ms: 100 }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }, { type: 'wait', ms: 600 }); } return ev;");
    await req('POST', '/api/input', { events: ev });
    await wait(800);
    await shot('Each step moves on when you have done it; the lesson earns its points');
    await js('window.mmr.app.learning.stop(); return 1;');
  },
  async 'my-tools-and-skills'() {
    await fresh();
    await camera([6, 5, 9], [2, 0, 2]);
    // the answer comes from the configured model; here a scripted one stands in so the page does not need a model
    await js(`const a = window.mmr.app; a.realChat = a.chat; a.chat = async () => { const t = '1. Draw the path with the **Curve** tool (U): click the points, press Enter [1].\\n2. **Tools › Sweep a profile along a path…** and pick the kerb profile [1].\\n3. Move the curve points later: the kerb follows [1].'; const p = a.settings.ai.provider; return p === 'anthropic' ? { content: [{ type: 'text', text: t }] } : p === 'ollama' ? { message: { role: 'assistant', content: t } } : { choices: [{ message: { role: 'assistant', content: t } }] }; }; await a.help.ask('how do I run a kerb along a curve'); a.chat = a.realChat; return 1;`);
    await shot('Help › Ask Plumb: an answer from the help pages, with its sources');
    const c = await run('create_curve', { points: [[0, 0, 0], [4, 0, 0], [4, 0, 4]], kind: 'spline', name: 'Kerb line' });
    await run('sweep', { path: c.id, profile: 'rectangle', profile_params: { width: 0.15, height: 0.3 }, color: '#b9b2a3', name: 'Kerb' });
    await run('save_tool', { name: 'Kerb return', description: 'A kerb round a corner', steps: [{ command: 'create_curve', args: { points: [[0, 0, 0], [4, 0, 0], [4, 0, 4]], kind: 'spline', name: 'Kerb line' }, made: 'k1' }, { command: 'sweep', args: { path: 'k1', profile: 'rectangle', profile_params: { width: 0.15, height: 0.3 }, color: '#b9b2a3', name: 'Kerb' } }] });
    await run('save_skill', { name: 'Site kerbs', description: 'Kerbs and returns the way our office draws them', prompt: 'Kerbs are 150 mm upstands; returns have a 6 m radius.', toolset: ['create_curve', 'sweep'] });
    await panel('mytools');
    await shot('My tools: run, edit, export or delete what Plumb saved');
    await js("window.mmr.app.ui.runMyTool('kerb_return'); return 1;");
    await shot('Run it with other values');
    await clean();
    // the docs run against a real library: leave nothing behind
    await run('delete_my_tool', { name: 'kerb_return' });
    await run('delete_my_tool', { name: 'site_kerbs' });
  },
  async 'first-steps-with-the-copilot'() {
    await fresh();
    await run('use_ai_model', { provider: 'builtin', model: 'qwen3-4b' });
    await camera([16, 10, 18], [0, 1.5, 0]);
    await js("window.mmr.app.ai.reset(); window.mmr.app.ui.show('ai'); return 1;");
    await shot('First time: one download and Plumb runs its model on your PC');
    // what a turn leaves: the shapes it drafted (here made by the same commands), listed to select or edit
    const b = await run('create_box', { width: 10, height: 3, depth: 6, name: 'Building' });
    await js(`const ai = window.mmr.app.ai; const m = (c, t) => Object.assign(document.createElement('div'), { className: c, textContent: t }); ai.add(m('msg user', 'Draw a 10 m by 6 m rectangle and pull it up 3 m into a building')); ai.add(m('msg assistant', 'Done: a 10 × 6 × 3 m building, Building. Change its sizes in the Entity panel or ask me.')); ai.add(ai.madeList([window.mmr.doc.entities.find((e) => e.id === '${b.id}')])); return 1;`);
    await none();
    await shot('Under the answer: what it made, to select or edit by hand');
    await run('select', { ids: [b.id] });
    await panel('entity');
    await shot('Edit: its parameters; change a number and it rebuilds');
  },
  async 'teach-the-copilot'() {
    await fresh();
    await run('use_ai_model', { provider: 'ollama', base_url: 'http://127.0.0.1:11434', model: 'mistral' });
    await camera([16, 10, 18], [0, 1.5, 0]);
    await js("window.mmr.app.ai.reset(); window.mmr.app.ui.show('ai'); return 1;");
    // a question from the copilot: the same ask_user it calls (not awaited here, the click answers it)
    const msg = (c, t) => `window.mmr.app.ai.add(Object.assign(document.createElement('div'), { className: '${c}', textContent: ${JSON.stringify(t)} }));`;
    await js(`${msg('msg user', 'Add a roof to the building')} window.mmr.app.reg.run('ask_user', { question: 'Which kind of roof?', choices: ['Pitched', 'Hip', 'Flat'] }); return 1;`);
    await shot('The copilot asks when it is not sure: click an answer');
    await js("[...document.querySelectorAll('.ask-card button')].find((b) => b.textContent === 'Hip').click(); return 1;");
    // a form it fills for you
    await js("window.mmr.app.reg.run('show_form', { command: 'create_box', values: { width: 10, height: 3, depth: 6, name: 'Building' } }); return 1;");
    await shot('Or it opens a form with what it knows: adjust it and Run');
    await js("document.querySelector('#modal .btn.primary, #modal button')?.click(); return 1;");
    await wait(800);
    await clean();
    // its answer, rated: the same record the chat keeps for every turn
    await js(`const ai = window.mmr.app.ai; ${msg('msg assistant', 'Done: a 10 × 6 × 3 m building with a hip roof.')} const t = { schema: 1, id: 'tdocs' + Date.now().toString(36), at: new Date().toISOString(), prompt: 'Add a roof to the building', steps: [{ name: 'create_box', args: { width: 10 } }], answer: 'Done.', provider: 'ollama', model: 'mistral', rating: null, comment: '', tags: [], shared: false }; ai.turns.push(t); ai.add(ai.feedbackRow(t)); return 1;`);
    await js("const f = [...document.querySelectorAll('.feedback')].at(-1); f.querySelector('[aria-label=\"Not right\"]').click(); [...f.querySelectorAll('.chip')].find((c) => c.textContent === 'wrong size').click(); f.querySelector('textarea').value = 'The roof overhang should be 600 mm'; return 1;");
    await shot('Not right? Say what should be different: it becomes training data');
    await js("[...document.querySelectorAll('.feedback')].at(-1).querySelector('.fb-more .btn.primary').click(); return 1;");
    await wait(600);
    await js('window.mmr.app.ui.feedbackDialog(); return 1;');
    await shot('AI › Copilot feedback: how it is doing, what goes wrong, export');
    await clean();
  },
  async 'edit-survey-measurements'() {
    await fresh();
    await run('import', { path: path.resolve('tests/fixtures/jxl/kerb-pickup.jxl') });
    await run('set_style', { point_labels: 'name_z' });
    await camera([-6, 14, 30], [7, 0, 5]); // the shots east of S1, looking north-west so the 0.5 m rise shows
    await js("window.mmr.app.ui.show('fieldbook', true); window.mmr.app.ui.fbOpen = new Set(Object.keys(window.mmr.app.store.doc.entities.find((e) => e.survey).survey.setups)); window.mmr.app.ui.renderDock(); return 1;");
    await shot('Import a JobXML job: its setups, rod heights and every shot come with the points');
    await js("[...document.querySelectorAll('#dock-body button')].find((b) => b.textContent.includes('Check the survey')).click(); return 1;");
    await wait(800);
    await shot('Check the survey: one shot at a 2.000 m rod between shots at 1.500 m');
    await js("[...document.querySelectorAll('.fb-findings button')].find((b) => b.textContent.includes('Fix')).click(); return 1;");
    await wait(900);
    await shot('Fix: the rod height is corrected and P3 moves up 0.5 m; the edit keeps its original value');
    await clean();
  },
  async 'replay-a-survey'() {
    await fresh();
    await run('import', { path: path.resolve('tests/fixtures/jxl/kerb-pickup.jxl') });
    await run('set_style', { point_labels: 'name_z' });
    await camera([-10, 9, 26], [6, 1, 4]);
    const s = await run('survey_stats', {});
    await shot(`survey_stats: ${s.points} points, ${s.points_per_hour} an hour, ${s.setups.length} setup, ${s.idle_minutes} idle minutes, ${s.walked} m walked`);
    await run('replay_survey', { mode: 'event', seconds_per_point: 0.8, grow: true });
    await run('playback', { action: 'seek', time: 2.4 });
    await camera([7.5, 2.4, 5], [10, 0.8, 0]);
    await shot('The instrument turned to the shot, down the line of sight, the rod at the height it was measured at');
    await camera([-10, 9, 26], [6, 1, 4]);
    await run('playback', { action: 'seek', time: 5.6 });
    await shot('A dot per measurement on the timeline, a band per setup, and the surface growing behind the crew');
    await camera([-2, 7, 13], [8, 0.8, 3]); // the kerb run across the frame, the instrument and rod both in it
    await run('render_video', { path: path.join(dir, 'replay-a-survey.mp4'), width: 960, height: 540, fps: 24 });
    await clean();
  },
  async 'clip-volumes'() {
    await fresh();
    await roadScene(ROAD);
    // a culvert across the road, under the fill, at the middle of the alignment
    const at = await js("const e = api.doc.entities.find((x) => x.name === 'Main road'); const p = e.curve.points[Math.floor(e.curve.points.length / 2)]; return [p[0] + e.position[0], p[1] + e.position[1], p[2] + e.position[2]];");
    await run('create_cylinder', { radius: 0.9, height: 36, position: [at[0], at[1] - 2.5, at[2] - 18], rotation: [90, 0, 0], name: 'Culvert', color: '#c8553d' });
    await camera([at[0] + 45, at[1] + 30, at[2] + 55], at);
    await none();
    await shot('A road on fill over the ground, a culvert through the fill');
    await run('select', { ids: ['Culvert'] });
    await run('add_clip', { kind: 'box', from: 'selection', margin: 2 });
    await none();
    await camera([at[0] + 22, at[1] + 12, at[2] + 30], [at[0], at[1] - 2, at[2]]);
    await shot('add_clip from the selection: only what is inside the box shows, every cut face filled');
    await run('set_clip', { name: 'Box 1', keep: 'outside' });
    await camera([at[0] + 45, at[1] + 30, at[2] + 55], at);
    await shot('keep: outside: everything but the box');
    await run('set_clip', { name: 'Box 1', keep: 'inside', rotation: [0, 30, 0] });
    await run('add_clip', { kind: 'box', center: [at[0] + 6, at[1] - 1, at[2]], size: [8, 8, 8] });
    await camera([at[0] + 30, at[1] + 22, at[2] + 36], [at[0] + 2, at[1] - 2, at[2]]);
    await shot('Two boxes, one turned 30°: inside either of them shows (clip_combine: any)');
    await run('set_style', { clip_combine: 'all' });
    await shot('clip_combine: all: only where they overlap');
    await run('set_style', { clip_combine: 'any' });
    await run('delete_clip', { name: 'Box 2' });
    await run('set_clip', { name: 'Box 1', rotation: [0, 0, 0] });
    // handles (#291): select the box, push / pull a face
    await js("window.mmr.app.selectClip('Box 1'); return 1;");
    await camera([at[0] + 22, at[1] + 12, at[2] + 30], [at[0], at[1] - 2, at[2]]);
    await shot('Select a clip: a handle on each face, edge and corner; W, E, R move, turn and scale it');
    await run('set_clip', { name: 'Box 1', face: '+y', push: -2.5 });
    await shot('Top face pushed down 2.5 m: the opposite face stays');
    await js("window.mmr.app.selectClip(null); return 1;");
    // a plan slab in pane 2 only
    await run('set_layout', { count: 2, arrangement: 'columns' });
    await run('add_clip', { kind: 'slab', point: at, normal: [0, 1, 0], thickness: 1, panes: [2] });
    await run('set_clip', { name: 'Box 1', enabled: false });
    await run('set_pane', { pane: 2, view: 'top' });
    await run('zoom_extents', { pane: 2 });
    await camera([at[0] + 70, at[1] + 50, at[2] + 90], at);
    await shot('A slab in pane 2 only: a plan cut at road level, the full model in pane 1');
    await run('set_layout', { count: 1 });
    await run('delete_clip', { name: 'Slab 1' });
    await run('set_clip', { name: 'Box 1', enabled: true, face: '+y', push: 2.5 });
    await js('window.mmr.app.ui.sectionPlanesDialog(); return 1;');
    await shot('View › Clipping: every clip, on or off, inside or outside, its fields, delete');
    await clean();
    // a box that grows along the road, in a video
    const b = (await run('list_clips', {})).clips[0];
    await run('animate', { target: 'clip:Box 1', property: 'size', from: b.size, to: [b.size[0] * 6, b.size[1] * 1.6, b.size[2]], start: 0, end: 3 });
    await camera([at[0] + 45, at[1] + 30, at[2] + 55], at);
    await run('render_video', { path: path.join(dir, 'clip-volumes.mp4'), width: 960, height: 540, fps: 24, from: 0, to: 3.5 });
    await clean();
  },
  async 'slice-a-scan'() {
    // the synthetic site of scripts/slice-scan.mjs: two buildings and a road, "Main road" along its centre
    await fresh();
    await run('import_point_cloud', { path: `${SAMPLES}/slice-site.ply` });
    await run('create_alignment', { name: 'Main road', points: [[-60, 25], [60, 15]], station_interval: 20 });
    const iso = () => camera([62, 48, 78], [0, 2, 0]);
    await iso();
    await none();
    await shot('A scan of a site: two buildings and a road');
    await run('add_slice', { at: 'elevation', z: 1.2, above: 'ground', thickness: 0.2 });
    await camera([10, 38, 52], [0, 2, -10]);
    await shot('add_slice at 1.2 m above the ground, 0.2 m thick: the wall ring of each building');
    await run('view_clip', { name: 'Slice 1', pane: 2 });
    await shot('view_clip in pane 2: square from above, north up, fitted to the slice; pane 1 stays 3D');
    await run('slice_points', { name: 'Slice 1', store: true });
    await js("window.mmr.app.ui.sectionPlanesDialog(); return 1;");
    await shot('View › Clipping: add a slice or a series, look at one square-on');
    await clean();
    await run('delete_clip', { name: 'Slice 1' });
    await run('delete', { ids: ['Slice 1 points'] });
    await run('slice_series', { at: 'station', alignment: 'Main road', from: 0, to: 120, step: 20, thickness: 0.6 });
    const v = await run('view_clip', { name: 'Station 0', pane: 2 });
    await run('set_layout', { split: [0.4, 0.5] });
    // zoom pane 2 onto the right half of the road, to the ditch (about 12 m across): stepping keeps that framing
    const c0 = (await run('list_clips')).clips.find((c) => c.name === 'Station 0');
    const u = [c0.normal[2], 0, -c0.normal[0]]; // the slab's right
    const look = v.camera.position.map((x, k) => x - v.camera.target[k]);
    const len = Math.hypot(...look);
    const at = c0.point.map((x, k) => x + u[k] * 4.5 + (k === 1 ? 0.2 : 0));
    await run('set_camera', { pane: 2, target: at, position: look.map((x, k) => at[k] + (x / len) * 14) });
    await run('step_slice', { index: 3 });
    const p60 = (await run('list_clips')).clips.find((c) => c.name === 'Station 60').point;
    await camera([p60[0] - 16, p60[1] + 9, p60[2] + 14], p60);
    await shot('slice_series every 20 m along Main road: a cross-section at station 60: lanes, shoulder, batter and ditch');
    await run('step_slice', { by: 1 });
    await shot('PageDown: station 80, the camera follows along the road');
    await run('add_scene', { name: 'Station 80 section', pane: 2 });
    // a level slab sweeping up through the buildings, in a video
    await run('set_layout', { count: 1 });
    await run('clear_clips');
    await run('add_slice', { at: 'elevation', z: 0.4, above: 'ground', thickness: 0.6, name: 'Sweep' });
    await run('animate_section', { clip: 'Sweep', from: 0, to: 6.5, start: 0, end: 4, ease: 'linear' });
    await iso();
    await clean();
    await run('render_video', { path: path.join(dir, 'slice-a-scan.mp4'), width: 960, height: 540, fps: 24, from: 0, to: 4 });
    await clean();
  },
  async 'detect-planes-and-corners'() {
    // the synthetic corridor scan of tests/fixtures/scan.js (2 M points): two buildings, trees, a retaining wall, kerbs
    await fresh();
    const { makeScan, writeLas, SITE } = await import('../tests/fixtures/scan.js');
    const file = path.join(os.tmpdir(), 'mmr-detect-corridor.las');
    if (!fs.existsSync(file)) fs.writeFileSync(file, writeLas(makeScan({ points: 2000000 })));
    await run('import_point_cloud', { path: file.split(path.sep).join('/'), octree: true, name: 'Corridor scan' });
    for (let i = 0; i < 600 && (await run('point_cloud_job', { id: 'Corridor scan' })).octree !== 'ready'; i++) await wait(500);
    const b = await js('return api.doc.geo.base;');
    const O = SITE.origin;
    const L = (x, n, z = 0) => [O[0] + x - b[0], O[2] + z - b[2], -(O[1] + n - b[1])]; // fixture local → model
    await run('create_alignment', { name: 'Main road', points: [[L(0, 40)[0], L(0, 40)[2]], [L(100, 40)[0], L(100, 40)[2]]], station_interval: 20 });
    await run('set_style', { grid: false });
    const iso = () => camera(L(110, -25, 45), L(50, 45, 2));
    await iso();
    await none();
    await shot('A scan of a road corridor: two buildings, trees, a retaining wall, kerbs along Main road');
    await run('add_clip', { kind: 'box', name: 'Buildings', center: L(44, 58.5, 6), size: [64, 14, 20] });
    await camera(L(70, 18, 30), L(44, 58, 4));
    await shot('add_clip: a box around the buildings, the scope of the detection');
    const p = await run('detect_planes', { within: 'Buildings', min_points: 300 });
    await none();
    await shot(`detect_planes: ${p.count} planes in ${(p.scope.ms / 1000).toFixed(1)} s, walls orange, roofs and ground blue, slopes purple; none in the trees`);
    const c = await run('detect_corners', { within: 'Buildings', planes: p.ids });
    await run('set_tag_visibility', { tag: 'Detected', visible: true });
    await js(`const ids = new Set(${JSON.stringify(p.ids)}); for (const e of api.doc.entities) if (ids.has(e.id)) e.material.opacity = 0.15; window.mmr.app.store.changed(); return 1;`);
    await camera(L(5, 40, 14), L(21, 60, 4));
    await shot(`detect_corners: ${c.count} corner lines, a CORNER point at each foot`);
    // the Line tool from one CORNER point to the next: it snaps to them
    const near = (x, n) => c.corners.find((k) => Math.hypot(k.at[0] - O[0] - x, k.at[1] - O[1] - n) < 0.1).point;
    const pts = [near(15, 55), near(27, 65)]; // across the building, so the line shows
    await js("window.mmr.app.tools.set('line'); return 1;");
    const [qa, qb] = await js(`const v = window.mmr.app.viewport; const V = window.mmr.THREE.Vector3; v.vertexCache = null; return ${JSON.stringify(pts)}.map((n) => v.toScreen(new V(...api.doc.entities.find((e) => e.name === n).position)));`);
    const click = (q) => [{ type: 'mouseMove', x: q.x - 8, y: q.y }, { type: 'wait', ms: 150 }, { type: 'mouseMove', x: q.x + 2, y: q.y + 1 }, { type: 'wait', ms: 250 }, { type: 'mouseDown', x: q.x + 2, y: q.y + 1, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: q.x + 2, y: q.y + 1, button: 'left', clickCount: 1 }, { type: 'wait', ms: 250 }];
    await req('POST', '/api/input', { events: [...click(qa), ...click(qb)] });
    await shot(`The Line tool snaps to ${pts[0]} and ${pts.at(-1)}: a line from corner to corner`);
    await req('POST', '/api/input', { events: [{ type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }] });
    await js("window.mmr.app.tools.set('select'); return 1;");
    const roof = p.planes.find((x) => x.type === 'sloped');
    await run('add_clip', { kind: 'box', name: 'Roof', center: L(66, 57, 9), size: [14, 2, 8] });
    await run('align_clip', { name: 'Roof', to: 'face', id: roof.id, face: 0 });
    await run('delete_clip', { name: 'Buildings' });
    await camera(L(80, 44, 13), L(66, 57, 9.5));
    await shot('align_clip to: face on a detected roof face: the box turns square to the roof');
    await run('delete_clip', { name: 'Roof' });
    const k = await run('detect_edges', { kind: 'kerb', alignment: 'Main road' });
    await camera(L(20, 29, 7), L(30, 40, 1.5));
    await shot(`detect_edges kerb along Main road: ${k.count} lines, kerb tops red, kerb bottoms yellow, every 1 m`);
    const earlier = (await run('get_scene')).entities.filter((x) => x.tag === 'Detected').map((x) => x.id);
    await run('set_properties', { ids: earlier, visible: false });
    await run('add_clip', { kind: 'box', name: 'Buildings', center: L(44, 58.5, 6), size: [64, 14, 20] });
    const e = await run('detect_edges', { kind: 'intersections', within: 'Buildings', propose: true });
    await camera(L(70, 18, 30), L(44, 58, 4));
    await shot(`propose: true: ${e.count} edges (eaves, ridge, wall feet) wait for Accept or Reject`);
    await run('propose', { action: 'reject' });
    await run('set_properties', { ids: earlier, visible: true });
    await clean();
  },
  async 'scan-to-plan'() {
    // the synthetic corridor scan of tests/fixtures/scan.js (2 M points, classified): two buildings, kerbs along Main road
    await fresh();
    const { makeScan, writeLas, SITE } = await import('../tests/fixtures/scan.js');
    const file = path.join(os.tmpdir(), 'mmr-detect-corridor.las');
    if (!fs.existsSync(file)) fs.writeFileSync(file, writeLas(makeScan({ points: 2000000 })));
    await run('import_point_cloud', { path: file.split(path.sep).join('/'), octree: true, name: 'Corridor scan' });
    for (let i = 0; i < 600 && (await run('point_cloud_job', { id: 'Corridor scan' })).octree !== 'ready'; i++) await wait(500);
    const b = await js('return api.doc.geo.base;');
    const O = SITE.origin;
    const L = (x, n, z = 0) => [O[0] + x - b[0], O[2] + z - b[2], -(O[1] + n - b[1])]; // fixture local → model
    await run('create_alignment', { name: 'Main road', points: [[L(0, 40)[0], L(0, 40)[2]], [L(100, 40)[0], L(100, 40)[2]]], station_interval: 20 });
    await run('set_style', { grid: false });
    await camera(L(110, -25, 45), L(50, 45, 2));
    await none();
    await shot('A classified scan of a road corridor: two buildings, trees, kerbs along Main road');
    // slice: a plan cut through the walls, traced into wall lines
    await run('add_slice', { at: 'elevation', z: O[2] + 5, thickness: 0.4, name: 'Plan cut' });
    await camera(L(44, 28, 70), L(44, 59, 2));
    await shot(`add_slice at ${O[2] + 5} m: a 0.4 m plan cut through the walls of both buildings`);
    const t = await run('trace_slice', { name: 'Plan cut', classes: [6], propose: true });
    await run('set_properties', { ids: ['Corridor scan'], visible: false });
    await shot(`trace_slice: ${t.closed} closed wall outlines from ${t.segments} fitted segments, residual under 3 cm; a proposal to accept`);
    await run('propose', { action: 'accept' });
    await run('set_properties', { ids: ['Corridor scan'], visible: true });
    await run('delete_clip', { name: 'Plan cut' });
    // detect: the planes of the buildings, for reference
    await run('add_clip', { kind: 'box', name: 'Buildings', center: L(44, 58.5, 6), size: [64, 14, 20] });
    const p = await run('detect_planes', { within: 'Buildings', min_points: 300 });
    await camera(L(70, 18, 30), L(44, 58, 4));
    await shot(`detect_planes: ${p.count} planes, walls orange, roofs blue and purple`);
    await run('set_tag_visibility', { tag: 'Detected', visible: false });
    await run('set_tag_visibility', { tag: 'Walls', visible: false });
    // footprint: regular, square outlines with their quality, kept as a proposal; then the massing
    const f = await run('extract_footprint', { within: 'Buildings', extrude: true, propose: true });
    await run('set_tag_visibility', { tag: 'Massing', visible: false });
    await run('set_properties', { ids: ['Corridor scan'], visible: false });
    await camera(L(44, 25, 70), L(44, 58.5, 2));
    await shot(`extract_footprint: ${f.footprints.map((x) => `${x.area.toFixed(1)} m², ${x.quality.points} wall points, ${x.quality.guessed} guessed`).join('; ')}`);
    await run('set_tag_visibility', { tag: 'Massing', visible: true });
    await run('set_properties', { ids: ['Corridor scan'], visible: true });
    await run('set_cloud_filter', { classes: { hide: [6] } }); // the scan's buildings out of the way of the blocks
    await camera(L(75, 30, 25), L(44, 58, 3));
    await shot(`extrude: true: a block up to each eave read from the roof (${f.footprints.map((x) => `${x.eave.toFixed(2)} m`).join(', ')})`);
    await run('propose', { action: 'accept' });
    await run('set_cloud_filter', { classes: { show: 'all' } });
    await run('delete_clip', { name: 'Buildings' });
    // kerbs: the lines along the road, as breaklines of the ground made from the scan
    await run('classify_ground', { id: 'Corridor scan', cell: 1 });
    const k = await run('extract_edges', { kind: 'kerb', alignment: 'Main road', as_breaklines: true });
    await run('set_properties', { ids: ['Corridor scan'], visible: false });
    await camera(L(25, 31, 7), L(33, 38, 2));
    await shot(`extract_edges kerb: ${k.count} continuous lines (${k.edges.map((e) => Math.round(e.length)).join(', ')} m) on Kerb top and Kerb bottom, breaklines of the ground`);
    await clean();
  },
  async 'web-map-layers'() {
    await fresh();
    await run('set_coordinate_system', { epsg: 32631, name: 'WGS 84 / UTM zone 31N' });
    await run('set_base_point', { latitude: 52.3676, longitude: 4.9041, z: 0 });
    const eox = 'https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml';
    await js(`window.mmr.app.ui.show('maplayers', true); const u = window.mmr.app.ui.mapUi || (window.mmr.app.ui.mapUi = {}); u.url = ${JSON.stringify(eox)}; window.mmr.app.ui.renderDock(); [...document.querySelectorAll('#dock-body button')].find((b) => b.textContent.includes('Read')).click(); return 1;`);
    await wait(5000);
    await shot('Maps: paste a WMTS, WMS, WFS or OGC API address and Read its layers');
    await run('add_map_layer', { url: eox, layer: 's2cloudless-2024_3857', name: 'Sentinel-2 cloudless 2024', attribution: 'Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)' });
    await run('add_map_layer', { url: 'https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0?request=GetCapabilities&service=WFS&version=2.0.0', layer: 'kadastralekaart:Perceel', name: 'Parcels (Kadaster, PDOK)', style: { stroke: '#ffd43b', width: 2, label: 'perceelnummer' } });
    await camera([0, 900, 300], [0, 0, 0]);
    await wait(9000);
    await shot('Imagery (OGC WMTS) and cadastral parcels (OGC WFS 2.0) under the model, labelled with their numbers');
    await camera([-160, 140, 220], [0, 0, 0]);
    await wait(7000);
    await shot('They stream as you move, in the project coordinate system');
    await clean();
  },
  async 'stream-terrain-and-buildings'() {
    await fresh();
    // the Port Hills above Lyttelton: AWS terrain tiles (Terrarium) with imagery draped on them
    await run('set_coordinate_system', { epsg: 2193, name: 'NZGD2000 / NZTM 2000' });
    await run('set_base_point', { latitude: -43.5935, longitude: 172.6855, z: 0 });
    await camera([-1800, 1400, 2600], [0, 250, 0]);
    await js("window.mmr.app.ui.show('maplayers', true); return 1;");
    await run('add_map_layer', { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', elevation: 'terrarium', max_zoom: 15, name: 'Terrain (AWS)', attribution: 'Terrain: Mapzen, AWS Open Data (LINZ, SRTM)' });
    await run('add_map_layer', { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', name: 'World Imagery (Esri)', attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' });
    await wait(18000);
    await camera([-1800, 1400, 2600], [0, 250, 0]); // repaint: a background window may not have drawn the tiles yet
    await shot('Terrain tiles stream as ground (Terrarium heights), imagery drapes on them');
    await run('elevation_to_surface', { layer: 'Terrain (AWS)', at: [0, 0], radius: 400, spacing: 5, name: 'Port Hills ground' });
    await run('set_map_layer', { layer: 'World Imagery (Esri)', visible: false });
    await run('set_map_layer', { layer: 'Terrain (AWS)', visible: false });
    await camera([-700, 650, 900], [0, 250, 0]);
    await shot('Save as surface: 800 × 800 m of heights every 5 m, an editable surface in the model');
    // central Amsterdam: the AHN DTM (OGC WCS 2.0), imagery, and 3D BAG footprints standing on their ground and roof heights
    await fresh();
    await run('set_coordinate_system', { epsg: 32631, name: 'WGS 84 / UTM zone 31N' });
    await run('set_base_point', { latitude: 52.3727, longitude: 4.8937, z: 0 });
    await camera([-220, 170, 260], [0, 0, 0]);
    await js("window.mmr.app.ui.show('maplayers', true); return 1;");
    await run('add_map_layer', { url: 'https://service.pdok.nl/rws/ahn/wcs/v1_0?SERVICE=WCS&REQUEST=GetCapabilities&VERSION=2.0.1', layer: 'dtm_05m', name: 'AHN DTM 0.5 m', attribution: 'AHN: Rijkswaterstaat, PDOK' });
    await run('add_map_layer', { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', name: 'World Imagery (Esri)', attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' });
    await run('add_map_layer', { url: 'https://data.3dbag.nl/api/BAG3D/wfs?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=2.0.0', layer: 'BAG3D:lod12', name: 'Buildings (3D BAG)', attribution: '3D BAG by tudelft3d and 3DGI', style: { stroke: '#6b5d4f', fill: '#e9e2d0', extrude: { base: 'b3_h_maaiveld', top: 'b3_h_70p' } } });
    await wait(45000);
    await shot('Buildings from a WFS stand on the DTM (OGC WCS 2.0) from their ground and roof heights');
    await clean();
  },
  async spacemouse() {
    // no device needed: reports go in through window.mmr.spacemouse.feed, as the device would send them
    const feed = (id, bytes) => js(`window.mmr.spacemouse.feed(${id}, ${JSON.stringify(bytes)}); return 1;`);
    const axes = (...v) => [...new Uint8Array(new Int16Array(v).buffer)];
    await fresh();
    await roadScene(ROAD);
    await run('set_spacemouse', { mode: 'object', pivot: 'view', speed: 1 });
    await camera([60, 55, 90], [0, 0, 0]);
    await panel('settings');
    await js("document.querySelector('#sm-pressed')?.scrollIntoView({ block: 'center' }); return 1;");
    await feed(3, [2, 0, 0, 0]);
    await feed(3, [0, 0, 0, 0]);
    await shot('Settings › SpaceMouse: press a button, see what it does (Fit → zoom extents)');
    await panel('ai');
    await camera([60, 55, 90], [0, 0, 0]);
    await feed(1, axes(0, 0, 0, 0, 0, -260)); // twist: the model turns about the view centre
    await wait(900);
    await shot('Object mode: twist the cap, the site turns around the pivot (the dot)', { moving: true });
    await feed(1, axes(0, 0, 0, 0, 0, 0));
    await run('set_spacemouse', { mode: 'walk' });
    await camera([-100, 4, 75], [-20, 2, 10]);
    await feed(1, axes(0, -220, 0, 0, 0, 0)); // push forward: walk along, the ground followed
    await wait(1200);
    await feed(1, axes(0, 0, 0, 0, 0, 0));
    await shot('Walk mode: push forward, the eye stays 1.6 m over the ground');
    await run('set_spacemouse', { mode: 'object' });
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
