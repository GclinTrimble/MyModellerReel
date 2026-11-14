// A box van parked on the north verge of the scan fixture (#299): 6 × 2.4 m, 2.9 m tall with a flat roof, so the
// automatic pass tags it building; the tests and the how-to lasso it and make it a vehicle (user class 65).
import { groundAt, SITE } from './scan.js';

const [OX, OY] = SITE.origin;
export const TRUCK = { min: [OX + 84, OY + 47], max: [OX + 90, OY + 49.4], height: 2.9 };

/** The scan batch with the van's points added (its roof and sides) and every class set to 1, as delivered unclassified. */
export function withTruck(s, { points = 0.012 * s.count, seed = 11 } = {}) {
  let a = seed >>> 0;
  const rnd = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  const n = s.count + Math.round(points);
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = ArrayBuffer.isView(v) ? new v.constructor(n) : v;
  for (const [k, v] of Object.entries(s)) if (ArrayBuffer.isView(v)) out[k].set(v);
  out.count = n;
  const [x0, y0] = TRUCK.min;
  const [w, d] = [TRUCK.max[0] - x0, TRUCK.max[1] - y0];
  const z0 = groundAt(x0 + w / 2, y0 + d / 2) + 0.3; // on its wheels
  const h = TRUCK.height - 0.3;
  for (let i = s.count; i < n; i++) {
    const t = rnd();
    let x;
    let y;
    let z;
    if (t < 0.55) (x = x0 + rnd() * w), (y = y0 + rnd() * d), (z = z0 + h); // the roof
    else {
      // the sides, seen at a slant
      const u = rnd() * 2 * (w + d);
      z = z0 + rnd() * h;
      if (u < w) (x = x0 + u), (y = y0);
      else if (u < w + d) (x = x0 + w), (y = y0 + u - w);
      else if (u < 2 * w + d) (x = x0 + 2 * w + d - u), (y = y0 + d);
      else (x = x0), (y = y0 + 2 * (w + d) - u);
    }
    out.x[i] = x;
    out.y[i] = y;
    out.z[i] = z;
    out.intensity[i] = 28000;
    out.returnNumber[i] = out.numberOfReturns[i] = 1;
    out.pointSourceId[i] = 3;
    out.gpsTime[i] = 300200 + i * 1e-6;
    out.r[i] = 236;
    out.g[i] = 236;
    out.b[i] = 230;
    if (out.part) out.part[i] = 255;
  }
  out.classification.fill(1);
  out.classFlags.fill(0);
  return out;
}

/** Whether a file point is on the van. */
export const onTruck = (x, y, z) => x >= TRUCK.min[0] - 0.05 && x <= TRUCK.max[0] + 0.05 && y >= TRUCK.min[1] - 0.05 && y <= TRUCK.max[1] + 0.05 && z > groundAt(x, y) + 0.2;
