// Copy and paste (#39): entities with everything inside them, the components they use, between models too.
import * as D from './document.js';

const TAG = 'mymodellerreel_clipboard';

/** The entities (and their children) as a self-contained clip; ids are kept only to rebuild the tree. */
export function copyEntities(doc, ids) {
  const tops = ids.map((id) => D.getEntity(doc, id)).filter(Boolean);
  const all = new Map();
  for (const e of tops) for (const x of [e, ...D.descendants(doc, e.id)]) all.set(x.id, x);
  const entities = [...all.values()].map((e) => {
    const c = structuredClone(e);
    if (!all.has(c.parent)) {
      // a top entity keeps its world placement when pasted outside its group
      if (e.parent) Object.assign(c, worldPose(doc, e));
      c.parent = null;
    }
    return c;
  });
  const used = new Set(entities.map((e) => e.component).filter(Boolean));
  const components = Object.fromEntries([...used].map((n) => [n, structuredClone(doc.components[n])]));
  const tags = doc.tags.filter((t) => entities.some((e) => e.tag === t.name));
  return { [TAG]: 1, entities, components, tags, geo: doc.geo?.base ? { base: doc.geo.base } : null };
}

function worldPose(doc, e) {
  const tmp = { ...e, parent: null };
  D.setWorldMatrix({ ...doc, entities: [...doc.entities, tmp] }, tmp, D.worldMatrix(doc, e));
  return { position: tmp.position, rotation: tmp.rotation, scale: tmp.scale };
}

export const isClip = (x) => !!x && typeof x === 'object' && x[TAG] === 1 && Array.isArray(x.entities);

/** Add a clip's entities to doc (new ids), shifted by offset; tops go into parent. Returns the new top ids. */
export function pasteEntities(doc, clip, { offset = [0, 0, 0], parent = null } = {}) {
  if (!isClip(clip)) throw new Error('Nothing to paste: copy something first.');
  for (const t of clip.tags || []) if (!doc.tags.some((x) => x.name === t.name)) doc.tags.push(structuredClone(t));
  for (const [n, def] of Object.entries(clip.components || {})) if (!doc.components?.[n]) (doc.components ||= {})[n] = structuredClone(def);
  // between models with different base points, keep the real-world position
  const shift = [...offset];
  if (clip.geo?.base && doc.geo?.base) {
    const [a, b] = [clip.geo.base, doc.geo.base];
    shift[0] += a[0] - b[0];
    shift[1] += a[2] - b[2];
    shift[2] -= a[1] - b[1];
  }
  const idMap = new Map();
  const tops = [];
  const names = new Set(doc.entities.map((e) => e.name));
  for (const src of clip.entities) {
    const top = !src.parent || !clip.entities.some((x) => x.id === src.parent);
    const { id: oldId, ...rest } = structuredClone(src);
    const e = D.addEntity(doc, { ...rest, parent: top ? parent : null });
    if (top) {
      e.position = e.position.map((v, k) => v + shift[k]);
      if (names.has(e.name)) e.name = D.uniqueName(doc, e.name);
      tops.push(e.id);
    }
    idMap.set(oldId, e.id);
  }
  for (const src of clip.entities) {
    const e = D.getEntity(doc, idMap.get(src.id));
    if (src.parent && idMap.has(src.parent)) e.parent = idMap.get(src.parent);
    if (e.line) e.line.points = e.line.points.map((p) => idMap.get(p) || p);
    if (e.derived) e.derived.inputs = (e.derived.inputs || []).map((p) => idMap.get(p) || p);
  }
  return tops;
}
