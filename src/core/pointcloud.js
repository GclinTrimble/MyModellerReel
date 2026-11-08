// Point clouds (#102, #129): PLY (ASCII and binary), LAS 1.2–1.4 (uncompressed) and XYZ / PTS / CSV text, thinned
// to a budget on a voxel grid, and ground classified for a terrain surface. Positions come back in the file's own
// axes (x east, y north, z up) and are put into model axes by the caller.

const DEC = new TextDecoder();

/** Points of a file: { x, y, z: Float64Array, r, g, b: Uint8Array | null, count, format }. */
export function parsePointCloud(bytes, name = '') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'laz' || ext === 'e57') throw new Error(`.${ext} is compressed: convert it to LAS or PLY first (CloudCompare, PDAL).`);
  const head = DEC.decode(u8.subarray(0, 4));
  if (head === 'LASF') return parseLas(u8);
  if (head.startsWith('ply')) return parsePly(u8);
  return parseText(DEC.decode(u8));
}

function alloc(n, rgb) {
  return { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), r: rgb ? new Uint8Array(n) : null, g: rgb ? new Uint8Array(n) : null, b: rgb ? new Uint8Array(n) : null, count: n };
}

function parseLas(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const offset = dv.getUint32(96, true);
  const fmt = dv.getUint8(104) & 0x3f;
  const recLen = dv.getUint16(105, true);
  let n = dv.getUint32(107, true);
  const verMinor = dv.getUint8(25);
  if (!n && verMinor >= 4) n = Number(dv.getBigUint64(247, true));
  const [sx, sy, sz, ox, oy, oz] = [131, 139, 147, 155, 163, 171].map((o) => dv.getFloat64(o, true));
  const rgbAt = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[fmt];
  const out = alloc(n, rgbAt !== undefined);
  for (let i = 0; i < n; i++) {
    const p = offset + i * recLen;
    if (p + 12 > u8.length) {
      out.count = i;
      break;
    }
    out.x[i] = dv.getInt32(p, true) * sx + ox;
    out.y[i] = dv.getInt32(p + 4, true) * sy + oy;
    out.z[i] = dv.getInt32(p + 8, true) * sz + oz;
    if (rgbAt !== undefined) {
      out.r[i] = dv.getUint16(p + rgbAt, true) >> 8;
      out.g[i] = dv.getUint16(p + rgbAt + 2, true) >> 8;
      out.b[i] = dv.getUint16(p + rgbAt + 4, true) >> 8;
    }
  }
  return { ...out, format: 'LAS' };
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
  if (format === 'ascii') {
    const lines = DEC.decode(u8.subarray(end)).split(/\r?\n/).filter((l) => l.trim());
    for (let i = 0; i < n && i < lines.length; i++) {
      const v = lines[i].trim().split(/\s+/).map(Number);
      out.x[i] = v[ix], out.y[i] = v[iy], out.z[i] = v[iz];
      if (out.r) (out.r[i] = v[ir]), (out.g[i] = v[ig]), (out.b[i] = v[ib]);
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
