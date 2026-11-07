// GIS exchange (#157): GeoJSON and Shapefile, points, lines and polygons with their attributes, in project
// coordinates (E, N, Z) around the base point. No reprojection: a file in another CRS is flagged, not converted.
import * as D from './document.js';
import * as S from './survey.js';
import * as L from './layers.js';
import { addCurve } from './landxml.js';
import { registerFormat } from './formats.js';

/** The first coordinate of a feature (points hold a list of positions, lines and polygons a list of rings). */
const firstCoord = (f) => (f.kind === 'point' ? f.coords[0] : f.coords[0]?.[0]);

/** Bring features in: points become survey points, lines and polygon rings become curves; properties travel along. */
function addFeatures(doc, feats, report, { layer } = {}) {
  const g = S.geo(doc);
  const first = feats.map(firstCoord).find(Boolean);
  if (!g.base && first) g.base = [Math.round(first[0] / 100) * 100, Math.round(first[1] / 100) * 100, Math.round(first[2] || 0)];
  const names = new Set(S.points(doc).map((p) => p.name));
  for (const f of feats) {
    const props = f.props || {};
    const lay = layer || props.layer || props.LAYER || f.layer || 'GIS';
    L.ensureLayer(doc, lay);
    report.layer(lay);
    const meta = Object.fromEntries(Object.entries(props).filter(([k, v]) => !['layer', 'LAYER'].includes(k) && v !== null && typeof v !== 'object'));
    if (f.kind === 'point') {
      for (const c of f.coords) {
        let name = String(props.name ?? props.NAME ?? props.id ?? props.number ?? S.nextPointName(doc));
        while (names.has(name)) name = `${name}-1`;
        names.add(name);
        const p = S.addPoint(doc, { name, e: c[0], n: c[1], z: c[2] ?? props.z ?? props.elevation ?? 0, code: props.code ?? props.CODE ?? '', desc: props.desc ?? props.description ?? '', attrs: meta });
        p.tag = lay;
        report.add('points');
      }
    } else {
      for (const ring of f.coords) {
        let pts = ring.map((c) => S.toLocal(doc, { e: c[0], n: c[1], z: c[2] ?? 0 }));
        const closed = f.kind === 'polygon';
        if (closed && pts.length > 2 && pts[0].every((x, k) => Math.abs(x - pts.at(-1)[k]) < 1e-9)) pts = pts.slice(0, -1);
        if (pts.length < 2) {
          report.skip(f.kind, 'fewer than 2 points');
          continue;
        }
        addCurve(doc, pts, { name: D.uniqueName(doc, String(props.name ?? props.NAME ?? lay)), tag: lay, closed, byLayer: true, ...(Object.keys(meta).length ? { meta } : {}) });
        report.add(closed ? 'polygons' : 'lines');
      }
    }
  }
}

/** What the model can say as GIS features: survey points, curves and linework, with their data. */
function featuresOf(doc, ents) {
  const proj = (w) => {
    const p = S.toProject(doc, w);
    return [p.e, p.n, p.z];
  };
  const out = [];
  for (const e of ents) {
    if (S.isPoint(e)) out.push({ kind: 'point', coords: [proj(D.worldMatrix(doc, e).elements.slice(12, 15))], props: { name: e.name, code: e.point.code, desc: e.point.desc, layer: e.tag, ...(e.point.attrs || {}) } });
    else if (e.curve || S.isLinework(e)) {
      const closed = e.curve ? !!e.curve.closed : !!e.line.closed;
      let pts = (e.curve ? D.curvePoints(doc, e) : S.lineworkPath(doc, e)).map(proj);
      if (closed && pts.length > 1 && pts[0].every((x, k) => Math.abs(x - pts.at(-1)[k]) < 1e-9)) pts = pts.slice(0, -1);
      out.push({ kind: closed ? 'polygon' : 'line', coords: [pts], props: { name: e.name, layer: e.tag, ...(e.meta || {}) } });
    }
  }
  return out;
}

// ---------------------------------------------------------------- GeoJSON
export function readGeoJson(text, { doc, report, opts = {} }) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  const list = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', geometry: j, properties: {} }];
  const crs = j.crs?.properties?.name;
  if (crs) report.warn(`The file says its CRS is ${crs}: coordinates are used as they are (no reprojection).`);
  const feats = [];
  const take = (geom, props) => {
    if (!geom) return report.skip('feature', 'no geometry');
    const t = geom.type;
    if (t === 'Point') feats.push({ kind: 'point', coords: [geom.coordinates], props });
    else if (t === 'MultiPoint') feats.push({ kind: 'point', coords: geom.coordinates, props });
    else if (t === 'LineString') feats.push({ kind: 'line', coords: [geom.coordinates], props });
    else if (t === 'MultiLineString') feats.push({ kind: 'line', coords: geom.coordinates, props });
    else if (t === 'Polygon') feats.push({ kind: 'polygon', coords: geom.coordinates, props });
    else if (t === 'MultiPolygon') feats.push({ kind: 'polygon', coords: geom.coordinates.flat(), props });
    else if (t === 'GeometryCollection') for (const g of geom.geometries) take(g, props);
    else report.skip(t, 'not a geometry type read here');
  };
  for (const f of list) take(f.geometry, f.properties || {});
  const c0 = feats.map(firstCoord).find(Boolean);
  if (c0 && Math.abs(c0[0]) <= 180 && Math.abs(c0[1]) <= 90 && !opts.force) report.warn('These look like longitude / latitude degrees: the app works in projected metres (E, N). Reproject the file first.');
  addFeatures(doc, feats, report, opts);
}

export function writeGeoJson(doc, { ents }) {
  const fc = {
    type: 'FeatureCollection',
    ...(S.geo(doc).crs?.epsg ? { crs: { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${S.geo(doc).crs.epsg}` } } } : {}),
    features: featuresOf(doc, ents).map((f) => ({
      type: 'Feature',
      properties: f.props,
      geometry: f.kind === 'point' ? { type: 'Point', coordinates: f.coords[0].map(r6) } : f.kind === 'line' ? { type: 'LineString', coordinates: f.coords[0].map((c) => c.map(r6)) } : { type: 'Polygon', coordinates: [[...f.coords[0], f.coords[0][0]].map((c) => c.map(r6))] },
    })),
  };
  return JSON.stringify(fc, null, 1);
}
const r6 = (x) => Math.round(x * 1e6) / 1e6;

registerFormat({ id: 'geojson', label: 'GeoJSON (points, lines, polygons with properties)', extensions: ['geojson', 'json'], sniff: (t) => typeof t === 'string' && /"type"\s*:\s*"(FeatureCollection|Feature|Point|LineString|Polygon)/.test(t.slice(0, 2000)), read: readGeoJson, write: writeGeoJson });

// ---------------------------------------------------------------- Shapefile (.shp + .shx + .dbf)
/** Read a .shp and its .dbf (bytes) to features. */
export function readShapefile(shp, dbf = null) {
  const v = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (v.getInt32(0, false) !== 9994) throw new Error('Not a shapefile (.shp).');
  const rows = dbf ? readDbf(dbf) : [];
  const feats = [];
  let o = 100;
  let i = 0;
  while (o + 8 <= shp.byteLength) {
    const len = v.getInt32(o + 4, false) * 2;
    const c = o + 8;
    const type = v.getInt32(c, true);
    const props = rows[i++] || {};
    const hasZ = [11, 13, 15, 18].includes(type);
    if (type === 1 || type === 11 || type === 21) feats.push({ kind: 'point', coords: [[v.getFloat64(c + 4, true), v.getFloat64(c + 12, true), ...(type === 11 ? [v.getFloat64(c + 20, true)] : [])]], props });
    else if ([3, 5, 13, 15, 23, 25].includes(type)) {
      const np = v.getInt32(c + 36, true);
      const n = v.getInt32(c + 40, true);
      const parts = Array.from({ length: np }, (_, k) => v.getInt32(c + 44 + k * 4, true));
      const pb = c + 44 + np * 4;
      const zb = pb + n * 16 + 16;
      const pts = Array.from({ length: n }, (_, k) => [v.getFloat64(pb + k * 16, true), v.getFloat64(pb + k * 16 + 8, true), ...(hasZ ? [v.getFloat64(zb + k * 8, true)] : [])]);
      feats.push({ kind: type === 5 || type === 15 || type === 25 ? 'polygon' : 'line', coords: parts.map((s, k) => pts.slice(s, k + 1 < np ? parts[k + 1] : n)), props });
    } else if (type === 8 || type === 18) {
      const n = v.getInt32(c + 36, true);
      const zb = c + 40 + n * 16 + 16;
      feats.push({ kind: 'point', coords: Array.from({ length: n }, (_, k) => [v.getFloat64(c + 40 + k * 16, true), v.getFloat64(c + 48 + k * 16, true), ...(type === 18 ? [v.getFloat64(zb + k * 8, true)] : [])]), props });
    }
    o = c + len;
  }
  return feats;
}

export function readDbf(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(4, true);
  const headLen = v.getUint16(8, true);
  const recLen = v.getUint16(10, true);
  const fields = [];
  const dec = new TextDecoder('latin1');
  for (let o = 32; b[o] !== 0x0d && o < headLen; o += 32) fields.push({ name: dec.decode(b.subarray(o, o + 11)).replace(/\0.*$/, ''), type: String.fromCharCode(b[o + 11]), len: b[o + 16] });
  const out = [];
  for (let r = 0; r < n; r++) {
    let o = headLen + r * recLen + 1;
    const row = {};
    for (const f of fields) {
      const s = dec.decode(b.subarray(o, o + f.len)).trim();
      row[f.name] = f.type === 'N' || f.type === 'F' ? (s === '' ? null : Number(s)) : f.type === 'L' ? /^[YyTt]/.test(s) : s;
      o += f.len;
    }
    out.push(row);
  }
  return out;
}

/** Write features of one kind as .shp, .shx and .dbf bytes (Z types: PointZ, PolyLineZ, PolygonZ). */
export function writeShapefile(feats, kind) {
  const type = kind === 'point' ? 11 : kind === 'line' ? 13 : 15;
  const recs = feats.map((f) => {
    if (kind === 'point') {
      const [x, y, z = 0] = f.coords[0];
      const b = new DataView(new ArrayBuffer(36));
      b.setInt32(0, 11, true);
      b.setFloat64(4, x, true);
      b.setFloat64(12, y, true);
      b.setFloat64(20, z, true);
      b.setFloat64(28, 0, true);
      return { buf: b.buffer, pts: [[x, y, z]] };
    }
    // rings close on themselves; shapefile polygons run clockwise
    const parts = f.coords.map((r) => {
      let p = r.map((c) => [c[0], c[1], c[2] ?? 0]);
      if (kind === 'polygon') {
        if (p.reduce((s, q, i) => s + (p[(i + 1) % p.length][0] - q[0]) * (p[(i + 1) % p.length][1] + q[1]), 0) < 0) p = p.reverse();
        p = [...p, p[0]];
      }
      return p;
    });
    const pts = parts.flat();
    const np = parts.length;
    const n = pts.length;
    const size = 44 + np * 4 + n * 16 + 16 + n * 8 + 16 + n * 8;
    const b = new DataView(new ArrayBuffer(size));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const zs = pts.map((p) => p[2]);
    b.setInt32(0, type, true);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((x, k) => b.setFloat64(4 + k * 8, x, true));
    b.setInt32(36, np, true);
    b.setInt32(40, n, true);
    let s = 0;
    parts.forEach((p, k) => (b.setInt32(44 + k * 4, s, true), (s += p.length)));
    let o = 44 + np * 4;
    for (const p of pts) b.setFloat64(o, p[0], true), b.setFloat64(o + 8, p[1], true), (o += 16);
    b.setFloat64(o, Math.min(...zs), true);
    b.setFloat64(o + 8, Math.max(...zs), true);
    o += 16;
    for (const p of pts) b.setFloat64(o, p[2], true), (o += 8);
    b.setFloat64(o, 0, true);
    b.setFloat64(o + 8, 0, true);
    return { buf: b.buffer, pts };
  });
  const all = recs.flatMap((r) => r.pts);
  const box = all.length ? [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])), Math.min(...all.map((p) => p[2])), Math.max(...all.map((p) => p[2]))] : [0, 0, 0, 0, 0, 0];
  const header = (bytes) => {
    const h = new DataView(new ArrayBuffer(100));
    h.setInt32(0, 9994, false);
    h.setInt32(24, bytes / 2, false);
    h.setInt32(28, 1000, true);
    h.setInt32(32, type, true);
    [box[0], box[1], box[2], box[3], box[4], box[5], 0, 0].forEach((x, k) => h.setFloat64(36 + k * 8, x, true));
    return new Uint8Array(h.buffer);
  };
  const shpLen = 100 + recs.reduce((s, r) => s + 8 + r.buf.byteLength, 0);
  const shp = new Uint8Array(shpLen);
  const shx = new Uint8Array(100 + recs.length * 8);
  shp.set(header(shpLen));
  shx.set(header(shx.length));
  const sv = new DataView(shp.buffer);
  const xv = new DataView(shx.buffer);
  let o = 100;
  recs.forEach((r, i) => {
    xv.setInt32(100 + i * 8, o / 2, false);
    xv.setInt32(104 + i * 8, r.buf.byteLength / 2, false);
    sv.setInt32(o, i + 1, false);
    sv.setInt32(o + 4, r.buf.byteLength / 2, false);
    shp.set(new Uint8Array(r.buf), o + 8);
    o += 8 + r.buf.byteLength;
  });
  return { shp, shx, dbf: writeDbf(feats.map((f) => f.props || {})) };
}

export function writeDbf(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => rows.some((r) => r[k] !== undefined && r[k] !== null && typeof r[k] !== 'object'));
  const names = new Set();
  const fields = keys.map((k) => {
    let n = k.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'F';
    for (let i = 1; names.has(n); i++) n = `${n.slice(0, 8)}${i}`;
    names.add(n);
    const numeric = rows.every((r) => r[k] === undefined || r[k] === null || typeof r[k] === 'number');
    return { key: k, name: n, type: numeric ? 'N' : 'C', len: numeric ? 18 : Math.min(254, Math.max(1, ...rows.map((r) => String(r[k] ?? '').length))), dec: numeric ? 6 : 0 };
  });
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0);
  const headLen = 32 + fields.length * 32 + 1;
  const b = new Uint8Array(headLen + rows.length * recLen + 1);
  const v = new DataView(b.buffer);
  b[0] = 3;
  const d = new Date();
  b[1] = d.getFullYear() - 1900;
  b[2] = d.getMonth() + 1;
  b[3] = d.getDate();
  v.setUint32(4, rows.length, true);
  v.setUint16(8, headLen, true);
  v.setUint16(10, recLen, true);
  const enc = (s) => [...String(s)].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    b.set(enc(f.name).slice(0, 10), o);
    b[o + 11] = f.type.charCodeAt(0);
    b[o + 16] = f.len;
    b[o + 17] = f.dec;
  });
  b[headLen - 1] = 0x0d;
  rows.forEach((r, i) => {
    let o = headLen + i * recLen;
    b[o++] = 0x20;
    for (const f of fields) {
      const x = r[f.key];
      const s = x === undefined || x === null ? '' : f.type === 'N' ? Number(x).toFixed(f.dec).padStart(f.len).slice(-f.len) : String(x).slice(0, f.len).padEnd(f.len);
      b.set(enc(s.padEnd(f.len)), o);
      o += f.len;
    }
  });
  b[b.length - 1] = 0x1a;
  return b;
}

registerFormat({
  id: 'shp',
  label: 'Shapefile (.shp + .dbf): points, lines, polygons with attributes',
  extensions: ['shp'],
  binary: true,
  read: async (bytes, { doc, report, opts, io }) => {
    let dbf = null;
    if (opts.path && io?.readBinary) dbf = await io.readBinary(opts.path.replace(/\.shp$/i, '.dbf')).then((b) => new Uint8Array(b)).catch(() => null);
    if (!dbf) report.warn('No .dbf next to the .shp: shapes come in without their attributes.');
    addFeatures(doc, readShapefile(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dbf), report, { ...opts, layer: opts.layer || (opts.path ? String(opts.path).split(/[\\/]/).pop().replace(/\.shp$/i, '') : undefined) });
  },
  /** One set of files per geometry kind: name_points.shp, name_lines.shp, name_polygons.shp. */
  writeFiles: (doc, { ents }) => {
    const feats = featuresOf(doc, ents);
    const out = {};
    for (const kind of ['point', 'line', 'polygon']) {
      const fs = feats.filter((f) => f.kind === kind);
      if (!fs.length) continue;
      const w = writeShapefile(fs, kind);
      for (const ext of ['shp', 'shx', 'dbf']) out[`_${kind}s.${ext}`] = w[ext];
    }
    return out;
  },
});
