// Streaming AI replies (#91): read the provider's event stream, pass text to the page as it arrives, and rebuild the
// same response object the non-streaming APIs return, so the agent loop (src/core/agent.js) does not change.

/** Lines of a fetch body, decoded. */
async function* lines(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) yield buf;
}
const sse = async function* (body) {
  for await (const l of lines(body)) if (l.startsWith('data:')) yield l.slice(5).trim();
};

/** Anthropic Messages SSE → the Messages response object. */
async function anthropic(body, onText) {
  let msg = null;
  const blocks = [];
  const json = [];
  for await (const d of sse(body)) {
    if (!d || d === '[DONE]') continue;
    const e = JSON.parse(d);
    if (e.type === 'message_start') msg = e.message;
    else if (e.type === 'content_block_start') (blocks[e.index] = { ...e.content_block }), (json[e.index] = '');
    else if (e.type === 'content_block_delta') {
      const b = blocks[e.index];
      if (e.delta.type === 'text_delta') (b.text = (b.text || '') + e.delta.text), onText(e.delta.text);
      else if (e.delta.type === 'input_json_delta') json[e.index] += e.delta.partial_json;
    } else if (e.type === 'content_block_stop' && blocks[e.index]?.type === 'tool_use') blocks[e.index].input = json[e.index] ? JSON.parse(json[e.index]) : {};
    else if (e.type === 'message_delta') Object.assign(msg, e.delta, { usage: { ...msg.usage, ...e.usage } });
    else if (e.type === 'error') throw new Error(`anthropic: ${e.error?.message || 'stream error'}`);
  }
  return { ...msg, content: blocks.filter(Boolean) };
}

/** OpenAI-compatible chat completions SSE → { choices: [{ message }], usage }. */
async function openai(body, onText) {
  const m = { role: 'assistant', content: '', tool_calls: [] };
  let usage;
  let finish;
  for await (const d of sse(body)) {
    if (!d || d === '[DONE]') continue;
    const e = JSON.parse(d);
    if (e.usage) usage = e.usage;
    const c = e.choices?.[0];
    if (!c) continue;
    if (c.finish_reason) finish = c.finish_reason;
    if (c.delta?.content) (m.content += c.delta.content), onText(c.delta.content);
    for (const t of c.delta?.tool_calls || []) {
      const cur = (m.tool_calls[t.index ?? 0] ||= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (t.id) cur.id = t.id;
      if (t.function?.name) cur.function.name += t.function.name;
      if (t.function?.arguments) cur.function.arguments += t.function.arguments;
    }
  }
  if (!m.tool_calls.length) delete m.tool_calls;
  return { choices: [{ message: m, finish_reason: finish }], usage };
}

/** Ollama /api/chat NDJSON → the non-streaming reply. */
async function ollama(body, onText) {
  const m = { role: 'assistant', content: '' };
  let last = {};
  for await (const l of lines(body)) {
    if (!l.trim()) continue;
    const e = JSON.parse(l);
    if (e.error) throw new Error(`ollama: ${e.error}`);
    if (e.message?.content) (m.content += e.message.content), onText(e.message.content);
    if (e.message?.tool_calls) (m.tool_calls ||= []).push(...e.message.tool_calls);
    last = e;
  }
  return { ...last, message: m };
}

const READERS = { anthropic, openai, ollama };

/** Read a streamed reply of a provider ('anthropic' | 'openai' | 'ollama'). */
exports.readStream = (provider, body, onText) => READERS[provider === 'anthropic' ? 'anthropic' : provider === 'openai' ? 'openai' : 'ollama'](body, onText);
exports._test = { anthropic, openai, ollama };
