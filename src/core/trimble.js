// Trimble field formats: JobXML (.jxl, #127) points from the controller, and feature libraries (.fxl, #128).
import * as X from './xml.js';
import * as S from './survey.js';
import * as L from './layers.js';
import { registerFormat } from './formats.js';
import * as FB from './fieldbook.js';
import * as D from './document.js';
import * as Assets from './assets.js';

/** An attribute or a child element, whichever the writer used. */
const val = (el, k) => el?.attrs?.[k] ?? X.kid(el || { children: [] }, k)?.text?.trim();
const num = (el, k) => {
  const v = val(el, k);
  return v === undefined || v === '' ? null : Number(v);
};

registerFormat({
  id: 'jxl',
  label: 'Trimble JobXML (.jxl): points with their field book (setups, observations, heights), codes, attributes, photos',
  standard: FB.STANDARD,
  extensions: ['jxl', 'xml'],
  sniff: (t) => typeof t === 'string' && /<JOBFile[\s>]/.test(t.slice(0, 4000)),
  read: async (text, { doc, report, cmd, opts = {}, io }) => {
    const book = FB.readJobXml(text);
    const rows = FB.bookPoints(book);
    if (!rows.length) throw new Error('No points with grid coordinates in that job.');
    const survey = D.addEntity(doc, { type: 'survey', name: D.uniqueName(doc, book.job.name || 'Survey'), survey: book, material: { color: '#c9a227' } });
    book.points = {};
    const names = new Set(S.points(doc).map((p) => p.name));
    for (const p of rows) {
      let name = p.name;
      while (names.has(name)) name = `${name}-1`;
      if (name !== p.name) report.warn(`Point ${p.name} exists already: brought in as ${name}.`);
      names.add(name);
      const pt = S.addPoint(doc, { ...p, name });
      Object.assign(pt.point, { obs: p.obs, survey: survey.id });
      book.points[p.name] = pt.id;
    }
    report.add('points', rows.length);
    report.add('survey setups', Object.keys(book.setups).length + Object.keys(book.bases).length);
    report.add('observations', book.observations.length);
    if (book.report.kept.length) report.warn(`Kept as computed in the field (not recomputed after edits): ${book.report.kept.join(', ')}.`);
    const crs = book.job.crs?.system ? `${book.job.crs.system}${book.job.crs.zone ? ` / ${book.job.crs.zone}` : ''}` : '';
    if (crs) report.warn(`The job's coordinate system is ${crs}: coordinates are used as they are.`);
    // a model without a coordinate system takes the job's (its projection places web maps under it, #261)
    const g = S.geo(doc);
    if (!g.crs && (crs || book.job.projection)) g.crs = { name: crs || book.job.name, ...(book.job.projection?.type === 'TransverseMercator' ? { projection: book.job.projection } : {}) };
    // photos linked to points (#262): media records pointing at an observation, and Photo attributes
    if (io?.readBinary && opts.path) {
      const dir = String(opts.path).replace(/[\\/][^\\/]*$/, '');
      const obsIds = new Map(book.observations.map((o) => [o.id, o.name]));
      const wanted = [];
      for (const m of book.media) if (m.record && obsIds.has(m.record)) wanted.push({ file: m.file, point: obsIds.get(m.record), m });
      for (const o of book.observations) if (typeof o.attrs?.Photo === 'string' && o.attrs.Photo) wanted.push({ file: o.attrs.Photo.replace(/\\/g, '/'), point: o.name });
      let n = 0;
      for (const w of wanted.slice(0, 500)) {
        try {
          const bytes = await io.readBinary(`${dir}/${w.file}`);
          const asset = Assets.put(bytes, { mime: /\.png$/i.test(w.file) ? 'image/png' : 'image/jpeg', name: w.file.split('/').pop() });
          const item = w.m || { time: '', file: w.file, record: null, kind: 'photo' };
          if (!w.m) book.media.push(item);
          Object.assign(item, { asset, point: w.point });
          n++;
        } catch {
          report.skip(`photo ${w.file}`, 'not found next to the job');
        }
      }
      if (n) report.add('photos', n);
    }
    if (cmd && Object.keys(doc.featureCodes || {}).length) cmd('process_codes', {});
    return { job: book.job.name, survey: survey.id, standard: FB.STANDARD };
  },
});

// OGC InfraGML 1.0 Part 6 Survey (#263): a survey's field book, export only
registerFormat({
  id: 'infragml',
  label: 'OGC InfraGML 1.0 Part 6 Survey (.gml): setups, raw observations, survey results',
  standard: FB.STANDARD,
  extensions: ['gml'],
  write: (doc, { ents }) => {
    const s = ents.find((e) => e.survey) || doc.entities.find((e) => e.survey);
    if (!s) throw new Error('No survey to write: import a Trimble JobXML job first.');
    return FB.toInfraGml(s.survey, { name: s.name, crs: S.geo(doc).crs });
  },
});

/** ARGB hex ("FF8000FF"), ARGB integers, "#rrggbb" or "r,g,b" to "#rrggbb". FE000000 is Trimble's "by layer": undefined. */
export function fxlColor(c) {
  if (c === undefined || c === null || c === '') return undefined;
  const s = String(c).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(s)) return `#${s.slice(3).toLowerCase()}`;
  if (/^[0-9a-f]{8}$/i.test(s) && /[a-f]/i.test(s)) return /^fe/i.test(s) ? undefined : `#${s.slice(2).toLowerCase()}`;
  if (/^\d+,\s*\d+,\s*\d+/.test(s)) return `#${s.split(',').slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('')}`;
  if (/^-?\d+$/.test(s)) return `#${((+s >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
  return undefined;
}

const FXL_ATTR = { TextAttribute: 'text', StringAttribute: 'text', IntegerAttribute: 'number', DoubleAttribute: 'number', RealAttribute: 'number', ListAttribute: 'list', DateAttribute: 'text', TimeAttribute: 'text', FileAttribute: 'text', PhotoAttribute: 'text' };
/** Trimble attribute types our three types do not say (kept so an FXL written back keeps them). */
const FXL_KIND = { IntegerAttribute: 'integer', DateAttribute: 'date', TimeAttribute: 'time', FileAttribute: 'file', PhotoAttribute: 'photo' };
export const FEATURE_TYPES = ['point', 'line', 'polygon'];
const local = (n) => n.slice(n.indexOf(':') + 1);
const finite = (v) => (v !== undefined && v !== '' && Math.abs(+v) < 1e300 ? +v : undefined);

function fxlAttr(a) {
  const tag = local(a.name);
  const items = X.all(a, 'Item').map((i) => i.text.trim() || i.attrs.Value).filter(Boolean);
  const req = val(a, 'Required') === 'true' || /^required$/i.test(val(a, 'EntryRequirement') || val(a, 'EntryMethod') || '');
  const def = val(a, 'DefaultValue') ?? (val(a, 'DefaultItemIndex') !== undefined ? items[+val(a, 'DefaultItemIndex')] : undefined);
  const out = { name: val(a, 'Name'), type: FXL_ATTR[tag] };
  if (FXL_KIND[tag]) out.kind = FXL_KIND[tag];
  if (items.length) out.options = items;
  if (req) out.required = true;
  if (val(a, 'Description')) out.description = val(a, 'Description');
  if (def !== undefined && def !== '') out.default = out.type === 'number' ? +def : def;
  if (finite(val(a, 'MinimumValue')) !== undefined) out.min = finite(val(a, 'MinimumValue'));
  if (finite(val(a, 'MaximumValue')) !== undefined) out.max = finite(val(a, 'MaximumValue'));
  if (val(a, 'NumberOfDecimals')) out.decimals = +val(a, 'NumberOfDecimals');
  return out;
}

/**
 * Feature definitions of an FXL (Trimble Feature Definition Manager: schema 9 <FeatureCodingDefinitions>, or the older
 * <FeatureDefinitionLibrary>) to our feature library { CODE: { description, type, category, layer, color, lineStyle,
 * line, closed, attrs } }, with its layers.
 */
export function fxlLibrary(text) {
  const root = X.parse(text);
  const lib = ['FeatureCodingDefinitions', 'FeatureDefinitionLibrary'].map((n) => X.kid(root, n) || X.all(root, n)[0]).find(Boolean);
  if (!lib) throw new Error('Not a Trimble feature library (no <FeatureCodingDefinitions>).');
  // shortcut: white layers are CAD's "foreground" colour (black on paper), so they are left uncoloured and codes get their own
  const layerColor = (c) => (fxlColor(c) === '#ffffff' ? undefined : fxlColor(c));
  const layers = new Map([...X.all(lib, 'LayerDefinition'), ...X.all(lib, 'Layer')].map((l) => [val(l, 'Name'), { color: layerColor(val(l, 'Color')), lineStyle: val(l, 'LineStyleName') }]));
  const out = {};
  for (const type of FEATURE_TYPES) {
    for (const d of X.all(lib, `${type[0].toUpperCase()}${type.slice(1)}FeatureDefinition`)) {
      const code = (val(d, 'Code') || val(d, 'Name') || '').trim().toUpperCase();
      if (!code) continue;
      const layer = val(d, 'Layer') || undefined;
      const attrsEl = X.kid(d, 'Attributes'); // only these: <Symbols> carry ListAttribute values too
      const attrs = attrsEl ? attrsEl.children.filter((a) => FXL_ATTR[local(a.name)] && val(a, 'Name')).map(fxlAttr) : [];
      const color = fxlColor(val(d, 'Color') ?? val(d, 'BorderColor')) || layers.get(layer)?.color;
      const lineStyle = val(d, 'LineStyleName') || val(d, 'BorderLineStyleName');
      out[code] = {
        description: val(d, 'Description') || (val(d, 'Code') ? val(d, 'Name') : '') || '',
        type,
        ...(val(d, 'Category') ? { category: val(d, 'Category') } : {}),
        ...(layer ? { layer } : {}),
        ...(color ? { color } : {}),
        ...(type !== 'point' && lineStyle ? { lineStyle } : {}),
        ...(type !== 'point' ? { line: true } : {}),
        ...(type === 'polygon' ? { closed: true } : {}),
        ...(attrs.length ? { attrs } : {}),
      };
    }
  }
  return { codes: out, layers: [...layers].map(([name, l]) => ({ name, ...(l.color ? { color: l.color } : {}), ...(l.lineStyle ? { lineStyle: l.lineStyle } : {}) })) };
}

/** point, line or polygon of a code definition (older libraries only say line / closed). */
export const featureType = (d) => (FEATURE_TYPES.includes(d?.type) ? d.type : d?.closed ? 'polygon' : d?.line ? 'line' : 'point');

/** A feature library as an FXL (schema 9, what Trimble Access and Feature Definition Manager read). */
export function fxlWrite({ codes = {}, layers = [] }) {
  const argb = (c) => (fxlColor(c) ? `FF${fxlColor(c).slice(1).toUpperCase()}` : 'FE000000');
  const named = new Map(layers.map((l) => [l.name, l]));
  for (const d of Object.values(codes)) if (d.layer && !named.has(d.layer)) named.set(d.layer, { name: d.layer });
  const TAG = { text: 'TextAttribute', number: 'DoubleAttribute', list: 'ListAttribute', integer: 'IntegerAttribute', date: 'DateAttribute', time: 'TimeAttribute', file: 'FileAttribute', photo: 'PhotoAttribute' };
  const attr = (a) =>
    X.el(
      TAG[a.kind] || TAG[a.type] || 'TextAttribute',
      { Name: a.name, Description: a.description, EntryMethod: a.required ? 'Required' : 'Optional', ...(a.type === 'list' ? { DefaultItemIndex: a.default !== undefined ? Math.max(0, (a.options || []).indexOf(a.default)) : undefined } : { DefaultValue: a.default }), MinimumValue: a.min, MaximumValue: a.max, NumberOfDecimals: a.decimals },
      a.type === 'list' ? [X.el('ListItems', {}, (a.options || []).map((o) => X.el('Item', {}, o)))] : [],
    );
  const feature = ([code, d]) => {
    const type = featureType(d);
    const a = { Code: code, Name: d.description || code, Category: d.category, IncludeInSurface: 'true', Layer: d.layer };
    if (type === 'polygon') Object.assign(a, { FillColor: argb(d.color), FillTransparency: 50, BorderColor: argb(d.color), BorderLineStyleName: d.lineStyle || 'Solid' });
    else Object.assign(a, { Color: argb(d.color) }, type === 'line' ? { LineStyleName: d.lineStyle || 'Solid' } : {});
    return X.el(`${type[0].toUpperCase()}${type.slice(1)}FeatureDefinition`, a, d.attrs?.length ? [X.el('Attributes', {}, d.attrs.map(attr))] : []);
  };
  const layerEl = (l) => X.el('LayerDefinition', {}, [X.el('Name', {}, l.name), X.el('Color', {}, l.color ? argb(l.color) : 'FFFFFFFF'), X.el('LineStyleName', {}, l.lineStyle || 'Solid')]);
  const root = X.el('FeatureCodingDefinitions', { SchemaVersion: 9, xmlns: 'http://trimble.com/schema/fxl' }, [X.el('LayerDefinitions', {}, [...named.values()].map(layerEl)), X.el('FeatureDefinitions', {}, Object.entries(codes).map(feature))]);
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n${X.write(root)}\n`;
}

/** A feature library as CSV: one row per code; attributes as "Name:type[option|option]*" (* required). */
export function featureCsv(codes = {}) {
  const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const attrs = (d) => (d.attrs || []).map((a) => `${a.name}:${a.kind || a.type}${a.options ? `[${a.options.join('|')}]` : ''}${a.required ? '*' : ''}`).join('; ');
  const rows = Object.entries(codes).map(([c, d]) => [c, d.description, featureType(d), d.category, d.layer, d.color, d.lineStyle, attrs(d)].map(q).join(','));
  return `${['code,description,type,category,layer,color,line_style,attributes', ...rows].join('\n')}\n`;
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
