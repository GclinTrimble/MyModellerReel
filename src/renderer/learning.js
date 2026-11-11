// Learning in the app (#213, #214): lessons complete when you use what they teach (points, levels, badges), the
// Learn section of the Help panel, and guided steps that highlight where to click and move on when each is done.
import * as LEARN from '../core/learning.js';
import * as ACH from '../core/achievements.js';
import { HOWTOS } from '../core/howto.js';
import { h, icon } from './ui.js';

export class Learning {
  constructor(app) {
    this.app = app;
    this.open = new Set();
    this.guide = null;
  }
  get done() {
    return this.app.settings?.learning?.done || [];
  }
  get tutorials() {
    return this.app.settings?.learning?.tutorials || [];
  }
  /** After every command: lessons it completes, the guided step it may finish, and the stats (#222). */
  ran(name) {
    if (this.guide) this.guide.ran.add(name);
    const fresh = LEARN.lessonsFor(name).filter((id) => !this.done.includes(id));
    for (const id of fresh) this.complete(id);
    this.count(name);
  }
  /** A copilot request that ran `calls` commands. */
  aiTurn(calls) {
    this.count(null, { ai: { calls } });
    if (calls && !this.done.includes('ask-the-copilot')) this.complete('ask-the-copilot');
  }
  count(name, info = {}) {
    const before = this.stats || this.app.settings?.stats || {};
    this.stats = ACH.record(before, name, info);
    const p = LEARN.progress(this.done, this.tutorials);
    for (const t of ACH.newTiers(before, this.stats, p)) this.app.ui.toast(`Achievement: ${t.label}, ${t.name}!`);
    // kept with the settings, a few seconds after the last command (not on every one)
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.app.io?.setSettings?.({ stats: this.stats }).catch(() => {}), 3000);
  }
  async complete(id, tutorial = false) {
    const before = LEARN.progress(this.done, this.tutorials);
    const p = await this.app.reg.run('complete_lesson', { id, tutorial });
    const title = (HOWTOS.find((x) => x.id === id)?.title || id).split(':')[0];
    const got = p.points - before.points;
    if (got > 0) this.app.ui.toast(`+${got} points: “${title}”${tutorial ? ' tutorial finished' : ''}. ${p.level !== before.level ? `New level: ${p.level}!` : `${p.points} points`}`);
    if (this.app.ui.tab === 'help') this.app.ui.renderDock();
  }

  /** Achievements and insights (#222): headline numbers and the tracks with their tiers. */
  insightsCard() {
    const p = LEARN.progress(this.done, this.tutorials);
    const r = ACH.insights(this.stats || this.app.settings?.stats || {}, p);
    const stat = (n, label, title) => h('div.ins-stat', { title: title || label }, h('strong', {}, String(n)), h('span.small.muted', {}, label));
    const open = this.insightsOpen;
    return h(
      'div.card.insights',
      {},
      h('button.learn-head', { 'aria-expanded': String(!!open), onclick: () => ((this.insightsOpen = !open), this.app.ui.renderDock()) }, icon('trophy'), h('strong.grow', {}, 'Your achievements'), h('span.small.muted', {}, `${r.tiers_reached} tier${r.tiers_reached === 1 ? '' : 's'}`), icon(open ? 'caret-down' : 'caret-right')),
      h(
        'div.ins-stats',
        {},
        stat(r.streak, r.streak === 1 ? 'day streak' : 'days streak', `Longest: ${r.longest_streak} days`),
        stat(r.days_active, 'days active'),
        stat(r.minutes < 120 ? `${r.minutes} min` : `${Math.round(r.minutes / 6) / 10} h`, 'modelling'),
        stat(r.commands_run, 'things done'),
        stat(r.ai_requests, 'copilot requests', `${r.ai_commands} commands run for you`),
        stat(`${r.ai_minutes_saved} min`, 'saved by the copilot', `About ${ACH.SECONDS_PER_CALL} s for each of the ${r.ai_commands} commands it ran`),
      ),
      open
        ? h(
            'div.ins-tracks',
            {},
            ...r.tracks.map((t) =>
              h(
                'div.ins-track',
                { title: `${t.value} ${t.what}${t.next ? ` · next tier at ${t.next}` : ' · every tier reached'}` },
                h(`span.ins-medal.tier-${t.tier}`, {}, icon(t.icon)),
                h('div.grow', {}, h('div.row', {}, h('span.grow', {}, t.label), h('span.small.muted', {}, t.name || 'Not yet')), h('div.learn-bar', { role: 'progressbar', 'aria-label': `${t.label}: progress to the next tier`, 'aria-valuenow': Math.round(t.progress * 100) }, h('i', { style: { width: `${Math.round(t.progress * 100)}%` } })), h('span.small.muted', {}, `${t.value} ${t.what}`)),
              ),
            ),
            r.favourites.length ? h('p.small.muted', {}, `Favourites: ${r.favourites.map((f) => `${f.name.replace(/_/g, ' ')} (${f.count})`).join(', ')}`) : null,
            r.busiest_day ? h('p.small.muted', {}, `Busiest day: ${r.busiest_day.day}, ${r.busiest_day.commands} things done.`) : null,
            h('p.small.muted', {}, 'Counted on this PC only. Ask the copilot "how am I doing?" to hear it.'),
          )
        : null,
    );
  }

  /** The Learn section at the top of the Help panel. */
  card() {
    const p = LEARN.progress(this.done, this.tutorials);
    const done = new Set(this.done);
    const span = p.next ? (p.points - (LEARN.LEVELS.filter(([x]) => x <= p.points).at(-1)[0])) / (p.next.points - LEARN.LEVELS.filter(([x]) => x <= p.points).at(-1)[0]) : 1;
    return h(
      'div.card.learn',
      {},
      h('div.row', {}, icon('graduation-cap'), h('strong.grow', {}, `${p.level} · ${p.points} points`), p.badges.length ? h('span.small.muted', { title: 'Modules completed' }, `${p.badges.length} badge${p.badges.length > 1 ? 's' : ''}`) : null),
      h('div.learn-bar', { role: 'progressbar', 'aria-valuenow': Math.round(span * 100), 'aria-label': 'Progress to the next level' }, h('i', { style: { width: `${Math.round(span * 100)}%` } })),
      p.next ? h('p.small.muted', {}, `${p.next.points - p.points} points to ${p.next.level}. Complete a lesson by doing what it shows.`) : h('p.small.muted', {}, 'Every level reached.'),
      ...LEARN.MODULES.map((m) => {
        const n = m.lessons.filter((l) => done.has(l.id)).length;
        const isOpen = this.open.has(m.id);
        return h(
          'div.learn-module',
          {},
          h(
            'button.learn-head',
            { 'aria-expanded': String(isOpen), onclick: () => (isOpen ? this.open.delete(m.id) : this.open.add(m.id), this.app.ui.renderDock()) },
            icon(isOpen ? 'caret-down' : 'caret-right'),
            h('span.grow', {}, m.title),
            n === m.lessons.length ? icon('medal', true) : null,
            h('span.small.muted', {}, `${n}/${m.lessons.length}`),
          ),
          isOpen
            ? h(
                'div.learn-lessons',
                {},
                ...m.lessons.map((l) => {
                  const meta = HOWTOS.find((x) => x.id === l.id);
                  return h(
                    'div.learn-lesson',
                    {},
                    h('span', { class: done.has(l.id) ? 'learn-done' : 'learn-todo', 'aria-label': done.has(l.id) ? 'Done' : 'Not done yet' }, icon(done.has(l.id) ? 'check-circle' : 'circle', done.has(l.id))),
                    h('button.link.grow', { onclick: () => this.app.help.open(l.id), title: meta?.title }, (meta?.title || l.id).split(':')[0]),
                    l.guide ? h('button.btn.sm', { onclick: () => this.start(l.id), title: this.tutorials.includes(l.id) ? 'Tutorial finished: run it again any time' : `Show me where to click, step by step (+${LEARN.TUTORIAL_POINTS} points when finished)` }, icon(this.tutorials.includes(l.id) ? 'check' : 'hand-pointing'), 'Guide me') : null,
                  );
                }),
              )
            : null,
        );
      }),
    );
  }

  // ---------------------------------------------------------------- guided steps (#214)
  start(id) {
    const lesson = LEARN.allLessons().find((l) => l.id === id);
    if (!lesson?.guide) return;
    this.stop();
    this.guide = { lesson, i: 0, ran: new Set(), base: this.state() };
    this.timer = setInterval(() => this.tick(), 400);
    this.draw();
  }
  stop() {
    clearInterval(this.timer);
    document.querySelector('.guide')?.remove();
    this.guide = null;
  }
  state() {
    const doc = this.app.store.doc;
    return { points: doc.entities.filter((e) => e.type === 'point').length };
  }
  isDone(step) {
    const d = step.done || {};
    const g = this.guide;
    if (d.tool) return this.app.tools.id === d.tool;
    if (d.command) return g.ran.has(d.command);
    if (d.panel) return this.app.ui.tab === d.panel;
    if (d.entities) return this.app.store.doc.entities.filter((e) => e.type === d.entities.type).length >= d.entities.count;
    return false;
  }
  tick() {
    const g = this.guide;
    if (!g) return;
    if (this.isDone(g.lesson.guide[g.i])) return this.next();
    this.draw();
  }
  /** On to the next step (done, or Next pressed); after the last, the tutorial is finished and earns its points (#221). */
  next() {
    const g = this.guide;
    g.i++;
    g.ran.clear();
    if (g.i < g.lesson.guide.length) return this.draw();
    const id = g.lesson.id;
    this.stop();
    this.app.ui.toast('Well done: tutorial finished.');
    if (!this.tutorials.includes(id)) this.complete(id, true);
  }
  draw() {
    const g = this.guide;
    const step = g.lesson.guide[g.i];
    const target = step.target === 'view' ? document.querySelector('.viewport-wrap') : document.querySelector(step.target);
    const r = target?.getBoundingClientRect();
    let wrap = document.querySelector('.guide');
    if (!wrap) {
      wrap = h('div.guide', {}, h('div.guide-hl'), h('div.guide-card', { role: 'dialog', 'aria-live': 'polite' }));
      document.body.append(wrap);
    }
    const hl = wrap.querySelector('.guide-hl');
    hl.hidden = !r;
    if (r) Object.assign(hl.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    const card = wrap.querySelector('.guide-card');
    const key = `${g.lesson.id}:${g.i}`;
    if (card.dataset.key !== key) {
      card.dataset.key = key;
      const meta = HOWTOS.find((x) => x.id === g.lesson.id);
      card.replaceChildren(
        h('div.overline', {}, `${(meta?.title || '').split(':')[0]} · step ${g.i + 1} of ${g.lesson.guide.length}`),
        h('p', {}, step.text),
        ...(step.hint ? [h('p.small.muted', {}, step.hint)] : []),
        h('div.row', {}, h('span.grow.small.muted', {}, 'It moves on when you have done it.'), ...(g.i ? [h('button.btn.sm', { onclick: () => ((g.i -= 1), g.ran.clear(), this.draw()) }, 'Back')] : []), h('button.btn.sm.primary', { onclick: () => this.next() }, g.i === g.lesson.guide.length - 1 ? 'Finish' : 'Next'), h('button.btn.sm', { onclick: () => this.stop() }, 'Stop')),
      );
    }
    // beside the highlight, inside the window
    const cw = 300;
    const left = r ? (r.right + cw + 24 < innerWidth ? r.right + 12 : r.left - cw - 12 > 8 ? r.left - cw - 12 : Math.min(innerWidth - cw - 16, r.left)) : innerWidth / 2 - cw / 2;
    const top = r ? Math.min(Math.max(12, r.top), innerHeight - card.offsetHeight - 12) : innerHeight / 3;
    Object.assign(card.style, { left: `${Math.max(8, left)}px`, top: `${r && r.width > innerWidth * 0.5 ? r.top + 60 : top}px` });
  }
}
