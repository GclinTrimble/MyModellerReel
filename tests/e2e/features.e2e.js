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
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_box', arguments: { width: 2, height: 1, depth: 1, name: 'AI pit' } } }] },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_cylinder', arguments: '{"radius": "0.3", "height": "0.05", "name": "AI lid"}' } }] },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'place_on', arguments: { ids: ['AI lid'], target: 'AI pit' } } }] },
      { role: 'assistant', content: 'Done: a stormwater pit with its lid.' },
    ];
    globalThis.requests = [];
    ipcMain.removeHandler('ai:chat');
    ipcMain.handle('ai:chat', (_, body) => {
      globalThis.requests.push(body);
      if (body.messages.some((m) => m.images)) return { provider: 'ollama', data: { message: { role: 'assistant', content: '- AI lid sits on AI pit: good.' } } };
      return { provider: 'ollama', data: { message: script.shift() } };
    });
  });
  await ok('use_skill', { name: 'drainage' });
  await w.click('[data-tab="ai"]');
  await w.evaluate(() => window.mmr.app.ai.setPropose(true));
  await w.fill('.chat-input textarea', 'Put a stormwater pit 2 m by 1 m, 1 m deep, with a 600 mm lid on top');
  await w.keyboard.press('Enter');
  await w.locator('.msg.assistant', { hasText: 'Done: a stormwater pit with its lid.' }).waitFor();
  const reqs = await app.evaluate(() => globalThis.requests);
  assert.ok(reqs[0].tools.length <= 18, 'a small model gets a routed tool list');
  assert.ok(reqs[0].messages[0].content.includes('Domain: stormwater'), 'the skill is in the system prompt');
  const bar = w.locator('#proposal-bar');
  await bar.getByText('2 new').waitFor();
  await bar.getByRole('button', { name: 'Accept' }).click();
  const lid = await ok('get_entity', { id: 'AI lid' });
  assert.equal(lid.min[1], 1);
  assert.equal(await w.evaluate(() => window.mmr.app.store.undoStack.length > 0), true);
  await w.evaluate(() => window.mmr.app.ai.setPropose(false));
  const review = await ok('review_model', { include_images: true });
  assert.equal(review.images.length, 4);
  assert.match(review.critique, /sits on AI pit/);
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
  await w.mouse.move(vp.x + 80, vp.y + 30); // clear of the floating toolbar
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
  assert.equal(await w.locator('.pane-frame').count(), 4);
  assert.equal(await w.locator('.pane-toolbar .pane-head').count(), 1, 'one floating bar, on the pane last hovered');
  assert.equal(await w.locator('.pane-toolbar #viewbar').count(), 1);
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

test('calm forms (#215, #216): Design plane with modes, point chips and checked inputs', async () => {
  await ok('import_points', { text: 'Q1,100,100,10\nQ2,100,112,10.4\nQ3,110,100,11' });
  await w.evaluate(() => { window.mmr.app.ui.commandDialog('design_plane', {}, { form: true }); });
  const form = w.locator('#modal');
  await form.locator('[data-field=points] input[aria-label="Points"]').waitFor();
  assert.equal(await form.locator('[data-field=point]').isHidden(), true, 'only the chosen mode shows');
  assert.equal(await form.locator('.form-help').count(), 0, 'help is in the tooltips');
  for (const n of ['Q1', 'Q2']) await form.locator('[data-field=points] input').fill(n), await form.locator('[data-field=points] input').press('Enter');
  assert.match(await form.locator('[data-field=points] .form-error').textContent(), /2 so far/);
  await form.locator('[data-field=points] input').fill('Q3');
  await form.locator('[data-field=points] input').press('Enter');
  assert.equal(await form.locator('.form-chip').count(), 3);
  await form.getByRole('button', { name: 'Point, slope and bearing' }).click();
  await form.locator('[data-field=bearing] input').fill('north');
  assert.match(await form.locator('[data-field=bearing] .form-error').textContent(), /degrees/);
  await form.getByRole('button', { name: 'Through three points' }).click();
  await form.getByRole('button', { name: 'Run' }).click();
  const plane = (await ok('get_scene')).entities.find((e) => e.generator === 'design_plane');
  assert.ok(plane, 'the plane was made from the three chips');
});

test('pick first (#234, #235): Design trench starts in the view; picks, typed values and the Tool tab', async () => {
  await ok('import_points', { text: 'TA,500,500,10' });
  const ta = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'TA'));
  const P = ta.position;
  await ok('set_camera', { position: [P[0], P[1] + 40, P[2] + 0.001], target: P, projection: 'parallel' });
  await w.evaluate(() => localStorage.removeItem('mymodellerreel.toolOptions'));
  const done = w.evaluate(() => window.mmr.app.ui.commandDialog('design_trench').then((r) => r?.id || null));
  const tip = w.locator('.pick-tip');
  await tip.waitFor();
  assert.equal(await w.locator('#modal[open]').count(), 0, 'no modal form');
  assert.match(await tip.locator('.pick-what').textContent(), /^From: pick it/);
  assert.equal(await w.getAttribute('#dock-tabs [data-tab=tool]', 'aria-selected'), 'true', 'the Tool tab opens');
  // an option in the docked Tool tab, while picking
  await w.locator('.tool-panel [data-field=depth] input').fill('1.5');
  // click the survey point: the pick takes its name; Esc steps back, then pick it again
  const [x, y] = await w.evaluate((p) => { const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...p)); return [s.x, s.y]; }, P);
  const click = async () => (await w.mouse.move(x + 3, y), await w.mouse.move(x, y), await w.mouse.click(x, y));
  await click();
  await tip.getByText(/^To: pick it/).waitFor();
  await w.mouse.move(x + 20, y);
  await w.keyboard.press('Escape');
  await tip.getByText(/^From: pick it/).waitFor();
  await click();
  await tip.getByText(/^To: pick it/).waitFor();
  // a bad value says so; then relative to the last point
  await tip.locator('input[aria-label=x]').fill('abc');
  await tip.locator('input[aria-label=x]').press('Enter');
  assert.match(await tip.locator('.pick-msg').textContent(), /x, y, z/);
  await tip.locator('input[aria-label=x]').fill('@12');
  await tip.locator('input[aria-label=y]').fill('0');
  await tip.locator('input[aria-label=z]').fill('0');
  await tip.locator('input[aria-label=z]').press('Enter');
  const id = await done;
  assert.ok(id, 'the trench was made');
  const tr = await w.evaluate((i) => window.mmr.doc.entities.find((e) => e.id === i).derived.params, id);
  assert.deepEqual(tr.from, { point: ta.id }, 'the picked point by name');
  assert.ok(Math.abs(tr.to[0] - P[0] - 12) < 1e-6 && Math.abs(tr.to[2] - P[2]) < 1e-6, `typed @12, 0, 0: ${tr.to}`);
  assert.equal(tr.depth, 1.5, 'the Tool tab option');
  assert.equal(await tip.count(), 0, 'the tip is gone');
  assert.equal(await w.locator('#dock-tabs [data-tab=tool]').isHidden(), true, 'and the Tool tab');
  assert.deepEqual(await w.evaluate(() => JSON.parse(localStorage.getItem('mymodellerreel.toolOptions')).design_trench), { depth: 1.5 }, 'remembered');
  // next time: remembered, and the modal form is one click away
  const again = w.evaluate(() => window.mmr.app.ui.commandDialog('design_trench'));
  await tip.waitFor();
  assert.equal(await w.locator('.tool-panel [data-field=depth] input').inputValue(), '1.5');
  await tip.getByRole('button', { name: 'Form' }).click();
  await w.locator('#modal [data-field=from]').waitFor();
  await w.locator('#modal').getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await again, undefined);
  await ok('set_camera', { projection: 'perspective' });
});

test('survey code card (#217): click, recall a code, Enter places the point and its object', async () => {
  await ok('define_feature_code', { code: 'TREE', description: 'Tree', object: { type: 'tree' } });
  await w.evaluate(() => localStorage.setItem('mymodellerreel.recentCodes', JSON.stringify(['GND', 'TREE'])));
  const picked = w.evaluate(() => window.mmr.app.ui.codeCard({ clientX: 300, clientY: 300 }, '', 'Code of the new point'));
  const card = w.locator('.code-card');
  await card.locator('input').waitFor();
  assert.deepEqual(await card.locator('.code-item b').allTextContents(), ['GND', 'TREE']);
  await card.locator('input').fill('tr');
  await card.locator('input').press('Enter');
  assert.equal(await picked, 'TREE');
  assert.deepEqual(await w.evaluate(() => JSON.parse(localStorage.getItem('mymodellerreel.recentCodes'))), ['TREE', 'GND']);
  const esc = w.evaluate(() => window.mmr.app.ui.codeCard({}, 'GND'));
  await card.locator('input').waitFor();
  await card.locator('input').press('Escape');
  assert.equal(await esc, null);
});

test('COGO panel (#227, #228): the answer as you type, a traverse table, Store in one step', async () => {
  await ok('import_points', { text: 'K1,2000,1000,10\nK2,2000,1100,11' });
  await w.evaluate(() => window.mmr.app.ui.show('cogo'));
  const panel = w.locator('.cogo');
  await panel.locator('[data-field=from] input').fill('K1');
  await panel.locator('[data-field=to] input').fill('K2');
  await panel.locator('.cogo-fact b').first().waitFor();
  assert.deepEqual((await panel.locator('.cogo-fact b').allTextContents()).slice(0, 2), ['N 90°00\'00.0" E', '100.000 m']);
  await panel.getByRole('radio', { name: 'Traverse' }).click();
  await panel.locator('.cogo-trav input[aria-label="Backsight (for turns)"]').fill('K2');
  await panel.locator('.cogo-trav input[aria-label="Start at"]').fill('K1');
  for (const [dir, dist] of [['R90', '40'], ['R90', '100'], ['R90', '40']]) {
    await panel.locator('.cogo-dir').last().fill(dir);
    await panel.locator('.cogo-dir').last().press('Enter');
    await w.keyboard.type(dist);
    await w.keyboard.press('Enter');
  }
  await panel.locator('.cogo-trav input[aria-label="Closes on (optional)"]').fill('K2');
  await w.waitForFunction(() => document.querySelector('.cogo .btn.primary')?.textContent.includes('Store 2 points'));
  assert.match(await panel.locator('.cogo-answer').textContent(), /1:Infinity|exact/);
  await panel.getByRole('button', { name: /Store 2 points/ }).click();
  const pts = (await ok('query_points', {})).points ?? (await ok('get_scene')).entities.filter((e) => e.type === 'point');
  assert.ok(pts.length >= 4, 'the two new points were stored');
  assert.match(await panel.locator('.cogo-entry').first().textContent(), /Traverse → stored/);
});

test('pictures for the copilot (#229, #230): a sketch straightened into a profile, a picture sent with the message', async () => {
  const pad = w.evaluate(() => window.mmr.app.ui.actions.sketchProfile.run());
  const canvas = w.locator('.sketch-canvas');
  await canvas.waitFor();
  const b = await canvas.boundingBox();
  const k = b.width / 960;
  const at = (x, y) => [b.x + x * k, b.y + y * k];
  await w.mouse.move(...at(200, 400));
  await w.mouse.down();
  for (const [x, y] of [[203, 250], [198, 100], [350, 104], [500, 98], [502, 250], [498, 400], [350, 396], [204, 402]]) await w.mouse.move(...at(x, y), { steps: 6 });
  await w.mouse.up();
  await w.locator('.sketch input[aria-label="Real width in metres"]').fill('2');
  assert.match(await w.locator('.sketch-status').textContent(), /Closed outline, 4 corners, 2 × 2(\.0\d+)? m/);
  await w.locator('.sketch input[aria-label="Profile name"]').fill('Drawn box');
  await w.locator('#modal').getByRole('button', { name: 'Save profile' }).click();
  await pad;
  assert.equal((await w.evaluate(() => window.mmr.app.store.doc.profiles['Drawn box'].points.length)), 4);
  // a picture goes with the next message, in the provider's own shape
  await w.evaluate(() => window.mmr.app.ui.show('ai'));
  await w.evaluate(async () => window.mmr.app.ai.attachPicture(document.querySelector('.sketch-canvas')?.toDataURL() || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
  assert.equal(await w.locator('.chat-picture').count(), 1);
  const sent = await w.evaluate(async () => {
    const a = window.mmr.app;
    const real = a.chat;
    let body;
    a.chat = async (x) => ((body = x), a.settings.ai.provider === 'anthropic' ? { content: [{ type: 'text', text: 'Seen.' }] } : a.settings.ai.provider === 'ollama' ? { message: { role: 'assistant', content: 'Seen.' } } : { choices: [{ message: { role: 'assistant', content: 'Seen.' } }] });
    a.ai.input.value = 'Build this';
    await a.ai.send();
    a.chat = real;
    return JSON.stringify(body.messages.at(-1)).includes('base64') || !!body.messages.at(-1).images?.length;
  });
  assert.ok(sent, 'the picture went with the message');
  assert.equal(await w.locator('.msg.user img').count(), 1);
});

test('agent profiles work at once (#243) and Ask at the cursor (#244)', async () => {
  await ok('new_model');
  // two scripted local models, told apart by the agent each request names, slow enough that their turns overlap
  await app.evaluate(({ ipcMain }) => {
    const call = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] });
    const scripts = {
      plumb: [[300, call('create_box', { width: 1, height: 1, depth: 1, name: 'Plumb box' })], [900, { role: 'assistant', content: 'Plumb done.' }]],
      helper: [[100, call('create_sphere', { radius: 0.3, position: [3, 0, 0], name: 'Helper ball' })], [500, call('set_material', { ids: ['Plumb box'], color: '#ff0000' })], [100, { role: 'assistant', content: 'Helper done.' }]],
    };
    globalThis.agentLog = [];
    ipcMain.removeHandler('ai:chat');
    ipcMain.handle('ai:chat', async (_, body) => {
      const id = body.agent?.id;
      const [ms, message] = scripts[id]?.shift() || [50, { role: 'assistant', content: `Reply from ${id}` }];
      globalThis.agentLog.push({ id, at: Date.now(), text: JSON.stringify(body.messages.at(-1)) });
      await new Promise((r) => setTimeout(r, ms));
      return { provider: 'ollama', data: { message } };
    });
  });
  await ok('save_agent', { name: 'Helper', instructions: 'You help.', color: '#e0a458' });
  const undoBefore = await w.evaluate(() => window.mmr.app.store.undoStack.length);
  assert.equal((await ok('ask_agent', { text: 'Make a box' })).started, true);
  assert.equal((await ok('ask_agent', { agent: 'Helper', text: 'Make a ball and paint the box' })).started, true);
  const both = await ok('list_agents');
  assert.deepEqual(both.agents.map((a) => a.status), ['working', 'working']);
  let list;
  for (let i = 0; i < 100 && (list = await ok('list_agents')).agents.some((a) => a.status === 'working'); i++) await w.waitForTimeout(100);
  assert.deepEqual(list.agents.map((a) => a.status), ['idle', 'idle']);
  // both worked on the same document; the paint on Plumb's box clashed and is held for the user
  const names = await w.evaluate(() => window.mmr.app.store.doc.entities.map((e) => e.name));
  assert.ok(names.includes('Plumb box') && names.includes('Helper ball'));
  const journal = await w.evaluate(() => window.mmr.app.store.doc.journal.map((j) => `${j.agent}:${j.command}`));
  assert.deepEqual(journal, ['Helper:create_sphere', 'Plumb:create_box']);
  assert.equal(list.held.length, 1);
  assert.equal(list.held[0].command, 'set_material');
  assert.equal(list.held[0].owner, 'plumb');
  // the agents panel shows them and the held change
  await w.click('[data-tab="agents"]');
  await w.locator('.agent-row').nth(1).waitFor();
  assert.equal(await w.locator('.agent-row').count(), 2);
  await w.locator('.agent-held').getByRole('button', { name: 'Apply' }).click();
  await w.waitForFunction(() => window.mmr.app.store.doc.entities.find((e) => e.name === 'Plumb box')?.material.color === '#ff0000');
  // the overlapping turns were one undo step, the applied change another
  assert.equal(await w.evaluate(() => window.mmr.app.store.undoStack.length), undoBefore + 2);
  await ok('undo');
  await ok('undo');
  assert.equal(await w.evaluate(() => window.mmr.app.store.doc.entities.length), 0);

  // Ask at the cursor: Ctrl+Space over the view, pick the agent, Enter; the reply comes as a toast and in its thread
  await ok('create_box', { width: 2, height: 1, depth: 2, name: 'Table' });
  await ok('set_camera', { position: [0, 10, 0.001], target: [0, 0, 0] });
  const box = await w.locator('#viewport').boundingBox();
  await w.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await w.keyboard.press('Control+Space');
  const pop = w.locator('.ask-pop');
  await pop.waitFor();
  assert.match(await pop.innerText(), /at -?0\.\d+, 1\.00, -?0\.\d+/);
  await pop.locator('select').selectOption('helper');
  await pop.locator('input').fill('What is this?');
  await pop.locator('input').press('Enter');
  await w.locator('.toast', { hasText: 'Helper: Reply from helper' }).waitFor();
  const asked = await app.evaluate(() => globalThis.agentLog.at(-1).text);
  assert.match(asked, /What is this\?/);
  assert.match(asked, /the point under the cursor: \[/);
  await ok('ask_agent', { agent: 'Helper', text: 'again' });
  // right-click › Ask… opens the same prompt
  await w.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await w.waitForTimeout(200);
  await w.locator('#menu-pop').getByRole('menuitem', { name: 'Ask…' }).click();
  await pop.waitFor();
  await w.keyboard.press('Escape');
  await w.evaluate(() => window.mmr.app.agents.open('helper'));
  await w.locator('.chat .msg.assistant', { hasText: 'Reply from helper' }).first().waitFor();
  await w.evaluate(() => window.mmr.app.agents.open('plumb'));
  await ok('remove_agent', { agent: 'Helper' });
});

test('a running turn shows what it does, its time and Stop; the view changes per command; the timings stay (#257)', async () => {
  await ok('new_model');
  await app.evaluate(({ ipcMain }) => {
    const call = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] });
    const steps = [
      { think: true, message: call('create_box', { width: 1, height: 1, depth: 1, name: 'Live box' }) },
      { message: call('place_on', { ids: ['Live box'], target: 'nothing' }) },
      { wait: 2500, message: { role: 'assistant', content: 'Done.' } },
    ];
    ipcMain.removeHandler('ai:chat');
    ipcMain.handle('ai:chat', async (e, body) => {
      const s = steps.shift() || { message: { role: 'assistant', content: 'Done.' } };
      if (s.think) for (const t of ['<think>', 'One box, ', '1 m.', '</think>']) e.sender.send('ai:delta', t, body.agent?.id || '');
      await new Promise((r) => setTimeout(r, s.wait || 300));
      return { provider: 'ollama', data: { message: s.message, prompt_eval_count: 1000, eval_count: 20 } };
    });
  });
  await w.evaluate(() => window.mmr.app.agents.thread().reset()); // a new chat: only this turn's steps
  const undoBefore = await w.evaluate(() => window.mmr.app.store.undoStack.length);
  await ok('ask_agent', { text: 'Make a box' });
  let run;
  for (let i = 0; i < 100 && !((run = (await ok('ai_turns')).running)?.calls >= 2); i++) await w.waitForTimeout(50);
  assert.equal(run.calls, 2, 'the running turn’s numbers so far');
  const live = await w.evaluate(() => ({
    clock: document.querySelector('.turn-live .turn-clock')?.textContent,
    stop: !!document.querySelector('.turn-live button'),
    rows: [...document.querySelectorAll('.toolcall')].map((r) => `${r.classList.contains('err') ? 'x' : 'ok'} ${r.querySelector('summary').textContent}`),
    think: document.querySelector('.msg .think summary')?.textContent,
    shown: [...window.mmr.app.viewport.objs.keys()].length,
  }));
  assert.match(live.clock, /^\d+ s · step [23] · 2 calls$/);
  assert.ok(live.stop, 'a Stop on the card');
  assert.match(live.rows[0], /^ok create_box width 1, height 1, depth 1, name "Live box" · \d+ ms$/);
  assert.match(live.rows[1], /^x place_on .* · No entity .*nothing.* · \d+ ms$/);
  assert.equal(live.think, 'Reasoned (4 words)');
  assert.ok(live.shown >= 1, 'the box is in the view while the turn still runs');
  await w.click('.turn-live button');
  for (let i = 0; i < 100 && (await ok('ai_turns')).running; i++) await w.waitForTimeout(50);
  const { turns } = await ok('ai_turns');
  const t = turns.at(-1);
  assert.deepEqual([t.steps, t.calls, t.errors, t.tokens_in, t.tokens_out, t.stopped], [3, 2, 1, 3000, 60, true]);
  assert.ok(t.model_ms >= 2500 && t.ms >= t.model_ms + t.tool_ms - 5, JSON.stringify(t));
  assert.deepEqual(t.trace.map((x) => x.tool || 'model'), ['model', 'create_box', 'model', 'place_on', 'model']);
  assert.equal(await w.locator('.turn-live').count(), 0);
  assert.match(await w.locator('.turn-stats summary').last().textContent(), /^\d+\.\d s · model \d+\.\d s · tools \d+\.\d s · 3 steps · 2 tool calls · 1 error · 3000 in, 60 out tokens · \d+ tok\/s$/);
  assert.equal(await w.evaluate(() => window.mmr.app.store.undoStack.length), undoBefore + 1, 'the whole turn is one undo step');
});

test('help that answers and my own tools (#241, #242): Ask Plumb, F1 over a tool, a turn saved as a tool, My tools', async () => {
  await ok('new_model');
  // a scripted local model: one-shot help answers have no tools; copilot turns do
  await app.evaluate(({ ipcMain }) => {
    const script = [
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_box', arguments: { width: 3, height: 0.5, depth: 1, name: 'Step' } } }] },
      { role: 'assistant', content: 'Made a step.' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'save_tool', arguments: { name: 'Garden step', description: 'A step block' } } }] },
      { role: 'assistant', content: 'Saved as Garden step.' },
    ];
    globalThis.requests = [];
    ipcMain.removeHandler('ai:chat');
    ipcMain.handle('ai:chat', (_, body) => {
      globalThis.requests.push(body);
      if (!body.tools) return { provider: 'ollama', data: { message: { role: 'assistant', content: 'Draw the path with the Curve tool, then sweep a profile along it [1].' } } };
      return { provider: 'ollama', data: { message: script.shift() } };
    });
  });
  // Ask Plumb in the Help panel: an answer, its cited section, Show me
  await w.click('[data-tab="help"]');
  await w.fill('.help-ask input', 'how do I sweep a kerb along a curve');
  await w.locator('.help-ask').getByRole('button', { name: 'Ask', exact: true }).click();
  await w.locator('.help-answer', { hasText: 'Curve tool' }).waitFor();
  await w.locator('.help-ask .chip', { hasText: '[1] Run a kerb along a curve' }).waitFor();
  const asked = (await app.evaluate(() => globalThis.requests)).at(-1);
  assert.match(asked.messages[0].content, /Plumb/);
  assert.match(asked.messages[1].content, /\[1\] Run a kerb along a curve/);
  await w.locator('.help-ask').getByRole('button', { name: 'Show me' }).click();
  assert.equal(await w.evaluate(() => window.mmr.app.tools.id), 'curve');
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  // F1 over a tool button asks about that tool
  await w.locator('#toolbar button[data-tool="pushpull"]').hover();
  await w.keyboard.press('F1');
  await w.waitForFunction(() => window.mmr.app.help.answer?.tool === 'pushpull' && !window.mmr.app.help.answer.busy);
  assert.match(await w.locator('.help-ask input').inputValue(), /Push/);

  // a copilot turn, then "save what we just did as a tool" in the next one
  await w.click('[data-tab="ai"]');
  await w.fill('.chat-input textarea', 'Make a garden step');
  await w.keyboard.press('Enter');
  await w.locator('.msg.assistant', { hasText: 'Made a step.' }).waitFor();
  await w.fill('.chat-input textarea', 'Save what we just did as a tool called Garden step');
  await w.keyboard.press('Enter');
  await w.locator('.msg.assistant', { hasText: 'Saved as Garden step.' }).waitFor();
  const file = path.join(home, 'library', 'mytools', 'garden_step.tool.json');
  const tool = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(tool.params).sort(), ['depth', 'height', 'width']);
  assert.deepEqual(tool.steps.map((s) => s.command), ['create_box']);
  // a command like any other: the API's list, and it runs with other values
  assert.ok((await w.evaluate(() => window.mmr.list())).some((c) => c.name === 'garden_step'));
  const made = await ok('garden_step', { width: 5 });
  assert.equal((await ok('get_entity', { id: made.made[0] })).size[0], 5);
  // Tools › My tools
  await w.locator('#menubar button', { hasText: 'Tools' }).click();
  await w.locator('.menu-pop .has-sub', { hasText: 'My tools' }).hover();
  await w.locator('#menu-sub').getByText('Garden step…').waitFor();
  await w.keyboard.press('Escape');
  await w.evaluate(() => window.mmr.app.ui.closeMenu());
  // the My tools panel: delete removes the file
  await w.evaluate(() => window.mmr.app.ui.show('mytools'));
  const card = w.locator('.card', { hasText: 'Garden step' });
  await card.waitFor();
  await card.getByRole('button', { name: 'Delete Garden step' }).click();
  await w.locator('#modal').getByRole('button', { name: 'Delete' }).click();
  await w.waitForFunction(() => !window.mmr.app.reg.commands.has('garden_step'));
  assert.ok(!fs.existsSync(file));
});

test('OpenUSD: export .usda and .usdz, import them back, reference a published file that follows its changes', async () => {
  await ok('new_document', { name: 'USD' });
  await ok('create_box', { width: 2, height: 1, depth: 3, name: 'Slab', color: '#ff0000' });
  const usda = path.join(home, 'out', 'a.usda').split(path.sep).join('/');
  const usdz = path.join(home, 'out', 'a.usdz').split(path.sep).join('/');
  await ok('export', { format: 'usda', path: usda });
  await ok('export', { format: 'usdz', path: usdz });
  for (const p of [usda, usdz]) assert.ok((await ok('import', { path: p })).created.parts >= 1, `${p} reads back`);
  // live reference: publish, reference, edit, the reference follows
  const live = path.join(home, 'out', 'live.usda').split(path.sep).join('/');
  await ok('publish_reference', { path: live });
  await ok('publish_reference', { stop: true }); // one snapshot: a window referencing what it publishes would loop
  const ref = await ok('reference_file', { path: live, name: 'Live' });
  assert.ok(ref.parts >= 3);
  await new Promise((r) => setTimeout(r, 1000)); // the main process has started watching it
  fs.writeFileSync(live, fs.readFileSync(usda, 'utf8')); // the other window wrote a new version
  await assert.doesNotReject(async () => {
    for (let i = 0; i < 100; i++) {
      if ((await w.evaluate((id) => window.mmr.app.store.doc.entities.filter((e) => e.parent === id).length, ref.id)) === 1) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the reference did not follow the file');
  });
  await ok('bind_reference', { ids: [ref.id] });
});

test('surface editing (#239, #240): the Surface panel, a point dragged, one added at a typed height, an outline corner dragged', async () => {
  await ok('new_model');
  const rows = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) rows.push(`P${i}${j},${5400000 + i * 10},${650000 + j * 10},${100 + i},GND`);
  await ok('import_points', { text: rows.join('\n') });
  await ok('create_surface', { name: 'EG' });
  await ok('surface_boundary', { id: 'EG', action: 'set', points: [[0, 0], [30, 0], [30, -30], [0, -30]] });
  await ok('set_view', { preset: 'top' });
  await ok('zoom_extents', {});
  await ok('select', { ids: ['EG'] });
  await w.click('[data-tab="entity"]');
  await w.locator('.surface-def').waitFor();
  assert.match(await w.locator('.surface-def').textContent(), /Points\s*16/);
  const screen = (p) => w.evaluate((q) => {
    const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...q));
    return [s.x, s.y];
  }, p);
  // Move, from the panel (the Points count opens its list): drag P11 in plan
  await w.locator('.surface-def .surf-count', { hasText: 'Points' }).click();
  await w.locator('.surface-def button[title="Move"]').click();
  assert.equal(await w.evaluate(() => window.mmr.app.tools.tool.mode), 'move');
  const p11 = await w.evaluate(() => window.mmr.doc.entities.find((e) => e.name === 'P11').position);
  await w.mouse.move(...(await screen(p11)));
  await w.mouse.down();
  await w.mouse.move(...(await screen([p11[0] + 3, p11[1], p11[2]])), { steps: 5 });
  await w.mouse.up();
  await w.waitForFunction(() => window.mmr.doc.entities.find((e) => e.name === 'P11').position[0] > 11);
  // Add, at a typed elevation
  await w.keyboard.press('a');
  await w.fill('#vcb', 'z 120');
  await w.press('#vcb', 'Enter');
  await w.mouse.click(...(await screen([25, 2, -25])));
  await w.waitForFunction(() => window.mmr.doc.entities.filter((e) => e.type === 'point').length === 17);
  assert.equal((await ok('get_entity', { id: 'EG' })).max[1], 20, 'the surface rose to the new point');
  // Grips: drag the outline corner at [30, -30] in to [20, -20]
  await w.locator('.surface-def .surf-count', { hasText: 'Boundary' }).click();
  await w.locator('.surface-def button[title="Drag the corners in the view"]').first().click();
  assert.equal(await w.evaluate(() => window.mmr.app.tools.tool.mode), 'grips');
  const corner = await w.evaluate(() => window.mmr.app.tools.tool.rings()[0].pts[2].toArray());
  await w.mouse.move(...(await screen(corner)));
  await w.mouse.down();
  await w.mouse.move(...(await screen([20, corner[1], -20])), { steps: 5 });
  await w.mouse.up();
  await w.waitForFunction(() => Math.abs(window.mmr.doc.entities.find((e) => e.name === 'EG').derived.params.outline[2][0] - 20) < 0.6);
  // the panel follows; one undo puts the corner back
  await w.locator('.surface-def', { hasText: /Points\s*17/ }).waitFor();
  await w.keyboard.press('Escape');
  await ok('undo', {});
  assert.deepEqual((await ok('surface_definition', { id: 'EG' })).definition.outline[2], [30, -30]);
});

test('a dialog opened as another closes (Coordinate system → Pick on a map) is not cancelled by the old close event', async () => {
  const r = await w.evaluate(async () => {
    const ui = window.mmr.app.ui;
    ui.modal('First', document.createElement('div'));
    ui.closeModal();
    let got = 'pending';
    ui.modal('Second', document.createElement('div'), [['Go', 'go']]).then((v) => (got = v));
    await new Promise((res) => setTimeout(res, 300));
    const open = document.getElementById('modal').open;
    document.querySelector('#modal footer .btn.primary').click();
    await new Promise((res) => setTimeout(res, 50));
    return [open, got];
  });
  assert.deepEqual(r, [true, 'go']);
});

test('side panel (#236): Ctrl+B hides it for a wider view, a tab icon re-opens it there, the state is remembered', async () => {
  const hidden = () => w.evaluate(() => document.body.classList.contains('no-dock'));
  const viewW = () => w.evaluate(() => document.getElementById('viewport').getBoundingClientRect().width);
  await w.locator('#viewport').click({ position: { x: 5, y: 5 } });
  const wide = await viewW();
  await w.keyboard.press('Control+B');
  assert.equal(await hidden(), true);
  assert.equal(await w.locator('#dock-body').isHidden(), true);
  assert.ok((await viewW()) > wide + 200, 'the view takes the width');
  await w.reload();
  await w.waitForFunction(() => window.mmr?.app?.tools);
  assert.equal(await hidden(), true, 'remembered after a reload');
  await w.click('[data-tab="materials"]');
  assert.equal(await hidden(), false);
  assert.equal(await w.locator('#dock-tabs [data-tab="materials"]').getAttribute('aria-selected'), 'true');
  await w.click('#dock-tabs .dock-retract'); // the strip's top button hides the panel
  assert.equal(await hidden(), true);
  await w.locator('#viewbar button[aria-label="Side panel (Ctrl+B)"]').click();
  assert.equal(await hidden(), false);
});

test('field book (#257–#262): a Trimble job, Check the survey, Fix, a rod height typed in a cell; photos stay with the job', async () => {
  await ok('new_model');
  const r = await ok('import', { path: path.resolve('tests/fixtures/jxl/kerb-pickup.jxl') });
  assert.equal(r.created['survey setups'], 2);
  await w.click('[data-tab="survey"]');
  await w.locator('.survey-views button', { hasText: 'Field book' }).click();
  await w.locator('#dock-body', { hasText: 'Station S1' }).waitFor();
  await w.locator('#dock-body button', { hasText: 'Check the survey' }).click();
  const finding = w.locator('.fb-findings .card', { hasText: 'P3' });
  await finding.waitFor();
  await finding.locator('button', { hasText: 'Fix' }).click();
  await w.waitForFunction(() => Math.abs(window.mmr.doc.entities.find((e) => e.name === 'P3').point.z - 10.1) < 1e-6);
  // the shots under a setup, and a rod height typed in its cell
  await w.locator('.fb-setup', { hasText: 'Station S1' }).getByRole('button', { name: 'Show the shots' }).click();
  const cell = w.locator('input.cell[aria-label="Rod height of P4"]');
  await cell.fill('1.4');
  await cell.press('Enter');
  await cell.blur();
  await w.waitForFunction(() => Math.abs(window.mmr.doc.entities.find((e) => e.name === 'P4').point.z - 10.2) < 1e-6);
  assert.ok(await w.locator('td.edited input.cell[aria-label="Rod height of P4"]').count(), 'the edited cell is marked');
  const edits = await ok('list_survey', { edits: true });
  assert.deepEqual(edits.edits.map((e) => e.label.split(' ')[0]).sort(), ['P3', 'P4']);
  await w.locator('#dock-body button', { hasText: 'Undo all edits' }).click();
  await w.waitForFunction(() => Math.abs(window.mmr.doc.entities.find((e) => e.name === 'P3').point.z - 9.6) < 1e-6);
  // the field book is in the saved design
  assert.ok(await w.evaluate(() => JSON.stringify(window.mmr.doc).includes('"backsights"')));
});

test('map layers (#264–#267): a WMTS and a WFS layer from services stubbed in the main process stream under the model', async () => {
  await ok('new_model');
  await app.evaluate(({ ipcMain }) => {
    // a 1 × 1 orange PNG for every tile, the capabilities, and two parcels around the base point (lon 172.6, lat −43.53)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const wmts = '<?xml version="1.0"?><Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" version="1.0.0"><ows:ServiceIdentification><ows:Title>Test imagery</ows:Title></ows:ServiceIdentification><Contents><Layer><ows:Title>Aerial</ows:Title><ows:Identifier>aerial</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>WebMercatorQuad</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="https://tiles.test/aerial/{TileMatrix}/{TileCol}/{TileRow}.png"/></Layer><TileMatrixSet><ows:Identifier>WebMercatorQuad</ows:Identifier><ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>' +
      Array.from({ length: 21 }, (_, z) => `<TileMatrix><ows:Identifier>${z}</ows:Identifier><ScaleDenominator>${559082264.0287178 / 2 ** z}</ScaleDenominator><TopLeftCorner>-20037508.3427892 20037508.3427892</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>${2 ** z}</MatrixWidth><MatrixHeight>${2 ** z}</MatrixHeight></TileMatrix>`).join('') +
      '</TileMatrixSet></Contents></Capabilities>';
    const wfs = '<?xml version="1.0"?><WFS_Capabilities version="2.0.0" xmlns="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1"><ows:ServiceIdentification><ows:Title>Cadastre</ows:Title></ows:ServiceIdentification><ows:OperationsMetadata><ows:Operation name="GetFeature"><ows:Parameter name="outputFormat"><ows:AllowedValues><ows:Value>application/json</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation></ows:OperationsMetadata><FeatureTypeList><FeatureType><Name>cad:parcels</Name><Title>Parcels</Title><DefaultCRS>urn:ogc:def:crs:OGC:1.3:CRS84</DefaultCRS></FeatureType></FeatureTypeList></WFS_Capabilities>';
    const sq = (x, y, d) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
    const parcels = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p1', properties: { lot: 'Lot 1', zone: 'R1' }, geometry: { type: 'Polygon', coordinates: sq(172.6, -43.53, 0.0005) } }, { type: 'Feature', id: 'p2', properties: { lot: 'Lot 2', zone: 'B2' }, geometry: { type: 'Polygon', coordinates: sq(172.6006, -43.53, 0.0005) } }] };
    globalThis.ogcHits = [];
    ipcMain.removeHandler('ogc:get');
    ipcMain.handle('ogc:get', (_, url, opts = {}) => {
      globalThis.ogcHits.push(url);
      if (/tiles\.test/.test(url)) return { status: 200, type: 'image/png', bytes: png };
      if (/GetFeature/i.test(url)) return { status: 200, type: 'application/json', text: JSON.stringify(parcels) };
      if (/wfs/i.test(url)) return { status: 200, type: 'text/xml', text: wfs };
      if (/wmts/i.test(url)) return { status: 200, type: 'text/xml', text: wmts };
      throw new Error('no service here');
    });
  });
  await ok('set_coordinate_system', { epsg: 2193, name: 'NZGD2000 / NZTM 2000' });
  await ok('set_base_point', { latitude: -43.53, longitude: 172.6, z: 0 });
  await ok('add_map_layer', { url: 'https://maps.test/wmts?SERVICE=WMTS&REQUEST=GetCapabilities', layer: 'aerial' });
  await ok('add_map_layer', { url: 'https://maps.test/wfs?SERVICE=WFS&REQUEST=GetCapabilities', name: 'Parcels', style: { stroke: '#d9480f', fill: '#d9480f', label: 'lot' } });
  await ok('set_camera', { position: [40, 300, 60], target: [40, 0, -40] });
  await w.waitForFunction(() => {
    const ml = window.mmr.app.mapLayers;
    const [tiles, feats] = window.mmr.doc.settings.map_layers.map((L) => ml.groups.get(L.id)?.group);
    return tiles?.children.some((m) => m.material.map) && feats?.children.some((o) => o.isLineSegments);
  }, null, { timeout: 15000 });
  const hits = await app.evaluate(() => globalThis.ogcHits);
  assert.ok(hits.some((u) => /tiles\.test\/aerial\/\d+\/\d+\/\d+\.png/.test(u)), 'tiles asked through the main process');
  assert.ok(hits.some((u) => /TYPENAMES=cad%3Aparcels/.test(u) && /SRSNAME=urn%3Aogc%3Adef%3Acrs%3AOGC%3A1.3%3ACRS84/.test(u)), 'features asked in CRS84');
  // which parcels does a road cross: Lot 1 lies east of the base point, a road running north through it
  await ok('create_curve', { points: [[10, 0, 20], [10, 0, -80]], kind: 'polyline', name: 'Road centreline' });
  const q = await ok('query_service_features', { layer: 'Parcels', touching: 'Road centreline' });
  assert.deepEqual(q.features.map((f) => f.lot), ['Lot 1']);
  const imp = await ok('import_features', { layer: 'Parcels', radius: 200 });
  assert.equal(imp.features, 2);
  await w.click('[data-tab="survey"]');
  await w.locator('.survey-views button', { hasText: 'Maps' }).click();
  await w.locator('.map-layer', { hasText: 'Parcels' }).waitFor();
  assert.equal(await w.locator('.map-layer').count(), 2);
  await w.locator('.map-layer', { hasText: 'Aerial' }).getByRole('checkbox').uncheck();
  await w.waitForFunction(() => window.mmr.doc.settings.map_layers.find((L) => L.name === 'Aerial').visible === false);
});

test('terrain and buildings from services (stubbed): terrain streams, Save as surface, buildings stand on it and come in as prisms', async () => {
  await ok('new_model');
  await app.evaluate(({ ipcMain, nativeImage }) => {
    // Terrarium tiles: every pixel 32768 + 20 + col / 256… → heights 20 m plus a gentle slope across each tile
    const w = 16;
    const bgra = Buffer.alloc(w * w * 4);
    for (let i = 0; i < w * w; i++) bgra.set([0, 20 + (i % w), 128, 255], i * 4); // B, G, R, A: R 128 → 32768, G 20…35
    const png = nativeImage.createFromBitmap(bgra, { width: w, height: w }).toPNG();
    const wfs = '<?xml version="1.0"?><WFS_Capabilities version="2.0.0" xmlns="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1"><ows:OperationsMetadata><ows:Operation name="GetFeature"><ows:Parameter name="outputFormat"><ows:AllowedValues><ows:Value>application/json</ows:Value></ows:AllowedValues></ows:Parameter></ows:Operation></ows:OperationsMetadata><FeatureTypeList><FeatureType><Name>bag:pand</Name><Title>Buildings</Title><DefaultCRS>urn:ogc:def:crs:OGC:1.3:CRS84</DefaultCRS></FeatureType></FeatureTypeList></WFS_Capabilities>';
    const sq = (x, y, d) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
    const buildings = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'b1', properties: { identificatie: 'Depot', ground: 21, roof: 30 }, geometry: { type: 'Polygon', coordinates: sq(172.6, -43.53, 0.0002) } }] };
    ipcMain.removeHandler('ogc:get');
    ipcMain.handle('ogc:get', (_, url, opts = {}) => {
      if (/terrarium/.test(url)) return { status: 200, type: 'image/png', bytes: png };
      if (/GetFeature/i.test(url)) return { status: 200, type: 'application/json', text: JSON.stringify(buildings) };
      if (/wfs/i.test(url)) return { status: 200, type: 'text/xml', text: wfs };
      throw new Error('no service here');
    });
  });
  await ok('set_coordinate_system', { epsg: 2193, name: 'NZGD2000 / NZTM 2000' });
  await ok('set_base_point', { latitude: -43.53, longitude: 172.6, z: 0 });
  await ok('set_camera', { position: [60, 120, 160], target: [20, 20, -20] });
  await ok('add_map_layer', { url: 'https://tiles.test/terrarium/{z}/{x}/{y}.png', elevation: 'terrarium', max_zoom: 15, name: 'Terrain' });
  await w.waitForFunction(() => {
    const L = window.mmr.doc.settings.map_layers[0];
    const g = window.mmr.app.mapLayers.groups.get(L.id)?.group;
    if (!g?.children.length) return false;
    const p = g.children[0].geometry.attributes.position;
    return p.getY(0) > 19 && p.getY(0) < 36;
  }, null, { timeout: 15000 });
  // Save as surface from the panel
  await w.click('[data-tab="survey"]');
  await w.locator('.survey-views button', { hasText: 'Maps' }).click();
  await w.locator('.map-layer', { hasText: 'Terrain' }).getByRole('button', { name: 'Save as surface' }).click();
  await w.waitForFunction(() => window.mmr.doc.entities.some((e) => e.meta?.surface && /Terrain/.test(e.meta.source || '')), null, { timeout: 15000 });
  const surf = await w.evaluate(() => {
    const e = window.mmr.doc.entities.find((x) => x.meta?.surface);
    const ys = e.mesh.v.map((v) => v[1] + e.position[1]);
    return { min: Math.min(...ys), max: Math.max(...ys), faces: e.mesh.f.length };
  });
  assert.ok(surf.min >= 19.9 && surf.max <= 36.1 && surf.faces > 100, `heights from the tiles: ${JSON.stringify(surf)}`);
  // buildings: footprints with ground and roof heights stand up as one merged mesh, then come in as prisms
  await ok('add_map_layer', { url: 'https://bag.test/wfs?SERVICE=WFS&REQUEST=GetCapabilities', name: 'Buildings', style: { fill: '#d9d4c7', extrude: { base: 'ground', top: 'roof' } } });
  await w.waitForFunction(() => {
    const L = window.mmr.doc.settings.map_layers.find((x) => x.name === 'Buildings');
    const m = window.mmr.app.mapLayers.groups.get(L.id)?.group.children.find((o) => o.isMesh);
    if (!m) return false;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    return Math.abs(b.max.y - b.min.y - 9) < 0.01 && Math.abs(b.min.y - 21) < 0.01;
  }, null, { timeout: 15000 });
  const r = await ok('import_features', { layer: 'Buildings', at: [0, 0], radius: 200 });
  assert.equal(r.buildings, 1);
  const b = await ok('get_entity', { id: 'Depot' });
  assert.ok(Math.abs(b.min[1] - 21) < 0.01 && Math.abs(b.max[1] - 30) < 0.01, `the depot from 21 to 30 m: ${b.min[1]} ${b.max[1]}`);
});

test('clip volumes (#290, #291): the shader cuts, the Clip Box tool, face handles with the mouse, a typed distance, panes, animation', async () => {
  await ok('new_model');
  await w.evaluate(() => window.mmr.app.ui.setRibbon(null));
  await ok('set_style', { grid: false });
  await ok('create_box', { width: 10, depth: 30, height: 2, name: 'Embankment', color: '#9a9a9a' });
  await ok('create_cylinder', { radius: 0.6, height: 12, position: [0, 0.8, -6], rotation: [90, 0, 0], name: 'Culvert', color: '#c8553d' });
  await ok('set_camera', { position: [18, 16, 24], target: [0, 1, 0] });
  await ok('select', { ids: ['Culvert'] });
  await ok('add_clip', { kind: 'box', from: 'selection', margin: 1 });
  // every model material is patched and the main pane's mask has the box's bit; what the box hides is not picked
  const st = await w.evaluate(() => {
    const vp = window.mmr.app.viewport;
    vp.render();
    let patched = 0;
    let all = 0;
    vp.modelRoot.traverse((o) => o.material && (all++, o.material.userData.mmrClip && patched++));
    return { patched, all, far: vp.unclipped([4, 1.5, 12], null), near: vp.unclipped([0, 0.8, 0], null) };
  });
  assert.equal(st.patched, st.all, 'every material honours the clips');
  assert.equal(st.far, false);
  assert.equal(st.near, true);
  await ok('clear_clips');
  // the Clip Box tool: three clicks, one clip, one undo step
  const toScreen = (p) => w.evaluate((q) => { const s = window.mmr.app.viewport.toScreen(new window.mmr.THREE.Vector3(...q)); return [s.x, s.y]; }, p);
  await w.evaluate(() => window.mmr.app.tools.set('clipbox'));
  const undo0 = await w.evaluate(() => window.mmr.app.store.undoStack.length);
  const [a, b, c] = [await toScreen([-7, 0, 9]), await toScreen([7, 0, -5]), await toScreen([7, 4, -5])];
  await w.mouse.move(...a);
  await w.mouse.click(...a);
  await w.mouse.move(b[0] - 10, b[1]);
  await w.mouse.move(...b);
  await w.mouse.click(...b);
  await w.mouse.move(c[0], c[1] + 10);
  await w.mouse.move(...c);
  await w.mouse.click(...c);
  await w.waitForTimeout(300);
  let l = await ok('list_clips');
  assert.equal(l.clips.length, 1);
  assert.equal((await w.evaluate(() => window.mmr.app.store.undoStack.length)) - undo0, 1, 'one undo step');
  assert.equal(await w.evaluate(() => window.mmr.app.clipSelected), 'Box 1', 'the new box is selected, its handles on');
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  await ok('set_clip', { name: 'Box 1', center: [0, 2, 0], size: [8, 4, 8], rotation: [0, 0, 0] });
  const face = (name, list) => list.clips[0].planes.find((p) => p.face === name).point;
  const handle = (faces) => w.evaluate((f) => { const g = window.mmr.app.clipGizmo; const h = g.handles.find((x) => x.faces.join() === f); const s = window.mmr.app.viewport.toScreen(h.p); return [s.x, s.y]; }, faces);
  // drag the top face down: only it moves
  let [x, y] = await handle('+y');
  await w.mouse.move(x, y);
  await w.mouse.down();
  for (let i = 1; i <= 5; i++) await w.mouse.move(x, y + i * 8);
  await w.mouse.up();
  await w.waitForTimeout(300);
  const before = await ok('list_clips');
  assert.ok(face('+y', before)[1] < 4, `the top face came down: ${face('+y', before)[1]}`);
  assert.equal(face('-y', before)[1], 0, 'the bottom stays');
  // a typed distance while dragging: exactly 2.5 m down
  await ok('set_clip', { name: 'Box 1', center: [0, 2, 0], size: [8, 4, 8] });
  [x, y] = await handle('+y');
  await w.mouse.move(x, y);
  await w.mouse.down();
  for (let i = 1; i <= 3; i++) await w.mouse.move(x, y + i * 8);
  await w.keyboard.type('2.5');
  await w.keyboard.press('Enter');
  await w.mouse.up();
  await w.waitForTimeout(300);
  l = await ok('list_clips');
  assert.equal(face('+y', l)[1], 1.5, 'top 4 → 1.5');
  assert.equal(face('-y', l)[1], 0);
  await ok('undo');
  assert.equal(face('+y', await ok('list_clips'))[1], 4, 'undo restores the box');
  await ok('redo');
  assert.equal(face('+y', await ok('list_clips'))[1], 1.5, 'redo re-applies it');
  // Ctrl: both sides move
  await ok('set_clip', { name: 'Box 1', center: [0, 2, 0], size: [8, 4, 8] });
  [x, y] = await handle('+x');
  const [x2] = await toScreen([8, 2, 0]);
  await w.keyboard.down('Control');
  await w.mouse.move(x, y);
  await w.mouse.down();
  for (let i = 1; i <= 4; i++) await w.mouse.move(x + ((x2 - x) * i) / 4, y);
  await w.mouse.up();
  await w.keyboard.up('Control');
  await w.waitForTimeout(300);
  l = await ok('list_clips');
  assert.ok(Math.abs(face('+x', l)[0] + face('-x', l)[0]) < 1e-6 && face('+x', l)[0] > 4.5, `symmetric: ${face('+x', l)[0]} / ${face('-x', l)[0]}`);
  // a click anywhere on a face (not its handle) picks that face; a typed value then moves it (+ outward)
  await ok('set_clip', { name: 'Box 1', center: [0, 2, 0], size: [8, 4, 8] });
  const onTop = await toScreen([2, 4, 2]);
  await w.mouse.move(...onTop);
  await w.mouse.click(...onTop);
  assert.equal(await w.evaluate(() => window.mmr.app.clipGizmo.face), '+y');
  await w.keyboard.type('1');
  await w.keyboard.press('Enter');
  await w.waitForTimeout(300);
  l = await ok('list_clips');
  assert.equal(face('+y', l)[1], 5, 'the picked face out 1 m');
  assert.equal(face('-y', l)[1], 0);
  // pane 2 (top, parallel) of a four-pane layout: a clip that cuts pane 2 only, and a handle dragged there
  await ok('set_layout', { count: 4 });
  await ok('zoom_extents', { pane: 'all' });
  await ok('add_clip', { kind: 'slab', point: [0, 1, 0], normal: [0, 1, 0], thickness: 0.5, panes: [2] });
  const seen = await w.evaluate(() => { const vp = window.mmr.app.viewport; const p = vp.extra.find((e) => e.i === 1); return [vp.unclipped([0, 2, 0], null), vp.withPane(p, () => vp.unclipped([0, 2, 0], null))]; });
  assert.deepEqual(seen, [true, false], 'the slab cuts pane 2 only');
  await ok('set_clip', { name: 'Box 1', center: [0, 2, 0], size: [8, 4, 8] });
  const p2 = await w.evaluate(() => { const vp = window.mmr.app.viewport; const p = vp.extra.find((e) => e.i === 1); return vp.withPane(p, () => { const h = window.mmr.app.clipGizmo.handles.find((e) => e.faces.join() === '+x'); const s = vp.toScreen(h.p); return [s.x, s.y]; }); });
  await w.mouse.move(...p2);
  await w.mouse.down();
  for (let i = 1; i <= 4; i++) await w.mouse.move(p2[0] + i * 6, p2[1]);
  await w.mouse.up();
  await w.waitForTimeout(300);
  l = await ok('list_clips');
  assert.ok(face('+x', l)[0] > 4.01 && face('-x', l)[0] === -4, `pane 2 drag: +x ${face('+x', l)[0]}, -x ${face('-x', l)[0]}`);
  await ok('set_layout', { count: 1 });
  // animation: two keys on clip:Box 1 size move the shader's box
  await ok('animate', { target: 'clip:Box 1', property: 'size', from: [2, 2, 2], to: [10, 4, 10], start: 0, end: 2 });
  await ok('playback', { action: 'seek', time: 2 });
  const half = await w.evaluate(() => { const vp = window.mmr.app.viewport; vp.clipFor(1); return vp.posed()?.['clip:Box 1']?.size; });
  assert.deepEqual(half, [10, 4, 10]);
  await w.evaluate(() => window.mmr.app.selectClip(null));
  await ok('clear_clips');
});

test('point cloud display: styles per pane, EDL, x-ray, filters on snapping, a slab with a ghost outside', async () => {
  const { streetScan } = await import('../fixtures/streetscan.js');
  const scan = streetScan();
  const file = path.join(home, 'street.las');
  fs.writeFileSync(file, scan.bytes);
  await ok('new_model');
  const pc = await ok('import_point_cloud', { path: file });
  await ok('set_style', { grid: false });
  await ok('set_camera', { position: [75, 32, 22], target: [28, 2, -24] });
  await ok('select', { mode: 'none' });
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  w.on('console', (m) => /GL_|Feedback loop|shader/i.test(m.text()) && errors.push(m.text())); // GL errors: e.g. the EDL texture read while written
  // a frame's pixels: how many are darker than the sky
  const dark = (limit = 200) => w.evaluate((lim) => {
    const vp = window.mmr.app.viewport;
    vp.render();
    const c = document.createElement('canvas');
    [c.width, c.height] = [vp.canvas.width, vp.canvas.height];
    const g = c.getContext('2d');
    g.drawImage(vp.canvas, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2] < lim ? 1 : 0;
    return n;
  }, limit);
  await ok('set_cloud_style', { id: pc.id, color_by: 'single', color: '#d0d0d0', size: 3 });
  const flat = await dark();
  await ok('set_cloud_style', { id: pc.id, edl: true });
  const edl = await dark();
  assert.ok(edl > flat + 500, `EDL darkens edges: ${flat} → ${edl}`);
  await ok('set_cloud_style', { id: pc.id, edl: false, depth: 'xray', color_by: 'rgb' });
  await ok('set_view', { preset: 'top' });
  assert.ok((await dark()) > 100, 'x-ray: walls seen edge on build up');
  await ok('set_cloud_style', { id: pc.id, depth: 'off', shape: 'paraboloid', size_mode: 'attenuated', size: 0.03 });
  await dark();
  // per pane: the material sets itself up for each renderer
  await ok('set_layout', { count: 2 });
  await ok('set_cloud_style', { id: pc.id, pane: 2, color_by: 'intensity' });
  const modes = await w.evaluate(() => {
    const vp = window.mmr.app.viewport;
    const o = [...vp.objs.values()].find((x) => x.userData.cloudEntity);
    const seen = [];
    const before = o.material.onBeforeRender;
    o.material.onBeforeRender = function (r, ...rest) {
      before.call(this, r, ...rest);
      seen.push([r.mmrPane, this.uniforms.uMode.value]);
    };
    vp.render();
    o.material.onBeforeRender = before;
    return seen;
  });
  assert.deepEqual(modes, [[1, 0], [2, 1]], 'pane 1 RGB, pane 2 intensity');
  await ok('set_layout', { count: 1 });
  // what you see is what you snap to: vegetation hidden, then the ghost outside a section
  const snaps = () => w.evaluate(() => (window.mmr.app.viewport.vertexCache = null, window.mmr.app.viewport.snapPoints().filter((s) => s.kind === 'Point cloud').length));
  const all = await snaps();
  await ok('set_cloud_filter', { id: pc.id, classes: { hide: [3, 4, 5] } });
  const noTrees = await snaps();
  assert.ok(noTrees < all, `${all} → ${noTrees}`);
  // a 20 cm slab whose outside is a ghost (#296): the slab points crisp, the rest faint, only slab points snap
  await ok('add_clip', { kind: 'slab', name: 'Wall slab', point: [0, 3, 0], normal: [0, 1, 0], thickness: 0.2, outside: 'ghost' });
  assert.equal((await ok('list_clips')).clips[0].outside, 'ghost');
  const inSlab = await w.evaluate(() => (window.mmr.app.viewport.vertexCache = null, window.mmr.app.viewport.snapPoints().filter((s) => s.kind === 'Point cloud').map((s) => s.p.y)));
  assert.ok(inSlab.length && inSlab.every((y) => Math.abs(y - 3) <= 0.1001), `only slab points snap: ${inSlab.length}`);
  const ghost = await dark(600); // anything darker than the sky
  await ok('set_clip', { name: 'Wall slab', outside: 'hidden' });
  assert.ok(ghost > (await dark(600)), 'the ghost draws what the slab cuts away');
  await ok('delete_clip', { name: 'Wall slab' });
  const classes = await ok('list_cloud_classes', { id: pc.id });
  assert.equal(classes.classes.find((c) => c.code === 6).count, scan.counts[6]);
  assert.deepEqual(errors, []);
});

test('SpaceMouse (#303): injected reports move the camera of the pane under the cursor, buttons run commands, the mapping is kept', async () => {
  await ok('new_model');
  await ok('set_layout', { count: 1 });
  await ok('create_terrain', { width: 60, depth: 40, spacing: 4, name: 'Ground' });
  await ok('set_spacemouse', { mode: 'object', pivot: 'view', speed: 1, dominant: false });
  await ok('set_camera', { position: [30, 25, 40], target: [0, 0, 0] });
  const cam = (i = 0) => w.evaluate((n) => window.mmr.app.panes.all()[n].camera?.position.toArray() || window.mmr.app.viewport.camera.position.toArray(), i);
  const axes = (...v) => [...new Uint8Array(new Int16Array(v).buffer)];
  const feed = (id, b) => w.evaluate(([i, x]) => window.mmr.spacemouse.feed(i, x), [id, b]);
  const push = async (raw, ms = 400) => {
    await feed(1, axes(...raw));
    await w.waitForTimeout(ms);
    await feed(1, axes(0, 0, 0, 0, 0, 0));
    await w.waitForTimeout(100);
  };
  const len = (p) => Math.hypot(...p);
  // at rest, noise inside the dead zone moves nothing
  const a0 = await cam();
  await push([6, -4, 3, 2, -5, 1], 300);
  assert.deepEqual(await cam(), a0, 'no drift at rest');
  // object mode: a twist turns the view around the target, at the same distance; released, it stops
  await push([0, 0, 0, 0, 0, -300]);
  const a1 = await cam();
  assert.ok(Math.hypot(a1[0] - a0[0], a1[2] - a0[2]) > 1, `turned: ${a0} → ${a1}`);
  assert.ok(Math.abs(len(a1) - len(a0)) < 0.5, 'around the target');
  await w.waitForTimeout(200);
  assert.deepEqual(await cam(), a1, 'stops when released');
  // fly mode: pushing forward moves the eye forward
  await ok('set_spacemouse', { mode: 'fly' });
  await push([0, -300, 0, 0, 0, 0]);
  const a2 = await cam();
  assert.ok(len(a2) < len(a1) - 1, `flew forward: ${len(a1)} → ${len(a2)}`);
  // buttons: Fit (bit 1) fits the model; a mapped button 1 (bit 12) sets the top view
  await ok('set_camera', { position: [400, 300, 500], target: [0, 0, 0] });
  await feed(3, [2, 0, 0, 0]);
  await feed(3, [0, 0, 0, 0]);
  await w.waitForFunction(() => window.mmr.app.viewport.camera.position.length() < 300);
  await ok('map_spacemouse_button', { button: '1', command: 'set_view', args: { preset: 'top' } });
  await feed(3, [0, 16, 0, 0]);
  await feed(3, [0, 0, 0, 0]);
  await w.waitForFunction(() => {
    const v = window.mmr.app.viewport;
    return Math.hypot(v.camera.position.x - v.controls.target.x, v.camera.position.z - v.controls.target.z) < 0.01;
  });
  const d = await ok('list_input_devices');
  assert.equal(d.last_button, '1');
  assert.ok(Array.isArray(d.devices));
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')).spacemouse;
  assert.deepEqual(saved.buttons['1'], { command: 'set_view', args: { preset: 'top' } }, 'kept in settings.json');
  assert.equal(saved.mode, 'fly');
  // clip box hold: button 2 mapped to sm:clip (bit 13); the puck moves the selected box, a hovered face is pushed, release = one undo step
  await ok('add_clip', { kind: 'box', name: 'Scan box', center: [0, 2, 0], size: [10, 4, 10] });
  await w.evaluate(() => window.mmr.app.selectClip('Scan box'));
  await ok('map_spacemouse_button', { button: '2', action: 'sm:clip' });
  await ok('set_camera', { position: [0, 20, 40], target: [0, 0, 0] });
  const clip = () => w.evaluate(() => structuredClone(window.mmr.doc.clips.find((c) => c.name === 'Scan box')));
  const undo0 = await w.evaluate(() => window.mmr.app.store.undoStack.length);
  await feed(3, [0, 32, 0, 0]);
  await push([300, 0, 0, 0, 0, 0]);
  assert.deepEqual((await clip()).center, [0, 2, 0], 'previewed while held, the document unchanged');
  await w.evaluate(() => Object.assign(window.mmr.app.clipGizmo, { hover: null, face: '+y' })); // no handle under the mouse: the Tab-picked face
  await push([0, 300, 0, 0, 0, 0]); // pulled towards you: the picked face comes out
  await feed(3, [0, 0, 0, 0]);
  await w.waitForFunction(() => window.mmr.doc.clips.find((c) => c.name === 'Scan box').center[0] > 0.5);
  const moved = await clip();
  assert.ok(moved.size[1] > 4.2, `the top face came up: ${moved.size}`);
  assert.equal(await w.evaluate(() => window.mmr.app.store.undoStack.length), undo0 + 1, 'one undo step');
  await ok('undo');
  assert.deepEqual((await clip()).center, [0, 2, 0]);
  await w.evaluate(() => ((window.mmr.app.clipGizmo.face = null), window.mmr.app.selectClip(null)));
  await ok('clear_clips');
  // four panes: the pane under the cursor moves, the others stay; 2D mode pans
  await ok('set_layout', { count: 4 });
  await ok('zoom_extents', { pane: 'all' });
  await ok('set_spacemouse', { mode: '2d' });
  await w.evaluate(() => window.mmr.app.panes.focus(1));
  const [m0, p0] = [await cam(0), await cam(1)];
  await push([300, 0, 0, 0, 0, 300]);
  const [m1, p1] = [await cam(0), await cam(1)];
  assert.deepEqual(m1, m0, 'the main pane stayed');
  assert.ok(Math.abs(p1[0] - p0[0]) > 0.5 && Math.abs(p1[1] - p0[1]) < 1e-6, `pane 2 panned in plan: ${p0} → ${p1}`);
  await w.evaluate(() => window.mmr.app.panes.focus(0));
  await ok('set_layout', { count: 1 });
  await ok('set_spacemouse', { mode: 'object' });
});

test('point cloud octree (#293, #294): the synthetic scan converts in the worker, streams, and a picked point is the source point', async () => {
  const { makeScan, writeLas } = await import('../fixtures/scan.js');
  const scan = makeScan({ points: 400000 });
  const file = path.join(home, 'corridor.las');
  fs.writeFileSync(file, writeLas(scan));
  await ok('new_model');
  const r = await ok('import_point_cloud', { path: file, octree: true, name: 'Corridor scan' });
  assert.ok(r.job, 'a job id at once');
  let state = null;
  for (let i = 0; i < 150 && state?.octree !== 'ready'; i++) {
    await new Promise((res) => setTimeout(res, 200));
    state = await ok('point_cloud_job', { id: 'Corridor scan' });
  }
  assert.equal(state.octree, 'ready', 'the app attached the finished octree');
  assert.equal(state.points, 400000);
  await ok('zoom_extents');
  // the frame's nodes, loaded (screenshots wait for them)
  await w.evaluate(() => window.mmr.app.viewport.clouds.settle(() => window.mmr.app.viewport.render()));
  const perf = await ok('performance_report');
  assert.ok(perf.cloud_nodes > 1 && perf.cloud_points > 50000, JSON.stringify(perf));
  const p = await ok('pick_cloud_point', { x: 0.5, y: 0.5, pixels: 30 });
  assert.ok(p.project, 'a point under the middle of the view');
  let best = Infinity;
  let at = -1;
  for (let i = 0; i < scan.count; i++) {
    const d = Math.hypot(scan.x[i] - p.project[0], scan.y[i] - p.project[1], scan.z[i] - p.project[2]);
    if (d < best) (best = d), (at = i);
  }
  assert.ok(best < 1e-3, `the source point, within 1 mm: ${best}`);
  assert.equal(p.classification, scan.classification[at]);
  assert.equal(p.intensity, scan.intensity[at]);
  // the budget is an app setting, clamped to 0.5–20 M
  assert.equal((await ok('set_cloud_budget', { points: 100 })).points, 500000);
  await ok('set_cloud_budget', { points: 3000000 });
  const e = (await ok('get_scene')).entities.find((x) => x.name === 'Corridor scan');
  assert.ok(e, 'the cloud is in the scene');
});

test('classification (#298) and class edits (#299): a background pass, a lasso and the vehicle key, front only, grow, locks, cancel, undo, LAS export', async () => {
  const F = await import('../fixtures/scan.js');
  const T = await import('../fixtures/truck.js');
  const PC = await import('../../src/core/pointcloud.js');
  const file = path.join(home, 'corridor-unclassified.las');
  fs.writeFileSync(file, F.writeLas(T.withTruck(F.makeScan({ points: 400000, seed: 5 }))));
  await ok('new_model');
  const id = 'Corridor scan';
  await ok('import_point_cloud', { path: file, octree: true, name: id });
  for (let i = 0; i < 150 && (await ok('point_cloud_job', { id })).octree !== 'ready'; i++) await new Promise((res) => setTimeout(res, 200));
  const status = () => w.evaluate((n) => window.mmr.app.store.doc.entities.find((e) => e.name === n).pointcloud.classify?.status, id);
  const until = async (fn, ms = 60000) => {
    const end = Date.now() + ms;
    while (!(await fn()) && Date.now() < end) await new Promise((res) => setTimeout(res, 250));
    return fn();
  };
  const counts = async () => Object.fromEntries((await ok('list_cloud_classes', { id })).classes.map((c) => [c.code, c.count]));
  // the automatic pass, in the background, brought in by the app
  const r = await ok('classify_cloud', { id });
  assert.equal(r.status, 'running');
  const job = await ok('point_cloud_job', { id });
  assert.equal(job.task, 'classify');
  assert.equal(await until(async () => (await status()) === 'done'), true, 'attached when it finished');
  const c1 = await counts();
  assert.ok(c1[2] > 200000 && c1[6] > 15000 && c1[5] > 10000, JSON.stringify(c1));
  assert.equal(Object.values(c1).reduce((a, b) => a + b, 0), 400000 + Math.round(0.012 * 400000), 'every point counted');
  await ok('set_cloud_style', { id, color_by: 'classification' });
  // the van, tagged building: lasso it on screen, keep its building points, press 0
  const base = await w.evaluate((n) => window.mmr.app.store.doc.entities.find((e) => e.name === n).pointcloud.base, id);
  const at = (e, n, up = 0) => [e - base[0], F.groundAt(e, n) - base[2] + up, -(n - base[1])];
  const [vx, vy] = [(T.TRUCK.min[0] + T.TRUCK.max[0]) / 2, (T.TRUCK.min[1] + T.TRUCK.max[1]) / 2];
  await ok('set_camera', { position: at(vx + 12, vy - 13, 9), target: at(vx, vy, 1.4) });
  const corners = [];
  for (const x of [T.TRUCK.min[0], T.TRUCK.max[0]]) for (const y of [T.TRUCK.min[1], T.TRUCK.max[1]]) for (const z of [0.2, 3]) corners.push(at(x, y, z));
  const sc = await w.evaluate((cs) => { const vp = window.mmr.app.viewport; return cs.map((p) => { const v = vp.camera.position.clone().set(...p).project(vp.camera); return [(v.x + 1) / 2, (1 - v.y) / 2]; }); }, corners);
  const [x0, x1, y0, y1] = [Math.min(...sc.map((p) => p[0])) - 0.03, Math.max(...sc.map((p) => p[0])) + 0.03, Math.min(...sc.map((p) => p[1])) - 0.03, Math.max(...sc.map((p) => p[1])) + 0.03];
  await w.evaluate(() => window.mmr.app.tools.set('pointselect'));
  const sel = await ok('select_points', { id, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], classes: [6] });
  assert.ok(sel.selected > 3000, `the van's points: ${sel.selected}`);
  assert.ok(sel.bounds.min[0] > T.TRUCK.min[0] - 0.1 && sel.bounds.max[0] < T.TRUCK.max[0] + 0.1 && sel.bounds.min[1] > T.TRUCK.min[1] - 0.1 && sel.bounds.max[1] < T.TRUCK.max[1] + 0.1, `only the van: ${JSON.stringify(sel.bounds)}`);
  const edits0 = await w.evaluate((n) => window.mmr.app.store.doc.entities.find((e) => e.name === n).pointcloud.edits.length, id);
  await w.evaluate(() => window.mmr.app.tools.key(new KeyboardEvent('keydown', { key: '0' })));
  await until(async () => (await counts())[65] === sel.selected, 10000);
  const c2 = await counts();
  assert.equal(c2[65], sel.selected, 'the vehicle key');
  assert.equal(c2[6], c1[6] - sel.selected, 'the legend counts follow');
  await w.evaluate(() => window.mmr.app.viewport.render());
  assert.match(await w.evaluate(() => document.querySelector('.cloud-legend')?.textContent || ''), /Vehicle/);
  const t0 = Date.now();
  await ok('undo');
  const undoMs = Date.now() - t0;
  const c3 = await counts();
  assert.equal(c3[65] || 0, 0, 'one undo step takes the edit back');
  assert.equal(c3[6], c1[6]);
  assert.equal(await w.evaluate((n) => window.mmr.app.store.doc.entities.find((e) => e.name === n).pointcloud.edits.length, id), edits0);
  assert.ok(undoMs < 1000, `undo in ${undoMs} ms`);
  await ok('redo');
  // lock the vehicle; a later automatic pass leaves it
  await ok('select_points', { id, classes: [65] });
  await ok('set_point_class', { lock: true });
  await ok('classify_cloud', { id, steps: ['ground', 'buildings'] });
  await until(async () => (await status()) === 'done');
  assert.equal((await counts())[65], sel.selected, 'locked points are untouched');
  // cancel leaves the cloud as it was
  const before = await counts();
  await ok('classify_cloud', { id, steps: ['noise', 'ground', 'vegetation', 'buildings', 'road'] });
  await ok('cancel_point_cloud_job', { id });
  assert.equal(await until(async () => (await status()) === 'cancelled', 10000), true);
  assert.deepEqual(await counts(), before, 'cancel: the classes as they were');
  // front only: the near wall of the flat-roofed building, not the one behind it
  const b = F.SITE.buildings[0];
  const [ox, oy] = F.SITE.origin;
  await ok('clear_point_selection');
  await ok('set_camera', { position: [ox + 21 - base[0], b.base - base[2] + 3, -(oy + 40 - base[1])], target: [ox + 21 - base[0], b.base - base[2] + 3, -(oy + 60 - base[1])] });
  const whole = [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]];
  const all = await ok('select_points', { id, polygon: whole, classes: [6], elevation: [b.base + 0.5, b.base + 5.5] });
  const front = await ok('select_points', { id, polygon: whole, classes: [6], elevation: [b.base + 0.5, b.base + 5.5], front_only: true });
  assert.ok(all.bounds.max[1] > oy + 64, 'through everything reaches the far wall');
  assert.ok(front.bounds.max[1] < oy + 58 && front.selected < all.selected * 0.6, `front only stops at the near wall: ${JSON.stringify(front.bounds)} ${front.selected} of ${all.selected}`);
  // grow from a point of that wall: its plane, to its corners and no further
  const g = await ok('select_points', { id, grow_from: [ox + 21, oy + 55, b.base + 3] });
  assert.ok(g.bounds.max[1] - g.bounds.min[1] < 0.3, `one wall: ${JSON.stringify(g.bounds)}`);
  assert.ok(g.bounds.max[0] - g.bounds.min[0] > 10, 'the whole wall, corner to corner');
  await ok('clear_point_selection');
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  // export to LAS 1.4 with the edited classes, in the background
  const out = path.join(home, 'corridor-classified.las');
  const ex = await ok('export_point_cloud', { id, path: out });
  assert.ok(ex.job);
  await until(async () => fs.existsSync(out), 30000);
  const h = PC.lasHeader(new Uint8Array(fs.readFileSync(out).subarray(0, 4096)));
  assert.equal(h.version, '1.4');
  assert.equal(h.count, 400000 + Math.round(0.012 * 400000));
  const back = PC.parsePointCloud(new Uint8Array(fs.readFileSync(out)), 'x.las');
  assert.equal(back.classification.filter((c) => c === 65).length, sel.selected, 'the edited classes in the file');
});

test('slices (#292): a plan slice of a scan, square-on in pane 2, snapping to its points, a series stepped with PageDown, a scene, a sweep', async () => {
  await ok('new_model');
  await w.evaluate(() => window.mmr.app.ui.setRibbon(null));
  await ok('import_point_cloud', { path: path.resolve('docs/how-to/samples/slice-site.ply') });
  await ok('create_alignment', { name: 'Main road', points: [[-60, 25], [60, 15]] });
  const s = await ok('add_slice', { at: 'elevation', z: 1.2, above: 'ground', thickness: 0.2 });
  assert.ok(s.stats.count > 1000 && s.stats.width > 60, `the two wall rings: ${s.stats.count} points, ${s.stats.width} m`);
  assert.ok(s.stats.histogram.counts.length === 10);
  const v = await ok('view_clip', { name: 'Slice 1', pane: 2 });
  const L = await w.evaluate(() => window.mmr.doc.settings.layout);
  assert.equal(L.count, 2);
  assert.equal(L.panes[1].projection, 'parallel');
  assert.notEqual(L.panes[0].projection, 'parallel', 'pane 1 stays 3D');
  assert.ok(v.camera.position[1] - v.camera.target[1] > 20, 'looking down');
  // drawing a line in pane 2 snaps to the slice's points: both ends land on scan points inside the slab
  const [bot, top] = [s.clip.point[1] - 0.1, s.clip.point[1] + 0.1];
  const pick = await w.evaluate(() => {
    const vp = window.mmr.app.viewport;
    const p = vp.extra.find((e) => e.i === 1);
    return vp.withPane(p, () => {
      vp.vertexCache = null;
      const cloud = vp.snapPoints().filter((x) => x.kind === 'Point cloud');
      const ends = [cloud.reduce((a, b) => (b.p.x < a.p.x ? b : a)), cloud.reduce((a, b) => (b.p.x > a.p.x ? b : a))];
      return { ys: cloud.map((x) => x.p.y), screen: ends.map((e) => { const q = vp.toScreen(e.p); return [q.x + 2, q.y + 1]; }) };
    });
  });
  assert.ok(pick.ys.length > 500 && pick.ys.every((y) => y >= bot - 1e-6 && y <= top + 1e-6), `${pick.ys.length} snap points, all in the slab`);
  await w.evaluate(() => window.mmr.app.tools.set('line'));
  for (const q of pick.screen) {
    await w.mouse.move(q[0] - 6, q[1]);
    await w.mouse.move(...q);
    await w.mouse.click(...q);
  }
  await w.keyboard.press('Enter');
  await w.waitForTimeout(300);
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  const line = await w.evaluate(() => { const e = window.mmr.doc.entities.find((x) => x.name.startsWith('Line')); return e && e.curve.points.map((p) => [p[0] + e.position[0], p[1] + e.position[1], p[2] + e.position[2]]); });
  assert.ok(line?.length === 2, 'a line was drawn');
  for (const p of line) assert.ok(p[1] >= bot - 1e-3 && p[1] <= top + 1e-3, `a line end on a slice point: ${p}`);
  assert.ok(Math.abs(line[0][0] - line[1][0]) > 40, 'from one building to the other');
  // a scene keeps the slice and the camera
  await ok('add_scene', { name: 'Level 1 slice', pane: 2 });
  await ok('clear_clips');
  await ok('set_camera', { pane: 2, position: [50, 50, 50], target: [0, 0, 0] });
  await ok('go_to_scene', { name: 'Level 1 slice', pane: 2 });
  assert.deepEqual((await ok('list_clips')).clips.map((c) => c.name), ['Slice 1']);
  const cam = await w.evaluate(() => { const vp = window.mmr.app.viewport; return vp.withPane(vp.extra[0], () => vp.getCamera()); });
  assert.deepEqual(cam.target, v.camera.target);
  // cross-sections every 20 m: PageDown steps, pane 2 follows
  await ok('clear_clips');
  const series = await ok('slice_series', { at: 'station', alignment: 'Main road', from: 0, to: 120, step: 20, thickness: 0.5 });
  assert.equal(series.slices.length, 7);
  await ok('view_clip', { name: 'Station 0', pane: 2 });
  const t0 = await w.evaluate(() => { const vp = window.mmr.app.viewport; return vp.withPane(vp.extra[0], () => vp.getCamera().target); });
  await w.mouse.click(5, 300); // focus the page, off the canvases
  await w.keyboard.press('PageDown');
  await w.waitForTimeout(300);
  const on = (await ok('list_clips')).clips.filter((c) => c.enabled !== false).map((c) => c.name);
  assert.deepEqual(on, ['Station 20']);
  const t1 = await w.evaluate(() => { const vp = window.mmr.app.viewport; return vp.withPane(vp.extra[0], () => vp.getCamera().target); });
  assert.ok(Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) > 19, `the camera moved along the road: ${t0} → ${t1}`);
  await w.keyboard.press('PageUp');
  await w.waitForTimeout(300);
  assert.deepEqual((await ok('list_clips')).clips.filter((c) => c.enabled !== false).map((c) => c.name), ['Station 0']);
  // a level slab swept up through the buildings, rendered
  await ok('set_layout', { count: 1 });
  await ok('clear_clips');
  await ok('add_slice', { at: 'elevation', z: 0.5, above: 'ground', thickness: 0.5, name: 'Sweep' });
  const sw = await ok('animate_section', { clip: 'Sweep', from: 0, to: 6, start: 0, end: 1 });
  assert.ok(sw.to[1] - sw.from[1] > 5.9);
  await ok('set_timeline', { duration: 1, fps: 6 });
  const gif = await ok('render_video', { path: path.join(home, 'out', 'sweep.gif'), width: 160, height: 90, fps: 6 });
  assert.equal(gif.frames, 6);
  await ok('playback', { action: 'seek', time: 1 });
  const y = await w.evaluate(() => { const vp = window.mmr.app.viewport; vp.clipFor(1); return vp.posed()?.['clip:Sweep']?.point?.[1]; });
  assert.ok(Math.abs(y - sw.to[1]) < 1e-3, `the slab is at the top at the end: ${y}`);
  await ok('clear_clips');
});

test('features in a scan (#300): planes, corners and kerbs from a streamed octree, in the worker; lines snap to corners; a box aligns to a roof; a proposal rejected', async () => {
  const { makeScan, writeLas, SITE } = await import('../fixtures/scan.js');
  const file = path.join(home, 'detect.las');
  fs.writeFileSync(file, writeLas(makeScan({ points: 2000000 })));
  await ok('new_model');
  await w.evaluate(() => window.mmr.app.ui.setRibbon(null));
  await ok('import_point_cloud', { path: file, octree: true, name: 'Corridor scan' });
  let state = null;
  for (let i = 0; i < 300 && state?.octree !== 'ready'; i++) {
    await new Promise((res) => setTimeout(res, 200));
    state = await ok('point_cloud_job', { id: 'Corridor scan' });
  }
  assert.equal(state.octree, 'ready');
  const b = await w.evaluate(() => window.mmr.doc.geo.base);
  const O = SITE.origin;
  const L = (x, n, z = 0) => [O[0] + x - b[0], O[2] + z - b[2], -(O[1] + n - b[1])];
  await ok('add_clip', { kind: 'box', name: 'Buildings', center: L(44, 58.5, 6), size: [64, 14, 20] });
  // planes: read at full depth from the octree inside the box, found in the worker
  const p = await ok('detect_planes', { within: 'Buildings', min_points: 300 });
  assert.ok(p.scope.points > 300000, `full depth inside the box: ${p.scope.points}`);
  assert.ok(p.by_type.vertical >= 8 && p.by_type.sloped >= 2, JSON.stringify(p.by_type));
  assert.ok(JSON.stringify(await ok('list_layers')).includes('"Detected"'), 'a Detected layer');
  // corners of the building points only (class 6), between the planes found above
  const c = await ok('detect_corners', { within: 'Buildings', planes: p.ids, classes: [6] });
  assert.equal(c.count, 8);
  for (const B of SITE.buildings) for (const [e, n] of B.footprint) assert.ok(c.corners.some((k) => Math.hypot(k.at[0] - e, k.at[1] - n) < 0.03), `a corner within 3 cm of ${e}, ${n}`);
  // the Line tool from one CORNER point to another lands exactly on them
  const near = (x, n) => c.corners.find((k) => Math.hypot(k.at[0] - O[0] - x, k.at[1] - O[1] - n) < 0.1).point;
  const names = [near(15, 55), near(27, 65)];
  await ok('set_camera', { position: L(5, 40, 14), target: L(21, 60, 4) });
  await w.waitForTimeout(500);
  const screen = await w.evaluate((ns) => {
    const vp = window.mmr.app.viewport;
    vp.vertexCache = null;
    return ns.map((n) => { const e = window.mmr.doc.entities.find((x) => x.name === n); const q = vp.toScreen(new window.mmr.THREE.Vector3(...e.position)); return { at: e.position, q: [q.x + 2, q.y + 1] }; });
  }, names);
  await w.evaluate(() => window.mmr.app.tools.set('line'));
  for (const { q } of screen) {
    await w.mouse.move(q[0] - 6, q[1]);
    await w.mouse.move(...q);
    await w.mouse.click(...q);
  }
  await w.keyboard.press('Escape');
  await w.waitForTimeout(300);
  await w.evaluate(() => window.mmr.app.tools.set('select'));
  const line = await w.evaluate(() => { const e = window.mmr.doc.entities.find((x) => x.name.startsWith('Line')); return e && e.curve.points.map((q) => q.map((v, i) => v + e.position[i])); });
  assert.ok(line?.length >= 2, 'a line was drawn');
  for (const [k, end] of [line[0], line.at(-1)].entries()) assert.ok(Math.hypot(...end.map((v, i) => v - screen[k].at[i])) < 1e-3, `line end ${k} on ${names[k]}: ${end} vs ${screen[k].at}`);
  // a clip box aligned to a detected roof face
  const roof = p.planes.find((x) => x.type === 'sloped');
  await ok('add_clip', { kind: 'box', name: 'Roof', center: L(66, 57, 9), size: [14, 2, 8] });
  const al = await ok('align_clip', { name: 'Roof', to: 'face', id: roof.id, face: 0 });
  const R = await w.evaluate((rot) => new window.mmr.THREE.Matrix4().makeRotationFromEuler(new window.mmr.THREE.Euler(...rot.map((d) => (d * Math.PI) / 180))).elements, al.clip.rotation);
  const axes = [[R[0], R[1], R[2]], [R[4], R[5], R[6]], [R[8], R[9], R[10]]];
  assert.ok(axes.some((a) => Math.abs(a[0] * roof.normal[0] + a[1] * roof.normal[1] + a[2] * roof.normal[2]) > 0.9999), 'an axis along the roof normal');
  await ok('delete_clip', { name: 'Roof' });
  // kerbs along Main road
  await ok('create_alignment', { name: 'Main road', points: [[L(0, 40)[0], L(0, 40)[2]], [L(100, 40)[0], L(100, 40)[2]]] });
  const k = await ok('detect_edges', { kind: 'kerb', alignment: 'Main road' });
  assert.equal(k.count, 4);
  assert.ok(k.edges.every((x) => Math.abs(x.height - 0.15) < 0.01 && x.length > 95), JSON.stringify(k.edges));
  // proposal mode: everything found waits; reject leaves the model as it was
  const before = await w.evaluate(() => window.mmr.doc.entities.length);
  const e = await ok('detect_edges', { kind: 'intersections', within: 'Buildings', propose: true });
  assert.ok(e.count > 10 && e.proposal, `${e.count} edges in a proposal`);
  assert.ok(await w.evaluate(() => !document.getElementById('proposal-bar').hidden), 'the proposal bar shows');
  await ok('propose', { action: 'reject' });
  assert.equal(await w.evaluate(() => window.mmr.doc.entities.length), before);
  await ok('clear_clips');
});

test('scan to plan (#301): footprints and massing from a streamed octree, accepted in one undo step; wall lines from a slice; kerbs as breaklines', async () => {
  const { makeScan, writeLas, SITE } = await import('../fixtures/scan.js');
  const file = path.join(home, 'plan.las');
  fs.writeFileSync(file, writeLas(makeScan({ points: 2000000 })));
  await ok('new_model');
  await ok('import_point_cloud', { path: file, octree: true, name: 'Corridor scan' });
  let state = null;
  for (let i = 0; i < 300 && state?.octree !== 'ready'; i++) {
    await new Promise((res) => setTimeout(res, 200));
    state = await ok('point_cloud_job', { id: 'Corridor scan' });
  }
  assert.equal(state.octree, 'ready');
  const b = await w.evaluate(() => window.mmr.doc.geo.base);
  const O = SITE.origin;
  const L = (x, n, z = 0) => [O[0] + x - b[0], O[2] + z - b[2], -(O[1] + n - b[1])];
  // the Site menu form for footprints opens on the command
  const menu = w.evaluate(() => window.mmr.app.ui.actions.extractFootprints.run());
  await w.waitForSelector('#modal[open] .form');
  assert.ok((await w.textContent('#modal[open]')).includes('Extract footprint'));
  await w.keyboard.press('Escape');
  await menu;
  // footprints of the building class read at full depth, with blocks to the eaves, as a proposal
  const before = await w.evaluate(() => JSON.stringify(window.mmr.doc.entities));
  const f = await ok('extract_footprint', { extrude: true, propose: true });
  assert.equal(f.count, 2);
  assert.ok(f.scope.points > 100000, `building points at full depth: ${f.scope.points}`);
  assert.ok(await w.evaluate(() => !document.getElementById('proposal-bar').hidden), 'the proposal bar shows');
  assert.ok(f.footprints.every((x) => x.quality.guessed === 0 && Math.abs(x.area - 120) < 1.2), JSON.stringify(f.footprints));
  const corners = await w.evaluate(() => window.mmr.doc.entities.filter((e) => e.tag === 'Footprints').flatMap((e) => e.curve.points.map((q) => [q[0] + e.position[0], q[2] + e.position[2]])));
  for (const B of SITE.buildings) for (const [e, n] of B.footprint) assert.ok(corners.some(([x, z]) => Math.hypot(x - (e - b[0]), z + (n - b[1])) < 0.05), `a footprint corner within 5 cm of ${e}, ${n}`);
  const eaves = f.footprints.map((x) => x.eave).sort((p, q) => p - q);
  assert.ok(Math.abs(eaves[0] - 5) < 0.1 && Math.abs(eaves[1] - 6) < 0.1, `eaves ${eaves}`);
  await ok('propose', { action: 'accept' });
  assert.equal(await w.evaluate(() => window.mmr.doc.entities.filter((e) => e.tag === 'Massing' && e.mesh).length), 2, 'two blocks');
  await ok('undo');
  assert.equal(await w.evaluate(() => JSON.stringify(window.mmr.doc.entities)), before, 'one undo takes them all away');
  // wall lines from a plan cut 1.2 m up
  // a plan cut through the walls of both buildings (their floors are 1.6 m apart), building points only
  await ok('add_slice', { at: 'elevation', z: O[2] + 5, thickness: 0.4, name: 'Plan cut' });
  const t = await ok('trace_slice', { name: 'Plan cut', classes: [6] });
  assert.ok(t.closed >= 2, `closed outlines: ${t.closed}`);
  assert.ok(t.lines.filter((x) => x.closed).slice(0, 2).every((x) => Math.abs(x.area - 120) < 1.2 && x.quality.max <= 0.03), JSON.stringify(t.lines.slice(0, 2)));
  await ok('delete_clip', { name: 'Plan cut' });
  // kerbs along Main road, the ground re-triangulated on them
  await ok('create_alignment', { name: 'Main road', points: [[L(0, 40)[0], L(0, 40)[2]], [L(100, 40)[0], L(100, 40)[2]]] });
  await ok('classify_ground', { id: 'Corridor scan', cell: 1 });
  const k = await ok('extract_edges', { kind: 'kerb', alignment: 'Main road', as_breaklines: true });
  assert.equal(k.count, 4);
  assert.ok(k.edges.every((x) => x.length > 95 && ['Kerb top', 'Kerb bottom'].includes(x.layer)), JSON.stringify(k.edges));
  assert.equal(k.breaklines.surfaces.length, 1);
});
