// Agent profiles (#243): one Assistant (thread, queue, model) per profile, a shared Crew for the rules of working at
// once, the Agents panel, and the Ask prompt at the cursor (#244). Commands reach it as ctx.agents.
import { Crew, normalizeProfiles, normalizeProfile, DEFAULT_AGENT, AGENT_ICONS } from '../core/agents.js';
import { SKILLS } from '../core/skills.js';
import { TOOLSETS } from '../core/routing.js';
import { Assistant } from './ai.js';
import { h, icon } from './ui.js';

const KEY = 'mymodellerreel.agents';
/** An agent's animal icon in its colour. */
export const agentBadge = (p) => h(`i.ph-fill.ph-${p.icon}.agent-dot`, { 'aria-hidden': 'true', style: { color: p.color } });

export class Agents {
  constructor(app) {
    this.app = app;
    this.crew = new Crew();
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {}
    this.profiles = normalizeProfiles(saved);
    this.threads = new Map(this.profiles.map((p) => [p.id, new Assistant(app, p, this)]));
    this.current = this.threads.get(DEFAULT_AGENT);
    // streamed text goes to the thread whose request it is
    window.native?.onAiDelta?.((t, id) => this.threads.get(id || DEFAULT_AGENT)?.delta?.(t));
  }

  /** A thread by profile id or name (default: Plumb). */
  thread(ref) {
    if (!ref) return this.threads.get(DEFAULT_AGENT);
    const key = String(ref).toLowerCase();
    const p = this.profiles.find((x) => x.id === key || x.name.toLowerCase() === key);
    if (!p) throw new Error(`No agent "${ref}". Agents: ${this.profiles.map((x) => x.name).join(', ')}.`);
    return this.threads.get(p.id);
  }
  persist() {
    localStorage.setItem(KEY, JSON.stringify(this.profiles));
    for (const t of this.threads.values()) t.renderHead();
    this.changed();
  }
  /** Something about the agents changed: redraw the panel if it shows. */
  changed() {
    const ui = this.app.ui;
    if (ui?.tab === 'agents' && !this.redraw) this.redraw = requestAnimationFrame(() => ((this.redraw = null), ui.tab === 'agents' && ui.renderDock()));
  }
  open(ref) {
    this.current = this.thread(ref);
    this.app.ui.show('ai', true);
  }

  // ---------------------------------------------------------------- what the commands call
  list() {
    return {
      agents: this.profiles.map((p) => {
        const t = this.threads.get(p.id);
        return { ...p, status: t.busy ? 'working' : 'idle', queued: t.queue.length, last_task: t.lastTask || null };
      }),
      held: this.crew.held.map(({ n, agent, command, args, entity, owner }) => ({ n, agent, command, args, entity, owner })),
    };
  }
  save(a) {
    const old = a.id && this.profiles.find((p) => p.id === a.id);
    if (old) {
      if (old.id === DEFAULT_AGENT && a.name) a = { ...a, name: old.name }; // Plumb keeps its name
      Object.assign(old, normalizeProfile({ ...old, ...a }, this.profiles.indexOf(old)), { id: old.id });
      this.persist();
      return old;
    }
    if (!a.name) throw new Error('A new agent needs a name.');
    const p = normalizeProfile(a, this.profiles.length);
    while (this.threads.has(p.id)) p.id += '-2';
    this.profiles.push(p);
    this.threads.set(p.id, new Assistant(this.app, p, this));
    this.persist();
    return p;
  }
  remove(ref) {
    const t = this.thread(ref);
    if (t.profile.id === DEFAULT_AGENT) throw new Error('Plumb is the default agent: it stays.');
    t.stop();
    this.threads.delete(t.profile.id);
    this.profiles.splice(this.profiles.indexOf(t.profile), 1);
    if (this.current === t) this.current = this.threads.get(DEFAULT_AGENT);
    this.persist();
    if (this.app.ui.tab === 'ai') this.app.ui.renderDock();
    return { removed: t.profile.name };
  }
  /** Start a task (or queue it). Returns the promise of the reply's last words. */
  task(ref, text, { ids, point } = {}) {
    const t = this.thread(ref);
    const names = (ids || []).map((x) => this.app.entity(x)?.name || x);
    const where = [names.length ? `the selection: ${names.join(', ')}` : '', point ? `the point under the cursor: [${point.map((v) => +v.toFixed(3)).join(', ')}]` : ''].filter(Boolean);
    return t.send(where.length ? `${text}\n\n(Context: ${where.join('; ')}.)` : text);
  }
  ask(ref, text, context) {
    const t = this.thread(ref);
    const queued = t.busy ? t.queue.length + 1 : 0;
    this.task(ref, text, context);
    return { agent: t.profile.name, started: !queued, queued };
  }
  stop(ref) {
    const t = this.thread(ref);
    t.stop();
    return { stopped: t.profile.name };
  }
  /** Timings of an agent's last turns, and of the one running (its numbers so far). */
  turns(ref, last = 5) {
    const t = this.thread(ref);
    return { agent: t.profile.name, running: t.busy ? { task: t.lastTask, ...t.stats } : null, turns: t.turns.slice(-last) };
  }
  retry(ref) {
    const t = this.thread(ref);
    if (!t.lastTask) throw new Error(`${t.profile.name} has no task to retry.`);
    return this.ask(t.profile.id, t.lastTask);
  }
  async held(n, action) {
    const c = this.crew.take(n);
    if (!c) throw new Error(`No held change #${n}.`);
    this.changed();
    if (action === 'drop') return { dropped: n };
    return { applied: n, result: await this.app.reg.run(c.command, c.args) };
  }

  // ---------------------------------------------------------------- the Agents panel
  panel() {
    const app = this.app;
    const run = (name, args) => app.reg.run(name, args).catch((e) => app.ui.toast(e.message, 'danger'));
    const btn = (ic, label, onclick) => h('button.icon-btn.sm', { title: label, 'aria-label': label, onclick }, icon(ic));
    const { agents, held } = this.list();
    return h(
      'div.panel.agents',
      {},
      h('div.row', {}, h('strong.grow', {}, 'Agents'), h('button.btn.sm', { onclick: () => this.editDialog() }, icon('plus'), 'New agent')),
      h('p.small.muted', {}, 'Each agent has its own model, skill, instructions and thread. Several can work at once: give one a task with Ask (Ctrl+Space or right-click), or from its thread.'),
      h(
        'div.agent-list',
        { role: 'list' },
        agents.map((a) =>
          h(
            `div.agent-row${a.status === 'working' ? '.busy' : ''}`,
            { role: 'listitem', dataset: { agent: a.id } },
            agentBadge(a),
            h('div.grow', {}, h('div', {}, a.name), h('div.small.muted', {}, `${a.status === 'working' ? 'Working' : 'Idle'}${a.queued ? ` · ${a.queued} queued` : ''}${a.last_task ? ` · ${a.last_task.slice(0, 60)}` : ''}`)),
            btn('chat-circle', `Open ${a.name}'s thread`, () => this.open(a.id)),
            a.status === 'working' ? btn('stop', `Stop ${a.name}`, () => run('stop_agent', { agent: a.id })) : null,
            a.last_task && a.status !== 'working' ? btn('arrow-clockwise', `Retry ${a.name}'s last task`, () => run('retry_agent', { agent: a.id })) : null,
            btn('pencil-simple', `Edit ${a.name}`, () => this.editDialog(a)),
            a.id === DEFAULT_AGENT ? null : btn('trash', `Delete ${a.name}`, () => run('remove_agent', { agent: a.id })),
          ),
        ),
      ),
      held.length
        ? h(
            'div.agent-held',
            {},
            h('div.overline', {}, `Held changes (${held.length}): two agents touched the same thing`),
            held.map((c) =>
              h('div.row', {}, h('span.grow.small', {}, `${this.thread(c.agent).profile.name}: ${c.command} on ${app.entity(c.entity)?.name || c.entity} (${this.thread(c.owner).profile.name} had it)`), h('button.btn.sm', { onclick: () => run('held_change', { n: c.n, action: 'apply' }) }, 'Apply'), h('button.btn.sm', { onclick: () => run('held_change', { n: c.n, action: 'drop' }) }, 'Drop')),
            ),
          )
        : null,
    );
  }
  async editDialog(p = null) {
    const f = (label, el) => h('label.field', {}, h('span', {}, label), el);
    const name = h('input', { value: p?.name || '', placeholder: 'e.g. Site surveyor', disabled: p?.id === DEFAULT_AGENT });
    const provider = h('select', {}, [['', 'AI settings'], ['builtin', 'Built-in model (offline)'], ['ollama', 'Local (Ollama)'], ['openai', 'OpenAI-compatible'], ['anthropic', 'Claude']].map(([v, l]) => h('option', { value: v, selected: (p?.provider || '') === v }, l)));
    const model = h('input', { value: p?.model || '', placeholder: 'empty: the one in AI settings' });
    // the built-in model is picked from its list, not typed (#255)
    const builtins = (await this.app.reg.run('list_ai_models', {}).catch(() => null))?.models || [];
    const builtinModel = h('select', {}, h('option', { value: '' }, 'The one in AI settings'), builtins.map((m) => h('option', { value: m.id, selected: p?.model === m.id }, `${m.label} · ${(m.bytes / 1e9).toFixed(1)} GB${m.downloaded ? '  ✓' : ''}`)));
    const modelField = h('div');
    const showModel = () => modelField.replaceChildren(provider.value === 'builtin' && builtins.length ? builtinModel : model);
    provider.addEventListener('change', showModel);
    showModel();
    const skill = h('select', {}, h('option', { value: '' }, 'No skill'), Object.entries(SKILLS).map(([k, s]) => h('option', { value: k, selected: p?.skill === k }, s.label)));
    if (p?.skill && !SKILLS[p.skill]) skill.append(h('option', { value: p.skill, selected: true }, p.skill)); // a user skill (#242)
    const toolset = h('select', {}, ['auto', ...Object.keys(TOOLSETS)].map((k) => h('option', { value: k, selected: (p?.toolset || 'auto') === k }, k)));
    const instructions = h('textarea', { rows: 4, placeholder: 'What it always keeps in mind, e.g. "You check levels and drainage; answer in short lists."' }, p?.instructions || '');
    const color = h('input', { type: 'color', value: p?.color || '#7aa2f7' });
    let pickedIcon = p?.icon || AGENT_ICONS[this.profiles.length % AGENT_ICONS.length];
    const icons = h('div.agent-icons', { role: 'radiogroup', 'aria-label': 'Icon' });
    const showIcons = () => icons.replaceChildren(...AGENT_ICONS.map((k) => h('button.icon-btn', { type: 'button', role: 'radio', title: k, 'aria-label': k, 'aria-checked': String(k === pickedIcon), style: { color: color.value }, onclick: () => ((pickedIcon = k), showIcons()) }, icon(k, true))));
    color.addEventListener('input', showIcons);
    showIcons();
    const body = h('div.agent-form', {}, f('Name', name), f('Provider', provider), f('Model', modelField), f('Skill', skill), f('Tools', toolset), f('Instructions', instructions), f('Icon', icons), f('Colour', color));
    if ((await this.app.ui.modal(p ? `Edit ${p.name}` : 'New agent', body, [['Save', 'save'], ['Cancel', null]])) !== 'save') return;
    const args = { name: name.value.trim(), provider: provider.value, model: provider.value === 'builtin' && builtins.length ? builtinModel.value : model.value.trim(), skill: skill.value, toolset: toolset.value, instructions: instructions.value, color: color.value, icon: pickedIcon };
    if (p) args.id = p.id;
    this.app.reg.run('save_agent', args).catch((e) => this.app.ui.toast(e.message, 'danger'));
  }

  // ---------------------------------------------------------------- one prompt: search, commands and Ask (#244)
  /**
   * Ctrl+K, Ctrl+Space, right-click › Ask… and the status-bar search all open this: matching commands listed above the
   * field, the agent, voice and Send. (x, y) client pixels, default the pointer over the view, else just above the
   * search bar; point: what is there. above: (x, y) is where the prompt's bottom edge goes.
   */
  askAt(x, y, point = undefined, above = false) {
    const app = this.app;
    this.closeAsk();
    if (x === undefined) {
      if (this.pointer) ({ x, y } = this.pointer);
      else {
        const r = document.getElementById('palette-btn').getBoundingClientRect();
        (x = r.left), (y = r.top - 4), (above = true), (point = null);
      }
    }
    const vp = app.viewport;
    if (point === undefined) point = (document.elementFromPoint(x, y) === vp.canvas && vp.pick({ clientX: x, clientY: y })?.point?.toArray()) || null;
    const ids = [...app.selection];
    const down = !above && y < 320; // too near the top: the list opens below the field
    const pick = h('select.agent-pick', { 'aria-label': 'Agent' }, this.profiles.map((p) => h('option', { value: p.id, selected: p.id === this.current.profile.id }, p.name)));
    const badge = h('span.agent-badge');
    const showBadge = () => badge.replaceChildren(agentBadge(this.thread(pick.value).profile));
    showBadge();
    const input = h('input.ask-input', { id: 'palette-input', placeholder: 'Search commands or ask…  (Enter, Esc closes)', 'aria-label': 'Search commands or ask an agent', autocomplete: 'off', spellcheck: false });
    const mic = h('button.btn.icon-only', { title: 'Hold to talk', 'aria-label': 'Hold to talk', onpointerdown: (e) => (e.preventDefault(), this.current.listen(input, mic)), onpointerup: () => this.current.hear(), onpointerleave: () => this.current.recorder && this.current.hear() }, icon('microphone'));
    const list = h('ul', { id: 'palette-list', role: 'listbox', 'aria-label': 'Commands' });
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      const t = this.thread(pick.value);
      this.closeAsk();
      app.ui.toast(t.busy ? `${t.profile.name} will do it next (queued).` : `${t.profile.name} is on it.`);
      this.task(t.profile.id, text, { ids, point }).then((reply) => reply && app.ui.toast(`${t.profile.name}: ${reply.length > 220 ? `${reply.slice(0, 220)}…` : reply}`));
    };
    let items = [];
    let idx = 0;
    const render = () => {
      const q = input.value.trim();
      items = app.ui.paletteItems(q.toLowerCase());
      if (q) items.push({ label: `Ask ${pick.selectedOptions[0]?.text || 'the agent'}: "${q}"`, badge: this.thread(pick.value).profile, run: send });
      idx = Math.max(0, Math.min(idx, items.length - 1));
      list.replaceChildren(...items.map((it, i) => h('li', { role: 'option', 'aria-selected': String(i === idx), onclick: () => go(i) }, it.badge ? agentBadge(it.badge) : icon(it.icon || 'dot-outline'), h('span', {}, it.label), it.desc ? h('span.desc', {}, it.desc) : null, it.key ? h('span.key', {}, it.key) : null)));
      list.children[idx]?.scrollIntoView({ block: 'nearest' });
    };
    const go = (i) => {
      const it = items[i];
      if (!it) return;
      if (it.run === send) return send();
      this.closeAsk();
      it.run();
    };
    input.oninput = () => ((idx = 0), render());
    pick.onchange = () => (showBadge(), render());
    input.onkeydown = (e) => {
      // the best match sits next to the field: arrows move away from it and back
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') (idx += (e.key === 'ArrowDown') === down ? 1 : -1), render(), e.preventDefault();
      else if (e.key === 'Enter') {
        e.preventDefault();
        // a sentence that is no command's name goes straight to the agent
        const q = input.value.trim();
        if (q.split(/\s+/).length > 2 && !items.slice(0, -1).some((x) => x.label.toLowerCase() === q.toLowerCase())) send();
        else go(idx);
      } else if (e.key === 'Escape') e.preventDefault(), this.closeAsk();
      e.stopPropagation();
    };
    const context = [ids.length ? `${ids.length} selected` : '', point ? `at ${point.map((v) => v.toFixed(2)).join(', ')}` : ''].filter(Boolean).join(' · ');
    const left = Math.max(8, Math.min(x, innerWidth - 568));
    const edge = down ? { top: `${y}px` } : { bottom: `${Math.max(8, innerHeight - y - (above ? 0 : 48))}px` };
    list.style.maxHeight = `${Math.max(120, Math.min(innerHeight * 0.52, (down ? innerHeight - y : y) - 90))}px`;
    this.pop = h(`div.ask-pop${down ? '.down' : ''}`, { role: 'dialog', 'aria-label': 'Search commands or ask an agent', style: { left: `${left}px`, ...edge } }, list, h('div.row', {}, badge, pick, input, mic, h('button.btn.primary.icon-only', { title: 'Send to the agent', 'aria-label': 'Send', onclick: send }, icon('paper-plane-right'))), context ? h('div.small.muted', {}, context) : null);
    this.pop.point = point;
    document.body.append(this.pop);
    render();
    this.outside = (e) => !this.pop?.contains(e.target) && this.closeAsk();
    setTimeout(() => addEventListener('pointerdown', this.outside, true));
    input.focus();
    return this.pop;
  }
  closeAsk() {
    removeEventListener('pointerdown', this.outside, true);
    this.pop?.remove();
    this.pop = null;
  }
}
