// Design review (#100), the measurable half: floating parts, collisions, parts below the ground, unlikely sizes and
// broken parametric shapes, found from geometry. review_model adds a vision model's critique of four views on top.
import * as D from './document.js';
import { raycast } from './query.js';

const r2 = (x) => Math.round(x * 100) / 100;
const MAX = 400; // shortcut: pairwise checks are O(n²); larger models get checked on their first MAX shapes

/** Shapes to judge: visible meshes, as world boxes. */
function shapes(doc) {
  const off = new Set(doc.tags.filter((t) => !t.visible).map((t) => t.name));
  const vis = (e) => {
    for (let x = e; x; x = x.parent && D.getEntity(doc, x.parent)) if (!x.visible || off.has(x.tag)) return false;
    return true;
  };
  return doc.entities.filter((e) => e.mesh && vis(e)).slice(0, MAX).map((e) => ({ e, b: D.worldBox(doc, e) }));
}

/** The top-level thing an entity belongs to (parts of one group may touch and overlap freely). */
const rootOf = (doc, e) => {
  let x = e;
  while (x.parent && D.getEntity(doc, x.parent)) x = D.getEntity(doc, x.parent);
  return x.id;
};

/**
 * Issues: [{ kind, severity: 'error' | 'warning' | 'info', ids, message }]. kinds: floating, below_ground,
 * collision, scale, parametric.
 */
export function reviewChecks(doc) {
  const issues = [];
  const list = shapes(doc);
  for (const { e, b } of list) {
    const size = b.max.map((x, k) => x - b.min[k]);
    if (b.min[1] < -0.01) issues.push({ kind: 'below_ground', severity: 'warning', ids: [e.id], message: `${e.name} goes ${r2(-b.min[1])} m below the ground.` });
    if (b.min[1] > 0.02) {
      // something under it? rays down from its centre and corners (inset), against everything else
      const others = list.filter((o) => o.e !== e).map((o) => o.e.id);
      const inset = (k) => [b.min[k] + 0.25 * (b.max[k] - b.min[k]), b.max[k] - 0.25 * (b.max[k] - b.min[k])];
      const starts = [[(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2], ...inset(0).flatMap((x) => inset(2).map((z) => [x, z]))];
      const supported = others.length && starts.some(([x, z]) => raycast(doc, [x, b.min[1] + 1e-3, z], [0, -1, 0], { ids: others, maxDistance: 0.05 }).length);
      if (!supported) issues.push({ kind: 'floating', severity: 'warning', ids: [e.id], message: `${e.name} floats ${r2(b.min[1])} m above the ground with nothing under it.` });
    }
    const big = Math.max(...size);
    const small = Math.min(...size.filter((x) => x > 0), Infinity);
    if (big > 500) issues.push({ kind: 'scale', severity: 'warning', ids: [e.id], message: `${e.name} is ${r2(big)} m long: check the units (metres).` });
    else if (big > 0 && big < 0.005) issues.push({ kind: 'scale', severity: 'info', ids: [e.id], message: `${e.name} is only ${r2(big * 1000)} mm: check the units (metres).` });
    else if (small < 1e-4 && e.mesh.f.length > 1) issues.push({ kind: 'scale', severity: 'info', ids: [e.id], message: `${e.name} is paper-thin (${r2(small * 1000)} mm).` });
    if (e.derived?.error) issues.push({ kind: 'parametric', severity: 'error', ids: [e.id], message: `${e.name}: ${e.derived.error}` });
  }
  // collisions: boxes of things from different groups that overlap by more than 1 cm on every axis
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      const ov = [0, 1, 2].map((k) => Math.min(A.b.max[k], B.b.max[k]) - Math.max(A.b.min[k], B.b.min[k]));
      if (ov.every((x) => x > 0.01) && rootOf(doc, A.e) !== rootOf(doc, B.e))
        issues.push({ kind: 'collision', severity: 'warning', ids: [A.e.id, B.e.id], message: `${A.e.name} and ${B.e.name} overlap (${ov.map(r2).join(' × ')} m).` });
    }
  return issues.slice(0, 60);
}

/** Numbers a reviewer wants next to the pictures. */
export function reviewStats(doc) {
  const all = D.unionBox(doc.entities.filter((e) => !e.parent).map((e) => D.worldBox(doc, e)));
  const ok = Number.isFinite(all.min[0]);
  return {
    entities: doc.entities.length,
    shapes: doc.entities.filter((e) => e.mesh).length,
    groups: doc.entities.filter((e) => e.type === 'group').length,
    faces: doc.entities.reduce((s, e) => s + (e.mesh?.f.length || 0), 0),
    size: ok ? all.max.map((x, k) => r2(x - all.min[k])) : [0, 0, 0],
    animated: doc.animation.tracks.length + (doc.animation.motions?.length || 0) > 0,
  };
}
