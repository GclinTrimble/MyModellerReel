// #257: AI turns you can follow: timings in the turn data, reasoning apart from the answer, short tool arguments,
// reasoning streamed the same way for every provider, and the cheap fixes that make the built-in model faster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeCtx } from './helpers.js';
import { runTurn, newStats, usageOf, splitThinking, shortArgs, turnSummary, parseReply } from '../src/core/agent.js';

const { _test: R } = createRequire(import.meta.url)('../src/main/stream.cjs');
const enc = (s) => [new TextEncoder().encode(s)];

test('a turn records model and tool time, steps, tokens and a trace, live and after an error', async () => {
  const { reg } = makeCtx();
  let clock = 0;
  const now = () => clock;
  const replies = [
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_box', arguments: { width: 1, height: 1, depth: 1 } } }, { function: { name: 'place_on', arguments: { target: 'nothing' } } }] }, prompt_eval_count: 900, eval_count: 40 },
    { message: { role: 'assistant', content: 'Done.' }, prompt_eval_count: 60, eval_count: 10 },
  ];
  const stats = newStats();
  const seen = [];
  const systems = [];
  const out = await runTurn({
    protocol: 'ollama',
    chat: async () => ((clock += 2000), replies.shift()),
    run: async (n, a) => ((clock += 100), reg.run(n, a)),
    list: () => reg.list(),
    history: [{ role: 'user', content: 'a box' }],
    system: () => (systems.push(1), 's'),
    stats,
    now,
    hooks: { onResult: (_, c, r, err, ms) => seen.push([c.name, err, ms]) },
  });
  assert.equal(systems.length, 1, 'one system prompt for the whole turn, so a local model reuses its prompt cache');
  assert.equal(out, stats, 'the caller’s stats object is the one filled');
  assert.deepEqual([stats.steps, stats.calls, stats.errors], [2, 2, 1]);
  assert.deepEqual([stats.model_ms, stats.tool_ms, stats.ms], [4000, 200, 4200]);
  assert.deepEqual([stats.tokens_in, stats.tokens_out, stats.tokens_per_s], [960, 50, 13]);
  assert.deepEqual(seen, [['create_box', false, 100], ['place_on', true, 100]]);
  assert.deepEqual(stats.trace.map((x) => x.tool || `model ${x.model_ms}`), ['model 2000', 'create_box', 'place_on', 'model 2000']);
  assert.match(stats.trace[2].error, /nothing/);
  assert.equal(turnSummary(stats), '4.2 s · model 4.0 s · tools 0.2 s · 2 steps · 2 tool calls · 1 error · 960 in, 50 out tokens · 13 tok/s');

  // a model that fails mid-turn still leaves its timings
  const broken = newStats();
  await assert.rejects(runTurn({ protocol: 'ollama', chat: async () => ((clock += 500), Promise.reject(new Error('Stopped.'))), run: () => {}, list: () => [], history: [], system: 's', stats: broken, now }), /Stopped/);
  assert.deepEqual([broken.steps, broken.model_ms, broken.ms], [1, 500, 500]);
  const slow = newStats();
  await runTurn({ protocol: 'ollama', chat: async () => ((clock += 530000), { message: { role: 'assistant', content: 'ok' }, eval_count: 151 }), run: () => {}, list: () => [], history: [], system: 's', stats: slow, now });
  assert.equal(slow.tokens_per_s, 0.3, 'a slow model still shows its rate');
});

test('tokens from each provider’s reply', () => {
  assert.deepEqual(usageOf({ usage: { input_tokens: 5, output_tokens: 2 } }), { in: 5, out: 2 });
  assert.deepEqual(usageOf({ usage: { prompt_tokens: 7, completion_tokens: 3 } }), { in: 7, out: 3 });
  assert.deepEqual(usageOf({ prompt_eval_count: 9, eval_count: 4 }), { in: 9, out: 4 });
  assert.deepEqual(usageOf(undefined), { in: 0, out: 0 });
});

test('reasoning in <think> is apart from the answer, live and when done', () => {
  assert.deepEqual(splitThinking('<think>I need a box'), { thinking: 'I need a box', text: '', open: true });
  assert.deepEqual(splitThinking('<think>a box</think>\n\nMaking it.'), { thinking: 'a box', text: 'Making it.', open: false });
  assert.deepEqual(splitThinking('Plain answer.'), { thinking: '', text: 'Plain answer.', open: false });
  // the answer the model keeps in its history has no reasoning (it would fill the context on every later step)
  const r = parseReply('ollama', { message: { role: 'assistant', content: '<think>plan</think>Done.' } });
  assert.equal(r.text, 'Done.');
  assert.equal(r.message.content, 'Done.');
});

test('tool arguments in a few words', () => {
  assert.equal(shortArgs({ width: 2, height: 0.12345678, name: 'Box', position: [1, 0, -2] }), 'width 2, height 0.123, name "Box", position [1, 0, -2]');
  assert.equal(shortArgs({ ids: ['a', 'b', 'c', 'd', 'e'], spec: { x: 1 }, on: true }), 'ids [5], spec {…}, on true');
  assert.equal(shortArgs({ script: 'x'.repeat(200) }).length <= 80, true);
  assert.equal(shortArgs({ __unparsed: '{bad' }), '');
});

test('reasoning streamed apart (Ollama thinking, reasoning_content) reaches the page inside <think>', async () => {
  let live = '';
  const nd = [{ message: { thinking: 'Plan: ' } }, { message: { thinking: 'one box.' } }, { message: { content: 'Done.' } }, { done: true, eval_count: 9 }].map((e) => JSON.stringify(e)).join('\n');
  const data = await R.ollama(enc(nd), (t) => (live += t));
  assert.equal(live, '<think>Plan: one box.</think>Done.');
  assert.equal(data.message.content, 'Done.', 'the answer itself has no reasoning');
  live = '';
  const sse = [{ choices: [{ delta: { reasoning_content: 'hmm' } }] }, { choices: [{ delta: { content: 'Ok' } }] }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  await R.openai(enc(sse), (t) => (live += t));
  assert.equal(live, '<think>hmm</think>Ok');
});

test('the built-in model uses the graphics card, not the integrated GPU beside it', async () => {
  const B = createRequire(import.meta.url)('../src/main/builtin.cjs');
  assert.equal(B.vulkanDevices(['Intel(R) Graphics', 'NVIDIA RTX PRO 1000 Blackwell Generation Laptop GPU']), '1');
  assert.equal(B.vulkanDevices(['AMD Radeon(TM) Graphics', 'AMD Radeon RX 7600S', 'NVIDIA GeForce RTX 4060']), '1,2');
  assert.equal(B.vulkanDevices(['Intel(R) Iris(R) Xe Graphics']), null, 'only an integrated GPU: use it');
  assert.equal(B.vulkanDevices(['NVIDIA GeForce RTX 4090']), null);
  assert.equal(B.vulkanDevices(['Intel(R) Arc(TM) Graphics', 'Intel(R) Arc(TM) B580 Graphics']), '1', 'Arc integrated vs an Arc card');
  assert.equal(B.vulkanDevices([]), null);
});

test('a graphics card another app has filled: the built-in model runs on the processor instead of failing', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const B = createRequire(import.meta.url)('../src/main/builtin.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-vram-'));
  fs.writeFileSync(path.join(dir, 'qwen3-4b.gguf'), 'x');
  const loads = [];
  const fake = {
    LlamaChat: class {
      async generateResponse() {
        return { response: 'Hi.', functionCalls: [] };
      }
    },
    getLlama: async () => ({
      loadModel: async (o) => (loads.push(o.gpuLayers ?? 'auto'), {
        dispose: async () => {},
        createContext: async (c) => {
          assert.deepEqual(c.contextSize, { min: 8192, max: 16384 });
          if (o.gpuLayers !== 0) throw Object.assign(new Error('A context size of 8192 is too large for the available VRAM'), { name: 'InsufficientMemoryError' });
          return { getSequence: () => ({}) };
        },
      }),
    }),
  };
  const rt = B.createBuiltin({ dir, load: async () => fake, check: async () => true });
  const r = await rt.chat('qwen3-4b', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.message.content, 'Hi.');
  assert.deepEqual(loads, ['auto', 0]);
});

test('Stop ends a built-in model request at once, even while the model is still loading', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const B = createRequire(import.meta.url)('../src/main/builtin.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmr-stop-'));
  fs.writeFileSync(path.join(dir, 'qwen3-4b.gguf'), 'x');
  let loaded;
  const slow = new Promise((r) => (loaded = r));
  const fake = {
    LlamaChat: class {
      async generateResponse() {
        return { response: 'Hi.', functionCalls: [] };
      }
    },
    getLlama: async () => ({ loadModel: async () => (await slow, { dispose: async () => {}, createContext: async () => ({ getSequence: () => ({}) }) }) }),
  };
  const rt = B.createBuiltin({ dir, load: async () => fake, check: async () => true });
  const ac = new AbortController();
  const req = rt.chat('qwen3-4b', { messages: [{ role: 'user', content: 'hi' }] }, () => {}, ac.signal);
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(req, /Stopped/);
  loaded();
  const next = await rt.chat('qwen3-4b', { messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal);
  assert.equal(next.message.content, 'Hi.', 'the next request works');
});
