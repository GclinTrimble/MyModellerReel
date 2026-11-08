// Roads through the terrain (#166–#172): the corridor's cross-sections (lanes, shoulders, ditches, benches, side
// slopes per side, superelevation), cut and fill areas and volumes by average end areas, the earthwork and pavement
// solids, and the finished ground (the existing ground with the road let into it). Pure maths, Node-tested. Works in
// world metres: x east, y up, z south; a section's offsets are positive to the right of the direction of travel.
import * as TR from './terrain.js';
import { insidePolygon } from './topology.js';

/** Colours of the corridor's faces by what they are (red-brown cut, blue fill, as on the cut/fill map). */
export const CODE_COLOR = { lane: '#4a4d52', shoulder: '#8d9093', ditch: '#7b6a4e', bench: '#a89f8a', cut: '#c4703a', fill: '#4f86b0' };
/** t/m³ by material name, for the quantities of the solids. */
export const DENSITY = { Asphalt: 2.4, 'Crushed stone': 2.2, Gravel: 2.0, Concrete: 2.4, Soil: 1.8, Topsoil: 1.5, 'Cut earth': 1.8, 'Fill earth': 1.9 };

/** A template with every default filled in. */
export function normTemplate(t = {}) {
  return {
    lanes: t.lanes?.length ? t.lanes : [{ width: 3.5, crossfall: -2.5 }],
    shoulder: t.shoulder || { width: 1, crossfall: -4 },
    cut_slope: t.cut_slope || 2,
    fill_slope: t.fill_slope || 3,
    left: t.left || {},
    right: t.right || {},
    ditch: t.ditch ? { width: 0.5, depth: 0.6, slope: 3, ...t.ditch } : null,
    bench: t.bench ? { every: 5, width: 2, ...t.bench } : null,
    layers: t.layers || [],
    superelevation: t.superelevation ? { rate: 6, runoff: 30, ...t.superelevation } : null,
  };
}

/** Point and horizontal unit tangent at a station along sampled [x, y, z, s] points. */
export function at(path, s) {
  let i = 1;
  while (i < path.length - 1 && path[i][3] < s) i++;
  const [p, q] = [path[i - 1], path[i]];
  const u = (s - p[3]) / (q[3] - p[3] || 1);
  const t = [q[0] - p[0], q[2] - p[2]];
  const L = Math.hypot(...t) || 1;
  return { p: [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u], t: [t[0] / L, t[1] / L] };
}

/** Where the centreline curves (radius under maxRadius): [[from, to, sign]], sign +1 turning right, -1 left. */
export function curveRanges(path, maxRadius = 3000) {
  const len = path.at(-1)[3];
  const out = [];
  let cur = null;
  for (let s = 0; s <= len; s += 1) {
    const a = at(path, Math.max(0, s - 1)).t;
    const b = at(path, Math.min(len, s + 1)).t;
    const turn = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]); // + right (towards x → z)
    const ds = Math.min(len, s + 1) - Math.max(0, s - 1);
    const on = Math.abs(turn) > 1e-9 && ds / Math.abs(turn) < maxRadius;
    const sign = Math.sign(turn);
    if (on && cur && cur[2] === sign) cur[1] = s;
    else if (on) out.push((cur = [s, s, sign]));
    else cur = null;
  }
  return out;
}

/** How far the superelevation is applied at a station (0–1) and which way the road turns there. */
export function superAt(ranges, s, runoff) {
  let best = { f: 0, sign: 0 };
  for (const [a, b, sign] of ranges) {
    const d = s < a ? a - s : s > b ? s - b : 0;
    const f = Math.max(0, 1 - d / Math.max(1e-6, runoff));
    if (f > best.f) best = { f, sign };
  }
  return best;
}

/** Linear interpolation of a polyline [{ o, y }] (sorted by o) at offset o. */
export function lineAt(pts, o) {
  if (o <= pts[0].o) return pts[0].y;
  for (let i = 1; i < pts.length; i++) if (o <= pts[i].o) {
    const [p, q] = [pts[i - 1], pts[i]];
    return q.o - p.o < 1e-9 ? q.y : p.y + ((q.y - p.y) * (o - p.o)) / (q.o - p.o);
  }
  return pts.at(-1).y;
}

/** The side slope from the road edge out to the ground: a ditch at the foot of a cut, benches, then daylight. */
function sideSlope(edge, sgn, G, tpl, sideOpts) {
  const cs = sideOpts.cut_slope || tpl.cut_slope;
  const fs = sideOpts.fill_slope || tpl.fill_slope;
  const g0 = G(edge.o);
  if (g0 === null) return { kind: 'fill', pts: [{ o: edge.o + sgn * 3, y: edge.y - 3 / fs, code: 'fill' }] };
  const cut = g0 > edge.y + 1e-6;
  const segs = [];
  if (cut && tpl.ditch) segs.push([tpl.ditch.depth * tpl.ditch.slope, -tpl.ditch.depth, 'ditch', false], [tpl.ditch.width, 0, 'ditch', false]);
  for (let k = 0; segs.length < 60; k++) {
    if (tpl.bench) segs.push(cut ? [tpl.bench.every * cs, tpl.bench.every, 'cut', true] : [tpl.bench.every * fs, -tpl.bench.every, 'fill', true], [tpl.bench.width, 0, 'bench', true]);
    else {
      segs.push(cut ? [100, 100 / cs, 'cut', true] : [100, -100 / fs, 'fill', true]);
      break;
    }
  }
  const pts = [];
  let cur = edge;
  for (const [dO, dY, code, look] of segs) {
    const L = Math.hypot(dO, dY);
    const n = Math.max(1, Math.ceil(L / 0.25));
    let prev = cur;
    let prevDiff = G(cur.o) === null ? null : G(cur.o) - cur.y;
    for (let k = 1; k <= n; k++) {
      const q = { o: cur.o + (sgn * dO * k) / n, y: cur.y + (dY * k) / n };
      const g = G(q.o);
      if (g === null) return { kind: cut ? 'cut' : 'fill', pts: [...pts, { ...prev, code }] };
      const diff = g - q.y;
      if (look && prevDiff !== null && (cut ? prevDiff > 0 && diff <= 0 : prevDiff < 0 && diff >= 0)) {
        const u = prevDiff / (prevDiff - diff);
        pts.push({ o: prev.o + (q.o - prev.o) * u, y: prev.y + (q.y - prev.y) * u, code });
        return { kind: cut ? 'cut' : 'fill', pts };
      }
      prev = q;
      prevDiff = diff;
    }
    cur = { o: cur.o + sgn * dO, y: cur.y + dY };
    pts.push({ ...cur, code });
    if (Math.abs(cur.o) > 150) break;
  }
  return { kind: cut ? 'cut' : 'fill', pts };
}

/**
 * The cross-section at station s. ground(x, z) → elevation or null. Returns { station, p, r, points: [{ o, y, code }]
 * from the left daylight to the right one, ground: [{ o, y }], cut, fill (m²), left, right ('cut' | 'fill'), edges }.
 */
export function sectionAt(path, s, template, ground, ranges = null) {
  const tpl = normTemplate(template);
  const { p, t } = at(path, s);
  const r = [-t[1], t[0]];
  const G = (o) => (ground ? ground(p[0] + r[0] * o, p[2] + r[1] * o) : null);
  const sup = tpl.superelevation && ranges ? superAt(ranges, s, tpl.superelevation.runoff) : { f: 0, sign: 0 };
  const side = (sgn) => {
    let o = 0;
    let y = p[1];
    const road = [];
    for (const [seg, code] of [...tpl.lanes.map((l) => [l, 'lane']), [tpl.shoulder, 'shoulder']]) {
      let cf = seg.crossfall ?? -2;
      if (sup.f > 0) {
        const target = sgn === sup.sign ? -tpl.superelevation.rate : tpl.superelevation.rate; // the inside of the curve falls
        if (code === 'lane') cf += (target - cf) * sup.f;
        else if (sgn === sup.sign) cf = Math.min(cf, cf + (target - cf) * sup.f);
      }
      o += seg.width;
      y += (seg.width * cf) / 100;
      road.push({ o: sgn * o, y, code });
    }
    const sl = sideSlope(road.at(-1), sgn, G, tpl, sgn < 0 ? tpl.left : tpl.right);
    return { road, slope: sl.pts, kind: sl.kind };
  };
  const L = side(-1);
  const R = side(1);
  const points = [...[...L.slope].reverse(), ...[...L.road].reverse(), { o: 0, y: p[1], code: 'centre' }, ...R.road, ...R.slope];
  const edges = [L.road.at(-1).o, R.road.at(-1).o];
  const groundLine = [];
  for (let o = Math.floor(points[0].o) - 4; o <= points.at(-1).o + 4; o += 0.5) {
    const g = G(o);
    if (g !== null) groundLine.push({ o, y: g });
  }
  const thick = tpl.layers.reduce((a, l) => a + (l.thickness || 0), 0);
  const earth = earthLine(points, edges, thick);
  const areas = sectionAreas(earth, G);
  return { station: s, p, r, t, points, earth, ground: groundLine, cut: areas.cut, fill: areas.fill, left: L.kind, right: R.kind, edges, pavement: (edges[1] - edges[0]) * thick };
}

/** The line earthworks are measured to: the finished surface lowered by the pavement under the road part. */
export function earthLine(points, [eL, eR], thick) {
  if (!thick) return points;
  const out = [];
  for (const q of points) {
    if (q.o < eL - 1e-9 || q.o > eR + 1e-9) out.push(q);
    else {
      if (Math.abs(q.o - eL) < 1e-9) out.push(q);
      out.push({ ...q, y: q.y - thick });
      if (Math.abs(q.o - eR) < 1e-9) out.push(q);
    }
  }
  return out;
}

/** Cut and fill areas (m²) between a design line [{ o, y }] and the ground G(o), within the design line. */
export function sectionAreas(line, G) {
  const os = new Set(line.map((q) => q.o));
  for (let o = Math.ceil(line[0].o * 2) / 2; o < line.at(-1).o; o += 0.5) os.add(o);
  const xs = [...os].sort((a, b) => a - b);
  const d = (o) => {
    const g = G(o);
    return g === null ? null : lineAt(line, o) - g; // + fill, − cut
  };
  let cut = 0;
  let fill = 0;
  for (let i = 1; i < xs.length; i++) {
    const [o1, o2] = [xs[i - 1], xs[i]];
    const [d1, d2] = [d(o1), d(o2)];
    if (d1 === null || d2 === null || o2 - o1 < 1e-9) continue;
    const add = (a, b, w) => {
      const area = ((a + b) / 2) * w;
      if (area > 0) fill += area;
      else cut -= area;
    };
    if (d1 * d2 < 0) {
      const u = d1 / (d1 - d2);
      add(d1, 0, (o2 - o1) * u);
      add(0, d2, (o2 - o1) * (1 - u));
    } else add(d1, d2, o2 - o1);
  }
  return { cut, fill };
}

/** Sections every `interval` m along the path, and at its end. */
export function corridorSections(path, template, ground, interval = 5) {
  const tpl = normTemplate(template);
  const len = path.at(-1)[3];
  const ranges = tpl.superelevation ? curveRanges(path) : null;
  const out = [];
  for (let s = 0; s < len - 1e-6; s += interval) out.push(sectionAt(path, s, tpl, ground, ranges));
  out.push(sectionAt(path, len, tpl, ground, ranges));
  return out;
}

const world = (sec, q) => [sec.p[0] + sec.r[0] * q.o, q.y, sec.p[2] + sec.r[1] * q.o];
const cross2 = (a, b, c) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);

/** Rows of equal length (the side slopes padded with their daylight point) so the sections can be stitched. */
function rows(sections) {
  const split = sections.map((s) => {
    const c = s.points.findIndex((q) => q.code === 'centre');
    const nRoad = s.points.filter((q) => q.code === 'lane' || q.code === 'shoulder').length / 2;
    return { left: s.points.slice(0, c - nRoad), road: s.points.slice(c - nRoad, c + nRoad + 1), right: s.points.slice(c + nRoad + 1) };
  });
  const nl = Math.max(...split.map((x) => x.left.length));
  const nr = Math.max(...split.map((x) => x.right.length));
  return split.map((x) => [...Array(nl - x.left.length).fill(x.left[0] || x.road[0]), ...x.left, ...x.road, ...x.right, ...Array(nr - x.right.length).fill(x.right.at(-1) || x.road.at(-1))]);
}

/** The corridor surface with a colour per face (lanes, shoulders, ditches, benches, cut and fill slopes). */
export function corridorMesh(sections) {
  const rs = rows(sections);
  const w = rs[0].length;
  const v = rs.flatMap((row, i) => row.map((q) => world(sections[i], q)));
  const f = [];
  const fc = [];
  for (let i = 0; i < rs.length - 1; i++)
    for (let k = 0; k < w - 1; k++) {
      const outer = Math.abs(rs[i][k].o) > Math.abs(rs[i][k + 1].o) ? rs[i][k] : rs[i][k + 1];
      const color = CODE_COLOR[outer.code] || CODE_COLOR.lane;
      const a = i * w + k;
      const b = a + w;
      for (const tri of [[a, a + 1, b + 1], [a, b + 1, b]]) {
        const [p, q, r] = tri.map((j) => v[j]);
        if (Math.abs(cross2(p, q, r)) < 1e-12) continue;
        f.push(cross2(p, q, r) < 0 ? [tri[0], tri[2], tri[1]] : tri);
        fc.push(color);
      }
    }
  return { v, f, fc };
}

/** Earthwork table by average end areas, with running totals and the mass haul ordinate (m³). */
export function corridorVolumes(sections, { bulking = 1, shrinkage = 1 } = {}) {
  let cumCut = 0;
  let cumFill = 0;
  const r2 = (x) => Math.round(x * 100) / 100;
  const out = sections.map((s, i) => {
    let cv = 0;
    let fv = 0;
    if (i) {
      const p = sections[i - 1];
      const L = s.station - p.station;
      cv = ((p.cut + s.cut) / 2) * L;
      fv = ((p.fill + s.fill) / 2) * L;
    }
    cumCut += cv;
    cumFill += fv;
    return { station: r2(s.station), cut_area: r2(s.cut), fill_area: r2(s.fill), cut: r2(cv), fill: r2(fv), cum_cut: r2(cumCut), cum_fill: r2(cumFill), mass: r2(cumCut - cumFill / shrinkage) };
  });
  const totals = { cut: r2(cumCut), fill: r2(cumFill), net: r2(cumCut - cumFill), cut_loose: r2(cumCut * bulking), fill_needs_cut: r2(cumFill / shrinkage), balance: r2(cumCut - cumFill / shrinkage) };
  totals.verdict = totals.balance >= 0 ? `${totals.balance} m³ of cut left over (export)` : `${-totals.balance} m³ of fill to bring in (import)`;
  return { rows: out, totals };
}

export const volumesCsv = (rows) => ['station,cut_area_m2,fill_area_m2,cut_m3,fill_m3,cum_cut_m3,cum_fill_m3,mass_haul_m3', ...rows.map((r) => [r.station, r.cut_area, r.fill_area, r.cut, r.fill, r.cum_cut, r.cum_fill, r.mass].join(','))].join('\n');

/** A closed solid between two grids of 3D points (rows along the road, columns across), outward-wound. */
export function gridSolid(top, bottom) {
  const n = top.length;
  const m = top[0].length;
  const v = [...top.flat(), ...bottom.flat()];
  const T = (i, j) => i * m + j;
  const B = (i, j) => n * m + i * m + j;
  const f = [];
  // where top and bottom meet (a cut body beside a fill, say) the faces would lie on each other: leave both out (their
  // volumes cancel, so the total stays exact) and any wall with no height
  const thin = (...ij) => ij.every(([i, j]) => Math.abs(top[i][j][1] - bottom[i][j][1]) < 1e-3);
  const vv = (k) => v[k];
  const quad = (a, b, c, d) => {
    if (new Set([a, b, c, d].map((k) => vv(k).map((x) => x.toFixed(4)).join())).size < 3) return;
    f.push([a, b, c], [a, c, d]);
  };
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < m - 1; j++) {
      if (thin([i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j])) continue;
      quad(T(i, j), T(i, j + 1), T(i + 1, j + 1), T(i + 1, j));
      quad(B(i, j), B(i + 1, j), B(i + 1, j + 1), B(i, j + 1));
    }
  for (let i = 0; i < n - 1; i++) {
    quad(T(i, 0), T(i + 1, 0), B(i + 1, 0), B(i, 0));
    quad(T(i, m - 1), B(i, m - 1), B(i + 1, m - 1), T(i + 1, m - 1));
  }
  for (let j = 0; j < m - 1; j++) {
    quad(T(0, j), B(0, j), B(0, j + 1), T(0, j + 1));
    quad(T(n - 1, j), T(n - 1, j + 1), B(n - 1, j + 1), B(n - 1, j));
  }
  // wind every face outwards: a closed grid solid has one consistent winding, so flip all if the volume is negative
  const mesh = { v, f };
  if (signedVolume(mesh) < 0) mesh.f = f.map(([a, b, c]) => [a, c, b]);
  return mesh;
}

export function signedVolume({ v, f }) {
  let s = 0;
  for (const [a, b, c] of f) {
    const [p, q, r] = [v[a], v[b], v[c]];
    s += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  return s / 6;
}

/**
 * What the road needs, as solids: the cut body and the fill body between the ground and the earthworks line, one
 * solid per pavement layer under the road, and the topsoil strip over the footprint. Returns [{ name, kind, mesh,
 * volume, material }] in world coordinates.
 */
export function corridorSolids(sections, template, ground, { topsoil = 0, across = 48 } = {}) {
  const tpl = normTemplate(template);
  const G = (s, o) => ground?.(s.p[0] + s.r[0] * o, s.p[2] + s.r[1] * o) ?? null;
  const out = [];
  const add = (name, kind, material, top, bottom) => {
    const mesh = gridSolid(top, bottom);
    const volume = Math.abs(signedVolume(mesh));
    if (volume > 1e-3) out.push({ name, kind, material, mesh, volume });
  };
  // earthworks: sampled evenly across each section between its daylight points
  const grid = (fn) =>
    sections.map((s) => {
      const [o0, o1] = [s.earth[0].o, s.earth.at(-1).o];
      return Array.from({ length: across + 1 }, (_, j) => {
        const o = o0 + ((o1 - o0) * j) / across;
        return fn(s, o, lineAt(s.earth, o), G(s, o));
      });
    });
  const P = (s, o, y) => [s.p[0] + s.r[0] * o, y, s.p[2] + s.r[1] * o];
  add('Cut', 'cut', 'Cut earth', grid((s, o, d, g) => P(s, o, Math.max(g ?? d, d))), grid((s, o, d) => P(s, o, d)));
  add('Fill', 'fill', 'Fill earth', grid((s, o, d) => P(s, o, d)), grid((s, o, d, g) => P(s, o, Math.min(g ?? d, d))));
  // pavement layers, top down, under the lanes and shoulders
  let above = 0;
  for (const layer of tpl.layers) {
    const t = layer.thickness || 0;
    const road = (depth) =>
      sections.map((s) => {
        const pts = s.points.filter((q) => q.o >= s.edges[0] - 1e-9 && q.o <= s.edges[1] + 1e-9);
        return Array.from({ length: 17 }, (_, j) => {
          const o = s.edges[0] + ((s.edges[1] - s.edges[0]) * j) / 16;
          return P(s, o, lineAt(pts, o) - depth);
        });
      });
    add(layer.name || 'Layer', 'layer', layer.material || 'Gravel', road(above), road(above + t));
    above += t;
  }
  if (topsoil > 0)
    add('Topsoil strip', 'topsoil', 'Topsoil', grid((s, o, d, g) => P(s, o, g ?? d)), grid((s, o, d, g) => P(s, o, (g ?? d) - topsoil)));
  for (const s of out) s.tonnes = Math.round(s.volume * (DENSITY[s.material] || 1.9) * 10) / 10;
  return out;
}

/** The plan outline of the corridor (left daylight points, then the right ones back). */
export function footprint(sections) {
  const xz = (s, q) => [s.p[0] + s.r[0] * q.o, s.p[2] + s.r[1] * q.o];
  return [...sections.map((s) => xz(s, s.points[0])), ...[...sections].reverse().map((s) => xz(s, s.points.at(-1)))];
}

/**
 * The finished ground: the existing ground's points outside the corridor, the corridor's points inside, triangulated
 * with the corridor's outline and its sections as breaklines. groundMesh is in world coordinates.
 */
export function finishedGround(groundMesh, sections, groundColor = '#8a9a6b') {
  const cm = corridorMesh(sections);
  const fp = footprint(sections);
  const keep = groundMesh.v.filter((q) => !insidePolygon([q[0], q[2]], fp));
  const pts = [...keep];
  const index = new Map();
  const id = (q) => {
    const k = `${Math.round(q[0] * 1000)},${Math.round(q[2] * 1000)}`;
    if (!index.has(k)) index.set(k, pts.push(q) - 1);
    return index.get(k);
  };
  const rs = rows(sections);
  const w = rs[0].length;
  const ids = cm.v.map(id);
  const constraints = [];
  for (let i = 0; i < rs.length; i++) for (let k = 0; k < w - 1; k++) constraints.push([ids[i * w + k], ids[i * w + k + 1]]);
  for (let i = 0; i < rs.length - 1; i++) constraints.push([ids[i * w], ids[(i + 1) * w]], [ids[i * w + w - 1], ids[(i + 1) * w + w - 1]]);
  const { faces } = TR.triangulate(pts, { constraints: constraints.filter(([a, b]) => a !== b) });
  const g = TR.sampler(groundMesh).z;
  // the road keeps its colours inside the outline: each face takes the colour of the nearest corridor face
  const cell = 2;
  const hash = new Map();
  cm.f.forEach((tri, i) => {
    const c = tri.reduce((a, k) => [a[0] + cm.v[k][0] / 3, a[1] + cm.v[k][2] / 3], [0, 0]);
    const key = `${Math.floor(c[0] / cell)},${Math.floor(c[1] / cell)}`;
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push([c, cm.fc[i]]);
  });
  const nearest = ([x, z]) => {
    let best = null;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (const [c, col] of hash.get(`${Math.floor(x / cell) + dx},${Math.floor(z / cell) + dz}`) || []) {
          const d = (c[0] - x) ** 2 + (c[1] - z) ** 2;
          if (!best || d < best[0]) best = [d, col];
        }
    return best?.[1] || groundColor;
  };
  const f = [];
  const fc = [];
  for (const tri of faces) {
    const c = tri.reduce((a, k) => [a[0] + pts[k][0] / 3, a[1] + pts[k][2] / 3], [0, 0]);
    const inside = insidePolygon(c, fp);
    if (!inside && g(c[0], c[1]) === null) continue;
    f.push(tri);
    fc.push(inside ? nearest(c) : groundColor);
  }
  return { v: pts, f, fc };
}

/** The long section: the ground and the design grade every `interval` m, with cut (−) / fill (+) depth. */
export function profileSamples(path, ground, interval = 2) {
  const len = path.at(-1)[3];
  const out = [];
  for (let s = 0; s <= len + 1e-6; s += interval) {
    const { p } = at(path, Math.min(s, len));
    const g = ground ? ground(p[0], p[2]) : null;
    out.push({ station: Math.round(s * 100) / 100, design: Math.round(p[1] * 1000) / 1000, ground: g === null ? null : Math.round(g * 1000) / 1000, depth: g === null ? null : Math.round((p[1] - g) * 1000) / 1000 });
  }
  return out;
}
