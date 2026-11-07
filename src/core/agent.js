// The copilot's agent loop, free of DOM and Electron: the in-app copilot and the eval harness (npm run eval) share it.
// Three wire protocols: Anthropic Messages (Claude), Ollama native chat (local models), OpenAI-compatible chat.
import { GUIDE } from './commands.js';
import { routeTools, describe } from './routing.js';

export const MAX_STEPS = 40;

export const protocolOf = (provider) => (provider === 'anthropic' ? 'anthropic' : provider === 'ollama' ? 'ollama' : 'openai');

export function systemPrompt({ doc, selection = [], time = 0, vision = false, skill = null, small = false }) {
  const list = doc.entities.slice(0, 80).map((e) => `${e.id} "${e.name}"${e.parent ? ` in ${e.parent}` : ''}`).join(', ');
  return `You are the modelling and animation copilot inside MyModellerReel, a desktop 3D modeller with push/pull modelling and keyframe animation.
You act by calling tools: each call changes the live model the user is looking at.
Work like an expert: plan briefly, use realistic real-world dimensions, prefer fewer bigger steps (run_script for anything repetitive), name things clearly, group parts that belong together.
Prefer relations to coordinates: place_on, against, stack, align, distribute, find_free_space.
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
  const m = protocol === 'ollama' ? data.message : data.choices?.[0]?.message;
  if (!m) throw new Error(`Unexpected reply: ${JSON.stringify(data).slice(0, 300)}`);
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

/**
 * One user turn: ask, run the tool calls, feed results back, until the model answers without tools.
 * chat(body) → provider JSON. run(name, args) → command result. hooks: onText, onCall(call) → token, onResult(token,
 * call, result, isError), onThinking(bool), stopped(). Returns { steps, calls, errors }.
 */
export async function runTurn({ protocol, chat, run, list, history, system, toolset = null, routing = true, hooks = {}, maxSteps = MAX_STEPS }) {
  const stats = { steps: 0, calls: 0, errors: 0 };
  for (let step = 0; step < maxSteps && !hooks.stopped?.(); step++) {
    stats.steps++;
    const tools = toolDefs(protocol, selectTools(protocol, list(), { history, toolset, routing }));
    hooks.onThinking?.(true);
    let data;
    try {
      data = await chat(buildRequest(protocol, { system: typeof system === 'function' ? system() : system, tools, history }));
    } finally {
      hooks.onThinking?.(false);
    }
    const { text, calls, message } = parseReply(protocol, data);
    history.push(message);
    if (text) hooks.onText?.(text);
    if (!calls.length) return stats;
    const results = [];
    for (const c of calls) {
      if (hooks.stopped?.()) break;
      const token = hooks.onCall?.(c);
      let result;
      let isError = false;
      try {
        if (c.args?.__unparsed !== undefined) throw new Error(`Your arguments for ${c.name} were not valid JSON: ${String(c.args.__unparsed).slice(0, 200)}`);
        result = await run(c.name, c.args);
      } catch (e) {
        isError = true;
        result = { error: e.message };
      }
      stats.calls++;
      if (isError) stats.errors++;
      hooks.onResult?.(token, c, result, isError);
      results.push(toolResultMessage(protocol, c, result, isError));
    }
    if (protocol === 'anthropic') history.push({ role: 'user', content: results });
    else history.push(...results);
  }
  if (!hooks.stopped?.()) hooks.onText?.('I stopped after many steps. Say "continue" to go on.');
  return stats;
}
