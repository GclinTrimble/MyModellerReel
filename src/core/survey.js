// Survey data (#116, #117, #118, #124): project coordinates, survey points, linework and feature codes.
// Model space is local metres, Y up: x = Easting − base E, y = Elevation − base Z, z = −(Northing − base N). Points keep
// their full-precision Northing/Easting/Elevation, so real-world coordinates (N 5 400 000) never reach 32-bit floats.
// Pure module, Node-tested.
import * as D from './document.js';

export const UNITS = { m: 1, ft: 0.3048, usft: 1200 / 3937 };

export function geo(doc) {
  return (doc.geo ||= { base: null, crs: null, units: 'm', angles: 'deg', grid: null });
}

/** Local model point of project coordinates (metres). */
/** The coordinate system as text: "EPSG:2193", a name, or '' (it is stored as { epsg, name }). */
export const crsLabel = (crs) => (!crs ? '' : typeof crs === 'string' ? crs : crs.epsg ? `EPSG:${crs.epsg}` : crs.name || '');

export function toLocal(doc, { n, e, z }) {
  const b = geo(doc).base || [0, 0, 0];
  return [e - b[0], z - b[2], -(n - b[1])];
}
/** Project coordinates of a local model point. */
export function toProject(doc, [x, y, zz]) {
  const b = geo(doc).base || [0, 0, 0];
  return { e: b[0] + x, n: b[1] - zz, z: b[2] + y };
}

/** Site grid → project coordinates (origin, rotation in degrees, scale factor), for grids that are not the project's. */
export function gridToProject(doc, { n, e, z }) {
  const g = geo(doc).grid;
  if (!g) return { n, e, z };
  const a = ((g.rotation || 0) * Math.PI) / 180;
  const s = g.scale || 1;
  const [o0, o1] = g.origin || [0, 0]; // [E, N] of the grid origin in project coordinates
  return { e: o0 + s * (e * Math.cos(a) - n * Math.sin(a)), n: o1 + s * (e * Math.sin(a) + n * Math.cos(a)), z };
}

/** Bearing in degrees from a number or a DMS string ("45°30'15\"", "45 30 15", "N45-30-15E" not supported). Gons when angles is gon. */
export function parseAngle(v, angles = 'deg') {
  if (typeof v === 'number') return angles === 'gon' ? v * 0.9 : v;
  const s = String(v).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)(?:[°\s:d]+(\d+(?:\.\d+)?))?(?:['\s:m]+(\d+(?:\.\d+)?))?['"s]?$/i); // 45°30' reads too
  if (!m) throw new Error(`Cannot read the angle "${s}". Use degrees (45.5) or DMS (45°30'00").`);
  const sign = s.startsWith('-') ? -1 : 1;
  const deg = Math.abs(+m[1]) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600;
  return sign * (angles === 'gon' && !m[2] ? deg * 0.9 : deg);
}

export function formatAngle(deg, angles = 'deg') {
  if (angles === 'gon') return `${(deg / 0.9).toFixed(4)} gon`;
  if (angles !== 'dms') return `${deg.toFixed(4)}°`;
  const d = Math.floor(Math.abs(deg));
  const mf = (Math.abs(deg) - d) * 60;
  const mm = Math.floor(mf);
  return `${deg < 0 ? '-' : ''}${d}°${String(mm).padStart(2, '0')}'${((mf - mm) * 60).toFixed(1).padStart(4, '0')}"`;
}

// ---------------------------------------------------------------- points

export const isPoint = (e) => e.type === 'point';
export const points = (doc) => doc.entities.filter(isPoint);

const CODE_COLORS = ['#c8553d', '#2f6f86', '#4c7a5a', '#b58a57', '#7a4c9a', '#d08c2a', '#3c7a9a', '#8a3c5a'];

/** A point's colour: its feature code's, else a stable colour per code. */
export function codeColor(doc, code) {
  const c = String(code || '').split(/\s+/)[0].toUpperCase();
  const def = doc.featureCodes?.[c];
  if (def?.color) return def.color;
  if (!c) return '#1e3a4c';
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CODE_COLORS[h % CODE_COLORS.length];
}

/** Make a point entity at project coordinates. The first point sets the project base point (rounded). */
/** taken: the point names already used, when adding many (a Set, kept by the caller). */
export function addPoint(doc, { name, n, e, z = 0, code = '', desc = '', attrs = {} }, taken = null) {
  if (![n, e, z].every(Number.isFinite)) throw new Error('A point needs numbers for n (Northing), e (Easting) and z (Elevation).');
  const g = geo(doc);
  if (!g.base) g.base = [Math.round(e / 100) * 100, Math.round(n / 100) * 100, Math.round(z)];
  const label = String(name ?? nextPointName(doc));
  if (taken ? taken.has(label) : doc.entities.some((x) => isPoint(x) && x.name === label)) throw new Error(`There is already a point "${label}".`);
  const p = D.addEntity(doc, { type: 'point', name: label, point: { n, e, z, code: String(code), desc: String(desc), attrs }, position: D.round3(toLocal(doc, { n, e, z })), material: { color: codeColor(doc, code) }, tag: doc.featureCodes?.[String(code).split(/\s+/)[0].toUpperCase()]?.layer || 'Untagged' });
  return p;
}

export function nextPointName(doc) {
  const nums = points(doc).map((p) => +p.name).filter(Number.isFinite);
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

/** After a change: points moved in the model take their new coordinates; changed coordinates move the point. */
export function syncPoints(doc) {
  for (const p of points(doc)) {
    const want = D.round3(toLocal(doc, p.point));
    if (p.parent || want.every((x, k) => Math.abs(x - p.position[k]) < 1e-4)) continue;
    // whichever moved last: commands that edit coordinates also set position, so a mismatch means the model moved it
    Object.assign(p.point, toProject(doc, p.position));
  }
}

/** Re-place every point after a base point or unit change. */
export function placePoints(doc) {
  for (const p of points(doc)) p.position = D.round3(toLocal(doc, p.point));
}

// ---------------------------------------------------------------- delimited point files (CSV, TXT)

/** Named delimiters; anything else is used as given. "space" splits on runs of spaces and tabs. */
export const DELIMITERS = { comma: ',', tab: '\t', semicolon: ';', space: ' ' };
/** What a column can hold: point name, easting, northing, elevation, feature code, description, a named attribute, nothing. */
export const COLUMN_ROLES = ['name', 'e', 'n', 'z', 'code', 'desc', 'attr', 'ignore'];
const LETTER_ROLE = { P: 'name', N: 'n', E: 'e', Z: 'z', D: 'code' };
const HEADER_ROLE = [
  ['name', /^(p|pt|pnt|pno|pt(no|id|name)|point(no|id|name|number)?|name|id|no|num|number)$/],
  ['n', /^(n|north|northing|y)$/],
  ['e', /^(e|east|easting|x)$/],
  ['z', /^(z|el|elev|elevation|height|h|rl|alt|altitude)$/],
  ['code', /^(d|code|fc|feature|featurecode|pointcode)$/],
  ['desc', /^(desc|description|note|notes|comment|comments|remark|remarks)$/],
];
const isNum = (s) => s !== '' && Number.isFinite(+String(s).replace(',', '.'));

/** The delimiter of a sample line: tab, semicolon (its numbers may have decimal commas), comma, else spaces. */
export function detectDelimiter(text) {
  const line = String(text).split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#')) || '';
  return line.includes('\t') ? 'tab' : line.includes(';') ? 'semicolon' : line.includes(',') ? 'comma' : 'space';
}

/** Split delimited text into rows of cells (double quotes respected, blank and # lines dropped); each row keeps its file line. */
export function splitTable(text, delimiter = 'auto') {
  const key = !delimiter || delimiter === 'auto' ? detectDelimiter(text) : delimiter;
  const d = DELIMITERS[key] ?? key;
  const space = d === ' ';
  const rows = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    // shortcut: a quoted cell cannot span lines; upgrade if a real file needs it
    const cells = [];
    let cur = '';
    let q = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (ch === '"') {
        if (q && line[k + 1] === '"') (cur += '"'), k++;
        else q = !q;
      } else if (!q && (space ? ch === ' ' || ch === '\t' : line.startsWith(d, k))) {
        if (space && !cur && (k === 0 || line[k - 1] === ' ' || line[k - 1] === '\t')) continue; // runs of spaces are one
        cells.push(cur.trim());
        cur = '';
        if (!space) k += d.length - 1;
      } else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(Object.assign(cells, { line: i + 1 }));
  });
  return { delimiter: key, rows };
}

/** A first row of labels over rows of numbers. */
export const looksLikeHeader = (rows) => rows.length > 1 && rows[0].filter(isNum).length < rows[1].filter(isNum).length;

/** Column roles from header labels (unknown labels become attributes), else the PNEZD order and a description. */
export function guessColumns(rows, header = looksLikeHeader(rows)) {
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const used = new Set();
  return Array.from({ length: width }, (_, i) => {
    const label = header ? rows[0]?.[i] || '' : '';
    const key = label.toLowerCase().replace(/[^a-z]/g, '');
    let role = header ? HEADER_ROLE.find(([r, re]) => !used.has(r) && re.test(key))?.[0] : ['name', 'n', 'e', 'z', 'code'][i];
    role ||= header ? 'attr' : 'desc';
    if (role !== 'attr') used.add(role);
    return role === 'attr' ? { role, name: label || `col${i + 1}` } : { role };
  });
}

const normColumns = (columns) => columns.map((c, i) => {
  const o = typeof c === 'string' ? { role: c } : { ...c };
  if (!COLUMN_ROLES.includes(o.role)) throw new Error(`Column ${i + 1}: role must be one of ${COLUMN_ROLES.join(', ')}.`);
  return o;
});

/**
 * Points from delimited text. columns: one role per column (COLUMN_ROLES, or { role: 'attr', name }); missing ones
 * are guessed. header: the first row is labels (default: detected). Decimal commas are read when the delimiter is not a comma.
 */
export function parseTable(text, { delimiter = 'auto', header, columns, units = 'm' } = {}) {
  const k = UNITS[units];
  if (!k) throw new Error(`units must be one of ${Object.keys(UNITS).join(', ')}.`);
  const t = splitTable(text, delimiter);
  const head = header ?? looksLikeHeader(t.rows);
  const cols = columns ? normColumns(columns) : guessColumns(t.rows, head);
  const at = (role) => cols.findIndex((c) => c.role === role);
  const [iN, iE, iZ, iP, iC] = ['n', 'e', 'z', 'name', 'code'].map(at);
  if (iN < 0 || iE < 0) throw new Error('Give a column for northing (n) and one for easting (e).');
  const labels = head ? t.rows[0] : [];
  const attrs = cols.map((c, i) => (c.role === 'attr' ? c.name || labels[i] || `col${i + 1}` : null));
  const num = (s) => (t.delimiter === 'comma' ? +(s ?? '') : +String(s ?? '').replace(',', '.'));
  const rows = [];
  const skipped = [];
  for (const c of head ? t.rows.slice(1) : t.rows) {
    const n = num(c[iN]);
    const e = num(c[iE]);
    const z = iZ < 0 || !c[iZ] ? 0 : num(c[iZ]);
    if (!c[iN] || !c[iE] || ![n, e, z].every(Number.isFinite)) {
      if (rows.length || skipped.length || head || c.some(isNum)) skipped.push(c.line); // an undeclared label line is not worth a warning
      continue;
    }
    const row = { name: iP >= 0 && c[iP] ? c[iP] : undefined, n: n * k, e: e * k, z: z * k, code: iC >= 0 ? c[iC] || '' : '', desc: cols.map((x, i) => (x.role === 'desc' ? c[i] : '')).filter(Boolean).join(' '), attrs: {} };
    attrs.forEach((a, i) => a && c[i] !== undefined && c[i] !== '' && (row.attrs[a] = Number.isFinite(num(c[i])) ? num(c[i]) : c[i]));
    rows.push(row);
  }
  return { rows, skipped, delimiter: t.delimiter, header: head, columns: cols, labels };
}

/** Parse a points file. format: letters P N E Z D (code) in column order, e.g. PNEZD, PENZD, NEZ; later columns are the description. */
export function parsePoints(text, { format = 'PNEZD', delimiter = null, units = 'm', header } = {}) {
  const f = format.toUpperCase().replace(/[^PNEZD]/g, '');
  if (!f.includes('N') || !f.includes('E')) throw new Error('format needs N and E columns (e.g. PNEZD).');
  const width = Math.max(f.length, ...splitTable(text, delimiter || 'auto').rows.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => LETTER_ROLE[f[i]] || 'desc');
  return parseTable(text, { delimiter: delimiter || 'auto', header, columns, units });
}

export function formatPoints(doc, pts, { format = 'PNEZD', units = 'm', delimiter = ',' } = {}) {
  const k = UNITS[units];
  const f = format.toUpperCase();
  const val = { P: (p) => p.name, N: (p) => (p.point.n / k).toFixed(4), E: (p) => (p.point.e / k).toFixed(4), Z: (p) => (p.point.z / k).toFixed(4), D: (p) => p.point.code };
  return pts.map((p) => [...f].filter((ch) => val[ch]).map((ch) => val[ch](p)).join(delimiter)).join('\n') + '\n';
}

// ---------------------------------------------------------------- linework (breaklines, boundaries, lines)

export const isLinework = (e) => e.type === 'linework';

/** The (still existing) point entities of a linework, in order. */
export const lineworkPoints = (doc, l) => l.line.points.map((id) => D.getEntity(doc, id)).filter(Boolean);

/** Local points of a linework (smooth lines densified as a Catmull-Rom curve at roughly `chord` metres). */
export function lineworkPath(doc, l, chord = 0.5) {
  const pts = lineworkPoints(doc, l).map((p) => D.worldMatrix(doc, p).elements.slice(12, 15));
  if (!l.line.smooth || pts.length < 3) return l.line.closed && pts.length > 2 ? [...pts, pts[0]] : pts;
  const n = pts.length;
  const at = (i) => (l.line.closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const spans = l.line.closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
    const steps = Math.max(1, Math.ceil(len / chord));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t)));
    }
  }
  out.push(l.line.closed ? out[0] : pts[n - 1]);
  return out;
}

// ---------------------------------------------------------------- feature codes (field to finish)

/**
 * A point code is "<CODE> [string] [controls]": KERB, KERB 2 (a second kerb string), KERB B (begin a new line),
 * KERB E (end it), KERB CL (close it), KERB S (smooth). Returns { code, string, controls }.
 */
export function parseCode(raw) {
  const t = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const code = (t.shift() || '').toUpperCase();
  let string = '1';
  if (t[0] && /^\d+$/.test(t[0])) string = t.shift();
  return { code, string, controls: new Set(t.map((x) => x.toUpperCase())) };
}

/**
 * What a feature library makes of the coded points: lines (per code and string, split at B/E, closed by CL, smooth by
 * S), objects (a tree at a TREE point, sized by an attribute) and warnings (unknown codes, missing attributes).
 */
export function planCodes(doc) {
  const lib = doc.featureCodes || {};
  const lines = [];
  const objects = [];
  const warnings = [];
  const open = new Map(); // code/string → current line
  const memo = new Map(); // link choices per code, once per pass
  for (const p of points(doc)) {
    if (!p.point.code) continue;
    const { code, string, controls } = parseCode(p.point.code);
    const def = lib[code];
    if (!def) {
      warnings.push({ point: p.id, name: p.name, message: `Point ${p.name}: no feature code "${code}" in the library.` });
      continue;
    }
    for (const a of def.attrs || []) {
      const r = checkAttr(a, p.point.attrs?.[a.name], a.type === 'link' ? linksOf(doc, a.link, memo) : null);
      if (r.error) warnings.push({ point: p.id, name: p.name, message: `Point ${p.name} (${code}): ${r.error}` });
    }
    if (def.object) objects.push({ point: p, def, code });
    if (!def.line) continue;
    const key = `${code}/${string}`;
    if (controls.has('B') || !open.has(key)) {
      const l = { code, string, def, points: [], closed: false, smooth: false };
      lines.push(l);
      open.set(key, l);
    }
    const l = open.get(key);
    l.points.push(p.id);
    if (controls.has('S')) l.smooth = true;
    if (controls.has('CL')) (l.closed = true), open.delete(key);
    else if (controls.has('E')) open.delete(key);
  }
  return { lines: lines.filter((l) => l.points.length >= 2), objects, warnings };
}

// ---------------------------------------------------------------- typed attributes and symbols

/** Attribute types: text (kind date / time / file), number (kind integer; decimals, min, max), list (options), boolean, color, image (a path), link (a point of another code). */
export const ATTR_TYPES = ['text', 'number', 'list', 'boolean', 'color', 'image', 'link'];

/** Names of the points coded with code (the choices of a link attribute). */
export const linkNames = (doc, code) => points(doc).filter((p) => parseCode(p.point.code).code === String(code || '').toUpperCase()).map((p) => p.name);

/** linkNames once per code in a pass over many points (per point it is quadratic). */
const linksOf = (doc, code, memo) => memo.get(code) || memo.set(code, linkNames(doc, code)).get(code);

/** Where a point came from, for folders and queries: its field book (a survey entity), the file it was imported from, or here. */
export const sourceOf = (p, nameOf = () => null) => (p.point?.survey ? `Field book: ${nameOf(p.point.survey) || p.point.survey}` : p.point?.source ? `File: ${p.point.source}` : 'Entered here');

/** One value against its attribute definition: { value } cleaned (number rounded to its decimals, list option as written), or { error }. links: the names a link may take. */
export function checkAttr(a, raw, links = null) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return a.required ? { error: `${a.name} is needed.` } : { value: undefined };
  const t = a.type || 'text';
  const s = String(raw).trim();
  if (t === 'number') {
    let v = typeof raw === 'number' ? raw : Number(s.replace(',', '.'));
    if (!Number.isFinite(v)) return { error: `${a.name} is a number.` };
    if (a.kind === 'integer' && !Number.isInteger(v)) return { error: `${a.name} is a whole number.` };
    if (a.decimals !== undefined) v = +v.toFixed(a.decimals);
    if (a.min !== undefined && v < a.min) return { error: `${a.name} is at least ${a.min}.` };
    if (a.max !== undefined && v > a.max) return { error: `${a.name} is at most ${a.max}.` };
    return { value: v };
  }
  if (t === 'boolean') {
    if (typeof raw === 'boolean') return { value: raw };
    if (/^(true|yes|y|1|oui)$/i.test(s)) return { value: true };
    if (/^(false|no|n|0|non)$/i.test(s)) return { value: false };
    return { error: `${a.name} is yes or no.` };
  }
  if (t === 'list' && a.options?.length) {
    const o = a.options.find((x) => String(x).toLowerCase() === s.toLowerCase());
    return o === undefined ? { error: `${a.name} is one of ${a.options.join(', ')}.` } : { value: o };
  }
  if (t === 'color') return /^#[0-9a-f]{6}$/i.test(s) ? { value: s.toLowerCase() } : { error: `${a.name} is a colour, # and six hex digits.` };
  if (t === 'link' && links && !links.includes(s)) return { error: `${a.name}: no ${a.link || ''} point named ${s}.`.replace('  ', ' ') };
  if (a.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `${a.name} is a date, YYYY-MM-DD.` };
  if (a.kind === 'time' && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return { error: `${a.name} is a time, HH:MM.` };
  return { value: s };
}

/**
 * A point's attributes checked against its code's definitions: { attrs, errors }. Missing values take their default;
 * attributes the code does not list pass through as they are. A missing required value is not an error here: planCodes
 * warns about it, so a point can be stored first and completed later.
 */
export function cleanAttrs(doc, code, attrs = {}, memo = new Map()) {
  const defs = doc.featureCodes?.[parseCode(code).code]?.attrs || [];
  const out = { ...attrs };
  const errors = [];
  for (const a of defs) {
    const r = checkAttr({ ...a, required: false }, attrs[a.name] ?? a.default, a.type === 'link' ? linksOf(doc, a.link, memo) : null);
    if (r.error) errors.push(r.error);
    else if (r.value === undefined) delete out[a.name];
    else out[a.name] = r.value;
  }
  return { attrs: out, errors };
}

/**
 * A symbol's placement from its point's attributes (a parametric symbol): scale (scale_attr × scale, uniform),
 * rotation (rotation_attr: degrees clockwise from north, about the vertical), tint (color_attr, a #rrggbb), and which
 * components (variant_attr: the point's value picks variants[value].component / .plan, else the code's own).
 */
export function symbolTransform(ob = {}, attrs = {}) {
  const pos = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
  const k = (ob.scale_attr && pos(attrs[ob.scale_attr])) || 1;
  const s = k * (pos(ob.scale) || 1);
  const az = ob.rotation_attr && Number.isFinite(+attrs[ob.rotation_attr]) ? +attrs[ob.rotation_attr] : 0;
  const tint = ob.color_attr && /^#[0-9a-f]{6}$/i.test(attrs[ob.color_attr] || '') ? attrs[ob.color_attr] : null;
  const pick = String(attrs[ob.variant_attr] ?? '').toLowerCase();
  const v = (ob.variant_attr && Object.entries(ob.variants || {}).find(([k]) => k.toLowerCase() === pick)?.[1]) || {};
  // north is −z: clockwise from above is a negative turn about +y
  return { scale: [s, s, s], rotation: [0, az ? -az : 0, 0], tint, component: v.component || ob.component, plan: v.plan || ob.plan };
}

// ---------------------------------------------------------------- the code card (#217)

/** Recent codes, most recent first: code moves to the top, no duplicates (case-insensitive), at most max. */
export function rememberCode(recent, code, max = 12) {
  const c = String(code || '').trim();
  if (!c) return recent;
  return [c, ...recent.filter((x) => x.toUpperCase() !== c.toUpperCase())].slice(0, max);
}

/** What a library code does, in a few words: "places a tree", "joins into a line"… */
export function codeAction(def) {
  if (!def) return 'not in the library';
  const o = def.object;
  const what = o ? `places ${o.type === 'component' || o.component || o.plan ? o.component || o.plan || 'a component' : `a ${o.type || 'tree'}`}` : def.breakline ? 'joins into a breakline' : def.closed ? 'closes into a polygon' : def.line ? 'joins into a line' : 'a point';
  return def.description ? `${def.description} · ${what}` : what;
}

/**
 * The codes to offer for a point: the recent ones first (most recent on top), then the library's, then any other used in
 * the model; filtered by what is typed (start of the code first, then anywhere, also in the description).
 * Returns [{ code, recent, action }]. The base code is matched, so "KERB 2 B" still offers KERB.
 */
export function suggestCodes(doc, recent = [], query = '', max = 8) {
  const lib = doc.featureCodes || {};
  const used = points(doc).map((p) => p.point.code).filter(Boolean).reverse();
  const seen = new Set();
  const all = [];
  for (const [c, isRecent] of [...recent.map((c) => [c, true]), ...Object.keys(lib).map((c) => [c, false]), ...used.map((c) => [c, false])]) {
    const key = c.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ code: c, recent: isRecent, action: codeAction(lib[parseCode(c).code]) });
  }
  const q = String(query).trim().toUpperCase();
  if (!q) return all.slice(0, max);
  const base = parseCode(q).code;
  const starts = all.filter((x) => x.code.toUpperCase().startsWith(q) || x.code.toUpperCase() === base);
  const inside = all.filter((x) => !starts.includes(x) && (x.code.toUpperCase().includes(base) || x.action.toUpperCase().includes(q)));
  return [...starts, ...inside].slice(0, max);
}

/** A code definition with the fields of a define / edit command applied (type sets line and closed). */
export function editCode(old = {}, a = {}) {
  const def = { ...old };
  for (const k of ['description', 'category', 'layer', 'color', 'line', 'breakline', 'object', 'attrs']) if (a[k] !== undefined) def[k] = a[k];
  if (a.line_style !== undefined) def.lineStyle = a.line_style;
  if (a.type) Object.assign(def, { type: a.type, line: a.type !== 'point', closed: a.type === 'polygon' });
  else if (a.line !== undefined && def.type) def.type = a.line ? (def.closed ? 'polygon' : 'line') : 'point';
  for (const k of ['line', 'closed']) if (def[k] === false) delete def[k];
  if (def.object && !Object.keys(def.object).length) delete def.object; // the symbol taken off
  return def;
}

/** Codes of a library as rows { code, …def }, filtered by text in the code, description, layer or category (codes that start with it first). */
export function searchCodes(codes = {}, query = '') {
  const rows = Object.entries(codes).map(([code, d]) => ({ code, ...d }));
  const q = String(query || '').trim().toUpperCase();
  if (!q) return rows;
  const has = (r) => [r.code, r.description, r.layer, r.category].some((v) => String(v || '').toUpperCase().includes(q));
  return [...rows.filter((r) => r.code.startsWith(q)), ...rows.filter((r) => !r.code.startsWith(q) && has(r))];
}
