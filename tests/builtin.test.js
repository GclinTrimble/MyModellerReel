// #238: the built-in model runtime, with node-llama-cpp replaced by a fake (no model file, no GPU needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { protocolOf, parseReply, buildRequest, toolDefs } from '../src/core/agent.js';
import { makeCtx } from './helpers.js';

const B = createRequire(import.meta.url)('../src/main/builtin.cjs');

test('command schemas become grammar schemas: optional is nullable, untyped is any value', () => {
  const g = B.toGbnf({ type: 'object', properties: { id: { type: 'string' }, at: { description: 'id or [x,y,z]' }, size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, mode: { type: 'string', enum: ['a', 'b'] }, opts: { type: 'object' } }, required: ['id'] });
  assert.deepEqual(g.properties.id, { type: 'string' });
  assert.equal(g.properties.at.oneOf.at(-1).type, 'null', 'optional');
  assert.ok(g.properties.at.oneOf[0].oneOf, 'untyped takes any value');
  assert.deepEqual(g.properties.size.oneOf[0], { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 });
  assert.deepEqual(g.properties.mode.oneOf[0], { enum: ['a', 'b'] });
  assert.equal(g.properties.opts.oneOf[0].additionalProperties, true, 'a free-form object');
  assert.equal(B.toGbnf({ type: ['number', 'array'], items: { type: 'number' } }).oneOf.length, 2);
  assert.deepEqual(B.dropNulls({ a: 1, b: null, c: { d: null, e: [1, null] } }), { a: 1, c: { e: [1, null] } });
});

test('every command schema converts', async () => {
  const { reg } = makeCtx();
  for (const c of reg.list()) assert.doesNotThrow(() => JSON.stringify(B.toGbnf(c.params)), c.name);
});

test('Ollama-shaped messages become chat history, each tool result inside its call', () => {
  const h = B.toHistory([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'make a box' },
    { role: 'assistant', content: 'Sure.', tool_calls: [{ function: { name: 'create_box', arguments: { width: 2 } } }, { function: { name: 'get_scene', arguments: '{}' } }] },
    { role: 'tool', tool_name: 'create_box', content: '{"id":"e1"}' },
    { role: 'tool', tool_name: 'get_scene', content: 'not json' },
    { role: 'assistant', content: 'Done.' },
  ]);
  assert.deepEqual(h.map((x) => x.type), ['system', 'user', 'model', 'model']);
  assert.deepEqual(h[2].response[0], 'Sure.');
  assert.deepEqual(h[2].response[1], { type: 'functionCall', name: 'create_box', params: { width: 2 }, result: { id: 'e1' } });
  assert.equal(h[2].response[2].result, 'not json');
});

/** A fake node-llama-cpp: records what it was given, answers one tool call then text. */
function fakeLlama(log) {
  return {
    getLlama: async (o) => (log.push(['getLlama', o]), { gpu: 'vulkan', loadModel: async ({ modelPath }) => (log.push(['load', modelPath]), { dispose: async () => {}, createContext: async () => ({ getSequence: () => ({}) }) }) }),
    LlamaChat: class {
      async generateResponse(history, o) {
        log.push(['generate', history, o]);
        o.onTextChunk?.('Making it.');
        return history.length < 3 ? { response: 'Making it.', functionCalls: [{ functionName: 'create_box', params: { width: 2, name: null } }] } : { response: 'Done.' };
      }
    },
    createModelDownloader: async (o) => {
      log.push(['downloader', o]);
      return {
        entrypointFilePath: path.join(o.dirPath, o.fileName),
        cancel: async (c) => log.push(['cancel', c]),
        download: async ({ signal }) => {
          o.onProgress({ totalSize: 100, downloadedSize: 40 });
          if (signal.aborted) return;
          fs.writeFileSync(path.join(o.dirPath, o.fileName), 'gguf');
          o.onProgress({ totalSize: 100, downloadedSize: 100 });
        },
      };
    },
  };
}

test('the built-in provider: download with progress, then a turn in the Ollama shape the agent loop parses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-builtin-'));
  const log = [];
  const rt = B.createBuiltin({ dir, load: async () => fakeLlama(log) });
  assert.equal(protocolOf('builtin'), 'ollama');
  assert.equal(rt.status().model, B.MODELS[0].id);
  assert.equal(rt.status().has_model, false);
  await assert.rejects(rt.chat(undefined, { messages: [] }), /not downloaded yet/);

  // paused: the part file stays for the next try
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(rt.download('qwen3-8b', () => {}, stop.signal), /resumes/);
  assert.equal(log.find((x) => x[0] === 'downloader')[1].deleteTempFileOnCancel, false);

  const progress = [];
  const r = await rt.download('qwen3-8b', (p) => progress.push(p.completed / p.total), new AbortController().signal);
  assert.deepEqual(progress, [0.4, 1]);
  assert.equal(r.status, 'success');
  assert.equal(rt.status('qwen3-8b').has_model, true);

  const { reg } = makeCtx();
  const tools = toolDefs('ollama', reg.list().filter((c) => c.name === 'create_box'));
  const history = [{ role: 'user', content: 'a box' }];
  const texts = [];
  const data = await rt.chat('qwen3-8b', buildRequest('ollama', { system: 'sys', tools, history }), (t) => texts.push(t));
  const { calls, message } = parseReply('ollama', data);
  assert.deepEqual(calls.map((c) => [c.name, c.args]), [['create_box', { width: 2 }]], 'nulls of optional arguments dropped');
  assert.deepEqual(texts, ['Making it.']);
  const gen = log.find((x) => x[0] === 'generate')[2];
  assert.ok(gen.functions.create_box.params.properties, 'tools passed as grammar functions');
  assert.equal(gen.budgets.thoughtTokens, 0);
  assert.equal(log.find((x) => x[0] === 'getLlama')[1].build, 'never', 'never compiles on the user PC');

  history.push(message, { role: 'tool', tool_name: 'create_box', content: '{"id":"e1"}' });
  const next = parseReply('ollama', await rt.chat('qwen3-8b', buildRequest('ollama', { system: 'sys', tools, history })));
  assert.equal(next.text, 'Done.');
  assert.equal(log.filter((x) => x[0] === 'load').length, 1, 'the model stays loaded between requests');
});

test('setup status: the built-in model is one download; Ollama users keep start and pull', async () => {
  const { reg, ctx } = makeCtx();
  let status = { provider: 'builtin', ollama: 'missing', builtin: { model: 'qwen3-8b', label: 'Qwen 3 8B', bytes: 5e9, has_model: false } };
  const set = [];
  ctx.io = { ...(ctx.io || {}), setSettings: async (p) => set.push(p), aiSetup: async (step, arg) => (step === 'status' ? structuredClone(status) : { model: arg || 'qwen3-8b', status: 'success' }) };
  assert.equal((await reg.run('ai_setup_status', {})).next, 'download');
  status.builtin.has_model = true;
  assert.equal((await reg.run('ai_setup_status', {})).next, 'ready');
  // Ollama chosen but not installed: the built-in model is offered instead
  status = { ...status, provider: 'ollama' };
  assert.deepEqual(await reg.run('ai_setup_status', {}).then((s) => [s.local, s.next]), ['builtin', 'download']);
  await reg.run('download_ai_model', {});
  assert.deepEqual(set.at(-1), { ai: { provider: 'builtin', builtin: { model: 'qwen3-8b' } } }, 'downloading switches the copilot to it');
  status = { ...status, ollama: 'stopped' };
  assert.equal((await reg.run('ai_setup_status', {})).next, 'start');
});

test('agents asking the built-in model at once take turns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-builtin-'));
  fs.writeFileSync(path.join(dir, 'qwen3-4b.gguf'), 'gguf');
  let busy = 0;
  let overlap = false;
  const fake = fakeLlama([]);
  fake.LlamaChat = class {
    async generateResponse() {
      overlap ||= busy++ > 0;
      await new Promise((r) => setTimeout(r, 20));
      busy--;
      return { response: 'ok' };
    }
  };
  const rt = B.createBuiltin({ dir, load: async () => fake });
  const replies = await Promise.all([rt.chat('qwen3-4b', { messages: [] }), rt.chat('qwen3-4b', { messages: [] }), rt.chat('qwen3-4b', { messages: [] })]);
  assert.deepEqual(replies.map((r) => r.message.content), ['ok', 'ok', 'ok']);
  assert.equal(overlap, false);
});
