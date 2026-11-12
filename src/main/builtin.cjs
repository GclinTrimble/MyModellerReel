// The built-in model (#238): a GGUF file in the app data folder, run with node-llama-cpp in this process, so local AI
// needs no second app. It speaks the Ollama chat shape (request and reply), so the agent loop treats it as Ollama.
const fs = require('node:fs');
const path = require('node:path');

/** Models the app offers. The first is the default (see the PR of #238 for the eval behind the choice). */
const MODELS = [
  { id: 'qwen3-8b', label: 'Qwen 3 8B', uri: 'hf:Qwen/Qwen3-8B-GGUF:Q4_K_M', bytes: 5.03e9 },
  { id: 'qwen3-4b', label: 'Qwen 3 4B Instruct', uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M', bytes: 2.5e9 },
  { id: 'qwen3.5-4b', label: 'Qwen 3.5 4B', uri: 'hf:unsloth/Qwen3.5-4B-GGUF:Q4_K_M', bytes: 2.74e9 },
  { id: 'qwen3.5-9b', label: 'Qwen 3.5 9B', uri: 'hf:unsloth/Qwen3.5-9B-GGUF:Q4_K_M', bytes: 5.68e9 },
  { id: 'llama3.1-8b', label: 'Llama 3.1 8B', uri: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M', bytes: 4.92e9 },
  { id: 'ministral-8b', label: 'Ministral 8B (research licence)', uri: 'hf:bartowski/Ministral-8B-Instruct-2410-GGUF:Q4_K_M', bytes: 4.91e9 },
];
const modelOf = (id) => MODELS.find((m) => m.id === id) || MODELS[0];

const ANY = { oneOf: [{ type: ['string', 'number', 'boolean', 'null'] }, { type: 'array' }, { type: 'object', additionalProperties: true }] };
/**
 * A command's JSON schema as a node-llama-cpp grammar schema. Its grammar makes every listed property required, so
 * optional ones become "value or null" (nulls are dropped from the call), and untyped ones take any JSON value.
 */
function toGbnf(s) {
  if (!s || typeof s !== 'object') return ANY;
  const description = s.description ? { description: s.description } : {};
  if (s.enum) return { enum: s.enum, ...description };
  const types = [].concat(s.type || []);
  if (!types.length) return { ...ANY, ...description };
  if (types.length > 1 && types.some((t) => t === 'array' || t === 'object')) return { oneOf: types.map((type) => toGbnf({ ...s, type })), ...description };
  const [type] = types;
  if (type === 'object') {
    const props = Object.entries(s.properties || {});
    if (!props.length) return { type, additionalProperties: true, ...description };
    const req = new Set(s.required || []);
    return { type, properties: Object.fromEntries(props.map(([k, v]) => [k, req.has(k) ? toGbnf(v) : { oneOf: [toGbnf(v), { type: 'null' }], ...(v?.description ? { description: v.description } : {}) }])), ...description };
  }
  if (type === 'array') return { type, ...(s.items ? { items: toGbnf(s.items) } : {}), ...(s.minItems != null ? { minItems: s.minItems } : {}), ...(s.maxItems != null ? { maxItems: s.maxItems } : {}), ...description };
  return { type: types.length > 1 ? types : type, ...description };
}
const dropNulls = (v) => (Array.isArray(v) ? v.map(dropNulls) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)])) : v);
const parse = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

/** Ollama-shaped messages → node-llama-cpp chat history (a tool result goes into the call it answers). */
function toHistory(messages) {
  const out = [];
  const pending = [];
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    if (m.role === 'system') out.push({ type: 'system', text });
    else if (m.role === 'user') out.push({ type: 'user', text });
    else if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).map((c) => ({ type: 'functionCall', name: c.function.name, params: typeof c.function.arguments === 'string' ? parse(c.function.arguments) : c.function.arguments, result: '' }));
      pending.push(...calls);
      out.push({ type: 'model', response: [...(text ? [text] : []), ...calls] });
    } else if (m.role === 'tool' && pending.length) pending.shift().result = parse(text);
  }
  return out;
}

/**
 * The built-in runtime. dir: where models live. load: the node-llama-cpp module (tests pass a fake).
 * status(id), download(id, onProgress, signal), chat(id, body, onText, signal) → the Ollama /api/chat reply.
 */
function createBuiltin({ dir, load = () => import('node-llama-cpp') }) {
  const fileOf = (id) => path.join(dir, `${modelOf(id).id}.gguf`);
  let live = null; // { id, llama, model, chat }
  const open = async (id) => {
    if (live?.id === modelOf(id).id) return live;
    const file = fileOf(id);
    if (!fs.existsSync(file)) throw new Error(`The assistant model is not downloaded yet (${modelOf(id).label}). Download it from the AI panel.`);
    await live?.model.dispose();
    const L = await load();
    // the GPU when there is one (Vulkan, CUDA, Metal), the CPU otherwise; never compile on the user's PC
    const llama = live?.llama || (await L.getLlama({ build: 'never' }));
    const model = await llama.loadModel({ modelPath: file });
    const context = await model.createContext({ contextSize: { min: 8192, max: 32768 } });
    live = { id: modelOf(id).id, llama, model, chat: new L.LlamaChat({ contextSequence: context.getSequence() }) };
    return live;
  };
  return {
    MODELS,
    status(id) {
      const m = modelOf(id);
      return { model: m.id, label: m.label, bytes: m.bytes, has_model: fs.existsSync(fileOf(id)), gpu: live?.llama.gpu ?? null, path: fileOf(id) };
    },
    async download(id, onProgress, signal) {
      const m = modelOf(id);
      fs.mkdirSync(dir, { recursive: true });
      const L = await load();
      // a cancelled or broken download keeps its part file and resumes from it next time
      const d = await L.createModelDownloader({ modelUri: m.uri, dirPath: dir, fileName: `${m.id}.gguf`, skipExisting: true, deleteTempFileOnCancel: false, onProgress: ({ totalSize, downloadedSize }) => onProgress?.({ model: m.id, status: 'downloading', total: totalSize, completed: downloadedSize }) });
      const stop = () => d.cancel({ deleteTempFile: false });
      signal?.addEventListener('abort', stop);
      try {
        await d.download({ signal });
      } finally {
        signal?.removeEventListener('abort', stop);
      }
      if (signal?.aborted) throw new Error('Download paused: it resumes where it stopped next time.');
      return { model: m.id, status: 'success', path: d.entrypointFilePath };
    },
    async chat(id, body, onText, signal) {
      const { chat } = await open(id);
      const functions = Object.fromEntries((body.tools || []).map((t) => [t.function.name, { description: t.function.description, params: toGbnf(t.function.parameters) }]));
      const r = await chat.generateResponse(toHistory(body.messages || []), {
        ...(Object.keys(functions).length ? { functions } : {}),
        onTextChunk: onText,
        signal,
        temperature: body.options?.temperature ?? 0.2,
        budgets: { thoughtTokens: 0 }, // no long hidden reasoning on a laptop: answer and call tools straight away
      });
      const tool_calls = (r.functionCalls || []).map((c) => ({ function: { name: c.functionName, arguments: dropNulls(c.params ?? {}) } }));
      return { model: modelOf(id).id, done: true, message: { role: 'assistant', content: r.response, ...(tool_calls.length ? { tool_calls } : {}) } };
    },
  };
}

module.exports = { MODELS, modelOf, toGbnf, toHistory, dropNulls, createBuiltin };
