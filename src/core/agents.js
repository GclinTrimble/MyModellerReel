// Agent profiles and the rules for several agents working on one document at once (#243). Pure: the renderer keeps
// one Crew; tests drive it directly.
//
// - Turns overlap: the first turn to start takes the undo checkpoint and opens the batch, the last to end closes it.
//   Overlapping turns therefore share one undo step (whole-doc snapshots cannot undo one agent's edits apart).
// - Tool calls run one at a time (serial), so a command never sees another agent's half-made change.
// - Each call claims the entities it touched for the rest of its agent's turn. A call that touches an entity another
//   running agent has claimed is undone and held: the user applies or drops it from the Agents panel.
import { diffDocs } from './document.js';

export const DEFAULT_AGENT = 'plumb';
export const AGENT_COLORS = ['#7aa2f7', '#e0a458', '#9ece6a', '#f7768e', '#bb9af7', '#2ac3de'];
// Phosphor animal icons an agent can wear (Plumb is the bird)
export const AGENT_ICONS = ['bird', 'cat', 'dog', 'fish', 'horse', 'rabbit', 'cow', 'butterfly', 'bug-beetle', 'shrimp', 'paw-print'];

/** A profile with every field filled. provider / model null: the app's AI settings. skill: a skill id or null. */
export function normalizeProfile(p = {}, i = 0) {
  const name = String(p.name || 'Agent').trim().slice(0, 40) || 'Agent';
  return {
    id: String(p.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `agent-${i + 1}`),
    name,
    provider: ['anthropic', 'openai', 'ollama', 'builtin'].includes(p.provider) ? p.provider : null,
    model: p.model ? String(p.model) : null,
    skill: p.skill && p.skill !== 'none' ? String(p.skill) : null,
    toolset: p.toolset ? String(p.toolset) : 'auto',
    instructions: String(p.instructions || ''),
    color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : AGENT_COLORS[i % AGENT_COLORS.length],
    icon: AGENT_ICONS.includes(p.icon) ? p.icon : AGENT_ICONS[i % AGENT_ICONS.length],
  };
}

/** The saved list, cleaned: Plumb always first, ids unique. */
export function normalizeProfiles(list = []) {
  const out = [];
  const seen = new Set();
  for (const p of [{ id: DEFAULT_AGENT, name: 'Plumb', ...(list.find((x) => x?.id === DEFAULT_AGENT) || {}) }, ...list.filter((x) => x?.id !== DEFAULT_AGENT)]) {
    const n = normalizeProfile(p, out.length);
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

/** Entity ids a change touched (diffDocs result). */
export const touchedIds = (diff) => (diff ? [...diff.added, ...diff.changed, ...diff.removed] : []);

export class Crew {
  constructor() {
    this.active = new Set(); // agents with a turn running
    this.claims = new Map(); // entity id → agent id
    this.held = []; // { n, agent, command, args, entity, owner }
    this.n = 0;
    this.tail = Promise.resolve();
  }
  /** A turn starts. true: it is the first, so take the undo checkpoint and open the batch. */
  start(agent) {
    const first = !this.active.size;
    this.active.add(agent);
    return first;
  }
  /** A turn ends and its claims go. true: it was the last, so close the batch. */
  end(agent) {
    this.active.delete(agent);
    for (const [k, v] of this.claims) if (v === agent) this.claims.delete(k);
    return !this.active.size;
  }
  /** The first of ids another running agent holds: { entity, owner } or null. */
  clash(agent, ids) {
    for (const entity of ids) {
      const owner = this.claims.get(entity);
      if (owner && owner !== agent && this.active.has(owner)) return { entity, owner };
    }
    return null;
  }
  claim(agent, ids) {
    for (const x of ids) this.claims.set(x, agent);
  }
  hold(agent, command, args, clash) {
    const h = { n: ++this.n, agent, command, args, ...clash };
    this.held.push(h);
    return h;
  }
  take(n) {
    const i = this.held.findIndex((h) => h.n === n);
    return i < 0 ? null : this.held.splice(i, 1)[0];
  }
  /** Run fn after every call queued before it (a failure does not block the next). */
  serial(fn) {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => {});
    return p;
  }
}

/**
 * One tool call of an agent's turn, under the crew's rules. ctx: the registry context (store; ctx.agent names who runs,
 * for the journal); run(name, args): the registry. A failed call leaves nothing behind; a clashing one is undone and held.
 */
export function crewRun(crew, ctx, agent, run, name, args) {
  return crew.serial(async () => {
    const before = JSON.stringify(ctx.store.doc);
    let result;
    ctx.agent = agent.name;
    try {
      result = await run(name, args);
    } catch (e) {
      ctx.store.doc = JSON.parse(before);
      throw e;
    } finally {
      ctx.agent = null;
    }
    const ids = touchedIds(diffDocs(JSON.parse(before), ctx.store.doc));
    const c = crew.clash(agent.id, ids);
    if (!c) return crew.claim(agent.id, ids), result;
    ctx.store.doc = JSON.parse(before);
    const h = crew.hold(agent.id, name, args, c);
    return { held: h.n, message: `Not applied: another agent (${c.owner}) is working on ${c.entity}. Your ${name} is held for the user to apply; leave ${c.entity} alone this turn.` };
  });
}
