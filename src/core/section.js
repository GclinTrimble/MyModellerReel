// Section cuts (#54): meshes sliced by a plane into closed loops, nested into filled areas with holes. Used for the
// section caps in the view and for export_section (SVG with fills, DXF polylines).
import * as D from './document.js';
import * as G from './geometry.js';

const area2 = (r) => r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2;
export const insideRing = ([x, y], r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
};

/** 2D rings → [{ outer (counter-clockwise), holes (clockwise) }]: a ring inside an even number of others is an outer. */
export function nestRings(R) {
  const A = R.map((r) => Math.abs(area2(r)));
  const depth = R.map((r, i) => R.filter((o, j) => j !== i && A[j] > A[i] && insideRing(r[0], o)).length);
  const out = [];
  R.forEach((r, i) => {
    if (depth[i] % 2) return;
    const holes = R.filter((h, j) => depth[j] === depth[i] + 1 && A[j] < A[i] && insideRing(h[0], r)).map((h) => (area2(h) > 0 ? [...h].reverse() : h));
    out.push({ outer: area2(r) < 0 ? [...r].reverse() : r, holes });
  });
  return out;
}

/** A plane's 2D frame: u to the right, v up, as seen from the side the normal points to. */
export function planeFrame(normal) {
  const n = G.norm(normal);
  const up = Math.abs(n[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0]; // plan views have north up
  const u = G.norm(G.cross(up, n));
  const v = G.cross(n, u);
  return { n, u, v };
}

/** Segments where a triangle mesh crosses a plane, joined into closed loops (world points). */
export function sliceMesh(mesh, point, normal) {
  const n = G.norm(normal);
  const d = (p) => G.dot(G.sub(p, point), n);
  const segs = [];
  for (const t of G.triangles(mesh)) {
    const s = t.map(d);
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if ((s[i] > 0) !== (s[j] > 0) && Math.abs(s[i] - s[j]) > 1e-12) pts.push(G.add(t[i], G.scl(G.sub(t[j], t[i]), s[i] / (s[i] - s[j]))));
    }
    if (pts.length === 2) segs.push(pts);
  }
  // chain the segments by their (rounded) end points
  const key = (p) => p.map((x) => Math.round(x * 1e5)).join(',');
  const by = new Map();
  segs.forEach((s, i) => s.forEach((p, k) => (by.get(key(p)) || by.set(key(p), []).get(key(p))).push([i, k])));
  const used = new Set();
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const loop = [segs[i][0], segs[i][1]];
    let end = segs[i][1];
    for (let guard = 0; guard < segs.length; guard++) {
      const next = (by.get(key(end)) || []).find(([j]) => !used.has(j));
      if (!next) break;
      used.add(next[0]);
      end = segs[next[0]][1 - next[1]];
      if (key(end) === key(loop[0])) break;
      loop.push(end);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

/** The cut of every visible mesh: [{ id, name, color, tag, loops: [[world]], areas: [{ outer, holes }] (2D) }]. */
export function sectionCut(doc, { point, normal }, { ids = null } = {}) {
  const off = new Set(doc.tags.filter((t) => !t.visible).map((t) => t.name));
  const vis = (e) => {
    for (let x = e; x; x = x.parent && D.getEntity(doc, x.parent)) if (!x.visible || off.has(x.tag)) return false;
    return true;
  };
  const f = planeFrame(normal);
  const to2 = (p) => [G.dot(G.sub(p, point), f.u), G.dot(G.sub(p, point), f.v)];
  const out = [];
  for (const e of doc.entities) {
    if (!e.mesh?.f.length || (ids && !ids.includes(e.id)) || !vis(e) || e.mesh.f.length > 200000) continue;
    const b = D.worldBox(doc, e);
    const c = [0, 1, 2].map((k) => [b.min[k], b.max[k]]);
    const ds = c[0].flatMap((x) => c[1].flatMap((y) => c[2].map((z) => G.dot(G.sub([x, y, z], point), f.n))));
    if (Math.min(...ds) > 0 || Math.max(...ds) < 0) continue;
    const loops = sliceMesh(D.worldMesh(doc, e), point, normal);
    if (!loops.length) continue;
    out.push({ id: e.id, name: e.name, tag: e.tag, color: e.material.color, loops, areas: nestRings(loops.map((l) => l.map(to2))) });
  }
  return { frame: f, point, cuts: out };
}

const shade = (hex, k) => {
  const n = parseInt(String(hex || '#999999').slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x * k));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};
export { shade };

/** The cut as an SVG drawing (metres → mm at a scale, 1:50 by default), each solid filled in a darker tone of its colour. */
export function sectionSvg(cut, { scale = 50, title = '' } = {}) {
  const k = 1000 / scale; // mm on paper per metre
  const all = cut.cuts.flatMap((c) => c.areas.flatMap((a) => [a.outer, ...a.holes]).flat());
  if (!all.length) throw new Error('The section plane cuts nothing.');
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const m = 10;
  const W = (maxX - minX) * k + 2 * m;
  const H = (maxY - minY) * k + 2 * m + (title ? 8 : 0);
  const X = (x) => ((x - minX) * k + m).toFixed(2);
  const Y = (y) => ((maxY - y) * k + m).toFixed(2);
  const ring = (r) => `M${r.map((p) => `${X(p[0])},${Y(p[1])}`).join('L')}Z`;
  const paths = cut.cuts.map((c) => `<path d="${c.areas.map((a) => [a.outer, ...a.holes].map(ring).join('')).join('')}" fill="${shade(c.color, 0.6)}" fill-rule="evenodd" stroke="#111" stroke-width="0.35"><title>${esc(c.name)}</title></path>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}mm" height="${H.toFixed(1)}mm" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">\n<rect width="100%" height="100%" fill="#fff"/>\n${paths.join('\n')}\n${title ? `<text x="${m}" y="${(H - 4).toFixed(2)}" font-family="Arial, sans-serif" font-size="4">${esc(title)} · 1:${scale}</text>` : ''}\n</svg>\n`;
}
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
