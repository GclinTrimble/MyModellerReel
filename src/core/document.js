// The model document: plain JSON so it can be saved inside a GLB, diffed, sent to an AI and undone by snapshot.
import { Matrix4, Euler, Quaternion, Vector3 } from 'three';
import { bbox } from './geometry.js';
import { samplePoints } from './curves.js';

export const DEFAULT_COLOR = '#d9d4c7';

export function newDoc() {
  return {
    format: 'mymodellerreel',
    version: 1,
    nextId: 1,
    entities: [],
    tags: [{ name: 'Untagged', visible: true }],
    scenes: [],
    profiles: {}, // custom sweep profiles: name → { points: [[u, v], …], description }
    recipes: {}, // replayable build histories: name → { description, params, steps: [{ command, args }] }
    journal: [], // the commands that built this model, in order (recipes and macros are cut from it)
    animation: { duration: 10, fps: 30, tracks: [], markers: [], captions: [], motions: [] },
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
    if (this.undoStack.length > 200) {
      this.undoStack.shift(); // shortcut: whole-doc snapshots, fine below ~50 MB models
      if (this.proposal) this.proposalAt--;
    }
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
  /** Drop the change since the last checkpoint (a command that failed half-way). */
  rollback() {
    if (!this.undoStack.length) return false;
    this.doc = JSON.parse(this.undoStack.pop());
    this.changed();
    return true;
  }
  replace(doc) {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.proposal = null;
    this.changed();
  }

  // Proposal mode: changes made after beginProposal() stay pending until accepted or rejected (one undo step either way).
  beginProposal() {
    if (this.proposal) return false;
    this.checkpoint();
    this.proposal = this.undoStack.at(-1);
    this.proposalAt = this.undoStack.length - 1;
    this.changed();
    return true;
  }
  acceptProposal() {
    if (!this.proposal) return false;
    this.proposal = null;
    this.changed();
    return true;
  }
  rejectProposal() {
    if (!this.proposal) return false;
    this.doc = JSON.parse(this.proposal);
    // drop the history made inside the proposal, down to (and including) its own checkpoint
    if (this.undoStack[this.proposalAt] === this.proposal) this.undoStack.length = this.proposalAt;
    this.redoStack = [];
    this.proposal = null;
    this.changed();
    return true;
  }
  /** What a pending proposal changed: entity ids added, changed and removed (removed ones live in `before`). */
  proposalDiff() {
    return this.proposal ? diffDocs(JSON.parse(this.proposal), this.doc) : null;
  }
  changed() {
    // A view that fails to redraw must not turn a command that worked into an error (it is logged instead).
    for (const fn of this.listeners)
      try {
        fn(this.doc);
      } catch (e) {
        console.error(e);
      }
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function diffDocs(before, after) {
  const old = new Map(before.entities.map((e) => [e.id, JSON.stringify(e)]));
  const now = new Set(after.entities.map((e) => e.id));
  const added = [];
  const changed = [];
  for (const e of after.entities) {
    if (!old.has(e.id)) added.push(e.id);
    else if (old.get(e.id) !== JSON.stringify(e)) changed.push(e.id);
  }
  const removed = before.entities.filter((e) => !now.has(e.id)).map((e) => e.id);
  const animation = JSON.stringify(before.animation) !== JSON.stringify(after.animation);
  return { added, changed, removed, animation, before, empty: !added.length && !changed.length && !removed.length && !animation };
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
    if (!x.mesh && !x.curve) continue;
    const m = worldMatrix(doc, x);
    const b = bbox(x.mesh || { v: samplePoints(x.curve) });
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

/** A curve entity's points, sampled and in world space. */
export function curvePoints(doc, e, perSpan = 16) {
  const m = worldMatrix(doc, e);
  return samplePoints(e.curve, perSpan).map((p) => new Vector3(...p).applyMatrix4(m).toArray());
}

/** An entity's mesh with its world transform baked in. */
export function worldMesh(doc, e) {
  const m = worldMatrix(doc, e);
  return { v: e.mesh.v.map((p) => new Vector3(...p).applyMatrix4(m).toArray()), f: e.mesh.f };
}

export function removeEntity(doc, e) {
  const gone = new Set([e.id, ...descendants(doc, e.id).map((d) => d.id)]);
  doc.entities = doc.entities.filter((x) => !gone.has(x.id));
  doc.animation.tracks = doc.animation.tracks.filter((t) => !gone.has(t.target));
  if (doc.animation.motions) doc.animation.motions = doc.animation.motions.filter((m) => !gone.has(m.target));
}
