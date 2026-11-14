// Point cloud octrees (#293, #294) in the Potree 2.0 layout (BSD-licensed spec: metadata.json, hierarchy.bin,
// octree.bin, DEFAULT encoding): node names and boxes, attribute layouts, Poisson-disk sampling per level (as
// PotreeConverter 2), the 128³ chunking of a big cloud, hierarchy encode / decode, and which nodes to draw for a camera
// within a point budget. Pure: the converter (src/main/cloud-convert.mjs) and the viewer (src/renderer/cloudlod.js)
// do the files and the GPU.

// ---------------------------------------------------------------- attributes

/**
 * The attributes we keep, by Potree name, with the batch field they come from (pointcloud.js batches): position is
 * int32 × 3 (scale and offset in metadata), the rest as LAS has them.
 */
export const ATTRIBUTES = [
  { name: 'position', field: 'xyz', type: 'int32', numElements: 3, elementSize: 4 },
  { name: 'intensity', field: 'intensity', type: 'uint16', numElements: 1, elementSize: 2 },
  { name: 'return number', field: 'returnNumber', type: 'uint8', numElements: 1, elementSize: 1 },
  { name: 'number of returns', field: 'numberOfReturns', type: 'uint8', numElements: 1, elementSize: 1 },
  { name: 'classification', field: 'classification', type: 'uint8', numElements: 1, elementSize: 1 },
  { name: 'classification flags', field: 'classFlags', type: 'uint8', numElements: 1, elementSize: 1 },
  { name: 'scan angle', field: 'scanAngle', type: 'float', numElements: 1, elementSize: 4 },
  { name: 'user data', field: 'userData', type: 'uint8', numElements: 1, elementSize: 1 },
  { name: 'point source id', field: 'pointSourceId', type: 'uint16', numElements: 1, elementSize: 2 },
  { name: 'gps-time', field: 'gpsTime', type: 'double', numElements: 1, elementSize: 8 },
  { name: 'rgb', field: 'rgb', type: 'uint16', numElements: 3, elementSize: 2 },
];
const SET = { int32: 'setInt32', uint8: 'setUint8', uint16: 'setUint16', float: 'setFloat32', double: 'setFloat64' };
const GET = { int32: 'getInt32', uint8: 'getUint8', uint16: 'getUint16', float: 'getFloat32', double: 'getFloat64', int8: 'getInt8', int16: 'getInt16', uint32: 'getUint32', int64: 'getBigInt64', uint64: 'getBigUint64' };
const ARRAY = { int32: Int32Array, uint8: Uint8Array, uint16: Uint16Array, float: Float32Array, double: Float64Array, int8: Int8Array, int16: Int16Array, uint32: Uint32Array, int64: Float64Array, uint64: Float64Array };

/** The attribute layout for a batch: what it has, each with its byte offset in a record; extra (PLY) fields as floats. */
export function layoutOf(batch) {
  const attrs = ATTRIBUTES.filter((a) => a.field === 'xyz' || (a.field === 'rgb' ? batch.r : batch[a.field])).map((a) => ({ ...a }));
  for (const name of Object.keys(batch.extra || {})) attrs.push({ name, field: `extra:${name}`, type: 'float', numElements: 1, elementSize: 4 });
  let at = 0;
  for (const a of attrs) (a.size = a.numElements * a.elementSize), (a.offset = at), (at += a.size);
  return { attributes: attrs, bytesPerPoint: at };
}

/** The layout back from metadata.json's attributes (any Potree 2.0 file, ours or PotreeConverter's). */
export function layoutFromMetadata(meta) {
  let at = 0;
  const attributes = meta.attributes.map((a) => {
    const known = ATTRIBUTES.find((k) => k.name === a.name);
    const out = { ...a, field: known?.field || `extra:${a.name}`, offset: at };
    at += a.size;
    return out;
  });
  return { attributes, bytesPerPoint: at };
}

/** Records of the points idx of a batch in a layout, positions quantised with scale and offset. */
export function encodeRecords(batch, idx, layout, scale, offset) {
  const { attributes, bytesPerPoint: bpp } = layout;
  const u8 = new Uint8Array(idx.length * bpp);
  const dv = new DataView(u8.buffer);
  for (const a of attributes) {
    const set = SET[a.type];
    if (a.field === 'xyz') {
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const p = k * bpp + a.offset;
        dv.setInt32(p, Math.round((batch.x[i] - offset[0]) / scale[0]), true);
        dv.setInt32(p + 4, Math.round((batch.y[i] - offset[1]) / scale[1]), true);
        dv.setInt32(p + 8, Math.round((batch.z[i] - offset[2]) / scale[2]), true);
      }
    } else if (a.field === 'rgb') {
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const p = k * bpp + a.offset;
        dv.setUint16(p, batch.r[i] * 257, true);
        dv.setUint16(p + 2, batch.g[i] * 257, true);
        dv.setUint16(p + 4, batch.b[i] * 257, true);
      }
    } else {
      const src = a.field.startsWith('extra:') ? batch.extra[a.field.slice(6)] : batch[a.field];
      for (let k = 0; k < idx.length; k++) dv[set](k * bpp + a.offset, src[idx[k]], true);
    }
  }
  return u8;
}

/**
 * The points of a node's bytes: { count, position: Float64Array (x, y, z in the file's coordinates, at full
 * precision), and one typed array per other attribute by its Potree name (rgb: Uint16Array × 3) }.
 */
export function decodeRecords(bytes, layout, scale, offset, count = Math.floor(bytes.byteLength / layout.bytesPerPoint)) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const bpp = layout.bytesPerPoint;
  const out = { count };
  for (const a of layout.attributes) {
    const get = GET[a.type];
    if (a.name === 'position') {
      const pos = (out.position = new Float64Array(count * 3));
      for (let i = 0; i < count; i++) {
        const p = i * bpp + a.offset;
        pos[i * 3] = dv.getInt32(p, true) * scale[0] + offset[0];
        pos[i * 3 + 1] = dv.getInt32(p + 4, true) * scale[1] + offset[1];
        pos[i * 3 + 2] = dv.getInt32(p + 8, true) * scale[2] + offset[2];
      }
      continue;
    }
    if (!get) continue;
    const arr = (out[a.name] = new ARRAY[a.type](count * a.numElements));
    const big = a.type.endsWith('64') && a.type !== 'float64' && a.type.includes('int');
    for (let i = 0; i < count; i++) for (let e = 0; e < a.numElements; e++) {
      const v = dv[get](i * bpp + a.offset + e * a.elementSize, true);
      arr[i * a.numElements + e] = big ? Number(v) : v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- boxes and names

/** The cube around bounds (Potree octrees are cubes): { min, max }. */
export function cubeOf(min, max) {
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  return { min: [...min], max: min.map((v) => v + size) };
}
/** Child i of a box: bit 4 the upper half in x, 2 in y, 1 in z (Potree's order). */
export function childBox(box, i) {
  const mid = box.min.map((v, k) => (v + box.max[k]) / 2);
  const pick = (k, bit) => (i & bit ? [mid[k], box.max[k]] : [box.min[k], mid[k]]);
  const [x, y, z] = [pick(0, 4), pick(1, 2), pick(2, 1)];
  return { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] };
}
/** Which child of box a point falls in. */
export function childIndex(box, x, y, z) {
  return ((x >= (box.min[0] + box.max[0]) / 2) << 2) | ((y >= (box.min[1] + box.max[1]) / 2) << 1) | (z >= (box.min[2] + box.max[2]) / 2);
}
/** The box of a node by its name ('r', 'r0', 'r07' …) in a cube. */
export function boxOf(cube, name) {
  let b = cube;
  for (let k = 1; k < name.length; k++) b = childBox(b, +name[k]);
  return b;
}
/** The spacing of a level: Potree's root spacing is the cube's size / 128, halved per level. */
export const spacingAt = (rootSpacing, level) => rootSpacing / 2 ** level;

// ---------------------------------------------------------------- Poisson-disk sampling

/**
 * Poisson-disk acceptance in one node: a point is kept when no kept point is closer than spacing. Cells of the
 * spacing's size (128 a side in a Potree node), each holding the kept points in it.
 */
export class PoissonGrid {
  constructor(box, spacing) {
    this.min = box.min;
    this.s = spacing;
    this.n = Math.max(1, Math.ceil((box.max[0] - box.min[0]) / spacing));
    this.cells = new Map();
  }
  add(x, y, z) {
    const { min, s, n } = this;
    const cx = Math.min(n - 1, Math.max(0, Math.floor((x - min[0]) / s)));
    const cy = Math.min(n - 1, Math.max(0, Math.floor((y - min[1]) / s)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor((z - min[2]) / s)));
    const s2 = s * s;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const c = this.cells.get(((cx + dx) * (n + 2) + (cy + dy)) * (n + 2) + (cz + dz));
      if (c) for (let k = 0; k < c.length; k += 3) if ((c[k] - x) ** 2 + (c[k + 1] - y) ** 2 + (c[k + 2] - z) ** 2 < s2) return false;
    }
    const key = (cx * (n + 2) + cy) * (n + 2) + cz;
    const c = this.cells.get(key);
    if (c) c.push(x, y, z);
    else this.cells.set(key, [x, y, z]);
    return true;
  }
}

/**
 * The octree below a node, top down: a node keeps a Poisson sample of its points at its level's spacing and passes the
 * rest to its eight children; a node with maxLeaf points or fewer (or at maxDepth) keeps them all. Every point ends
 * in exactly one node. pos: Float64Array x, y, z; idx: the points (indices into pos) in this node.
 * Returns { name, level, box, idx: Uint32Array, children[8] }.
 */
export function buildSubtree(pos, idx, { name = 'r', level = 0, box, rootSpacing, maxLeaf = 20000, maxDepth = 24 }) {
  const node = { name, level, box, idx: null, children: [] };
  if (idx.length <= maxLeaf || level >= maxDepth) {
    node.idx = Uint32Array.from(idx);
    return node;
  }
  const grid = new PoissonGrid(box, spacingAt(rootSpacing, level));
  const kept = [];
  const rest = Array.from({ length: 8 }, () => []);
  for (const i of idx) {
    const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    if (grid.add(x, y, z)) kept.push(i);
    else rest[childIndex(box, x, y, z)].push(i);
  }
  node.idx = Uint32Array.from(kept);
  rest.forEach((r, i) => {
    if (r.length) node.children[i] = buildSubtree(pos, r, { name: name + i, level: level + 1, box: childBox(box, i), rootSpacing, maxLeaf, maxDepth });
  });
  return node;
}

// ---------------------------------------------------------------- chunking (out of core)

/** The cell of a point on a grid³ over the cube (pass 1 counts points per cell). */
export function cellOf(cube, grid, x, y, z) {
  const size = cube.max[0] - cube.min[0];
  const c = (v, k) => Math.min(grid - 1, Math.max(0, Math.floor(((v - cube.min[k]) / size) * grid)));
  return (c(x, 0) * grid + c(y, 1)) * grid + c(z, 2);
}

/**
 * Chunks from the counts of a grid³ (grid a power of two): the biggest octree nodes holding maxPoints or fewer, as
 * PotreeConverter 2 does. Returns { chunks: [{ name, level, count }], lookup: Int32Array cell → chunk index (-1 empty) }.
 */
export function chunkify(counts, grid, maxPoints) {
  const levels = Math.log2(grid);
  // a pyramid of counts: level L has (2^L)³ cells
  const pyr = [];
  pyr[levels] = counts;
  for (let L = levels - 1; L >= 0; L--) {
    const n = 2 ** L;
    const up = new Float64Array(n * n * n);
    const fine = pyr[L + 1];
    const m = 2 * n;
    for (let x = 0; x < m; x++) for (let y = 0; y < m; y++) for (let z = 0; z < m; z++) up[((x >> 1) * n + (y >> 1)) * n + (z >> 1)] += fine[(x * m + y) * m + z];
    pyr[L] = up;
  }
  const chunks = [];
  const lookup = new Int32Array(grid * grid * grid).fill(-1);
  const visit = (L, x, y, z, name) => {
    const n = 2 ** L;
    const count = pyr[L][(x * n + y) * n + z];
    if (!count) return;
    if (count <= maxPoints || L === levels) {
      const id = chunks.push({ name, level: L, count }) - 1;
      const k = 2 ** (levels - L);
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) lookup[((x * k + i) * grid + (y * k + j)) * grid + (z * k + l)] = id;
      return;
    }
    for (let c = 0; c < 8; c++) visit(L + 1, 2 * x + ((c >> 2) & 1), 2 * y + ((c >> 1) & 1), 2 * z + (c & 1), name + c);
  };
  visit(0, 0, 0, 0, 'r');
  return { chunks, lookup };
}

// ---------------------------------------------------------------- hierarchy.bin

const REC = 22; // type u8, child mask u8, points u32, byte offset u64, byte size u64

/**
 * hierarchy.bin from a tree of { name, level, numPoints, byteOffset, byteSize, children[8] }: breadth-first chunks of
 * stepSize levels, the nodes at a chunk's bottom with children written as proxies (type 2) to their own chunk.
 * Returns { bytes, firstChunkSize, depth }.
 */
export function encodeHierarchy(root, stepSize = 4) {
  const chunks = []; // [{ root, nodes, proxies }]
  let depth = 0;
  const plan = (top) => {
    const nodes = [];
    const queue = [top];
    while (queue.length) {
      const n = queue.shift();
      nodes.push(n);
      depth = Math.max(depth, n.level);
      const kids = n.children.filter(Boolean);
      if (n !== top && n.level - top.level >= stepSize && kids.length) continue; // a proxy
      for (let i = 0; i < 8; i++) if (n.children[i]) queue.push(n.children[i]);
    }
    const c = { top, nodes };
    chunks.push(c);
    for (const n of nodes) if (n !== top && n.level - top.level >= stepSize && n.children.some(Boolean)) plan(n);
    return c;
  };
  plan(root);
  const sizes = chunks.map((c) => c.nodes.length * REC);
  const at = new Map();
  let off = 0;
  chunks.forEach((c, i) => (at.set(c.top, [off, sizes[i]]), (off += sizes[i])));
  const u8 = new Uint8Array(off);
  const dv = new DataView(u8.buffer);
  let p = 0;
  for (const c of chunks) for (const n of c.nodes) {
    const kids = n.children;
    const proxy = n !== c.top && at.has(n);
    const mask = proxy ? 0 : kids.reduce((m, k, i) => (k ? m | (1 << i) : m), 0);
    dv.setUint8(p, proxy ? 2 : mask ? 0 : 1);
    dv.setUint8(p + 1, mask);
    dv.setUint32(p + 2, n.numPoints, true);
    const [o, s] = proxy ? at.get(n) : [n.byteOffset, n.byteSize];
    dv.setBigUint64(p + 6, BigInt(o), true);
    dv.setBigUint64(p + 14, BigInt(s), true);
    p += REC;
  }
  return { bytes: u8, firstChunkSize: sizes[0], depth };
}

/** The tree back from hierarchy.bin (every chunk, proxies followed): nodes { name, level, box, numPoints, byteOffset, byteSize, children }. */
export function decodeHierarchy(bytes, firstChunkSize, cube) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const root = { name: 'r', level: 0, box: cube, numPoints: 0, byteOffset: 0, byteSize: 0, children: [] };
  const chunk = (top, at, size) => {
    const nodes = [top];
    for (let i = 0; i * REC < size; i++) {
      const p = at + i * REC;
      const n = nodes[i];
      const type = dv.getUint8(p);
      const mask = dv.getUint8(p + 1);
      n.numPoints = dv.getUint32(p + 2, true);
      const o = Number(dv.getBigUint64(p + 6, true));
      const s = Number(dv.getBigUint64(p + 14, true));
      if (type === 2) {
        chunk(n, o, s);
        continue;
      }
      n.byteOffset = o;
      n.byteSize = s;
      for (let c = 0; c < 8; c++) if (mask & (1 << c)) nodes.push((n.children[c] = { name: n.name + c, level: n.level + 1, box: childBox(n.box, c), numPoints: 0, byteOffset: 0, byteSize: 0, children: [] }));
    }
  };
  chunk(root, 0, firstChunkSize);
  return root;
}

/** Every node of a tree, depth first. */
export function* walk(node) {
  if (!node) return;
  yield node;
  for (const c of node.children) if (c) yield* walk(c);
}

// ---------------------------------------------------------------- which nodes to draw (#294)

const corners = (box) => {
  const out = [];
  for (let i = 0; i < 8; i++) out.push([i & 4 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 1 ? box.max[2] : box.min[2]]);
  return out;
};
/** A point through a column-major 4 × 4 matrix (three.js order). */
export const applyMatrix = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
/** Whether all of the points are on the outer side of a plane [nx, ny, nz, d] (inside: n·p + d ≥ 0). */
const outside = (pts, [a, b, c, d]) => pts.every(([x, y, z]) => a * x + b * y + c * z + d < 0);

/**
 * A node's size on screen: { px: its bounding sphere's radius in pixels, spacing: its point spacing in pixels,
 * distance, corners (world) }. camera: { position, projFactor (pixels per unit at distance 1: height / 2 tan(fov / 2)),
 * or ortho: pixels per unit }. matrix maps the cloud's coordinates to the world (column-major), scaleOf its scale.
 */
export function screenSize(node, camera, matrix, rootSpacing, scaleOf = 1) {
  const w = corners(node.box).map((p) => applyMatrix(matrix, p));
  const c = w.reduce((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8], [0, 0, 0]);
  const r = Math.hypot(w[0][0] - c[0], w[0][1] - c[1], w[0][2] - c[2]);
  const distance = Math.max(1e-6, Math.hypot(c[0] - camera.position[0], c[1] - camera.position[1], c[2] - camera.position[2]) - r);
  const k = camera.ortho ? camera.ortho : camera.projFactor / distance;
  return { px: r * k, spacing: spacingAt(rootSpacing, node.level) * scaleOf * k, distance, corners: w };
}

/**
 * The nodes to draw for a camera within a point budget, biggest on screen first, for several clouds sharing one
 * budget. A node is visited only when its parent is loaded (no holes: parents stay drawn while children load), skipped
 * outside the frustum or wholly clipped away, and refined while its spacing is over minSpacing pixels.
 * clouds: [{ id, root, matrix, rootSpacing, scale, loaded(node) }]; camera: { position, projFactor | ortho, planes:
 * frustum [[nx, ny, nz, d]…] }; clips: more planes [nx, ny, nz, d] (kept side n·p + d ≥ 0).
 * Returns { visible: [{ cloud, node }] (loaded, to draw), load: [{ cloud, node, priority }] (to fetch, most wanted
 * first), points }.
 */
export function selectNodes(clouds, camera, { budget = 3e6, minSpacing = 1, clips = [] } = {}) {
  const heap = [];
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].priority >= heap[i].priority) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < heap.length && heap[l].priority > heap[m].priority) m = l;
        if (r < heap.length && heap[r].priority > heap[m].priority) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const consider = (cloud, node) => {
    const s = screenSize(node, camera, cloud.matrix, cloud.rootSpacing, cloud.scale || 1);
    if ((camera.planes || []).some((pl) => outside(s.corners, pl))) return;
    if (clips.some((pl) => outside(s.corners, pl))) return;
    // the root always; a child only while its parent's points are still too far apart on screen
    push({ cloud, node, priority: node.level === 0 ? Infinity : s.px, size: s });
  };
  for (const cloud of clouds) if (cloud.root) consider(cloud, cloud.root);
  const visible = [];
  const load = [];
  let points = 0;
  while (heap.length) {
    const e = pop();
    if (points + e.node.numPoints > budget && points > 0) break;
    points += e.node.numPoints;
    if (!e.cloud.loaded(e.node)) {
      load.push({ cloud: e.cloud, node: e.node, priority: e.priority });
      continue;
    }
    visible.push({ cloud: e.cloud, node: e.node });
    if (e.size.spacing > minSpacing) for (const c of e.node.children) if (c) consider(e.cloud, c);
  }
  return { visible, load, points };
}
