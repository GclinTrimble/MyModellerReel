// COPC (#293): a Cloud Optimized Point Cloud is a LAZ 1.4 file whose chunks are octree nodes, read in place without
// conversion (https://copc.io, open spec). The info VLR gives the cube and spacing, the hierarchy EVLR pages give each
// node's byte range; the nodes are named and boxed like Potree's (octree.js), so the viewer streams both the same way.

import { childBox } from './octree.js';

/** The COPC info VLR ("copc", 1) of a parsed LAS header, or null when the file is not COPC. */
export function copcInfo(h) {
  const v = h.vlrs.find((r) => r.user === 'copc' && r.record === 1);
  if (!v || v.data.length < 160) return null;
  const dv = new DataView(v.data.buffer, v.data.byteOffset, v.data.byteLength);
  const f = (o) => dv.getFloat64(o, true);
  const [cx, cy, cz, half] = [f(0), f(8), f(16), f(24)];
  return { center: [cx, cy, cz], halfSize: half, spacing: f(32), rootAt: Number(dv.getBigUint64(40, true)), rootSize: Number(dv.getBigUint64(48, true)), gpsTime: [f(56), f(64)], cube: { min: [cx - half, cy - half, cz - half], max: [cx + half, cy + half, cz + half] } };
}

/** A COPC key (depth, x, y, z) as a Potree node name: r and one child digit per level, x 4, y 2, z 1. */
export function keyName(d, x, y, z) {
  let n = 'r';
  for (let k = d - 1; k >= 0; k--) n += ((((x >> k) & 1) << 2) | (((y >> k) & 1) << 1) | ((z >> k) & 1)).toString();
  return n;
}

/**
 * Every node of a COPC file: the root, its descendants as children[8], each { name, level, box, numPoints,
 * byteOffset, byteSize }. readRange(at, length) → Uint8Array.
 */
export function copcHierarchy(info, readRange) {
  const byName = new Map();
  const pages = [[info.rootAt, info.rootSize]];
  while (pages.length) {
    const [at, size] = pages.pop();
    const u8 = readRange(at, size);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (let p = 0; p + 32 <= size; p += 32) {
      const [d, x, y, z] = [0, 4, 8, 12].map((o) => dv.getInt32(p + o, true));
      const offset = Number(dv.getBigUint64(p + 16, true));
      const bytes = dv.getInt32(p + 24, true);
      const count = dv.getInt32(p + 28, true);
      if (count === -1) pages.push([offset, bytes]);
      else byName.set(keyName(d, x, y, z), { level: d, numPoints: count, byteOffset: offset, byteSize: bytes });
    }
  }
  const root = { name: 'r', level: 0, box: info.cube, numPoints: 0, byteOffset: 0, byteSize: 0, children: [] };
  const make = (name, parent, i) => {
    const node = { name, level: parent ? parent.level + 1 : 0, box: parent ? childBox(parent.box, i) : info.cube, numPoints: 0, byteOffset: 0, byteSize: 0, children: [] };
    if (parent) parent.children[i] = node;
    return node;
  };
  // nodes may come in any order; empty ones (0 points) still hold up their children
  const nodes = new Map([['r', root]]);
  const get = (name) => {
    if (nodes.has(name)) return nodes.get(name);
    const parent = get(name.slice(0, -1));
    const n = make(name, parent, +name.at(-1));
    nodes.set(name, n);
    return n;
  };
  for (const [name, v] of byName) Object.assign(get(name), v);
  return root;
}
