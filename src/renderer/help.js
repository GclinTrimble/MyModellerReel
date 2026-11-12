// The Help panel (#158): how-to pages by intent, searchable, with "Do it" links that run the matching action, tool
// or command form. Pages are docs/how-to/<id>.md; this renders the small Markdown they use.
import { HOWTOS, AREAS, findHowtos } from '../core/howto.js';
import { h, icon } from './ui.js';

const BASE = '../../docs/how-to/';

/** Inline Markdown: `code`, **bold**, [text](link), ![alt](src). Links with do:, tool:, action:, howto: act. */
function inline(text, act) {
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let at = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[2] !== undefined) out.push(media(m[1], m[2]));
    else if (m[4] !== undefined) {
      const [kind, arg] = m[4].includes(':') && !/^https?:/.test(m[4]) ? m[4].split(/:(.*)/) : ['url', m[4]];
      out.push(kind === 'url' ? h('a', { href: '#', onclick: (ev) => (ev.preventDefault(), window.native?.invoke('shell:open-url', arg)) }, m[3]) : h('button.btn.sm.do-it', { onclick: () => act(kind, arg) }, kind === 'howto' ? icon('book-open') : icon('play'), m[3]));
    } else if (m[5] !== undefined) out.push(h('code', {}, m[5]));
    else out.push(h('strong', {}, m[6]));
    at = re.lastIndex;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function media(alt, src) {
  const url = /^https?:/.test(src) ? src : BASE + src;
  if (/\.mp4$/i.test(src)) return h('video', { src: url, controls: true, preload: 'metadata', 'aria-label': alt || 'Video', class: 'help-media' });
  return h('img', { src: url, alt, loading: 'lazy', class: 'help-media' });
}

/** Block Markdown: headings, paragraphs, lists, quotes, fenced code. */
export function renderMarkdown(md, act) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (l.startsWith('```')) {
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(h('pre.help-code', {}, h('code', {}, code.join('\n'))));
    } else if (/^#{1,3} /.test(l)) {
      const lvl = l.match(/^#+/)[0].length;
      out.push(h(`h${lvl + 2}`, {}, ...inline(l.replace(/^#+ /, ''), act)));
    } else if (/^\s*(\d+\.|-) /.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      for (; i < lines.length && /^\s*(\d+\.|-) /.test(lines[i]); i++) {
        const item = [lines[i].replace(/^\s*(\d+\.|-) /, '')];
        while (i + 1 < lines.length && /^ {2,}\S/.test(lines[i + 1]) && !/^\s*(\d+\.|-) /.test(lines[i + 1])) item.push(lines[++i].trim());
        items.push(h('li', {}, ...item.flatMap((t, k) => [...(k ? [h('br')] : []), ...inline(t, act)])));
      }
      i--;
      out.push(h(ordered ? 'ol' : 'ul', {}, items));
    } else if (l.startsWith('> ')) {
      const q = [];
      for (; i < lines.length && lines[i].startsWith('> '); i++) q.push(lines[i].slice(2));
      i--;
      out.push(h('blockquote.help-prompt', {}, ...inline(q.join(' '), act)));
    } else {
      const p = [l];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|> |\s*(\d+\.|-) )/.test(lines[i + 1])) p.push(lines[++i]);
      out.push(h('p', {}, ...inline(p.join(' '), act)));
    }
  }
  return out;
}

export class Help {
  constructor(app) {
    this.app = app;
    this.page = null;
    this.query = '';
    this.expanded = new Set(); // topics open in the list survive the panel being drawn again
  }

  /** Run what a "Do it" link names. */
  act(kind, arg) {
    const app = this.app;
    const ui = app.ui;
    if (kind === 'action') return ui.actions[arg] ? ui.actions[arg].run() : ui.toast(`No action ${arg}.`, 'danger');
    if (kind === 'tool') return app.tools.set(arg);
    if (kind === 'do') return ui.commandDialog(arg);
    if (kind === 'howto') return this.open(arg);
    if (kind === 'guide') return app.learning?.start(arg);
  }

  /** Ask Plumb (#241): an answer from the help pages and the commands, with its sources, Show me and Do it for me. */
  async ask(question, tool = null) {
    question = String(question || '').trim();
    if (!question) return;
    this.page = null;
    this.answer = { question, tool, busy: true };
    this.app.ui.show('help');
    try {
      this.answer = { question, tool, ...(await this.app.reg.run('ask_help', { question, ...(tool ? { tool } : {}) })) };
    } catch (e) {
      this.answer = { question, error: e.message };
    }
    if (this.app.ui.tab === 'help' && !this.page) this.app.ui.show('help');
    return this.answer;
  }

  askCard() {
    const a = this.answer;
    const input = h('input', { type: 'search', placeholder: 'Ask Plumb: how do I…?', value: a?.question || '', 'aria-label': 'Ask Plumb a question', onkeydown: (e) => e.key === 'Enter' && this.ask(input.value) });
    const out = [];
    if (a?.busy) out.push(h('p.muted', { role: 'status' }, 'Plumb is reading the help pages…'));
    else if (a?.error) out.push(h('p', { role: 'alert' }, a.error));
    else if (a) {
      if (a.answer) out.push(h('div.help-page.help-answer', {}, ...renderMarkdown(a.answer, (k, x) => this.act(k, x))));
      else out.push(h('p.small.muted', {}, a.ai_error ? `Plumb could not answer (${a.ai_error}). Here is what the help says:` : 'Here is what the help says:'), ...a.sources.slice(0, 3).map((s) => h('div.help-page.help-inline', {}, h('strong', {}, `${s.title} › ${s.section}`), ...renderMarkdown(s.text, (k, x) => this.act(k, x)))));
      const used = a.cited?.length ? a.sources.filter((s) => a.cited.includes(s.n)) : a.sources.slice(0, 3);
      if (used.length) out.push(h('div.small.muted', {}, 'Sources'), h('div.row.wrap', {}, ...used.map((s) => h('button.chip', { title: 'Open this page', onclick: () => this.open(s.id) }, icon('book-open'), `${a.answer ? `[${s.n}] ` : ''}${s.title} › ${s.section}`))));
      out.push(
        h(
          'div.row.wrap',
          {},
          a.show ? h('button.btn.sm.primary', { title: a.show.kind === 'guide' ? 'Guided steps: where to click' : a.show.kind === 'tool' ? 'Start the tool' : 'Open the command form', onclick: () => this.act(a.show.kind, a.show.arg) }, icon('hand-pointing'), 'Show me') : null,
          h('button.btn.sm', { title: 'Plumb does it in the AI panel (one undo step)', onclick: () => this.app.ai.ask(a.question) }, icon('sparkle'), 'Do it for me'),
          h('button.icon-btn.sm', { title: 'Clear the answer', 'aria-label': 'Clear the answer', onclick: () => ((this.answer = null), this.app.ui.show('help')) }, icon('x')),
        ),
      );
    }
    return h('div.card.help-ask', {}, h('div.row', {}, icon('sparkle'), h('strong.grow', {}, 'Ask Plumb')), h('div.row', {}, input, h('button.btn.sm.primary', { onclick: () => this.ask(input.value) }, 'Ask')), ...out);
  }

  async open(id) {
    this.page = id;
    this.app.ui.show('help');
  }

  panel() {
    const app = this.app;
    if (this.page) {
      const meta = HOWTOS.find((x) => x.id === this.page);
      const body = h('div.help-page', {}, h('p.muted', {}, 'Loading…'));
      app.io
        .readHowto(this.page)
        .then((md) => body.replaceChildren(...renderMarkdown(md, (k, a) => this.act(k, a))))
        .catch((e) => body.replaceChildren(h('p', { role: 'alert' }, e.message)));
      return h('div.panel.help', {}, h('div.row', {}, h('button.btn.sm', { onclick: () => ((this.page = null), app.ui.show('help')) }, icon('caret-left'), 'All topics'), h('span.grow'), h('span.small.muted', {}, meta?.area || '')), body);
    }
    const list = findHowtos(this.query, 50);
    const search = h('input', { type: 'search', placeholder: 'What do you want to do?', value: this.query, 'aria-label': 'Search help', oninput: (ev) => ((this.query = ev.target.value), this.renderList(listEl)) });
    const listEl = h('div.help-list');
    this.renderList(listEl, list);
    queueMicrotask(() => search.focus({ preventScroll: true }));
    return h('div.panel.help', {}, this.askCard(), this.startHere(), app.learning ? app.learning.card() : null, app.learning ? app.learning.insightsCard() : null, h('h3', {}, 'How do I…'), search, listEl, h('p.small.muted', {}, 'Click a topic to read it here; every page shows the clicks, a prompt for Plumb, and the commands for scripts and MCP.'));
  }

  /** New here (#223): the app is AI first, so the first steps are Plumb's, with the way back to editing by hand. */
  startHere() {
    const app = this.app;
    if (app.settings?.help?.hideStart) return null;
    const prompts = ['Draw a 10 m by 6 m rectangle and pull it up 3 m into a building', 'Add a pitched roof to the building', 'Make the building 12 m long instead'];
    return h(
      'div.card.start-here',
      {},
      h('div.row', {}, icon('rocket-launch'), h('strong.grow', {}, 'New here? Start with Plumb'), h('button.icon-btn.sm', { title: 'Hide this card', 'aria-label': 'Hide the start card', onclick: () => app.io.setSettings({ help: { hideStart: true } }).then(() => app.ui.renderDock()) }, icon('x'))),
      h('p.small', {}, 'Tell Plumb what you want in plain words; it drafts it with the same tools you have. What it makes stays parametric: select it and change its sizes by hand, or ask again. Each request is one undo step.'),
      h('div.row.wrap', {}, h('button.btn.sm.primary', { onclick: () => app.ui.show('ai') }, icon('sparkle'), 'Open Plumb'), h('button.btn.sm', { onclick: () => this.open('first-steps-with-the-copilot') }, icon('book-open'), 'First steps'), h('button.btn.sm', { onclick: () => app.ui.actions.tour?.run() }, icon('compass'), '2-minute tour')),
      h('div.small.muted', {}, 'Try, one after the other:'),
      ...prompts.map((p) => h('button.chip', { onclick: () => app.ai.ask(p) }, p)),
    );
  }

  renderList(el, list = findHowtos(this.query, 50)) {
    const areas = this.query ? [null] : AREAS;
    // a topic opens in place to read it in full (#223); "Open as a page" for the whole panel
    const item = (x) => {
      const body = h('div.help-page.help-inline');
      const d = h(
        'details.help-item-x',
        {
          ontoggle: () => {
            d.open ? this.expanded.add(x.id) : this.expanded.delete(x.id);
            if (!d.open || body.dataset.loaded) return;
            body.dataset.loaded = '1';
            body.replaceChildren(h('p.muted', {}, 'Loading…'));
            this.app.io
              .readHowto(x.id)
              .then((md) => body.replaceChildren(...renderMarkdown(md.replace(/^# .*\n/, ''), (k, a) => this.act(k, a)), h('button.btn.sm', { onclick: () => this.open(x.id) }, icon('arrows-out'), 'Open as a page')))
              .catch((e) => body.replaceChildren(h('p', { role: 'alert' }, e.message)));
          },
        },
        h('summary.help-item', {}, icon('book-open'), h('span', {}, x.title)),
        body,
      );
      if (this.expanded.has(x.id)) d.open = true;
      return d;
    };
    el.replaceChildren(
      ...areas.flatMap((area) => {
        const items = list.filter((x) => !area || x.area === area);
        if (!items.length) return [];
        return [...(area ? [h('div.overline', {}, area)] : []), ...items.map(item)];
      }),
      ...(list.length ? [] : [h('p.muted', {}, 'Nothing matches: try other words, or ask Plumb.')]),
    );
  }
}
