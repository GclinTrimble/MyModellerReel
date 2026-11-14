// Point clouds (#102, #129): PLY (ASCII and binary), LAS 1.2–1.4 (uncompressed) and XYZ / PTS / CSV text, thinned
// to a budget on a voxel grid, and ground classified for a terrain surface. Positions come back in the file's own
// axes (x east, y north, z up) and are put into model axes by the caller.

const DEC = new TextDecoder();

/**
 * Points of a file: { x, y, z: Float64Array, r, g, b: Uint8Array | null, count, format }; LAS adds every attribute
 * (see decodeLasRecords), PLY its other scalar fields by name in extra.
 */
export function parsePointCloud(bytes, name = '') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'e57') throw new Error('.e57 is not read yet: convert it to LAS, LAZ or PLY first (CloudCompare, PDAL).');
  if (ext === 'laz') throw new Error('.laz is compressed: it is read through the conversion worker in the desktop app.');
  const head = DEC.decode(u8.subarray(0, 4));
  if (head === 'LASF') return parseLas(u8);
  if (head.startsWith('ply')) return parsePly(u8);
  return parseText(DEC.decode(u8));
}

function alloc(n, rgb) {
  return { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), r: rgb ? new Uint8Array(n) : null, g: rgb ? new Uint8Array(n) : null, b: rgb ? new Uint8Array(n) : null, count: n };
}

/** A LAS / LAZ header (1.0–1.4): counts, point format, scale, offset, bounds and the VLRs. */
export function lasHeader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const minor = dv.getUint8(25);
  const rawFormat = dv.getUint8(104);
  let count = dv.getUint32(107, true);
  if (minor >= 4 && u8.length >= 255) count = Number(dv.getBigUint64(247, true)) || count;
  const f = (o) => dv.getFloat64(o, true);
  const h = { version: `1.${minor}`, headerSize: dv.getUint16(94, true), offset: dv.getUint32(96, true), format: rawFormat & 0x3f, compressed: (rawFormat & 0xc0) !== 0, recLen: dv.getUint16(105, true), count, scale: [f(131), f(139), f(147)], origin: [f(155), f(163), f(171)], min: [f(187), f(203), f(219)], max: [f(179), f(195), f(211)], vlrs: [] };
  // VLRs: 54-byte headers after the header, up to the point data
  let p = h.headerSize;
  for (let i = 0, n = dv.getUint32(100, true); i < n && p + 54 <= Math.min(u8.length, h.offset); i++) {
    const len = dv.getUint16(p + 20, true);
    h.vlrs.push({ user: DEC.decode(u8.subarray(p + 2, p + 18)).replace(/\0.*$/s, ''), record: dv.getUint16(p + 18, true), at: p + 54, length: len, data: u8.subarray(p + 54, Math.min(u8.length, p + 54 + len)) });
    p += 54 + len;
  }
  return h;
}

// where the colour sits in each point format, and whether it has GPS time
const RGB_AT = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };
const HAS_TIME = (f) => f === 1 || f >= 3;

/** An empty batch of n points with every LAS attribute. */
export function allocPoints(n, { rgb = true, time = true } = {}) {
  const u8 = () => new Uint8Array(n);
  return { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), intensity: new Uint16Array(n), returnNumber: u8(), numberOfReturns: u8(), classification: u8(), classFlags: u8(), userData: u8(), scanAngle: new Float32Array(n), pointSourceId: new Uint16Array(n), gpsTime: time ? new Float64Array(n) : null, r: rgb ? u8() : null, g: rgb ? u8() : null, b: rgb ? u8() : null };
}

/**
 * Decode count LAS point records (any format 0–10) starting at byte at of u8 into a batch: positions in doubles,
 * intensity, returns, classification and its flags (synthetic 1, key point 2, withheld 4, overlap 8), scan angle in
 * degrees, user data, point source, GPS time and colour (8 bits a channel).
 */
export function decodeLasRecords(u8, h, at, count) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const fmt = h.format;
  const rgbAt = RGB_AT[fmt];
  const o = allocPoints(count, { rgb: rgbAt !== undefined, time: HAS_TIME(fmt) });
  const [sx, sy, sz] = h.scale;
  const [ox, oy, oz] = h.origin;
  const ext = fmt >= 6;
  // some writers put 8-bit colour in the 16-bit fields: then keep it as it is
  const shift = rgbAt !== undefined && h.rgb8 ? 0 : 8;
  for (let i = 0; i < count; i++) {
    const p = at + i * h.recLen;
    if (p + h.recLen > u8.length) {
      o.count = i;
      break;
    }
    o.x[i] = dv.getInt32(p, true) * sx + ox;
    o.y[i] = dv.getInt32(p + 4, true) * sy + oy;
    o.z[i] = dv.getInt32(p + 8, true) * sz + oz;
    o.intensity[i] = dv.getUint16(p + 12, true);
    const b14 = u8[p + 14];
    if (ext) {
      o.returnNumber[i] = b14 & 15;
      o.numberOfReturns[i] = b14 >> 4;
      o.classFlags[i] = u8[p + 15] & 15;
      o.classification[i] = u8[p + 16];
      o.userData[i] = u8[p + 17];
      o.scanAngle[i] = dv.getInt16(p + 18, true) * 0.006;
      o.pointSourceId[i] = dv.getUint16(p + 20, true);
      o.gpsTime[i] = dv.getFloat64(p + 22, true);
    } else {
      o.returnNumber[i] = b14 & 7;
      o.numberOfReturns[i] = (b14 >> 3) & 7;
      const c = u8[p + 15];
      o.classification[i] = c & 31;
      o.classFlags[i] = c >> 5;
      o.scanAngle[i] = dv.getInt8(p + 16);
      o.userData[i] = u8[p + 17];
      o.pointSourceId[i] = dv.getUint16(p + 18, true);
      if (o.gpsTime) o.gpsTime[i] = dv.getFloat64(p + 20, true);
    }
    if (rgbAt !== undefined) {
      o.r[i] = dv.getUint16(p + rgbAt, true) >> shift;
      o.g[i] = dv.getUint16(p + rgbAt + 2, true) >> shift;
      o.b[i] = dv.getUint16(p + rgbAt + 4, true) >> shift;
    }
  }
  o.pointSource = o.pointSourceId; // the name the display styles read (#295)
  return o;
}

/** Whether a LAS file's colours are 8-bit values in 16-bit fields (looks at up to 2000 records). */
export function colours8(u8, h, at = h.offset, n = Math.min(h.count, 2000)) {
  const rgbAt = RGB_AT[h.format];
  if (rgbAt === undefined) return false;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = 0; i < n && at + (i + 1) * h.recLen <= u8.length; i++) for (let k = 0; k < 3; k++) if (dv.getUint16(at + i * h.recLen + rgbAt + 2 * k, true) > 255) return false;
  return true;
}

/** An uncompressed LAS file in batches: { start, count } pick a range of points; batch is the points per piece. */
export function* readLasBatches(bytes, { start = 0, count = Infinity, batch = 1 << 20 } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const h = lasHeader(u8);
  if (h.compressed) throw new Error('This LAS is compressed (LAZ): it is read through the conversion worker.');
  h.rgb8 = colours8(u8, h);
  const end = Math.min(h.count, start + count, Math.floor((u8.length - h.offset) / h.recLen));
  for (let i = start; i < end; i += batch) yield decodeLasRecords(u8, h, h.offset + i * h.recLen, Math.min(batch, end - i));
}

function parseLas(u8) {
  const h = lasHeader(u8);
  if (h.compressed) throw new Error('This LAS is compressed (LAZ): it is read through the conversion worker.');
  h.rgb8 = colours8(u8, h);
  const n = Math.min(h.count, Math.max(0, Math.floor((u8.length - h.offset) / h.recLen)));
  return { ...decodeLasRecords(u8, h, h.offset, n), format: 'LAS', header: h };
}

function parsePly(u8) {
  const end = findHeaderEnd(u8);
  const header = DEC.decode(u8.subarray(0, end)).split(/\r?\n/);
  const format = header.find((l) => l.startsWith('format'))?.split(/\s+/)[1];
  let n = 0;
  const props = [];
  let inVertex = false;
  for (const l of header) {
    const w = l.trim().split(/\s+/);
    if (w[0] === 'element') (inVertex = w[1] === 'vertex'), inVertex && (n = +w[2]);
    else if (w[0] === 'property' && inVertex && w[1] !== 'list') props.push({ type: w[1], name: w[2] });
  }
  const idx = (k) => props.findIndex((p) => p.name === k);
  const [ix, iy, iz, ir, ig, ib] = ['x', 'y', 'z', 'red', 'green', 'blue'].map(idx);
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('This PLY has no x, y, z vertex properties.');
  const out = alloc(n, ir >= 0);
  // every other scalar field (intensity, scalar_*, nx…) kept by name
  const others = props.map((p, k) => k).filter((k) => ![ix, iy, iz, ir, ig, ib].includes(k));
  out.extra = Object.fromEntries(others.map((k) => [props[k].name, new Float32Array(n)]));
  if (format === 'ascii') {
    const lines = DEC.decode(u8.subarray(end)).split(/\r?\n/).filter((l) => l.trim());
    for (let i = 0; i < n && i < lines.length; i++) {
      const v = lines[i].trim().split(/\s+/).map(Number);
      out.x[i] = v[ix], out.y[i] = v[iy], out.z[i] = v[iz];
      if (out.r) (out.r[i] = v[ir]), (out.g[i] = v[ig]), (out.b[i] = v[ib]);
      for (const k of others) out.extra[props[k].name][i] = v[k];
    }
  } else {
    const little = format === 'binary_little_endian';
    const SZ = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
    const offs = [];
    let stride = 0;
    for (const p of props) offs.push(stride), (stride += SZ[p.type] || 4);
    const dv = new DataView(u8.buffer, u8.byteOffset + end, u8.byteLength - end);
    const read = (o, t) => (t.startsWith('float') ? (t === 'float64' ? dv.getFloat64(o, little) : dv.getFloat32(o, little)) : t === 'double' ? dv.getFloat64(o, little) : t.includes('char') || t.includes('8') ? (t.startsWith('u') ? dv.getUint8(o) : dv.getInt8(o)) : t.includes('short') || t.includes('16') ? (t.startsWith('u') ? dv.getUint16(o, little) : dv.getInt16(o, little)) : t.startsWith('u') ? dv.getUint32(o, little) : dv.getInt32(o, little));
    for (let i = 0; i < n && (i + 1) * stride <= dv.byteLength; i++) {
      const b = i * stride;
      out.x[i] = read(b + offs[ix], props[ix].type);
      out.y[i] = read(b + offs[iy], props[iy].type);
      out.z[i] = read(b + offs[iz], props[iz].type);
      if (out.r) (out.r[i] = read(b + offs[ir], props[ir].type)), (out.g[i] = read(b + offs[ig], props[ig].type)), (out.b[i] = read(b + offs[ib], props[ib].type));
      for (const k of others) out.extra[props[k].name][i] = read(b + offs[k], props[k].type);
    }
  }
  return { ...out, format: 'PLY' };
}
function findHeaderEnd(u8) {
  const tag = 'end_header';
  for (let i = 0; i < Math.min(u8.length, 65536); i++) {
    let ok = true;
    for (let k = 0; k < tag.length; k++) if (u8[i + k] !== tag.charCodeAt(k)) (ok = false), (k = tag.length);
    if (ok) {
      let j = i + tag.length;
      while (u8[j] === 13 || u8[j] === 10) j++;
      return j;
    }
  }
  throw new Error('A PLY without end_header.');
}

function parseText(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim().split(/[\s,;]+/).map(Number);
    if (v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) rows.push(v);
  }
  if (!rows.length) throw new Error('No x y z rows in that file.');
  // PTS starts with a count line; XYZRGB rows have 6 numbers, PTS rows 7 (intensity before rgb)
  const rgbAt = rows[0].length >= 7 ? 4 : rows[0].length === 6 ? 3 : -1;
  const out = alloc(rows.length, rgbAt >= 0);
  rows.forEach((v, i) => {
    out.x[i] = v[0], out.y[i] = v[1], out.z[i] = v[2];
    if (rgbAt >= 0) (out.r[i] = v[rgbAt]), (out.g[i] = v[rgbAt + 1]), (out.b[i] = v[rgbAt + 2]);
  });
  return { ...out, format: 'XYZ' };
}

/** Keep about max points: one per voxel, the voxel size found by bisection. Returns indices. */
export function thin(pc, max) {
  if (pc.count <= max) return Array.from({ length: pc.count }, (_, i) => i);
  let lo = 0;
  let hi = 0;
  const [mnx, mny, mnz, mxx, mxy, mxz] = bounds(pc);
  hi = Math.max(mxx - mnx, mxy - mny, mxz - mnz) / 2;
  let best = null;
  for (let it = 0; it < 22; it++) {
    const cell = (lo + hi) / 2 || hi;
    const seen = new Map();
    for (let i = 0; i < pc.count; i++) {
      const k = `${Math.floor((pc.x[i] - mnx) / cell)},${Math.floor((pc.y[i] - mny) / cell)},${Math.floor((pc.z[i] - mnz) / cell)}`;
      if (!seen.has(k)) seen.set(k, i);
    }
    if (seen.size > max) lo = cell;
    else (hi = cell), (best = [...seen.values()]);
  }
  return best || [];
}

export function bounds(pc) {
  let [a, b, c, d, e, f] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pc.count; i++) (a = Math.min(a, pc.x[i])), (b = Math.min(b, pc.y[i])), (c = Math.min(c, pc.z[i])), (d = Math.max(d, pc.x[i])), (e = Math.max(e, pc.y[i])), (f = Math.max(f, pc.z[i]));
  return [a, b, c, d, e, f];
}

/**
 * Ground points (#129): the lowest point of each cell, then every point within tolerance (m) of the ground
 * surface interpolated from those, growing with slope. Simple progressive-morphology in one pass: good for open
 * ground, buildings and trees come out. Returns indices of ground points, thinned to one per cell × cell.
 */
export function classifyGround(pc, { cell = 1, tolerance = 0.25, slope = 0.3, window = 20, maxPoints = 50000 } = {}) {
  const [mnx, mny] = bounds(pc);
  const key = (i) => `${Math.floor((pc.x[i] - mnx) / cell)},${Math.floor((pc.y[i] - mny) / cell)}`;
  const low = new Map();
  for (let i = 0; i < pc.count; i++) {
    const k = key(i);
    const j = low.get(k);
    if (j === undefined || pc.z[i] < pc.z[j]) low.set(k, i);
  }
  // a cell's ground is the lowest of its neighbourhood (window wide: wider than any building, whose roof has no ground
  // points under it) plus the slope allowance for the distance
  const ground = new Map();
  const r = Math.max(1, Math.ceil(window / 2 / cell));
  for (const [k, i] of low) {
    const [cx, cy] = k.split(',').map(Number);
    let z = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const j = low.get(`${cx + dx},${cy + dy}`);
      if (j !== undefined) z = Math.min(z, pc.z[j] + slope * cell * Math.hypot(dx, dy));
    }
    ground.set(k, z);
  }
  const keep = new Map();
  for (let i = 0; i < pc.count; i++) {
    const k = key(i);
    if (pc.z[i] - ground.get(k) > tolerance) continue;
    const j = keep.get(k);
    if (j === undefined || pc.z[i] < pc.z[j]) keep.set(k, i);
  }
  // no two points closer than a third of a cell (lowest wins): near neighbours across a cell edge make steep slivers
  const d = cell / 3;
  const near = new Map();
  const out = [];
  for (const i of [...keep.values()].sort((a, b) => pc.z[a] - pc.z[b])) {
    const gx = Math.floor(pc.x[i] / d);
    const gy = Math.floor(pc.y[i] / d);
    let clash = false;
    for (let dx = -1; dx <= 1 && !clash; dx++) for (let dy = -1; dy <= 1 && !clash; dy++) for (const j of near.get(`${gx + dx},${gy + dy}`) || []) if (Math.hypot(pc.x[i] - pc.x[j], pc.y[i] - pc.y[j]) < d) clash = true;
    if (clash) continue;
    out.push(i);
    const k = `${gx},${gy}`;
    near.set(k, [...(near.get(k) || []), i]);
  }
  return out.length > maxPoints ? out.filter((_, n) => n % Math.ceil(out.length / maxPoints) === 0) : out;
}

// ---------------------------------------------------------------- writing (#299): LAS 1.4 and PLY

/**
 * A LAS 1.4 header (375 bytes) with its VLRs: { count, format (6, or 7 with colour), scale [3], offset [3], min, max,
 * byReturn (15 counts), wkt (OGC WKT of the CRS, written as the LASF_Projection 2112 VLR), software }.
 */
export function las14Header({ count, format = 6, scale = [0.001, 0.001, 0.001], offset = [0, 0, 0], min = [0, 0, 0], max = [0, 0, 0], byReturn = [], wkt = '', software = 'MyModellerReel' }) {
  const enc = new TextEncoder();
  const wktBytes = wkt ? enc.encode(wkt + '\0') : null;
  const vlrSize = wktBytes ? 54 + wktBytes.length : 0;
  const u8 = new Uint8Array(375 + vlrSize);
  const dv = new DataView(u8.buffer);
  u8.set(enc.encode('LASF'));
  dv.setUint16(6, wkt ? 16 : 0, true); // global encoding: the CRS is WKT
  u8[24] = 1;
  u8[25] = 4;
  u8.set(enc.encode('OTHER').subarray(0, 32), 26);
  u8.set(enc.encode(software).subarray(0, 31), 58);
  const now = new Date();
  dv.setUint16(90, Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5), true);
  dv.setUint16(92, now.getFullYear(), true);
  dv.setUint16(94, 375, true);
  dv.setUint32(96, 375 + vlrSize, true);
  dv.setUint32(100, wkt ? 1 : 0, true);
  u8[104] = format;
  dv.setUint16(105, format === 7 ? 36 : 30, true);
  dv.setUint32(107, 0, true); // legacy counts stay 0 for formats 6+
  [...scale, ...offset].forEach((v, k) => dv.setFloat64(131 + k * 8, v, true));
  [max[0], min[0], max[1], min[1], max[2], min[2]].forEach((v, k) => dv.setFloat64(179 + k * 8, v, true));
  dv.setBigUint64(247, BigInt(count), true);
  for (let r = 0; r < 15; r++) dv.setBigUint64(255 + r * 8, BigInt(byReturn[r] || 0), true);
  if (wktBytes) {
    u8.set(enc.encode('LASF_Projection'), 375 + 2);
    dv.setUint16(375 + 18, 2112, true);
    dv.setUint16(375 + 20, wktBytes.length, true);
    u8.set(enc.encode('OGC WKT'), 375 + 22);
    u8.set(wktBytes, 375 + 54);
  }
  return u8;
}

/** LAS 1.4 point records (format 6, or 7 with colour) of the points idx of a batch (pointcloud.js batch fields). */
export function las14Records(b, idx, { format = 6, scale = [0.001, 0.001, 0.001], offset = [0, 0, 0] } = {}) {
  const len = format === 7 ? 36 : 30;
  const u8 = new Uint8Array(idx.length * len);
  const dv = new DataView(u8.buffer);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const p = k * len;
    dv.setInt32(p, Math.round((b.x[i] - offset[0]) / scale[0]), true);
    dv.setInt32(p + 4, Math.round((b.y[i] - offset[1]) / scale[1]), true);
    dv.setInt32(p + 8, Math.round((b.z[i] - offset[2]) / scale[2]), true);
    dv.setUint16(p + 12, b.intensity ? b.intensity[i] : 0, true);
    const rn = b.returnNumber ? b.returnNumber[i] || 1 : 1;
    u8[p + 14] = (rn & 15) | (((b.numberOfReturns ? b.numberOfReturns[i] || rn : 1) & 15) << 4);
    u8[p + 15] = b.classFlags ? b.classFlags[i] & 15 : 0;
    u8[p + 16] = b.classification ? b.classification[i] : 1;
    u8[p + 17] = b.userData ? b.userData[i] : 0;
    dv.setInt16(p + 18, b.scanAngle ? Math.round(b.scanAngle[i] / 0.006) : 0, true);
    dv.setUint16(p + 20, b.pointSourceId ? b.pointSourceId[i] : 0, true);
    dv.setFloat64(p + 22, b.gpsTime ? b.gpsTime[i] : 0, true);
    if (format === 7) [b.r, b.g, b.b].forEach((c, ch) => dv.setUint16(p + 30 + 2 * ch, c ? c[i] * 257 : 0, true));
  }
  return u8;
}

/** A binary PLY header for count points (x, y, z doubles; colour; intensity; classification), its count padded so it can be rewritten. */
export function plyHeader(count, { rgb = false } = {}) {
  const lines = ['ply', 'format binary_little_endian 1.0', 'comment MyModellerReel point cloud', `element vertex ${String(count).padEnd(12)}`, 'property double x', 'property double y', 'property double z'];
  if (rgb) lines.push('property uchar red', 'property uchar green', 'property uchar blue');
  lines.push('property ushort intensity', 'property uchar classification', 'end_header', '');
  return new TextEncoder().encode(lines.join('\n'));
}

/** PLY records of the points idx of a batch. */
export function plyRecords(b, idx, { rgb = false } = {}) {
  const len = 24 + (rgb ? 3 : 0) + 3;
  const u8 = new Uint8Array(idx.length * len);
  const dv = new DataView(u8.buffer);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    let p = k * len;
    dv.setFloat64(p, b.x[i], true);
    dv.setFloat64(p + 8, b.y[i], true);
    dv.setFloat64(p + 16, b.z[i], true);
    p += 24;
    if (rgb) (u8[p] = b.r ? b.r[i] : 0), (u8[p + 1] = b.g ? b.g[i] : 0), (u8[p + 2] = b.b ? b.b[i] : 0), (p += 3);
    dv.setUint16(p, b.intensity ? b.intensity[i] : 0, true);
    u8[p + 2] = b.classification ? b.classification[i] : 1;
  }
  return u8;
}

/** A minimal OGC WKT for an EPSG code (name and authority), for the LAS CRS VLR when the source had none. */
export const wktOf = (crs) => (crs?.epsg ? `PROJCS["${String(crs.name || `EPSG:${crs.epsg}`).replace(/"/g, '')}",AUTHORITY["EPSG","${crs.epsg}"]]` : '');
