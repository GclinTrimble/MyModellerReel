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
  await w.click('.dock-toggle');
  assert.equal(await hidden(), true);
  await w.locator('#viewbar button[aria-label="Side panel (Ctrl+B)"]').click();
  assert.equal(await hidden(), false);
});
