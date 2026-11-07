// Keyframe animation and sequencing. A track animates one property of one target (an entity id or 'camera').
// track = { target, property, keys: [{ t, v, ease }] } — `ease` shapes the segment that ends at that key.
// Properties: position | rotation | scale (number[3]), opacity (0..1), visible (bool), color ('#rrggbb'),
// and for the camera: position | target (number[3]), fov (degrees).

export const EASES = {
  linear: (u) => u,
  'ease-in': (u) => u * u * u,
  'ease-out': (u) => 1 - (1 - u) ** 3,
  'ease-in-out': (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  bounce: (u) => {
    const n = 7.5625;
    const d = 2.75;
    if (u < 1 / d) return n * u * u;
    if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
    if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
    return n * (u -= 2.625 / d) * u + 0.984375;
  },
  back: (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2,
  step: (u) => (u < 1 ? 0 : 1),
};

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

function lerp(a, b, u) {
  if (typeof a === 'boolean') return u < 1 ? a : b;
  if (typeof a === 'number') return a + (b - a) * u;
  if (typeof a === 'string') return toHex(hex(a).map((x, k) => x + (hex(b)[k] - x) * u));
  return a.map((x, k) => x + (b[k] - x) * u);
}

export function sample(track, t) {
  const k = track.keys;
  if (!k.length) return undefined;
  if (t <= k[0].t) return k[0].v;
  if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  let i = 1;
  while (k[i].t < t) i++;
  const a = k[i - 1];
  const b = k[i];
  const u = (t - a.t) / (b.t - a.t || 1);
  return lerp(a.v, b.v, (EASES[b.ease] || EASES['ease-in-out'])(u));
}

/** Everything animated at time t: { [target]: { [property]: value } }: keyframes, then procedural motions on top. */
export function evaluate(doc, t) {
  const out = {};
  for (const tr of doc.animation.tracks) {
    const v = sample(tr, t);
    if (v !== undefined) (out[tr.target] ||= {})[tr.property] = v;
  }
  for (const m of doc.animation.motions || []) applyMotion(doc, m, t, out);
  return out;
}

// ---------------------------------------------------------------- markers: named times commands can target

/**
 * A time in seconds from a number, a numeric string, or a marker name with an optional offset
 * ("roof", "roof + 1.5", "Roof-0.5"). Throws with the marker list when the name is unknown.
 */
export function timeOf(doc, v, fallback = 0) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (Number.isFinite(+s)) return +s;
  const markers = doc.animation.markers || [];
  const exact = markers.find((x) => x.name.toLowerCase() === s.toLowerCase()); // "Level-2" is a name, not Level − 2
  if (exact) return exact.t;
  const m = s.match(/^(.*?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*s?$/);
  const name = (m ? m[1] : s).trim().toLowerCase();
  const mk = markers.find((x) => x.name.toLowerCase() === name);
  if (!mk) throw new Error(`No marker "${m ? m[1].trim() : s}". Markers: ${(doc.animation.markers || []).map((x) => x.name).join(', ') || 'none (add_marker makes one)'}.`);
  return Math.max(0, mk.t + (m ? (m[2] === '-' ? -1 : 1) * +m[3] : 0));
}

// ---------------------------------------------------------------- procedural motions (no keys: a formula of time)

export const MOTIONS = {
  spin: { property: 'rotation', about: 'degrees per second about axis' },
  oscillate: { property: 'position', about: 'back and forth along axis: amplitude (m, or degrees for rotation), frequency (Hz)' },
  wiggle: { property: 'position', about: 'smooth random shake: amplitude, frequency (Hz)' },
  orbit: { property: 'position', about: 'circle around center (default: where it is) in the horizontal plane: radius (amplitude), speed (degrees per second)' },
  pulse: { property: 'scale', about: 'breathing scale: amplitude (0.1 = ±10 %), frequency (Hz)' },
};
const AXIS = { x: 0, y: 1, z: 2 };

/** Smooth 1D value noise in [-1, 1], deterministic for a seed. */
function noise(seed, x) {
  const h = (i) => {
    let n = Math.imul(i ^ Math.imul(seed, 0x27d4eb2d), 0x9e3779b1);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967295 * 2 - 1;
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
const seedOf = (s) => [...String(s)].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261);

function baseOf(doc, target, property) {
  if (target === 'camera') return doc.camera[property] ?? (property === 'scale' ? [1, 1, 1] : [0, 0, 0]);
  const e = doc.entities.find((x) => x.id === target);
  return e?.[property];
}

/** Add one motion's effect at time t onto out[target][property] (on top of keyframes or the base pose). */
export function applyMotion(doc, m, t, out) {
  const start = m.start ?? 0;
  const end = m.end ?? Infinity;
  if (t < start) return;
  const u = Math.min(t, end) - start; // holds its last state after end
  const prop = m.property || MOTIONS[m.type]?.property;
  const base = out[m.target]?.[prop] ?? baseOf(doc, m.target, prop);
  if (!Array.isArray(base)) return;
  const v = [...base];
  const k = AXIS[m.axis || (m.type === 'spin' ? 'y' : 'x')] ?? 1;
  const amp = m.amplitude ?? (m.type === 'pulse' ? 0.1 : prop === 'rotation' ? 15 : 0.25);
  const f = m.frequency ?? (m.type === 'wiggle' ? 2 : 0.5);
  if (m.type === 'spin') v[k] += (m.speed ?? 90) * u;
  else if (m.type === 'oscillate') v[k] += amp * Math.sin(2 * Math.PI * f * u + ((m.phase ?? 0) * Math.PI) / 180);
  else if (m.type === 'wiggle') {
    // fades in and out over a quarter second so it never jumps
    const env = Math.min(1, u / 0.25, Number.isFinite(end) ? Math.max(0, (end - Math.min(t, end)) / 0.25) : 1);
    const s = seedOf(`${m.target}${m.id}`);
    const axes = m.axis ? [k] : [0, 1, 2];
    for (const a of axes) v[a] += amp * env * noise(s + a * 7919, f * u);
  } else if (m.type === 'orbit') {
    // around center (the camera circles its target); without one, a circle of `amplitude` that starts where it is
    const given = m.center || (m.target === 'camera' ? out.camera?.target || doc.camera.target : null);
    const r = given ? Math.hypot(base[0] - given[0], base[2] - given[2]) : (m.amplitude ?? 1);
    const c = given || [base[0] - r, base[1], base[2]];
    const a = Math.atan2(base[2] - c[2], base[0] - c[0]) + ((m.speed ?? 45) * u * Math.PI) / 180;
    v[0] = c[0] + r * Math.cos(a);
    v[2] = c[2] + r * Math.sin(a);
  } else if (m.type === 'pulse') {
    const s = 1 + amp * Math.sin(2 * Math.PI * f * u);
    for (let a = 0; a < 3; a++) v[a] *= s;
  }
  (out[m.target] ||= {})[prop] = v;
}

/** Shift every key (and motion) of a target by dt seconds. Keys never go below 0. */
export function shiftTarget(doc, target, dt) {
  for (const tr of doc.animation.tracks)
    if (tr.target === target) for (const k of tr.keys) k.t = Math.max(0, Math.round((k.t + dt) * 1000) / 1000);
  for (const m of doc.animation.motions || [])
    if (m.target === target) {
      m.start = Math.max(0, (m.start ?? 0) + dt);
      if (m.end !== undefined && m.end !== null) m.end = Math.max(m.start, m.end + dt);
    }
  const last = Math.max(0, ...doc.animation.tracks.flatMap((tr) => tr.keys.map((k) => k.t)));
  if (last > doc.animation.duration) doc.animation.duration = Math.ceil(last);
}

/** ease null/undefined keeps the easing of a key already at t (so chained moves don't lose their curves). */
export function setKey(doc, target, property, t, v, ease = null) {
  t = Math.max(0, Math.round(t * 1000) / 1000);
  let tr = doc.animation.tracks.find((x) => x.target === target && x.property === property);
  if (!tr) doc.animation.tracks.push((tr = { target, property, keys: [] }));
  ease ??= tr.keys.find((k) => Math.abs(k.t - t) <= 1e-3)?.ease ?? 'ease-in-out';
  tr.keys = tr.keys.filter((k) => Math.abs(k.t - t) > 1e-3);
  tr.keys.push({ t, v: structuredClone(v), ease });
  tr.keys.sort((a, b) => a.t - b.t);
  if (t > doc.animation.duration) doc.animation.duration = Math.ceil(t);
  return tr;
}

export function removeKeys(doc, target, property = null, t = null) {
  for (const tr of doc.animation.tracks)
    if (tr.target === target && (!property || tr.property === property))
      tr.keys = t === null ? [] : tr.keys.filter((k) => Math.abs(k.t - t) > 1e-3);
  doc.animation.tracks = doc.animation.tracks.filter((tr) => tr.keys.length);
}

/** Sorted unique key times, for the timeline ruler and "next key" navigation. */
export const keyTimes = (doc, target = null) =>
  [...new Set(doc.animation.tracks.filter((t) => !target || t.target === target).flatMap((t) => t.keys.map((k) => k.t)))].sort(
    (a, b) => a - b,
  );
