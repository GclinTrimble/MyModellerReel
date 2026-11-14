// A small synthetic street scan as LAS 1.2 point format 3 (xyz, intensity, returns, classification, point source, GPS
// time, RGB) for the point cloud display tests and help frames (#295–#297): a road with bright lane markings, ground
// with a ditch, two buildings either side of the street and trees with several returns. Deterministic.

/** { bytes: Uint8Array (the .las), counts: { class: n }, total, last, markings } */
export function streetScan({ step = 0.3 } = {}) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = [];
  const add = (x, y, z, cls, intensity, rgb, ret = 1, of = 1) => pts.push({ x, y, z, cls, intensity: Math.round(intensity * (0.9 + 0.2 * rnd())), rgb, ret, of });
  const jit = () => (rnd() - 0.5) * step * 0.6;
  const ground = (x, y) => 0.02 * x + (y > 5 && y < 7 ? -0.8 * Math.sin(((y - 5) / 2) * Math.PI) : 0);
  const B = [
    { x0: 8, x1: 24, y0: 10, y1: 20, h: 8 },
    { x0: -22, x1: -6, y0: -21, y1: -11, h: 11 },
  ];
  const inB = (x, y) => B.some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);
  const trees = [[-12, -7], [2, -7], [16, -7]];
  const underTree = (x, y) => trees.some(([tx, ty]) => Math.hypot(x - tx, y - ty) < 2.6);
  let markings = 0;
  for (let x = -30; x < 30; x += step) {
    for (let y = -24; y < 24; y += step) {
      const px = x + jit();
      const py = y + jit();
      if (inB(px, py)) continue;
      const z = ground(px, py);
      if (Math.abs(py) < 4) {
        const mark = Math.abs(py) < 0.1 + step / 2 ? Math.floor((px + 30) / 3) % 2 === 0 : Math.abs(Math.abs(py) - 3.8) < 0.1 + step / 2;
        if (mark) markings++;
        add(px, py, z, 11, mark ? 42000 : 9000, mark ? [235, 235, 225] : [70, 72, 76]);
      } else add(px, py, z, 2, 16000, py > 5 && py < 7 ? [96, 110, 70] : [128, 104, 74], underTree(px, py) ? 2 : 1, underTree(px, py) ? 2 : 1);
    }
  }
  for (const b of B) {
    for (let z = 0; z < b.h; z += step) {
      for (let x = b.x0; x < b.x1; x += step) for (const y of [b.y0, b.y1]) add(x + jit(), y, z + jit(), 6, 20000, [176, 84, 64]);
      for (let y = b.y0; y < b.y1; y += step) for (const x of [b.x0, b.x1]) add(x, y + jit(), z + jit(), 6, 20000, [176, 84, 64]);
    }
    for (let x = b.x0; x < b.x1; x += step) for (let y = b.y0; y < b.y1; y += step) add(x + jit(), y + jit(), b.h, 6, 26000, [120, 120, 128]);
  }
  for (const [tx, ty] of trees) {
    for (let z = 0; z < 2.5; z += step / 2) add(tx + jit() * 0.3, ty + jit() * 0.3, z, 4, 12000, [92, 70, 50]);
    for (let k = 0; k < 900; k++) {
      const u = rnd() * 2 * Math.PI;
      const v = Math.acos(2 * rnd() - 1);
      const r = 2.4 * Math.cbrt(rnd());
      const z = 5 + r * Math.cos(v);
      add(tx + r * Math.sin(v) * Math.cos(u), ty + r * Math.sin(v) * Math.sin(u), z, z < 3.2 ? 3 : 5, 6000, [60, 130, 60], 1, 2);
    }
  }
  const recLen = 34;
  const buf = new ArrayBuffer(227 + pts.length * recLen);
  const dv = new DataView(buf);
  'LASF'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint8(24, 1);
  dv.setUint8(25, 2);
  dv.setUint16(94, 227, true);
  dv.setUint32(96, 227, true);
  dv.setUint8(104, 3);
  dv.setUint16(105, recLen, true);
  dv.setUint32(107, pts.length, true);
  [0.001, 0.001, 0.001, 650000, 5400000, 100].forEach((v, k) => dv.setFloat64(131 + k * 8, v, true));
  const counts = {};
  let last = 0;
  pts.forEach((q, i) => {
    const p = 227 + i * recLen;
    dv.setInt32(p, Math.round(q.x / 0.001), true);
    dv.setInt32(p + 4, Math.round(q.y / 0.001), true);
    dv.setInt32(p + 8, Math.round(q.z / 0.001), true);
    dv.setUint16(p + 12, Math.min(65535, q.intensity), true);
    dv.setUint8(p + 14, (q.ret & 7) | ((q.of & 7) << 3));
    dv.setUint8(p + 15, q.cls);
    dv.setUint16(p + 18, q.x < 0 ? 1 : 2, true); // two flight lines
    dv.setFloat64(p + 20, 400000 + (q.x + 30) * 0.5 + (q.x < 0 ? 0 : 100), true);
    q.rgb.forEach((c, k) => dv.setUint16(p + 28 + k * 2, c << 8, true));
    counts[q.cls] = (counts[q.cls] || 0) + 1;
    if (q.ret === q.of) last++;
  });
  return { bytes: new Uint8Array(buf), counts, total: pts.length, last, markings };
}
