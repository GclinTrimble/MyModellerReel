// A first pass over a new drawing (#151): the scale, the title, a date, grid coordinates along the edges (control
// points) and the north arrow's letter, read from the drawing's text. Plumb can refine it from a picture
// (merge); nothing is applied until read_drawing is asked to.

const num = (s) => +String(s).replace(/[\s']/g, '').replace(',', '.');

/**
 * texts: [{ str, at: [u, v], size }] in drawing units (v down), size: [w, h]. Returns { scale, title, date,
 * north, grid: { eastings: [{ value, u }], northings: [{ value, v }] }, control: [{ u, v, e, n }] }.
 */
export function readClues(texts, size) {
  const out = { scale: null, title: null, date: null, north: null, grid: { eastings: [], northings: [] }, control: [] };
  const [W, H] = size;
  for (const t of texts) {
    const s = t.str.trim();
    const sc = s.match(/(?:scale|échelle|ech\.?)?\s*1\s*[:/]\s*(\d[\d\s]{0,6}\d|\d)\b/i);
    if (sc && !out.scale) out.scale = { ratio: num(sc[1]), text: s, at: t.at };
    const dt = s.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
    if (dt && !out.date) out.date = dt[1];
    if (/^(N|NORTH|NORD)$/i.test(s) && !out.north) out.north = { at: t.at };
    // grid labels: a big number (5 or more digits), maybe with E / N / X / Y in front, near an edge
    const g = s.match(/^([ENXY])?\s*[=:]?\s*(\d{1,3}(?:[\s']\d{3})+|\d{5,8})(?:[.,]\d+)?\s*(m)?$/i);
    if (g) {
      const value = num(g[2]);
      const nearX = t.at[1] < H * 0.12 || t.at[1] > H * 0.88; // top or bottom edge: labels of lines across x
      const nearY = t.at[0] < W * 0.12 || t.at[0] > W * 0.88;
      const kind = /[EX]/i.test(g[1] || '') ? 'e' : /[NY]/i.test(g[1] || '') ? 'n' : nearX && !nearY ? 'e' : nearY && !nearX ? 'n' : null;
      if (kind === 'e') out.grid.eastings.push({ value, u: t.at[0] });
      else if (kind === 'n') out.grid.northings.push({ value, v: t.at[1] });
    }
  }
  // the title: the biggest text that is not a number, a scale or a date
  const words = texts.filter((t) => /[A-Za-zÀ-ÿ]{3}/.test(t.str) && !/1\s*[:/]\s*\d/.test(t.str));
  if (words.length) out.title = words.reduce((a, b) => (b.size > a.size ? b : a)).str.trim();
  // control points where grid lines cross: the two outermost eastings × the two outermost northings
  const uniq = (list, key) => [...new Map(list.map((x) => [`${x.value}`, x])).values()].sort((a, b) => a[key] - b[key]);
  const E = uniq(out.grid.eastings, 'u');
  const N = uniq(out.grid.northings, 'v');
  if (E.length >= 2 && N.length >= 2) {
    // eastings grow to the right, northings grow up (v down): check the labels agree before trusting them
    const eOk = E.at(-1).value > E[0].value;
    const nOk = N[0].value > N.at(-1).value;
    if (eOk && nOk) for (const e of [E[0], E.at(-1)]) for (const n of [N[0], N.at(-1)]) out.control.push({ u: e.u, v: n.v, e: e.value, n: n.value });
  }
  return out;
}

/** Plumb's JSON reply merged over the text clues (the reply wins where it says something). */
export function mergeClues(clues, reply) {
  if (!reply || typeof reply !== 'object') return clues;
  const out = { ...clues };
  if (Number.isFinite(+reply.scale) && +reply.scale > 1) out.scale = { ratio: +reply.scale, text: `1:${reply.scale}`, from: 'copilot' };
  for (const k of ['title', 'date']) if (reply[k]) out[k] = String(reply[k]);
  if (Number.isFinite(+reply.north_angle)) out.north_angle = +reply.north_angle;
  if (Array.isArray(reply.grid) && reply.grid.length >= 2) out.control = reply.grid.filter((g) => [g.u, g.v, g.e, g.n].every((x) => Number.isFinite(+x))).map((g) => ({ u: +g.u, v: +g.v, e: +g.e, n: +g.n }));
  if (Array.isArray(reply.legend)) out.legend = reply.legend.slice(0, 40);
  return out;
}

/** The first JSON object in a model's reply text. */
export function jsonIn(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export const READ_PROMPT = `You read engineering and architectural drawings. From the picture and the text list, answer ONLY with JSON:
{"scale": 500 (the N of 1:N, or null), "north_angle": degrees clockwise from the sheet's up to north (or null), "title": "...", "date": "...",
"grid": [{"u": x on the sheet, "v": y on the sheet (down), "e": easting, "n": northing}] (crossings of labelled grid lines, 2 to 4),
"legend": [{"symbol": "...", "meaning": "..."}]}. Use the sheet units of the text list for u and v.`;
