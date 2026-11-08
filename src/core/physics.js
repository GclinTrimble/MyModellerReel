// Rigid-body physics bake (#86): drop, settle or collapse, simulated with cannon-es and written back as keyframes.
// Shapes: spheres and cylinders from their generators, boxes from everything else (their own bounding box, so a
// rotated beam stays a beam). The ground is a plane at y = 0 unless the colliders reach lower.
import * as CANNON from 'cannon-es';
import { Quaternion, Euler } from 'three';
import * as G from './geometry.js';

const D2R = Math.PI / 180;

function shapeOf(e) {
  const b = G.bbox(e.mesh);
  const s = e.scale;
  const size = [0, 1, 2].map((k) => Math.max(0.005, (b.max[k] - b.min[k]) * Math.abs(s[k])));
  const center = [0, 1, 2].map((k) => ((b.min[k] + b.max[k]) / 2) * s[k]);
  const gen = e.derived?.generator;
  if (gen === 'sphere') return { shape: new CANNON.Sphere(size[0] / 2), center, volume: (Math.PI / 6) * size[0] ** 3 };
  if (gen === 'cylinder') return { shape: new CANNON.Cylinder(size[0] / 2, size[0] / 2, size[1], 16), center, volume: (Math.PI / 4) * size[0] * size[0] * size[1] };
  return { shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)), center, volume: size[0] * size[1] * size[2] };
}

const quatOf = (r) => {
  const q = new Quaternion().setFromEuler(new Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R));
  return new CANNON.Quaternion(q.x, q.y, q.z, q.w);
};
const r4 = (x) => Math.round(x * 10000) / 10000;

/**
 * Simulate. dynamic / statics: top-level mesh entities. Returns { keys: { [id]: [{ t, position, rotation }] },
 * settled }. Times are from 0; rotations are Euler degrees unwrapped from key to key (no spins through ±180°).
 */
export function simulate(dynamic, statics, { duration = 4, fps = 60, keyRate = 12, gravity = 9.81, restitution = 0.15, friction = 0.6, density = 600, push = null } = {}) {
  if (!dynamic.length) throw new Error('Nothing to simulate: give the shapes that move.');
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -gravity, 0) });
  world.allowSleep = true;
  world.defaultContactMaterial.restitution = restitution;
  world.defaultContactMaterial.friction = friction;
  world.solver.iterations = 20;
  const floor = Math.min(0, ...statics.map((e) => e.position[1] + G.bbox(e.mesh).min[1] * e.scale[1]));
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.position.set(0, floor, 0);
  world.addBody(ground);
  const add = (e, mass) => {
    const { shape, center, volume } = shapeOf(e);
    const body = new CANNON.Body({ mass: mass ? Math.max(0.1, volume * density) : 0, position: new CANNON.Vec3(...e.position), quaternion: quatOf(e.rotation) });
    body.addShape(shape, new CANNON.Vec3(...center));
    body.sleepSpeedLimit = 0.05;
    body.sleepTimeLimit = 0.5;
    world.addBody(body);
    return body;
  };
  for (const e of statics) add(e, false);
  const bodies = dynamic.map((e) => [e, add(e, true)]);
  if (push) for (const [, b] of bodies) b.velocity.set(...push);
  const keys = Object.fromEntries(dynamic.map((e) => [e.id, [{ t: 0, position: e.position.map(r4), rotation: e.rotation.map(r4) }]]));
  const every = Math.max(1, Math.round(fps / keyRate));
  const frames = Math.round(duration * fps);
  let settled = null;
  for (let f = 1; f <= frames; f++) {
    world.step(1 / fps);
    if (f % every && f !== frames) continue;
    const t = r4(f / fps);
    for (const [e, b] of bodies) {
      const q = new Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      const eu = new Euler().setFromQuaternion(q);
      const list = keys[e.id];
      const prev = list.at(-1).rotation;
      const rot = [eu.x, eu.y, eu.z].map((x, k) => {
        let d = x / D2R;
        while (d - prev[k] > 180) d -= 360;
        while (d - prev[k] < -180) d += 360;
        return r4(d);
      });
      list.push({ t, position: [b.position.x, b.position.y, b.position.z].map(r4), rotation: rot });
    }
    if (settled === null && bodies.every(([, b]) => b.sleepState === CANNON.Body.SLEEPING)) settled = t;
  }
  return { keys, settled };
}
