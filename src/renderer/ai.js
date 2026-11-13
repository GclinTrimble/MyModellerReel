// The in-app assistant (Plumb): a chat panel over the shared agent loop (src/core/agent.js), which drives the same command
// registry as the UI. Each turn is one undo step, or a pending proposal when "Propose" is on. One Assistant per agent
// profile (#243): its own thread, queue and model; tool calls go through the crew (src/core/agents.js).
import { protocolOf, systemPrompt, runTurn, userMessage, newStats, shortArgs, splitThinking, turnSummary } from '../core/agent.js';
import { crewRun, DEFAULT_AGENT } from '../core/agents.js';
import { h, icon, infoTip } from './ui.js';
import { sketchPad } from './sketch.js';
import * as FB from '../core/feedback.js';

/** A picture made small enough for a model to read cheaply (longest side 1568 px), as a data URL. */
export function fitPicture(url, max = 1568) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      if (k === 1 && /^data:image\/(png|jpeg)/.test(url)) return resolve(url);
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(im.width * k), height: Math.round(im.height * k) });
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      resolve(c.toDataURL(/^data:image\/png/.test(url) ? 'image/png' : 'image/jpeg', 0.9));
    };
    im.onerror = () => reject(new Error('This file is not a picture the AI can read (use PNG or JPEG).'));
    im.src = url;
  });
}
const readFile = (file) => new Promise((resolve) => Object.assign(new FileReader(), { onload: (e) => resolve(e.target.result) }).readAsDataURL(file));
/** Local models that can see pictures, by name. */
const SEES = /llava|vision|-vl|vl:|gemma3|minicpm-v|moondream|bakllava|qwen2\.5vl|qwen3-vl|llama4|mistral-small3/i;
import { SKILLS, USER_SKILLS, skillPrompt } from '../core/skills.js';

const SUGGESTIONS = [
  'Model a small two-storey house with a pitched roof, a door and four windows',
  'Build a 12-step staircase from separate steps, then animate it as a bottom-up build sequence',
  'Make a door hinged on its left side and animate it opening over 2 seconds',
  'Add a 10 second turntable camera so I can export a reel',
  'Look at my model and suggest three improvements',
  'Create a plugin with a command that makes a parametric bookshelf',
];

export class Assistant {
  constructor(app, profile, agents) {
    this.app = app;
    this.profile = profile;
    this.agents = agents;
    this.queue = []; // tasks waiting while a turn runs: { text, done }
    this.history = [];
    this.turns = []; // the last turns' timings (ai_turns)
    this.feedbackTurns = []; // this session's turns as training records (#232), newest last
    this.protocol = null;
    this.propose = localStorage.getItem('mymodellerreel.propose') === '1';
    this.el = this.build();
  }

  get settings() {
    return this.app.settings.ai;
  }
  provider() {
    return this.profile.provider || this.settings.provider;
  }
  modelName() {
    const s = this.settings;
    const p = this.provider();
    return this.profile.model || (p === 'anthropic' ? s.anthropic.model : p === 'openai' ? s.openai.model : p === 'builtin' ? s.builtin.model : s.ollama.model);
  }
  get mine() {
    return this.profile.id === DEFAULT_AGENT;
  }

  build() {
    this.head = h('div.chat-head');
    this.log = h('div.chat-log');
    this.input = h('textarea', { placeholder: 'Ask Plumb what to build or animate…  (Enter sends, Shift+Enter new line)', 'aria-label': 'Message the AI' });
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    };
    this.sendBtn = h('button.btn.primary', { onclick: () => (this.busy ? this.stop() : this.send()), title: 'Send (Enter)' }, icon('paper-plane-right'));
    // voice (#98): hold to talk; MyVoiceReel's engine turns it into text on this PC
    this.micBtn = h('button.btn.icon-only', { title: 'Hold to talk (or hold Ctrl+M)', 'aria-label': 'Hold to talk', onpointerdown: (e) => (e.preventDefault(), this.listen()), onpointerup: () => this.hear(), onpointerleave: () => this.recorder && this.hear() }, icon('microphone'));
    // pictures (#229): attach, paste, drop, or sketch over the view; they go with the next message
    this.pictures = [];
    this.strip = h('div.chat-pictures', { role: 'list', 'aria-label': 'Pictures to send', hidden: true });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true, onchange: async (e) => { for (const f of e.target.files) await this.attachPicture(await readFile(f)); e.target.value = ''; } });
    const clip = h('button.btn.icon-only', { title: 'Attach a picture (or paste / drop one here)', 'aria-label': 'Attach a picture', onclick: () => file.click() }, icon('paperclip'));
    const draw = h('button.btn.icon-only', { title: 'Sketch for the AI: draw over the view or on paper', 'aria-label': 'Sketch for the AI', onclick: async () => { const r = await sketchPad(this.app, { mode: 'chat' }); if (r) await this.attachPicture(r.image, r.note); } }, icon('scribble'));
    this.input.onpaste = async (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) await this.attachPicture(await readFile(f));
    };
    const el = h('div.chat', {}, this.head, this.log, h('div.chat-compose', {}, this.strip, h('div.chat-input', {}, this.input, h('div.chat-tools', {}, clip, draw, this.micBtn), this.sendBtn)), file);
    el.ondragover = (e) => [...(e.dataTransfer?.items || [])].some((i) => i.type.startsWith('image/')) && (e.preventDefault(), el.classList.add('drop'));
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = async (e) => {
      el.classList.remove('drop');
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) await this.attachPicture(await readFile(f));
    };
    this.renderHead();
    this.empty();
    return el;
  }
  renderHead() {
    const s = this.settings;
    const p = this.provider();
    const name = p === 'anthropic' ? 'Claude' : p === 'openai' ? 'API' : 'Local';
    const ok = p === 'ollama' || p === 'builtin' || s[p]?.hasKey;
    const others = this.agents.profiles.length > 1;
    this.head.replaceChildren(
      others
        ? h('select.agent-pick', { title: 'Which agent this thread belongs to', 'aria-label': 'Agent', style: { color: this.profile.color }, onchange: (e) => this.agents.open(e.target.value) }, this.agents.profiles.map((a) => h('option', { value: a.id, selected: a.id === this.profile.id }, a.name)))
        : icon('sparkle'),
      !this.mine
        ? h('span.small.muted.grow', { title: 'The skill of this agent (change it in the Agents panel)' }, this.profile.skill ? SKILLS[this.profile.skill]?.label || this.profile.skill : 'No skill')
        : h(
        'select.skill-pick.grow',
        { title: 'Domain skill: know-how Plumb adds to its instructions', 'aria-label': 'Domain skill', onchange: (e) => this.app.reg.run('use_skill', { name: e.target.value }) },
        h('option', { value: 'none' }, 'No skill'),
        Object.entries({ ...SKILLS, ...USER_SKILLS }).map(([k, s]) => h('option', { value: k, selected: this.app.ctx.skill === k }, USER_SKILLS[k] ? `${s.label} (mine)` : s.label)),
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
        (this.provider() === 'ollama' || this.provider() === 'builtin') && window.native ? this.setupCard({ quiet: true }) : null,
        h('p.muted', {}, 'Ask in plain words. Plumb drafts for you with the same tools you have: what it makes stays editable (select it, change its parameters, or ask again), each turn is one undo step.'),
        ...SUGGESTIONS.map((s) => h('button.chip', { onclick: () => this.ask(s) }, s)),
      ),
    );
  }
  /** The things a turn made: select one, or open its parameters to change it by hand. */
  madeList(made) {
    const app = this.app;
    const pick = (e, edit) => (app.reg.run('select', { ids: [e.id] }).catch(() => (app.selection = [e.id])), edit && app.ui.show('entity'));
    return h(
      'div.made-list',
      { role: 'list', 'aria-label': 'Made in this turn' },
      h('div.overline', {}, `Made (${made.length}): edit by hand`),
      ...made.slice(0, 12).map((e) => h('div.made-item.row', { role: 'listitem' }, icon(e.derived ? 'sliders-horizontal' : e.type === 'group' ? 'stack' : e.curve ? 'pencil-line' : 'cube'), h('span.grow', { title: e.derived ? `Parametric: ${e.derived.generator}` : 'A plain shape' }, e.name), h('button.btn.sm', { onclick: () => pick(e) }, 'Select'), e.derived ? h('button.btn.sm', { onclick: () => pick(e, true), title: 'Change its parameters' }, icon('sliders-horizontal'), 'Edit') : null)),
      made.length > 12 ? h('div.small.muted', {}, `and ${made.length - 12} more`) : null,
    );
  }
  focus() {
    this.input.focus();
  }

  /** Add a picture to the next message (note: words that go with it, e.g. a sketch's cleaned points). open: show the chat. */
  async attachPicture(url, note = '', open = false) {
    try {
      this.pictures.push({ url: await fitPicture(url), note });
    } catch (e) {
      return this.app.ui.toast(e.message, 'danger');
    }
    this.drawPictures();
    if ((this.provider() === 'ollama' || this.provider() === 'builtin') && !SEES.test(this.modelName()) && !this.warnedSight) {
      this.warnedSight = true;
      this.app.ui.toast(`${this.modelName()} may not see pictures. A vision model (gemma3, qwen2.5vl, llava) or Claude reads them; a sketch's cleaned points still go as text.`);
    }
    if (open) this.app.ui.show('ai', true);
    this.input.focus();
  }
  drawPictures() {
    this.strip.hidden = !this.pictures.length;
    this.strip.replaceChildren(
      ...this.pictures.map((p, i) =>
        h('div.chat-picture', { role: 'listitem' }, h('img', { src: p.url, alt: p.note ? 'Sketch' : 'Picture' }), p.note ? h('span.chat-picture-tag', { title: p.note }, icon('polygon'), 'outline') : null, h('button.chat-picture-x', { type: 'button', 'aria-label': 'Remove this picture', title: 'Remove', onclick: () => (this.pictures.splice(i, 1), this.drawPictures()) }, icon('x'))),
      ),
    );
  }

  /**
   * Local AI setup (#224, #238, #255): pick the model the app runs itself from a list, download it once; or, for
   * Ollama users, start it and pull its model. The step done is ticked. quiet: nothing shows when all is ready (the empty chat).
   */
  setupCard({ quiet = false } = {}) {
    const app = this.app;
    const box = h('div.card.ai-setup', { hidden: quiet });
    let poll = null;
    const run = (name, args = {}) => app.reg.run(name, args).catch((e) => (app.ui.toast(e.message, 'danger'), null));
    const watch = (ms) => {
      clearInterval(poll);
      const until = Date.now() + 15 * 60e3;
      poll = setInterval(() => (!box.isConnected || Date.now() > until ? clearInterval(poll) : draw(true)), ms);
    };
    const draw = async (polling = false) => {
      const s = await app.reg.run('ai_setup_status', {}).catch(() => null);
      if (!s || !box.isConnected && polling) return clearInterval(poll);
      if (s.next === 'ready') {
        clearInterval(poll);
        if (quiet) return box.remove();
      }
      box.hidden = false;
      const builtin = s.local === 'builtin';
      const models = s.builtin?.models || [];
      const m = models.find((x) => x.id === s.builtin?.model) || models[0];
      const name = builtin ? m.label : s.model;
      const refresh = async () => ((app.settings = await window.native.invoke('settings:get')), this.renderHead(), draw());
      const gb = (b) => `${(b / 1e9).toFixed(1)} GB`;
      const step = (key, done, title, text, btn) =>
        h(`div.setup-step${done ? '.done' : s.next === key ? '.now' : ''}`, {}, icon(done ? 'check-circle' : 'circle', done), h('div.grow', {}, h('strong', {}, title), text ? h('div.small.muted', {}, text) : null), !done && s.next === key ? btn : null);
      const bar = h('div.learn-bar', { hidden: true, role: 'progressbar', 'aria-label': `Downloading ${name}` }, h('i'));
      const note = h('div.small.muted');
      const pause = h('button.btn.sm', { hidden: true, onclick: () => run('pause_ai_download') }, icon('pause'), 'Pause');
      const download = (command, args) =>
        h('button.btn.sm.primary', {
          onclick: async (ev) => {
            ev.currentTarget.disabled = true;
            bar.hidden = pause.hidden = false;
            window.native?.onPullProgress && !this.pullHooked && ((this.pullHooked = true), window.native.onPullProgress((p) => this.onPull?.(p)));
            this.onPull = (p) => {
              const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
              bar.firstChild.style.width = `${pct}%`;
              bar.setAttribute('aria-valuenow', pct);
              note.textContent = p.status === 'checking' ? 'Checking the file…' : `Downloading · ${pct}% of ${gb(p.total || 0)}`;
            };
            const r = await run(command, args);
            this.onPull = null;
            if (r) {
              app.ui.toast(`${name} is downloaded.`);
              if (builtin) return refresh();
            }
            draw();
          },
        }, icon('download-simple'), 'Download');
      box.replaceChildren(
        h('div.row', {}, icon('sparkle'), h('strong.grow', {}, s.next === 'ready' ? 'Plumb is ready' : 'Set up Plumb on this PC'), builtin ? infoTip(['Runs on this PC', 'Plumb runs a free AI model on your PC, offline: nothing you type leaves it.', 'Download once. A paused download resumes, and the file is checked before it is used. Every model listed is Apache 2.0.']) : null, h('button.icon-btn.sm', { title: 'Look again', 'aria-label': 'Look again', onclick: () => draw() }, icon('arrow-clockwise'))),
        !s.local
          ? h('p.small.muted', {}, 'Plumb uses an online model (Settings › AI).')
          : builtin
            ? h(
                'div.model-pick',
                {},
                h(
                  'div.row',
                  {},
                  h('select', { 'aria-label': 'Assistant model', onchange: async (e) => (await run('use_ai_model', { provider: 'builtin', model: e.target.value })) && refresh() }, models.map((x) => h('option', { value: x.id, selected: x.id === m.id }, `${x.label} · ${gb(x.bytes)}${x.recommended ? ' · recommended' : ''}${x.downloaded ? '  ✓' : ''}`))),
                  infoTip([m.label, m.about, `${m.note}. Wants about ${m.ram} GB of memory.`], `About ${m.label}`),
                ),
                h(
                  'div.row',
                  {},
                  m.downloaded && s.provider === 'builtin'
                    ? h('span.model-state', {}, icon('check-circle', true), 'In use')
                    : m.downloaded
                      ? h('button.btn.sm.primary', { onclick: async () => (await run('use_ai_model', { provider: 'builtin', model: m.id })) && refresh() }, icon('check'), 'Use it')
                      : download('download_ai_model', { model: m.id }),
                  h('span.grow'),
                  m.downloaded
                    ? h('button.icon-btn.sm', {
                        title: `Delete ${m.label} from this PC`,
                        'aria-label': `Delete ${m.label} from this PC`,
                        onclick: async () => (await app.ui.modal(`Delete ${m.label}?`, h('p', {}, `It frees ${gb(m.bytes)}. You can download it again at any time.`), [['Delete', 'delete'], ['Cancel', null]])) === 'delete' && (await run('delete_ai_model', { model: m.id })) && refresh(),
                      }, icon('trash'))
                    : null,
                ),
                m.fits ? null : h('div.model-warn', {}, icon('warning'), `This PC may not have the ${m.ram} GB of memory it wants.`),
              )
            : h(
                'div.setup-steps',
                {},
                step('start', s.ollama === 'running', 'Start Ollama', 'It then runs in the background (tray icon).', h('button.btn.sm.primary', { onclick: async () => (await run('start_local_ai')) && ((note.textContent = 'Starting…'), watch(1500)) }, icon('play'), 'Start')),
                step('pull', s.has_model, `Download ${s.model} into Ollama`, 'A few GB, once.', download('pull_ai_model', { model: s.model })),
              ),
        bar,
        note,
        h(
          'div.row.wrap',
          {},
          s.next === 'ready' ? h('button.btn.sm.primary', { onclick: () => this.ask('Hello! In two lines, what can you do for me here?') }, icon('chat-circle'), 'Try it') : null,
          pause,
          h('button.btn.sm', { onclick: () => app.ui.show('settings') }, icon('gear'), 'Other models'),
          h('button.btn.sm', { onclick: () => app.help.open('first-steps-with-the-copilot') }, icon('book-open'), 'How it works'),
        ),
      );
    };
    draw();
    return box;
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
    this.pendingAsk?.(null);
    this.queue.splice(0).forEach((q) => q.done(''));
    window.native?.invoke('ai:abort', this.profile.id);
    this.agents.changed();
  }

  /** A question from the copilot (#233): choice buttons and / or a box; resolves with the answer (null: stopped). */
  askUser({ question, choices = [], allowText = true }) {
    this.app.ui.show('ai');
    return new Promise((resolve) => {
      const done = (answer) => {
        this.pendingAsk = null;
        card.querySelectorAll('button, input').forEach((b) => (b.disabled = true));
        if (answer != null) this.add(h('div.msg.user', {}, answer));
        resolve(answer);
      };
      const typed = () => box.value.trim() && done(box.value.trim());
      const box = allowText ? h('input', { placeholder: 'Your answer…', 'aria-label': 'Your answer', onkeydown: (e) => e.key === 'Enter' && typed() }) : null;
      const card = h(
        'div.ask-card',
        { role: 'group', 'aria-label': 'The copilot asks' },
        h('div.row', {}, icon('chat-circle-dots'), h('strong.grow', {}, question)),
        choices.length ? h('div.row.wrap', {}, ...choices.map((c) => h('button.btn.sm', { onclick: () => done(c) }, c))) : null,
        box ? h('div.row', {}, box, h('button.btn.sm.primary', { onclick: typed }, 'Answer')) : null,
      );
      this.pendingAsk?.(null);
      this.pendingAsk = done;
      this.add(card);
      (box || card.querySelector('button'))?.focus();
    });
  }

  /** Rate a turn (#232): a thumb saves it at once; tags and what should be different can follow. */
  feedbackRow(turn) {
    const app = this.app;
    const tags = new Set();
    let rating = null;
    const status = h('span.small.muted', { role: 'status' });
    const comment = h('textarea', { rows: 2, placeholder: 'What should be different? (optional)', 'aria-label': 'What should be different' });
    const save = async (more) => {
      try {
        const r = await app.reg.run('rate_ai_turn', { turn: turn.id, rating, comment: comment.value.trim(), tags: [...tags] });
        status.textContent = r.shared ? 'Thanks: saved and shared.' : r.share_error ? `Saved on this PC (not shared: ${r.share_error})` : 'Thanks: saved on this PC.';
        if (more) extra.hidden = true;
      } catch (e) {
        status.textContent = e.message;
      }
    };
    const thumb = (r, ic, label) =>
      h('button.icon-btn.sm.fb-thumb', { title: label, 'aria-label': label, 'aria-pressed': 'false', onclick: () => {
        rating = r;
        row.querySelectorAll('.fb-thumb').forEach((b) => b.setAttribute('aria-pressed', String(b.title === label)));
        extra.hidden = false;
        void save(false);
      } }, icon(ic));
    const share = h('input', { type: 'checkbox', checked: !!this.settings.shareFeedback, onchange: (e) => app.reg.run('share_ai_feedback', { on: e.target.checked }).catch((err) => app.ui.toast(err.message, 'danger')) });
    const extra = h(
      'div.fb-more',
      { hidden: true },
      h('div.row.wrap', {}, ...FB.TAGS.map((t) => h('button.chip.sm', { 'aria-pressed': 'false', onclick: (e) => (tags.has(t) ? tags.delete(t) : tags.add(t), e.currentTarget.setAttribute('aria-pressed', String(tags.has(t)))) }, t))),
      comment,
      h('div.row', {}, h('label.small.row', { title: 'Rated answers, with the request and the model, upload to the MyStudioReel suite under your account to train a better modelling copilot.' }, share, 'Share to improve the copilot'), h('span.grow'), h('button.btn.sm.primary', { onclick: () => save(true) }, 'Send')),
    );
    const row = h('div.feedback', { role: 'group', 'aria-label': 'Rate this answer' }, h('div.row', {}, h('span.small.muted', {}, 'Was this right?'), thumb('good', 'thumbs-up', 'Good answer'), thumb('bad', 'thumbs-down', 'Not right'), status), extra);
    return row;
  }

  add(node) {
    this.log.querySelector('.chat-empty')?.remove();
    // the running turn's card stays last
    if (this.card?.isConnected && node !== this.card) this.log.insertBefore(node, this.card);
    else this.log.append(node);
    this.log.scrollTop = this.log.scrollHeight;
    return node;
  }

  /** Start recording from the microphone (hold to talk); the text goes into input (default: this chat's box). */
  async listen(input = this.input, btn = this.micBtn) {
    if (this.recorder) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = (e) => chunks.push(e.data);
      this.recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        btn.classList.remove('rec');
        if (!chunks.length) return;
        try {
          this.app.ui.setStatus('Listening… turning speech into text');
          const wav = await toWav16k(new Blob(chunks));
          const r = await this.app.io.transcribe(wav);
          if (r.text) input.value = `${input.value ? `${input.value} ` : ''}${r.text}`;
          input.focus();
          this.app.ui.setStatus('');
        } catch (e) {
          this.app.ui.toast(e.message, 'danger');
        }
      };
      this.recorder.start();
      btn.classList.add('rec');
    } catch (e) {
      this.recorder = null;
      this.app.ui.toast(`Microphone: ${e.message}`, 'danger');
    }
  }
  /** Stop recording and transcribe. */
  hear() {
    const r = this.recorder;
    this.recorder = null;
    if (r && r.state !== 'inactive') r.stop();
  }

  /** Send the typed message (or text: a task from Ask, a command or the queue). Resolves with the reply's last words. */
  async send(task = null) {
    const typed = (task ?? this.input.value).trim();
    const pics = task === null ? this.pictures : [];
    if (!typed && !pics.length) return '';
    if (this.busy) {
      // a task given while it works waits its turn (its queue, #243)
      if (task === null) (this.input.value = ''), this.add(h('div.msg.user.queued', {}, typed, h('span.small.muted', {}, ' · queued')));
      return new Promise((done) => (this.queue.push({ text: typed, done }), this.agents.changed()));
    }
    this.lastTask = typed;
    if (task === null) {
      this.input.value = '';
      this.pictures = [];
      this.drawPictures();
    }
    const protocol = protocolOf(this.provider());
    if (protocol !== this.protocol) (this.history = []), (this.protocol = protocol);
    const text = [typed || 'Look at this and build it.', ...pics.map((p) => p.note).filter(Boolean)].join('\n\n');
    this.add(h('div.msg.user', {}, pics.length ? h('div.msg-pictures', {}, ...pics.map((p) => h('img', { src: p.url, alt: 'Sent picture' }))) : null, typed || 'Look at this and build it.'));
    this.history.push(userMessage(protocol, text, pics.map((p) => p.url)));

    const app = this.app;
    const ctx = app.ctx;
    this.busy = true;
    this.stopped = false;
    this.sendBtn.replaceChildren(icon('stop'));
    this.sendBtn.title = 'Stop';
    // the running turn (#257): what it does now, elapsed time, steps and a Stop, kept at the end of the thread
    const stats = (this.stats = newStats());
    const status = h('span.grow', { 'aria-live': 'polite' }, 'Thinking…');
    const clock = h('span.turn-clock');
    const say = (t) => (status.textContent = t);
    this.card = this.add(h('div.turn-live', {}, h('span.turn-spin', { 'aria-hidden': 'true' }), status, clock, h('button.btn.sm', { title: 'Stop this turn: what is done so far stays (undo removes it)', onclick: () => this.stop() }, icon('stop'), 'Stop')));
    const tick = () => (clock.textContent = `${Math.floor((performance.now() - t0) / 1000)} s · step ${stats.steps || 1}${stats.calls ? ` · ${stats.calls} call${stats.calls === 1 ? '' : 's'}` : ''}`);
    const ticker = setInterval(tick, 250);
    // The whole turn is one undo step (or one proposal); the view still updates after every tool call.
    // Agents at work together share the batch: the first opens it (and its proposal), the last closes it.
    const crew = this.agents.crew;
    const first = crew.start(this.profile.id);
    const proposing = first && this.propose && app.store.beginProposal();
    if (first && !proposing) app.store.checkpoint();
    if (first) ctx.batchDepth = (ctx.batchDepth || 0) + 1;
    this.agents.changed();
    let reply = '';
    const turnLength = this.history.length;
    (ctx.turnStarts ||= []).push(app.store.doc.journal?.length || 0); // "save what we just did as a tool" (#242)
    const had = new Set(app.store.doc.entities.map((e) => e.id));
    // the turn as a training record once rated (#232)
    const before = structuredClone(app.store.doc);
    const steps = [];
    const answers = [];
    // text streams into a live bubble, reasoning (<think>) folded above it with a live preview; the final text
    // replaces the streamed one so nothing shows twice
    this.delta = (t) => {
      if (!this.live) this.live = this.add(h('div.msg.assistant.live', {}, h('details.think', { hidden: true }, h('summary'), h('div.think-text')), h('div.msg-text')));
      const b = this.live;
      b.raw = (b.raw || '') + t;
      const r = splitThinking(b.raw);
      const think = b.firstChild;
      think.hidden = !r.thinking && !r.open;
      think.firstChild.textContent = r.open ? `Reasoning… ${r.thinking.slice(-90)}` : `Reasoned (${r.thinking.split(/\s+/).length} words)`;
      think.lastChild.textContent = r.thinking;
      b.lastChild.textContent = r.text;
      say(r.open ? 'Reasoning…' : 'Writing…');
      this.log.scrollTop = this.log.scrollHeight;
    };
    const t0 = performance.now();
    tick();
    try {
      await runTurn({
        stats,
        protocol,
        chat: (body) => app.chat({ ...body, agent: { id: this.profile.id, provider: this.profile.provider, model: this.profile.model } }),
        // a failed call leaves nothing behind for the model to trip over; one touching another agent's work is held
        run: async (name, args) => {
          try {
            return await crewRun(crew, ctx, this.profile, (n, a) => app.reg.run(n, a), name, args);
          } finally {
            // the view shows each change as it lands (the turn stays one undo step); a frame lets it paint even when a
            // reply holds several calls, and the timeout keeps a hidden window (no frames) going
            app.store.changed();
            await new Promise((r) => (requestAnimationFrame(r), setTimeout(r, 50)));
          }
        },
        list: () => app.reg.list(),
        history: this.history,
        system: () =>
          systemPrompt({ doc: app.store.doc, selection: app.selection, time: app.timeline.time, vision: protocol === 'anthropic', small: protocol === 'ollama', skill: [this.mine ? app.skillPrompt?.() : skillPrompt(this.profile.skill), this.profile.instructions && `You are ${this.profile.name}. ${this.profile.instructions}`].filter(Boolean).join('\n\n') }),
        toolset: this.profile.toolset !== 'auto' ? this.profile.toolset : this.settings.toolset || 'auto',
        hooks: {
          stopped: () => this.stopped,
          onThinking: (on) => on && say('Thinking…'),
          onText: (t) => {
            answers.push(t);
            reply = t;
            if (!this.live) return this.add(h('div.msg.assistant', {}, t));
            this.live.lastChild.textContent = t;
            this.live.classList.remove('live');
            this.live = null;
          },
          onCall: (c) => {
            this.live?.classList.remove('live');
            this.live = null;
            say(`Running ${c.name}…`);
            tick();
            const args = shortArgs(c.args);
            steps.push({ name: c.name, args: c.args });
            const row = this.add(h('details.toolcall.running', {}, h('summary', { title: JSON.stringify(c.args) }, h('span.tc-icon', { 'aria-hidden': 'true' }), h('b', {}, c.name), args ? ` ${args}` : '')));
            row.step = steps.at(-1);
            return row;
          },
          onResult: (row, c, result, isError, ms) => {
            row.classList.remove('running');
            row.classList.add(isError ? 'err' : 'ok');
            if (row.step) isError ? (row.step.error = result?.error || result) : (row.step.result = result);
            const sum = row.querySelector('summary');
            if (isError) sum.append(h('span.tc-err', {}, ` · ${String(result.error).slice(0, 140)}`));
            sum.append(h('span.muted', {}, ` · ${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}`));
            say('Thinking…');
            tick();
            if (result?.image) row.append(h('img', { src: result.image, alt: 'Screenshot the AI looked at', style: { maxWidth: '100%', borderRadius: '6px', marginTop: '4px' } }));
            row.append(h('pre', {}, JSON.stringify(result?.image ? { ...result, image: '(image)' } : (result ?? { ok: true })).slice(0, 4000)));
          },
        },
      });
    } catch (e) {
      const msg = e.message.replace(/^Error invoking remote method 'ai:chat': (Error: )?/, '');
      // cannot reach the local model: the setup card, not a raw network error (#224)
      const unreachable = /ECONNREFUSED|Is Ollama running|fetch failed|model .*not found|pull the model|not downloaded yet/i.test(msg) && (this.provider() === 'ollama' || this.provider() === 'builtin');
      this.add(h(msg === 'Stopped.' ? 'div.msg.muted' : 'div.msg.error', {}, msg === 'Stopped.' ? 'Stopped. What is done so far stays (undo removes it).' : unreachable ? 'Plumb cannot reach its AI model on this PC yet. Set it up below (once), then ask again.' : msg));
      if (unreachable) this.add(this.setupCard());
      // keep the history valid for the next turn: drop this turn's dangling user message if nothing came back
      if (this.history.length === turnLength && this.history.at(-1)?.role === 'user') this.history.pop();
    } finally {
      this.live?.classList.remove('live');
      this.live = null;
      this.delta = null;
      clearInterval(ticker);
      this.card.remove();
      this.card = null;
      // the finished turn keeps its numbers; open it for each step's model and tool time
      this.turns.push({ task: typed.slice(0, 200), at: new Date().toISOString(), provider: this.provider(), model: this.modelName(), stopped: !!this.stopped, ...stats });
      this.turns.splice(0, this.turns.length - 20);
      this.add(
        h(
          'details.turn-stats.muted.small',
          {},
          h('summary', { title: 'Time, steps and tokens of this turn' }, turnSummary(stats)),
          h('div.turn-trace', {}, ...stats.trace.map((x) => h('div', {}, x.tool ? `  ${x.tool} · ${x.ms} ms${x.error ? ` · ${x.error}` : ''}` : `step ${x.step} · model ${(x.model_ms / 1000).toFixed(1)} s${x.in + x.out ? ` · ${x.in} in, ${x.out} out` : ''}`))),
        ),
      );
      if (crew.end(this.profile.id)) ctx.batchDepth--;
      app.learning?.aiTurn(stats.calls);
      // what it drafted, ready to change by hand (#225)
      const made = app.store.doc.entities.filter((e) => !had.has(e.id) && !e.parent && e.type !== 'point');
      if (made.length) this.add(this.madeList(made));
      if (steps.length || reply) {
        const turn = FB.turnRecord({ prompt: typed, steps, answer: answers.join('\n'), before, after: app.store.doc, provider: this.provider(), model: this.modelName(), app_version: app.info?.version || '', seconds: (performance.now() - t0) / 1000, tokens: { in: stats.tokens_in, out: stats.tokens_out }, selection: [...(app.selection || [])] });
        this.feedbackTurns = [...this.feedbackTurns.slice(-19), turn];
        this.add(this.feedbackRow(turn));
      }
      if (proposing && app.store.proposalDiff()?.empty) app.store.acceptProposal(); // nothing to review
      app.store.changed();
      this.busy = false;
      this.sendBtn.replaceChildren(icon('paper-plane-right'));
      this.sendBtn.title = 'Send (Enter)';
      this.agents.changed();
      const next = this.queue.shift();
      if (next) queueMicrotask(() => this.send(next.text).then(next.done));
    }
    return reply;
  }
}

/** A recording → 16 kHz mono 16-bit WAV bytes (what the speech engine reads best). */
export async function toWav16k(blob) {
  const raw = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(raw);
  ctx.close();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Uint8Array(out.buffer);
}
