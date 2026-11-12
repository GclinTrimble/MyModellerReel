// The built-in model (#238): a GGUF file in the app data folder, run with node-llama-cpp in this process, so local AI
// needs no second app. It speaks the Ollama chat shape (request and reply), so the agent loop treats it as Ollama.
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');

/**
 * The models the app offers (#238, #255): Apache 2.0 only, so a commercial product can ship them. The first is the
 * default. Size and SHA-256 are those of the file on Hugging Face; a download that does not match is deleted.
 */
const MODELS = [
  { id: 'qwen3-4b', label: 'Qwen 3 4B', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', bytes: 2497281120, sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597', ram: 8, note: 'Fast on most PCs', about: 'Alibaba Qwen 3 4B Instruct (2507). Good at calling the app’s tools for its size. Apache 2.0.' },
  { id: 'ministral3-3b', label: 'Ministral 3 3B', repo: 'mistralai/Ministral-3-3B-Instruct-2512-GGUF', file: 'Ministral-3-3B-Instruct-2512-Q4_K_M.gguf', bytes: 2147023008, sha256: '9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8', ram: 6, note: 'Lightest, for older PCs', about: 'Mistral’s smallest Ministral 3, the one MyVoiceReel uses. Fine for simple requests. Apache 2.0.' },
  { id: 'ministral3-8b', label: 'Ministral 3 8B', repo: 'mistralai/Ministral-3-8B-Instruct-2512-GGUF', file: 'Ministral-3-8B-Instruct-2512-Q4_K_M.gguf', bytes: 5198911904, sha256: '33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761', ram: 12, note: 'Better plans, needs a graphics card', about: 'Mistral’s Ministral 3 8B: follows longer requests better. Wants a graphics card with 8 GB; slow on the processor alone. Apache 2.0.' },
  { id: 'ministral3-14b', label: 'Ministral 3 14B', repo: 'mistralai/Ministral-3-14B-Instruct-2512-GGUF', file: 'Ministral-3-14B-Instruct-2512-Q4_K_M.gguf', bytes: 8239593024, sha256: '824e0f3373e69b84f2cae46fdcb9bd1ebc6ab3bfc7acc125d818b7b8178cc613', ram: 16, note: 'Best, for workstations', about: 'Mistral’s Ministral 3 14B: the most capable here. Wants a graphics card with 12 GB or more. Apache 2.0.' },
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

/** Whether a downloaded file is the one we listed: its size, then its SHA-256. */
async function verifyFile(file, bytes, sha256) {
  if (fs.statSync(file).size !== bytes) return false;
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === sha256;
}

/**
 * The built-in runtime. dir: where models live. load: the node-llama-cpp module (tests pass a fake).
 * status(id), download(id, onProgress, signal), chat(id, body, onText, signal) → the Ollama /api/chat reply.
 */
function createBuiltin({ dir, load = () => import('node-llama-cpp'), check = verifyFile }) {
  const fileOf = (id) => path.join(dir, `${modelOf(id).id}.gguf`);
  let live = null; // { id, llama, model, chat }
  let queue = Promise.resolve(); // one model, one context: agents asking at once take turns
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
    /** The list for the picker: each model, whether it is on this PC, and whether this PC has the memory it wants. */
    models() {
      const gb = os.totalmem() / 1e9;
      return MODELS.map((m, i) => ({ id: m.id, label: m.label, bytes: m.bytes, note: m.note, about: m.about, ram: m.ram, recommended: i === 0, downloaded: fs.existsSync(fileOf(m.id)), fits: gb >= m.ram * 0.95 }));
    },
    status(id) {
      const m = modelOf(id);
      return { model: m.id, label: m.label, bytes: m.bytes, has_model: fs.existsSync(fileOf(id)), gpu: live?.llama.gpu ?? null, path: fileOf(id), models: this.models() };
    },
    async remove(id) {
      const m = modelOf(id);
      if (live?.id === m.id) await queue.then(() => live?.model.dispose()), (live = null);
      for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${m.id}.gguf`))) fs.rmSync(path.join(dir, f), { force: true });
      return { model: m.id, removed: true };
    },
    async download(id, onProgress, signal) {
      const m = modelOf(id);
      fs.mkdirSync(dir, { recursive: true });
      const L = await load();
      // a cancelled or broken download keeps its part file and resumes from it next time
      const d = await L.createModelDownloader({ modelUri: `hf:${m.repo}/${m.file}`, dirPath: dir, fileName: `${m.id}.gguf`, skipExisting: true, deleteTempFileOnCancel: false, onProgress: ({ totalSize, downloadedSize }) => onProgress?.({ model: m.id, status: 'downloading', total: totalSize, completed: downloadedSize }) });
      const stop = () => d.cancel({ deleteTempFile: false });
      signal?.addEventListener('abort', stop);
      try {
        await d.download({ signal });
      } finally {
        signal?.removeEventListener('abort', stop);
      }
      if (signal?.aborted) throw new Error('Download paused: it resumes where it stopped next time.');
      onProgress?.({ model: m.id, status: 'checking', total: m.bytes, completed: m.bytes });
      if (!(await check(fileOf(m.id), m.bytes, m.sha256))) {
        fs.rmSync(fileOf(m.id), { force: true });
        throw new Error(`The downloaded ${m.label} file is not the expected one (size or checksum), so it was deleted. Download it again.`);
      }
      return { model: m.id, status: 'success', path: d.entrypointFilePath };
    },
    chat(id, body, onText, signal) {
      const turn = queue.then(() => (signal?.aborted ? Promise.reject(new Error('Stopped.')) : this.answer(id, body, onText, signal)));
      queue = turn.catch(() => {});
      return turn;
    },
    async answer(id, body, onText, signal) {
      const { chat } = await open(id);
      const functions = Object.fromEntries((body.tools || []).map((t) => [t.function.name, { description: t.function.description, params: toGbnf(t.function.parameters) }]));
      const r = await chat.generateResponse(toHistory(body.messages || []), {
        ...(Object.keys(functions).length ? { functions } : {}),
        onTextChunk: onText,
        signal,
        temperature: body.options?.temperature ?? 0.2,
        maxTokens: 4096, // a reply that runs away still ends
        budgets: { thoughtTokens: 0 }, // no long hidden reasoning on a laptop: answer and call tools straight away
      });
      const tool_calls = (r.functionCalls || []).map((c) => ({ function: { name: c.functionName, arguments: dropNulls(c.params ?? {}) } }));
      return { model: modelOf(id).id, done: true, message: { role: 'assistant', content: r.response, ...(tool_calls.length ? { tool_calls } : {}) } };
    },
  };
}

module.exports = { MODELS, modelOf, toGbnf, toHistory, dropNulls, verifyFile, createBuiltin };
