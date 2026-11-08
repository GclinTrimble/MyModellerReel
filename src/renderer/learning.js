// Learning in the app (#213, #214): lessons complete when you use what they teach (points, levels, badges), the
// Learn section of the Help panel, and guided steps that highlight where to click and move on when each is done.
import * as LEARN from '../core/learning.js';
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
  /** After every command: lessons it completes, and the guided step it may finish. */
  ran(name) {
    if (this.guide) this.guide.ran.add(name);
    const fresh = LEARN.lessonsFor(name).filter((id) => !this.done.includes(id));
    for (const id of fresh) this.complete(id);
  }
  async complete(id) {
    const before = LEARN.progress(this.done);
    const p = await this.app.reg.run('complete_lesson', { id });
    const title = HOWTOS.find((x) => x.id === id)?.title || id;
    this.app.ui.toast(`+${LEARN.POINTS} points: “${title.split(':')[0]}”. ${p.level !== before.level ? `New level: ${p.level}!` : `${p.points} points`}`);
    if (this.app.ui.tab === 'help') this.app.ui.renderDock();
  }

  /** The Learn section at the top of the Help panel. */
  card() {
    const p = LEARN.progress(this.done);
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
                    l.guide ? h('button.btn.sm', { onclick: () => this.start(l.id), title: 'Show me where to click, step by step' }, icon('hand-pointing'), 'Guide me') : null,
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
    const step = g.lesson.guide[g.i];
    if (this.isDone(step)) {
      g.i++;
      g.ran.clear();
      if (g.i >= g.lesson.guide.length) {
        const id = g.lesson.id;
        this.stop();
        this.app.ui.toast('Well done: every step of the lesson.');
        if (!this.done.includes(id)) this.complete(id);
        return;
      }
    }
    this.draw();
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
        h('div.row', {}, h('span.grow.small.muted', {}, 'It moves on when you have done it.'), ...(g.i ? [h('button.btn.sm', { onclick: () => ((g.i -= 1), g.ran.clear(), this.draw()) }, 'Back')] : []), h('button.btn.sm', { onclick: () => ((g.i += 1), g.ran.clear(), g.i >= g.lesson.guide.length ? this.stop() : this.draw()) }, 'Skip step'), h('button.btn.sm', { onclick: () => this.stop() }, 'Stop')),
      );
    }
    // beside the highlight, inside the window
    const cw = 300;
    const left = r ? (r.right + cw + 24 < innerWidth ? r.right + 12 : r.left - cw - 12 > 8 ? r.left - cw - 12 : Math.min(innerWidth - cw - 16, r.left)) : innerWidth / 2 - cw / 2;
    const top = r ? Math.min(Math.max(12, r.top), innerHeight - card.offsetHeight - 12) : innerHeight / 3;
    Object.assign(card.style, { left: `${Math.max(8, left)}px`, top: `${r && r.width > innerWidth * 0.5 ? r.top + 60 : top}px` });
  }
}
