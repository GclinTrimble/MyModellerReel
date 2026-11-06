// The model document: plain JSON so it can be saved inside a GLB, diffed, sent to an AI and undone by snapshot.
import { Matrix4, Euler, Quaternion, Vector3 } from 'three';
import { bbox } from './geometry.js';

export const DEFAULT_COLOR = '#d9d4c7';

export function newDoc() {
  return {
    format: 'mymodellerreel',
    version: 1,
    nextId: 1,
    entities: [],
    tags: [{ name: 'Untagged', visible: true }],
    scenes: [],
    animation: { duration: 10, fps: 30, tracks: [] },
    settings: {
      edges: true,
      xray: false,
      wireframe: false,
      shadows: true,
      grid: true,
      sun: { azimuth: 135, elevation: 50 },
      section: null, // { normal:[x,y,z], point:[x,y,z] }
    },
    camera: { position: [9, 7, 11], target: [0, 1, 0], fov: 45 },
  };
}

/** Undoable store. Every mutating command takes a snapshot first; undo swaps snapshots. */
export class Store {
  constructor(doc = newDoc()) {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }
  checkpoint() {
    this.undoStack.push(JSON.stringify(this.doc));
    if (this.undoStack.length > 200) this.undoStack.shift(); // shortcut: whole-doc snapshots, fine below ~50 MB models
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.undoStack.pop());
    this.changed();
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.redoStack.pop());
    this.changed();
    return true;
  }
  replace(doc) {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
  }
  changed() {
    for (const fn of this.listeners) fn(this.doc);
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function addEntity(doc, props) {
  const id = `e${doc.nextId++}`;
  const kind = props.type === 'group' ? 'Group' : 'Shape';
  const count = doc.entities.filter((e) => e.type === (props.type || 'mesh')).length + 1;
  const e = {
    type: 'mesh',
    parent: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    material: { color: DEFAULT_COLOR, opacity: 1, metalness: 0, roughness: 0.85 },
    tag: 'Untagged',
    visible: true,
    locked: false,
    ...props,
  };
  e.id = id;
  e.name ||= `${kind} ${count}`;
  e.material = { color: DEFAULT_COLOR, opacity: 1, metalness: 0, roughness: 0.85, ...(props.material || {}) };
  doc.entities.push(e);
  if (e.tag && !doc.tags.some((t) => t.name === e.tag)) doc.tags.push({ name: e.tag, visible: true });
  return e;
}

export const getEntity = (doc, id) => doc.entities.find((e) => e.id === id);
export const childrenOf = (doc, id) => doc.entities.filter((e) => e.parent === id);
export function descendants(doc, id) {
  const out = [];
  for (const c of childrenOf(doc, id)) out.push(c, ...descendants(doc, c.id));
  return out;
}

/** Resolve ids or names (case-insensitive) to entities. AI callers often know names, not ids. */
export function resolve(doc, refs) {
  const list = Array.isArray(refs) ? refs : [refs];
  return list.map((r) => {
    const e = getEntity(doc, r) || doc.entities.find((x) => x.name.toLowerCase() === String(r).toLowerCase());
    if (!e) throw new Error(`No entity "${r}". Call get_scene to see ids and names.`);
    return e;
  });
}

const D2R = Math.PI / 180;
export function localMatrix(e) {
  return new Matrix4().compose(
    new Vector3(...e.position),
    new Quaternion().setFromEuler(new Euler(e.rotation[0] * D2R, e.rotation[1] * D2R, e.rotation[2] * D2R)),
    new Vector3(...e.scale),
  );
}
export function worldMatrix(doc, e) {
  const m = localMatrix(e);
  for (let p = e.parent && getEntity(doc, e.parent); p; p = p.parent && getEntity(doc, p.parent)) m.premultiply(localMatrix(p));
  return m;
}
export function parentWorldMatrix(doc, e) {
  const p = e.parent && getEntity(doc, e.parent);
  return p ? worldMatrix(doc, p) : new Matrix4();
}

/** Write a world matrix back into an entity's position/rotation/scale (relative to its parent). */
export function setWorldMatrix(doc, e, world) {
  const local = parentWorldMatrix(doc, e).invert().multiply(world);
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  local.decompose(p, q, s);
  const r = new Euler().setFromQuaternion(q);
  e.position = round3(p.toArray());
  e.rotation = round3([r.x / D2R, r.y / D2R, r.z / D2R]);
  e.scale = round3(s.toArray());
}

export const round3 = (a) => a.map((x) => Math.round(x * 1e4) / 1e4);

/** World-space axis-aligned bounds of an entity and everything inside it. */
export function worldBox(doc, e) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [e, ...descendants(doc, e.id)]) {
    if (!x.mesh) continue;
    const m = worldMatrix(doc, x);
    const b = bbox(x.mesh);
    for (const cx of [b.min[0], b.max[0]])
      for (const cy of [b.min[1], b.max[1]])
        for (const cz of [b.min[2], b.max[2]]) {
          const p = new Vector3(cx, cy, cz).applyMatrix4(m).toArray();
          for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], p[k])), (max[k] = Math.max(max[k], p[k]));
        }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: round3(min), max: round3(max) };
}

export function unionBox(boxes) {
  return boxes.reduce(
    (a, b) => ({ min: a.min.map((v, k) => Math.min(v, b.min[k])), max: a.max.map((v, k) => Math.max(v, b.max[k])) }),
    { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
  );
}

/** Deep-copy an entity (and its children) with fresh ids. Returns the new top entity. */
export function duplicateEntity(doc, e, parent = e.parent) {
  const copy = addEntity(doc, { ...JSON.parse(JSON.stringify(e)), id: undefined, parent, name: `${e.name} copy` });
  for (const c of childrenOf(doc, e.id)) duplicateEntity(doc, c, copy.id);
  return copy;
}

export function removeEntity(doc, e) {
  const gone = new Set([e.id, ...descendants(doc, e.id).map((d) => d.id)]);
  doc.entities = doc.entities.filter((x) => !gone.has(x.id));
  doc.animation.tracks = doc.animation.tracks.filter((t) => !gone.has(t.target));
}
