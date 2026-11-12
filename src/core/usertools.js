// My tools and skills (#242): what the user asks Plumb to keep. Plain data, no dependencies; one JSON file each in the
// user library (library/mytools/<name>.tool.json | .skill.json), so they can be exported, shared, edited and deleted.
//
// A user tool: { kind: 'tool', name: 'kerb_return', title: 'Kerb return', description, params, steps }
//   params: { width: { default: 0.15, description } }   steps: [{ command, args, made? }]
//   Step args may hold "{{expr}}" placeholders over the params (a whole-string placeholder keeps its type). `made` is
//   the id the step created when it was recorded: later steps that name that id get the new one on each run.
// A user skill: { kind: 'skill', name: 'site_kerbs', label, description, prompt, toolset: [command names], examples }
//   The same shape as a domain skill in skills.js; toolset lists the commands it leans on.

/** "Kerb return" → "kerb_return": a command name. */
export const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

/** Fill "{{expr}}" placeholders from params (a whole-string placeholder keeps its type). */
export function fillParams(v, params) {
  const keys = Object.keys(params);
  const calc = (expr) => {
    try {
      return new Function(...keys, `return (${expr});`)(...keys.map((k) => params[k]));
    } catch (e) {
      throw new Error(`Recipe placeholder {{${expr}}}: ${e.message}`);
    }
  };
  if (typeof v === 'string') {
    const whole = v.match(/^\{\{(.+?)\}\}$/s);
    if (whole) return calc(whole[1]);
    return v.replace(/\{\{(.+?)\}\}/gs, (_, x) => String(calc(x)));
  }
  if (Array.isArray(v)) return v.map((x) => fillParams(x, params));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillParams(x, params)]));
  return v;
}

/** Swap ids a recorded step made for the ones this run made (any string leaf equal to an old id). */
export function swapIds(v, map) {
  if (typeof v === 'string') return map[v] ?? v;
  if (Array.isArray(v)) return v.map((x) => swapIds(x, map));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapIds(x, map)]));
  return v;
}

/**
 * The steps of the last turn that did something: journal entries from the newest turn start that has any.
 * starts are journal lengths taken when each copilot turn began; "save what we just did" in a later turn still finds
 * the work of the turn before.
 */
export function lastTurnSteps(journal = [], starts = []) {
  const at = [0, ...starts].map((s) => Math.min(Math.max(0, s), journal.length));
  for (let i = at.length - 1; i >= 0; i--) {
    const steps = journal.slice(at[i], i + 1 < at.length ? at[i + 1] : journal.length);
    if (steps.length) return structuredClone(steps);
  }
  return [];
}

// Keys whose numbers are not sizes worth asking for again.
const FIXED = new Set(['face', 'index', 'vertex', 'segments', 'steps', 'from', 'n', 'page', 'pages', 'seed']);

/**
 * Parameters inferred from the values (#242): each number under a named argument (not inside a list of
 * coordinates) becomes a parameter named after it; the same name with the same value is one parameter, the same
 * name with another value gets _2, _3. Ids the steps did not make are dropped from `ids` so the tool acts on the
 * selection when it runs. Returns { steps, params } with "{{name}}" placeholders in the steps.
 */
export function inferParams(steps) {
  const made = new Set(steps.map((s) => s.made).filter(Boolean));
  const params = {};
  const nameFor = (key, value) => {
    for (let i = 1; ; i++) {
      const n = i === 1 ? key : `${key}_${i}`;
      if (!params[n]) return (params[n] = { default: value, description: `${key.replace(/_/g, ' ')} (was ${value})` }), n;
      if (params[n].default === value) return n;
    }
  };
  const walk = (v, key) => {
    if (typeof v === 'number' && key && !FIXED.has(key)) return `{{${nameFor(slug(key) || 'value', v)}}}`;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? x : walk(x, null)));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  const out = steps.map((s) => {
    const args = { ...(s.args || {}) };
    if (Array.isArray(args.ids) && !args.ids.some((x) => made.has(x))) delete args.ids;
    return { command: s.command, args: walk(args, null), ...(s.made ? { made: s.made } : {}) };
  });
  return { steps: out, params };
}

/** A checked user tool. has(name) says whether a step's command exists. */
export function makeTool({ name, title, description = '', params, steps }, has = () => true) {
  const id = slug(name);
  if (!id) throw new Error('A tool needs a name, e.g. "Kerb return".');
  if (!Array.isArray(steps) || !steps.length) throw new Error('Nothing to save: no steps, and no turn did anything yet.');
  for (const s of steps) {
    if (!s?.command) throw new Error('Each step needs a command.');
    if (!has(s.command)) throw new Error(`Step "${s.command}" is not a command.`);
    if (s.command === id) throw new Error(`The tool "${id}" cannot call itself.`);
  }
  const inferred = params ? { steps, params } : inferParams(steps);
  const norm = Object.fromEntries(
    Object.entries(inferred.params).map(([k, p]) => [slug(k), p && typeof p === 'object' && 'default' in p ? { default: p.default, description: p.description || k } : { default: p, description: k }]),
  );
  return { kind: 'tool', name: id, title: title || String(name).trim(), description: description || `My tool: ${inferred.steps.length} steps.`, params: norm, steps: structuredClone(inferred.steps) };
}

/** The command a user tool adds to the registry; run(name, args) runs one step. */
export function toolCommand(tool, run) {
  const properties = Object.fromEntries(
    Object.entries(tool.params).map(([k, p]) => [k, { type: typeof p.default === 'number' ? 'number' : typeof p.default === 'boolean' ? 'boolean' : 'string', description: `${p.description}, default ${JSON.stringify(p.default)}` }]),
  );
  return {
    name: tool.name,
    category: 'my tools',
    description: `${tool.title}: ${tool.description} (my tool)`,
    params: { type: 'object', properties, required: [] },
    mutates: true,
    compound: true,
    userTool: true,
    async run(args) {
      const values = Object.fromEntries(Object.entries(tool.params).map(([k, p]) => [k, args[k] ?? p.default]));
      const ids = {};
      let last;
      for (const [i, s] of tool.steps.entries()) {
        try {
          last = await run(s.command, swapIds(fillParams(s.args || {}, values), ids));
        } catch (e) {
          throw new Error(`${tool.title}, step ${i + 1} (${s.command}): ${e.message}`);
        }
        if (s.made && typeof last?.id === 'string') ids[s.made] = last.id;
      }
      return { tool: tool.name, params: values, steps: tool.steps.length, made: Object.values(ids) };
    },
  };
}

/** A checked user skill. has(name) says whether a toolset command exists. */
export function makeSkill({ name, label, description = '', prompt, toolset = [], examples = [] }, has = () => true) {
  const id = slug(name);
  if (!id) throw new Error('A skill needs a name.');
  if (!String(prompt || '').trim()) throw new Error('A skill needs its instructions (prompt).');
  for (const c of toolset) if (!has(c)) throw new Error(`"${c}" in the toolset is not a command.`);
  return { kind: 'skill', name: id, label: label || String(name).trim(), description, prompt: String(prompt).trim(), toolset: [...toolset], examples: examples.filter((x) => x?.code).map((x) => ({ title: x.title || '', code: x.code })) };
}

/** A user library file's text → a tool or a skill (anything else is refused). */
export function parseUserFile(text) {
  const x = JSON.parse(text);
  if (x?.kind === 'tool') return makeTool(x);
  if (x?.kind === 'skill') return makeSkill(x);
  throw new Error('Not a MyModellerReel tool or skill file (kind must be "tool" or "skill").');
}

export const fileName = (item) => `${item.name}.${item.kind}.json`;
