// Phase 18 part 1: snaps, section planes, choosing an AI model (the UI parts are checked in e2e).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.js';

test('set_snaps keeps the snap kinds in the document, the rest stay on', async () => {
  const { reg, ctx } = makeCtx();
  const r = await reg.run('set_snaps', { midpoint: false, grid: false });
  assert.equal(r.snaps.midpoint, false);
  assert.equal(r.snaps.endpoint, true);
  assert.deepEqual(ctx.doc.settings.snaps, { midpoint: false, grid: false });
  await assert.rejects(reg.run('set_snaps', { edges: true }), /unknown parameter/);
});

test('section planes: several kept, one cuts, flip, move, rename, delete', async () => {
  const { reg, ctx } = makeCtx();
  await reg.run('section', { normal: [1, 0, 0], point: [0, 0, 0], name: 'Long' });
  await reg.run('section', { normal: [0, 0, 1], point: [0, 0, 2], name: 'Cross' });
  let l = await reg.run('list_section_planes', {});
  assert.equal(l.planes.length, 2);
  assert.equal(l.active, 'Cross');
  assert.deepEqual(ctx.doc.settings.section.point, [0, 0, 2]);
  await reg.run('set_section_plane', { name: 'Long', active: true });
  assert.deepEqual(ctx.doc.settings.section.normal, [1, 0, 0]);
  await reg.run('set_section_plane', { name: 'Long', flip: true, offset: 0.5 });
  assert.deepEqual(ctx.doc.settings.section.normal, [-1, 0, 0]);
  assert.deepEqual(ctx.doc.settings.section.point, [-0.5, 0, 0]);
  await reg.run('section', { enabled: false });
  assert.equal(ctx.doc.settings.section, null);
  assert.equal((await reg.run('list_section_planes', {})).planes.length, 2, 'turning the cut off keeps the planes');
  await reg.run('set_section_plane', { name: 'Cross', rename: 'Grid C', active: true });
  assert.equal(ctx.doc.settings.section_active, 'Grid C');
  l = await reg.run('delete_section_plane', { name: 'Grid C' });
  assert.equal(l.active, null);
  assert.equal(ctx.doc.settings.section, null);
  await assert.rejects(reg.run('set_section_plane', { name: 'Nope', flip: true }), /No section plane "Nope"/);
});

test('detect_local_models and use_ai_model go through the app (io), and say what to do', async () => {
  const { reg, ctx } = makeCtx();
  let saved = null;
  ctx.io = {
    detectModels: async () => ({ servers: [{ name: 'Ollama', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ['nomic-embed-text', 'mistral:latest'] }], installed: [], huggingface: [], claudeDesktop: false }),
    setSettings: async (p) => (saved = p),
  };
  const r = await reg.run('detect_local_models', {});
  assert.equal(r.servers[0].suggested, 'mistral:latest', 'a model that can call tools is suggested first');
  assert.match(r.advice, /Found Ollama/);
  await reg.run('use_ai_model', { provider: 'ollama', model: 'mistral:latest' });
  assert.deepEqual(saved, { ai: { provider: 'ollama', ollama: { model: 'mistral:latest' } } });
  ctx.io.detectModels = async () => ({ servers: [], installed: [{ name: 'Ollama', models: ['mistral:latest'], start: 'Start Ollama.' }], huggingface: [], claudeDesktop: true });
  assert.match((await reg.run('detect_local_models', {})).advice, /installed with mistral:latest but not running/);
});
