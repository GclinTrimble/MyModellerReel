// Copilot feedback (#232): every copilot turn becomes a training record (the request, the commands it ran, its answer,
// the model before and after), rated by the user. Records stay on the PC; sharing uploads them to the suite (opt-in).
// Pure, Node-tested; the files and the upload are in main.cjs.

export const SCHEMA = 1;
export const TAGS = ['misunderstood', 'wrong size', 'wrong place', 'not editable', 'too many steps', 'missing parts', 'slow', 'great result'];
/** A model bigger than this (JSON characters) keeps its entities' names and boxes, not their geometry. */
export const MAX_DOC = 1_500_000;
const MAX_RESULT = 4000;

/** The document as a training record keeps it: no journal or UI state; geometry dropped when it is huge. */
export function trimDoc(doc) {
  if (!doc) return null;
  const { journal, ui, ...rest } = doc;
  const d = structuredClone(rest);
  if (JSON.stringify(d).length <= MAX_DOC) return d;
  // shortcut: a huge model keeps names, types and transforms only; upgrade to a geometry digest if training needs it
  d.entities = d.entities.map(({ id, name, type, parent, position, rotation, scale, derived, tags }) => ({ id, name, type, parent, position, rotation, scale, derived, tags, geometry: 'omitted' }));
  d.trimmed = true;
  return d;
}

const clip = (v) => {
  const s = JSON.stringify(v ?? null);
  return s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}…` : JSON.parse(s);
};

/** One copilot turn as a record (unrated). steps: [{ name, args, result, error }]. */
export function turnRecord({ id, at = new Date().toISOString(), prompt, steps = [], answer = '', before, after, provider = '', model = '', app_version = '', seconds = 0, tokens = null, selection = [] }) {
  return {
    schema: SCHEMA,
    id: id || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at,
    app_version,
    provider,
    model,
    prompt,
    selection,
    steps: steps.map((s) => ({ name: s.name, args: s.args, ...(s.error ? { error: String(s.error) } : { result: clip(s.result?.image ? { ...s.result, image: '(image)' } : s.result) }) })),
    answer,
    before: trimDoc(before),
    after: trimDoc(after),
    seconds: Math.round(seconds * 10) / 10,
    tokens,
    rating: null,
    comment: '',
    tags: [],
    shared: false,
  };
}

/** The record with the user's verdict (a new object). rating: good | bad. */
export function rate(record, { rating, comment, tags } = {}) {
  if (rating && !['good', 'bad'].includes(rating)) throw new Error('rating is good or bad.');
  const bad = (tags || []).filter((t) => !TAGS.includes(t));
  if (bad.length) throw new Error(`Unknown tag ${bad[0]}: one of ${TAGS.join(', ')}.`);
  return { ...record, rating: rating ?? record.rating, comment: comment ?? record.comment, tags: tags ?? record.tags, rated_at: new Date().toISOString() };
}

/** The row the suite's ai_feedback table takes (docs/supabase/ai_feedback.sql). */
export const uploadRow = (r, app = 'MyModellerReel') => ({ id: r.id, app, app_version: r.app_version, rating: r.rating, comment: r.comment, tags: r.tags, provider: r.provider, model: r.model, prompt: r.prompt, record: r });

/** Reporting: how many, how good, what goes wrong most, how many shared. */
export function summary(records = []) {
  const rated = records.filter((r) => r.rating);
  const good = rated.filter((r) => r.rating === 'good').length;
  const tags = {};
  for (const r of rated) for (const t of r.tags || []) tags[t] = (tags[t] || 0) + 1;
  const models = {};
  for (const r of rated) {
    const k = `${r.provider}/${r.model}`;
    models[k] ||= { model: k, rated: 0, good: 0 };
    models[k].rated++;
    if (r.rating === 'good') models[k].good++;
  }
  return {
    rated: rated.length,
    good,
    bad: rated.length - good,
    good_rate: rated.length ? Math.round((good / rated.length) * 100) : null,
    with_comment: rated.filter((r) => r.comment).length,
    shared: records.filter((r) => r.shared).length,
    top_tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })),
    by_model: Object.values(models),
  };
}

/** JSONL for training: one rated record per line. */
export const toJsonl = (records) => records.filter((r) => r.rating).map((r) => JSON.stringify(r)).join('\n') + '\n';
