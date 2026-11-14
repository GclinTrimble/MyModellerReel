// Point cloud work on a whole octree (#298, #299), in the cloud worker thread (cloud-worker.cjs) or plain Node (tests):
// classification tile by tile, and export to LAS 1.4 or PLY with the class edits applied. The octree (Potree 2.0
// folder or COPC file) stays read-only: classification returns a class delta (cloudselect.js) the page keeps as an
// asset, so it is undone like a hand edit.
//
// Classification: the cloud's footprint cut into square tiles of a few million points; each tile reads its nodes with
// a margin around it (so ground filter windows and neighbourhoods across tile borders are right), classifies the
// points (classify.js), and keeps the classes of the points inside the tile proper. Nodes read are kept in a cache.

import fs from 'node:fs';
import path from 'node:path';
import * as PC from '../core/pointcloud.js';
import * as LZ from '../core/laz.js';
import * as OT from '../core/octree.js';
import * as C from '../core/classify.js';
import * as S from '../core/cloudselect.js';
import { copcInfo, copcHierarchy } from '../core/copc.js';
import { inside } from '../core/clip.js';
import { readOctree } from './cloud-convert.mjs';

const yieldNow = () => new Promise((r) => setImmediate(r));

function fileReader(file) {
  const fd = fs.openSync(file, 'r');
  return {
    read(at, n) {
      const b = Buffer.allocUnsafe(n);
      fs.readSync(fd, b, 0, n, at);
      return new Uint8Array(b.buffer, b.byteOffset, n);
    },
    close: () => fs.closeSync(fd),
  };
}

/** A batch (pointcloud.js fields) from a Potree node's decoded records. */
function batchOf(d) {
  const n = d.count;
  const p = d.position;
  const b = { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
  for (let i = 0; i < n; i++) (b.x[i] = p[i * 3]), (b.y[i] = p[i * 3 + 1]), (b.z[i] = p[i * 3 + 2]);
  const map = { intensity: 'intensity', returnNumber: 'return number', numberOfReturns: 'number of returns', classification: 'classification', classFlags: 'classification flags', scanAngle: 'scan angle', userData: 'user data', pointSourceId: 'point source id', gpsTime: 'gps-time' };
  for (const [f, name] of Object.entries(map)) if (d[name]) b[f] = d[name];
  if (d.rgb) {
    let max = 0;
    for (let i = 0; i < d.rgb.length; i += 97) max = Math.max(max, d.rgb[i]);
    const sh = max > 255 ? 8 : 0;
    for (const [k, c] of ['r', 'g', 'b'].entries()) b[c] = Uint8Array.from({ length: n }, (_, i) => d.rgb[i * 3 + k] >> sh);
  }
  return b;
}

/** An octree to read: { root, nodes (with points), read(node) → batch, header: { scale, offset, min, max, vlrs, rgb }, close }. */
export async function openTree({ kind, folder, file }) {
  if (kind === 'copc') {
    const r = fileReader(file);
    let h = PC.lasHeader(r.read(0, 1 << 16));
    if (h.offset > 1 << 16) h = PC.lasHeader(r.read(0, h.offset));
    const info = copcInfo(h);
    if (!info) throw new Error(`${path.basename(file)} is not a COPC file.`);
    const root = copcHierarchy(info, r.read);
    const LP = await LZ.loadLazPerf();
    return { root, nodes: [...OT.walk(root)].filter((n) => n.numPoints > 0), read: (n) => LZ.decodeChunk(LP, h, r.read(n.byteOffset, n.byteSize), n.numPoints), header: { scale: h.scale, offset: h.origin, min: h.min, max: h.max, vlrs: h.vlrs, rgb: [7, 8].includes(h.format) }, close: r.close };
  }
  const o = readOctree(folder);
  const r = fileReader(path.join(folder, 'octree.bin'));
  const m = o.metadata;
  let vlrs = [];
  try {
    // the source's CRS: its VLRs, when the source file is still there
    if (/\.la[sz]$/i.test(m.source?.path || '') && fs.existsSync(m.source.path)) {
      const s = fileReader(m.source.path);
      try {
        let h = PC.lasHeader(s.read(0, Math.min(1 << 16, fs.statSync(m.source.path).size)));
        if (h.offset > 1 << 16) h = PC.lasHeader(s.read(0, h.offset));
        vlrs = h.vlrs;
      } finally {
        s.close();
      }
    }
  } catch {}
  const tb = m.tightBounds || m.boundingBox;
  return { root: o.root, nodes: [...OT.walk(o.root)].filter((n) => n.numPoints > 0), read: (n) => batchOf(OT.decodeRecords(r.read(n.byteOffset, n.byteSize), o.layout, m.scale, m.offset, n.numPoints)), header: { scale: m.scale, offset: m.offset, min: tb.min, max: tb.max, vlrs, rgb: m.attributes.some((a) => a.name === 'rgb') }, close: r.close };
}

/** Nodes read, with their classes and flags after the edits, kept up to a memory budget. */
function nodeCache(tree, deltas, budget = 1.5e9) {
  const cache = new Map();
  let bytes = 0;
  return (node) => {
    let e = cache.get(node.name);
    if (e) {
      cache.delete(node.name);
      cache.set(node.name, e);
      return e;
    }
    const b = tree.read(node);
    const { classes, flags } = S.effective(b.classification, b.count, deltas, node.name);
    e = { b, classes, flags, size: b.count * 60 };
    cache.set(node.name, e);
    bytes += e.size;
    for (const [k, old] of cache) {
      if (bytes <= budget || k === node.name) break;
      cache.delete(k);
      bytes -= old.size;
    }
    return e;
  };
}

/** A test of file points against a clip volume in model coordinates (base point and entity position). */
export function clipTest(scope) {
  if (!scope?.clip) return null;
  const [bx, by, bz] = scope.base || [0, 0, 0];
  const [ex, ey, ez] = scope.position || [0, 0, 0];
  return (x, y, z) => inside(scope.clip, [x - bx + ex, z - bz + ey, -(y - by) + ez]);
}

/**
 * Classify a whole octree. opts: { kind, folder, file, deltas: [Uint8Array] (the edits so far, in order), steps,
 * params, overwrite, only_unclassified, scope: { clip, base, position } | null, preview: { x, y, z } (file axes) |
 * null, tilePoints (default 3e6) }. on: { progress({ stage, fraction, done, of }), part({ nodes: [[name, classes]] }) }.
 * Returns { delta (Uint8Array), before, after (counts per class of the points looked at), changed, tiles, seconds }.
 */
export async function classifyTree(opts, on = {}) {
  const t0 = Date.now();
  const tree = await openTree(opts);
  try {
    const deltas = (opts.deltas || []).map((d) => S.decodeDelta(new Uint8Array(d)));
    const get = nodeCache(tree, deltas);
    const P = C.paramsOf(opts.params);
    const within = clipTest(opts.scope);
    const total = tree.nodes.reduce((s, n) => s + n.numPoints, 0);
    const [x0, y0] = tree.header.min;
    const [x1, y1] = tree.header.max;
    const area = Math.max(1, (x1 - x0) * (y1 - y0));
    const side = Math.min(1000, Math.max(30, Math.sqrt((area * (opts.tilePoints || 3e6)) / Math.max(1, total))));
    const margin = Math.max(10, P.ground.max_window);
    const [nx, ny] = [Math.max(1, Math.ceil((x1 - x0) / side)), Math.max(1, Math.ceil((y1 - y0) / side))];
    const out = new Map(); // node name → classes after
    const before = {};
    const after = {};
    let changed = 0;
    let done = 0;
    const pv = opts.preview;
    const pvOut = pv ? new Uint8Array(pv.x.length) : null;
    const pvNow = pv ? Uint8Array.from(pv.classification || new Uint8Array(pv.x.length).fill(1)) : null;
    if (pvOut) pvOut.set(pvNow);
    for (let ty = 0; ty < ny; ty++)
      for (let tx = 0; tx < nx; tx++) {
        const core = [x0 + tx * side, y0 + ty * side, tx === nx - 1 ? Infinity : x0 + (tx + 1) * side, ty === ny - 1 ? Infinity : y0 + (ty + 1) * side];
        const ext = [core[0] - margin, core[1] - margin, Math.min(core[2], x1) + margin, Math.min(core[3], y1) + margin];
        const inCore = (x, y) => x >= core[0] && x < core[2] && y >= core[1] && y < core[3] && (tx > 0 || x >= x0 - 1) && (ty > 0 || y >= y0 - 1);
        const nodes = tree.nodes.filter((n) => n.box.max[0] >= ext[0] && n.box.min[0] <= ext[2] && n.box.max[1] >= ext[1] && n.box.min[1] <= ext[3]);
        // gather the tile's points
        const parts = [];
        let n = 0;
        for (const node of nodes) {
          const e = get(node);
          const idx = [];
          for (let i = 0; i < e.b.count; i++) {
            const [x, y] = [e.b.x[i], e.b.y[i]];
            if (x >= ext[0] && x <= ext[2] && y >= ext[1] && y <= ext[3]) idx.push(i);
          }
          if (idx.length) parts.push({ node, e, idx }), (n += idx.length);
        }
        if (!n) continue;
        const pos = new Float64Array(n * 3);
        const cls = new Uint8Array(n);
        const inten = new Uint16Array(n);
        const writable = new Uint8Array(n);
        const core1 = new Uint8Array(n);
        let k = 0;
        for (const { e, idx } of parts)
          for (const i of idx) {
            const [x, y, z] = [e.b.x[i], e.b.y[i], e.b.z[i]];
            pos[k * 3] = x;
            pos[k * 3 + 1] = y;
            pos[k * 3 + 2] = z;
            cls[k] = e.classes[i];
            if (e.b.intensity) inten[k] = e.b.intensity[i];
            core1[k] = inCore(x, y) ? 1 : 0;
            const f = e.flags[i];
            writable[k] = core1[k] && !(f & S.DELETED) && (opts.overwrite || !(f & S.LOCK)) && (!opts.only_unclassified || cls[k] <= 1) && (!within || within(x, y, z)) ? 1 : 0;
            k++;
          }
        const base = (done / Math.max(1, total)) * 0.97;
        const span = 0.97 / Math.max(1, nx * ny);
        const r = C.classifyPoints({ count: n, pos, classification: cls, intensity: inten }, { steps: opts.steps, params: opts.params, writable, onProgress: (f, stage) => on.progress?.({ stage: `tile ${ty * nx + tx + 1} of ${nx * ny}: ${stage}`, fraction: base + f * span, done, of: total }) });
        // keep the core's classes
        const touched = new Map();
        k = 0;
        let coreN = 0;
        for (const { node, e, idx } of parts)
          for (const i of idx) {
            if (core1[k]) {
              let o = out.get(node.name);
              if (!o) out.set(node.name, (o = Uint8Array.from(e.classes)));
              o[i] = r.classes[k];
              touched.set(node.name, o);
              before[cls[k]] = (before[cls[k]] || 0) + 1;
              after[r.classes[k]] = (after[r.classes[k]] || 0) + 1;
              if (r.classes[k] !== cls[k]) changed++;
              coreN++;
            }
            k++;
          }
        // the preview's points are points of the cloud: each takes the class of the point it sits on
        if (pv) {
          const g = C.voxelGrid(pos, 0.25, n);
          const one = new Uint32Array(1);
          for (let i = 0; i < pvOut.length; i++) {
            const [x, y, z] = [pv.x[i], pv.y[i], pv.z[i]];
            if (!inCore(x, y)) continue;
            const nb = C.neighboursAt(g, x, y, z, { k: 1, rmax: 0.5 }, one);
            if (nb.length && (pos[nb[0] * 3] - x) ** 2 + (pos[nb[0] * 3 + 1] - y) ** 2 + (pos[nb[0] * 3 + 2] - z) ** 2 < 1e-6) pvOut[i] = r.classes[nb[0]];
          }
        }
        done += coreN;
        on.part?.({ nodes: [...touched].map(([name, c]) => [name, c.slice()]) });
        await yieldNow();
      }
    // the delta: the nodes whose classes changed, dense
    const delta = new Map();
    for (const [name, c] of out) {
      const e = get(tree.nodes.find((x) => x.name === name));
      if (c.some((v, i) => v !== e.classes[i])) delta.set(name, { dense: c });
    }
    if (pvOut && pvOut.some((v, i) => v !== pvNow[i])) delta.set('preview', { dense: pvOut });
    on.progress?.({ stage: 'done', fraction: 1, done: total, of: total });
    return { delta: S.encodeDelta(delta), nodes: delta.size, before, after, changed, tiles: nx * ny, points: done, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  } finally {
    tree.close();
  }
}

/**
 * Write a whole octree with its edits as LAS 1.4 (format 6, or 7 with colour) or binary PLY. opts: { kind, folder,
 * file, deltas, path, format: 'las' | 'ply', selection: [[name, Uint32Array]] | null, scope: { clip, base, position }
 * | null, classes: [codes] | null, coordinates: 'world' | 'project', base, wkt }. Deleted points are left out.
 * Returns { path, points, format, seconds }.
 */
export async function exportTree(opts, on = {}) {
  const t0 = Date.now();
  const tree = await openTree(opts);
  const tmp = `${opts.path}.part`;
  const fd = fs.openSync(tmp, 'w');
  try {
    const deltas = (opts.deltas || []).map((d) => S.decodeDelta(new Uint8Array(d)));
    const within = clipTest(opts.scope);
    const sel = opts.selection ? new Map(opts.selection) : null;
    const keepCls = opts.classes?.length ? new Set(opts.classes) : null;
    const shift = opts.coordinates === 'project' ? opts.base || [0, 0, 0] : [0, 0, 0];
    const las = opts.format !== 'ply';
    const rgb = tree.header.rgb;
    const format = rgb ? 7 : 6;
    const scale = tree.header.scale.map((s) => (s > 0 ? s : 0.001));
    const offset = tree.header.offset.map((o, k) => o - shift[k]);
    const srcWkt = tree.header.vlrs.find((v) => v.user === 'LASF_Projection' && v.record === 2112);
    const wkt = opts.coordinates === 'project' ? '' : srcWkt ? new TextDecoder().decode(srcWkt.data).replace(/\0+$/, '') : opts.wkt || '';
    const head = las ? PC.las14Header({ count: 0, format, scale, offset, wkt }) : PC.plyHeader(0, { rgb });
    fs.writeSync(fd, head);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const byReturn = new Array(15).fill(0);
    let points = 0;
    const nodes = sel ? tree.nodes.filter((n) => sel.has(n.name)) : tree.nodes;
    let k = 0;
    for (const node of nodes) {
      const b = tree.read(node);
      const { classes, flags } = S.effective(b.classification, b.count, deltas, node.name);
      b.classification = classes;
      if (shift.some((v) => v)) for (let i = 0; i < b.count; i++) (b.x[i] -= shift[0]), (b.y[i] -= shift[1]), (b.z[i] -= shift[2]);
      const cand = sel ? sel.get(node.name) : null;
      const idx = [];
      const n = cand ? cand.length : b.count;
      for (let t = 0; t < n; t++) {
        const i = cand ? cand[t] : t;
        if (flags[i] & S.DELETED || (keepCls && !keepCls.has(classes[i]))) continue;
        if (within && !within(b.x[i] + shift[0], b.y[i] + shift[1], b.z[i] + shift[2])) continue;
        idx.push(i);
        const p = [b.x[i], b.y[i], b.z[i]];
        for (let a = 0; a < 3; a++) (min[a] = Math.min(min[a], p[a])), (max[a] = Math.max(max[a], p[a]));
        if (b.returnNumber) byReturn[Math.max(0, Math.min(14, (b.returnNumber[i] || 1) - 1))]++;
        else byReturn[0]++;
      }
      if (idx.length) fs.writeSync(fd, las ? PC.las14Records(b, idx, { format, scale, offset }) : PC.plyRecords(b, idx, { rgb }));
      points += idx.length;
      if ((++k & 15) === 0) on.progress?.({ stage: 'writing', fraction: k / nodes.length, done: k, of: nodes.length }), await yieldNow();
    }
    if (!points) throw new Error('No points to write: the selection, clip or classes leave none.');
    const final = las ? PC.las14Header({ count: points, format, scale, offset, min, max, byReturn, wkt }) : PC.plyHeader(points, { rgb });
    fs.writeSync(fd, final, 0, final.length, 0);
    fs.closeSync(fd);
    fs.renameSync(tmp, opts.path);
    on.progress?.({ stage: 'done', fraction: 1, done: nodes.length, of: nodes.length });
    return { path: opts.path, points, format: las ? 'LAS 1.4' : 'PLY', point_format: las ? format : undefined, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  } catch (e) {
    try {
      fs.closeSync(fd);
    } catch {}
    fs.rmSync(tmp, { force: true });
    throw e;
  } finally {
    tree.close();
  }
}
