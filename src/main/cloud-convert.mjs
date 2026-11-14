// Point cloud to Potree 2.0 octree (#293), out of core: run in a worker thread (cloud-worker.cjs) by the main process,
// and by the tests in plain Node. LAS and LAZ stream in batches (LAZ chunk by chunk), PLY / XYZ are read whole.
//   pass 1  count points on a 128³ grid over the cube, keep a random preview and each attribute's range
//   pass 2  the nodes above the chunks keep their Poisson samples in memory; every other point goes to its chunk file
//   pass 3  each chunk's octree, top down, appended to octree.bin
//   pass 4  hierarchy.bin and metadata.json
// COPC needs none of this: openCopc reads its hierarchy and a preview from its top nodes.

import fs from 'node:fs';
import path from 'node:path';
import * as PC from '../core/pointcloud.js';
import * as LZ from '../core/laz.js';
import * as OT from '../core/octree.js';
import { copcInfo, copcHierarchy } from '../core/copc.js';

const GRID = 128;
const BATCH = 1 << 20;

function reader(file) {
  let fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const read = (at, n) => {
    const b = Buffer.allocUnsafe(Math.max(0, Math.min(n, size - at)));
    fs.readSync(fd, b, 0, b.length, at);
    return new Uint8Array(b.buffer, b.byteOffset, b.length);
  };
  const close = () => {
    if (fd !== null) fs.closeSync(fd);
    fd = null;
  };
  return { size, read, close };
}

/** A source: { header: { count, min, max, scale, origin, format }, batches() async generator, close() }. */
export async function openSource(file) {
  const lower = file.toLowerCase();
  if (/\.(las|laz)$/.test(lower)) {
    const r = reader(file);
    const h = PC.lasHeader(r.read(0, 1 << 16));
    if (h.offset > 1 << 16) Object.assign(h, PC.lasHeader(r.read(0, h.offset)));
    if (!h.compressed) {
      h.rgb8 = PC.colours8(r.read(h.offset, Math.min(2000, h.count) * h.recLen), h, 0);
      return {
        header: { ...h, format: 'LAS' },
        async *batches() {
          for (let i = 0; i < h.count; i += BATCH) {
            const n = Math.min(BATCH, h.count - i);
            yield PC.decodeLasRecords(r.read(h.offset + i * h.recLen, n * h.recLen), h, 0, n);
          }
        },
        close: r.close,
      };
    }
    const LP = await LZ.loadLazPerf();
    const chunks = LZ.lazChunks(h, r.read, r.size);
    return {
      header: { ...h, format: copcInfo(h) ? 'COPC' : 'LAZ', copc: copcInfo(h) },
      async *batches() {
        for (const c of chunks) yield LZ.decodeChunk(LP, h, r.read(c.start, c.size), c.count);
      },
      close: r.close,
      reader: r,
      lazPerf: LP,
      raw: h,
    };
  }
  const pc = PC.parsePointCloud(fs.readFileSync(file), file);
  const [a, b, c, d, e, f] = PC.bounds(pc);
  return { header: { count: pc.count, min: [a, b, c], max: [d, e, f], scale: [0.001, 0.001, 0.001], origin: [0, 0, 0], format: pc.format }, async *batches() { yield pc; }, close() {} };
}

/** A random sample of up to n points (reservoir), kept as x, y, z doubles and 8-bit colour. */
class Preview {
  constructor(n, seed = 7) {
    this.n = n;
    this.seen = 0;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.z = new Float64Array(n);
    this.rgb = null;
    this.s = seed;
  }
  rnd() {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  add(b) {
    if (b.r && !this.rgb) this.rgb = new Uint8Array(this.n * 3);
    for (let i = 0; i < b.count; i++, this.seen++) {
      const k = this.seen < this.n ? this.seen : Math.floor(this.rnd() * (this.seen + 1));
      if (k >= this.n) continue;
      this.x[k] = b.x[i];
      this.y[k] = b.y[i];
      this.z[k] = b.z[i];
      if (this.rgb && b.r) (this.rgb[k * 3] = b.r[i]), (this.rgb[k * 3 + 1] = b.g[i]), (this.rgb[k * 3 + 2] = b.b[i]);
    }
  }
  result() {
    const n = Math.min(this.n, this.seen);
    return { count: n, x: this.x.slice(0, n), y: this.y.slice(0, n), z: this.z.slice(0, n), rgb: this.rgb ? this.rgb.slice(0, n * 3) : null };
  }
}

/** Each attribute's range over a batch, gathered into ranges (Potree's metadata min / max). */
function addRanges(ranges, b, layout) {
  for (const a of layout.attributes) {
    const r = (ranges[a.name] ||= { min: new Array(a.numElements).fill(Infinity), max: new Array(a.numElements).fill(-Infinity) });
    const cols = a.field === 'xyz' ? [b.x, b.y, b.z] : a.field === 'rgb' ? [b.r, b.g, b.b] : [a.field.startsWith('extra:') ? b.extra[a.field.slice(6)] : b[a.field]];
    cols.forEach((col, k) => {
      const m = a.field === 'rgb' ? 257 : 1; // stored as 16-bit
      for (let i = 0; i < b.count; i++) {
        const v = col[i] * m;
        if (v < r.min[k]) r.min[k] = v;
        if (v > r.max[k]) r.max[k] = v;
      }
    });
  }
}

const yieldNow = () => new Promise((r) => setImmediate(r));

/**
 * Convert a cloud file to a Potree 2.0 octree in out (a folder). opts: { maxChunk = 4e6 points, preview = 300000,
 * onProgress({ stage, done, of, fraction }), onPreview(preview), name }. Returns the metadata (with source and
 * tight bounds) and the preview.
 */
export async function convertCloud(file, out, opts = {}) {
  const { maxChunk = 4e6, preview: previewN = 300000, onProgress = () => {}, onPreview = () => {} } = opts;
  fs.mkdirSync(out, { recursive: true });
  const src = await openSource(file);
  const h = src.header;
  const tmp = path.join(out, 'chunks');
  try {
    const count = h.count;
    const scale = h.scale.map((s) => (s > 0 && s <= 0.01 ? s : 0.001));
    // a margin of a unit: header bounds are often the unrounded ones
    const cube = OT.cubeOf(h.min.map((v, k) => v - scale[k]), h.max.map((v, k) => v + scale[k]));
    // the octree's offset on the source's own integer grid: positions come back exactly as the file has them
    const offset = h.min.map((m, k) => (h.origin[k] || 0) + Math.floor((m - (h.origin[k] || 0)) / scale[k]) * scale[k]);
    const rootSpacing = (cube.max[0] - cube.min[0]) / GRID;
    const report = (stage, done, base, span) => onProgress({ stage, done, of: count, fraction: Math.min(1, base + (span * done) / Math.max(1, count)) });

    // ---- pass 1
    const counts = new Float64Array(GRID ** 3);
    const preview = new Preview(previewN);
    const ranges = {};
    let layout = null;
    let seen = 0;
    for await (const b of src.batches()) {
      layout ||= OT.layoutOf(b);
      for (let i = 0; i < b.count; i++) counts[OT.cellOf(cube, GRID, b.x[i], b.y[i], b.z[i])]++;
      preview.add(b);
      addRanges(ranges, b, layout);
      seen += b.count;
      report('counting', seen, 0, 0.25);
      await yieldNow();
    }
    const pv = preview.result();
    onPreview(pv);
    if (!layout) throw new Error('That cloud has no points.');

    // ---- pass 2
    const { chunks, lookup } = OT.chunkify(counts, GRID, maxChunk);
    fs.mkdirSync(tmp, { recursive: true });
    const bpp = layout.bytesPerPoint;
    const upper = new Map(); // name → { grid, parts: [Uint8Array], count, buf, used }
    const files = chunks.map((c) => ({ path: path.join(tmp, `${c.name}.bin`), buf: Buffer.allocUnsafe(1 << 20), used: 0, fd: null, count: 0 }));
    const flush = (f) => {
      if (!f.used) return;
      f.fd ??= fs.openSync(f.path, 'a');
      fs.writeSync(f.fd, f.buf, 0, f.used);
      f.used = 0;
    };
    const upperOf = (name) => {
      let u = upper.get(name);
      if (!u) upper.set(name, (u = { grid: new OT.PoissonGrid(OT.boxOf(cube, name), OT.spacingAt(rootSpacing, name.length - 1)), parts: [], buf: Buffer.allocUnsafe(1 << 16), used: 0, count: 0 }));
      return u;
    };
    seen = 0;
    for await (const b of src.batches()) {
      const recs = OT.encodeRecords(b, Uint32Array.from({ length: b.count }, (_, i) => i), layout, scale, offset);
      for (let i = 0; i < b.count; i++) {
        const [x, y, z] = [b.x[i], b.y[i], b.z[i]];
        const c = chunks[lookup[OT.cellOf(cube, GRID, x, y, z)]];
        let dest = null;
        for (let L = 0; L < c.level && !dest; L++) {
          const u = upperOf(c.name.slice(0, L + 1));
          if (u.grid.add(x, y, z)) dest = u;
        }
        dest ||= files[lookup[OT.cellOf(cube, GRID, x, y, z)]];
        if (dest.used + bpp > dest.buf.length) {
          if (dest.grid) dest.parts.push(Uint8Array.from(dest.buf.subarray(0, dest.used))), (dest.used = 0);
          else flush(dest);
        }
        dest.buf.set(recs.subarray(i * bpp, (i + 1) * bpp), dest.used);
        dest.used += bpp;
        dest.count++;
      }
      seen += b.count;
      report('sorting', seen, 0.25, 0.3);
      await yieldNow();
    }
    for (const f of files) flush(f), f.fd !== null && fs.closeSync(f.fd);
    src.close();
    const total = seen;

    // ---- pass 3: each chunk's octree, appended to octree.bin
    const octFd = fs.openSync(path.join(out, 'octree.bin'), 'w');
    let octAt = 0;
    const append = (u8) => {
      fs.writeSync(octFd, u8);
      const at = octAt;
      octAt += u8.length;
      return at;
    };
    const subtrees = new Map();
    seen = 0;
    for (const [ci, c] of chunks.entries()) {
      const f = files[ci];
      if (!f.count) continue;
      const raw = new Uint8Array(fs.readFileSync(f.path));
      fs.rmSync(f.path);
      const pts = OT.decodeRecords(raw, { attributes: [layout.attributes[0]], bytesPerPoint: bpp }, scale, offset, f.count);
      const idx = Array.from({ length: f.count }, (_, i) => i);
      const tree = OT.buildSubtree(pts.position, idx, { name: c.name, level: c.level, box: OT.boxOf(cube, c.name), rootSpacing });
      for (const n of OT.walk(tree)) {
        const bytes = new Uint8Array(n.idx.length * bpp);
        n.idx.forEach((i, k) => bytes.set(raw.subarray(i * bpp, (i + 1) * bpp), k * bpp));
        n.numPoints = n.idx.length;
        n.byteOffset = append(bytes);
        n.byteSize = bytes.length;
        n.idx = null;
      }
      subtrees.set(c.name, tree);
      seen += f.count;
      report('building', seen, 0.55, 0.4);
      await yieldNow();
    }

    // ---- pass 4: the nodes above the chunks, the hierarchy and the metadata
    const nodes = new Map();
    const nodeOf = (name) => {
      let n = nodes.get(name);
      if (n) return n;
      n = subtrees.get(name) || { name, level: name.length - 1, box: OT.boxOf(cube, name), numPoints: 0, byteOffset: 0, byteSize: 0, children: [] };
      nodes.set(name, n);
      if (name.length > 1) nodeOf(name.slice(0, -1)).children[+name.at(-1)] = n;
      return n;
    };
    for (const name of subtrees.keys()) nodeOf(name);
    for (const [name, u] of upper) {
      const n = nodeOf(name);
      const bytes = Buffer.concat([...u.parts, u.buf.subarray(0, u.used)]);
      n.numPoints = u.count;
      n.byteOffset = append(bytes);
      n.byteSize = bytes.length;
    }
    fs.closeSync(octFd);
    const root = nodeOf('r');
    const hier = OT.encodeHierarchy(root, 4);
    fs.writeFileSync(path.join(out, 'hierarchy.bin'), hier.bytes);
    const tight = { min: ranges.position.min, max: ranges.position.max };
    const metadata = {
      version: '2.0',
      name: opts.name || path.basename(file).replace(/\.\w+$/, ''),
      description: '',
      points: total,
      projection: '',
      hierarchy: { firstChunkSize: hier.firstChunkSize, stepSize: 4, depth: hier.depth },
      offset,
      scale,
      spacing: rootSpacing,
      boundingBox: cube,
      encoding: 'DEFAULT',
      attributes: layout.attributes.map((a) => ({ name: a.name, description: '', size: a.size, numElements: a.numElements, elementSize: a.elementSize, type: a.type, min: ranges[a.name].min, max: ranges[a.name].max })),
      // ours, beside Potree's: where it came from and its tight bounds
      source: { path: file, format: h.format, count: h.count, version: h.version || null },
      tightBounds: tight,
    };
    fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 1));
    onProgress({ stage: 'done', done: total, of: count, fraction: 1 });
    return { metadata, preview: pv };
  } finally {
    try {
      src.close();
    } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** An octree folder: { metadata, layout, root } (the whole hierarchy). */
export function readOctree(folder) {
  const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'metadata.json'), 'utf8'));
  const root = OT.decodeHierarchy(new Uint8Array(fs.readFileSync(path.join(folder, 'hierarchy.bin'))), metadata.hierarchy.firstChunkSize, metadata.boundingBox);
  return { metadata, layout: OT.layoutFromMetadata(metadata), root };
}

/** A preview from an octree's top levels (a finished cache needs no conversion, but the document wants its preview). */
export function octreePreview(folder, n = 300000) {
  const { metadata: m, layout, root } = readOctree(folder);
  const preview = new Preview(n);
  const r = reader(path.join(folder, 'octree.bin'));
  try {
    const queue = [root];
    while (queue.length && preview.seen < n) {
      const node = queue.shift();
      if (node.numPoints > 0) {
        const d = OT.decodeRecords(r.read(node.byteOffset, node.byteSize), layout, m.scale, m.offset, node.numPoints);
        const b = { count: d.count, x: new Float64Array(d.count), y: new Float64Array(d.count), z: new Float64Array(d.count) };
        for (let i = 0; i < d.count; i++) (b.x[i] = d.position[i * 3]), (b.y[i] = d.position[i * 3 + 1]), (b.z[i] = d.position[i * 3 + 2]);
        if (d.rgb) for (const [k, c] of ['r', 'g', 'b'].entries()) b[c] = Uint8Array.from({ length: d.count }, (_, i) => d.rgb[i * 3 + k] >> 8);
        preview.add(b);
      }
      queue.push(...node.children.filter(Boolean));
    }
  } finally {
    r.close();
  }
  return preview.result();
}

/** Bytes of a file range (a node of octree.bin, or of a COPC file). */
export function readRange(file, at, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.allocUnsafe(size);
    fs.readSync(fd, b, 0, size, at);
    return b;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * A COPC file opened in place: { header, info, root (Potree-style nodes), preview } with the preview from its top
 * levels (about previewN points).
 */
export async function openCopc(file, previewN = 300000) {
  const r = reader(file);
  try {
    let h = PC.lasHeader(r.read(0, 1 << 16));
    if (h.offset > 1 << 16) h = PC.lasHeader(r.read(0, h.offset));
    const info = copcInfo(h);
    if (!info) throw new Error('Not a COPC file.');
    const root = copcHierarchy(info, r.read);
    const LP = await LZ.loadLazPerf();
    const preview = new Preview(previewN);
    const queue = [root];
    while (queue.length && preview.seen < previewN) {
      const n = queue.shift();
      if (n.numPoints > 0) preview.add(LZ.decodeChunk(LP, h, r.read(n.byteOffset, n.byteSize), n.numPoints));
      queue.push(...n.children.filter(Boolean));
    }
    let points = 0;
    for (const n of OT.walk(root)) points += Math.max(0, n.numPoints);
    return { header: h, info, root, points, preview: preview.result() };
  } finally {
    r.close();
  }
}
