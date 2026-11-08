// Profile library: named, parametric cross-sections to sweep along paths (pipes, kerbs, gutters, beams, walls).
// A profile is a counter-clockwise outline of [u, v] pairs in metres: u to the right of the travel direction, v up.
// Built-ins are functions of their parameters; documents can add fixed ones (define_profile). Pure, Node-tested.

const circle = (r, seg = 24, cx = 0, cy = 0) => Array.from({ length: seg }, (_, i) => [cx + r * Math.cos((i / seg) * 2 * Math.PI), cy + r * Math.sin((i / seg) * 2 * Math.PI)]);
const arc = (r, a0, a1, seg, cx = 0, cy = 0) => Array.from({ length: seg + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / seg;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

/** name → { description, params: { name: [default, description] }, anchor (default insertion point), build(p) } */
export const PROFILES = {
  rectangle: {
    description: 'Solid rectangle: slabs, beams, strips, boards',
    params: { width: [0.3, 'm'], height: [0.2, 'm'] },
    anchor: 'bottom-center',
    build: ({ width: w, height: h }) => [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]],
  },
  pipe: {
    description: 'Round pipe or duct (solid section)',
    params: { diameter: [0.3, 'outside diameter, m'], segments: [24, 'smoothness'] },
    anchor: 'center',
    build: ({ diameter, segments }) => circle(diameter / 2, Math.max(6, Math.round(segments))),
  },
  handrail: {
    description: 'Round handrail',
    params: { diameter: [0.045, 'm'] },
    anchor: 'center',
    build: ({ diameter }) => circle(diameter / 2, 16),
  },
  kerb: {
    description: 'Kerb (curb): vertical back, battered face towards the road on the left',
    params: { height: [0.255, 'total height, m'], width: [0.125, 'top width, m'], base: [0.15, 'base width, m'], upstand: [0.1, 'face height above the road, m'] },
    anchor: 'bottom-right',
    build: ({ height: h, width: w, base: b, upstand: u }) => [[-b, 0], [0, 0], [0, h], [-w, h], [-b, h - u]],
  },
  gutter: {
    description: 'Half-round gutter: an open channel with a wall thickness',
    params: { diameter: [0.125, 'inside diameter, m'], thickness: [0.004, 'm'] },
    anchor: 'top-center',
    build: ({ diameter, thickness: t }) => {
      const r = diameter / 2;
      const outer = arc(r + t, Math.PI, 2 * Math.PI, 16);
      const inner = arc(r, 2 * Math.PI, Math.PI, 16);
      return [...outer, ...inner];
    },
  },
  i_beam: {
    description: 'I-beam (H-section) steel',
    params: { height: [0.3, 'm'], width: [0.15, 'flange width, m'], web: [0.0071, 'web thickness, m'], flange: [0.0107, 'flange thickness, m'] },
    anchor: 'bottom-center',
    build: ({ height: h, width: b, web: tw, flange: tf }) => [
      [-b / 2, 0], [b / 2, 0], [b / 2, tf], [tw / 2, tf], [tw / 2, h - tf], [b / 2, h - tf], [b / 2, h],
      [-b / 2, h], [-b / 2, h - tf], [-tw / 2, h - tf], [-tw / 2, tf], [-b / 2, tf],
    ],
  },
  channel: {
    description: 'C / U channel steel, open to the right',
    params: { height: [0.2, 'm'], width: [0.075, 'm'], thickness: [0.008, 'm'] },
    anchor: 'bottom-left',
    build: ({ height: h, width: b, thickness: t }) => [[0, 0], [b, 0], [b, t], [t, t], [t, h - t], [b, h - t], [b, h], [0, h]],
  },
  angle: {
    description: 'L-angle steel',
    params: { width: [0.075, 'm'], height: [0.075, 'm'], thickness: [0.008, 'm'] },
    anchor: 'bottom-left',
    build: ({ width: b, height: h, thickness: t }) => [[0, 0], [b, 0], [b, t], [t, t], [t, h], [0, h]],
  },
  ditch: {
    description: 'Trapezoidal ditch or channel (the void: subtract it from terrain)',
    params: { depth: [0.6, 'm'], bottom: [0.5, 'bottom width, m'], slope: [1.5, 'side slope, horizontal per 1 vertical'] },
    anchor: 'top-center',
    build: ({ depth: d, bottom: b, slope: s }) => [[-b / 2, -d], [b / 2, -d], [b / 2 + s * d, 0], [-b / 2 - s * d, 0]],
  },
  retaining_wall: {
    description: 'Cantilever retaining wall: stem on a footing, toe to the left',
    params: { height: [2, 'total height, m'], stem: [0.3, 'stem thickness, m'], base: [1.4, 'footing width, m'], footing: [0.35, 'footing thickness, m'], toe: [0.4, 'toe length, m'] },
    anchor: 'bottom-left',
    build: ({ height: h, stem: s, base: b, footing: f, toe }) => [[0, 0], [b, 0], [b, f], [toe + s, f], [toe + s, h], [toe, h], [toe, f], [0, f]],
  },
  moulding: {
    description: 'Cove moulding / skirting with a rounded top',
    params: { height: [0.1, 'm'], depth: [0.02, 'm'] },
    anchor: 'bottom-left',
    build: ({ height: h, depth: d }) => [[0, 0], [d, 0], [d, h - d], ...arc(d, 0, Math.PI / 2, 6, 0, h - d).slice(1)],
  },
  // civil engineering sections (#211): roads, drainage, barriers, walls
  road_crown: {
    description: 'Road pavement with a crown: two lanes falling to each side at a crossfall, with a pavement depth',
    params: { width: [7, 'total width, m'], crossfall: [2.5, '% fall from the crown'], depth: [0.4, 'pavement depth, m'] },
    anchor: 'top-center',
    build: ({ width: w, crossfall: c, depth: d }) => { const f = (w / 2) * (c / 100); return [[-w / 2, -f - d], [w / 2, -f - d], [w / 2, -f], [0, 0], [-w / 2, -f]]; },
  },
  barrier_kerb: {
    description: 'Barrier kerb: a near-vertical face 150 mm high, road on the left',
    params: { height: [0.3, 'total height, m'], width: [0.15, 'm'], upstand: [0.15, 'face height above the road, m'] },
    anchor: 'bottom-left',
    build: ({ height: h, width: w, upstand: u }) => [[0, 0], [w, 0], [w, h], [0.02, h], [0, h - 0.02], [0, h - u]],
  },
  mountable_kerb: {
    description: 'Mountable (semi-mountable) kerb: a sloping face cars can drive over, road on the left',
    params: { height: [0.2, 'total height, m'], width: [0.3, 'm'], upstand: [0.1, 'face height above the road, m'] },
    anchor: 'bottom-left',
    build: ({ height: h, width: w, upstand: u }) => [[0, 0], [w, 0], [w, h], [w * 0.55, h], [0, h - u]],
  },
  footpath_kerb: {
    description: 'Footpath slab with its kerb on the road side (left)',
    params: { width: [1.8, 'footpath width, m'], thickness: [0.1, 'slab, m'], upstand: [0.15, 'kerb above the road, m'], kerb: [0.15, 'kerb width, m'] },
    anchor: 'bottom-left',
    build: ({ width: w, thickness: t, upstand: u, kerb: k }) => [[0, 0], [k + w, 0], [k + w, u + t], [0, u + t]],
  },
  v_ditch: {
    description: 'V-shaped ditch (the void: subtract it from terrain)',
    params: { depth: [0.5, 'm'], slope: [3, 'side slope, horizontal per 1 vertical'] },
    anchor: 'top-center',
    build: ({ depth: d, slope: s }) => [[0, -d], [s * d, 0], [-s * d, 0]],
  },
  lined_channel: {
    description: 'Concrete-lined trapezoidal channel: the lining as a solid',
    params: { depth: [0.8, 'm'], bottom: [0.6, 'bottom width, m'], slope: [1, 'side slope, H per 1 V'], thickness: [0.1, 'lining, m'] },
    anchor: 'top-center',
    build: ({ depth: d, bottom: b, slope: s, thickness: t }) => {
      const tw = b / 2 + s * d;
      return [[-tw - t, 0], [-tw, 0], [-b / 2, -d], [b / 2, -d], [tw, 0], [tw + t, 0], [b / 2 + t * 0.4, -d - t], [-b / 2 - t * 0.4, -d - t]];
    },
  },
  u_drain: {
    description: 'Precast U-drain / box culvert open at the top: walls and floor',
    params: { width: [0.6, 'inside width, m'], height: [0.6, 'inside height, m'], wall: [0.1, 'm'] },
    anchor: 'bottom-center',
    build: ({ width: w, height: h, wall: t }) => [[-w / 2 - t, 0], [w / 2 + t, 0], [w / 2 + t, h + t], [w / 2, h + t], [w / 2, t], [-w / 2, t], [-w / 2, h + t], [-w / 2 - t, h + t]],
  },
  hollow_pipe: {
    description: 'Hollow pipe or culvert: a ring with a wall thickness',
    params: { diameter: [0.6, 'inside diameter, m'], wall: [0.06, 'm'] },
    anchor: 'center',
    build: ({ diameter, wall: t }) => { const r = diameter / 2; return [...arc(r + t, 0, 2 * Math.PI, 32), ...arc(r, 2 * Math.PI, 0, 32)]; },
  },
  pipe_trench: {
    description: 'Pipe trench with sloped sides and bedding: the trench void, to subtract from terrain',
    params: { depth: [1.5, 'm'], bottom: [0.9, 'bottom width, m'], slope: [0.5, 'side slope, H per 1 V'] },
    anchor: 'top-center',
    build: ({ depth: d, bottom: b, slope: s }) => [[-b / 2, -d], [b / 2, -d], [b / 2 + s * d, 0], [-b / 2 - s * d, 0]],
  },
  guard_rail: {
    description: 'W-beam guard rail on its posts line (the rail as a folded steel section)',
    params: { height: [0.31, 'rail depth, m'], depth: [0.085, 'm'], thickness: [0.003, 'm'] },
    anchor: 'left',
    build: ({ height: h, depth: d, thickness: t }) => {
      const z = [[0, 0], [d, h * 0.2], [d, h * 0.4], [0, h * 0.5], [d, h * 0.6], [d, h * 0.8], [0, h]];
      return [...z, ...z.slice().reverse().map(([u, v]) => [u + t, v])];
    },
  },
  l_wall: {
    description: 'L-shaped retaining wall: a stem on a footing with its heel to the right',
    params: { height: [1.5, 'm'], stem: [0.2, 'm'], base: [1, 'footing width, m'], footing: [0.25, 'm'] },
    anchor: 'bottom-left',
    build: ({ height: h, stem: s, base: b, footing: f }) => [[0, 0], [b, 0], [b, f], [s, f], [s, h], [0, h]],
  },
};

export const ANCHORS = ['center', 'bottom-center', 'top-center', 'bottom-left', 'bottom-right', 'top-left', 'top-right', 'left', 'right'];

function bounds(pts) {
  const us = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/** Signed area of an outline (positive = counter-clockwise). */
export const area2d = (pts) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;

/** Every profile a document can use: built-ins plus its own (doc.profiles). */
export function listProfiles(doc) {
  const own = Object.entries(doc?.profiles || {}).map(([name, p]) => ({ name, description: p.description || 'Custom profile', params: {}, custom: true, points: p.points }));
  return [
    ...Object.entries(PROFILES).map(([name, p]) => ({ name, description: p.description, params: Object.fromEntries(Object.entries(p.params).map(([k, [d, desc]]) => [k, { default: d, description: desc }])), anchor: p.anchor })),
    ...own,
  ];
}

/**
 * The outline to sweep: a profile name (with parameters) or raw points, moved so the insertion point (anchor) is at
 * the origin, optionally mirrored left-right. Always returned counter-clockwise.
 */
export function profilePoints(spec, { params = {}, anchor = null, mirror = false, doc = null } = {}) {
  let pts;
  let defAnchor = 'center';
  if (Array.isArray(spec)) pts = spec.map(([u, v]) => [u, v]);
  else {
    const builtin = PROFILES[spec];
    const own = doc?.profiles?.[spec];
    if (!builtin && !own) throw new Error(`No profile "${spec}". Profiles: ${listProfiles(doc).map((p) => p.name).join(', ')}.`);
    if (builtin) {
      const unknown = Object.keys(params).filter((k) => !(k in builtin.params));
      if (unknown.length) throw new Error(`Profile ${spec} has no parameter ${unknown.join(', ')}. Parameters: ${Object.keys(builtin.params).join(', ')}.`);
      const p = Object.fromEntries(Object.entries(builtin.params).map(([k, [d]]) => [k, params[k] ?? d]));
      for (const [k, v] of Object.entries(p)) if (!(v >= 0)) throw new Error(`Profile ${spec}: ${k} must be a number ≥ 0.`);
      pts = builtin.build(p);
      defAnchor = builtin.anchor;
    } else (pts = own.points.map(([u, v]) => [u, v])), (defAnchor = own.anchor || 'center');
  }
  if (pts.length < 3) throw new Error('A profile needs at least 3 points.');
  const a = anchor || defAnchor;
  if (!ANCHORS.includes(a)) throw new Error(`anchor must be one of ${ANCHORS.join(', ')}.`);
  const b = bounds(pts);
  const du = a.includes('left') ? b.u0 : a.includes('right') ? b.u1 : (b.u0 + b.u1) / 2;
  const dv = a.startsWith('bottom') ? b.v0 : a.startsWith('top') ? b.v1 : (b.v0 + b.v1) / 2;
  pts = pts.map(([u, v]) => [u - du, v - dv]);
  if (mirror) pts = pts.map(([u, v]) => [-u, v]);
  if (area2d(pts) < 0) pts.reverse();
  return pts;
}

/** A small SVG drawing of a profile, for thumbnails. */
export function profileSvg(pts, size = 48) {
  const b = bounds(pts);
  const s = (size - 8) / Math.max(b.u1 - b.u0, b.v1 - b.v0, 1e-6);
  const d = pts.map(([u, v], i) => `${i ? 'L' : 'M'}${(4 + (u - b.u0) * s).toFixed(1)} ${(size - 4 - (v - b.v0) * s).toFixed(1)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><path d="${d} Z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
