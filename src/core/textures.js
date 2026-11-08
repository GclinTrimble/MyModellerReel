// Textured materials (#186): a library of tileable materials made here, offline — a colour image, a normal map and a
// roughness map each, from seeded noise. Pure: pixels and PNG bytes (fflate for the deflate), Node-tested.
import { zlibSync } from 'three/examples/jsm/libs/fflate.module.js';

/** name → { category, tile (m, one image across), roughness, metalness, make(rand) → per-pixel { rgb, h, r } }. */
export const LIBRARY = {
  'Wood planks': { category: 'Wood', tile: 1.6, metalness: 0 },
  'Light wood': { category: 'Wood', tile: 1.2, metalness: 0 },
  'Red brick': { category: 'Masonry', tile: 1.0, metalness: 0 },
  'Stone blocks': { category: 'Masonry', tile: 2.0, metalness: 0 },
  Concrete: { category: 'Masonry', tile: 2.0, metalness: 0 },
  Plaster: { category: 'Masonry', tile: 2.0, metalness: 0 },
  'Ceramic tiles': { category: 'Tiles', tile: 1.2, metalness: 0 },
  'Terracotta tiles': { category: 'Tiles', tile: 1.2, metalness: 0 },
  'Roof tiles': { category: 'Tiles', tile: 1.5, metalness: 0 },
  Marble: { category: 'Stone', tile: 2.0, metalness: 0 },
  Grass: { category: 'Ground', tile: 3.0, metalness: 0 },
  Gravel: { category: 'Ground', tile: 1.5, metalness: 0 },
  Asphalt: { category: 'Ground', tile: 2.0, metalness: 0 },
  'Brushed metal': { category: 'Metal', tile: 1.0, metalness: 0.9 },
};

// ---------------------------------------------------------------- tileable noise
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5), ((s ^ (s >>> 13)) >>> 0) / 4294967296);
}
/** Value noise with period p (lattice cells across the image), so the image tiles. */
function noise2(seed, p) {
  const r = rng(seed);
  const g = Float32Array.from({ length: p * p }, () => r());
  const at = (i, j) => g[(((j % p) + p) % p) * p + (((i % p) + p) % p)];
  const s = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * p;
    const y = v * p;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = s(x - i);
    const fy = s(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}
function fbm(seed, base, octaves = 4) {
  const n = Array.from({ length: octaves }, (_, k) => noise2(seed + k * 101, base << k));
  return (u, v) => {
    let s = 0;
    let a = 0.5;
    let t = 0;
    for (const f of n) (s += f(u, v) * a), (t += a), (a /= 2);
    return s / t;
  };
}
const mix = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
const clamp = (x) => Math.max(0, Math.min(1, x));

/** Bricks / blocks / tiles in rows: { mortar, inside, row, col } for (u, v). */
function courses(u, v, rows, cols, gap, offset = 0.5) {
  const rv = v * rows;
  const row = Math.floor(rv);
  const ru = u * cols + (row % 2) * offset;
  const col = Math.floor(ru);
  const fu = ru - col;
  const fv = rv - row;
  const gu = (gap * cols) / 2;
  const gv = (gap * rows) / 2;
  const edge = Math.min(fu, 1 - fu) / gu;
  const edgeV = Math.min(fv, 1 - fv) / gv;
  return { mortar: Math.min(edge, edgeV) < 1, inside: clamp(Math.min(edge, edgeV) - 1), row, col: ((col % cols) + cols) % cols };
}

/** The material's pixels: per (u, v) its colour (0–1), height (0–1) and roughness (0–1). */
function shader(name, seed = 7) {
  const n1 = fbm(seed, 4, 5);
  const n2 = fbm(seed + 50, 16, 3);
  const fine = fbm(seed + 90, 64, 2);
  const cell = (row, col) => rng(seed * 977 + row * 131 + col * 7)();
  switch (name) {
    case 'Wood planks':
    case 'Light wood': {
      const light = name === 'Light wood';
      const [c1, c2] = light ? [[0.83, 0.68, 0.48], [0.7, 0.53, 0.34]] : [[0.55, 0.36, 0.2], [0.38, 0.23, 0.12]];
      const boards = light ? 6 : 5;
      return (u, v) => {
        const b = Math.floor(u * boards);
        const k = cell(0, b);
        const fu = u * boards - b;
        const grain = 0.5 + 0.5 * Math.sin((v * 40 + n1(u * 0.3 + k, v) * 6 + k * 10) * Math.PI);
        const joint = Math.min(fu, 1 - fu) < 0.015 || Math.abs(((v + k) % 1) - 0.5) < 0.004;
        const col = mix(c1, c2, clamp(grain * 0.55 + n2(u, v) * 0.3 + k * 0.25));
        return { rgb: joint ? mix(col, [0.15, 0.1, 0.06], 0.7) : col, h: joint ? 0.2 : 0.6 + grain * 0.1, r: 0.6 + fine(u, v) * 0.15 };
      };
    }
    case 'Red brick':
    case 'Stone blocks': {
      const brick = name === 'Red brick';
      const [rows, cols, gap] = brick ? [16, 4, 0.025] : [6, 3, 0.03];
      return (u, v) => {
        const c = courses(u, v, rows, cols, gap);
        const k = cell(c.row, c.col);
        if (c.mortar) return { rgb: mix([0.72, 0.7, 0.66], [0.6, 0.58, 0.54], fine(u, v)), h: 0.15, r: 0.95 };
        const base = brick ? mix([0.62, 0.25, 0.16], [0.45, 0.18, 0.12], k) : mix([0.68, 0.65, 0.58], [0.5, 0.48, 0.43], k);
        const col = mix(base, brick ? [0.3, 0.12, 0.08] : [0.35, 0.33, 0.3], n2(u, v) * 0.5 + fine(u, v) * 0.25);
        return { rgb: col, h: 0.6 + Math.min(1, c.inside * 3) * 0.3 + n2(u, v) * 0.1, r: 0.85 };
      };
    }
    case 'Concrete':
    case 'Plaster':
      return (u, v) => {
        const plaster = name === 'Plaster';
        const t = n1(u, v) * 0.6 + n2(u, v) * 0.3 + fine(u, v) * 0.1;
        const pit = !plaster && fine(u * 1.7, v * 1.3) > 0.82;
        const col = plaster ? mix([0.93, 0.91, 0.86], [0.83, 0.8, 0.74], t) : mix([0.7, 0.69, 0.66], [0.52, 0.51, 0.49], t);
        return { rgb: pit ? mix(col, [0.3, 0.3, 0.3], 0.5) : col, h: pit ? 0.3 : 0.5 + (plaster ? fine(u, v) : t) * 0.2, r: plaster ? 0.92 : 0.88 };
      };
    case 'Ceramic tiles':
    case 'Terracotta tiles': {
      const white = name === 'Ceramic tiles';
      return (u, v) => {
        const c = courses(u, v, 6, 6, white ? 0.012 : 0.02, 0);
        const k = cell(c.row, c.col);
        if (c.mortar) return { rgb: white ? [0.75, 0.74, 0.72] : [0.62, 0.58, 0.52], h: 0.2, r: 0.9 };
        const col = white ? mix([0.95, 0.95, 0.94], [0.88, 0.88, 0.87], k * 0.6 + fine(u, v) * 0.2) : mix([0.78, 0.43, 0.28], [0.62, 0.32, 0.2], k * 0.7 + n2(u, v) * 0.3);
        return { rgb: col, h: 0.7, r: white ? 0.25 : 0.7 };
      };
    }
    case 'Roof tiles':
      return (u, v) => {
        const rows = 10;
        const cols = 8;
        const rv = v * rows;
        const row = Math.floor(rv);
        const fv = rv - row;
        const ru = u * cols + (row % 2) * 0.5;
        const fu = ru - Math.floor(ru);
        const k = cell(row, Math.floor(ru) % cols);
        const curve = Math.sin(fu * Math.PI);
        const shade = 0.55 + 0.45 * curve * (0.6 + 0.4 * fv);
        const col = mix([0.6, 0.27, 0.17], [0.45, 0.2, 0.13], k * 0.6 + n2(u, v) * 0.3).map((x) => x * shade);
        return { rgb: col, h: curve * 0.6 + fv * 0.3, r: 0.75 };
      };
    case 'Marble':
      return (u, v) => {
        const vein = Math.abs(Math.sin((u * 3 + v * 2 + n1(u, v) * 4) * Math.PI));
        const t = Math.pow(1 - vein, 8);
        return { rgb: mix(mix([0.94, 0.93, 0.91], [0.86, 0.85, 0.83], n2(u, v)), [0.42, 0.42, 0.44], t * 0.8), h: 0.5, r: 0.18 };
      };
    case 'Grass':
      return (u, v) => {
        const t = n1(u, v) * 0.5 + fine(u, v) * 0.5;
        const blade = fine(u * 3.1, v * 0.7);
        return { rgb: mix([0.36, 0.55, 0.2], [0.2, 0.36, 0.1], t).map((x, k) => x * (0.8 + blade * 0.4) + (k === 0 ? n2(u, v) * 0.05 : 0)), h: blade, r: 0.95 };
      };
    case 'Gravel':
      return (u, v) => {
        const c = courses(u + n2(u, v) * 0.04, v + n1(u, v) * 0.04, 24, 24, 0.006, 0.5);
        const k = cell(c.row, c.col);
        const stone = mix([0.66, 0.63, 0.58], [0.42, 0.4, 0.37], k);
        return { rgb: c.mortar ? [0.3, 0.28, 0.25] : mix(stone, [0.25, 0.24, 0.22], fine(u, v) * 0.3), h: c.mortar ? 0.1 : 0.4 + c.inside * 0.6, r: 0.9 };
      };
    case 'Asphalt':
      return (u, v) => {
        const t = fine(u, v) * 0.7 + n2(u, v) * 0.3;
        const chip = fine(u * 2.3, v * 2.1) > 0.78;
        return { rgb: chip ? [0.42, 0.42, 0.42] : mix([0.2, 0.2, 0.21], [0.12, 0.12, 0.13], t), h: chip ? 0.7 : 0.4 + t * 0.2, r: 0.9 };
      };
    case 'Brushed metal': {
      const coarse = noise2(seed, 4);
      const lines = noise2(seed + 3, 256);
      return (u, v) => {
        const streak = coarse(u * 0.02, v) * 0.5 + lines(u * 0.01, v) * 0.5;
        return { rgb: mix([0.72, 0.73, 0.75], [0.58, 0.6, 0.62], streak), h: streak * 0.3, r: 0.3 + streak * 0.15 };
      };
    }
    default:
      throw new Error(`No material "${name}". Materials: ${Object.keys(LIBRARY).join(', ')}.`);
  }
}

/** Colour, normal and roughness pixels (RGBA, size × size) of a library material. */
export function makeMaps(name, size = 512) {
  const f = shader(name);
  const n = size * size;
  const color = new Uint8ClampedArray(n * 4);
  const rough = new Uint8ClampedArray(n * 4);
  const height = new Float32Array(n);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = f((x + 0.5) / size, (y + 0.5) / size);
      const i = y * size + x;
      color.set([p.rgb[0] * 255, p.rgb[1] * 255, p.rgb[2] * 255, 255], i * 4);
      const r = clamp(p.r) * 255;
      rough.set([r, r, r, 255], i * 4);
      height[i] = p.h;
    }
  // normal map from the height (wrapping, so it tiles); OpenGL convention, green up
  const normal = new Uint8ClampedArray(n * 4);
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const k = 2.5;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      normal.set([((-dx / l) * 0.5 + 0.5) * 255, ((dy / l) * 0.5 + 0.5) * 255, ((1 / l) * 0.5 + 0.5) * 255, 255], (y * size + x) * 4);
    }
  return { size, color, normal, rough };
}

// ---------------------------------------------------------------- PNG
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** RGBA pixels → PNG bytes. */
export function png(rgba, w, h) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}
