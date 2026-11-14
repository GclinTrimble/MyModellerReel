// Clip volumes (#290): planes, slabs and boxes in any orientation that hide part of the model, combined. Kept on
// doc.clips; the renderer discards fragments with the same test (src/renderer/clipshader.js), picking and labels use
// visible(). A plane cuts away its normal side; a slab keeps what lies within thickness / 2 of its point; a box keeps
// what is inside (or outside) its rotated extent. Inside boxes combine by settings.clip_combine: any (union) | all.
import { Matrix4, Euler, Quaternion, Vector3 } from 'three';
import * as G from './geometry.js';
import * as D from './document.js';
import * as SEC from './section.js';

export const KINDS = ['plane', 'slab', 'box'];
export const LIMITS = { plane: 8, slab: 4, box: 8 }; // the shader's uniform arrays
export const BIT0 = { plane: 0, slab: 8, box: 12 }; // first mask bit of each kind
const D2R = Math.PI / 180;
const r4 = (x) => Math.round(x * 1e4) / 1e4 || 0;
const r4v = (v) => v.map(r4);

/** A clip with every field filled in (normals unit length, sizes positive). */
export function normalize(c) {
  if (!KINDS.includes(c.kind)) throw new Error(`Clip kind must be ${KINDS.join(', ')}; got ${JSON.stringify(c.kind)}.`);
  const out = { name: c.name || 'Clip', kind: c.kind, enabled: c.enabled !== false };
  if (c.kind === 'box') {
    out.center = c.center || [0, 0, 0];
    out.size = (c.size || [10, 10, 10]).map((x) => Math.max(1e-3, Math.abs(x)));
    out.rotation = c.rotation || [0, 0, 0];
    out.keep = c.keep === 'outside' ? 'outside' : 'inside';
  } else {
    out.point = c.point || [0, 0, 0];
    const n = c.normal || (c.kind === 'slab' ? [0, 1, 0] : [0, -1, 0]);
    if (!(G.len(n) > 1e-9)) throw new Error('A clip normal cannot be [0, 0, 0].');
    out.normal = r4v(G.norm(n));
    if (c.kind === 'slab') out.thickness = Math.max(1e-3, Math.abs(c.thickness ?? 1));
  }
  for (const k of ['ids', 'layers', 'panes']) if (c[k]?.length) out[k] = [...c[k]];
  return out;
}

/** The rotation matrix of a box (degrees, XYZ like entity rotations). */
export const rotationMatrix = (rot = [0, 0, 0]) => new Matrix4().makeRotationFromEuler(new Euler(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R));
/** A box's local axes in world space: [x, y, z]. */
export function axes(c) {
  const e = rotationMatrix(c.rotation).elements;
  return [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
}
/** Rotation degrees (XYZ) of a rotation matrix. */
export const eulerOf = (m) => {
  const e = new Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z].map((x) => r4(x / D2R));
};
/** World → box local (unit = metres), for the shader and inside(). */
export const inverseMatrix = (c) => new Matrix4().compose(new Vector3(...c.center), new Quaternion().setFromRotationMatrix(rotationMatrix(c.rotation)), new Vector3(1, 1, 1)).invert();

/** The bounding planes with outward normals: a box six (face: '+x', '-x', …), a slab two, a plane one. */
export function planesOf(c) {
  if (c.kind === 'plane') return [{ point: c.point, normal: c.normal, face: '+n' }];
  if (c.kind === 'slab') {
    const h = c.thickness / 2;
    return [
      { point: G.add(c.point, G.scl(c.normal, h)), normal: c.normal, face: '+n' },
      { point: G.add(c.point, G.scl(c.normal, -h)), normal: G.scl(c.normal, -1), face: '-n' },
    ];
  }
  const ax = axes(c);
  return ax.flatMap((a, k) => [1, -1].map((s) => ({ point: r4v(G.add(c.center, G.scl(a, (s * c.size[k]) / 2))), normal: r4v(G.scl(a, s)), face: `${s > 0 ? '+' : '-'}${'xyz'[k]}` })));
}

/** The point in the box's local frame. */
export const toLocal = (c, p) => new Vector3(...p).applyMatrix4(inverseMatrix(c)).toArray();

/** A fast test (x, y, z) → inside the box / slab, or on the kept side of the plane (a box's keep is ignored). */
export function tester(c) {
  if (c.kind !== 'box') {
    const [a, b, z] = c.normal;
    const d = G.dot(c.normal, c.point);
    const h = c.thickness / 2 + 1e-9;
    return c.kind === 'plane' ? (x, y, w) => a * x + b * y + z * w - d <= 1e-9 : (x, y, w) => Math.abs(a * x + b * y + z * w - d) <= h;
  }
  const e = inverseMatrix(c).elements;
  const [hx, hy, hz] = c.size.map((s) => s / 2 + 1e-9);
  return (x, y, z) => Math.abs(e[0] * x + e[4] * y + e[8] * z + e[12]) <= hx && Math.abs(e[1] * x + e[5] * y + e[9] * z + e[13]) <= hy && Math.abs(e[2] * x + e[6] * y + e[10] * z + e[14]) <= hz;
}
const inBox = (c, p) => tester(c)(...p);

/** Does this one clip keep p (on its own, before combining)? */
export const inside = (c, p) => (c.kind === 'box' ? inBox(c, p) === (c.keep !== 'outside') : tester(c)(...p));

const ancestors = (doc, e) => {
  const out = [];
  for (let x = e; x; x = x.parent && D.getEntity(doc, x.parent)) out.push(x);
  return out;
};
/** Does the clip cut this entity (ids / layers scope)? No entity: only unscoped clips. */
export function inScope(doc, c, entity) {
  if (!c.ids?.length && !c.layers?.length) return true;
  if (!entity) return false;
  const chain = ancestors(doc, entity);
  return !!(c.ids?.some((id) => chain.some((x) => x.id === id || x.name === id)) || c.layers?.some((l) => chain.some((x) => x.tag === l)));
}
/** Does the clip cut this pane (1-based)? */
export const inPane = (c, pane = 1) => !c.panes?.length || c.panes.includes(pane);

/** Is p shown in this pane for this entity, with every clip combined? */
export function visible(doc, p, { pane = 1, entity = null, clips = clipsOf(doc) } = {}) {
  let inner = false;
  let any = false;
  let all = true;
  for (const c0 of clips) {
    if (c0.enabled === false || !inPane(c0, pane) || !inScope(doc, c0, entity)) continue;
    const c = normalize(c0);
    if (c.kind === 'box' && c.keep === 'inside') {
      const k = inBox(c, p);
      inner = true;
      any ||= k;
      all &&= k;
    } else if (!inside(c, p)) return false;
  }
  if (!inner) return true;
  return doc.settings?.clip_combine === 'all' ? all : any;
}

/** A section plane ({ name, normal, point }) as a clip of kind plane. */
export const fromSection = (s, enabled = true) => normalize({ name: s.name || 'Section 1', kind: 'plane', point: s.point || [0, 0, 0], normal: s.normal || [0, -1, 0], enabled });

/** The clips of a document, reading section planes of older files (without changing the document). */
export function clipsOf(doc) {
  if (doc.clips) return doc.clips;
  const s = doc.settings || {};
  if (s.section_planes?.length) return s.section_planes.map((p) => fromSection(p, p.name === s.section_active && !!s.section));
  if (s.section) return [fromSection({ name: 'Section 1', ...s.section })];
  return [];
}
/** Move section planes into doc.clips, once (an older file opens with the same cut). */
export function migrate(doc) {
  if (doc.clips) return doc.clips;
  const s = doc.settings;
  doc.clips = clipsOf(doc).map((c) => ({ ...c }));
  if (s && !s.section_planes?.length && s.section) s.section_active = 'Section 1';
  if (s) delete s.section_planes;
  return doc.clips;
}

/**
 * The shader's slots: enabled clips by kind, up to LIMITS each, and each clip's mask bit. Clips beyond the limits are
 * left out (add_clip refuses them).
 */
export function slots(doc, clips = clipsOf(doc)) {
  const out = { plane: [], slab: [], box: [], bit: new Map() };
  for (const c0 of clips) {
    if (c0.enabled === false || !KINDS.includes(c0.kind) || out[c0.kind].length >= LIMITS[c0.kind]) continue;
    const c = normalize(c0);
    out.bit.set(c.name, BIT0[c.kind] + out[c.kind].length);
    out[c.kind].push(c);
  }
  return out;
}
/** Mask bits of the clips that cut an entity (all bits on for unscoped clips). */
export function scopeMask(doc, sl, entity) {
  let m = -1;
  for (const k of KINDS) for (const c of sl[k]) if (!inScope(doc, c, entity)) m &= ~(1 << sl.bit.get(c.name));
  return m;
}
/** Mask bits of the clips that cut a pane. */
export function paneMask(sl, pane = 1) {
  let m = 0;
  for (const k of KINDS) for (const c of sl[k]) if (inPane(c, pane)) m |= 1 << sl.bit.get(c.name);
  return m;
}

/** A box around world bounds with a margin on every side. */
export function fitBox(b, margin = 0.5) {
  if (!b || !(b.min[0] <= b.max[0])) throw new Error('Nothing to fit the clip to.');
  return { center: r4v(b.min.map((v, k) => (v + b.max[k]) / 2)), size: r4v(b.min.map((v, k) => Math.max(1e-3, b.max[k] - v + 2 * margin))) };
}

/** A clip with its animated fields (pose = evaluate(doc, t)['clip:<name>']). */
export const withPose = (c, p) => (p ? { ...c, ...Object.fromEntries(['center', 'size', 'rotation', 'point', 'normal', 'thickness'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) } : c);

/** Keep the part of a 3D ring on the kept side (dot(n, p - point) <= 0) of each plane (Sutherland–Hodgman). */
export function clipRing(ring, planes) {
  let out = ring;
  for (const { point, normal } of planes) {
    const d = (p) => G.dot(G.sub(p, point), normal);
    const src = out;
    out = [];
    src.forEach((a, i) => {
      const b = src[(i + 1) % src.length];
      const da = d(a);
      const db = d(b);
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(G.add(a, G.scl(G.sub(b, a), da / (da - db))));
    });
    if (out.length < 3) return [];
  }
  return out;
}

/**
 * The section fill of a clip, per cutting face: [{ face, point, normal (the cut-away side), frame, cuts }] where
 * cuts are SEC.sectionCut's ({ id, color, loops (world), areas (face frame) }), clipped to a box face's rectangle.
 */
export function capLoops(doc, c0, opts = {}) {
  const c = normalize(c0);
  const ids = c.ids || c.layers ? doc.entities.filter((e) => inScope(doc, c, e)).map((e) => e.id) : opts.ids || null;
  const faces = planesOf(c);
  return faces.map((f) => {
    const normal = c.kind === 'box' && c.keep === 'outside' ? G.scl(f.normal, -1) : f.normal;
    const cut = SEC.sectionCut(doc, { point: f.point, normal }, { ids });
    if (c.kind === 'box') {
      const sides = faces.filter((g) => g.face[1] !== f.face[1]);
      const to2 = (p) => [G.dot(G.sub(p, f.point), cut.frame.u), G.dot(G.sub(p, f.point), cut.frame.v)];
      cut.cuts = cut.cuts
        .map((x) => {
          const loops = x.loops.map((l) => clipRing(l, sides)).filter((l) => l.length >= 3);
          return loops.length ? { ...x, loops, areas: SEC.nestRings(loops.map((l) => l.map(to2))) } : null;
        })
        .filter(Boolean);
    }
    return { face: f.face, point: f.point, normal, frame: cut.frame, cuts: cut.cuts };
  });
}

/**
 * New orientation fields for a clip (#291): to 'points' (the box X axis follows p1 → p2, Y up; a plane / slab turns
 * square to the line), 'face' (the nearest box axis, or the normal, lines up with a face normal), 'view' (faces the
 * camera looking along dir) or 'level' (tilt removed, heading kept).
 */
export function align(c0, to, { points, normal, dir } = {}) {
  const c = normalize(c0);
  const box = c.kind === 'box';
  if (to === 'points') {
    if (points?.length !== 2) throw new Error("align_clip to 'points' needs two points.");
    const d = G.sub(points[1], points[0]);
    if (Math.hypot(d[0], d[2]) < 1e-9) throw new Error('The two points are on one vertical: they give no direction.');
    if (box) return { rotation: [0, r4(Math.atan2(-d[2], d[0]) / D2R), 0] };
    let n = G.norm([-d[2], 0, d[0]]);
    if (G.dot(n, c.normal) < 0) n = G.scl(n, -1);
    return { normal: r4v(n), point: points[0] };
  }
  if (to === 'face') {
    if (!normal) throw new Error("align_clip to 'face' needs a face (id and face) or a normal.");
    const n = G.norm(normal);
    if (!box) return { normal: r4v(G.dot(n, c.normal) < 0 && c.kind === 'slab' ? G.scl(n, -1) : n) };
    const ax = axes(c);
    let k = 0;
    ax.forEach((a, i) => Math.abs(G.dot(a, n)) > Math.abs(G.dot(ax[k], n)) && (k = i));
    const from = G.scl(ax[k], Math.sign(G.dot(ax[k], n)) || 1);
    const q = new Quaternion().setFromUnitVectors(new Vector3(...from), new Vector3(...n));
    return { rotation: eulerOf(new Matrix4().makeRotationFromQuaternion(q).multiply(rotationMatrix(c.rotation))) };
  }
  if (to === 'view') {
    if (!dir) throw new Error("align_clip to 'view' needs the view direction.");
    const z = G.norm(G.scl(dir, -1)); // towards the camera
    if (!box) return { normal: r4v(z) };
    let x = G.cross([0, 1, 0], z);
    x = G.len(x) < 1e-6 ? [1, 0, 0] : G.norm(x);
    const y = G.cross(z, x);
    return { rotation: eulerOf(new Matrix4().makeBasis(new Vector3(...x), new Vector3(...y), new Vector3(...z))) };
  }
  if (to === 'level') {
    if (!box) {
      const n = c.normal;
      return { normal: Math.abs(n[1]) >= Math.SQRT1_2 ? [0, Math.sign(n[1]), 0] : r4v(G.norm([n[0], 0, n[2]])) };
    }
    const ax = axes(c);
    const h = Math.hypot(ax[0][0], ax[0][2]) > 1e-6 ? ax[0] : G.cross(ax[2], [0, 1, 0]);
    return { rotation: [0, r4(Math.atan2(-h[2], h[0]) / D2R), 0] };
  }
  throw new Error(`align_clip to must be points, face, view or level; got ${JSON.stringify(to)}.`);
}

/**
 * A face moved along its outward normal by dist (#291): the opposite face stays, or with symmetric both move.
 * A box: face '+x' … '-z' → { center, size }; a slab: '+n' | '-n' → { point, thickness }; a plane → { point }.
 */
export function pushFace(c0, face, dist, { symmetric = false } = {}) {
  const c = normalize(c0);
  if (c.kind === 'plane') return { point: r4v(G.add(c.point, G.scl(c.normal, dist))) };
  if (c.kind === 'slab') {
    const thickness = Math.max(1e-3, c.thickness + (symmetric ? 2 : 1) * dist);
    const shift = symmetric ? 0 : ((face === '-n' ? -1 : 1) * (thickness - c.thickness)) / 2;
    return { point: r4v(G.add(c.point, G.scl(c.normal, shift))), thickness: r4(thickness) };
  }
  const k = 'xyz'.indexOf(face[1]);
  const s = face[0] === '-' ? -1 : 1;
  const size = [...c.size];
  const grow = symmetric ? 2 * dist : dist;
  size[k] = Math.max(1e-3, size[k] + grow);
  const moved = symmetric ? 0 : (size[k] - c.size[k]) / 2;
  const r6 = (v) => v.map((x) => Math.round(x * 1e6) / 1e6 || 0); // finer than r4: the face that stays must not drift
  return { center: r6(G.add(c.center, G.scl(axes(c)[k], s * moved))), size: r6(size) };
}
