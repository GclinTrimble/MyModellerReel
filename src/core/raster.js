// Scanned drawings to linework (#150): threshold the ink, thin it to one-pixel lines (Zhang–Suen), trace the
// lines into polylines and simplify them. Pixel coordinates in, pixel coordinates out; the caller maps them onto the
// drawing (its affine) and the model.
import { simplify } from './drafting.js';

/** Ink mask from grey values (0 black … 255 white): 1 where darker than threshold. */
export function binarize(gray, w, h, threshold = 128) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = gray[i] < threshold ? 1 : 0;
  return m;
}

/** Zhang–Suen thinning, in place: strokes become one pixel wide, their ends and junctions kept. */
export function thin(m, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  let changed = true;
  const del = [];
  for (let pass = 0; changed && pass < 200; pass++) {
    changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!m[y * w + x]) continue;
          const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
          const B = p.reduce((s, v) => s + v, 0);
          if (B < 2 || B > 6) continue;
          let A = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
          if (A !== 1) continue;
          if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
          del.push(y * w + x);
        }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** One-pixel lines → polylines [[x, y]…], cut at ends and junctions; shorter than minLength pixels dropped. */
export function trace(m, w, h, { minLength = 8 } = {}) {
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  const deg = (x, y) => N8.reduce((s, [dx, dy]) => s + (on(x + dx, y + dy) ? 1 : 0), 0);
  const used = new Uint8Array(w * h);
  const lines = [];
  const walk = (x0, y0) => {
    const line = [[x0, y0]];
    used[y0 * w + x0] = 1;
    let [x, y] = [x0, y0];
    for (;;) {
      let next = null;
      for (const [dx, dy] of N8) {
        const [nx, ny] = [x + dx, y + dy];
        if (on(nx, ny) && !used[ny * w + nx]) {
          next = [nx, ny];
          break;
        }
      }
      if (!next) break;
      [x, y] = next;
      used[y * w + x] = 1;
      line.push([x, y]);
      if (deg(x, y) > 2) break; // a junction: the next line starts here
    }
    return line;
  };
  // start from line ends and junctions first, then whatever is left (closed loops)
  for (const want of [(d) => d === 1, (d) => d > 2, () => true])
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!on(x, y) || used[y * w + x] || !want(deg(x, y))) continue;
        for (let k = 0; k < 8; k++) {
          const l = walk(x, y);
          if (l.length >= 2 && pathLength(l) >= minLength) lines.push(l);
          used[y * w + x] = 0; // let other branches start from this junction too
          if (!N8.some(([dx, dy]) => on(x + dx, y + dy) && !used[(y + dy) * w + x + dx])) break;
        }
        used[y * w + x] = 1;
      }
  return lines;
}
const pathLength = (l) => l.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0);

/** The whole thing: grey pixels → simplified polylines in pixels. */
export function vectorise(gray, w, h, { threshold = 128, minLength = 8, tolerance = 1 } = {}) {
  const m = thin(binarize(gray, w, h, threshold), w, h);
  return trace(m, w, h, { minLength }).map((l) => simplify(l.map(([x, y]) => [x + 0.5, y + 0.5]), tolerance)).filter((l) => l.length >= 2);
}
