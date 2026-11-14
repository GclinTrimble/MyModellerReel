// Point cloud display (#295–#297): the ASPRS class table, colour ramps, ranges, the style and filter a cloud carries
// (per pane overrides) and the filter predicate the CPU uses for snapping and counts, so it agrees with the GPU.

/** ASPRS LAS 1.4 classes (R14): code → [name, default colour]. Codes 19–63 are reserved, 64–255 user defined. */
export const CLASSES = {
  0: ['Created, never classified', '#9e9e9e'],
  1: ['Unclassified', '#b0b0b0'],
  2: ['Ground', '#a0703c'],
  3: ['Low vegetation', '#9ad65b'],
  4: ['Medium vegetation', '#4caf50'],
  5: ['High vegetation', '#1e6b2e'],
  6: ['Building', '#e0533d'],
  7: ['Low point (noise)', '#ff00ff'],
  8: ['Reserved (model key point)', '#c0c0c0'],
  9: ['Water', '#2f80ed'],
  10: ['Rail', '#7b5a3a'],
  11: ['Road surface', '#4a4a4a'],
  12: ['Reserved (overlap)', '#d0d0d0'],
  13: ['Wire guard (shield)', '#f2c94c'],
  14: ['Wire conductor (phase)', '#f2994a'],
  15: ['Transmission tower', '#bb6bd9'],
  16: ['Wire-structure connector', '#56ccf2'],
  17: ['Bridge deck', '#8d6e63'],
  18: ['High noise', '#ff4081'],
};
export const className = (c) => CLASSES[c]?.[0] || (c >= 64 ? `User class ${c}` : `Reserved ${c}`);
export const classColor = (c, custom = {}) => custom[c] || CLASSES[c]?.[1] || '#b0b0b0';

export const COLOR_BY = ['rgb', 'intensity', 'elevation', 'classification', 'return_number', 'gps_time', 'point_source', 'normal', 'single', 'rgb_intensity', 'depth'];
export const SIZE_MODES = ['fixed', 'attenuated', 'adaptive'];
export const SHAPES = ['square', 'round', 'paraboloid'];
export const DEPTH = ['off', 'xray', 'depth', 'fog'];
export const RETURNS = ['all', 'first', 'last', 'only'];

/** Named ramps as colour stops, low to high. */
export const RAMPS = {
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  terrain: ['#2f6f9f', '#3c9a5a', '#d8d27a', '#a0703c', '#f2f2f2'],
  grey: ['#000000', '#ffffff'],
  spectral: ['#5e4fa2', '#3288bd', '#66c2a5', '#e6f598', '#fee08b', '#f46d43', '#9e0142'],
  warm_cool: ['#f46d43', '#fee08b', '#66c2a5', '#3288bd'], // depth colour: near warm, far cool
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
/** A ramp by name, or custom stops (two or three '#rrggbb'). */
export function rampStops(ramp) {
  if (Array.isArray(ramp) && ramp.length >= 2) return ramp;
  return RAMPS[ramp] || RAMPS.viridis;
}
/** Colour of a ramp at t (0–1), [r, g, b] 0–1. */
export function sampleRamp(ramp, t) {
  const s = rampStops(ramp).map(hex);
  const x = Math.min(1, Math.max(0, t || 0)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x));
  const f = x - i;
  return s[i].map((v, k) => v + (s[i + 1][k] - v) * f);
}
/** 256 × 1 RGBA bytes of a ramp (the shader's ramp texture). */
export function rampBytes(ramp) {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = sampleRamp(ramp, i / 255);
    out.set([...c.map((v) => Math.round(v * 255)), 255], i * 4);
  }
  return out;
}
/** 256 × 1 RGBA bytes of the class table: colour, alpha 255 when the class is shown, 0 when hidden. */
export function classBytes(colors = {}, hide = []) {
  const out = new Uint8Array(256 * 4);
  const off = new Set(hide.map(Number));
  for (let c = 0; c < 256; c++) out.set([...hex(classColor(c, colors)).map((v) => Math.round(v * 255)), off.has(c) ? 0 : 255], c * 4);
  return out;
}

/** The lo / hi fractiles of values (2nd–98th percentile by default) through a 1024-bin histogram. */
export function percentileRange(values, lo = 0.02, hi = 0.98) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of values) if (Number.isFinite(v)) (mn = Math.min(mn, v)), (mx = Math.max(mx, v));
  if (!(mx > mn)) return [Number.isFinite(mn) ? mn : 0, Number.isFinite(mx) ? mx : 1];
  const bins = new Uint32Array(1024);
  let n = 0;
  for (const v of values) if (Number.isFinite(v)) bins[Math.min(1023, Math.floor(((v - mn) / (mx - mn)) * 1024))]++, n++;
  const at = (q) => {
    let s = 0;
    for (let i = 0; i < 1024; i++) if ((s += bins[i]) >= q * n) return mn + ((mx - mn) * i) / 1024;
    return mx;
  };
  return [at(lo), Math.max(at(hi), at(lo) + 1e-9)];
}

// ---------------------------------------------------------------- the preview asset

/**
 * The preview asset's arrays. Layout 1 (before #295): xyz Float32 then rgb Uint8 when pc.colors. Layout 2 adds, after
 * the rgb block and each only when pc.attributes says so: intensity Uint16, classification Uint8, returns Uint8
 * (return number | number of returns << 4), gps time Float32 (seconds after pc.attributes.time0), point source Uint16.
 */
export function decodePreview(pc, bytes) {
  const n = pc.count;
  let at = 0;
  const take = (Type, k) => {
    const a = new Type(bytes.slice(at, at + n * k * Type.BYTES_PER_ELEMENT).buffer);
    at += n * k * Type.BYTES_PER_ELEMENT;
    return a;
  };
  const out = { count: n, position: take(Float32Array, 3) };
  if (pc.colors) out.rgb = take(Uint8Array, 3);
  const A = pc.attributes || {};
  if (A.intensity) out.intensity = take(Uint16Array, 1);
  if (A.classification) out.classification = take(Uint8Array, 1);
  if (A.returns) out.returns = take(Uint8Array, 1);
  if (A.time) out.gpsTime = take(Float32Array, 1);
  if (A.source) out.pointSource = take(Uint16Array, 1);
  return out;
}
/** Bytes of a layout 2 preview from kept indices of a parsed cloud and its positions / colours already made. */
export function encodeAttributes(pc, keep) {
  const parts = [];
  const attributes = {};
  const pick = (src, Type) => Type.from(keep, (i) => src[i]);
  if (pc.intensity) (attributes.intensity = true), parts.push(pick(pc.intensity, Uint16Array));
  if (pc.classification) (attributes.classification = true), parts.push(pick(pc.classification, Uint8Array));
  if (pc.returnNumber) (attributes.returns = true), parts.push(Uint8Array.from(keep, (i) => (pc.returnNumber[i] & 15) | ((pc.numberOfReturns[i] & 15) << 4)));
  if (pc.gpsTime) {
    let t0 = Infinity;
    for (const i of keep) t0 = Math.min(t0, pc.gpsTime[i]);
    attributes.time = true;
    attributes.time0 = t0;
    parts.push(Float32Array.from(keep, (i) => pc.gpsTime[i] - t0));
  }
  if (pc.pointSource) (attributes.source = true), parts.push(pick(pc.pointSource, Uint16Array));
  return { attributes, parts: parts.map((p) => new Uint8Array(p.buffer)) };
}

// ---------------------------------------------------------------- style and filter

export const STYLE = { color_by: 'rgb', gamma: 1, size: 2, size_mode: 'fixed', min_px: 1, max_px: 12, shape: 'square', opacity: 1, edl: false, edl_strength: 0.7, edl_radius: 1.4, depth: 'off', xray_strength: 1, fog_near: 2, fog_far: 10, focus: 'cursor' };

/** A cloud's style in a pane: the defaults, the cloud's own, then the pane's override. */
export function styleOf(e, pane = 1) {
  const s = e.pointcloud?.style || {};
  const { panes, ...own } = s;
  const st = { ...STYLE, ...own, ...(panes?.[pane] || {}) };
  if (!e.pointcloud?.style?.color_by && !(panes?.[pane] || {}).color_by && !e.pointcloud?.colors) st.color_by = e.pointcloud?.attributes?.classification ? 'classification' : 'single';
  st.color ||= e.material?.color || '#7a8a96';
  return st;
}
/** A cloud's filter in a pane. */
export function filterOf(e, pane = 1) {
  const { panes, ...own } = e.pointcloud?.filter || {};
  return { ...own, ...(panes?.[pane] || {}) };
}
/** Fold a change into a style or filter object, per pane when pane > 1 (null clears a field). */
export function merge(cur = {}, change, pane) {
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
  if (pane > 1) return { ...cur, panes: { ...cur.panes, [pane]: clean({ ...cur.panes?.[pane], ...change }) } };
  return clean({ ...cur, ...change });
}

/** The same hash as the shader: a stable 0–1 value per point index (density filter, no shimmer). */
export function hash01(i) {
  return ((Math.imul(i >>> 0, 2654435761) >>> 8) & 0xffff) / 65536;
}

/**
 * Does a point pass the filter? point: { classification, y (world height), hag (height above ground), intensity,
 * returnNumber, numberOfReturns, gpsTime (s after time0), pointSource, index, spacing (the coarsest spacing it
 * survives) }. Absent attributes pass their test.
 */
export function passes(p, f) {
  if (f.hide?.length && p.classification !== undefined && f.hide.includes(p.classification)) return false;
  if (f.elevation) {
    const z = f.above_ground ? p.hag : p.y;
    if (z !== undefined && (z < f.elevation[0] || z > f.elevation[1])) return false;
  }
  if (f.intensity && p.intensity !== undefined && (p.intensity < f.intensity[0] || p.intensity > f.intensity[1])) return false;
  if (f.returns && f.returns !== 'all' && p.returnNumber !== undefined) {
    const r = p.returnNumber;
    const n = p.numberOfReturns || 1;
    if (f.returns === 'first' && r !== 1) return false;
    if (f.returns === 'last' && r !== n) return false;
    if (f.returns === 'only' && n !== 1) return false;
  }
  if (f.time && p.gpsTime !== undefined && (p.gpsTime < f.time[0] || p.gpsTime > f.time[1])) return false;
  if (f.source?.length && p.pointSource !== undefined && !f.source.includes(p.pointSource)) return false;
  if (f.density !== undefined && f.density < 100 && hash01(p.index) >= f.density / 100) return false;
  if (f.spacing > 0 && p.spacing !== undefined && p.spacing < f.spacing) return false;
  return true;
}

/** Point i of decoded preview data as passes() wants it (heights in the world: entity y added). */
export function pointAt(d, i, dy = 0, extra = {}) {
  return {
    index: i,
    y: d.position[i * 3 + 1] + dy,
    classification: d.classification?.[i],
    intensity: d.intensity?.[i],
    returnNumber: d.returns ? d.returns[i] & 15 : undefined,
    numberOfReturns: d.returns ? d.returns[i] >> 4 : undefined,
    gpsTime: d.gpsTime?.[i],
    pointSource: d.pointSource?.[i],
    hag: extra.hag?.[i],
    spacing: extra.spacing?.[i],
  };
}

/**
 * The coarsest spacing (m) at which each point is still the one kept in its voxel, cells doubling from 1 cm: a
 * "draw at most one point per X" filter is then spacing[i] >= X, on the GPU as on the CPU.
 */
export function spacingRanks(pos, count) {
  const out = new Float32Array(count).fill(1e9);
  let alive = Array.from({ length: count }, (_, i) => i);
  for (let cell = 0.01; alive.length > 1 && cell < 1000; cell *= 2) {
    const seen = new Set();
    const next = [];
    for (const i of alive) {
      const k = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
      if (seen.has(k)) out[i] = cell;
      else seen.add(k), next.push(i);
    }
    alive = next;
  }
  return out;
}

/** Height above ground per point: the ground (class 2 when there is any, else the lowest point) per cell of 3 × 3. */
export function heightAboveGround(pos, count, classes, cell = 1) {
  const useClass = classes && classes.some((c) => c === 2);
  const low = new Map();
  const key = (x, z) => `${x},${z}`;
  for (let i = 0; i < count; i++) {
    if (useClass && classes[i] !== 2) continue;
    const k = key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 2] / cell));
    if (!(low.get(k) <= pos[i * 3 + 1])) low.set(k, pos[i * 3 + 1]);
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(pos[i * 3] / cell);
    const cz = Math.floor(pos[i * 3 + 2] / cell);
    let g = Infinity;
    for (let r = 1; g === Infinity && r < 64; r *= 2) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) g = Math.min(g, low.get(key(cx + dx, cz + dz)) ?? Infinity);
    out[i] = Number.isFinite(g) ? pos[i * 3 + 1] - g : 0;
  }
  return out;
}

/** The range a mode colours over: the style's own, or fitted to the data (intensity 2–98 %, heights min–max). */
export function autoRange(st, d, dy = 0) {
  if (st.range) return st.range;
  if (st.color_by === 'intensity' || st.color_by === 'rgb_intensity') return d.intensity ? percentileRange(d.intensity) : [0, 65535];
  if (st.color_by === 'elevation') {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 1; i < d.position.length; i += 3) (mn = Math.min(mn, d.position[i])), (mx = Math.max(mx, d.position[i]));
    return Number.isFinite(mn) ? [mn + dy, Math.max(mx, mn + 1e-6) + dy] : [0, 1];
  }
  if (st.color_by === 'gps_time') return d.gpsTime ? percentileRange(d.gpsTime, 0, 1) : [0, 1];
  if (st.color_by === 'return_number') return [1, 5];
  if (st.color_by === 'point_source') return d.pointSource ? percentileRange(d.pointSource, 0, 1) : [0, 1];
  return [0, 1];
}

/** Class counts: [{ code, name, count, visible, shown }] (shown: points of that class drawn under the filter). */
export function classCounts(d, f = {}, dy = 0, extra = {}) {
  const all = new Map();
  const shown = new Map();
  for (let i = 0; i < d.count; i++) {
    const c = d.classification ? d.classification[i] : 1;
    all.set(c, (all.get(c) || 0) + 1);
    if (passes(pointAt(d, i, dy, extra), f)) shown.set(c, (shown.get(c) || 0) + 1);
  }
  return [...all].sort((a, b) => a[0] - b[0]).map(([code, count]) => ({ code, name: className(code), count, visible: !f.hide?.includes(code), shown: shown.get(code) || 0 }));
}

/** The ramp a style colours with: its own, else grey for intensity, warm to cool for depth, viridis otherwise. */
export const rampFor = (st) => st.ramp || (st.color_by === 'depth' || st.depth === 'depth' ? 'warm_cool' : st.color_by === 'intensity' || st.color_by === 'rgb_intensity' ? 'grey' : 'viridis');

/** What the legend shows for a style: a ramp with its ends, or class swatches. */
export function legend(st, range, classes = []) {
  if (st.depth === 'depth' || st.color_by === 'depth') return { kind: 'ramp', title: 'Distance from the eye', stops: rampStops(rampFor(st)), low: 'near', high: 'far', ramp: rampFor(st) };
  const unit = { intensity: '', rgb_intensity: '', elevation: ' m', gps_time: ' s', depth: ' m', return_number: '', point_source: '' }[st.color_by];
  if (st.color_by === 'classification') return { kind: 'classes', title: 'Classification', items: classes.map((c) => ({ code: c.code, name: c.name, color: classColor(c.code, st.class_colors), visible: c.visible })) };
  if (unit === undefined) return { kind: 'none', title: { rgb: 'RGB', single: 'Single colour', normal: 'Normals' }[st.color_by] || st.color_by };
  const ramp = rampFor(st);
  const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100) + unit;
  const title = { intensity: 'Intensity', rgb_intensity: 'RGB × intensity', elevation: 'Elevation', gps_time: 'GPS time', depth: 'Distance', return_number: 'Return number', point_source: 'Point source' }[st.color_by];
  return { kind: 'ramp', title, stops: rampStops(ramp), low: fmt(range[0]), high: fmt(range[1]), ramp };
}
