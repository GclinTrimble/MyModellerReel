// Solid booleans on polygon meshes (three-bvh-csg underneath). Inputs and output are in the same (world) space.
import { BufferGeometry, BufferAttribute } from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import * as G from './geometry.js';

const OPS = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

function brush(mesh) {
  const b = G.toBuffers(mesh);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('normal', new BufferAttribute(b.normal, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((b.position.length / 3) * 2), 2));
  const r = new Brush(g);
  r.updateMatrixWorld();
  return r;
}

/** target op tools[0] op tools[1] … → a triangle mesh. Throws when nothing is left. */
export function booleanMeshes(op, target, tools) {
  if (!OPS[op]) throw new Error(`op must be one of ${Object.keys(OPS).join(', ')}.`);
  const ev = new Evaluator();
  ev.useGroups = false;
  let result = brush(target);
  for (const t of tools) result = ev.evaluate(result, brush(t), OPS[op]);
  const g = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry;
  const raw = G.fromTriangles(g.attributes.position.array);
  if (!raw.f.length) throw new Error('The result is empty (the shapes may not overlap).');
  return raw;
}
