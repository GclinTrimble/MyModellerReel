// A synthetic scan of a small site for slices (#292): a sloping field, two buildings and a road on a low embankment with shoulders, batters and ditches
// along "Main road" (model [x, z] points [-60, 25] → [60, 15]). Coordinates as a scanner writes them: x east, y north,
// z up. `node scripts/slice-scan.mjs` writes docs/how-to/samples/slice-site.ply; tests import siteScan().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILDINGS = [
  { name: 'Depot', cx: -25, cy: 12, w: 20, d: 12, h: 7, rgb: [190, 120, 90] },
  { name: 'Office', cx: 22, cy: 10, w: 14, d: 16, h: 5, rgb: [70, 105, 150] },
];
export const ROAD = { from: [-60, -25], to: [60, -15], width: 7, fill: 0.6 }; // scanner x, y
export const ground = (x, y) => 2 + 0.005 * x + 0.004 * y;

export function siteScan({ spacing = 0.5, wall = 0.15 } = {}) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const xyz = [];
  const rgb = [];
  const put = (x, y, z, c, j = 12) => (xyz.push(x, y, z), rgb.push(...c.map((v) => Math.max(0, Math.min(255, Math.round(v + rnd() * j))))));
  const under = (x, y) => BUILDINGS.some((b) => Math.abs(x - b.cx) < b.w / 2 && Math.abs(y - b.cy) < b.d / 2);
  const [rx, ry] = [ROAD.to[0] - ROAD.from[0], ROAD.to[1] - ROAD.from[1]];
  const rl = Math.hypot(rx, ry);
  const BAND = 10; // m each side of the road centre scanned densely, as a mobile scanner does
  const off = (px, py) => ((px - ROAD.from[0]) * -ry + (py - ROAD.from[1]) * rx) / rl; // left of the road +
  const surface = (px, py) => {
    const z = ground(px, py) + rnd() * 0.02;
    const a = Math.abs(off(px, py));
    const top = ROAD.fill - 0.025 * (ROAD.width / 2) - 0.04; // the shoulder's outer edge
    const toe = ROAD.width / 2 + 1 + 2 * top;
    if (a <= ROAD.width / 2) put(px, py, z + ROAD.fill - 0.025 * a, [92, 92, 98]); // lanes, 2.5 % crossfall
    else if (a <= ROAD.width / 2 + 1) put(px, py, z + ROAD.fill - 0.025 * (ROAD.width / 2) - 0.04 * (a - ROAD.width / 2), [176, 156, 116]); // shoulders, 4 %
    else if (a <= toe) put(px, py, z + top - (a - ROAD.width / 2 - 1) / 2, [118, 138, 86], 20); // 1:2 batters
    else if (Math.abs(a - toe - 1) < 1) put(px, py, z - 0.5 * (1 - Math.abs(a - toe - 1)), [96, 118, 74], 20); // V ditches 0.5 m deep
    else put(px, py, z, [112, 132, 82], 20);
  };
  for (let x = -60; x <= 60; x += spacing)
    for (let y = -40; y <= 40; y += spacing) {
      const px = x + rnd() * spacing * 0.6;
      const py = y + rnd() * spacing * 0.6;
      if (!under(px, py) && Math.abs(off(px, py)) > BAND) surface(px, py); // a scanner never sees under a roof
    }
  const fine = 0.2;
  for (let s = 0; s <= rl; s += fine)
    for (let o = -BAND; o <= BAND; o += fine) {
      const px = ROAD.from[0] + (rx * s) / rl - (ry * o) / rl + rnd() * fine * 0.5;
      const py = ROAD.from[1] + (ry * s) / rl + (rx * o) / rl + rnd() * fine * 0.5;
      if (px >= -60 && px <= 60 && !under(px, py)) surface(px, py);
    }
  for (const b of BUILDINGS) {
    const z0 = ground(b.cx, b.cy);
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [b.cx + (i * b.w) / 2, b.cy + (j * b.d) / 2]);
    for (let k = 0; k < 4; k++) {
      const [p, q] = [ring[k], ring[(k + 1) % 4]];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (let s = 0; s < L; s += wall) for (let h = 0.05; h < b.h; h += wall) put(p[0] + ((q[0] - p[0]) * s) / L + rnd() * 0.01, p[1] + ((q[1] - p[1]) * s) / L + rnd() * 0.01, z0 + h, b.rgb);
    }
    for (let x = -b.w / 2; x <= b.w / 2; x += spacing) for (let y = -b.d / 2; y <= b.d / 2; y += spacing) put(b.cx + x, b.cy + y, z0 + b.h, [86, 74, 72]);
  }
  return { xyz: Float32Array.from(xyz), rgb: Uint8Array.from(rgb), count: xyz.length / 3 };
}

/** A binary PLY (x, y, z float; red, green, blue uchar). */
export function toPly({ xyz, rgb, count }) {
  const head = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`);
  const body = Buffer.alloc(count * 15);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) body.writeFloatLE(xyz[i * 3 + k], i * 15 + k * 4);
    for (let k = 0; k < 3; k++) body[i * 15 + 12 + k] = rgb[i * 3 + k];
  }
  return Buffer.concat([head, body]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'how-to', 'samples', 'slice-site.ply');
  const scan = siteScan();
  fs.writeFileSync(out, toPly(scan));
  console.log(`${scan.count} points → ${out}`);
}
