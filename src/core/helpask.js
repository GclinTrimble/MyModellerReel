// Help that answers (#241): Plumb answers a question from the how-to pages and the command registry, citing the
// sections it used, and offers "Show me" (guided steps, a tool, or a command form) and "Do it for me".
// Pure: the pages come in as text, so the Node tests and the app share it.
import { HOWTOS, findHowtos } from './howto.js';
import { allLessons } from './learning.js';
import { rankCommands } from './routing.js';

const words = (q) => String(q).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['how', 'the', 'and', 'can', 'want', 'with', 'what', 'does'].includes(w));

/** A how-to page's "## " sections (the text before the first one is the intro). */
export function splitSections(md) {
  const out = [];
  let cur = { heading: 'Intro', lines: [] };
  for (const l of String(md).replace(/\r/g, '').split('\n')) {
    if (/^# /.test(l)) continue;
    if (/^## /.test(l)) out.push(cur), (cur = { heading: l.slice(3).trim(), lines: [] });
    else if (!/^\s*!\[/.test(l)) cur.lines.push(l); // pictures say nothing to a model
  }
  out.push(cur);
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() })).filter((s) => s.text);
}

/** The pages a question needs read (ids), best first. A tool name finds the pages that use that tool. */
export function pagesFor(question, { tool = null, limit = 3 } = {}) {
  const byTool = tool ? HOWTOS.filter((x) => x.tools.includes(tool)).map((x) => x.id) : [];
  return [...new Set([...byTool, ...findHowtos(question, limit).map((x) => x.id)])].slice(0, limit);
}

/**
 * The sources for an answer: the best sections of the pages read (pages: [{ id, md }]), numbered for citations,
 * and the commands that match. list is the registry's command list.
 */
export function helpSources(question, pages, list = [], { sections = 5, commands = 5 } = {}) {
  const w = words(question);
  const all = pages.flatMap((p, rank) => {
    const meta = HOWTOS.find((x) => x.id === p.id);
    return splitSections(p.md).map((s) => {
      const t = `${s.heading} ${s.text}`.toLowerCase();
      return { id: p.id, title: meta?.title || p.id, section: s.heading, text: s.text.slice(0, 1400), score: w.reduce((n, x) => n + (t.includes(x) ? 1 : 0), 0) + (s.heading === 'In the app' ? 1 : 0) - rank * 0.5 };
    });
  });
  const picked = all.sort((a, b) => b.score - a.score).slice(0, sections).map(({ score, ...s }, i) => ({ n: i + 1, ...s }));
  const cmds = rankCommands(list, { query: question, limit: commands }).map((c) => ({ name: c.name, description: c.description }));
  return { sections: picked, commands: cmds };
}

export const HELP_SYSTEM = `You are Plumb, the assistant inside MyModellerReel, a desktop 3D modeller. Answer the user's "how do I" question from
the help sections and commands given, nothing else. Be short: at most 6 steps or lines, in plain words, with the
menu and tool names the sections use. Cite the sections you used as [1], [2]. If the sections do not cover it, say so
and suggest asking Plumb in the AI panel to do it.`;

/** The one-shot request text: the question and the numbered sources. */
export function helpPrompt(question, src) {
  return `Question: ${question}

Help sections:
${src.sections.map((s) => `[${s.n}] ${s.title} › ${s.section}\n${s.text}`).join('\n\n')}

Commands (for scripts, the API and the copilot):
${src.commands.map((c) => `- ${c.name}: ${c.description}`).join('\n')}`;
}

/** The section numbers an answer cites ([1], [2, 3]). */
export const cited = (answer, src) => {
  const ns = new Set([...String(answer).matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(',').map(Number)));
  return src.sections.filter((s) => ns.has(s.n));
};

/** What "Show me" does: the guided lesson of the best page, else its tool, else the best command's form. */
export function showMe(src, tool = null) {
  if (tool) return { kind: 'tool', arg: tool };
  for (const s of src.sections) {
    if (allLessons().some((l) => l.id === s.id && l.guide)) return { kind: 'guide', arg: s.id };
    const t = HOWTOS.find((x) => x.id === s.id)?.tools[0];
    if (t) return { kind: 'tool', arg: t };
  }
  const c = src.commands[0] || src.sections.flatMap((s) => HOWTOS.find((x) => x.id === s.id)?.commands || []).map((name) => ({ name }))[0];
  return c ? { kind: 'do', arg: c.name } : null;
}
