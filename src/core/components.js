// Components / instances (#38). A component is a definition (doc.components[name].parts) and every instance is a
// group with `component: name` whose children are linked copies of the parts (`compKey` says which part). Edit the
// parts of any instance and syncComponents() makes that the definition and updates every other instance in place
// (ids stay). Instances share their parts' mesh objects, so the viewport and GLB export share geometry, and saved
// files store each part's mesh once.
import * as D from './document.js';

const FIELDS = ['type', 'name', 'mesh', 'curve', 'material', 'position', 'rotation', 'scale', 'meta', 'visible', 'tag', 'derived'];

/** The parts of an instance as definition entries: { key, parentKey, …FIELDS }, in a stable order. */
function partsOf(doc, inst) {
  const out = [];
  const walk = (parentId, parentKey) => {
    for (const c of D.childrenOf(doc, parentId)) {
      const part = { key: c.compKey, parentKey };
      for (const f of FIELDS) if (c[f] !== undefined) part[f] = c[f];
      out.push(part);
      walk(c.id, c.compKey);
    }
  };
  walk(inst.id, null);
  return out;
}
const sig = (parts) => JSON.stringify(parts);

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
export function instantiate(doc, name, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], parent = null } = {}) {
  const def = doc.components?.[name];
  if (!def) throw new Error(`No component "${name}". Components: ${Object.keys(doc.components || {}).join(', ') || 'none'}.`);
  const g = D.addEntity(doc, { type: 'group', name: D.uniqueName(doc, name), component: name, position, rotation, scale, parent });
  fill(doc, g, def.parts);
  return g;
}

/** Make an instance's parts match a definition: update by key, add the missing, remove the extra. */
function fill(doc, inst, parts) {
  const have = new Map(D.descendants(doc, inst.id).map((c) => [c.compKey, c]));
  const idOf = new Map();
  for (const p of parts) {
    let c = have.get(p.key);
    if (!c) c = D.addEntity(doc, { type: p.type, compKey: p.key });
    for (const f of FIELDS) {
      if (p[f] === undefined) delete c[f];
      else c[f] = f === 'mesh' ? p.mesh : structuredClone(p[f]); // meshes are shared, not copied
    }
    c.compKey = p.key;
    idOf.set(p.key, c.id);
    have.delete(p.key);
  }
  for (const p of parts) D.getEntity(doc, idOf.get(p.key)).parent = p.parentKey ? idOf.get(p.parentKey) : inst.id;
  for (const extra of have.values()) if (D.getEntity(doc, extra.id)) D.removeEntity(doc, extra);
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
  // parts outside any instance are plain shapes again
  const inInstance = (e) => {
    for (let x = e.parent && D.getEntity(doc, e.parent); x; x = x.parent && D.getEntity(doc, x.parent)) if (x.component) return true;
    return false;
  };
  for (const e of doc.entities) if (e.compKey && !inInstance(e)) delete e.compKey;
  const changed = [];
  for (const [name, def] of Object.entries(doc.components)) {
    const insts = instancesOf(doc, name);
    if (!insts.length) continue;
    // new parts drawn inside an instance get a key
    for (const inst of insts) {
      let n = Math.max(0, ...def.parts.map((p) => +p.key.slice(1) || 0));
      for (const d of D.descendants(doc, inst.id)) if (!d.compKey) d.compKey = `p${++n}`;
    }
    const want = sig(def.parts);
    const edited = insts.find((i) => sig(partsOf(doc, i)) !== want);
    if (edited) {
      def.parts = structuredClone(partsOf(doc, edited));
      for (const p of def.parts) if (p.mesh) p.mesh = D.descendants(doc, edited.id).find((c) => c.compKey === p.key).mesh;
      changed.push(name);
    }
    for (const inst of insts) fill(doc, inst, def.parts);
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
