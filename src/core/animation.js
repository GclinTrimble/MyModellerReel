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

/** Everything animated at time t: { [target]: { [property]: value } }. */
export function evaluate(doc, t) {
  const out = {};
  for (const tr of doc.animation.tracks) {
    const v = sample(tr, t);
    if (v !== undefined) (out[tr.target] ||= {})[tr.property] = v;
  }
  return out;
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
