// Trimble field formats: JobXML (.jxl, #127) points from the controller, and feature libraries (.fxl, #128).
import * as X from './xml.js';
import * as S from './survey.js';
import * as L from './layers.js';
import { registerFormat } from './formats.js';

/** An attribute or a child element, whichever the writer used. */
const val = (el, k) => el?.attrs?.[k] ?? X.kid(el || { children: [] }, k)?.text?.trim();
const num = (el, k) => {
  const v = val(el, k);
  return v === undefined || v === '' ? null : Number(v);
};

/** Points of a JobXML file: reduced coordinates when the job has them, else the field book's grid values. */
export function jxlPoints(text) {
  const root = X.parse(text);
  const job = X.kid(root, 'JOBFile');
  if (!job) throw new Error('Not a Trimble JobXML file (no <JOBFile>).');
  const pts = new Map();
  const attrsOf = (rec) => {
    const out = {};
    for (const f of X.all(rec, 'Feature')) for (const a of X.kids(f, 'Attribute')) {
      const n = val(a, 'Name');
      if (n) out[n] = isNaN(Number(val(a, 'Value'))) ? val(a, 'Value') : Number(val(a, 'Value'));
    }
    return out;
  };
  const red = X.kid(job, 'Reductions');
  if (red) {
    for (const p of X.kids(red, 'Point')) {
      const g = X.kid(p, 'Grid');
      if (!g || num(g, 'North') === null) continue;
      pts.set(val(p, 'Name'), { name: val(p, 'Name'), n: num(g, 'North'), e: num(g, 'East'), z: num(g, 'Elevation') ?? 0, code: val(p, 'Code') || '', desc: val(p, 'Description1') || '', attrs: attrsOf(p) });
    }
  }
  const book = X.kid(job, 'FieldBook');
  for (const rec of book ? X.kids(book, 'PointRecord') : []) {
    if (val(rec, 'Deleted') === 'true') {
      pts.delete(val(rec, 'Name'));
      continue;
    }
    if (red) continue; // the reductions already hold the final coordinates
    const g = X.kid(rec, 'Grid') || X.kid(rec, 'ComputedGrid');
    if (!g || num(g, 'North') === null) continue;
    pts.set(val(rec, 'Name'), { name: val(rec, 'Name'), n: num(g, 'North'), e: num(g, 'East'), z: num(g, 'Elevation') ?? 0, code: val(rec, 'Code') || '', desc: val(rec, 'Description1') || '', attrs: attrsOf(rec) });
  }
  const cs = X.all(job, 'CoordinateSystem')[0];
  return { points: [...pts.values()], crs: cs ? val(cs, 'SystemName') || val(cs, 'ZoneName') || null : null, job: job.attrs.jobName };
}

registerFormat({
  id: 'jxl',
  label: 'Trimble JobXML (.jxl): points, codes, attributes',
  extensions: ['jxl', 'xml'],
  sniff: (t) => typeof t === 'string' && /<JOBFile[\s>]/.test(t.slice(0, 4000)),
  read: (text, { doc, report, cmd }) => {
    const r = jxlPoints(text);
    if (!r.points.length) throw new Error('No points with grid coordinates in that job.');
    const names = new Set(S.points(doc).map((p) => p.name));
    const rows = r.points.map((p) => {
      let name = p.name;
      while (names.has(name)) name = `${name}-1`;
      if (name !== p.name) report.warn(`Point ${p.name} exists already: brought in as ${name}.`);
      names.add(name);
      return { ...p, name };
    });
    for (const p of rows) S.addPoint(doc, p);
    report.add('points', rows.length);
    if (r.crs) report.warn(`The job's coordinate system is ${r.crs}: coordinates are used as they are.`);
    if (cmd && Object.keys(doc.featureCodes || {}).length) cmd('process_codes', {});
    return { job: r.job };
  },
});

/** ARGB integers, "#rrggbb" or "r,g,b" to "#rrggbb". */
export function fxlColor(c) {
  if (c === undefined || c === null || c === '') return undefined;
  const s = String(c).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(s)) return `#${s.slice(3).toLowerCase()}`;
  if (/^\d+,\s*\d+,\s*\d+/.test(s)) return `#${s.split(',').slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('')}`;
  if (/^-?\d+$/.test(s)) return `#${((+s >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
  return undefined;
}

/** Feature definitions of an FXL to our feature library { CODE: { description, layer, color, line, attrs } }. */
export function fxlLibrary(text) {
  const root = X.parse(text);
  const lib = X.kid(root, 'FeatureDefinitionLibrary') || X.all(root, 'FeatureDefinitionLibrary')[0];
  if (!lib) throw new Error('Not a Trimble feature library (no <FeatureDefinitionLibrary>).');
  const layers = new Map(X.all(lib, 'Layer').map((l) => [val(l, 'Name'), fxlColor(val(l, 'Color'))]));
  const out = {};
  const ATTR = { TextAttribute: 'text', StringAttribute: 'text', IntegerAttribute: 'number', DoubleAttribute: 'number', RealAttribute: 'number', ListAttribute: 'list', DateAttribute: 'text', FileAttribute: 'text', PhotoAttribute: 'text' };
  for (const kind of ['PointFeatureDefinition', 'LineFeatureDefinition', 'PolygonFeatureDefinition']) {
    for (const d of X.all(lib, kind)) {
      const code = (val(d, 'Code') || val(d, 'Name') || '').toUpperCase();
      if (!code) continue;
      const layer = val(d, 'Layer') || undefined;
      const attrs = [];
      for (const [tag, type] of Object.entries(ATTR))
        for (const a of X.all(d, tag)) {
          const items = X.all(a, 'Item').map((i) => i.text.trim() || i.attrs.Value).filter(Boolean);
          attrs.push({ name: val(a, 'Name'), type, ...(items.length ? { options: items } : {}), ...(val(a, 'Required') === 'true' || val(a, 'EntryRequirement') === 'Required' ? { required: true } : {}) });
        }
      out[code] = {
        description: val(d, 'Description') || '',
        ...(layer ? { layer } : {}),
        ...(fxlColor(val(d, 'Color')) || layers.get(layer) ? { color: fxlColor(val(d, 'Color')) || layers.get(layer) } : {}),
        ...(kind !== 'PointFeatureDefinition' ? { line: true } : {}),
        ...(kind === 'PolygonFeatureDefinition' ? { closed: true } : {}),
        ...(attrs.length ? { attrs } : {}),
      };
    }
  }
  return { codes: out, layers: [...layers].map(([name, color]) => ({ name, color })) };
}

registerFormat({
  id: 'fxl',
  label: 'Trimble feature library (.fxl): codes, layers, attributes',
  extensions: ['fxl'],
  read: (text, { doc, report, cmd }) => {
    const r = fxlLibrary(text);
    const codes = Object.keys(r.codes);
    if (!codes.length) throw new Error('No feature definitions in that library.');
    doc.featureCodes = { ...(doc.featureCodes || {}), ...r.codes };
    for (const l of r.layers) {
      const t = L.ensureLayer(doc, l.name);
      if (l.color && !t.color) t.color = l.color;
      report.layer(l.name);
    }
    report.add('feature_codes', codes.length);
    if (cmd && S.points(doc).length) cmd('process_codes', {});
    return { codes };
  },
});
