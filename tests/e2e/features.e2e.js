// The features that need the real renderer (viewport picking, UI panels, proposals, video), driven through
// window.mmr in the running app. No sign-in: MMR_TEST with an empty suite URL leaves the app unconfigured.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';
import { _electron } from 'playwright';

let app;
let w;
let home;
const run = (name, args = {}) => w.evaluate(([n, a]) => window.mmr.runSafe(n, a), [name, args]);
const ok = async (name, args) => {
  const r = await run(name, args);
  assert.ok(r.ok, `${name}: ${r.error}`);
  return r.result;
};

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-e2e-'));
  app = await _electron.launch({ executablePath: electronPath, args: ['.'], env: { ...process.env, MMR_TEST: '1', MMR_SUITE_URL: '', MMR_HOME: home } });
  w = await app.firstWindow();
  await w.locator('#viewport').waitFor();
  await w.waitForFunction(() => window.mmr?.app?.tools);
});
after(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  fs.rmSync(home, { recursive: true, force: true });
});

test('placement, what_is_at and the metadata card in the real app', async () => {
  await ok('create_box', { width: 2, height: 1, depth: 2, name: 'Table' });
  await ok('create_sphere', { radius: 0.3, position: [4, 0, 4], name: 'Ball' });
  const [ball] = await ok('place_on', { ids: ['Ball'], target: 'Table' });
  assert.equal(ball.min[1], 1);
  await ok('set_camera', { position: [0, 10, 0.001], target: [0, 0, 0] });
  const hit = await ok('what_is_at', { x: 0.5, y: 0.5 });
  assert.equal(hit.name, 'Ball');
  await ok('set_metadata', { ids: ['Table'], values: { role: 'furniture' } });
  await ok('select', { ids: ['Table'] });
  await w.click('[data-tab="entity"]');
  assert.equal(await w.locator('.meta-row input[aria-label="role"]').inputValue(), 'furniture');
});

test('proposals: the bar shows what changed; Reject in the UI restores the model', async () => {
  await ok('propose', { action: 'start' });
  await ok('create_box', { width: 1, height: 1, depth: 1, position: [5, 0, 0], name: 'Extra' });
  await ok('delete', { ids: ['Ball'] });
  const bar = w.locator('#proposal-bar');
  await bar.getByText('1 new, 1 removed').waitFor();
  await bar.getByRole('button', { name: 'Reject' }).click();
  assert.equal(await bar.isHidden(), true);
  const names = (await ok('get_scene')).entities.map((e) => e.name).sort();
  assert.deepEqual(names, ['Ball', 'Table']);
});

test('every command is in the palette; one with parameters opens its form', async () => {
  await w.keyboard.press('Control+K');
  await w.fill('#palette-input', 'place_on');
  await w.keyboard.press('Enter');
  const form = w.locator('#modal');
  await form.getByText('Place on').first().waitFor();
  await form.locator('input[aria-label="Which ones"]').fill('Ball');
  await form.locator('input[aria-label="Target"]').fill('Table');
  await form.getByRole('button', { name: 'Run' }).click();
  const ball = (await ok('get_entity', { id: 'Ball' })).min;
  assert.equal(ball[1], 1);
});

test('parametric: sweep from the Library, edit a parameter in the Entity panel, the macro pill', async () => {
  await ok('create_curve', { points: [[0, 0, 5], [3, 0, 6], [6, 0, 5]], kind: 'spline', name: 'Path' });
  await ok('select', { ids: ['Path'] });
  await w.click('[data-tab="library"]');
  await w.locator('button.profile', { hasText: /^pipe$/ }).click();
  const sweep = (await ok('get_scene')).entities.find((e) => e.generator === 'sweep');
  assert.ok(sweep, 'a sweep was made');
  await ok('create_box', { width: 1, height: 1, depth: 1, name: 'Param box', position: [8, 0, 0] });
  await w.click('[data-tab="entity"]');
  const width = w.locator('.param-row', { hasText: 'width' }).locator('input');
  await width.fill('2.5');
  await width.press('Enter');
  await width.blur();
  await w.waitForFunction(() => window.mmr.doc.entities.find((e) => e.name === 'Param box').derived.params.width === 2.5);
  await ok('record_macro', { name: 'Test macro' });
  await ok('create_sphere', { radius: 0.2, position: [9, 0, 3] });
  await w.locator('#macro-pill').getByText('1 steps').waitFor();
  await w.click('#macro-pill');
  await w.locator('#macro-pill').waitFor({ state: 'detached' });
  assert.equal((await ok('list_recipes', { name: 'Test macro' })).steps.length, 1);
});

test('render_video: frame by frame to MP4 (H.264 or VP9) and GIF, captions burned in, the view restored', async () => {
  await ok('new_model');
  await ok('create_box', { width: 1, height: 1, depth: 1, name: 'Mover' });
  await ok('animate', { target: 'Mover', property: 'position', by: [3, 0, 0], start: 0, end: 1 });
  await ok('add_caption', { text: 'Hello', start: 0, end: 1, style: 'title' });
  await ok('add_motion', { target: 'Mover', type: 'spin' });
  await ok('set_timeline', { duration: 1, fps: 12 });
  const size = await w.evaluate(() => [window.mmr.app.viewport.canvas.width, window.mmr.app.viewport.canvas.height]);
  const mp4 = path.join(home, 'out', 'reel.mp4');
  const r = await ok('render_video', { path: mp4, width: 320, height: 180 });
  assert.equal(r.frames, 12);
  assert.ok(['avc', 'vp9'].includes(r.codec));
  const head = fs.readFileSync(mp4);
  assert.equal(head.subarray(4, 8).toString(), 'ftyp');
  const gif = await ok('render_video', { path: path.join(home, 'out', 'reel.gif'), width: 160, height: 90, fps: 6 });
  assert.equal(gif.frames, 6);
  assert.equal(fs.readFileSync(path.join(home, 'out', 'reel.gif')).subarray(0, 6).toString(), 'GIF89a');
  assert.deepEqual(await w.evaluate(() => [window.mmr.app.viewport.canvas.width, window.mmr.app.viewport.canvas.height]), size);
  const r2 = await run('render_video', { path: path.join(home, 'out', 'x.mp4'), transparent: true });
  assert.match(r2.error, /MP4 has no transparency/);
});

test('the copilot end to end (stubbed provider): routed tools, a proposal to accept, a skill, the vision review', async () => {
  await ok('new_model');
  // The provider is stubbed in the main process: a scripted local model that calls two tools, then answers.
  await app.evaluate(({ ipcMain }) => {
    const script = [
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_box', arguments: { width: 2, height: 1, depth: 1, name: 'AI box' } } }] },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_sphere', arguments: '{"radius": "0.3", "name": "AI ball"}' } }] },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'place_on', arguments: { ids: ['AI ball'], target: 'AI box' } } }] },
      { role: 'assistant', content: 'Done: a box with a ball on it.' },
    ];
    globalThis.requests = [];
    ipcMain.removeHandler('ai:chat');
    ipcMain.handle('ai:chat', (_, body) => {
      globalThis.requests.push(body);
      if (body.messages.some((m) => m.images)) return { provider: 'ollama', data: { message: { role: 'assistant', content: '- AI ball sits on AI box: good.' } } };
      return { provider: 'ollama', data: { message: script.shift() } };
    });
  });
  await ok('use_skill', { name: 'furniture' });
  await w.click('[data-tab="ai"]');
  await w.evaluate(() => window.mmr.app.ai.setPropose(true));
  await w.fill('.chat-input textarea', 'Put a ball on a box');
  await w.keyboard.press('Enter');
  await w.locator('.msg.assistant', { hasText: 'Done: a box with a ball on it.' }).waitFor();
  const reqs = await app.evaluate(() => globalThis.requests);
  assert.ok(reqs[0].tools.length <= 18, 'a small model gets a routed tool list');
  assert.ok(reqs[0].messages[0].content.includes('Domain: furniture'), 'the skill is in the system prompt');
  const bar = w.locator('#proposal-bar');
  await bar.getByText('2 new').waitFor();
  await bar.getByRole('button', { name: 'Accept' }).click();
  const ball = await ok('get_entity', { id: 'AI ball' });
  assert.equal(ball.min[1], 1);
  assert.equal(await w.evaluate(() => window.mmr.app.store.undoStack.length > 0), true);
  await w.evaluate(() => window.mmr.app.ai.setPropose(false));
  const review = await ok('review_model', { include_images: true });
  assert.equal(review.images.length, 4);
  assert.match(review.critique, /sits on AI box/);
});

test('modelling depth with the mouse: a rectangle drawn on a face imprints it, the Arc tool draws an arc; components share geometry', async () => {
  await ok('new_model');
  await ok('create_box', { width: 3, height: 0.4, depth: 3, name: 'Slab' });
  await ok('set_camera', { position: [3.5, 5, 4.5], target: [0, 0.4, 0] });
  const screen = (x, y, z) => w.evaluate(([px, py, pz]) => {
    const v = window.mmr.app.viewport;
    const p = v.toScreen(new window.mmr.THREE.Vector3(px, py, pz));
    return [p.x, p.y];
  }, [x, y, z]);
  await w.locator('#viewport').click({ position: { x: 5, y: 5 } });
  await w.keyboard.press('r');
  for (const [x, z] of [[-0.6, -0.6], [0.6, 0.6]]) {
    const [sx, sy] = await screen(x, 0.4, z);
    await w.mouse.move(sx, sy);
    await w.mouse.down();
    await w.mouse.up();
  }
  const slab = await ok('get_entity', { id: 'Slab' });
  assert.equal((await ok('get_scene')).entities.length, 1, 'imprinted into the slab, not a new face entity');
  const inner = slab.faces.at(-1);
  assert.ok(inner.area > 1 && inner.area < 2, `imprinted face area ${inner.area}`);
  await ok('push_pull', { id: 'Slab', face: inner.index, distance: -0.4 });
  assert.ok((await ok('get_entity', { id: 'Slab' })).volume < 3.6 - 0.4);
  await w.keyboard.press('a');
  for (const [x, z] of [[2, 0.8], [2, -1.6], [2.8, -0.4]]) {
    const [sx, sy] = await screen(x, 0, z);
    await w.mouse.move(sx, sy);
    await w.mouse.down();
    await w.mouse.up();
  }
  const arc = (await ok('get_scene')).entities.find((e) => e.type === 'curve');
  assert.ok(arc && arc.points > 8, 'an arc was drawn');
  await w.keyboard.press('Escape');
  await w.keyboard.press(' ');
  await ok('create_box', { width: 1, height: 1, depth: 0.1, name: 'Pane', position: [6, 0, 0] });
  const g = await ok('make_component', { ids: ['Pane'], name: 'Pane set' });
  const copy = (await ok('duplicate', { ids: [g.id], offset: [1.5, 0, 0] })).created[0];
  const shared = await w.evaluate(([a, b]) => {
    const v = window.mmr.app.viewport;
    const doc = window.mmr.doc;
    const part = (id) => doc.entities.find((e) => e.parent === id).id;
    return v.objs.get(part(a)).geometry === v.objs.get(part(b)).geometry;
  }, [g.id, copy]);
  assert.equal(shared, true, 'instances share one GPU geometry');
});

test('survey: click a point in the cloud, edit an elevation in the Survey table, the surface and the cut/fill map follow', async () => {
  await ok('new_model');
  const rows = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) rows.push(`P${i}${j},${5400000 + i * 10},${650000 + j * 10},${100 + i},GND`);
  await ok('import_points', { text: rows.join('\n') });
  const s = await ok('create_surface', { name: 'EG' });
  await ok('set_view', { preset: 'top' });
  const [sx, sy] = await w.evaluate(() => {
    const p = window.mmr.doc.entities.find((e) => e.name === 'P21');
    const q = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...p.position));
    return [q.x, q.y];
  });
  await w.keyboard.press(' ');
  await w.mouse.click(sx, sy);
  assert.equal(await w.evaluate(() => window.mmr.app.entity(window.mmr.app.selection[0])?.name), 'P21', 'the point wins over the surface under it');
  await w.click('[data-tab="survey"]');
  const cell = w.locator('input.cell[aria-label="Elevation of P21"]');
  await cell.fill('110');
  await cell.press('Enter');
  await cell.blur();
  await w.waitForFunction(() => window.mmr.doc.entities.find((e) => e.name === 'P21').point.z === 110);
  assert.ok((await ok('get_entity', { id: s.id })).max[1] > 9, 'the surface rose with the point');
  const cf = await ok('cut_fill', { existing: 'EG', elevation: 101 });
  assert.ok(await w.evaluate((id) => !!window.mmr.app.viewport.objs.get(id).geometry.attributes.color, cf.map), 'the map is coloured per face');
  assert.ok(await w.evaluate(() => document.getElementById('label-layer').width > 0));
});

test('drawings: a PDF sheet on screen, calibrated and georeferenced with the mouse, extracted, trimmed; a locked layer', async () => {
  const { makePdf } = await import('../fixtures/make-pdf.js');
  const file = path.join(home, 'plan.pdf');
  // a 100-point line on the Kerbs layer, a crossing line, a label
  fs.writeFileSync(file, makePdf({ layers: ['Kerbs'], content: '/OC /oc1 BDC 1 0 0 RG 1 w 100 500 m 200 500 l S 150 450 m 150 550 l S EMC BT /F1 10 Tf 100 520 Td (101.25) Tj ET' }));
  await ok('new_model');
  const r = await ok('import_pdf', { path: file, scale: '1:100' });
  const id = r.underlays[0].id;
  await ok('set_view', { preset: 'top' });
  await ok('zoom_extents', {});
  await w.waitForFunction((i) => window.mmr.app.viewport.objs.get(i)?.material.map?.image?.width > 100, id, { timeout: 30000 });
  // calibrate: click the two ends of the kerb line on the sheet, type its real length
  const world = (u, v) => w.evaluate(([i, a, b]) => {
    const e = window.mmr.doc.entities.find((x) => x.id === i);
    const [A, B, C, D, E, F] = e.underlay.affine;
    return [A * a + B * b + C, 0, -(D * a + E * b + F)];
  }, [id, u, v]);
  const screen = (p) => w.evaluate((q) => {
    const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...q));
    return [s.x, s.y];
  }, p);
  const click = async (p) => {
    const [sx, sy] = await screen(p);
    await w.mouse.move(sx, sy);
    await w.mouse.down();
    await w.mouse.up();
  };
  await w.locator('#viewport').click({ position: { x: 5, y: 5 } });
  await w.keyboard.press('i');
  await click(await world(100, 342)); // page v is measured from the top: 842 − 500
  await click(await world(200, 342));
  await w.fill('#vcb', '50');
  await w.press('#vcb', 'Enter');
  await w.waitForFunction((i) => Math.abs(Math.hypot(...window.mmr.doc.entities.find((x) => x.id === i).underlay.affine.slice(0, 1), window.mmr.doc.entities.find((x) => x.id === i).underlay.affine[3]) - 0.5) < 0.01, id);
  // a control point: click the line's start, type where it really is
  await w.keyboard.press('j');
  await click(await world(100, 342));
  await w.fill('#vcb', '5400000, 650000');
  await w.press('#vcb', 'Enter');
  await w.waitForFunction((i) => window.mmr.doc.entities.find((x) => x.id === i).underlay.control.length === 1, id);
  const start = await world(100, 342);
  assert.ok(Math.hypot(start[0], start[2]) < 0.05, `the first control point moved the sheet onto the base point: ${start}`);
  const ex = await ok('extract_linework', { id, layers: ['Kerbs'] });
  assert.equal(ex.curves, 2);
  // trim: click the right half of the kerb, the crossing line cuts it
  await ok('zoom_extents', {});
  await w.keyboard.press('w');
  await click(await world(185, 342));
  const kerb = (await ok('get_scene')).entities.filter((e) => e.type === 'curve').map((e) => e.length).sort((a, b) => a - b);
  assert.ok(Math.abs(kerb[0] - 25) < 0.2, `trimmed to the crossing: ${kerb}`);
  // the layer panel: lock the kerbs, the select tool skips them
  await w.keyboard.press('Escape');
  await w.keyboard.press(' ');
  await w.click('[data-tab="outliner"]');
  await w.getByRole('button', { name: 'Lock PDF Kerbs' }).click();
  assert.equal((await ok('list_layers', { name: 'PDF Kerbs' }))[0].locked, true);
  await ok('select', { mode: 'none' });
  const vp = await w.locator('#viewport').boundingBox();
  await w.mouse.move(vp.x + 30, vp.y + 30);
  await w.mouse.down();
  await w.mouse.move(vp.x + vp.width - 30, vp.y + vp.height - 30, { steps: 4 });
  await w.mouse.up();
  const picked = await w.evaluate(() => window.mmr.app.selection.map((i) => window.mmr.doc.entities.find((e) => e.id === i).tag));
  assert.ok(picked.length && !picked.includes('PDF Kerbs'), `box select skips the locked layer: ${picked}`);
});

test('formats: DXF in, attribute typed in the layer table, IFC out and back in the renderer (web-ifc in the browser)', async () => {
  const { DXF_MM } = await import('../fixtures/formats.js');
  const dxf = path.join(home, 'plan.dxf');
  fs.writeFileSync(dxf, DXF_MM);
  await ok('new_model');
  const r = await ok('import', { path: dxf });
  assert.equal(r.created.instances, 2);
  await ok('create_layer', { name: 'Trees', schema: { species: { type: 'string' } } });
  await ok('create_cylinder', { radius: 0.3, height: 4, name: 'Oak', tag: 'Trees' });
  // the attribute table of the Trees layer: type the species
  await w.click('[data-tab="outliner"]');
  await w.getByRole('button', { name: 'Attribute table of Trees' }).click();
  const cell = w.locator('dialog[open] input[aria-label="species of Oak"]');
  await cell.fill('quercus');
  await cell.press('Tab');
  await w.waitForFunction(() => window.mmr.doc.entities.find((e) => e.name === 'Oak').meta?.species === 'quercus');
  await w.keyboard.press('Escape');
  // IFC out, and back into an empty model
  const ifc = path.join(home, 'out.ifc');
  await ok('export', { format: 'ifc', path: ifc });
  assert.match(fs.readFileSync(ifc, 'utf8'), /IFCBUILDINGSTOREY/);
  await ok('new_model');
  const back = await ok('import', { path: ifc });
  assert.ok(back.created.elements >= 3, `IFC elements read back: ${JSON.stringify(back.created)}`);
  const q = await ok('query_features', { layer: 'Trees' });
  assert.equal(q.features[0].attributes['Pset_MyModellerReel.species'], 'quercus');
  assert.ok(await w.evaluate(() => window.mmr.app.viewport.objs.size > 3));
});

test('terrain depth: sculpt with the brush tool, a profile chart, contours with a legend', async () => {
  await ok('new_model');
  await ok('create_terrain', { width: 40, depth: 40, spacing: 1, elevation: 0, name: 'Ground' });
  await ok('set_view', { preset: 'iso' });
  await ok('zoom_extents', {});
  const [sx, sy] = await w.evaluate(() => {
    const p = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(0, 0, 0));
    return [p.x, p.y];
  });
  await w.locator('#viewport').click({ position: { x: 5, y: 5 } });
  await w.keyboard.press('v');
  await w.fill('#vcb', 'raise 6 1');
  await w.press('#vcb', 'Enter');
  await w.mouse.move(sx, sy);
  await w.mouse.down();
  await w.mouse.up();
  await w.waitForFunction(() => Math.max(...window.mmr.doc.entities.find((e) => e.name === 'Ground').mesh.v.map((p) => p[1])) > 0.9);
  await w.keyboard.press('Escape');
  await w.keyboard.press(' ');
  await ok('create_curve', { points: [[-15, 0, 0], [15, 0, 0]], name: 'Cut line' });
  await ok('select', { ids: ['Cut line'] });
  await w.evaluate(() => window.mmr.app.ui.actions.profile.run());
  await w.locator('dialog[open] svg path').first().waitFor();
  assert.match(await w.locator('dialog[open] h3').textContent(), /Profile · 30\.0 m/);
  await w.keyboard.press('Escape');
  await ok('surface_contours', { id: 'Ground', interval: 0.25, major_every: 2 });
  await ok('analyze_surface', { id: 'Ground', kind: 'elevation', bands: 4 });
  await ok('select', { ids: ['Ground'] });
  await w.click('[data-tab="entity"]');
  assert.equal(await w.locator('.legend-row').count(), 4);
});

test('annotate and document: the Dimension tool, text, section caps and a PDF sheet', async () => {
  await ok('new_model');
  await ok('create_box', { width: 4, height: 2, depth: 2, name: 'Block' });
  await ok('create_text', { text: 'MMR', size: 0.5, depth: 0.1, position: [0, 0, 2] });
  await ok('set_camera', { position: [0, 3, 9], target: [0, 1, 0] });
  const [a, b] = await w.evaluate(() => [[-2, 1, 1], [2, 1, 1]].map((p) => {
    const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...p));
    return [s.x, s.y];
  }));
  await w.locator('#viewport').click({ position: { x: 5, y: 5 } });
  await w.keyboard.press('d');
  await w.mouse.click(...a);
  await w.mouse.click(...b);
  await w.waitForFunction(() => window.mmr.doc.entities.some((e) => e.annotation?.type === 'dimension'));
  const dim = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.annotation).annotation);
  assert.ok(Math.abs(dim.value - 4) < 0.05, `dimension ${dim.value}`);
  await w.keyboard.press('Escape');
  await ok('section', { normal: [0, 1, 0], point: [0, 1, 0] });
  assert.ok(await w.evaluate(() => window.mmr.app.viewport.modelRoot.children.some((o) => o.userData.caps && o.children.length)));
  await ok('section', { enabled: false });
  const pdf = path.join(home, 'sheet.pdf');
  const r = await ok('export_drawing', { path: pdf, views: ['top', 'front'], sheet: 'A4' });
  assert.equal(r.views.length, 2);
  assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
});

test('looks: styles, lights, effects, parallel projection, a path-traced still, a sun study frame', async () => {
  await ok('new_model');
  await ok('create_box', { width: 2, height: 2, depth: 2, name: 'Cube' });
  await ok('set_style', { render_style: 'hidden_line' });
  assert.equal(await w.evaluate(() => window.mmr.app.viewport.objs.get(window.mmr.doc.entities[0].id).material.type), 'MeshBasicMaterial');
  await ok('set_style', { render_style: 'shaded' });
  await ok('create_light', { kind: 'spot', position: [2, 3, 2], target: [0, 0, 0] });
  assert.ok(await w.evaluate(() => { let n = 0; window.mmr.app.viewport.modelRoot.traverse((o) => o.isSpotLight && n++); return n; }) === 1);
  await ok('set_effects', { ao: 0.5, bloom: 0.3 });
  await w.evaluate(() => window.mmr.app.viewport.render());
  assert.ok(await w.evaluate(() => !!window.mmr.app.viewport.look.composer));
  await ok('set_effects', { ao: 0, bloom: 0 });
  await ok('set_camera', { projection: 'parallel' });
  await w.evaluate(() => window.mmr.app.viewport.render());
  assert.ok(await w.evaluate(() => window.mmr.app.viewport.camera.isOrthographicCamera));
  await ok('set_camera', { projection: 'perspective', lens: 50 });
  await w.evaluate(() => window.mmr.app.viewport.render());
  assert.ok(Math.abs((await w.evaluate(() => window.mmr.app.viewport.camera.fov)) - 26.99) < 0.01);
  const png = path.join(home, 'still.png');
  const r = await ok('render_image', { path: png, width: 320, height: 180, samples: 4 });
  assert.ok(r.samples >= 4);
  assert.equal(fs.readFileSync(png).subarray(1, 4).toString(), 'PNG');
  await ok('set_geolocation', { latitude: 48.85, longitude: 2.35, utc_offset: 2 });
  await ok('animate_sun', { date: '2026-06-21', from: '06:00', to: '22:00', start: 0, end: 4 });
  await w.evaluate(() => window.mmr.app.timeline.seek(4));
  assert.ok(await w.evaluate(() => window.mmr.app.viewport.sun.intensity) < 0.5, 'late evening: a weak sun');
});

test('animation depth: dope sheet in the timeline, the curve editor, shots row, audio in a render', async () => {
  await ok('new_model');
  await ok('create_box', { width: 1, height: 1, depth: 1, name: 'A' });
  await ok('create_box', { width: 1, height: 1, depth: 1, name: 'B', position: [3, 0, 0] });
  await ok('animate', { target: 'A', property: 'position', from: [0, 0, 0], to: [0, 2, 0], start: 1, end: 2 });
  await ok('animate', { target: 'B', property: 'position', from: [3, 0, 0], to: [3, 2, 0], start: 1, end: 2 });
  await ok('add_shot', { name: 'Wide', start: 0, end: 4, position: [8, 5, 8], target: [0, 0, 0] });
  await w.evaluate(() => window.mmr.app.timeline.open());
  await w.locator('.span-bar.shot').first().waitFor();
  const keys = w.locator('.tl-lanes .kf');
  assert.equal(await keys.count(), 4);
  // shift-click two keys at 2 s, then drag them together by about a second
  await keys.nth(1).click({ modifiers: ['Shift'] });
  await keys.nth(3).click({ modifiers: ['Shift'] });
  assert.equal(await w.evaluate(() => window.mmr.app.timeline.selKeys.size), 2);
  const box = await keys.nth(1).boundingBox();
  const px = await w.evaluate(() => window.mmr.app.timeline.x(3) - window.mmr.app.timeline.x(2));
  await w.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await w.mouse.down();
  await w.mouse.move(box.x + box.width / 2 + px / 2, box.y + box.height / 2, { steps: 4 });
  await w.mouse.move(box.x + box.width / 2 + px, box.y + box.height / 2, { steps: 4 });
  await w.mouse.up();
  const ends = await w.evaluate(() => window.mmr.doc.animation.tracks.map((t) => t.keys.at(-1).t));
  assert.ok(ends.every((t) => Math.abs(t - 3) < 0.1), `moved together: ${ends}`);
  // copy them and paste at 5 s
  await w.keyboard.press('Control+c');
  await w.evaluate(() => window.mmr.app.timeline.seek(5));
  await w.keyboard.press('Control+v');
  assert.ok(await w.evaluate(() => window.mmr.doc.animation.tracks.every((t) => t.keys.some((k) => Math.abs(k.t - 5) < 0.05))));
  // the curve editor on one key
  await w.evaluate(() => {
    const tl = window.mmr.app.timeline;
    const tr = window.mmr.doc.animation.tracks[0];
    tl.selKey = { track: tr, t: tr.keys[1].t };
    tl.curveDialog();
  });
  await w.locator('dialog[open] .curve-editor').waitFor();
  await w.locator('dialog[open] button', { hasText: 'Overshoot' }).click();
  await w.locator('dialog[open] button', { hasText: 'Apply' }).click();
  await w.waitForFunction(() => window.mmr.doc.animation.tracks[0].keys[1].bezier?.[1] === 1.4);
  // a WebM render with a generated tone mixed in
  const wav = path.join(home, 'tone.wav');
  const rate = 8000;
  const n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2);
  fs.writeFileSync(wav, buf);
  await ok('add_audio', { path: wav, start: 0.5 });
  const out = path.join(home, 'with-audio.webm');
  await ok('render_video', { path: out, width: 320, height: 180, fps: 10, to: 2 });
  const bytes = fs.readFileSync(out);
  assert.ok(bytes.includes(Buffer.from('A_OPUS')), 'an Opus audio track');
});

test('power tools: the 3-point rectangle tool, the component library, the image-model channel', async () => {
  await ok('new_model');
  await ok('set_camera', { position: [0, 12, 0.01], target: [0, 0, 0] });
  const pts = await w.evaluate(() => [[0, 0, 0], [3, 0, -1], [1, 0, 2]].map((p) => {
    const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...p));
    return [s.x, s.y];
  }));
  await w.locator('#viewport').click({ position: { x: 5, y: 5 } });
  await w.keyboard.press('f');
  for (const p of pts) await w.mouse.click(...p);
  await w.waitForFunction(() => window.mmr.doc.entities.some((e) => e.name === 'Rectangle'));
  const area = await w.evaluate(() => {
    const e = window.mmr.doc.entities.find((x) => x.name === 'Rectangle');
    const [a, b, , d] = e.mesh.f[0].map((i) => e.mesh.v[i]);
    const u = [b[0] - a[0], b[2] - a[2]];
    const v = [d[0] - a[0], d[2] - a[2]];
    return Math.abs(u[0] * v[1] - u[1] * v[0]);
  });
  assert.ok(area > 6 && area < 8, `rotated rectangle area ${area}`);
  await w.keyboard.press('Escape');
  const list = await ok('list_assets');
  assert.ok(list.some((f) => f.name === 'Tree.glb'), 'the starter models are in the library');
  const t = await ok('insert_asset', { name: 'Tree.glb', position: [5, 0, 5] });
  assert.deepEqual(t.position, [5, 0, 5]);
  const r = await run('ai_render', { prompt: 'test' });
  assert.ok(!r.ok && !/Unknown channel/.test(r.error), `reaches the main process: ${r.error}`);
});

test('interop and scale: a scan and its ground, gizmo drag, tabs, web viewer, versions, compression, new channels', async () => {
  await ok('new_model');
  const samples = path.resolve('docs/how-to/samples');
  const pc = await ok('import_point_cloud', { path: path.join(samples, 'site-scan.ply') });
  assert.ok(pc.points > 30000);
  const g = await ok('classify_ground', { id: pc.id });
  assert.ok(g.size[1] < 4, `the roof is not ground: ${g.size[1]} m of relief`);
  const walk = await ok('walk_to', { position: [10, 0, -5], look_at: [40, 2, -20] });
  assert.ok(walk.position[1] > 2, `eye height above the ground: ${walk.position[1]}`);
  // the move handle: drag the red arrow, one set_transform
  await ok('new_model');
  await ok('create_box', { width: 2, height: 2, depth: 2, name: 'Crate' });
  await ok('set_camera', { position: [6, 5, 7], target: [0, 1, 0] });
  await ok('select', { ids: ['Crate'] });
  await ok('set_gizmo', { mode: 'move' });
  await w.waitForTimeout(300);
  const [a, b] = await w.evaluate(() => [[0.9, 0, 0], [3, 0, 0]].map((p) => window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...p))).map((s) => [s.x, s.y]));
  await w.mouse.move(...a);
  await w.mouse.down();
  await w.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  await w.mouse.move(...b);
  await w.mouse.up();
  const x = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'Crate').position[0]);
  assert.ok(x > 0.5, `dragged along x: ${x}`);
  await ok('set_gizmo', { mode: 'off' });
  // versions, tabs
  await ok('save_version', { name: 'A' });
  await ok('create_box', { width: 1, height: 1, depth: 1, name: 'Shed', position: [4, 0, 0] });
  assert.deepEqual((await ok('compare_versions', { from: 'A' })).added, ['Shed']);
  await ok('new_document', { name: 'Two' });
  assert.equal(await w.locator('.doc-tabs button').count(), 2);
  assert.equal(await w.evaluate(() => window.mmr.doc.entities.length), 0);
  await ok('switch_document', { name: '1' });
  assert.equal(await w.evaluate(() => window.mmr.doc.entities.length), 2);
  await ok('close_document', { name: 'Two' });
  // the web viewer page, a compressed GLB
  const html = path.join(home, 'crate.html');
  await ok('export_web_viewer', { path: html });
  assert.ok(fs.statSync(html).size > 300000 && /OrbitControls/.test(fs.readFileSync(html, 'utf8')), 'three.js and the model inside');
  const glb = path.join(home, 'crate.glb');
  await ok('export', { format: 'glb', path: glb });
  const c = await ok('compress_glb', { path: glb, method: 'meshopt' });
  assert.ok(c.after > 0, 'compressed');
  // the main-process channels added in this phase answer (no "Unknown channel")
  for (const [name, args] of [['transcribe_audio', { path: path.join(samples, 'theme.wav') }], ['list_autosaves', {}]]) {
    const r = await run(name, args);
    assert.ok(r.ok || !/Unknown channel/.test(r.error), `${name}: ${r.error}`);
  }
  assert.ok(!fs.existsSync(path.join(samples, 'theme.wav.txt')), 'no transcript left beside the recording');
});

test('multiple views: four panes, drawing in the plan, maximise, a detached window', async () => {
  await ok('new_model');
  await w.evaluate(() => window.mmr.app.ui.setRibbon(null)); // an earlier drawing may have opened the Drawings ribbon
  await ok('create_box', { width: 4, height: 3, depth: 6, name: 'House' });
  const l = await ok('set_layout', { count: 4 });
  assert.equal(l.arrangement, 'grid');
  assert.deepEqual(l.panes.map((p) => p.view), ['perspective', 'top', 'front', 'right']);
  assert.equal(await w.locator('.pane-canvas').count(), 3);
  assert.equal(await w.locator('.pane-head').count(), 4);
  await ok('zoom_extents', { pane: 'all' });
  // a rectangle drawn with the mouse in the plan (pane 2) lands flat on the ground, in plan proportions
  await w.evaluate(() => window.mmr.app.tools.set('rectangle'));
  const b = await w.locator('.pane-canvas').first().boundingBox();
  const at = (fx, fy) => [b.x + b.width * fx, b.y + b.height * fy];
  await w.mouse.move(...at(0.2, 0.75));
  await w.mouse.click(...at(0.2, 0.75));
  await w.mouse.move(...at(0.4, 0.8));
  await w.mouse.move(...at(0.6, 0.85));
  await w.mouse.click(...at(0.6, 0.85));
  await w.waitForTimeout(400);
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  const rect = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'Rectangle')?.mesh.v);
  assert.ok(rect, `a rectangle was drawn in the plan pane: ${await w.evaluate(() => window.mmr.doc.entities.map((e) => e.name).join(', '))}`);
  const xs = rect.map((v) => v[0]);
  const zs = rect.map((v) => v[2]);
  const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...zs) - Math.min(...zs));
  assert.ok(rect.every((v) => Math.abs(v[1]) < 1e-6), 'on the ground');
  assert.ok(Math.abs(ratio / ((0.4 * b.width) / (0.1 * b.height)) - 1) < 0.2, `plan proportions: ${ratio}`);
  // a pane's view, maximise, undo
  await ok('set_pane', { pane: 4, view: 'left', style: 'wireframe' });
  await ok('set_layout', { max: 3 });
  assert.equal(await w.locator('.pane-canvas:visible').count(), 1);
  await ok('set_layout', { max: 0 });
  // its own window, then docked again by closing it
  const d = await ok('detach_pane', { pane: 2 });
  assert.equal(d.panes[1].detached, true);
  assert.equal(await w.locator('.pane-canvas').count(), 2);
  await w.evaluate(() => window.mmr.app.panes.extra[0].win.close());
  await w.waitForTimeout(500);
  assert.equal((await ok('get_layout')).panes[1].detached, false);
  assert.equal(await w.locator('.pane-canvas').count(), 3);
  await ok('set_layout', { count: 1 });
  assert.equal(await w.locator('.pane-canvas').count(), 0);
});

test('roads: corridor with ditch and layers, road views, a click in the profile, finished ground, volumes and solids', async () => {
  await ok('new_model');
  await ok('create_terrain', { width: 160, depth: 80, spacing: 4, name: 'Ground' });
  await w.evaluate(() => {
    const e = window.mmr.doc.entities.find((x) => x.name === 'Ground');
    delete e.derived;
    e.mesh.v = e.mesh.v.map(([x, , z]) => [x, 8 * Math.exp(-((x + e.position[0]) ** 2) / 1800) - 2, z]);
    window.mmr.app.store.changed?.();
  });
  await ok('create_alignment', { name: 'Main road', points: [[-70, 0], [70, 0]], pvis: [[0, 1], [140, 1]] });
  await ok('create_corridor', { alignment: 'Main road', surface: 'Ground', name: 'Road', template: { ditch: { width: 0.5, depth: 0.5 }, layers: [{ name: 'Asphalt', thickness: 0.1, material: 'Asphalt' }] } });
  const l = await ok('road_views', { corridor: 'Road', station: 70 });
  assert.deepEqual(l.panes.map((p) => p.view), ['perspective', 'top', 'profile', 'section']);
  assert.equal(await w.locator('.pane-board:visible').count(), 2, 'the profile and the section draw on their boards');
  // a click in the profile moves the section
  const b = await w.locator('.pane-board').nth(1).boundingBox();
  const x = await w.evaluate(() => window.mmr.app.panes.extra[1].view2d.map.X(30));
  await w.mouse.click(b.x + x, b.y + b.height * 0.5);
  await w.waitForTimeout(300);
  const st = await w.evaluate(() => window.mmr.doc.settings.layout.station);
  assert.ok(Math.abs(st - 30) < 1.5, `section at ${st}`);
  const sec = await ok('road_section', { corridor: 'Road', station: 70 });
  assert.equal(sec.left, 'cut');
  assert.ok(sec.points.some((p) => p.code === 'ditch'));
  const fs2 = await ok('corridor_surface', { corridor: 'Road' });
  assert.equal(await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'Ground').visible), false);
  assert.ok(fs2.cut > 0 && fs2.fill > 0);
  const v = await ok('corridor_volumes', { corridor: 'Road' });
  const s = await ok('corridor_solids', { corridor: 'Road' });
  const cut = s.solids.find((x) => x.name === 'Cut');
  assert.ok(Math.abs(cut.volume_m3 - v.totals.cut) < v.totals.cut * 0.05, `solid ${cut.volume_m3} vs table ${v.totals.cut}`);
  await ok('set_layout', { count: 1 });
});

test('usability: open lines, window vs crossing, right-click menu, export dialog, scale handles, eraser on a dimension', async () => {
  await ok('new_model');
  await ok('set_camera', { position: [0, 30, 0.01], target: [0, 0, 0], projection: 'parallel' });
  const scr = (p) => w.evaluate((q) => { const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...q)); return [s.x, s.y]; }, p);
  // the Line tool keeps an open line on Enter
  await w.evaluate(() => window.mmr.app.tools.set('line'));
  for (const p of [[-6, 0, -6], [-2, 0, -6], [-2, 0, -2]]) {
    const [x, y] = await scr(p);
    await w.mouse.move(x, y);
    await w.mouse.click(x, y);
  }
  await w.keyboard.press('Enter');
  await w.waitForTimeout(300);
  const line = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name.startsWith('Line')));
  assert.ok(line?.curve, 'an open polyline was kept');
  assert.equal(line.curve.points.length, 3);
  // window (left to right) takes only what is fully inside; crossing (right to left) what it touches
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  await ok('create_box', { width: 2, height: 1, depth: 2, position: [3, 0, 3], name: 'A' });
  await ok('create_box', { width: 2, height: 1, depth: 2, position: [7, 0, 3], name: 'B' });
  await ok('select', { mode: 'none' });
  const drag = async (a, b) => {
    const [x0, y0] = await scr(a);
    const [x1, y1] = await scr(b);
    await w.mouse.move(x0, y0);
    await w.mouse.down();
    await w.mouse.move((x0 + x1) / 2, (y0 + y1) / 2);
    await w.mouse.move(x1, y1);
    await w.mouse.up();
    return w.evaluate(() => window.mmr.app.selection.map((id) => window.mmr.doc.entities.find((e) => e.id === id).name).sort());
  };
  assert.deepEqual(await drag([1, 0, 1], [7, 0, 5]), ['A'], 'window: B sticks out');
  assert.deepEqual(await drag([7, 0, 5], [1, 0, 1]), ['A', 'B'], 'crossing: B is touched');
  // right-click on A: its menu
  const [ax, ay] = await scr([3, 1, 3]);
  await w.mouse.click(ax, ay, { button: 'right' });
  await w.waitForTimeout(200);
  const menu = await w.locator('#menu-pop').innerText();
  assert.match(menu, /Make group/);
  assert.match(menu, /Export the selection/);
  await w.keyboard.press('Escape');
  await w.evaluate(() => window.mmr.app.ui.closeMenu());
  // one Export dialog: what, then the format
  await w.evaluate(() => { window.mmr.app.ui.exportDialog(); });
  assert.equal(await w.locator('.export-choice').count(), 6);
  await w.evaluate(() => document.getElementById('modal').close());
  // scale: a click shows the handles; a typed factor scales
  await w.evaluate(() => window.mmr.app.tools.set('scale'));
  await w.mouse.click(ax, ay);
  await w.waitForTimeout(200);
  assert.equal(await w.evaluate(() => window.mmr.doc.settings.gizmo), 'scale');
  await w.evaluate(() => window.mmr.app.tools.vcb('2'));
  await w.waitForTimeout(200);
  const size = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'A').scale?.[0] ?? 1);
  assert.ok(Math.abs(size - 2) < 1e-6, `scaled ×2: ${size}`);
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  assert.equal(await w.evaluate(() => window.mmr.doc.settings.gizmo), null, 'the handles go with the tool');
  // the eraser takes a dimension by its text
  const d = await ok('add_dimension', { from: [-6, 0, 4], to: [-2, 0, 4] });
  await w.evaluate(() => window.mmr.app.tools.set('eraser'));
  const at = await w.evaluate((id) => window.mmr.doc.entities.find((e) => e.id === id).annotation.at, d.id);
  const [dx, dy] = await scr(at);
  await w.mouse.click(dx, dy);
  await w.waitForTimeout(200);
  assert.equal(await w.evaluate((id) => !!window.mmr.doc.entities.find((e) => e.id === id), d.id), false, 'the dimension is gone');
  await w.evaluate(() => window.mmr.app.tools.set('select'));
});

test('drawing and editing: a rectangle over a face splits it, a grip drag, an arc line, ribbons, textured materials', async () => {
  await ok('new_model');
  await w.evaluate(() => window.mmr.app.ui.setRibbon(null));
  await ok('set_camera', { position: [0, 30, 0.01], target: [0, 0, 0], projection: 'parallel' });
  const scr = (p) => w.evaluate((q) => { const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...q)); return [s.x, s.y]; }, p);
  const click = async (p) => {
    const [x, y] = await scr(p);
    await w.mouse.move(x + 2, y);
    await w.mouse.move(x, y);
    await w.mouse.click(x, y);
  };
  await ok('create_face', { points: [[-4, 0, 3], [4, 0, 3], [4, 0, -3], [-4, 0, -3]], name: 'Slab' });
  // a rectangle drawn with the mouse half over the slab splits it into one shape of three faces
  await w.evaluate(() => window.mmr.app.tools.set('rectangle'));
  await click([1, 0, 1]);
  await click([7, 0, -5]);
  await w.waitForTimeout(300);
  const meshes = await w.evaluate(() => window.mmr.doc.entities.filter((e) => e.mesh).map((e) => [e.name, e.mesh.f.length]));
  assert.deepEqual(meshes, [['Slab', 3]], JSON.stringify(meshes));
  // a grip drag moves a corner
  await w.evaluate(() => (window.mmr.app.tools.set('select'), window.mmr.app.select([window.mmr.doc.entities[0].id])));
  const [gx, gy] = await scr([-4, 0, 3]);
  await w.mouse.move(gx + 3, gy);
  await w.mouse.move(gx, gy);
  await w.mouse.down();
  const [tx, ty] = await scr([-6, 0, 3]);
  await w.mouse.move((gx + tx) / 2, gy);
  await w.mouse.move(tx, ty);
  await w.mouse.up();
  await w.waitForTimeout(300);
  const xs = await w.evaluate(() => { const e = window.mmr.doc.entities[0]; return e.mesh.v.map((p) => p[0] + e.position[0]); });
  assert.ok(Math.min(...xs) < -5, `the corner moved out: ${Math.min(...xs)}`);
  // a line with an arc segment (A)
  await w.evaluate(() => window.mmr.app.tools.set('line'));
  await click([-8, 0, 8]);
  await click([-4, 0, 8]);
  await w.keyboard.press('a');
  await click([-1, 0, 5]);
  await w.keyboard.press('Enter');
  await w.waitForTimeout(300);
  const line = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name.startsWith('Line'))?.curve.points.length);
  assert.ok(line > 4, `the arc added points: ${line}`);
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  // the Site ribbon shows its tools; a textured swatch gives the selection its material
  await w.evaluate(() => window.mmr.app.ui.setRibbon('Site', 'Roads'));
  assert.ok((await w.locator('#ribbon .ribbon-btn').count()) >= 6);
  await w.evaluate(() => window.mmr.app.ui.setRibbon(null));
  assert.equal(await w.locator('#ribbon:visible').count(), 0);
  await w.evaluate(() => (window.mmr.app.select([window.mmr.doc.entities.find((e) => e.name === 'Slab').id]), window.mmr.app.ui.show('materials')));
  await w.locator('.swatch', { hasText: 'Red brick' }).click();
  await w.waitForTimeout(500);
  assert.equal(await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'Slab').material.name), 'Red brick');
});

test('friendly: a form keeps its error, the outliner drags into a group, a component follows the mouse, a guided step moves on', async () => {
  await ok('new_model');
  await w.evaluate(() => window.mmr.app.ui.setRibbon(null));
  // the New layer dialog: no name, an error in place, then a layer
  await w.evaluate(() => { window.mmr.app.ui.commandDialog('create_layer'); });
  await w.locator('#modal button', { hasText: 'Create' }).click();
  assert.match(await w.locator('#modal .form-top').innerText(), /name/);
  await w.locator('#modal input[aria-label="Layer name"]').fill('Walls');
  await w.locator('#modal button', { hasText: 'Create' }).click();
  await w.waitForTimeout(200);
  assert.ok(await w.evaluate(() => window.mmr.doc.tags.some((t) => t.name === 'Walls')));
  // the outliner: drag a box onto a group
  await ok('create_box', { width: 1, height: 1, depth: 1, name: 'A' });
  await ok('create_box', { width: 1, height: 1, depth: 1, name: 'B', position: [3, 0, 0] });
  await ok('group', { ids: ['B'], name: 'G' });
  await ok('select', { mode: 'none' });
  await w.evaluate(() => window.mmr.app.ui.show('outliner'));
  await w.locator('.outline-tree .tree-row', { hasText: 'A' }).first().dragTo(w.locator('.outline-tree .tree-row', { hasText: 'G' }).first());
  await w.waitForTimeout(300);
  assert.equal(await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'A').parent), await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'G').id));
  // a component follows the mouse and lands where clicked
  await ok('set_camera', { position: [0, 30, 0.01], target: [0, 0, 0], projection: 'parallel' });
  await ok('make_component', { ids: ['G'], name: 'Pair' });
  const r = await ok('place_component', { name: 'Pair' });
  await w.evaluate((id) => window.mmr.app.tools.place([id]), r.id);
  const [x, y] = await w.evaluate(() => { const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(-6, 0, 5)); return [s.x, s.y]; });
  await w.mouse.move(x - 20, y);
  await w.mouse.move(x, y);
  await w.mouse.click(x, y);
  await w.waitForTimeout(300);
  const pos = await w.evaluate((id) => window.mmr.doc.entities.find((e) => e.id === id).position, r.id);
  assert.ok(Math.abs(pos[0] + 6) < 0.6 && Math.abs(pos[2] - 5) < 0.6, `placed at ${pos}`);
  // a guided lesson: picking the tool moves it to the next step
  await w.evaluate(() => (window.mmr.app.tools.set('select'), window.mmr.app.learning.start('draw-and-edit')));
  await w.evaluate(() => window.mmr.app.tools.set('rectangle'));
  await w.waitForTimeout(900);
  assert.equal(await w.evaluate(() => window.mmr.app.learning.guide?.i), 1);
  await w.evaluate(() => (window.mmr.app.learning.stop(), window.mmr.app.tools.set('select')));
  await ok('set_camera', { projection: 'perspective' });
});
