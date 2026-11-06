// The in-app copilot. It drives the same command registry as the UI, through three wire protocols:
// Anthropic Messages (Claude), Ollama native chat (local Mistral & co.) and OpenAI-compatible chat completions.
import { GUIDE } from '../core/commands.js';
import { h, icon } from './ui.js';

// Small local models choke on 60 tool definitions; give them the ones that matter (run_script reaches the rest).
const CORE = [
  'get_scene', 'get_entity', 'select', 'create_box', 'create_cylinder', 'create_sphere', 'create_cone', 'create_prism', 'create_face',
  'push_pull', 'move', 'rotate', 'scale', 'duplicate', 'delete', 'group', 'set_pivot', 'set_material', 'boolean', 'animate',
  'add_keyframe', 'build_sequence', 'turntable', 'set_view', 'zoom_extents', 'run_script', 'undo',
];
const SUGGESTIONS = [
  'Model a small two-storey house with a pitched roof, a door and four windows',
  'Build a 12-step staircase, then animate it as a bottom-up build sequence',
  'Make a door hinged on its left side and animate it opening over 2 seconds',
  'Add a 10 second turntable camera so I can export a reel',
  'Look at my model and suggest three improvements',
  'Create a plugin with a command that makes a parametric bookshelf',
];
const MAX_STEPS = 40;

export class Assistant {
  constructor(app) {
    this.app = app;
    this.history = [];
    this.protocol = null;
    this.el = this.build();
  }

  get settings() {
    return this.app.settings.ai;
  }
  modelName() {
    const s = this.settings;
    return s.provider === 'anthropic' ? s.anthropic.model : s.provider === 'openai' ? s.openai.model : s.ollama.model;
  }

  build() {
    this.head = h('div.chat-head');
    this.log = h('div.chat-log');
    this.input = h('textarea', { placeholder: 'Describe what to build or animate…  (Enter sends, Shift+Enter new line)', 'aria-label': 'Message the AI' });
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    };
    this.sendBtn = h('button.btn.primary', { onclick: () => (this.busy ? this.stop() : this.send()), title: 'Send (Enter)' }, icon('paper-plane-right'));
    const el = h('div.chat', {}, this.head, this.log, h('div.chat-input', {}, this.input, this.sendBtn));
    this.renderHead();
    this.empty();
    return el;
  }
  renderHead() {
    const s = this.settings;
    const name = s.provider === 'anthropic' ? 'Claude' : s.provider === 'openai' ? 'API' : 'Local';
    const ok = s.provider === 'ollama' || s[s.provider]?.hasKey;
    this.head.replaceChildren(
      icon('sparkle'),
      h('b.grow', {}, 'Copilot'),
      h(`button.model-pill${ok ? '.ok' : ''}`, { title: 'Change the AI model', onclick: () => this.app.ui.show('settings') }, h('span.dot'), `${name} · ${this.modelName()}`),
      h('button.icon-btn.sm', { title: 'New chat', 'aria-label': 'New chat', onclick: () => this.reset() }, icon('chat-circle')),
    );
  }
  empty() {
    this.log.replaceChildren(
      h(
        'div.chat-empty',
        {},
        h('p.muted', {}, 'Ask in plain words. The copilot uses every modelling, animation and file command, sees what you selected, and each of its turns is a single undo step.'),
        ...SUGGESTIONS.map((s) => h('button.chip', { onclick: () => this.ask(s) }, s)),
      ),
    );
  }
  focus() {
    this.input.focus();
  }
  reset() {
    this.stop();
    this.history = [];
    this.empty();
  }
  ask(text) {
    this.app.ui.show('ai');
    this.input.value = text;
    this.send();
  }
  stop() {
    this.stopped = true;
  }

  add(node) {
    this.log.querySelector('.chat-empty')?.remove();
    this.log.append(node);
    this.log.scrollTop = this.log.scrollHeight;
    return node;
  }

  systemPrompt() {
    const doc = this.app.store.doc;
    const list = doc.entities.slice(0, 80).map((e) => `${e.id} "${e.name}"${e.parent ? ` in ${e.parent}` : ''}`).join(', ');
    return `You are the modelling and animation copilot inside MyModellerReel, a desktop 3D modeller with push/pull modelling and keyframe animation.
You act by calling tools: each call changes the live model the user is looking at.
Work like an expert: plan briefly, use realistic real-world dimensions, prefer fewer bigger steps (run_script for anything repetitive), name things clearly, group parts that belong together.
After building, verify with get_scene${this.settings.provider === 'anthropic' ? ' and a screenshot' : ''}, fix problems, then answer with a short summary (2-4 lines). Do not paste JSON back to the user.

${GUIDE}

Current model: ${doc.entities.length} entities${list ? `: ${list}` : ''}${doc.entities.length > 80 ? ' …' : ''}.
Selection: ${this.app.selection.join(', ') || 'nothing'}. Timeline: ${doc.animation.duration}s, ${doc.animation.tracks.length} tracks, playhead at ${this.app.timeline.time.toFixed(2)}s.`;
  }

  tools(protocol) {
    const all = this.app.reg.list();
    const cmds = protocol === 'ollama' ? all.filter((c) => CORE.includes(c.name) || c.category === 'plugin') : all;
    if (protocol === 'anthropic') return cmds.map((c) => ({ name: c.name, description: c.description, input_schema: c.params }));
    return cmds.map((c) => ({ type: 'function', function: { name: c.name, description: c.description, parameters: c.params } }));
  }

  async send() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    const protocol = this.settings.provider === 'anthropic' ? 'anthropic' : this.settings.provider === 'ollama' ? 'ollama' : 'openai';
    if (protocol !== this.protocol) (this.history = []), (this.protocol = protocol);
    this.add(h('div.msg.user', {}, text));
    this.history.push({ role: 'user', content: text });

    const app = this.app;
    const ctx = app.ctx;
    this.busy = true;
    this.stopped = false;
    this.sendBtn.replaceChildren(icon('stop'));
    this.sendBtn.title = 'Stop';
    const thinking = h('div.thinking', {}, h('i'), h('i'), h('i'));
    // The whole turn is one undo step; the view still updates after every tool call.
    app.store.checkpoint();
    ctx.batchDepth = (ctx.batchDepth || 0) + 1;
    try {
      for (let step = 0; step < MAX_STEPS && !this.stopped; step++) {
        this.add(thinking);
        const { data } = await window.native.invoke('ai:chat', this.request(protocol));
        thinking.remove();
        const { text: reply, calls, message } = this.parse(protocol, data);
        this.history.push(message);
        if (reply) this.add(h('div.msg.assistant', {}, reply));
        if (!calls.length) break;
        const results = [];
        for (const c of calls) {
          if (this.stopped) break;
          results.push(await this.exec(protocol, c));
        }
        if (protocol === 'anthropic') this.history.push({ role: 'user', content: results });
        else this.history.push(...results);
        if (step === MAX_STEPS - 1) this.add(h('div.msg.assistant', {}, 'I stopped after many steps. Say "continue" to go on.'));
      }
    } catch (e) {
      thinking.remove();
      this.add(h('div.msg.error', {}, e.message.replace(/^Error invoking remote method 'ai:chat': (Error: )?/, '')));
      if (this.history.at(-1)?.role === 'user' && typeof this.history.at(-1).content === 'string') this.history.pop();
    } finally {
      ctx.batchDepth--;
      app.store.changed();
      this.busy = false;
      this.sendBtn.replaceChildren(icon('paper-plane-right'));
      this.sendBtn.title = 'Send (Enter)';
    }
  }

  request(protocol) {
    const tools = this.tools(protocol);
    const system = this.systemPrompt();
    if (protocol === 'anthropic') return { system, tools, messages: this.history };
    const body = { messages: [{ role: 'system', content: system }, ...this.history], tools };
    if (protocol === 'ollama') return { ...body, stream: false, options: { num_ctx: 32768, temperature: 0.2 } };
    return body;
  }

  parse(protocol, data) {
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
          args = {};
        }
      }
      return { id: c.id || `call_${Date.now()}_${i}`, name: c.function.name, args };
    });
    return { text: (m.content || '').trim(), calls, message: m };
  }

  async exec(protocol, call) {
    const row = h('details.toolcall', {}, h('summary', {}, `${call.name} ${JSON.stringify(call.args).slice(0, 120)}`));
    this.add(row);
    let result;
    let isError = false;
    try {
      result = await this.app.reg.run(call.name, call.args);
    } catch (e) {
      isError = true;
      result = { error: e.message };
      row.classList.add('err');
    }
    this.app.store.changed(); // live update inside the batched turn
    const image = result?.image;
    if (image) {
      row.append(h('img', { src: image, alt: 'Screenshot the AI looked at', style: { maxWidth: '100%', borderRadius: '6px', marginTop: '4px' } }));
      result = { ...result, image: undefined, note: 'screenshot attached' };
    }
    const json = JSON.stringify(result ?? { ok: true });
    row.append(h('pre', {}, json.slice(0, 4000)));
    const content = json.length > 24000 ? `${json.slice(0, 24000)}…(truncated)` : json;
    if (protocol === 'anthropic') {
      const blocks = image
        ? [{ type: 'text', text: content }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.split(',')[1] } }]
        : content;
      return { type: 'tool_result', tool_use_id: call.id, content: blocks, is_error: isError };
    }
    const note = image ? `${content}\n(This model cannot see images; use get_scene numbers instead.)` : content;
    return protocol === 'ollama' ? { role: 'tool', tool_name: call.name, content: note } : { role: 'tool', tool_call_id: call.id, content: note };
  }
}
