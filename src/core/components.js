// Components / instances (#38). A component is a definition (doc.components[name].parts) and every instance is a
// group with `component: name` whose children are linked copies of the parts (`compKey` says which part). Edit the
// parts of any instance and syncComponents() makes that the definition and updates every other instance in place
// (ids stay). Instances share their parts' mesh objects, so the viewport and GLB export share geometry, and saved
// files store each part's mesh once.
import { Vector3, Euler } from 'three';
import * as D from './document.js';

const FIELDS = ['type', 'name', 'mesh', 'curve', 'material', 'position', 'rotation', 'scale', 'meta', 'visible', 'tag', 'byLayer', 'derived'];

/** Children by parent id, built once for a pass over many instances (a filter of the model per parent is quadratic). */
function childIndex(doc) {
  const m = new Map();
  for (const e of doc.entities) if (e.parent) (m.get(e.parent) || m.set(e.parent, []).get(e.parent)).push(e);
  return (id) => m.get(id) || [];
}
const below = (kids, id) => kids(id).flatMap((c) => [c, ...below(kids, c.id)]);

/** The parts of an instance as definition entries: { key, parentKey, …FIELDS }, in a stable order. */
function partsOf(doc, inst, kids = (id) => D.childrenOf(doc, id)) {
  const out = [];
  const walk = (parentId, parentKey) => {
    for (const c of kids(parentId)) {
      const part = { key: c.compKey, parentKey };
      for (const f of FIELDS) if (c[f] !== undefined) part[f] = c[f];
      out.push(part);
      walk(c.id, c.compKey);
    }
  };
  walk(inst.id, null);
  return out;
}
// a mesh by a hash of its content, kept per mesh object: thousands of instances share one, and stringifying its
// vertices once per instance per command was the cost. shortcut: a mesh edited in place keeps its old hash (commands
// replace e.mesh, as the viewport's geometry cache also assumes); hash the content each time if scripts start doing that.
const meshHash = new WeakMap();
function hashOf(m) {
  let h = meshHash.get(m);
  if (h === undefined) {
    const s = JSON.stringify(m);
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < s.length; i++) (a = Math.imul(a ^ s.charCodeAt(i), 0x01000193)), (b = Math.imul(b ^ s.charCodeAt(i), 0x5bd1e995));
    meshHash.set(m, (h = `${s.length}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`));
  }
  return h;
}
const sig = (parts) => JSON.stringify(parts, (k, v) => (k === 'mesh' && v && typeof v === 'object' ? hashOf(v) : v));

export const instancesOf = (doc, name) => doc.entities.filter((e) => e.component === name);

/** Make a definition from entities (moved so the component origin is at origin) and give each a part key. */
export function define(doc, name, ents, origin) {
  if ((doc.components ||= {})[name]) throw new Error(`There is already a component "${name}".`);
  const g = D.addEntity(doc, { type: 'group', name, component: name, position: origin, parent: ents[0].parent });
  let k = 0;
  for (const e of ents) {
    const w = D.worldMatrix(doc, e);
    e.parent = g.id;
    D.setWorldMatrix(doc, e, w);
  }
  for (const d of D.descendants(doc, g.id)) d.compKey = `p${++k}`;
  doc.components[name] = { parts: structuredClone(partsOf(doc, g)) };
  return g;
}

/** A new instance of a component at a transform. */
export function instantiate(doc, name, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], parent = null, label = null } = {}) {
  const def = doc.components?.[name];
  if (!def) throw new Error(`No component "${name}". Components: ${Object.keys(doc.components || {}).join(', ') || 'none'}.`);
  const g = D.addEntity(doc, { type: 'group', name: label || D.uniqueName(doc, name), component: name, position, rotation, scale, parent });
  fill(doc, g, def.parts, () => []); // a new group has no parts yet
  return g;
}

/** Make an instance's parts match a definition: update by key, add the missing, remove the extra. */
function fill(doc, inst, parts, kids = null) {
  const have = new Map((kids ? below(kids, inst.id) : D.descendants(doc, inst.id)).map((c) => [c.compKey, c]));
  const idOf = new Map();
  const made = new Map();
  for (const p of parts) {
    let c = have.get(p.key);
    if (!c) c = D.addEntity(doc, { type: p.type, name: p.name, compKey: p.key });
    for (const f of FIELDS) {
      if (p[f] === undefined) delete c[f];
      else c[f] = f === 'mesh' ? p.mesh : structuredClone(p[f]); // meshes are shared, not copied
    }
    c.compKey = p.key;
    idOf.set(p.key, c.id);
    made.set(p.key, c);
    have.delete(p.key);
  }
  for (const p of parts) made.get(p.key).parent = p.parentKey ? idOf.get(p.parentKey) : inst.id;
  if (have.size) D.removeEntities(doc, [...have.values()]);
}

/**
 * Move a component's origin (its insertion point) by offset, in the component's own axes: its parts move the other
 * way, and each instance moves by the offset in its axes, so nothing moves in the world. A symbol placed at a point
 * then sits on the point by its new origin.
 */
export function setOrigin(doc, name, offset) {
  const def = doc.components?.[name];
  if (!def) throw new Error(`No component "${name}".`);
  for (const p of def.parts) if (!p.parentKey) p.position = D.round3((p.position || [0, 0, 0]).map((x, i) => x - offset[i]));
  for (const inst of instancesOf(doc, name)) {
    const d = new Vector3(...offset).multiply(new Vector3(...inst.scale)).applyEuler(new Euler(...inst.rotation.map((r) => (r * Math.PI) / 180)));
    inst.position = D.round3(inst.position.map((x, i) => x + d.getComponent(i)));
    fill(doc, inst, def.parts);
  }
}

/** Rebuild an instance's parts from scratch from its (possibly new) component. */
export function refill(doc, inst) {
  for (const c of D.childrenOf(doc, inst.id)) D.removeEntity(doc, c);
  fill(doc, inst, doc.components[inst.component].parts);
}

/**
 * After a change: an instance whose parts differ from its definition was edited, so it becomes the definition and
 * every other instance follows. Also gives keys to parts added to an instance, unlinks parts that left their
 * instance, and makes all instances share the definition's mesh objects again (after undo or a reload).
 */
export function syncComponents(doc) {
  if (!doc.components || !Object.keys(doc.components).length) return [];
  // one index of the model for the whole pass: thousands of symbol instances made the per-instance scans quadratic
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const kids = childIndex(doc);
  // parts outside any instance are plain shapes again
  const inInstance = (e) => {
    for (let x = e.parent && byId.get(e.parent); x; x = x.parent && byId.get(x.parent)) if (x.component) return true;
    return false;
  };
  for (const e of doc.entities) if (e.compKey && !inInstance(e)) delete e.compKey;
  const changed = [];
  const byName = new Map();
  for (const e of doc.entities) if (e.component) (byName.get(e.component) || byName.set(e.component, []).get(e.component)).push(e);
  for (const [name, def] of Object.entries(doc.components)) {
    const insts = byName.get(name) || [];
    if (!insts.length) continue;
    // new parts drawn inside an instance get a key
    for (const inst of insts) {
      let n = Math.max(0, ...def.parts.map((p) => +p.key.slice(1) || 0));
      for (const d of below(kids, inst.id)) if (!d.compKey) d.compKey = `p${++n}`;
    }
    const want = sig(def.parts);
    const sigs = insts.map((i) => sig(partsOf(doc, i, kids)));
    const edited = insts[sigs.findIndex((s) => s !== want)];
    if (edited) {
      def.parts = structuredClone(partsOf(doc, edited, kids));
      for (const p of def.parts) if (p.mesh) p.mesh = below(kids, edited.id).find((c) => c.compKey === p.key).mesh;
      changed.push(name);
    }
    const now = edited ? sig(def.parts) : want;
    const meshOf = new Map(def.parts.map((p) => [p.key, p.mesh]));
    insts.forEach((inst, i) => {
      if (sigs[i] !== now) return fill(doc, inst, def.parts, kids);
      // already the same: only share the definition's mesh objects again (after undo or a reload they are copies)
      for (const c of below(kids, inst.id)) if (c.mesh && meshOf.get(c.compKey) && c.mesh !== meshOf.get(c.compKey)) c.mesh = meshOf.get(c.compKey);
    });
  }
  return changed;
}

/** Saved files keep each part's mesh once: instance parts drop theirs (hydrate puts them back). */
export const stripForSave = (key, value) => (value && typeof value === 'object' && value.compKey && value.mesh ? { ...value, mesh: undefined } : value);

/** After opening a file: instance parts take their meshes from the definition. */
export function hydrate(doc) {
  for (const [name, def] of Object.entries(doc.components || {}))
    for (const inst of instancesOf(doc, name)) for (const c of D.descendants(doc, inst.id)) if (!c.mesh) c.mesh = def.parts.find((p) => p.key === c.compKey)?.mesh;
}
