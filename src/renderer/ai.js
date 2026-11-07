// The in-app copilot: a chat panel over the shared agent loop (src/core/agent.js), which drives the same command
// registry as the UI. Each turn is one undo step, or a pending proposal when "Propose" is on.
import { protocolOf, systemPrompt, runTurn } from '../core/agent.js';
import { h, icon } from './ui.js';
import { SKILLS } from '../core/skills.js';

const SUGGESTIONS = [
  'Model a small two-storey house with a pitched roof, a door and four windows',
  'Build a 12-step staircase from separate steps, then animate it as a bottom-up build sequence',
  'Make a door hinged on its left side and animate it opening over 2 seconds',
  'Add a 10 second turntable camera so I can export a reel',
  'Look at my model and suggest three improvements',
  'Create a plugin with a command that makes a parametric bookshelf',
];

export class Assistant {
  constructor(app) {
    this.app = app;
    this.history = [];
    this.protocol = null;
    this.propose = localStorage.getItem('mymodellerreel.propose') === '1';
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
      h(
        'select.skill-pick.grow',
        { title: 'Domain skill: know-how the copilot adds to its instructions', 'aria-label': 'Domain skill', onchange: (e) => this.app.reg.run('use_skill', { name: e.target.value }) },
        h('option', { value: 'none' }, 'No skill'),
        Object.entries(SKILLS).map(([k, s]) => h('option', { value: k, selected: this.app.ctx.skill === k }, s.label)),
      ),
      h(
        'button.icon-btn.sm',
        { title: 'Propose: show the AI\'s changes as a preview to accept or reject', 'aria-label': 'Propose changes for review', 'aria-pressed': String(this.propose), onclick: () => this.setPropose(!this.propose) },
        icon('git-pull-request'),
      ),
      h(`button.model-pill${ok ? '.ok' : ''}`, { title: 'Change the AI model', onclick: () => this.app.ui.show('settings') }, h('span.dot'), `${name} · ${this.modelName()}`),
      h('button.icon-btn.sm', { title: 'New chat', 'aria-label': 'New chat', onclick: () => this.reset() }, icon('chat-circle')),
    );
  }
  setPropose(on) {
    this.propose = on;
    localStorage.setItem('mymodellerreel.propose', on ? '1' : '0');
    this.renderHead();
    this.app.ui.toast(on ? 'Propose on: the AI\'s changes wait for your Accept.' : 'Propose off: the AI\'s changes apply directly (one undo step per turn).');
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

  async send() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    const protocol = protocolOf(this.settings.provider);
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
    // The whole turn is one undo step (or one proposal); the view still updates after every tool call.
    const proposing = this.propose && app.store.beginProposal();
    if (!proposing) app.store.checkpoint();
    ctx.batchDepth = (ctx.batchDepth || 0) + 1;
    const turnLength = this.history.length;
    try {
      await runTurn({
        protocol,
        chat: (body) => app.chat(body),
        run: async (name, args) => {
          const before = JSON.stringify(app.store.doc);
          try {
            return await app.reg.run(name, args);
          } catch (e) {
            app.store.doc = JSON.parse(before); // a failed call leaves nothing behind for the model to trip over
            throw e;
          }
        },
        list: () => app.reg.list(),
        history: this.history,
        system: () =>
          systemPrompt({ doc: app.store.doc, selection: app.selection, time: app.timeline.time, vision: protocol === 'anthropic', small: protocol === 'ollama', skill: app.skillPrompt?.() }),
        toolset: this.settings.toolset || 'auto',
        hooks: {
          stopped: () => this.stopped,
          onThinking: (on) => (on ? this.add(thinking) : thinking.remove()),
          onText: (t) => this.add(h('div.msg.assistant', {}, t)),
          onCall: (c) => this.add(h('details.toolcall', {}, h('summary', {}, `${c.name} ${JSON.stringify(c.args).slice(0, 120)}`))),
          onResult: (row, c, result, isError) => {
            if (isError) row.classList.add('err');
            app.store.changed(); // live update inside the batched turn
            if (result?.image) row.append(h('img', { src: result.image, alt: 'Screenshot the AI looked at', style: { maxWidth: '100%', borderRadius: '6px', marginTop: '4px' } }));
            row.append(h('pre', {}, JSON.stringify(result?.image ? { ...result, image: '(image)' } : (result ?? { ok: true })).slice(0, 4000)));
          },
        },
      });
    } catch (e) {
      thinking.remove();
      this.add(h('div.msg.error', {}, e.message.replace(/^Error invoking remote method 'ai:chat': (Error: )?/, '')));
      // keep the history valid for the next turn: drop this turn's dangling user message if nothing came back
      if (this.history.length === turnLength && this.history.at(-1)?.role === 'user') this.history.pop();
    } finally {
      ctx.batchDepth--;
      if (proposing && app.store.proposalDiff()?.empty) app.store.acceptProposal(); // nothing to review
      app.store.changed();
      this.busy = false;
      this.sendBtn.replaceChildren(icon('paper-plane-right'));
      this.sendBtn.title = 'Send (Enter)';
    }
  }
}
