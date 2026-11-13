// Surface materials and their takeoff: a material library with properties (code, colour, density, thickness, unit
// cost), painted face by face on any mesh (e.fm: a material name per face, kept on the entity so a live surface keeps
// its paint when it rebuilds; mesh.fc the colours drawn from it),
// shown or hidden by material, and measured: 3D area, plan area, volume (area × thickness), weight and cost.
// Pure module, Node-tested. Open formats: the library reads and writes JSON and CSV, painted faces go out as GeoJSON
// (Polygon Z, the OGC API Features encoding) with the material's properties.
import * as G from './geometry.js';
import * as D from './document.js';
import * as S from './survey.js';

/** Starter library. code: a classification code (MasterFormat here; Uniclass / OmniClass / a TBC material code work too). */
export const STARTER = [
  { name: 'Topsoil', code: '31 14 13', color: '#6b4f32', density: 1600, thickness: 0.15, cost: 12 },
  { name: 'Turf', code: '32 92 23', color: '#6f9a4a', density: 1200, thickness: 0.03, cost: 8 },
  { name: 'Crushed rock base', code: '32 11 23', color: '#9b8f7e', density: 2100, thickness: 0.2, cost: 18 },
  { name: 'Gravel', code: '32 11 16', color: '#c2b49a', density: 1800, thickness: 0.1, cost: 15 },
  { name: 'Asphalt', code: '32 12 16', color: '#3c3f44', density: 2350, thickness: 0.05, cost: 35 },
  { name: 'Concrete', code: '03 30 00', color: '#a7a39a', density: 2400, thickness: 0.15, cost: 90 },
  { name: 'Pavers', code: '32 14 13', color: '#b06a4a', density: 2200, thickness: 0.08, cost: 60 },
  { name: 'Mulch', code: '32 91 13', color: '#5e3f2b', density: 400, thickness: 0.075, cost: 6 },
];
export const FIELDS = ['name', 'code', 'color', 'density', 'thickness', 'cost', 'description'];
const NUMS = ['density', 'thickness', 'cost'];
const r3 = (x) => Math.round(x * 1000) / 1000;

/** The document's library (the starter one until it is edited). */
export const library = (doc) => (doc.surfaceMaterials ||= structuredClone(STARTER));
export const find = (doc, name) => library(doc).find((m) => m.name.toLowerCase() === String(name).toLowerCase());
export function get(doc, name) {
  const m = find(doc, name);
  if (!m) throw new Error(`No surface material "${name}". Known: ${library(doc).map((x) => x.name).join(', ')}. define_surface_material adds one.`);
  return m;
}

/** Add or update a material (only the fields given change). rename: a new name, carried onto painted faces. */
export function define(doc, m) {
  if (!m.name) throw new Error('A material needs a name.');
  if (m.color !== undefined && !/^#[0-9a-f]{6}$/i.test(m.color)) throw new Error(`Colour "${m.color}" is not a #rrggbb hex colour.`);
  for (const k of NUMS) if (m[k] !== undefined && !(Number.isFinite(+m[k]) && +m[k] >= 0)) throw new Error(`${k} must be a number ≥ 0.`);
  let cur = find(doc, m.name);
  if (!cur) library(doc).push((cur = { name: m.name, code: '', color: '#888888', density: 0, thickness: 0, cost: 0 }));
  for (const k of FIELDS) if (k !== 'name' && m[k] !== undefined) cur[k] = NUMS.includes(k) ? +m[k] : m[k];
  if (m.visible !== undefined) m.visible ? delete cur.hidden : (cur.hidden = true);
  if (m.rename && m.rename !== cur.name) {
    if (find(doc, m.rename)) throw new Error(`"${m.rename}" already exists.`);
    for (const e of doc.entities) if (e.fm) e.fm = e.fm.map((x) => (x === cur.name ? m.rename : x));
    cur.name = m.rename;
  }
  return cur;
}

/** Remove a material; faces painted with it are cleared. */
export function remove(doc, name) {
  const m = get(doc, name);
  doc.surfaceMaterials = library(doc).filter((x) => x !== m);
  for (const e of doc.entities) if (e.fm?.includes(m.name)) e.fm = e.fm.map((x) => (x === m.name ? null : x));
}

/** Paint an entity's `faces` with `name` (null clears); syncPaint then colours them. */
export function paint(e, faces, name) {
  const fm = Array.from({ length: e.mesh.f.length }, (_, i) => e.fm?.[i] ?? null);
  for (const fi of faces) if (fi >= 0 && fi < fm.length) fm[fi] = name;
  e.fm = fm;
}

/**
 * After every change: face colours from the painted materials (hidden materials: 'none', which the renderer skips).
 * Unpainted faces of a painted mesh show white (the entity's colour is replaced by vertex colours).
 */
export function syncPaint(doc) {
  const lib = new Map(library(doc).map((m) => [m.name, m]));
  for (const e of doc.entities) {
    const m = e.mesh;
    if (!e.fm || !m) continue;
    // shortcut: an edit that changes the face count (push/pull, booleans) pads or trims the paint, so paint can land on
    // the wrong faces after a topology edit; upgrade to carrying fm through each geometry operation when that matters
    const fm = Array.from({ length: m.f.length }, (_, i) => (lib.has(e.fm[i]) ? e.fm[i] : null));
    if (fm.every((x) => x === null)) {
      delete e.fm;
      if (m.fc) e.mesh = { v: m.v, f: m.f };
      continue;
    }
    if (fm.join() !== e.fm.join()) e.fm = fm;
    const base = e.material?.color || '#cccccc';
    const fc = fm.map((x) => (x === null ? base : lib.get(x).hidden ? 'none' : lib.get(x).color));
    if (m.fc?.join() !== fc.join()) e.mesh = { ...m, fc }; // a new object: the viewport rebuilds its geometry
  }
}

// ---------------------------------------------------------------- picking faces

/** Faces with their centre within `radius` of `point` (the brush). mesh in the same space as point. */
export function facesNear(mesh, point, radius) {
  const out = [];
  for (let fi = 0; fi < mesh.f.length; fi++) {
    const c = G.faceCenter(mesh, fi);
    if (G.len(G.sub(c, point)) <= radius || mesh.f[fi].some((i) => G.len(G.sub(mesh.v[i], point)) <= radius * 0.5)) out.push(fi);
  }
  return out;
}

const inPoly = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
/** Faces whose centre is inside a plan polygon [[x, z], …]. */
export const facesInside = (mesh, poly) => mesh.f.map((_, fi) => fi).filter((fi) => {
  const c = G.faceCenter(mesh, fi);
  return inPoly(c[0], c[2], poly);
});

const segDist2 = (p, a, b) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const onLines = (p, lines, tol) => lines.some((l) => l.some((a, i) => i > 0 && segDist2(p, l[i - 1], a) <= tol));

/**
 * Flood fill from a seed face: neighbours across shared edges join while the bend is under `angle` degrees, the edge
 * is not on a breakline (plan polylines [[x, z], …], e.g. kerbs) and, with sameMaterial, the paint matches.
 */
export function region(mesh, seed, { angle = 30, lines = [], tol = 0.05, sameMaterial = true, fm = null } = {}) {
  const key = (i) => mesh.v[i].map((x) => Math.round(x * 1e4)).join(',');
  const edges = new Map();
  mesh.f.forEach((f, fi) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length];
    const ek = [key(a), key(b)].sort().join('|');
    (edges.get(ek) || edges.set(ek, { faces: [], a, b }).get(ek)).faces.push(fi);
  }));
  const nb = mesh.f.map(() => []);
  const cos = Math.cos((angle * Math.PI) / 180);
  for (const { faces, a, b } of edges.values()) {
    if (faces.length !== 2) continue;
    const pa = [mesh.v[a][0], mesh.v[a][2]];
    const pb = [mesh.v[b][0], mesh.v[b][2]];
    if (lines.length && onLines(pa, lines, tol) && onLines(pb, lines, tol) && onLines([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], lines, tol)) continue;
    const [f1, f2] = faces;
    if (G.dot(G.faceNormal(mesh, f1), G.faceNormal(mesh, f2)) < cos) continue;
    nb[f1].push(f2), nb[f2].push(f1);
  }
  const mat = fm?.[seed] ?? null;
  const seen = new Set([seed]);
  const stack = [seed];
  while (stack.length) for (const n of nb[stack.pop()]) if (!seen.has(n) && (!sameMaterial || (fm?.[n] ?? null) === mat)) seen.add(n), stack.push(n);
  return [...seen].sort((x, y) => x - y);
}

// ---------------------------------------------------------------- takeoff

const planArea = (w, fi) => {
  const p = G.facePoints(w, fi);
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i][0] * p[(i + 1) % p.length][2] - p[(i + 1) % p.length][0] * p[i][2];
  return Math.abs(s) / 2;
};

/** Rows per material: faces, area m² (3D), plan area m², volume m³ (area × thickness), weight t, cost. */
export function takeoff(doc, { ids = null } = {}) {
  const ents = ids ? D.resolve(doc, ids) : doc.entities;
  const lib = new Map(library(doc).map((m) => [m.name, m]));
  const rows = new Map();
  for (const e of ents) {
    if (!e.fm || !e.mesh) continue;
    const w = D.worldMesh(doc, e);
    e.fm.forEach((name, fi) => {
      const m = name && lib.get(name);
      if (!m) return;
      const r = rows.get(name) || rows.set(name, { material: name, code: m.code || '', faces: 0, area: 0, plan_area: 0, thickness: m.thickness || 0, density: m.density || 0, unit_cost: m.cost || 0, ids: new Set() }).get(name);
      r.faces++;
      r.area += G.faceArea(w, fi);
      r.plan_area += planArea(w, fi);
      r.ids.add(e.id);
    });
  }
  const out = [...rows.values()].map((r) => {
    const volume = r.area * r.thickness;
    return { ...r, ids: [...r.ids], area: r3(r.area), plan_area: r3(r.plan_area), volume: r3(volume), weight_t: r3((volume * r.density) / 1000), cost: r3(r.area * r.unit_cost) };
  }).sort((a, b) => b.area - a.area);
  const sum = (k) => r3(out.reduce((s, r) => s + r[k], 0));
  return { rows: out, totals: { area: sum('area'), plan_area: sum('plan_area'), volume: sum('volume'), weight_t: sum('weight_t'), cost: sum('cost') } };
}

const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
export function takeoffCsv(rep) {
  const cols = ['material', 'code', 'faces', 'area', 'plan_area', 'thickness', 'volume', 'density', 'weight_t', 'unit_cost', 'cost'];
  const t = rep.totals;
  return [['material', 'code', 'faces', 'area_m2', 'plan_area_m2', 'thickness_m', 'volume_m3', 'density_kg_m3', 'weight_t', 'unit_cost_per_m2', 'cost'].join(','), ...rep.rows.map((r) => cols.map((c) => q(r[c])).join(',')), ['Total', '', '', t.area, t.plan_area, '', t.volume, '', t.weight_t, '', t.cost].join(',')].join('\n') + '\n';
}

// ---------------------------------------------------------------- library files

export const libraryCsv = (doc) => [FIELDS.join(','), ...library(doc).map((m) => FIELDS.map((k) => q(m[k])).join(','))].join('\n') + '\n';

/** Read a library: our JSON ({ materials: [...] } or a bare array) or CSV with a header naming FIELDS. */
export function parseLibrary(text) {
  const t = String(text).trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t);
    return (Array.isArray(j) ? j : j.materials || []).filter((m) => m?.name);
  }
  const rows = t.split(/\r?\n/).map((l) => [...l.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1));
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  if (!head.includes('name')) throw new Error('The CSV needs a "name" column (and any of code, color, density, thickness, cost, description).');
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]).filter(([h, v]) => FIELDS.includes(h) && v !== undefined && v !== '')));
}

/** Painted faces as a GeoJSON FeatureCollection (Polygon Z, one feature per face) in project E, N, elevation and the model's CRS. */
export function toGeoJson(doc, { ids = null } = {}) {
  const epsg = S.geo(doc).crs?.epsg;
  const ents = ids ? D.resolve(doc, ids) : doc.entities;
  const lib = new Map(library(doc).map((m) => [m.name, m]));
  const features = [];
  for (const e of ents) {
    if (!e.fm || !e.mesh) continue;
    const w = D.worldMesh(doc, e);
    e.fm.forEach((name, fi) => {
      const m = name && lib.get(name);
      if (!m) return;
      const ring = G.facePoints(w, fi).map((p) => {
        const c = S.toProject(doc, p);
        return [r3(c.e), r3(c.n), r3(c.z)];
      });
      ring.push(ring[0]);
      features.push({ type: 'Feature', properties: { material: name, code: m.code || '', entity: e.name, face: fi, area_m2: r3(G.faceArea(w, fi)), thickness_m: m.thickness || 0, density_kg_m3: m.density || 0 }, geometry: { type: 'Polygon', coordinates: [ring] } });
    });
  }
  return { type: 'FeatureCollection', ...(epsg ? { crs: { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${epsg}` } } } : {}), features };
}
