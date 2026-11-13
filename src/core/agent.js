// Plumb's agent loop, free of DOM and Electron: the in-app assistant and the eval harness (npm run eval) share it.
// Three wire protocols: Anthropic Messages (Claude), Ollama native chat (local models, the built-in one too), OpenAI-compatible chat.
import { GUIDE } from './commands.js';
import { routeTools, describe } from './routing.js';

export const MAX_STEPS = 40;

// the built-in model (#238) takes and answers the Ollama chat shape
export const protocolOf = (provider) => (provider === 'anthropic' ? 'anthropic' : provider === 'ollama' || provider === 'builtin' ? 'ollama' : 'openai');

export function systemPrompt({ doc, selection = [], time = 0, vision = false, skill = null, small = false }) {
  const list = doc.entities.slice(0, 80).map((e) => `${e.id} "${e.name}"${e.parent ? ` in ${e.parent}` : ''}`).join(', ');
  return `You are Plumb, the modelling and animation assistant inside MyModellerReel, a desktop 3D modeller with push/pull modelling and keyframe animation.
You act by calling tools: each call changes the live model the user is looking at.
Work like an expert: plan briefly, use realistic real-world dimensions, prefer fewer bigger steps (run_script for anything repetitive), name things clearly, group parts that belong together.
Prefer relations to coordinates: place_on, against, stack, align, distribute, find_free_space.
When the user shares a picture, a photo or a sketch, read it closely (shapes, proportions, written dimensions, arrows, marks drawn over the view) and build from it. A sketched outline comes with its cleaned points: use them (define_profile, then sweep or extrude) rather than guessing. Ask only for a dimension you cannot read or infer.
You draft for a person who will carry on by hand: keep everything editable. Build with parametric commands (create_* shapes, create_parametric, sweep along a curve, live arrays, design_* surfaces) rather than baked meshes or one big generate_mesh; never bake unless asked; give each part a clear name and group the parts of one object, so the user can select it and change its parameters afterwards.
After building, verify with get_scene${vision ? ' and a screenshot' : ''}, fix problems, then answer with a short summary (2-4 lines). Do not paste JSON back to the user.${small ? '\nYou see only some tools. If you need another, call list_commands with a query describing the task; every listed command can be called.' : ''}

${GUIDE}
${skill ? `\n${skill}\n` : ''}
Current model: ${doc.entities.length} entities${list ? `: ${list}` : ''}${doc.entities.length > 80 ? ' …' : ''}.
Selection: ${selection.join(', ') || 'nothing'}. Timeline: ${doc.animation.duration}s, ${doc.animation.tracks.length} tracks, playhead at ${time.toFixed(2)}s.`;
}

/** Commands a request gets: all of them for big models; a routed subset (with examples) for small local ones. */
export function selectTools(protocol, all, { history = [], toolset = null, routing = true } = {}) {
  if (protocol !== 'ollama' || !routing || toolset === 'all') return all;
  const lastUser = [...history].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content || '';
  const used = history.flatMap((m) => (m.tool_calls || []).map((c) => c.function?.name)).filter(Boolean);
  return routeTools(all, { query: lastUser, used, toolset: toolset === 'auto' ? null : toolset });
}

export function toolDefs(protocol, cmds) {
  if (protocol === 'anthropic') return cmds.map((c) => ({ name: c.name, description: c.description, input_schema: c.params }));
  const desc = protocol === 'ollama' ? describe : (c) => c.description;
  return cmds.map((c) => ({ type: 'function', function: { name: c.name, description: desc(c), parameters: c.params } }));
}

export function buildRequest(protocol, { system, tools, history }) {
  if (protocol === 'anthropic') return { system, tools, messages: history };
  const body = { messages: [{ role: 'system', content: system }, ...history], tools };
  if (protocol === 'ollama') return { ...body, stream: false, options: { num_ctx: 32768, temperature: 0.2 } };
  return body;
}

export function parseReply(protocol, data) {
  if (protocol === 'anthropic') {
    const content = data.content || [];
    return {
      text: content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
      calls: content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
      message: { role: 'assistant', content },
    };
  }
  let m = protocol === 'ollama' ? data.message : data.choices?.[0]?.message;
  if (!m) throw new Error(`Unexpected reply: ${JSON.stringify(data).slice(0, 300)}`);
  // reasoning (<think>…</think>, Qwen 3 and the like) is not the answer, and would fill the context on later steps
  if (typeof m.content === 'string' && m.content.includes('<think>')) m = { ...m, content: splitThinking(m.content).text };
  const calls = (m.tool_calls || []).map((c, i) => {
    let args = c.function.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args || '{}');
      } catch {
        args = { __unparsed: args };
      }
    }
    return { id: c.id || `call_${Date.now()}_${i}`, name: c.function.name, args };
  });
  return { text: (m.content || '').trim(), calls, message: m };
}

/** The message that carries one tool result back to the model. */
export function toolResultMessage(protocol, call, result, isError) {
  const images = [result?.image, ...(result?.images || [])].filter(Boolean);
  const image = images[0];
  if (images.length) result = { ...result, image: undefined, images: undefined, note: `${images.length} image${images.length > 1 ? 's' : ''} attached` };
  const json = JSON.stringify(result ?? { ok: true });
  const content = json.length > 24000 ? `${json.slice(0, 24000)}…(truncated)` : json;
  if (protocol === 'anthropic') {
    const blocks = image ? [{ type: 'text', text: content }, ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: im.split(',')[1] } }))] : content;
    return { type: 'tool_result', tool_use_id: call.id, content: blocks, is_error: isError };
  }
  const note = image ? `${content}\n(This model cannot see images; use get_scene numbers instead.)` : content;
  return protocol === 'ollama' ? { role: 'tool', tool_name: call.name, content: note } : { role: 'tool', tool_call_id: call.id, content: note };
}

/** The user's message with pictures (#229): images are data URLs, sent the way each protocol takes them. */
export function userMessage(protocol, text, images = []) {
  if (!images.length) return { role: 'user', content: text };
  const parts = images.map((u) => {
    const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(u);
    if (!m) throw new Error('A picture must be a PNG or JPEG data URL.');
    return { type: m[1], data: m[2] };
  });
  if (protocol === 'anthropic') return { role: 'user', content: [...parts.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.type, data: p.data } })), { type: 'text', text }] };
  if (protocol === 'ollama') return { role: 'user', content: text, images: parts.map((p) => p.data) };
  return { role: 'user', content: [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] };
}

/** A one-shot request that shows images to a vision model (design review). */
export function visionRequest(protocol, { system, text, images }) {
  const b64 = images.map((im) => im.split(',')[1]);
  if (protocol === 'anthropic') return { system, messages: [{ role: 'user', content: [...b64.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })), { type: 'text', text }] }] };
  if (protocol === 'ollama') return { stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: text, images: b64 }] };
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] }] };
}

export const REVIEW_SYSTEM = `You review 3D models made in MyModellerReel (metres, Y up). You get four views (iso, front, top, right), scene
numbers and the issues an automatic check found. Reply with at most 8 short bullet points: real problems first (floating
or intersecting parts, wrong scale or proportions, missing obvious parts, things that would not stand or work), then
one or two improvements. Name parts as the scene does. No preamble.`;

/** The tokens a reply reports, { in, out }: Anthropic, OpenAI and Ollama (the built-in model too) fields. */
export function usageOf(data) {
  const u = data?.usage || {};
  return { in: u.input_tokens ?? u.prompt_tokens ?? data?.prompt_eval_count ?? 0, out: u.output_tokens ?? u.completion_tokens ?? data?.eval_count ?? 0 };
}

/** Text that may carry reasoning in <think>…</think>: { thinking, text, open } (open: still thinking, no closing tag yet). */
export function splitThinking(s = '') {
  const parts = [];
  const text = s.replace(/<think>([\s\S]*?)(<\/think>|$)/g, (_, t) => (parts.push(t), '')).replace(/^\s*<\/think>/, '');
  return { thinking: parts.join('\n').trim(), text: text.trim(), open: /<think>(?![\s\S]*<\/think>)/.test(s) };
}

/** A tool call's arguments in a few words, for the step list: `width 2, height 1, name "Box"`. */
export function shortArgs(args, max = 80) {
  const num = (x) => (typeof x === 'number' ? +x.toFixed(3) : x);
  const val = (v) =>
    typeof v === 'string' ? JSON.stringify(v.length > 24 ? `${v.slice(0, 24)}…` : v)
    : Array.isArray(v) ? (v.length <= 4 && v.every((x) => typeof x === 'number') ? `[${v.map(num).join(', ')}]` : `[${v.length}]`)
    : v && typeof v === 'object' ? '{…}'
    : String(num(v));
  const s = Object.entries(args || {}).filter(([k]) => k !== '__unparsed').map(([k, v]) => `${k} ${val(v)}`).join(', ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A finished turn's numbers for people: "12.4 s · model 10.1 s · tools 0.3 s · 3 steps · 2 calls · 18 tok/s". */
export function turnSummary(st) {
  const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  return [sec(st.ms), `model ${sec(st.model_ms)}`, `tools ${sec(st.tool_ms)}`, n(st.steps, 'step'), n(st.calls, 'tool call'), st.errors ? n(st.errors, 'error') : '', st.tokens_in + st.tokens_out ? `${st.tokens_in} in, ${st.tokens_out} out tokens` : '', st.tokens_per_s ? `${st.tokens_per_s} tok/s` : ''].filter(Boolean).join(' · ');
}

/** Fresh turn timings (see runTurn). */
export function newStats() {
  return { steps: 0, calls: 0, errors: 0, ms: 0, model_ms: 0, tool_ms: 0, tokens_in: 0, tokens_out: 0, tokens_per_s: 0, trace: [] };
}

/**
 * One user turn: ask, run the tool calls, feed results back, until the model answers without tools.
 * chat(body) → provider JSON. run(name, args) → command result. hooks: onText, onCall(call) → token, onResult(token,
 * call, result, isError), onThinking(bool), stopped().
 * Returns its timings, `stats` (newStats(); filled as it runs, so a caller that passes its own reads them live and after
 * an error): { steps, calls, errors, ms, model_ms, tool_ms, tokens_in, tokens_out, tokens_per_s,
 * trace: [{ step, model_ms, in, out } | { step, tool, ms, error? }] }.
 */
export async function runTurn({ protocol, chat, run, list, history, system, toolset = null, routing = true, hooks = {}, maxSteps = MAX_STEPS, stats = newStats(), now = () => performance.now() }) {
  const t0 = now();
  // The instructions and tools stay the same for the whole turn (#257): a local model then reuses what it already read
  // (its prompt cache) and reads only the new messages each step; tool results tell it what changed.
  const sys = typeof system === 'function' ? system() : system;
  const tools = toolDefs(protocol, selectTools(protocol, list(), { history, toolset, routing }));
  try {
    for (let step = 0; step < maxSteps && !hooks.stopped?.(); step++) {
      stats.steps++;
      hooks.onThinking?.(true);
      let data;
      const tm = now();
      try {
        data = await chat(buildRequest(protocol, { system: sys, tools, history }));
      } finally {
        hooks.onThinking?.(false);
        const ms = Math.round(now() - tm);
        const u = usageOf(data);
        stats.model_ms += ms;
        stats.tokens_in += u.in;
        stats.tokens_out += u.out;
        stats.trace.push({ step: stats.steps, model_ms: ms, in: u.in, out: u.out });
      }
      const { text, calls, message } = parseReply(protocol, data);
      history.push(message);
      if (text) hooks.onText?.(text);
      if (!calls.length) return stats;
      const results = [];
      for (const c of calls) {
        if (hooks.stopped?.()) {
          results.push(toolResultMessage(protocol, c, { error: 'Stopped by the user before this ran.' }, true));
          continue;
        }
        const token = hooks.onCall?.(c);
        let result;
        let isError = false;
        const tc = now();
        try {
          if (c.args?.__unparsed !== undefined) throw new Error(`Your arguments for ${c.name} were not valid JSON: ${String(c.args.__unparsed).slice(0, 200)}`);
          result = await run(c.name, c.args);
        } catch (e) {
          isError = true;
          result = { error: e.message };
        }
        const ms = Math.round(now() - tc);
        stats.calls++;
        stats.tool_ms += ms;
        if (isError) stats.errors++;
        stats.trace.push({ step: stats.steps, tool: c.name, ms, ...(isError ? { error: String(result.error).slice(0, 200) } : {}) });
        hooks.onResult?.(token, c, result, isError, ms);
        results.push(toolResultMessage(protocol, c, result, isError));
      }
      if (protocol === 'anthropic') history.push({ role: 'user', content: results });
      else history.push(...results);
    }
    if (!hooks.stopped?.()) hooks.onText?.('I stopped after many steps. Say "continue" to go on.');
    return stats;
  } finally {
    stats.ms = Math.round(now() - t0);
    const r = stats.tokens_out && stats.model_ms ? stats.tokens_out / (stats.model_ms / 1000) : 0;
    stats.tokens_per_s = r >= 10 ? Math.round(r) : Math.round(r * 10) / 10; // a slow local model still shows, e.g. 0.3
  }
}
