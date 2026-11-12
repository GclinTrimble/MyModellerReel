// How the model looks (#57–#62): texture projection (UVs from positions, so any polygon mesh can take an image),
// light, environment, effect and style settings with their defaults and checks. The renderer draws them
// (src/renderer/presentation.js); this module stays pure for tests and for Plumb's guide.

export const PROJECTIONS = ['box', 'planar', 'cylindrical'];
export const LIGHT_KINDS = ['point', 'spot', 'area'];
export const ENVIRONMENTS = ['default', 'studio', 'sky', 'sunset', 'night', 'hdri'];
export const STYLES = ['shaded', 'textured', 'hidden_line', 'monochrome', 'sketchy', 'xray_lines'];
export const EFFECTS = { ao: 0, bloom: 0, outline: false, dof: false, focus: null, aperture: 2.8, exposure: 1, vignette: 0 };
export const LENSES = [24, 35, 50, 85];

/**
 * Texture coordinates of a point on a face with normal n, in metres divided by the tile size, rotated and offset.
 * box: the face's dominant axis picks the plane; planar: always the given plane (top: x / −z); cylindrical: angle
 * around y (as arc length at the given radius) and height.
 */
export function uvFor(p, n, { projection = 'box', size = [1, 1], offset = [0, 0], rotation = 0, plane = 'top', radius = 1 } = {}) {
  let u;
  let v;
  if (projection === 'cylindrical') {
    u = Math.atan2(p[0], p[2]) * radius;
    v = p[1];
  } else {
    const ax = projection === 'planar' ? { top: 1, front: 2, side: 0 }[plane] ?? 1 : dominant(n);
    if (ax === 1) (u = p[0]), (v = -p[2] * Math.sign(n[1] || 1));
    else if (ax === 2) (u = p[0] * Math.sign(n[2] || 1)), (v = p[1]);
    else (u = -p[2] * Math.sign(n[0] || 1)), (v = p[1]);
  }
  const r = (rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [(c * u - s * v) / size[0] + offset[0], (s * u + c * v) / size[1] + offset[1]];
}
const dominant = (n) => {
  const a = n.map(Math.abs);
  return a[1] >= a[0] && a[1] >= a[2] ? 1 : a[2] >= a[0] ? 2 : 0;
};

/** A light with its defaults: physical-ish intensities that read well next to the default sun. */
export function lightOf(a) {
  const kind = a.kind || 'point';
  if (!LIGHT_KINDS.includes(kind)) throw new Error(`kind must be one of ${LIGHT_KINDS.join(', ')}.`);
  const L = { kind, color: a.color || '#ffd9a0', intensity: a.intensity ?? { point: 20, spot: 60, area: 8 }[kind] };
  if (kind !== 'area') L.distance = a.distance ?? 0; // 0: no cut-off
  if (kind === 'spot') (L.angle = a.angle ?? 35), (L.penumbra = a.penumbra ?? 0.4);
  if (kind === 'area') (L.width = a.width ?? 1), (L.height = a.height ?? 0.5);
  if (a.target) L.target = a.target;
  if (a.shadows !== undefined) L.shadows = !!a.shadows;
  if (!(L.intensity >= 0)) throw new Error('intensity must be 0 or more.');
  return L;
}

/** Merge effect settings, checked. */
export function effectsOf(cur = {}, a = {}) {
  const out = { ...EFFECTS, ...cur };
  for (const k of ['ao', 'bloom', 'vignette']) if (a[k] !== undefined) out[k] = a[k] === true ? 0.6 : a[k] === false ? 0 : clamp01(+a[k]);
  for (const k of ['outline', 'dof']) if (a[k] !== undefined) out[k] = !!a[k];
  if (a.focus !== undefined) out.focus = a.focus === null ? null : Math.max(0.1, +a.focus);
  if (a.aperture !== undefined) out.aperture = Math.max(0.7, Math.min(32, +a.aperture));
  if (a.exposure !== undefined) out.exposure = Math.max(0.05, Math.min(8, +a.exposure));
  return out;
}
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
export const effectsOn = (e) => !!e && (e.ao > 0 || e.bloom > 0 || e.outline || e.dof || e.vignette > 0);

/** Vertical field of view (degrees) of a lens on a full-frame camera (36 × 24 mm). */
export const fovOfLens = (mm) => (2 * Math.atan(12 / mm) * 180) / Math.PI;
export const lensOfFov = (fov) => 12 / Math.tan((fov * Math.PI) / 360);

/** Assets a document's looks use (textures, maps, an HDRI): saved with the file. */
export function lookAssets(doc) {
  const out = new Set();
  for (const e of doc.entities) {
    const m = e.material || {};
    if (m.texture?.asset) out.add(m.texture.asset);
    for (const id of Object.values(m.maps || {})) if (id) out.add(id);
  }
  if (doc.settings.environment?.asset) out.add(doc.settings.environment.asset);
  return out;
}
