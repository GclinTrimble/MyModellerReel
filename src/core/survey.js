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
export function addPoint(doc, { name, n, e, z = 0, code = '', desc = '', attrs = {} }) {
  if (![n, e, z].every(Number.isFinite)) throw new Error('A point needs numbers for n (Northing), e (Easting) and z (Elevation).');
  const g = geo(doc);
  if (!g.base) g.base = [Math.round(e / 100) * 100, Math.round(n / 100) * 100, Math.round(z)];
  const label = String(name ?? nextPointName(doc));
  if (doc.entities.some((x) => isPoint(x) && x.name === label)) throw new Error(`There is already a point "${label}".`);
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

/** Parse a points file. format: letters P N E Z D (code) in column order, e.g. PNEZD, PENZD, NEZ. */
export function parsePoints(text, { format = 'PNEZD', delimiter = null, units = 'm' } = {}) {
  const f = format.toUpperCase().replace(/[^PNEZD]/g, '');
  if (!f.includes('N') || !f.includes('E')) throw new Error('format needs N and E columns (e.g. PNEZD).');
  const k = UNITS[units];
  if (!k) throw new Error(`units must be one of ${Object.keys(UNITS).join(', ')}.`);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const delim = delimiter || (lines[0]?.includes(',') ? ',' : lines[0]?.includes(';') ? ';' : lines[0]?.includes('\t') ? '\t' : /\s+/);
  const rows = [];
  const skipped = [];
  lines.forEach((line, i) => {
    const c = line.split(delim).map((x) => x.trim().replace(/^"|"$/g, ''));
    const col = (ch) => c[f.indexOf(ch)];
    const n = +col('N');
    const e = +col('E');
    const z = f.includes('Z') ? +col('Z') : 0;
    if (!Number.isFinite(n) || !Number.isFinite(e) || !Number.isFinite(z)) {
      if (i > 0 || rows.length) skipped.push(i + 1); // a header line is not worth a warning
      return;
    }
    rows.push({ name: f.includes('P') ? col('P') : undefined, n: n * k, e: e * k, z: z * k, code: f.includes('D') ? (col('D') ?? '') : '', desc: c.slice(f.length).join(' ') });
  });
  return { rows, skipped };
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
  for (const p of points(doc)) {
    if (!p.point.code) continue;
    const { code, string, controls } = parseCode(p.point.code);
    const def = lib[code];
    if (!def) {
      warnings.push({ point: p.id, name: p.name, message: `Point ${p.name}: no feature code "${code}" in the library.` });
      continue;
    }
    for (const a of def.attrs || []) if (a.required && (p.point.attrs?.[a.name] === undefined || p.point.attrs[a.name] === '')) warnings.push({ point: p.id, name: p.name, message: `Point ${p.name} (${code}) has no ${a.name}.` });
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
  const what = o ? `places ${o.type === 'component' ? o.component || 'a component' : `a ${o.type || 'tree'}`}` : def.breakline ? 'joins into a breakline' : def.closed ? 'closes into a polygon' : def.line ? 'joins into a line' : 'a point';
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
