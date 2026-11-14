// Survey instruments (#285): a tripod-mounted total station, a prism rod and a GNSS rover pole, built from the same
// primitives as everything else so they need no asset file. Each returns a tree of named parts, because the replay
// drives them by name: the alidade turns to the horizontal circle, the telescope tilts to the zenith angle, and the
// beam under the telescope stretches to the slope distance. Metres, Y up, pivots at the base centre.
import * as G from './geometry.js';

const BODY = '#d8d4c8';
const DARK = '#32373c';
const YELLOW = '#e8a317';
const GLASS = '#2f6f86';

/** A square strut between two points, w across: tripod legs and the beam, without any Euler angles to get wrong. */
export function strut(a, b, w) {
  const d = G.sub(b, a);
  const l = G.len(d);
  if (l < 1e-9) return { v: [], f: [] };
  const u = G.scl(d, 1 / l);
  const side = G.norm(Math.abs(u[1]) > 0.99 ? [1, 0, 0] : G.cross(u, [0, 1, 0]));
  const up = G.cross(u, side);
  const ring = (p) => [
    G.add(p, G.add(G.scl(side, w / 2), G.scl(up, w / 2))),
    G.add(p, G.add(G.scl(side, w / 2), G.scl(up, -w / 2))),
    G.add(p, G.add(G.scl(side, -w / 2), G.scl(up, -w / 2))),
    G.add(p, G.add(G.scl(side, -w / 2), G.scl(up, w / 2))),
  ];
  const v = [...ring(a), ...ring(b)];
  return G.orient({ v, f: [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] });
}

/** A Y-axis mesh laid down the -Z axis, so a part reads as "pointing forward" (north at rotation 0). */
export const towardsZ = (m) => ({ v: m.v.map(([x, y, z]) => [x, z, -y]), f: m.f.map((f) => [...f]) });

const at = (mesh, [x, y, z]) => G.translate(mesh, [x, y, z]);
const merge = (...ms) => ms.reduce((a, m) => ({ v: [...a.v, ...m.v], f: [...a.f, ...m.f.map((f) => f.map((i) => i + a.v.length))] }), { v: [], f: [] });

/** Trunnion axis above the tripod head: a total station's own height, the rest of the instrument height is the tripod. */
export const TRUNNION = 0.23;

/**
 * A total station standing at instrument height ih (trunnion axis above the ground mark). Parts:
 *   Tripod — legs and head, fixed
 *   Alidade — turns about Y to the horizontal circle (rotation [0, −azimuth, 0])
 *     Telescope — tilts about X to the zenith angle (rotation [90 − zenith, 0, 0])
 *       Sight line — a beam down −Z, scaled in Z to the slope distance
 */
export function totalStation(ih = 1.55) {
  const head = Math.max(0.3, ih - TRUNNION);
  const legs = [0, 120, 240].map((a) => {
    const r = (a * Math.PI) / 180;
    return strut([Math.sin(r) * 0.55, 0, -Math.cos(r) * 0.55], [Math.sin(r) * 0.1, head, -Math.cos(r) * 0.1], 0.035);
  });
  return {
    name: 'Total station',
    children: [
      { name: 'Tripod', color: YELLOW, mesh: merge(...legs, at(G.cylinder(0.14, 0.03, 12), [0, head, 0])) },
      {
        name: 'Alidade',
        position: [0, head, 0],
        children: [
          { name: 'Tribrach', color: DARK, mesh: merge(G.cylinder(0.085, 0.07, 20), at(G.box(0.17, 0.16, 0.13), [0, 0.07, 0])) },
          { name: 'Standards', color: BODY, mesh: merge(at(G.box(0.05, 0.19, 0.12), [-0.085, 0.14, 0]), at(G.box(0.05, 0.19, 0.12), [0.085, 0.14, 0]), at(G.box(0.17, 0.09, 0.03), [0, 0.14, 0.07])) },
          {
            name: 'Telescope',
            position: [0, TRUNNION, 0],
            children: [
              { name: 'Barrel', color: BODY, mesh: merge(towardsZ(at(G.cylinder(0.046, 0.22, 20), [0, -0.11, 0])), at(G.box(0.1, 0.05, 0.04), [0, 0.06, 0])) },
              { name: 'Objective', color: GLASS, mesh: towardsZ(at(G.cylinder(0.042, 0.012, 20), [0, 0.11, 0])) },
              // a beam one metre long: the replay scales it in Z to each shot's slope distance
              { name: 'Sight line', color: '#e24a2b', mesh: towardsZ(at(G.cylinder(0.006, 1, 6), [0, 0, 0])), material: { opacity: 0.55, roughness: 0.4 } },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * A prism pole of height th (prism centre above the foot). Parts: Pole (scaled in Y to the height) and Prism,
 * which the replay lifts to the target height.
 */
export function prismRod(th = 1.5) {
  return {
    name: 'Prism rod',
    children: [
      { name: 'Pole', color: YELLOW, mesh: G.cylinder(0.014, 1, 10), scale: [1, th, 1] },
      { name: 'Prism', position: [0, th, 0], color: GLASS, children: [{ name: 'Head', color: GLASS, mesh: merge(at(towardsZ(G.cylinder(0.038, 0.06, 12)), [0, 0, 0.03]), at(G.box(0.1, 0.1, 0.02), [0, 0, 0.07])) }] },
    ],
  };
}

/** A GNSS rover pole with its receiver, antenna phase centre at height h above the foot. */
export function roverPole(h = 1.8) {
  return {
    name: 'GNSS rover',
    children: [
      { name: 'Pole', color: YELLOW, mesh: G.cylinder(0.014, 1, 10), scale: [1, h, 1] },
      {
        name: 'Receiver',
        position: [0, h, 0],
        children: [
          { name: 'Body', color: BODY, mesh: at(G.cylinder(0.095, 0.1, 20), [0, -0.05, 0]) },
          { name: 'Dome', color: DARK, mesh: at(G.cylinder(0.075, 0.035, 20), [0, 0.05, 0]) },
        ],
      },
    ],
  };
}

export const INSTRUMENTS = { total_station: totalStation, prism_rod: prismRod, rover_pole: roverPole };
