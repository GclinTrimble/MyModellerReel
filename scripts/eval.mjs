#!/usr/bin/env node
// npm run eval -- --model ollama:mistral --model anthropic:claude-sonnet-5-5 [--routing off] [--task table] [--json out.json]
// Runs the eval tasks (scripts/eval-tasks.js) against each model with the same agent loop the copilot uses, and
// scores the resulting scene. Models: mock (replays the reference solutions), ollama:<model>, anthropic:<model>,
// openai:<model>[@<base url>], builtin:<model id> (the model the app runs itself, #238; downloaded into <data>/models). Keys come from ANTHROPIC_API_KEY / OPENAI_API_KEY, else the app's settings.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Store, newDoc } from '../src/core/document.js';
import { createRegistry } from '../src/core/commands.js';
import { runTurn, systemPrompt, protocolOf, newStats } from '../src/core/agent.js';
import { TASKS } from './eval-tasks.js';

const DATA = process.env.MMR_HOME || (process.env.APPDATA ? path.join(process.env.APPDATA, 'MyModellerReel') : path.join(os.homedir(), '.config', 'MyModellerReel'));
const settings = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).ai || {};
  } catch {
    return {};
  }
};

let builtin = null;
/** A chat function for one model spec. Returns { provider, chat(body) }. */
export function provider(spec, task = null) {
  const [kind, rest = ''] = spec.split(/:(.*)/s);
  const s = settings();
  if (kind === 'mock') {
    // Replays the task's reference solution as tool calls, one per step, then says it is done.
    const steps = [...(task?.solution || [])];
    return {
      provider: 'ollama',
      chat: async () => ({ message: steps.length ? { role: 'assistant', content: '', tool_calls: [{ function: { name: steps[0][0], arguments: steps.shift()[1] } }] } : { role: 'assistant', content: 'Done.' } }),
    };
  }
  const post = async (url, headers, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${kind} ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
  if (kind === 'builtin') {
    builtin ||= createRequire(import.meta.url)('../src/main/builtin.cjs').createBuiltin({ dir: path.join(DATA, 'models') });
    const id = rest || undefined;
    const progress = (p) => process.stdout.write(`${p.model} ${((p.completed / p.total) * 100 || 0).toFixed(0)} %`);
    return { provider: 'builtin', chat: async (body) => (builtin.status(id).has_model || (await builtin.download(id, progress)), builtin.chat(id, body)) };
  }
  if (kind === 'ollama') {
    const base = (s.ollama?.baseUrl || 'http://127.0.0.1:11434').replace(/\/(v1|api)?\/?$/, '');
    return { provider: 'ollama', chat: (body) => post(`${base}/api/chat`, {}, { model: rest || 'mistral', ...body }) };
  }
  if (kind === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY || s.anthropic?.apiKey;
    if (!key) throw new Error('anthropic: set ANTHROPIC_API_KEY or add a key in the app.');
    return { provider: 'anthropic', chat: (body) => post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model: rest || 'claude-sonnet-5-5', max_tokens: 4096, ...body }) };
  }
  if (kind === 'openai') {
    const [model, base = s.openai?.baseUrl || 'https://api.openai.com/v1'] = rest.split('@');
    const key = process.env.OPENAI_API_KEY || s.openai?.apiKey;
    return { provider: 'openai', chat: (body) => post(`${base.replace(/\/$/, '')}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, { model, ...body }) };
  }
  throw new Error(`Unknown model "${spec}". Use mock, builtin:<model>, ollama:<model>, anthropic:<model> or openai:<model>[@<base url>].`);
}

/** Run one task with one model. Returns { task, model, score, failed, calls, errors, steps, seconds }. */
export async function runTask(task, spec, { routing = true } = {}) {
  const store = new Store(newDoc());
  let sel = [];
  const ctx = { store, get doc() { return store.doc; }, selection: { get: () => sel, set: (x) => (sel = x) } };
  const reg = createRegistry(ctx);
  for (const [name, args] of task.setup || []) await reg.run(name, args);
  sel = [];
  const p = provider(spec, task);
  const protocol = protocolOf(p.provider);
  const history = [{ role: 'user', content: task.prompt }];
  const t0 = Date.now();
  const stats = newStats(); // filled as it runs: a crash keeps the timings so far
  let crash = null;
  try {
    await runTurn({
      stats,
      protocol,
      chat: p.chat,
      run: (n, a) => reg.run(n, a),
      list: () => reg.list(),
      history,
      routing,
      system: () => systemPrompt({ doc: store.doc, selection: sel, small: protocol === 'ollama' && routing }),
      maxSteps: 25,
    });
  } catch (e) {
    crash = e.message;
  }
  const { score, failed } = task.check(store.doc);
  return { task: task.name, model: spec, routing, score: crash ? 0 : score, failed: crash ? [`crashed: ${crash}`] : failed, ...stats, seconds: (Date.now() - t0) / 1000 };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
  const models = opt('model').length ? opt('model') : ['mock'];
  const only = opt('task');
  const routing = opt('routing')[0] !== 'off';
  const tasks = TASKS.filter((t) => !only.length || only.includes(t.name));
  const rows = [];
  for (const m of models)
    for (const t of tasks) {
      const r = await runTask(t, m, { routing });
      rows.push(r);
      console.log(`${m.padEnd(28)} ${t.name.padEnd(18)} ${(r.score * 100).toFixed(0).padStart(4)} %  ${String(r.calls).padStart(3)} calls ${String(r.errors).padStart(2)} errors ${r.seconds.toFixed(1).padStart(6)} s (model ${(r.model_ms / 1000).toFixed(1)} s, ${r.steps} steps${r.tokens_per_s ? `, ${r.tokens_per_s} tok/s` : ''})${r.failed.length ? `  ✗ ${r.failed.join('; ')}` : ''}`);
    }
  console.log('\nModel                         score   calls  errors  (routing ' + (routing ? 'on' : 'off') + ')');
  for (const m of models) {
    const mine = rows.filter((r) => r.model === m);
    const avg = (k) => mine.reduce((s, r) => s + r[k], 0) / mine.length;
    console.log(`${m.padEnd(28)} ${(avg('score') * 100).toFixed(0).padStart(5)} % ${avg('calls').toFixed(1).padStart(6)} ${avg('errors').toFixed(1).padStart(7)}`);
  }
  const out = opt('json')[0];
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => (console.error(e.message), process.exit(1)));
