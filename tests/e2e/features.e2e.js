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
  await form.getByText('place on').waitFor();
  await form.locator('input').nth(0).fill('Ball');
  await form.locator('input').nth(1).fill('Table');
  await form.getByRole('button', { name: 'Run' }).click();
  const ball = (await ok('get_entity', { id: 'Ball' })).min;
  assert.equal(ball[1], 1);
});

test('parametric: sweep from the Library, edit a parameter in the Entity panel, the macro pill', async () => {
  await ok('create_curve', { points: [[0, 0, 5], [3, 0, 6], [6, 0, 5]], kind: 'spline', name: 'Path' });
  await ok('select', { ids: ['Path'] });
  await w.click('[data-tab="library"]');
  await w.locator('button.profile', { hasText: 'pipe' }).click();
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
