// The in-app copilot: a chat panel over the shared agent loop (src/core/agent.js), which drives the same command
// registry as the UI. Each turn is one undo step, or a pending proposal when "Propose" is on.
import { protocolOf, systemPrompt, runTurn, userMessage } from '../core/agent.js';
import { h, icon } from './ui.js';
import { sketchPad } from './sketch.js';

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
import { SKILLS, USER_SKILLS } from '../core/skills.js';

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
    const name = s.provider === 'anthropic' ? 'Claude' : s.provider === 'openai' ? 'API' : 'Local';
    const ok = s.provider === 'ollama' || s[s.provider]?.hasKey;
    this.head.replaceChildren(
      icon('sparkle'),
      h(
        'select.skill-pick.grow',
        { title: 'Domain skill: know-how the copilot adds to its instructions', 'aria-label': 'Domain skill', onchange: (e) => this.app.reg.run('use_skill', { name: e.target.value }) },
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
        this.settings.provider === 'ollama' && window.native ? this.setupCard({ quiet: true }) : null,
        h('p.muted', {}, 'Ask in plain words. The copilot drafts for you with the same tools you have: what it makes stays editable (select it, change its parameters, or ask again), each turn is one undo step.'),
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
    if (this.settings.provider === 'ollama' && !SEES.test(this.modelName()) && !this.warnedSight) {
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
   * Local AI setup (#224): install Ollama, start it, download the model, try it, with the step done ticked. quiet:
   * nothing shows when all is ready (the empty chat).
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
      const step = (key, done, title, text, btn) =>
        h(`div.setup-step${done ? '.done' : s.next === key ? '.now' : ''}`, {}, icon(done ? 'check-circle' : 'circle', done), h('div.grow', {}, h('strong', {}, title), text ? h('div.small.muted', {}, text) : null), !done && s.next === key ? btn : null);
      const bar = h('div.learn-bar', { hidden: true, role: 'progressbar', 'aria-label': `Downloading ${s.model}` }, h('i'));
      const note = h('div.small.muted');
      box.replaceChildren(
        h('div.row', {}, icon('sparkle'), h('strong.grow', {}, s.next === 'ready' ? `The copilot is ready (${s.model} on this PC)` : 'Set up the copilot on this PC'), h('button.icon-btn.sm', { title: 'Look again', 'aria-label': 'Look again', onclick: () => draw() }, icon('arrow-clockwise'))),
        s.next === 'ready' ? null : h('p.small', {}, 'The copilot runs a free AI model on your own PC (nothing leaves it). Three steps, once:'),
        s.provider !== 'ollama'
          ? h('p.small.muted', {}, 'The copilot uses an online model (Settings › AI).')
          : h(
              'div.setup-steps',
              {},
              step('install', s.ollama !== 'missing', 'Install Ollama', 'The free app that runs AI models. A window opens; follow it, then come back.', h('button.btn.sm.primary', { onclick: async () => (await run('install_local_ai')) && ((note.textContent = 'Installing… this card ticks itself when Ollama is there.'), watch(5000)) }, icon('download-simple'), 'Install')),
              step('start', s.ollama === 'running', 'Start Ollama', 'It then runs in the background (tray icon).', h('button.btn.sm.primary', { onclick: async () => (await run('start_local_ai')) && ((note.textContent = 'Starting…'), watch(1500)) }, icon('play'), 'Start')),
              step(
                'download',
                s.has_model,
                `Download ${s.model}`,
                'About 4 GB, once. Mistral works well with the app\'s tools.',
                h('button.btn.sm.primary', {
                  onclick: async (ev) => {
                    ev.target.disabled = true;
                    bar.hidden = false;
                    window.native?.onPullProgress && !this.pullHooked && ((this.pullHooked = true), window.native.onPullProgress((p) => this.onPull?.(p)));
                    this.onPull = (p) => {
                      const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
                      bar.firstChild.style.width = `${pct}%`;
                      bar.setAttribute('aria-valuenow', pct);
                      note.textContent = `${p.status}${p.total ? ` · ${pct}% of ${(p.total / 1e9).toFixed(1)} GB` : ''}`;
                    };
                    const r = await run('pull_ai_model', { model: s.model });
                    this.onPull = null;
                    if (r) app.ui.toast(`${s.model} is downloaded.`);
                    draw();
                  },
                }, icon('download-simple'), 'Download'),
              ),
            ),
        bar,
        note,
        h(
          'div.row.wrap',
          {},
          s.next === 'ready' ? h('button.btn.sm.primary', { onclick: () => this.ask('Hello! In two lines, what can you do for me here?') }, icon('chat-circle'), 'Try it') : null,
          h('button.btn.sm', { onclick: () => app.ui.show('settings') }, icon('gear'), 'Other models (Claude, LM Studio…)'),
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
    window.native?.invoke('ai:abort');
  }

  add(node) {
    this.log.querySelector('.chat-empty')?.remove();
    this.log.append(node);
    this.log.scrollTop = this.log.scrollHeight;
    return node;
  }

  /** Start recording from the microphone (hold to talk). */
  async listen() {
    if (this.recorder) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = (e) => chunks.push(e.data);
      this.recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        this.micBtn.classList.remove('rec');
        if (!chunks.length) return;
        try {
          this.app.ui.setStatus('Listening… turning speech into text');
          const wav = await toWav16k(new Blob(chunks));
          const r = await this.app.io.transcribe(wav);
          if (r.text) this.input.value = `${this.input.value ? `${this.input.value} ` : ''}${r.text}`;
          this.input.focus();
          this.app.ui.setStatus('');
        } catch (e) {
          this.app.ui.toast(e.message, 'danger');
        }
      };
      this.recorder.start();
      this.micBtn.classList.add('rec');
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

  async send() {
    const typed = this.input.value.trim();
    const pics = this.pictures;
    if ((!typed && !pics.length) || this.busy) return;
    this.input.value = '';
    this.pictures = [];
    this.drawPictures();
    const protocol = protocolOf(this.settings.provider);
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
    const thinking = h('div.thinking', {}, h('i'), h('i'), h('i'));
    // The whole turn is one undo step (or one proposal); the view still updates after every tool call.
    const proposing = this.propose && app.store.beginProposal();
    if (!proposing) app.store.checkpoint();
    ctx.batchDepth = (ctx.batchDepth || 0) + 1;
    const turnLength = this.history.length;
    (ctx.turnStarts ||= []).push(app.store.doc.journal?.length || 0); // "save what we just did as a tool" (#242)
    const had = new Set(app.store.doc.entities.map((e) => e.id));
    const t0 = performance.now();
    const usage = { in: 0, out: 0, calls: 0, steps: 0 };
    app.onUsage = (d) => {
      const u = d?.usage || {};
      usage.in += u.input_tokens ?? u.prompt_tokens ?? d?.prompt_eval_count ?? 0;
      usage.out += u.output_tokens ?? u.completion_tokens ?? d?.eval_count ?? 0;
    };
    // text streams into a live bubble; the final text replaces it so nothing shows twice
    window.native?.onAiDelta && !this.deltaHooked && ((this.deltaHooked = true), window.native.onAiDelta((t) => this.delta?.(t)));
    this.delta = (t) => {
      thinking.remove();
      if (!this.live) this.live = this.add(h('div.msg.assistant.live', {}, ''));
      this.live.textContent += t;
      this.log.scrollTop = this.log.scrollHeight;
    };
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
          onText: (t) => (this.live ? ((this.live.textContent = t), this.live.classList.remove('live'), (this.live = null)) : this.add(h('div.msg.assistant', {}, t))),
          onCall: (c) => {
            this.live?.classList.remove('live');
            this.live = null;
            usage.calls++;
            const row = this.add(h('details.toolcall.running', {}, h('summary', {}, `${c.name} ${JSON.stringify(c.args).slice(0, 120)}`)));
            row.t0 = performance.now();
            return row;
          },
          onResult: (row, c, result, isError) => {
            row.classList.remove('running');
            row.querySelector('summary').append(h('span.muted.small', {}, ` · ${Math.round(performance.now() - row.t0)} ms`));
            if (isError) row.classList.add('err');
            app.store.changed(); // live update inside the batched turn
            if (result?.image) row.append(h('img', { src: result.image, alt: 'Screenshot the AI looked at', style: { maxWidth: '100%', borderRadius: '6px', marginTop: '4px' } }));
            row.append(h('pre', {}, JSON.stringify(result?.image ? { ...result, image: '(image)' } : (result ?? { ok: true })).slice(0, 4000)));
          },
        },
      });
    } catch (e) {
      thinking.remove();
      const msg = e.message.replace(/^Error invoking remote method 'ai:chat': (Error: )?/, '');
      // cannot reach the local model: the setup card, not a raw network error (#224)
      const unreachable = /ECONNREFUSED|Is Ollama running|fetch failed|model .*not found|pull the model/i.test(msg) && this.settings.provider === 'ollama';
      this.add(h(msg === 'Stopped.' ? 'div.msg.muted' : 'div.msg.error', {}, msg === 'Stopped.' ? 'Stopped. What is done so far stays (undo removes it).' : unreachable ? 'The copilot cannot reach its AI model on this PC yet. Set it up below (once), then ask again.' : msg));
      if (unreachable) this.add(this.setupCard());
      // keep the history valid for the next turn: drop this turn's dangling user message if nothing came back
      if (this.history.length === turnLength && this.history.at(-1)?.role === 'user') this.history.pop();
    } finally {
      this.live?.classList.remove('live');
      this.live = null;
      this.delta = null;
      app.onUsage = null;
      const tok = usage.in + usage.out;
      this.add(h('div.turn-stats.muted.small', {}, `${((performance.now() - t0) / 1000).toFixed(1)} s · ${usage.calls} tool call${usage.calls === 1 ? '' : 's'}${tok ? ` · ${tok > 999 ? `${(tok / 1000).toFixed(1)}k` : tok} tokens (${usage.in} in, ${usage.out} out)` : ''}`));
      ctx.batchDepth--;
      app.learning?.aiTurn(usage.calls);
      // what it drafted, ready to change by hand (#225)
      const made = app.store.doc.entities.filter((e) => !had.has(e.id) && !e.parent && e.type !== 'point');
      if (made.length) this.add(this.madeList(made));
      if (proposing && app.store.proposalDiff()?.empty) app.store.acceptProposal(); // nothing to review
      app.store.changed();
      this.busy = false;
      this.sendBtn.replaceChildren(icon('paper-plane-right'));
      this.sendBtn.title = 'Send (Enter)';
    }
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
