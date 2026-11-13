// LandXML 1.2 (#126): survey points, TIN surfaces, alignments with their vertical profile, and plan features, both
// ways. Coordinates in LandXML are "N E Z"; the model works in local metres around the base point (survey.js).
import * as X from './xml.js';
import * as D from './document.js';
import * as G from './geometry.js';
import * as S from './survey.js';
import * as L from './layers.js';
import { registerFormat } from './formats.js';
import * as FB from './fieldbook.js';

const UNIT = { meter: 1, millimeter: 0.001, centimeter: 0.01, kilometer: 1000, foot: 0.3048, USSurveyFoot: 1200 / 3937, inch: 0.0254 };

export function addCurve(doc, pts, { closed = false, ...props }) {
  const { mesh, origin } = G.recenter({ v: pts.map(D.round3), f: [] });
  return D.addEntity(doc, { type: 'curve', curve: { kind: 'polyline', points: mesh.v, closed: !!closed }, position: D.round3(origin), ...props });
}

/** Arc from start to end around a centre (plan, [n, e]), sampled every ~2°, rotation cw or ccw. */
function arc([sn, se], [cn, ce], [en, ee], rot) {
  const a0 = Math.atan2(sn - cn, se - ce);
  let a1 = Math.atan2(en - cn, ee - ce);
  const r = Math.hypot(sn - cn, se - ce);
  let sw = a1 - a0;
  if (rot === 'cw' && sw > 0) sw -= 2 * Math.PI;
  if (rot !== 'cw' && sw < 0) sw += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 90)));
  return Array.from({ length: n + 1 }, (_, i) => [cn + r * Math.sin(a0 + (sw * i) / n), ce + r * Math.cos(a0 + (sw * i) / n)]);
}

/** CoordGeom (Line, Curve, Spiral) to a list of [n, e, z?] points. */
function coordGeom(cg, k, report) {
  const out = [];
  const push = (p) => {
    const last = out.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) out.push(p);
  };
  for (const g of cg.children) {
    const nm = g.name.replace(/^.*:/, '');
    const pt = (n) => {
      const c = X.kid(g, n);
      return c ? X.nums(c.text).map((v) => v * k) : null;
    };
    const [s, e] = [pt('Start'), pt('End')];
    if (!s || !e) continue;
    if (nm === 'Curve') {
      const c = pt('Center');
      const pts = c ? arc(s, c, e, g.attrs.rot) : [s, e];
      const zs = [s[2], e[2]];
      pts.forEach((p, i) => push(zs[0] !== undefined && zs[1] !== undefined ? [...p, zs[0] + ((zs[1] - zs[0]) * i) / (pts.length - 1)] : p));
    } else {
      if (nm === 'Spiral' || nm === 'IrregularLine') report.warn(`${nm} read as a straight line (spirals are not modelled yet).`);
      push(s);
      push(e);
    }
  }
  return out;
}

export function readLandXml(text, { doc, cmd, report, opts = {} }) {
  const root = X.parse(text);
  const lx = X.kid(root, 'LandXML');
  if (!lx) throw new Error('Not a LandXML file (no <LandXML> element).');
  const units = X.kid(lx, 'Units');
  const unitEl = units?.children[0];
  const fileUnit = unitEl?.attrs.linearUnit || 'meter';
  if (!UNIT[fileUnit]) report.warn(`Unknown linear unit "${fileUnit}": read as metres.`);
  const g = S.geo(doc);
  const k = (UNIT[fileUnit] || 1) / S.UNITS[g.units || 'm'];
  const cs = X.kid(lx, 'CoordinateSystem');
  const crs = cs?.attrs.epsgCode ? `EPSG:${cs.attrs.epsgCode}` : cs?.attrs.name;
  if (crs && !g.crs) g.crs = { epsg: cs.attrs.epsgCode ? +cs.attrs.epsgCode : null, name: cs.attrs.name || cs.attrs.desc || '' };
  else if (crs && g.crs && S.crsLabel(g.crs) !== crs && g.crs.name !== crs) report.warn(`The file is in ${crs}, the project in ${S.crsLabel(g.crs)}: coordinates are used as they are (no reprojection).`);
  const world = (n, e, z = 0) => S.toLocal(doc, { n, e, z });
  const layer = (name) => (report.layer(name), L.ensureLayer(doc, name).name);
  const names = new Set(S.points(doc).map((p) => p.name));

  // points
  for (const p of X.all(lx, 'CgPoint')) {
    const v = X.nums(p.text);
    if (v.length < 2) {
      report.skip('CgPoint', p.attrs.pntRef ? 'a reference to another point' : 'no coordinates');
      continue;
    }
    let name = p.attrs.name || p.attrs.oID || S.nextPointName(doc);
    while (names.has(name)) name = `${name}-1`;
    names.add(name);
    // attributes: <Feature><Property label value/></Feature> inside the point
    const attrs = {};
    for (const f of X.kids(p, 'Feature')) for (const a of X.kids(f, 'Property')) if (a.attrs.label) attrs[a.attrs.label] = a.attrs.value !== '' && Number.isFinite(+a.attrs.value) ? +a.attrs.value : a.attrs.value ?? '';
    const pt = S.addPoint(doc, { name, n: v[0] * k, e: v[1] * k, z: (v[2] ?? 0) * k, code: p.attrs.code || '', desc: p.attrs.desc || '', attrs });
    if (opts.layer) pt.tag = layer(opts.layer);
    report.add('points');
  }
  // TIN surfaces
  for (const s of X.all(lx, 'Surface')) {
    const def = X.kid(s, 'Definition');
    if (!def) {
      report.skip('Surface', 'no TIN definition');
      continue;
    }
    if (def.attrs.surfType && def.attrs.surfType !== 'TIN') {
      report.skip('Surface', `${def.attrs.surfType} surfaces are not read (only TIN)`);
      continue;
    }
    const idx = new Map();
    const v = [];
    for (const p of X.all(X.kid(def, 'Pnts') || { children: [] }, 'P')) {
      const [n, e, z] = X.nums(p.text);
      idx.set(p.attrs.id, v.push(world(n * k, e * k, (z ?? 0) * k)) - 1);
    }
    const f = [];
    for (const F of X.all(X.kid(def, 'Faces') || { children: [] }, 'F')) {
      if (F.attrs.i === '1') continue; // invisible faces (holes, outside the boundary)
      const tri = X.nums(F.text).map((id) => idx.get(String(id)));
      if (tri.length === 3 && tri.every((x) => x !== undefined)) f.push(faceUp(v, tri));
    }
    if (!f.length) {
      report.skip('Surface', `"${s.attrs.name}" has no faces`);
      continue;
    }
    const { mesh, origin } = G.recenter({ v, f });
    D.addEntity(doc, { name: D.uniqueName(doc, s.attrs.name || 'Surface'), mesh, position: D.round3(origin), tag: layer(opts.layer || 'LandXML surfaces'), material: { color: '#8fae7a', roughness: 0.95 }, meta: { source: 'LandXML', surface: true, ...(s.attrs.desc ? { desc: s.attrs.desc } : {}) } });
    report.add('surfaces');
    report.add('triangles', f.length);
    for (const b of X.all(s, 'Breakline')) {
      const pl = X.kid(b, 'PntList3D') || X.kid(b, 'PntList2D');
      const q = pl ? X.nums(pl.text) : [];
      const dim = X.kid(b, 'PntList3D') ? 3 : 2;
      const pts = [];
      for (let i = 0; i + dim - 1 < q.length; i += dim) pts.push(world(q[i] * k, q[i + 1] * k, dim === 3 ? q[i + 2] * k : 0));
      if (pts.length < 2) continue;
      addCurve(doc, pts, { name: D.uniqueName(doc, b.attrs.name || `${s.attrs.name || 'Surface'} breakline`), tag: layer('LandXML breaklines'), material: { color: '#c8553d' } });
      report.add('breaklines');
    }
  }
  // alignments (horizontal geometry + the first profile's PVIs)
  for (const a of X.all(lx, 'Alignment')) {
    const cg = X.kid(a, 'CoordGeom');
    const pts = cg ? coordGeom(cg, k, report) : [];
    if (pts.length < 2) {
      report.skip('Alignment', `"${a.attrs.name}" has no plan geometry`);
      continue;
    }
    const pvis = [];
    const pa = X.all(a, 'ProfAlign')[0];
    for (const c of pa?.children || []) {
      const v = X.nums(c.text);
      if (v.length < 2) continue;
      const len = c.attrs.length ? +c.attrs.length * k : undefined;
      pvis.push(len ? [v[0] * k, v[1] * k, len] : [v[0] * k, v[1] * k]);
    }
    const startZ = pvis.length ? pvis[0][1] : 0;
    const res = cmd('create_curve', { points: pts.map((p) => world(p[0], p[1], startZ)).map(D.round3), kind: 'polyline', name: D.uniqueName(doc, a.attrs.name || 'Alignment'), color: '#d2453c' });
    const e = D.getEntity(doc, res.id);
    e.alignment = { points: e.curve.points.map((p) => D.round3(G.add(p, e.position))), length: +a.attrs.length * k || undefined, start_station: +a.attrs.staStart * k || 0, interval: 20, ...(pvis.length ? { pvis } : {}) };
    e.tag = layer(opts.layer || 'LandXML alignments');
    if (pvis.length) cmd('set_alignment', { id: e.id, pvis }); // the vertical profile gives the curve its heights
    report.add('alignments');
  }
  // plan features
  for (const pf of X.all(lx, 'PlanFeature')) {
    const cg = X.kid(pf, 'CoordGeom');
    const pts = cg ? coordGeom(cg, k, report) : [];
    if (pts.length < 2) continue;
    addCurve(doc, pts.map((p) => world(p[0], p[1], p[2] ?? 0)), { name: D.uniqueName(doc, pf.attrs.name || 'Feature'), tag: layer(opts.layer || 'LandXML features'), material: { color: '#2f6f86' } });
    report.add('features');
  }
  // survey field books (#263): setups and raw observations, linked to the points just read
  const surveys = X.kids(lx, 'Survey');
  if (surveys.length) {
    const results = new Map();
    for (const p of X.all(lx, 'CgPoint')) {
      const c = X.nums(p.text || '');
      if (c.length >= 2) results.set(p.attrs.name, { n: c[0] * k, e: c[1] * k, z: (c[2] ?? 0) * k, code: p.attrs.code || '' });
    }
    for (const sv of surveys) {
      const book = FB.fromLandXmlSurvey(sv, results);
      if (!book.observations.length) continue;
      book.points = Object.fromEntries(S.points(doc).filter((p) => book.results[p.name]).map((p) => [p.name, p.id]));
      const e = D.addEntity(doc, { type: 'survey', name: D.uniqueName(doc, book.job.name), survey: book, material: { color: '#c9a227' } });
      for (const id of Object.values(book.points)) Object.assign(D.getEntity(doc, id).point, { survey: e.id, obs: book.results[D.getEntity(doc, id).name]?.obs });
      report.add('survey setups', Object.keys(book.setups).length + Object.keys(book.bases).length);
      report.add('observations', book.observations.length);
    }
  }
  for (const n of ['Parcels', 'PipeNetworks', 'GradingModels', 'Roadways']) if (X.kid(lx, n)) report.skip(n, 'not read yet');
}

/** A triangle turned so its normal points up (some writers wind clockwise). */
function faceUp(v, [a, b, c]) {
  const n = G.cross(G.sub(v[b], v[a]), G.sub(v[c], v[a]));
  return n[1] < 0 ? [a, c, b] : [a, b, c];
}

const TERRAIN = new Set(['surface', 'design_offset_surface', 'smoothed_surface', 'contour_surface', 'finished_ground', 'design_surface']); // generators whose result is ground
const isSurface = (e) => e.mesh && (TERRAIN.has(e.derived?.generator) || e.meta?.surface);
const fmt = (x) => (Math.round(x * 1e4) / 1e4).toString();

export function writeLandXml(doc, { ents, opts = {} }) {
  const proj = (w) => {
    const p = S.toProject(doc, w);
    return [p.n, p.e, p.z];
  };
  const nez = (w) => proj(w).map(fmt).join(' ');
  const g = S.geo(doc);
  const pts = ents.filter(S.isPoint);
  const surfaces = ents.filter(isSurface);
  const aligns = ents.filter((e) => e.alignment && e.curve);
  const feats = ents.filter((e) => (e.curve && !e.alignment) || S.isLinework(e));
  const lines = (P) => P.slice(1).map((p, i) => X.el('Line', {}, [X.el('Start', {}, nez(P[i])), X.el('End', {}, nez(p))]));
  const plan = (P) =>
    P.slice(1).map((p, i) => {
      const [a, b] = [proj(P[i]), proj(p)];
      return X.el('Line', {}, [X.el('Start', {}, `${fmt(a[0])} ${fmt(a[1])}`), X.el('End', {}, `${fmt(b[0])} ${fmt(b[1])}`)]);
    });
  const unit = { m: 'meter', ft: 'foot', usft: 'USSurveyFoot' }[g.units || 'm'];
  const tree = X.el('LandXML', { xmlns: 'http://www.landxml.org/schema/LandXML-1.2', version: '1.2', date: new Date().toISOString().slice(0, 10), time: new Date().toISOString().slice(11, 19), language: 'English', readOnly: 'false' }, [
    X.el('Units', {}, [unit === 'meter' ? X.el('Metric', { linearUnit: 'meter', areaUnit: 'squareMeter', volumeUnit: 'cubicMeter', angularUnit: 'decimal degrees', directionUnit: 'decimal degrees' }) : X.el('Imperial', { linearUnit: unit, areaUnit: 'squareFoot', volumeUnit: 'cubicYard', angularUnit: 'decimal degrees', directionUnit: 'decimal degrees' })]),
    g.crs ? X.el('CoordinateSystem', { ...(g.crs.epsg ? { epsgCode: g.crs.epsg } : {}), ...(g.crs.name ? { name: g.crs.name } : {}) }) : null,
    X.el('Project', { name: opts.name || 'MyModellerReel model' }),
    X.el('Application', { name: 'MyModellerReel', manufacturer: 'MyModellerReel', version: opts.version || '' }),
    pts.length && opts.points !== false ? X.el('CgPoints', {}, pts.map((p) => X.el('CgPoint', { name: p.name, code: p.point.code || undefined, desc: p.point.desc || undefined }, nez(D.worldMatrix(doc, p).elements.slice(12, 15))))) : null,
    ...ents.filter((e) => e.survey).map((e) => FB.toLandXmlSurvey(e.survey, X, e.name)),
    surfaces.length
      ? X.el(
          'Surfaces',
          {},
          surfaces.map((s) => {
            const m = D.worldMesh(doc, s);
            const tris = m.f.flatMap((_, fi) => G.triangulateFace(m, fi));
            return X.el('Surface', { name: s.name }, [X.el('Definition', { surfType: 'TIN' }, [X.el('Pnts', {}, m.v.map((v, i) => X.el('P', { id: i + 1 }, nez(v)))), X.el('Faces', {}, tris.map((t) => X.el('F', {}, t.map((i) => i + 1).join(' '))))])]);
          }),
        )
      : null,
    aligns.length
      ? X.el(
          'Alignments',
          {},
          aligns.map((a) => {
            const P = D.curvePoints(doc, a);
            let len = 0;
            for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]);
            const pv = a.alignment.pvis || [];
            return X.el('Alignment', { name: a.name, length: fmt(len), staStart: fmt(a.alignment.start_station || 0) }, [
              X.el('CoordGeom', {}, plan(P)),
              pv.length ? X.el('Profile', { name: a.name }, [X.el('ProfAlign', { name: `${a.name} design` }, pv.map((q) => (q[2] ? X.el('ParaCurve', { length: fmt(q[2]) }, `${fmt(q[0])} ${fmt(q[1])}`) : X.el('PVI', {}, `${fmt(q[0])} ${fmt(q[1])}`))))]) : null,
            ]);
          }),
        )
      : null,
    feats.length ? X.el('PlanFeatures', { name: 'Linework' }, feats.map((f) => X.el('PlanFeature', { name: f.name }, [X.el('CoordGeom', {}, lines(f.curve ? D.curvePoints(doc, f) : S.lineworkPath(doc, f)))]))) : null,
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${X.write(tree)}\n`;
}

registerFormat({
  id: 'landxml',
  label: 'LandXML 1.2 (points, surfaces, alignments, linework, survey setups and raw observations)',
  extensions: ['xml', 'landxml'],
  sniff: (t) => typeof t === 'string' && /<LandXML[\s>]/.test(t.slice(0, 4000)),
  read: readLandXml,
  write: writeLandXml,
});
