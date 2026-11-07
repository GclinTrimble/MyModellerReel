// #91: the streamed replies rebuild exactly what the agent loop parses, whatever the chunk boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseReply } from '../src/core/agent.js';

const { _test: R } = createRequire(import.meta.url)('../src/main/stream.cjs');
// cut a text into awkward chunks (mid-line, mid-JSON)
const chunks = (s, n = 7) => Array.from({ length: Math.ceil(s.length / n) }, (_, i) => new TextEncoder().encode(s.slice(i * n, i * n + n)));
const sse = (events) => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');

test('Anthropic stream: text and a tool call with its JSON input in pieces, usage', async () => {
  const body = sse([
    { type: 'message_start', message: { id: 'm1', role: 'assistant', content: [], usage: { input_tokens: 120, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Placing ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a box.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'create_box', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"width": 2, "hei' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'ght": 1, "depth": 1}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } },
    { type: 'message_stop' },
  ]);
  let live = '';
  const data = await R.anthropic(chunks(body), (t) => (live += t));
  assert.equal(live, 'Placing a box.');
  assert.equal(data.usage.output_tokens, 40);
  assert.equal(data.usage.input_tokens, 120);
  const r = parseReply('anthropic', data);
  assert.equal(r.text, 'Placing a box.');
  assert.deepEqual(r.calls.map((c) => [c.name, c.args]), [['create_box', { width: 2, height: 1, depth: 1 }]]);
});

test('OpenAI stream: content deltas, a tool call assembled from fragments, usage chunk', async () => {
  const body = `${sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'On it' } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'move', arguments: '{"ids":["Box"],' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"by":[1,0,0]}' } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 300, completion_tokens: 25 } },
  ])}data: [DONE]\n\n`;
  const data = await R.openai(chunks(body, 11), () => {});
  assert.equal(data.usage.completion_tokens, 25);
  const r = parseReply('openai', data);
  assert.equal(r.text, 'On it');
  assert.deepEqual(r.calls.map((c) => [c.name, c.args]), [['move', { ids: ['Box'], by: [1, 0, 0] }]]);
});

test('Ollama NDJSON: content pieces, tool calls, counts from the last line; errors surface', async () => {
  const body = [
    { message: { role: 'assistant', content: 'Sure' } },
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_sphere', arguments: { radius: 0.5 } } }] } },
    { done: true, prompt_eval_count: 90, eval_count: 12, message: { role: 'assistant', content: '' } },
  ].map((x) => JSON.stringify(x)).join('\n');
  const data = await R.ollama(chunks(body, 5), () => {});
  assert.equal(data.eval_count, 12);
  const r = parseReply('ollama', data);
  assert.equal(r.text, 'Sure');
  assert.equal(r.calls[0].name, 'create_sphere');
  await assert.rejects(R.ollama(chunks('{"error":"model not found"}'), () => {}), /model not found/);
});
