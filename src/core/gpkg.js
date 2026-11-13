// OGC GeoPackage 1.4 (12-128r19) features (#268): write GeoJSON-like features to a .gpkg and read them back. SQLite comes
// in from the caller (node:sqlite's DatabaseSync in the main process and in tests), so this module stays pure.
// shortcut: feature tables only; cached map tiles stay in the app's disk cache, not in gpkg tile tables.

const TYPES = { Point: 1, LineString: 2, Polygon: 3, MultiPoint: 4, MultiLineString: 5, MultiPolygon: 6, GeometryCollection: 7 };
const NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));

/** ISO WKB (little endian) of a GeoJSON geometry; 3D when any position has a height. */
export function toWkb(g) {
  const pos = (c) => (typeof c[0] === 'number' ? [c] : c.flatMap(pos));
  const hasZ = g.type === 'GeometryCollection' ? false : pos(g.coordinates).some((p) => p.length > 2);
  const out = [];
  const u8 = (v) => out.push(Uint8Array.of(v));
  const u32 = (v) => out.push(new Uint8Array(new Uint32Array([v]).buffer));
  const f64 = (...v) => out.push(new Uint8Array(new Float64Array(v).buffer));
  const pt = (p) => f64(p[0], p[1], ...(hasZ ? [p[2] ?? 0] : []));
  const write = (geom) => {
    u8(1);
    u32(TYPES[geom.type] + (hasZ ? 1000 : 0));
    const c = geom.coordinates;
    if (geom.type === 'Point') pt(c);
    else if (geom.type === 'LineString') u32(c.length), c.forEach(pt);
    else if (geom.type === 'Polygon') u32(c.length), c.forEach((r) => (u32(r.length), r.forEach(pt)));
    else if (geom.type === 'GeometryCollection') u32(geom.geometries.length), geom.geometries.forEach(write);
    else {
      const part = { MultiPoint: 'Point', MultiLineString: 'LineString', MultiPolygon: 'Polygon' }[geom.type];
      u32(c.length);
      c.forEach((x) => write({ type: part, coordinates: x }));
    }
  };
  write(g);
  const n = out.reduce((a, b) => a + b.length, 0);
  const buf = new Uint8Array(n);
  let o = 0;
  for (const b of out) buf.set(b, o), (o += b.length);
  return buf;
}

/** GeoJSON geometry from WKB (either byte order, ISO or EWKB-style Z flags). */
export function fromWkb(bytes, start = 0) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = start;
  const read = () => {
    const le = v.getUint8(o) === 1;
    o += 1;
    let t = v.getUint32(o, le);
    o += 4;
    const z = t > 1000 && t < 2000 ? (t -= 1000, true) : t & 0x80000000 ? ((t &= 0xffff), true) : false;
    const pt = () => {
      const p = [v.getFloat64(o, le), v.getFloat64(o + 8, le)];
      o += 16;
      if (z) p.push(v.getFloat64(o, le)), (o += 8);
      return p;
    };
    const n = () => {
      const k = v.getUint32(o, le);
      o += 4;
      return k;
    };
    const type = NAMES[t];
    if (type === 'Point') return { type, coordinates: pt() };
    if (type === 'LineString') return { type, coordinates: Array.from({ length: n() }, pt) };
    if (type === 'Polygon') return { type, coordinates: Array.from({ length: n() }, () => Array.from({ length: n() }, pt)) };
    if (type === 'GeometryCollection') return { type, geometries: Array.from({ length: n() }, read) };
    if (!type) throw new Error(`WKB geometry type ${t} is not read here.`);
    return { type, coordinates: Array.from({ length: n() }, () => read().coordinates) };
  };
  return read();
}

/** A GeoPackage geometry blob: "GP" header, SRS id, an XY envelope, then WKB. */
export function toGpkgBlob(g, srsId) {
  const wkb = toWkb(g);
  const pos = (c) => (typeof c[0] === 'number' ? [c] : c.flatMap(pos));
  const ps = g.type === 'GeometryCollection' ? g.geometries.flatMap((x) => pos(x.coordinates)) : pos(g.coordinates);
  const env = [Math.min(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[1]))];
  const head = new Uint8Array(8 + 32);
  const dv = new DataView(head.buffer);
  head.set([0x47, 0x50, 0, 0b0000_0011]); // magic, version 0, flags: little endian + XY envelope
  dv.setInt32(4, srsId, true);
  env.forEach((x, i) => dv.setFloat64(8 + i * 8, x, true));
  const out = new Uint8Array(head.length + wkb.length);
  out.set(head);
  out.set(wkb, head.length);
  return out;
}
export function fromGpkgBlob(b) {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (bytes[0] !== 0x47 || bytes[1] !== 0x50) throw new Error('Not a GeoPackage geometry.');
  const flags = bytes[3];
  const envBytes = [0, 32, 48, 48, 64][(flags >> 1) & 7] ?? 0;
  return fromWkb(bytes, 8 + envBytes);
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
const colType = (vals) => (vals.every((x) => x === null || x === undefined || typeof x === 'number') ? (vals.every((x) => x == null || Number.isInteger(x)) ? 'INTEGER' : 'REAL') : 'TEXT');

/**
 * Write features to a GeoPackage: { table, srs: { epsg, name, definition }, features: [{ geometry, properties }] }.
 * Several layers: pass layers: [{ table, features }]. Returns { path, tables, features }.
 */
export function writeGpkg(DatabaseSync, file, { table = 'features', srs = {}, features = [], layers = null, description = '' }) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA application_id = 1196444487; PRAGMA user_version = 10400;');
    db.exec(`CREATE TABLE IF NOT EXISTS gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
      CREATE TABLE IF NOT EXISTS gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE IF NOT EXISTS gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));`);
    const srsRow = db.prepare('INSERT OR IGNORE INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)');
    srsRow.run('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system');
    srsRow.run('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system');
    srsRow.run('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]', 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid');
    const srsId = srs.epsg ? +srs.epsg : -1;
    if (srs.epsg) srsRow.run(srs.name || `EPSG:${srs.epsg}`, srsId, 'EPSG', srsId, srs.definition || 'undefined', srs.name || '');
    const list = layers || [{ table, features }];
    let count = 0;
    for (const L of list) {
      const feats = L.features.filter((f) => f.geometry);
      const keys = [...new Set(feats.flatMap((f) => Object.keys(f.properties || {})))].filter((k) => !/^(fid|geom)$/i.test(k));
      const types = Object.fromEntries(keys.map((k) => [k, colType(feats.map((f) => f.properties?.[k]))]));
      const kinds = [...new Set(feats.map((f) => f.geometry.type))];
      const gtype = kinds.length === 1 ? kinds[0].toUpperCase() : 'GEOMETRY';
      const hasZ = feats.some((f) => JSON.stringify(f.geometry).match(/\[-?[\d.e+-]+,-?[\d.e+-]+,-?[\d.e+-]+\]/));
      db.exec(`DROP TABLE IF EXISTS ${ident(L.table)}; DELETE FROM gpkg_contents WHERE table_name = '${L.table.replace(/'/g, "''")}'; DELETE FROM gpkg_geometry_columns WHERE table_name = '${L.table.replace(/'/g, "''")}';`);
      db.exec(`CREATE TABLE ${ident(L.table)} (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom ${gtype}${keys.map((k) => `, ${ident(k)} ${types[k]}`).join('')})`);
      const ins = db.prepare(`INSERT INTO ${ident(L.table)} (geom${keys.map((k) => `, ${ident(k)}`).join('')}) VALUES (?${keys.map(() => ', ?').join('')})`);
      let env = [Infinity, Infinity, -Infinity, -Infinity];
      for (const f of feats) {
        const blob = toGpkgBlob(f.geometry, srsId);
        const dv = new DataView(blob.buffer);
        const [x0, x1, y0, y1] = [0, 1, 2, 3].map((i) => dv.getFloat64(8 + i * 8, true));
        env = [Math.min(env[0], x0), Math.min(env[1], y0), Math.max(env[2], x1), Math.max(env[3], y1)];
        ins.run(blob, ...keys.map((k) => {
          const x = f.properties?.[k];
          return x === undefined || x === null ? null : types[k] === 'TEXT' ? (typeof x === 'object' ? JSON.stringify(x) : String(x)) : x;
        }));
        count++;
      }
      db.prepare('INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(L.table, 'features', L.table, description, ...(feats.length ? env : [null, null, null, null]), srsId);
      db.prepare('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, ?, ?)').run(L.table, 'geom', gtype, srsId, hasZ ? 1 : 0, 0);
    }
    return { path: file, tables: list.map((L) => L.table), features: count, standard: 'OGC GeoPackage 1.4 (12-128r19)' };
  } finally {
    db.close();
  }
}

/** Every feature table of a GeoPackage: { tables: [{ table, epsg, features: [{ geometry, properties }] }] }. */
export function readGpkg(DatabaseSync, file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare("SELECT c.table_name, c.srs_id, g.column_name, s.organization, s.organization_coordsys_id FROM gpkg_contents c JOIN gpkg_geometry_columns g ON g.table_name = c.table_name LEFT JOIN gpkg_spatial_ref_sys s ON s.srs_id = c.srs_id WHERE c.data_type = 'features'").all();
    return {
      tables: tables.map((t) => ({
        table: t.table_name,
        epsg: /epsg/i.test(t.organization || '') ? t.organization_coordsys_id : null,
        features: db
          .prepare(`SELECT * FROM ${ident(t.table_name)}`)
          .all()
          .map((row) => {
            const { [t.column_name]: g, fid, ...props } = row;
            return { geometry: g ? fromGpkgBlob(g) : null, properties: props };
          }),
      })),
    };
  } finally {
    db.close();
  }
}
