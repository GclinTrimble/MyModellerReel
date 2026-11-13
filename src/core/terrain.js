// Terrain (#119, #130, #36, #131, #136): constrained TIN surfaces, surface checks, cut/fill, alignments, corridors and
// quick field designs. Everything works in local model metres (x east, y up, z south); surfaces are meshes whose
// triangles face up. Pure module, Node-tested; Delaunator + Constrainautor do the constrained Delaunay triangulation.
import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';
import { insidePolygon } from './topology.js';

const cross2 = (a, b, c) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
const r3 = (x) => Math.round(x * 1000) / 1000;
const xz = (p) => [p[0], p[2]];

// ---------------------------------------------------------------- triangulation

/**
 * Constrained Delaunay TIN of 3D points (triangulated in plan). constraints: [[i, j], …] edges that must appear
 * (breaklines, boundary edges). outer / holes: plan polygons [[x, z], …] to keep / cut out. maxEdge: drop triangles
 * with a longer side (thin hulls). Returns { faces: [[a, b, c], …] facing up, failed: [constraint indices that crossed] }.
 */
export function triangulate(pts, { constraints = [], outer = [], holes = [], maxEdge = 0 } = {}) {
  if (pts.length < 3) throw new Error('A surface needs at least 3 points.');
  const del = Delaunator.from(pts, (p) => p[0], (p) => p[2]);
  if (!del.triangles.length) throw new Error('The points are all in a line: no surface can be made.');
  const failed = [];
  if (constraints.length) {
    const con = new Constrainautor(del);
    constraints.forEach(([a, b], k) => {
      if (a === b) return;
      try {
        con.constrainOne(a, b);
      } catch {
        failed.push(k); // crosses another constraint
      }
    });
  }
  const faces = [];
  const t = del.triangles;
  for (let i = 0; i < t.length; i += 3) {
    let f = [t[i], t[i + 1], t[i + 2]];
    const [a, b, c] = f.map((k) => pts[k]);
    const s = cross2(a, b, c);
    if (Math.abs(s) < 1e-12) continue;
    if (s < 0) f = [f[0], f[2], f[1]]; // y-component of the normal must point up
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (outer.length && !outer.some((o) => insidePolygon(cen, o))) continue;
    if (holes.some((h) => insidePolygon(cen, h))) continue;
    if (maxEdge > 0 && [[a, b], [b, c], [c, a]].some(([p, q]) => Math.hypot(p[0] - q[0], p[2] - q[2]) > maxEdge)) continue;
    faces.push(f);
  }
  return { faces, failed };
}

/**
 * A closed plan ring [[x, z], …] laid on a TIN (pts, faces): its corners and every point where it crosses a triangle
 * edge, with the surface height there ([x, y, z]), in order. Corners off the surface are left out. Constraining these
 * gives a void / outline a clean edge that follows the ground.
 */
export function drapeRing(ring, pts, faces) {
  const zAt = sampler({ v: pts, f: faces }).z;
  const edges = new Map();
  for (const f of faces) for (let k = 0; k < 3; k++) edges.set(Math.min(f[k], f[(k + 1) % 3]) + ',' + Math.max(f[k], f[(k + 1) % 3]), [f[k], f[(k + 1) % 3]]);
  const E = [...edges.values()];
  const out = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const y = zAt(p[0], p[1]);
    if (y !== null) out.push([p[0], y, p[1]]);
    const r = [q[0] - p[0], q[1] - p[1]];
    const [x0, x1, z0, z1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
    const hits = [];
    for (const [a, b] of E) {
      const [A, B] = [pts[a], pts[b]];
      if (Math.max(A[0], B[0]) < x0 || Math.min(A[0], B[0]) > x1 || Math.max(A[2], B[2]) < z0 || Math.min(A[2], B[2]) > z1) continue;
      const s = [B[0] - A[0], B[2] - A[2]];
      const w = [A[0] - p[0], A[2] - p[1]];
      const d = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(d) < 1e-12) continue;
      const t = (w[0] * s[1] - w[1] * s[0]) / d;
      const u = (w[0] * r[1] - w[1] * r[0]) / d;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) hits.push([t, [A[0] + s[0] * u, A[1] + (B[1] - A[1]) * u, A[2] + s[1] * u]]);
    }
    for (const [, h] of hits.sort((m, n) => m[0] - n[0])) out.push(h);
  });
  return out;
}

/** Flip the edge shared by two triangles (by vertex index), if they form a convex quad. Returns true when flipped. */
export function swapEdge(faces, pts, a, b) {
  const has = (f) => f.includes(a) && f.includes(b);
  const both = faces.map((f, i) => [f, i]).filter(([f]) => has(f));
  if (both.length !== 2) return false;
  const [[f1, i1], [f2, i2]] = both;
  const c = f1.find((x) => x !== a && x !== b);
  const d = f2.find((x) => x !== a && x !== b);
  // convex: c and d on opposite sides of a-b, a and b on opposite sides of c-d
  if (cross2(pts[a], pts[b], pts[c]) * cross2(pts[a], pts[b], pts[d]) >= 0 || cross2(pts[c], pts[d], pts[a]) * cross2(pts[c], pts[d], pts[b]) >= 0) return false;
  const up = (f) => (cross2(...f.map((k) => pts[k])) < 0 ? [f[0], f[2], f[1]] : f);
  faces[i1] = up([c, d, a]);
  faces[i2] = up([d, c, b]);
  return true;
}

// ---------------------------------------------------------------- sampling

/** Fast height lookups on a surface mesh (triangles bucketed on a plan grid). z(x, z) → elevation or null. */
export function sampler(mesh) {
  const tris = [];
  for (const f of mesh.f) for (let k = 1; k < f.length - 1; k++) tris.push([mesh.v[f[0]], mesh.v[f[k]], mesh.v[f[k + 1]]]);
  if (!tris.length) return { z: () => null, tris };
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of mesh.v) (x0 = Math.min(x0, p[0])), (x1 = Math.max(x1, p[0])), (z0 = Math.min(z0, p[2])), (z1 = Math.max(z1, p[2]));
  const n = Math.max(1, Math.round(Math.sqrt(tris.length / 2)));
  const cw = (x1 - x0) / n || 1;
  const ch = (z1 - z0) / n || 1;
  const cell = (x, z) => [Math.min(n - 1, Math.max(0, Math.floor((x - x0) / cw))), Math.min(n - 1, Math.max(0, Math.floor((z - z0) / ch)))];
  const grid = Array.from({ length: n * n }, () => []);
  tris.forEach((t, i) => {
    const [ia, ja] = cell(Math.min(...t.map((p) => p[0])), Math.min(...t.map((p) => p[2])));
    const [ib, jb] = cell(Math.max(...t.map((p) => p[0])), Math.max(...t.map((p) => p[2])));
    for (let a = ia; a <= ib; a++) for (let b = ja; b <= jb; b++) grid[b * n + a].push(i);
  });
  const z = (x, zz) => {
    if (x < x0 - 1e-9 || x > x1 + 1e-9 || zz < z0 - 1e-9 || zz > z1 + 1e-9) return null;
    const [a, b] = cell(x, zz);
    for (const i of grid[b * n + a]) {
      const [p, q, r] = tris[i];
      const d = (q[2] - r[2]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[2] - r[2]);
      if (Math.abs(d) < 1e-15) continue;
      const l1 = ((q[2] - r[2]) * (x - r[0]) + (r[0] - q[0]) * (zz - r[2])) / d;
      const l2 = ((r[2] - p[2]) * (x - r[0]) + (p[0] - r[0]) * (zz - r[2])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * p[1] + l2 * q[1] + l3 * r[1];
    }
    return null;
  };
  return { z, tris, bounds: { x0, x1, z0, z1 } };
}

export function surfaceStats(mesh) {
  let a2 = 0;
  let a3 = 0;
  for (const f of mesh.f) {
    const [a, b, c] = f.map((i) => mesh.v[i]);
    a2 += Math.abs(cross2(a, b, c)) / 2;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    a3 += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  const ys = mesh.v.map((p) => p[1]);
  return { triangles: mesh.f.length, vertices: mesh.v.length, area_2d: r3(a2), area_3d: r3(a3), min_y: r3(Math.min(...ys)), max_y: r3(Math.max(...ys)) };
}

// ---------------------------------------------------------------- surface checks

const angleAt = (a, b, c) => {
  const u = [b[0] - a[0], b[2] - a[2]];
  const v = [c[0] - a[0], c[2] - a[2]];
  return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1)))) * 180) / Math.PI;
};

/**
 * Survey blunders on a surface mesh: spikes and pits (a vertex far from the mean of its neighbours), long thin
 * triangles. vertexIds maps vertices to the point entities they came from (for fixes). Returns issues.
 */
export function checkMesh(mesh, { vertexIds = [], spike = null, minAngle = 2 } = {}) {
  const nb = mesh.v.map(() => new Set());
  for (const f of mesh.f) f.forEach((a, k) => (nb[a].add(f[(k + 1) % 3]), nb[f[(k + 1) % 3]].add(a)));
  const res = mesh.v.map((p, i) => (nb[i].size ? p[1] - [...nb[i]].reduce((s, j) => s + mesh.v[j][1], 0) / nb[i].size : 0));
  const sorted = res.map(Math.abs).sort((a, b) => a - b);
  const mad = sorted[Math.floor(sorted.length / 2)] || 0;
  const limit = spike ?? Math.max(0.5, 6 * mad);
  const issues = [];
  res.forEach((r, i) => {
    if (Math.abs(r) > limit && nb[i].size >= 3)
      issues.push({ kind: r > 0 ? 'spike' : 'pit', severity: 'warning', vertex: i, point: vertexIds[i] ?? null, at: mesh.v[i].map(r3), message: `${r > 0 ? 'Spike' : 'Pit'}: ${r3(Math.abs(r))} m ${r > 0 ? 'above' : 'below'} its neighbours.` });
  });
  let thin = 0;
  for (const f of mesh.f) {
    const [a, b, c] = f.map((i) => mesh.v[i]);
    const m = Math.min(angleAt(a, b, c), angleAt(b, c, a), angleAt(c, a, b));
    if (m < minAngle && thin++ < 50) issues.push({ kind: 'thin_triangle', severity: 'info', at: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3].map(r3), message: `A long thin triangle (smallest angle ${r3(m)}°): often a hull edge to drop with max_edge.` });
  }
  return issues;
}

/** Plan crossings between polylines: [{ a, b, at }] with a/b the indices of the lines. */
export function crossings(lines) {
  const out = [];
  const segs = [];
  lines.forEach((l, li) => l.slice(1).forEach((p, k) => segs.push({ li, p: xz(l[k]), q: xz(p) })));
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < segs.length && out.length < 50; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i];
      const B = segs[j];
      if (A.li === B.li) continue;
      const d1 = o(A.p, A.q, B.p);
      const d2 = o(A.p, A.q, B.q);
      const d3 = o(B.p, B.q, A.p);
      const d4 = o(B.p, B.q, A.q);
      if (d1 * d2 < -1e-12 && d3 * d4 < -1e-12) {
        const t = d3 / (d3 - d4);
        out.push({ a: A.li, b: B.li, at: [A.p[0] + (A.q[0] - A.p[0]) * t, A.p[1] + (A.q[1] - A.p[1]) * t].map(r3) });
      }
    }
  return out;
}

// ---------------------------------------------------------------- earthworks

/**
 * Cut and fill between an existing surface and a design (a surface sampler or a flat elevation), on a plan grid of
 * `cell` metres, inside an optional plan polygon. cut = existing above design (to dig), fill = below.
 */
export function cutFill(existing, design, { within = null, cell = 0 } = {}) {
  const b = existing.bounds;
  if (!b) throw new Error('The existing surface is empty.');
  const area = (b.x1 - b.x0) * (b.z1 - b.z0);
  const c = cell > 0 ? cell : Math.min(10, Math.max(0.1, Math.sqrt(area / 40000)));
  const dz = typeof design === 'number' ? () => design : design.z;
  let cut = 0;
  let fill = 0;
  let a = 0;
  const cells = [];
  for (let x = b.x0 + c / 2; x < b.x1; x += c)
    for (let z = b.z0 + c / 2; z < b.z1; z += c) {
      if (within && !insidePolygon([x, z], within)) continue;
      const e = existing.z(x, z);
      const d = dz(x, z);
      if (e === null || d === null || d === undefined) continue;
      const h = d - e; // + fill, − cut
      if (h > 0) fill += h * c * c;
      else cut -= h * c * c;
      a += c * c;
      cells.push({ x, z, e, d, h });
    }
  return { cut: r3(cut), fill: r3(fill), net: r3(fill - cut), area: r3(a), cell: r3(c), cells };
}

/** Diverging cut/fill colours: reds for cut, blues for fill, white-ish near zero. */
export function cutFillColor(h, scale) {
  const t = Math.max(-1, Math.min(1, h / (scale || 1)));
  const mix = (a, b, u) => a.map((x, k) => Math.round(x + (b[k] - x) * u));
  const rgb = t < 0 ? mix([238, 236, 230], [196, 69, 54], -t) : mix([238, 236, 230], [47, 111, 184], t);
  return `#${rgb.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------------------------------------------------------- alignments

/**
 * A road / channel centreline. pis: plan points of intersection [[x, z], …]; radii: arc radius at each interior PI
 * (0 = a sharp angle); pvis: [[station, elevation], …] with parabolic vertical curves of `curves[k]` m at interior PVIs.
 * Returns { plan: [[x, z, s], …] every `step` m, length, elevation(s) }.
 */
export function alignmentGeometry({ pis, radii = [], pvis = [], curves = [], start = 0, step = 1 }) {
  if (!pis || pis.length < 2) throw new Error('An alignment needs at least 2 points.');
  const plan = []; // [x, z]
  const push = (p) => (!plan.length || Math.hypot(p[0] - plan.at(-1)[0], p[1] - plan.at(-1)[1]) > 1e-9) && plan.push(p);
  push(pis[0]);
  for (let i = 1; i < pis.length - 1; i++) {
    const [a, b, c] = [pis[i - 1], pis[i], pis[i + 1]];
    const r = radii[i] || 0;
    const d1 = [b[0] - a[0], b[1] - a[1]];
    const d2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...d1);
    const l2 = Math.hypot(...d2);
    const u1 = [d1[0] / l1, d1[1] / l1];
    const u2 = [d2[0] / l2, d2[1] / l2];
    const turn = Math.atan2(u1[0] * u2[1] - u1[1] * u2[0], u1[0] * u2[0] + u1[1] * u2[1]);
    if (!r || Math.abs(turn) < 1e-9) {
      push(b);
      continue;
    }
    const T = r * Math.tan(Math.abs(turn) / 2);
    if (T > l1 + 1e-9 || T > l2 + 1e-9) throw new Error(`The arc at point ${i + 1} (radius ${r} m) does not fit between its neighbours.`);
    const tc = [b[0] - u1[0] * T, b[1] - u1[1] * T];
    const sgn = Math.sign(turn);
    const nrm = [-u1[1] * sgn, u1[0] * sgn]; // towards the centre
    const cen = [tc[0] + nrm[0] * r, tc[1] + nrm[1] * r];
    const a0 = Math.atan2(tc[1] - cen[1], tc[0] - cen[0]);
    const nArc = Math.max(4, Math.ceil((r * Math.abs(turn)) / step));
    push(tc);
    for (let k = 1; k <= nArc; k++) {
      const ang = a0 + (turn * k) / nArc;
      push([cen[0] + r * Math.cos(ang), cen[1] + r * Math.sin(ang)]);
    }
  }
  push(pis.at(-1));
  // resample every `step` metres along the plan, keeping stations
  const out = [];
  let s = 0;
  for (let i = 0; i < plan.length; i++) {
    if (i) {
      const [p, q] = [plan[i - 1], plan[i]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 1; k <= n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n, s + (len * k) / n]);
      s += len;
    } else out.push([plan[0][0], plan[0][1], 0]);
  }
  const vs = [...pvis].sort((a, b) => a[0] - b[0]);
  const elevation = (st) => {
    if (!vs.length) return null;
    const x = st + start;
    if (vs.length === 1 || x <= vs[0][0]) return vs[0][1] + (vs.length > 1 ? ((vs[1][1] - vs[0][1]) / (vs[1][0] - vs[0][0])) * (x - vs[0][0]) : 0);
    for (let j = 1; j < vs.length - 1; j++) {
      const L = curves[j] || 0;
      const g1 = (vs[j][1] - vs[j - 1][1]) / (vs[j][0] - vs[j - 1][0]);
      const g2 = (vs[j + 1][1] - vs[j][1]) / (vs[j + 1][0] - vs[j][0]);
      if (L > 0 && x >= vs[j][0] - L / 2 && x <= vs[j][0] + L / 2) {
        const bvc = vs[j][0] - L / 2;
        const zb = vs[j][1] - (g1 * L) / 2;
        const u = x - bvc;
        return zb + g1 * u + ((g2 - g1) / (2 * L)) * u * u;
      }
    }
    for (let j = 1; j < vs.length; j++) if (x <= vs[j][0]) return vs[j - 1][1] + ((vs[j][1] - vs[j - 1][1]) / (vs[j][0] - vs[j - 1][0])) * (x - vs[j - 1][0]);
    const [p, q] = vs.slice(-2);
    return q[1] + ((q[1] - p[1]) / (q[0] - p[0])) * (x - q[0]);
  };
  return { plan: out, length: s, elevation };
}

/** Point and horizontal unit tangent at a station along sampled [x, y, z, s] points. */
function at(path, s) {
  let i = 1;
  while (i < path.length - 1 && path[i][3] < s) i++;
  const [p, q] = [path[i - 1], path[i]];
  const u = (s - p[3]) / (q[3] - p[3] || 1);
  const t = [q[0] - p[0], q[2] - p[2]];
  const L = Math.hypot(...t) || 1;
  return { p: [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u], t: [t[0] / L, t[1] / L] };
}

/** From an edge point, run down (fill) or up (cut) at a batter slope (H:V) until the ground; returns the daylight point. */
function daylight(edge, dir, ground, cutSlope, fillSlope) {
  const g0 = ground ? ground(edge[0], edge[2]) : null;
  if (g0 === null) return [edge[0] + dir[0] * 3, edge[1] - 3 / fillSlope, edge[2] + dir[1] * 3];
  const up = g0 > edge[1];
  const k = up ? 1 / cutSlope : -1 / fillSlope;
  let prev = 0;
  let prevDiff = g0 - edge[1];
  for (let d = 0.25; d <= 60; d += 0.25) {
    const x = edge[0] + dir[0] * d;
    const z = edge[2] + dir[1] * d;
    const g = ground(x, z);
    if (g === null) break;
    const diff = g - (edge[1] + k * d);
    if (Math.sign(diff) !== Math.sign(prevDiff)) {
      const t = prev + ((d - prev) * prevDiff) / (prevDiff - diff);
      return [edge[0] + dir[0] * t, edge[1] + k * t, edge[2] + dir[1] * t];
    }
    prev = d;
    prevDiff = diff;
  }
  return [edge[0] + dir[0] * prev, edge[1] + k * prev, edge[2] + dir[1] * prev];
}

/**
 * A corridor: the template swept along a 3D centreline (sampled [x, y, z, station]) every `interval` m, daylighting to
 * the ground with batter slopes. template: { lanes: [{ width, crossfall }] (crossfall in %, negative falls away),
 * shoulder: { width, crossfall }, cut_slope, fill_slope } (H:V). Returns a mesh.
 */
export function corridorMesh(path, template, ground, interval = 5) {
  const lanes = template.lanes?.length ? template.lanes : [{ width: 3.5, crossfall: -2.5 }];
  const sh = template.shoulder || { width: 1, crossfall: -4 };
  const cut = template.cut_slope || 2;
  const fill = template.fill_slope || 3;
  const len = path.at(-1)[3];
  const stations = [];
  for (let s = 0; s < len; s += interval) stations.push(s);
  stations.push(len);
  const v = [];
  const f = [];
  let width = 0;
  for (const s of stations) {
    const { p, t } = at(path, s);
    const right = [-t[1], t[0]];
    const side = (sign) => {
      const out = [];
      let o = 0;
      let y = p[1];
      for (const seg of [...lanes, sh]) {
        o += seg.width;
        y += (seg.width * (seg.crossfall ?? -2)) / 100;
        out.push([p[0] + right[0] * o * sign, y, p[2] + right[1] * o * sign]);
      }
      out.push(daylight(out.at(-1), [right[0] * sign, right[1] * sign], ground, cut, fill));
      return out;
    };
    const row = [...side(-1).reverse(), p, ...side(1)];
    width = row.length;
    v.push(...row);
  }
  for (let i = 0; i < stations.length - 1; i++)
    for (let k = 0; k < width - 1; k++) {
      const a = i * width + k;
      const b = a + width;
      for (const tri of [[a, a + 1, b + 1], [a, b + 1, b]]) {
        const [p, q, r] = tri.map((j) => v[j]);
        f.push(cross2(p, q, r) < 0 ? [tri[0], tri[2], tri[1]] : tri);
      }
    }
  return { v, f };
}

// ---------------------------------------------------------------- quick field designs

const upFaces = (v, f) => f.map((tri) => (cross2(...tri.map((j) => v[j])) < 0 ? [tri[0], tri[2], tri[1]] : tri));

/** Strips between rows of points (rows of equal length, in order). */
function strips(rows) {
  const w = rows[0].length;
  const v = rows.flat();
  const f = [];
  for (let i = 0; i < rows.length - 1; i++)
    for (let k = 0; k < w - 1; k++) {
      const a = i * w + k;
      const b = a + w;
      f.push([a, a + 1, b + 1], [a, b + 1, b]);
    }
  return { v, f: upFaces(v, f) };
}

/** A line with a cross slope either side: from a to b (3D), widths and slopes (%, negative falls away). */
export function lineSlope(a, b, { left = 5, right = 5, left_slope = -2, right_slope = -2 } = {}) {
  const t = [b[0] - a[0], b[2] - a[2]];
  const L = Math.hypot(...t);
  if (L < 1e-6) throw new Error('The line is too short.');
  const r = [-t[1] / L, t[0] / L];
  const row = (p) => [[p[0] - r[0] * left, p[1] + (left * left_slope) / 100, p[2] - r[1] * left], p, [p[0] + r[0] * right, p[1] + (right * right_slope) / 100, p[2] + r[1] * right]];
  return strips([row(a), row(b)]);
}

/** A plane through three points, or through a point with a slope (%) falling towards a bearing (degrees from north). */
export function planeDesign({ points: p3 = null, point = null, slope = 0, bearing = 0, size = [20, 20], step = 2 }) {
  let c;
  let gx;
  let gz;
  if (p3) {
    const [a, b, d] = p3;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (Math.abs(n[1]) < 1e-9) throw new Error('Those three points do not make a plane you can stand on (they are in a line or vertical).');
    gx = -n[0] / n[1];
    gz = -n[2] / n[1];
    c = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3];
  } else {
    if (!point) throw new Error('Give three points, or a point with a slope and a bearing.');
    const br = (bearing * Math.PI) / 180; // north is −z, east is +x
    const dir = [Math.sin(br), -Math.cos(br)];
    gx = (-slope / 100) * dir[0];
    gz = (-slope / 100) * dir[1];
    c = point;
  }
  const rows = [];
  const nx = Math.max(1, Math.round(size[0] / step));
  const nz = Math.max(1, Math.round(size[1] / step));
  for (let j = 0; j <= nz; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const x = c[0] - size[0] / 2 + (size[0] * i) / nx;
      const z = c[2] - size[1] / 2 + (size[1] * j) / nz;
      row.push([x, c[1] + gx * (x - c[0]) + gz * (z - c[2]), z]);
    }
    rows.push(row);
  }
  return strips(rows);
}

/**
 * A trench from a to b: bottom width, invert at each end (or depth below the ground), side slopes (H:V) up to the
 * ground (or to `depth` above the invert when there is no ground).
 */
export function trench(a, b, { bottom = 1, depth = 1, invert_a = null, invert_b = null, side_slope = 1, ground = null, step = 1 } = {}) {
  const t = [b[0] - a[0], b[2] - a[2]];
  const L = Math.hypot(...t);
  if (L < 1e-6) throw new Error('The trench is too short.');
  const r = [-t[1] / L, t[0] / L];
  const g = (p) => (ground ? ground(p[0], p[2]) : null) ?? p[1];
  const ia = invert_a ?? g(a) - depth;
  const ib = invert_b ?? g(b) - depth;
  const n = Math.max(1, Math.ceil(L / step));
  const rows = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const c = [a[0] + t[0] * u, 0, a[2] + t[1] * u];
    const inv = ia + (ib - ia) * u;
    const bl = [c[0] - r[0] * (bottom / 2), inv, c[2] - r[1] * (bottom / 2)];
    const brr = [c[0] + r[0] * (bottom / 2), inv, c[2] + r[1] * (bottom / 2)];
    const top = (edge, sign) => {
      if (!ground) return [edge[0] + r[0] * sign * depth * side_slope, inv + depth, edge[2] + r[1] * sign * depth * side_slope];
      return daylight(edge, [r[0] * sign, r[1] * sign], ground, side_slope, side_slope);
    };
    rows.push([top(bl, -1), bl, brr, top(brr, 1)]);
  }
  const m = strips(rows);
  return { ...m, volume: null, inverts: [r3(ia), r3(ib)] };
}

/** A road: a centreline (3D points), width, crossfall (%) falling both ways from the crown. */
export function roadDesign(centre, { width = 7, crossfall = -2.5, step = 2 } = {}) {
  if (centre.length < 2) throw new Error('A road needs at least 2 centreline points.');
  const path = [];
  let s = 0;
  centre.forEach((p, i) => {
    if (i) s += Math.hypot(p[0] - centre[i - 1][0], p[2] - centre[i - 1][2]);
    path.push([p[0], p[1], p[2], s]);
  });
  const rows = [];
  for (let st = 0; st <= s + 1e-9; st += step) {
    const { p, t } = at(path, Math.min(st, s));
    const r = [-t[1], t[0]];
    const h = width / 2;
    const y = p[1] + (h * crossfall) / 100;
    rows.push([[p[0] - r[0] * h, y, p[2] - r[1] * h], p, [p[0] + r[0] * h, y, p[2] + r[1] * h]]);
    if (st < s && st + step > s) st = s - step; // always end exactly on the last point
  }
  return strips(rows);
}
