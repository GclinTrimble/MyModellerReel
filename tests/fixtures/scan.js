// A synthetic airborne scan of a road corridor (#293), with ground truth, for point cloud tests and evals.
//
// The site: 100 m east × 80 m north around (650000 E, 5400000 N, 100 m), terrain rising to the north-east.
//   - a 7 m road along x at y = 40 (2.5 % crossfall from the crown), 150 mm kerbs with 150 mm tops on both sides,
//   - a V ditch south of the road (invert 0.8 m down at y = 33.5), a culvert mouth in it at x = 80,
//   - a flat-roofed building (x 15–27, y 55–65, 6 m) and a gable-roofed one (x 60–72, y 52–62, eaves 5 m, ridge 8 m),
//   - a retaining wall along y = 20 for x 30–50 holding up to 1.8 m of cut, six trees and four shrubs,
//   - 1 cm of Gaussian noise on every axis, a few outliers (class 7, withheld), four flight lines along x.
//
// API (all pure; coordinates in metres, x east, y north, z up, like a LAS file):
//   makeScan({ points = 200000, seed = 1 })      → one batch (below) with every point
//   scanBatches({ points, seed, batch = 65536 })  → generator of batches: the same points as makeScan, in pieces
//   writeLas(batch, { format = 7, scale = 0.001 }) → Uint8Array: a LAS 1.4 file (formats 6, 7) or LAS 1.2 (1, 3)
//   lasHeader({ count, format, scale, offset, min, max }) and lasRecords(batch, { format, scale, offset }) → the two
//     halves of writeLas, to stream a big file to disk batch by batch (see scripts/make-scan.mjs)
//   groundAt(x, y) → the true ground height (road, kerbs, ditch, cut included) at world x, y
//   SITE → the truth: road centreline, kerb lines, ditch invert, buildings, wall, culvert, trees, shrubs
//   CLASS → the ASPRS classes used; PARTS → the names behind batch.part
//
// A batch: { count, x, y, z: Float64Array, intensity: Uint16Array, classification, classFlags, returnNumber,
//   numberOfReturns, userData: Uint8Array, scanAngle: Float32Array (degrees), pointSourceId: Uint16Array,
//   gpsTime: Float64Array, r, g, b: Uint8Array, part: Uint8Array (index into PARTS, the ground truth for extraction) }.
// Classes (ASPRS LAS 1.4 R15): terrain, ditch and kerbs 2 (ground), road 11 (road surface), buildings 6, the wall and
// the culvert 1 (unclassified: no ASPRS class), trees 5 (high vegetation), shrubs 3 (low vegetation), outliers 7.

export const CLASS = { unclassified: 1, ground: 2, lowVegetation: 3, highVegetation: 5, building: 6, noise: 7, road: 11 };
export const PARTS = ['terrain', 'road', 'kerb', 'ditch', 'building', 'roof', 'wall', 'culvert', 'tree', 'shrub', 'noise'];
const P = Object.fromEntries(PARTS.map((n, i) => [n, i]));

const O = [650000, 5400000, 100]; // the site's south-west corner
const W = 100;
const H = 80;
const ROAD_Y = 40;
const HALF = 3.5; // half the carriageway
const KERB = 0.15;
const KERB_TOP = 0.15;
const DITCH_Y = 33.5;
const B1 = { min: [15, 55], max: [27, 65], height: 6, roof: 'flat' };
const B2 = { min: [60, 52], max: [72, 62], eaves: 5, ridge: 8, roof: 'gable' };
const WALL = { from: 30, to: 50, y: 20, thick: 0.3, cut: 1.8 };
const CULVERT = { x: 80, radius: 0.45, from: 33, to: 34.6 };
const TREES = [[8, 72, 9, 2.6], [40, 70, 11, 3], [50, 60, 8, 2.4], [85, 68, 10, 2.8], [90, 15, 9, 2.5], [10, 10, 7, 2.2]];
const SHRUBS = [[33, 50, 0.6], [55, 48, 0.7], [77, 47, 0.5], [20, 30, 0.6]];
const LINES = [10, 30, 50, 70]; // flight lines along x, by y

const terrain = (x, y) => 0.02 * x + 0.03 * y + 0.4 * Math.sin(x / 15) * Math.cos(y / 20);
const crown = (x) => terrain(x, ROAD_Y) + 0.2;
const kerbTop = (x) => crown(x) - 0.025 * HALF + KERB;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const cutAt = (x) => WALL.cut * smooth((x - WALL.from) / 3) * smooth((WALL.to - x) / 3);

/** The true ground at local x, y (road, kerb tops, verges, ditch and the cut south of the wall). */
function ground(x, y) {
  const d = Math.abs(y - ROAD_Y);
  if (d <= HALF) return crown(x) - 0.025 * d;
  if (d <= HALF + KERB_TOP + 1.35) return kerbTop(x); // kerb top and a verge level with it out to 5 m
  if (d <= 8) {
    const z = kerbTop(x) + (terrain(x, y) - kerbTop(x)) * ((d - 5) / 3);
    return y < ROAD_Y ? z - 0.8 * Math.max(0, 1 - Math.abs(y - DITCH_Y) / 1.5) : z;
  }
  return y < WALL.y && x > WALL.from && x < WALL.to ? terrain(x, y) - cutAt(x) : terrain(x, y);
}
export const groundAt = (x, y) => O[2] + ground(x - O[0], y - O[1]);

const inBox = (b, x, y, m = 0) => x >= b.min[0] - m && x <= b.max[0] + m && y >= b.min[1] - m && y <= b.max[1] + m;
const baseOf = (b) => ground((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2);

export const SITE = {
  origin: O,
  size: [W, H],
  road: { centreline: [[O[0], O[1] + ROAD_Y], [O[0] + W, O[1] + ROAD_Y]], width: 2 * HALF, crossfall: 0.025 },
  kerbs: [-1, 1].map((s) => ({ line: [[O[0], O[1] + ROAD_Y + s * HALF], [O[0] + W, O[1] + ROAD_Y + s * HALF]], height: KERB, top: KERB_TOP })),
  ditch: { invert: [[O[0], O[1] + DITCH_Y], [O[0] + W, O[1] + DITCH_Y]], depth: 0.8 },
  buildings: [B1, B2].map((b) => ({ footprint: [b.min, [b.max[0], b.min[1]], b.max, [b.min[0], b.max[1]]].map(([x, y]) => [O[0] + x, O[1] + y]), base: O[2] + baseOf(b), height: b.height || b.ridge, roof: b.roof })),
  wall: { line: [[O[0] + WALL.from, O[1] + WALL.y], [O[0] + WALL.to, O[1] + WALL.y]], thickness: WALL.thick, retains: WALL.cut },
  culvert: { axis: [[O[0] + CULVERT.x, O[1] + CULVERT.from], [O[0] + CULVERT.x, O[1] + CULVERT.to]], diameter: 2 * CULVERT.radius },
  trees: TREES.map(([x, y, h, r]) => ({ at: [O[0] + x, O[1] + y], height: h, crown: r })),
  shrubs: SHRUBS.map(([x, y, r]) => ({ at: [O[0] + x, O[1] + y], radius: r })),
};

// ---------------------------------------------------------------- surfaces sampled by area

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sphere = (rnd) => {
  const z = 2 * rnd() - 1;
  const a = 2 * Math.PI * rnd();
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), s * Math.sin(a), z];
};

/** Each surface: [area weight, part, class, sample(rnd) → [x, y, z] local]. Walls count half (seen at a slant). */
function surfaces() {
  const S = [];
  const blocked = (x, y) => inBox(B1, x, y) || inBox(B2, x, y);
  S.push([W * H - 240, P.terrain, CLASS.ground, (rnd) => {
    let x, y;
    do (x = rnd() * W), (y = rnd() * H);
    while (blocked(x, y));
    return [x, y, ground(x, y)];
  }]);
  for (const s of [-1, 1]) S.push([W * KERB * 0.5, P.kerb, CLASS.ground, (rnd) => {
    const x = rnd() * W;
    return [x, ROAD_Y + s * HALF, crown(x) - 0.025 * HALF + rnd() * KERB];
  }]);
  for (const b of [B1, B2]) {
    const base = baseOf(b);
    const [w, d] = [b.max[0] - b.min[0], b.max[1] - b.min[1]];
    const top = b.height || b.eaves;
    S.push([(2 * (w + d) * top) / 2, P.building, CLASS.building, (rnd) => {
      let t = rnd() * 2 * (w + d);
      const z = base + rnd() * top;
      if (t < w) return [b.min[0] + t, b.min[1], z];
      if ((t -= w) < d) return [b.max[0], b.min[1] + t, z];
      if ((t -= d) < w) return [b.max[0] - t, b.max[1], z];
      return [b.min[0], b.max[1] - (t - w), z];
    }]);
    if (b.roof === 'flat') S.push([w * d, P.roof, CLASS.building, (rnd) => [b.min[0] + rnd() * w, b.min[1] + rnd() * d, base + b.height]]);
    else {
      const rise = b.ridge - b.eaves;
      S.push([w * 2 * Math.hypot(d / 2, rise), P.roof, CLASS.building, (rnd) => {
        const [x, y] = [b.min[0] + rnd() * w, b.min[1] + rnd() * d];
        return [x, y, base + b.eaves + rise * (1 - Math.abs(y - (b.min[1] + d / 2)) / (d / 2))];
      }]);
      S.push([(d * rise) / 2, P.building, CLASS.building, (rnd) => {
        // a gable end: a point in the triangle over the end wall
        let [u, v] = [rnd(), rnd()];
        if (u + v > 1) (u = 1 - u), (v = 1 - v);
        const y = b.min[1] + d * (u + v / 2);
        return [rnd() < 0.5 ? b.min[0] : b.max[0], y, base + b.eaves + rise * v];
      }]);
    }
  }
  S.push([(WALL.to - WALL.from) * WALL.cut * 0.5, P.wall, CLASS.unclassified, (rnd) => {
    const x = WALL.from + rnd() * (WALL.to - WALL.from);
    const lo = ground(x, WALL.y - 0.01);
    const hi = terrain(x, WALL.y) + 0.2;
    return [x, WALL.y, lo + rnd() * (hi - lo)];
  }]);
  S.push([(WALL.to - WALL.from) * WALL.thick, P.wall, CLASS.unclassified, (rnd) => {
    const x = WALL.from + rnd() * (WALL.to - WALL.from);
    return [x, WALL.y + rnd() * WALL.thick, terrain(x, WALL.y) + 0.2];
  }]);
  S.push([Math.PI * CULVERT.radius * (CULVERT.to - CULVERT.from), P.culvert, CLASS.unclassified, (rnd) => {
    const y = CULVERT.from + rnd() * (CULVERT.to - CULVERT.from);
    const a = Math.PI * rnd(); // the upper half of the pipe
    const zc = ground(CULVERT.x, DITCH_Y) + CULVERT.radius;
    return [CULVERT.x + CULVERT.radius * Math.cos(a), y, zc + CULVERT.radius * Math.sin(a)];
  }]);
  for (const [tx, ty, h, r] of TREES) {
    const g = ground(tx, ty);
    S.push([4 * Math.PI * r * r * 0.6, P.tree, CLASS.highVegetation, (rnd) => {
      const [u, v, w] = sphere(rnd);
      return [tx + r * u, ty + r * v, g + h - r + r * (w < -0.4 ? -w : w)]; // mostly the upper crown, as seen from above
    }]);
    S.push([2 * Math.PI * 0.15 * (h - 2 * r) * 0.5, P.tree, CLASS.highVegetation, (rnd) => {
      const a = 2 * Math.PI * rnd();
      return [tx + 0.15 * Math.cos(a), ty + 0.15 * Math.sin(a), g + rnd() * (h - 2 * r)];
    }]);
  }
  for (const [sx, sy, r] of SHRUBS) {
    const g = ground(sx, sy);
    S.push([2 * Math.PI * r * r, P.shrub, CLASS.lowVegetation, (rnd) => {
      const [u, v, w] = sphere(rnd);
      return [sx + r * u, sy + r * v, g + r * 0.8 + r * 0.8 * Math.abs(w)];
    }]);
  }
  return S;
}

const LOOK = {
  // part: [intensity, r, g, b]
  terrain: [21000, 96, 128, 64], road: [9000, 70, 70, 72], kerb: [32000, 190, 188, 180], ditch: [18000, 110, 100, 70],
  building: [26000, 200, 170, 140], roof: [14000, 150, 60, 50], wall: [30000, 170, 168, 160], culvert: [34000, 160, 160, 160],
  tree: [12000, 50, 90, 40], shrub: [15000, 70, 110, 50], noise: [5000, 120, 124, 130],
};

function alloc(n) {
  const f64 = () => new Float64Array(n);
  const u8 = () => new Uint8Array(n);
  return { count: n, x: f64(), y: f64(), z: f64(), intensity: new Uint16Array(n), classification: u8(), classFlags: u8(), returnNumber: u8(), numberOfReturns: u8(), userData: u8(), scanAngle: new Float32Array(n), pointSourceId: new Uint16Array(n), gpsTime: f64(), r: u8(), g: u8(), b: u8(), part: u8() };
}

/** Batches of the scan, the same points whatever the batch size. */
export function* scanBatches({ points = 200000, seed = 1, batch = 65536 } = {}) {
  const rnd = mulberry(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()) * 0.01;
  const S = surfaces();
  const cum = [];
  S.reduce((s, [a], i) => (cum[i] = s + a), 0);
  const total = cum[cum.length - 1];
  const under = (x, y) => TREES.some(([tx, ty, , r]) => (x - tx) ** 2 + (y - ty) ** 2 < r * r);
  for (let done = 0; done < points; ) {
    const n = Math.min(batch, points - done);
    const o = alloc(n);
    for (let i = 0; i < n; i++) {
      const k = done + i;
      let x, y, z, part, cls;
      if (rnd() < 0.0005) {
        // an outlier: a bird or a multipath echo, well off any surface
        (x = rnd() * W), (y = rnd() * H), (z = ground(x, y) + (rnd() < 0.5 ? -3 - 5 * rnd() : 15 + 20 * rnd()));
        (part = P.noise), (cls = CLASS.noise);
        o.classFlags[i] = 4; // withheld
      } else {
        const t = rnd() * total;
        let lo = 0;
        let hi = cum.length - 1;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (cum[m] < t) lo = m + 1;
          else hi = m;
        }
        [x, y, z] = S[lo][3](rnd);
        (part = S[lo][1]), (cls = S[lo][2]);
        if (part === P.terrain) {
          const d = Math.abs(y - ROAD_Y);
          if (d <= HALF) (part = P.road), (cls = CLASS.road);
          else if (d <= HALF + KERB_TOP) part = P.kerb;
          else if (y < ROAD_Y && Math.abs(y - DITCH_Y) < 1.5) part = P.ditch;
          if (k % 50 === 0) o.classFlags[i] = 2; // a key point, as a thinned model-key set would mark
        }
      }
      o.x[i] = O[0] + x + gauss();
      o.y[i] = O[1] + y + gauss();
      o.z[i] = O[2] + z + gauss();
      o.part[i] = part;
      o.classification[i] = cls;
      const look = LOOK[PARTS[part]];
      const j = () => Math.floor(rnd() * 21) - 10;
      o.intensity[i] = Math.max(0, look[0] + j() * 300);
      o.r[i] = Math.max(0, Math.min(255, look[1] + j()));
      o.g[i] = Math.max(0, Math.min(255, look[2] + j()));
      o.b[i] = Math.max(0, Math.min(255, look[3] + j()));
      // returns: the crown echoes first, the ground or trunk under it last
      const canopy = part === P.tree || part === P.shrub;
      const shaded = !canopy && part !== P.noise && under(x, y);
      o.numberOfReturns[i] = canopy || shaded ? 2 : 1;
      o.returnNumber[i] = shaded ? 2 : 1;
      let line = 0;
      for (let l = 1; l < LINES.length; l++) if (Math.abs(y - LINES[l]) < Math.abs(y - LINES[line])) line = l;
      o.pointSourceId[i] = line + 1;
      o.scanAngle[i] = (Math.atan2(y - LINES[line], 60) * 180) / Math.PI;
      o.gpsTime[i] = 300000 + line * 100 + x / 12 + rnd() * 1e-3;
    }
    done += n;
    yield o;
  }
}

/** Every point of the scan in one batch. */
export function makeScan(opts = {}) {
  const parts = [...scanBatches({ ...opts, batch: opts.points || 200000 })];
  return parts[0];
}

// ---------------------------------------------------------------- LAS

const REC = { 1: 28, 3: 34, 6: 30, 7: 36 };

/** A LAS header: 1.4 (375 bytes) for formats 6 and 7, 1.2 (227 bytes) for 1 and 3. No VLRs. */
export function lasHeader({ count, format = 7, scale = 0.001, offset = O, min, max }) {
  const v14 = format >= 6;
  const size = v14 ? 375 : 227;
  const u8 = new Uint8Array(size);
  const dv = new DataView(u8.buffer);
  'LASF'.split('').forEach((c, i) => (u8[i] = c.charCodeAt(0)));
  if (v14) dv.setUint16(6, 16, true); // global encoding: WKT (required for 6+)
  u8[24] = 1;
  u8[25] = v14 ? 4 : 2;
  'MyModellerReel scan fixture'.split('').forEach((c, i) => (u8[58 + i] = c.charCodeAt(0)));
  dv.setUint16(90, 1, true);
  dv.setUint16(92, 2026, true);
  dv.setUint16(94, size, true);
  dv.setUint32(96, size, true);
  u8[104] = format;
  dv.setUint16(105, REC[format], true);
  dv.setUint32(107, v14 ? 0 : count, true); // 1.4 formats 6+ keep the legacy count at 0
  [scale, scale, scale, ...offset].forEach((v, k) => dv.setFloat64(131 + k * 8, v, true));
  [max[0], min[0], max[1], min[1], max[2], min[2]].forEach((v, k) => dv.setFloat64(179 + k * 8, v, true));
  if (v14) dv.setBigUint64(247, BigInt(count), true);
  return u8;
}

/** The point records of a batch. */
export function lasRecords(o, { format = 7, scale = 0.001, offset = O } = {}) {
  const len = REC[format];
  const u8 = new Uint8Array(o.count * len);
  const dv = new DataView(u8.buffer);
  const q = (v, k) => Math.round((v - offset[k]) / scale);
  for (let i = 0; i < o.count; i++) {
    const p = i * len;
    dv.setInt32(p, q(o.x[i], 0), true);
    dv.setInt32(p + 4, q(o.y[i], 1), true);
    dv.setInt32(p + 8, q(o.z[i], 2), true);
    dv.setUint16(p + 12, o.intensity[i], true);
    if (format >= 6) {
      u8[p + 14] = (o.returnNumber[i] & 15) | ((o.numberOfReturns[i] & 15) << 4);
      u8[p + 15] = o.classFlags[i] & 15;
      u8[p + 16] = o.classification[i];
      u8[p + 17] = o.userData[i];
      dv.setInt16(p + 18, Math.round(o.scanAngle[i] / 0.006), true);
      dv.setUint16(p + 20, o.pointSourceId[i], true);
      dv.setFloat64(p + 22, o.gpsTime[i], true);
      if (format === 7) [o.r, o.g, o.b].forEach((c, k) => dv.setUint16(p + 30 + 2 * k, c[i] * 257, true));
    } else {
      u8[p + 14] = (o.returnNumber[i] & 7) | ((o.numberOfReturns[i] & 7) << 3);
      u8[p + 15] = (o.classification[i] & 31) | ((o.classFlags[i] & 7) << 5);
      dv.setInt8(p + 16, Math.round(o.scanAngle[i]));
      u8[p + 17] = o.userData[i];
      dv.setUint16(p + 18, o.pointSourceId[i], true);
      dv.setFloat64(p + 20, o.gpsTime[i], true);
      if (format === 3) [o.r, o.g, o.b].forEach((c, k) => dv.setUint16(p + 28 + 2 * k, c[i] * 257, true));
    }
  }
  return u8;
}

/** Bounds of a batch: { min, max }. */
export function boundsOf(o) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < o.count; i++)
    [o.x[i], o.y[i], o.z[i]].forEach((v, k) => ((min[k] = Math.min(min[k], v)), (max[k] = Math.max(max[k], v))));
  return { min, max };
}

/** A whole LAS file of a batch. */
export function writeLas(o, { format = 7, scale = 0.001, offset = O } = {}) {
  const head = lasHeader({ count: o.count, format, scale, offset, ...boundsOf(o) });
  const recs = lasRecords(o, { format, scale, offset });
  const u8 = new Uint8Array(head.length + recs.length);
  u8.set(head);
  u8.set(recs, head.length);
  return u8;
}
