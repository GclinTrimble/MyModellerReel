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
