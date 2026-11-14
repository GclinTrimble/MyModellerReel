// Point classes by hand (#299): the class edit layer and point selections. Pure, tested in tests/cloudselect.test.js.
//
// Edit layer: a cloud's octree (or preview) stays read-only. Each edit is a small delta asset (Assets.put) listed in
// order on pointcloud.edits, so the document's snapshot undo only keeps asset ids. A delta holds, per node name
// ('preview' for the thinned preview), either a dense class array (an automatic pass: every point of the node) or
// sparse entries (index, class, flags). Flags: LOCK (automatic passes leave the point alone), DELETED (class 7,
// hidden, left out on export). effective(base, flags, deltas, name) applies them in order.
//
// Selections: { nodes: Map name → { idx: Uint32Array (sorted), cls, flags, shadow } } where cls / flags are the
// points' state when selected and shadow marks the preview of an octree cloud (edited along, never counted).
// A source is what a selection reads: { nodes: [{ name, count, box: { min, max } (file axes), shadow? }],
// view(node) → Promise<{ count, exact (Float64 x, y, z file axes), classification, flags?, intensity?, returnNumber?,
// numberOfReturns? }> }.
import * as C from './classify.js';

export const LOCK = 1;
export const DELETED = 2;
/** The class keys of the Point Select tool: key → ASPRS code (the ten most used; 64 kerb and 65 vehicle are ours). */
export const CLASS_KEYS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 11, 9: 64, 0: 65 };

// ---------------------------------------------------------------- deltas

const MAGIC = 0x44524d4d; // 'MMRD'
let nonce = (Date.now() & 0xffffff) >>> 0;

/**
 * Bytes of a delta: nodes is a Map (or object) name → { dense: Uint8Array } | { idx: Uint32Array, cls: Uint8Array,
 * flags: Uint8Array }. A fresh nonce in the header keeps two identical-looking edits apart in the asset store.
 */
export function encodeDelta(nodes) {
  const list = [...(nodes instanceof Map ? nodes : Object.entries(nodes))];
  const enc = new TextEncoder();
  let size = 12;
  const names = list.map(([name, e]) => {
    const b = enc.encode(name);
    size += 1 + b.length + 1 + 4 + (e.dense ? e.dense.length : e.idx.length * 6);
    return b;
  });
  const u8 = new Uint8Array(size);
  const dv = new DataView(u8.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, (nonce = (nonce + 1) >>> 0), true);
  dv.setUint32(8, list.length, true);
  let at = 12;
  list.forEach(([, e], k) => {
    u8[at++] = names[k].length;
    u8.set(names[k], at);
    at += names[k].length;
    u8[at++] = e.dense ? 1 : 0;
    const n = e.dense ? e.dense.length : e.idx.length;
    dv.setUint32(at, n, true);
    at += 4;
    if (e.dense) u8.set(e.dense, at), (at += n);
    else {
      for (let i = 0; i < n; i++) dv.setUint32(at + i * 4, e.idx[i], true);
      at += n * 4;
      u8.set(e.cls, at);
      u8.set(e.flags, at + n);
      at += 2 * n;
    }
  });
  return u8;
}

/** A delta's nodes: Map name → { dense } | { idx, cls, flags }. */
export function decodeDelta(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a point class delta.');
  const dec = new TextDecoder();
  const out = new Map();
  let at = 12;
  for (let k = dv.getUint32(8, true); k > 0; k--) {
    const len = u8[at++];
    const name = dec.decode(u8.subarray(at, at + len));
    at += len;
    const dense = u8[at++] === 1;
    const n = dv.getUint32(at, true);
    at += 4;
    if (dense) out.set(name, { dense: u8.slice(at, at + n) }), (at += n);
    else {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = dv.getUint32(at + i * 4, true);
      at += n * 4;
      out.set(name, { idx, cls: u8.slice(at, at + n), flags: u8.slice(at + n, at + 2 * n) });
      at += 2 * n;
    }
  }
  return out;
}

/** Apply one node's entry to classes (and flags, if given) in place. */
export function applyEntry(e, classes, flags) {
  if (e.dense) {
    classes.set(e.dense.subarray(0, classes.length));
    return;
  }
  for (let i = 0; i < e.idx.length; i++) {
    const j = e.idx[i];
    if (j >= classes.length) continue;
    classes[j] = e.cls[i];
    if (flags) flags[j] = e.flags[i];
  }
}

/** A node's classes and flags after the deltas (decoded, in order): { classes, flags } (copies; base untouched). */
export function effective(base, count, deltas, name) {
  const classes = base ? Uint8Array.from(base) : new Uint8Array(count).fill(1);
  const flags = new Uint8Array(count);
  for (const d of deltas) {
    const e = d.get(name);
    if (e) applyEntry(e, classes, flags);
  }
  return { classes, flags };
}

/** Node names a list of deltas touches. */
export const touched = (deltas) => new Set(deltas.flatMap((d) => [...d.keys()]));

// ---------------------------------------------------------------- selections

const mat = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];

/** Point in polygon (even-odd), polygon [[x, y], …]. */
export function inPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-30) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A screen test: camera { view: file axes → camera (16 numbers, column major), proj: camera → clip } and a polygon in
 * screen fractions (0–1 from the left and top). Returns test(x, y, z) → depth in front of the camera (> 0) inside the
 * polygon, else 0, and cull(box) → false when a node box is wholly off the polygon or behind the camera.
 */
export function screenTest({ view, proj }, polygon) {
  const [x0, x1, y0, y1] = [Math.min(...polygon.map((p) => p[0])), Math.max(...polygon.map((p) => p[0])), Math.min(...polygon.map((p) => p[1])), Math.max(...polygon.map((p) => p[1]))];
  const screen = (x, y, z) => {
    const c = mat(view, x, y, z);
    if (c[2] >= 0) return null; // behind the camera (it looks down −z)
    const k = mat(proj, c[0], c[1], c[2]);
    return [(k[0] / k[3] + 1) / 2, (1 - k[1] / k[3]) / 2, -c[2]];
  };
  const test = (x, y, z) => {
    const s = screen(x, y, z);
    return s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1 && inPolygon(polygon, s[0], s[1]) ? s[2] : 0;
  };
  const cull = (b) => {
    const pts = [];
    for (let k = 0; k < 8; k++) pts.push(screen(k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]));
    if (pts.some((p) => !p)) return true; // straddles the camera: look inside
    return Math.max(...pts.map((p) => p[0])) >= x0 && Math.min(...pts.map((p) => p[0])) <= x1 && Math.max(...pts.map((p) => p[1])) >= y0 && Math.min(...pts.map((p) => p[1])) <= y1;
  };
  return { test, cull, screen };
}

const RETURNS = { first: (r) => r === 1, last: (r, n) => r === n, only: (r, n) => n === 1 };

/**
 * Select points of a source. q: { screen: { camera, polygon }, front_only, pixels: [w, h] (for front_only), within
 * (a world point test (x, y, z) on file axes), box ({ min, max } file axes, to cull nodes for within), classes,
 * intensity [lo, hi], elevation [lo, hi], returns }. Deleted points are never selected. Returns a selection.
 */
export async function select(source, q = {}, onProgress = null) {
  const scr = q.screen ? screenTest(q.screen.camera, q.screen.polygon) : null;
  const cls = q.classes ? new Set(q.classes) : null;
  const ret = q.returns ? RETURNS[q.returns] : null;
  const keep = (v, i) => {
    const [x, y, z] = [v.exact[i * 3], v.exact[i * 3 + 1], v.exact[i * 3 + 2]];
    if (v.flags && v.flags[i] & DELETED) return false;
    if (cls && !cls.has(v.classification ? v.classification[i] : 1)) return false;
    if (q.intensity && v.intensity && (v.intensity[i] < q.intensity[0] || v.intensity[i] > q.intensity[1])) return false;
    if (q.elevation && (z < q.elevation[0] || z > q.elevation[1])) return false;
    if (ret && v.returnNumber && !ret(v.returnNumber[i], v.numberOfReturns[i])) return false;
    if (q.within && !q.within(x, y, z)) return false;
    return true;
  };
  const found = [];
  let done = 0;
  for (const node of source.nodes) {
    done++;
    if (scr && node.box && !scr.cull(node.box)) continue;
    if (q.box && node.box && (node.box.max[0] < q.box.min[0] || node.box.min[0] > q.box.max[0] || node.box.max[1] < q.box.min[1] || node.box.min[1] > q.box.max[1] || node.box.max[2] < q.box.min[2] || node.box.min[2] > q.box.max[2])) continue;
    if (q.elevation && node.box && (node.box.max[2] < q.elevation[0] || node.box.min[2] > q.elevation[1])) continue;
    const v = await source.view(node);
    const idx = [];
    const depth = [];
    for (let i = 0; i < v.count; i++) {
      if (!keep(v, i)) continue;
      if (scr) {
        const d = scr.test(v.exact[i * 3], v.exact[i * 3 + 1], v.exact[i * 3 + 2]);
        if (!d) continue;
        depth.push(d);
      }
      idx.push(i);
    }
    if (idx.length) found.push({ node, v, idx: Uint32Array.from(idx), depth: scr ? Float32Array.from(depth) : null });
    onProgress?.(done / source.nodes.length);
  }
  if (scr && q.front_only) frontOnly(found, scr, q.pixels || [1600, 900], q.depth_tolerance);
  const nodes = new Map();
  for (const f of found) {
    if (!f.idx.length) continue;
    nodes.set(f.node.name, { idx: f.idx, cls: Uint8Array.from(f.idx, (i) => (f.v.classification ? f.v.classification[i] : 1)), flags: Uint8Array.from(f.idx, (i) => (f.v.flags ? f.v.flags[i] : 0)), shadow: !!f.node.shadow, stats: statsOf(f.v, f.idx) });
  }
  return { nodes };
}

/**
 * Keep only the front-most points: a depth buffer over the screen holds the nearest depth of the candidates (the octree
 * points, not the shadow preview) per cell, its cells as big as the candidates' spacing on screen (so a surface has no
 * holes) and spread once to their neighbours; a point stays within tolerance of it (default 2 % of the depth, at
 * least 0.3 m).
 */
function frontOnly(found, scr, [w, h], tol = null) {
  const shadowOnly = found.every((f) => f.node.shadow);
  const use = found.filter((f) => !f.node.shadow || shadowOnly);
  let [x0, y0, x1, y1, n] = [Infinity, Infinity, -Infinity, -Infinity, 0];
  for (const f of found) {
    f.sx = new Float32Array(f.idx.length);
    f.sy = new Float32Array(f.idx.length);
    f.idx.forEach((i, k) => {
      const p = scr.screen(f.v.exact[i * 3], f.v.exact[i * 3 + 1], f.v.exact[i * 3 + 2]);
      f.sx[k] = p[0] * w;
      f.sy[k] = p[1] * h;
    });
    if (!use.includes(f)) continue;
    n += f.idx.length;
    for (let k = 0; k < f.idx.length; k++) (x0 = Math.min(x0, f.sx[k])), (x1 = Math.max(x1, f.sx[k])), (y0 = Math.min(y0, f.sy[k])), (y1 = Math.max(y1, f.sy[k]));
  }
  if (!n) return;
  const cell = Math.max(2, 1.5 * Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / n));
  const [nx, ny] = [Math.ceil(w / cell) + 1, Math.ceil(h / cell) + 1];
  const at = (x, y) => Math.min(ny - 1, Math.max(0, Math.floor(y / cell))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(x / cell)));
  const z0 = new Float32Array(nx * ny).fill(Infinity);
  for (const f of use) for (let k = 0; k < f.idx.length; k++) {
    const c = at(f.sx[k], f.sy[k]);
    if (f.depth[k] < z0[c]) z0[c] = f.depth[k];
  }
  const zbuf = z0.slice();
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [a, b] = [x + dx, y + dy];
          if (a >= 0 && b >= 0 && a < nx && b < ny && z0[b * nx + a] < zbuf[y * nx + x]) zbuf[y * nx + x] = z0[b * nx + a];
        }
  for (const f of found) {
    const keep = [];
    f.idx.forEach((i, k) => {
      const z = zbuf[at(f.sx[k], f.sy[k])];
      if (f.depth[k] <= z + (tol ?? Math.max(0.3, 0.02 * z))) keep.push(i);
    });
    f.idx = Uint32Array.from(keep);
  }
}

/** Statistics of the points idx of a view: { count, classes: { code: n }, min, max, intensity_sum }. */
function statsOf(v, idx) {
  const s = { count: idx.length, classes: {}, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], intensity_sum: 0 };
  for (const i of idx) {
    const c = v.classification ? v.classification[i] : 1;
    s.classes[c] = (s.classes[c] || 0) + 1;
    for (let k = 0; k < 3; k++) {
      const x = v.exact[i * 3 + k];
      if (x < s.min[k]) s.min[k] = x;
      if (x > s.max[k]) s.max[k] = x;
    }
    if (v.intensity) s.intensity_sum += v.intensity[i];
  }
  return s;
}

/** A selection's statistics (the shadow preview left out): { points, classes, bounds, mean_intensity }. */
export function selectionStats(sel) {
  const out = { points: 0, classes: {}, bounds: null, mean_intensity: null };
  let isum = 0;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const e of sel.nodes.values()) {
    if (e.shadow) continue;
    if (!e.stats) {
      // combined selections keep the classes of their points, not their bounds
      out.points += e.idx.length;
      for (const c of e.cls) out.classes[c] = (out.classes[c] || 0) + 1;
      continue;
    }
    out.points += e.stats.count;
    for (const [c, n] of Object.entries(e.stats.classes)) out.classes[c] = (out.classes[c] || 0) + n;
    min = min.map((v, k) => Math.min(v, e.stats.min[k]));
    max = max.map((v, k) => Math.max(v, e.stats.max[k]));
    isum += e.stats.intensity_sum;
  }
  const measured = [...sel.nodes.values()].filter((e) => !e.shadow && e.stats).reduce((t, e) => t + e.stats.count, 0);
  if (measured) (out.bounds = { min, max }), (out.mean_intensity = Math.round(isum / measured));
  return out;
}

/** Merge b into a: 'set' (b), 'add' (union) or 'remove' (a minus b). Entries carry idx, cls, flags, shadow, stats. */
export function combine(a, b, mode = 'set') {
  if (mode === 'set' || !a) return b;
  const out = new Map(a.nodes);
  for (const [name, e] of b.nodes) {
    const cur = out.get(name);
    if (mode === 'add') out.set(name, cur ? union(cur, e) : e);
    else if (cur) {
      const drop = new Set(e.idx);
      const keep = [];
      cur.idx.forEach((i, k) => !drop.has(i) && keep.push(k));
      if (keep.length) out.set(name, pick(cur, keep));
      else out.delete(name);
    }
  }
  return { nodes: out };
}

const pick = (e, ks) => ({ idx: Uint32Array.from(ks, (k) => e.idx[k]), cls: Uint8Array.from(ks, (k) => e.cls[k]), flags: Uint8Array.from(ks, (k) => e.flags[k]), shadow: e.shadow, stats: null });
function union(a, b) {
  const m = new Map();
  a.idx.forEach((i, k) => m.set(i, [a.cls[k], a.flags[k]]));
  b.idx.forEach((i, k) => m.set(i, [b.cls[k], b.flags[k]]));
  const idx = Uint32Array.from([...m.keys()].sort((x, y) => x - y));
  return { idx, cls: Uint8Array.from(idx, (i) => m.get(i)[0]), flags: Uint8Array.from(idx, (i) => m.get(i)[1]), shadow: a.shadow, stats: null };
}

/** Every point of the source not in sel (deleted points left out). */
export async function invert(source, sel) {
  const all = await select(source, {});
  return combine(all, sel, 'remove');
}

/** Points in a selection (the shadow preview left out). */
export const countOf = (sel) => [...(sel?.nodes.values() || [])].reduce((s, e) => s + (e.shadow ? 0 : e.idx.length), 0);

/**
 * Grow from a spot (file axes) over the points on its plane (#299 grow): the points within radius of it (the shadow
 * preview apart) gathered, their normals, growPlane from the nearest point. A wall grows to its corners. Returns a
 * selection; the shadow preview takes the points within a few centimetres of a grown one.
 */
export async function grow(source, at, { angle = 12, distance = 0.08, radius = 30, maxPoints = 3e6 } = {}) {
  const box = { min: [at[0] - radius, at[1] - radius, at[2] - radius], max: [at[0] + radius, at[1] + radius, at[2] + radius] };
  const r2 = radius * radius;
  const parts = [];
  let total = 0;
  for (const node of source.nodes) {
    if (node.shadow || (node.box && (node.box.max[0] < box.min[0] || node.box.min[0] > box.max[0] || node.box.max[1] < box.min[1] || node.box.min[1] > box.max[1] || node.box.max[2] < box.min[2] || node.box.min[2] > box.max[2]))) continue;
    const v = await source.view(node);
    const idx = [];
    for (let i = 0; i < v.count && total < maxPoints; i++) {
      if (v.flags && v.flags[i] & DELETED) continue;
      const [dx, dy, dz] = [v.exact[i * 3] - at[0], v.exact[i * 3 + 1] - at[1], v.exact[i * 3 + 2] - at[2]];
      if (dx * dx + dy * dy + dz * dz <= r2) idx.push(i), total++;
    }
    if (idx.length) parts.push({ node, v, idx });
  }
  if (!total) return { nodes: new Map() };
  const pos = new Float64Array(total * 3);
  const owner = [];
  let k = 0;
  for (const p of parts) for (const i of p.idx) pos.set(p.v.exact.subarray(i * 3, i * 3 + 3), k * 3), owner.push([p, i]), k++;
  // the neighbourhood scale from how far apart the gathered points are near the spot
  const g0 = C.voxelGrid(pos, Math.max(0.05, radius / 50), total);
  const seed = C.neighboursAt(g0, at[0], at[1], at[2], { k: 1 })[0];
  const near = C.neighboursAt(g0, at[0], at[1], at[2], { k: 16 });
  const sp = Math.max(0.02, Math.sqrt([...near].reduce((s, j) => s + (pos[j * 3] - pos[seed * 3]) ** 2 + (pos[j * 3 + 1] - pos[seed * 3 + 1]) ** 2 + (pos[j * 3 + 2] - pos[seed * 3 + 2]) ** 2, 0) / near.length));
  const g = C.voxelGrid(pos, Math.max(0.03, sp), total);
  const f = C.pointFeatures(g, { k: 12 });
  const got = C.growPlane(g, f.normal, seed, { angle, distance, radius: 2.5 * sp });
  const grown = new Uint8Array(total);
  for (const j of got) grown[j] = 1;
  const by = new Map();
  for (const j of got) {
    const [p, i] = owner[j];
    if (!by.has(p)) by.set(p, []);
    by.get(p).push(i);
  }
  const nodes = new Map();
  for (const [p, list] of by) {
    const idx = Uint32Array.from(list.sort((a, b) => a - b));
    nodes.set(p.node.name, { idx, cls: Uint8Array.from(idx, (i) => (p.v.classification ? p.v.classification[i] : 1)), flags: Uint8Array.from(idx, (i) => (p.v.flags ? p.v.flags[i] : 0)), shadow: false, stats: statsOf(p.v, idx) });
  }
  // the shadow preview: its points on a grown point
  for (const node of source.nodes.filter((n) => n.shadow)) {
    const v = await source.view(node);
    const idx = [];
    for (let i = 0; i < v.count; i++) {
      const [x, y, z] = [v.exact[i * 3], v.exact[i * 3 + 1], v.exact[i * 3 + 2]];
      if ((x - at[0]) ** 2 + (y - at[1]) ** 2 + (z - at[2]) ** 2 > r2) continue;
      const nb = C.neighboursAt(g, x, y, z, { k: 1 });
      if (nb.length && grown[nb[0]] && (pos[nb[0] * 3] - x) ** 2 + (pos[nb[0] * 3 + 1] - y) ** 2 + (pos[nb[0] * 3 + 2] - z) ** 2 < 1e-4) idx.push(i);
    }
    if (idx.length) nodes.set(node.name, { idx: Uint32Array.from(idx), cls: Uint8Array.from(idx, (i) => (v.classification ? v.classification[i] : 1)), flags: Uint8Array.from(idx, (i) => (v.flags ? v.flags[i] : 0)), shadow: true, stats: null });
  }
  return { nodes };
}

/**
 * The delta of setting a selection's points to cls (null: keep each point's class) with lock true / false / undefined
 * (keep), or deleted. Returns { delta: Map, counts: { code: ±n } (the shadow preview left out), changed }.
 */
export function editOf(sel, { cls = null, lock, deleted = false } = {}) {
  const delta = new Map();
  const counts = {};
  let changed = 0;
  for (const [name, e] of sel.nodes) {
    const n = e.idx.length;
    const out = { idx: e.idx, cls: new Uint8Array(n), flags: new Uint8Array(n) };
    for (let k = 0; k < n; k++) {
      let f = e.flags[k];
      if (lock === true) f |= LOCK;
      if (lock === false) f &= ~LOCK;
      if (deleted) f |= DELETED;
      const c = deleted ? 7 : cls ?? e.cls[k];
      out.cls[k] = c;
      out.flags[k] = f;
      if (!e.shadow && c !== e.cls[k]) {
        counts[e.cls[k]] = (counts[e.cls[k]] || 0) - 1;
        counts[c] = (counts[c] || 0) + 1;
        changed++;
      }
    }
    delta.set(name, out);
  }
  return { delta, counts, changed };
}

/** After an edit, the selection holds the new state (so a second key press counts from it). */
export function afterEdit(sel, delta) {
  for (const [name, d] of delta) {
    const e = sel.nodes.get(name);
    if (e) (e.cls = d.cls), (e.flags = d.flags);
  }
}

const decoded = new Map();
/** The decoded deltas of a list of asset ids (decoded once each: assets never change). */
export const deltasFor = (ids = [], bytesOf) => ids.map((id) => decoded.get(id) || decoded.set(id, decodeDelta(bytesOf(id))).get(id));
