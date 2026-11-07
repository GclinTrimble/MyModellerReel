// IFC (#103, #153): open BIM both ways. Writing is our own IFC4 / IFC4X3 STEP (triangulated face sets, the spatial
// tree, property sets from metadata, layers, colours, georeferencing by IfcMapConversion). Reading uses web-ifc
// (MPL-2.0, WebAssembly). IFC is Z up; the model is Y up: IFC (x, y, z) = model (x, −z, y).
import * as D from './document.js';
import * as G from './geometry.js';
import * as S from './survey.js';
import * as L from './layers.js';
import { registerFormat } from './formats.js';

// ---------------------------------------------------------------- writing
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
/** A stable IFC GlobalId (22 characters) from a text key. */
export function guid(key) {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let h = seed;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    return Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  });
  const bits = words.map((w) => w.toString(2).padStart(32, '0')).join('');
  let out = B64[parseInt(bits.slice(0, 2), 2)];
  for (let i = 2; i < 128; i += 6) out += B64[parseInt(bits.slice(i, i + 6), 2)];
  return out;
}
const str = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, (c) => `\\X2\\${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`)}'`;
const real = (x) => {
  const s = String(Math.round(x * 1e6) / 1e6);
  return /[.eE]/.test(s) ? s : `${s}.`;
};

/** The IFC class of an entity: meta.ifc_class, else its role / name, else a proxy. Surfaces are geographic elements. */
const CLASSES = [
  [/wall/i, 'IfcWall'],
  [/slab|floor/i, 'IfcSlab'],
  [/roof/i, 'IfcRoof'],
  [/door/i, 'IfcDoor'],
  [/window|glazing/i, 'IfcWindow'],
  [/column|pillar|post/i, 'IfcColumn'],
  [/beam|joist|girder/i, 'IfcBeam'],
  [/stair/i, 'IfcStair'],
  [/rail/i, 'IfcRailing'],
  [/furniture|table|chair|desk|sofa|bed|shelf/i, 'IfcFurniture'],
  [/kerb|curb/i, 'IfcKerb'],
  [/pavement|road|asphalt/i, 'IfcPavement'],
];
export function ifcClass(e) {
  if (e.meta?.ifc_class) return e.meta.ifc_class;
  if (e.meta?.surface || e.derived?.generator === 'surface' || e.derived?.generator === 'corridor') return 'IfcGeographicElement';
  const hint = `${e.meta?.role || ''} ${e.meta?.type || ''} ${e.meta?.category || ''} ${e.name}`;
  return CLASSES.find(([re]) => re.test(hint))?.[1] || 'IfcBuildingElementProxy';
}
// infrastructure classes that only IFC4X3 knows: IFC4 files get a proxy (the class goes into ObjectType)
const X3_ONLY = new Set(['IfcKerb', 'IfcPavement', 'IfcCourse', 'IfcEarthworksFill', 'IfcEarthworksCut', 'IfcAlignment']);
// classes whose IFC4 constructor has more than the usual 9 attributes (door / window: overall sizes and types)
const EXTRA = { IfcDoor: ['$', '$', '$', '$', '$'], IfcWindow: ['$', '$', '$', '$', '$'] };

export function writeIfc(doc, { ents, opts = {} }) {
  const schema = /4x3/i.test(opts.schema || '') ? 'IFC4X3_ADD2' : 'IFC4';
  const lines = [];
  let n = 0;
  const add = (body) => (lines.push(`#${++n}=${body};`), `#${n}`);
  const toIfc = (p) => [p[0], -p[2], p[1]];
  const pt = (p) => add(`IFCCARTESIANPOINT((${p.map(real).join(',')}))`);
  const origin = pt([0, 0, 0]);
  const zDir = add('IFCDIRECTION((0.,0.,1.))');
  const xDir = add('IFCDIRECTION((1.,0.,0.))');
  const axis = add(`IFCAXIS2PLACEMENT3D(${origin},${zDir},${xDir})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${axis},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const units = ['.LENGTHUNIT.,$,.METRE.', '.AREAUNIT.,$,.SQUARE_METRE.', '.VOLUMEUNIT.,$,.CUBIC_METRE.', '.PLANEANGLEUNIT.,$,.RADIAN.'].map((u) => add(`IFCSIUNIT(*,${u})`));
  const ua = add(`IFCUNITASSIGNMENT((${units.join(',')}))`);
  const project = add(`IFCPROJECT(${str(guid('project'))},$,${str(opts.name || 'MyModellerReel model')},$,$,$,$,(${ctx}),${ua})`);
  const g = S.geo(doc);
  if (g.base) {
    const crs = add(`IFCPROJECTEDCRS(${str(S.crsLabel(g.crs) || 'Local grid')},$,$,$,$,$,$)`);
    add(`IFCMAPCONVERSION(${ctx},${crs},${real(g.base[0])},${real(g.base[1])},${real(g.base[2])},1.,0.,1.)`);
  }
  const place = (rel) => add(`IFCLOCALPLACEMENT(${rel},${axis})`);
  const sitePl = place('$');
  const site = add(`IFCSITE(${str(guid('site'))},$,'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = place(sitePl);
  const building = add(`IFCBUILDING(${str(guid('building'))},$,${str(opts.building || 'Building')},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const stPl = place(bldPl);
  const storey = add(`IFCBUILDINGSTOREY(${str(guid('storey'))},$,'Level 0',$,$,${stPl},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES(${str(guid('agg1'))},$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${str(guid('agg2'))},$,$,$,${site},(${building}))`);
  add(`IFCRELAGGREGATES(${str(guid('agg3'))},$,$,$,${building},(${storey}))`);
  const inSite = [];
  const inStorey = [];
  const layerReps = new Map();
  const styles = new Map();
  const styleOf = (hex, opacity) => {
    const k = `${hex}|${opacity}`;
    if (!styles.has(k)) {
      const c = [1, 3, 5].map((i) => real(parseInt(hex.slice(i, i + 2), 16) / 255));
      const col = add(`IFCCOLOURRGB($,${c.join(',')})`);
      const sh = add(`IFCSURFACESTYLESHADING(${col},${real(1 - (opacity ?? 1))})`);
      styles.set(k, add(`IFCSURFACESTYLE($,.BOTH.,(${sh}))`));
    }
    return styles.get(k);
  };
  const report = { elements: 0, skipped: 0, classes: {} };
  const meshes = ents.filter((e) => e.mesh && e.visible !== false);
  for (const e of meshes) {
    const m = D.worldMesh(doc, e);
    if (!m.f.length) continue;
    const tris = m.f.flatMap((_, fi) => G.triangulateFace(m, fi));
    const pl = add(`IFCCARTESIANPOINTLIST3D((${m.v.map((p) => `(${toIfc(p).map(real).join(',')})`).join(',')}),$)`);
    const fs = add(`IFCTRIANGULATEDFACESET(${pl},$,.T.,(${tris.map((t) => `(${t.map((i) => i + 1).join(',')})`).join(',')}),$)`);
    add(`IFCSTYLEDITEM(${fs},(${styleOf(L.colorOf(doc, e), e.material.opacity)}),$)`);
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${fs}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const wanted = ifcClass(e);
    const cls = schema === 'IFC4' && X3_ONLY.has(wanted) ? 'IfcBuildingElementProxy' : wanted;
    const geo = cls === 'IfcGeographicElement';
    const ep = place(geo ? sitePl : stPl);
    const extra = EXTRA[cls] ? `,${EXTRA[cls].join(',')}` : ',$';
    const el = add(`${cls.toUpperCase()}(${str(guid(`${e.id}|${e.name}`))},$,${str(e.name)},$,${e.meta?.role ? str(e.meta.role) : cls !== wanted ? str(wanted) : '$'},${ep},${pds},${str(e.id)}${extra})`);
    (geo ? inSite : inStorey).push(el);
    report.elements++;
    report.classes[cls] = (report.classes[cls] || 0) + 1;
    if (e.tag && e.tag !== 'Untagged') (layerReps.get(e.tag) || layerReps.set(e.tag, []).get(e.tag)).push(rep);
    const meta = Object.entries({ ...(e.meta || {}) }).filter(([k, v]) => k !== 'ifc_class' && v !== null && typeof v !== 'object');
    if (meta.length) {
      const props = meta.map(([k, v]) => add(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${typeof v === 'number' ? `IFCREAL(${real(v)})` : typeof v === 'boolean' ? `IFCBOOLEAN(${v ? '.T.' : '.F.'})` : `IFCLABEL(${str(v)})`},$)`));
      const ps = add(`IFCPROPERTYSET(${str(guid(`${e.id}|pset`))},$,'Pset_MyModellerReel',$,(${props.join(',')}))`);
      add(`IFCRELDEFINESBYPROPERTIES(${str(guid(`${e.id}|rel`))},$,$,$,(${el}),${ps})`);
    }
  }
  report.skipped = ents.length - meshes.length;
  if (inStorey.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${str(guid('contains-storey'))},$,$,$,(${inStorey.join(',')}),${storey})`);
  if (inSite.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${str(guid('contains-site'))},$,$,$,(${inSite.join(',')}),${site})`);
  for (const [name, reps] of layerReps) add(`IFCPRESENTATIONLAYERASSIGNMENT(${str(name)},$,(${reps.join(',')}),$)`);
  const now = new Date().toISOString().slice(0, 19);
  const head = ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');", `FILE_NAME(${str(opts.file || 'model.ifc')},'${now}',(''),(''),'MyModellerReel','MyModellerReel ${opts.version || ''}','');`, `FILE_SCHEMA(('${schema}'));`, 'ENDSEC;', 'DATA;'];
  const text = `${[...head, ...lines, 'ENDSEC;', 'END-ISO-10303-21;'].join('\n')}\n`;
  return { text, report };
}

// ---------------------------------------------------------------- reading
let api;
async function ifcApi() {
  if (api) return api;
  const W = await import('web-ifc');
  const a = new W.IfcAPI();
  if (typeof window !== 'undefined') a.SetWasmPath(new URL('../../node_modules/web-ifc/', import.meta.url).href, true);
  await a.Init();
  api = { a, W };
  return api;
}

export async function readIfc(bytes, { doc, report, opts = {} }) {
  const { a, W } = await ifcApi();
  const id = a.OpenModel(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { COORDINATE_TO_ORIGIN: false });
  try {
    const val = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
    const line = (eid, flat = false) => a.GetLine(id, eid, flat);
    const typeName = (eid) => {
      const n = a.GetNameFromTypeCode(a.GetLineType(id, eid));
      return n && /^Ifc/.test(n) ? n : 'IfcProduct';
    };
    // georeferencing: the map conversion origin becomes the base point (local model = IFC local coordinates)
    const g = S.geo(doc);
    const mc = a.GetLineIDsWithType(id, W.IFCMAPCONVERSION);
    if (mc.size()) {
      const m = line(mc.get(0));
      const E = +val(m.Eastings);
      const N = +val(m.Northings);
      const H = +val(m.OrthogonalHeight) || 0;
      const rot = Math.atan2(+val(m.XAxisOrdinate) || 0, +val(m.XAxisAbscissa) || 1);
      if (!g.base) g.base = [E, N, H];
      else if (Math.hypot(g.base[0] - E, g.base[1] - N) > 1e-3) report.warn(`The IFC is placed at E ${E}, N ${N}; the project base point differs: the model is placed by the project's base point.`);
      if (Math.abs(rot) > 1e-6) report.warn(`The IFC grid is turned ${((rot * 180) / Math.PI).toFixed(3)}° from the map: not applied yet.`);
    }
    // spatial tree → groups
    const groups = new Map();
    const where = new Map(); // element → its group
    const walk = (node, parent) => {
      const kind = typeName(node.expressID);
      let gid = parent;
      if (/Site|Building|Storey|Space|Facility|Bridge|Road|Railway/.test(kind) && !/Element/.test(kind)) {
        const l = line(node.expressID);
        const grp = D.addEntity(doc, { type: 'group', name: D.uniqueName(doc, val(l.Name) || kind.replace(/^Ifc/, '')), parent, meta: { ifc_class: kind, GlobalId: val(l.GlobalId) } });
        groups.set(node.expressID, grp.id);
        gid = grp.id;
        report.add('spatial_groups');
      } else if (node.expressID && parent !== undefined && !/Project/.test(kind)) where.set(node.expressID, parent);
      for (const c of node.children || []) walk(c, gid);
    };
    try {
      walk(await a.properties.getSpatialStructure(id, false), null);
    } catch {
      report.warn('No spatial structure (site / building / storey): elements are placed at the top level.');
    }
    // layers: shape representation → layer name
    const repLayer = new Map();
    const la = a.GetLineIDsWithType(id, W.IFCPRESENTATIONLAYERASSIGNMENT);
    for (let i = 0; i < la.size(); i++) {
      const l = line(la.get(i));
      for (const r of l.AssignedItems || []) repLayer.set(val(r), val(l.Name));
    }
    // meshes
    const parts = new Map();
    a.StreamAllMeshes(id, (fm) => {
      const v = [];
      const f = [];
      let color = null;
      for (let i = 0; i < fm.geometries.size(); i++) {
        const pg = fm.geometries.get(i);
        const geom = a.GetGeometry(id, pg.geometryExpressID);
        const vd = a.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const ix = a.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const T = pg.flatTransformation;
        const base = v.length;
        for (let k = 0; k < vd.length; k += 6) {
          const [x, y, z] = [vd[k], vd[k + 1], vd[k + 2]];
          // web-ifc hands geometry Y up already (its normalising matrix), in metres
          v.push([T[0] * x + T[4] * y + T[8] * z + T[12], T[1] * x + T[5] * y + T[9] * z + T[13], T[2] * x + T[6] * y + T[10] * z + T[14]]);
        }
        for (let k = 0; k + 2 < ix.length; k += 3) f.push([base + ix[k], base + ix[k + 1], base + ix[k + 2]]);
        color ||= pg.color;
        geom.delete();
      }
      if (f.length) parts.set(fm.expressID, { v, f, color });
    });
    const ids = [...parts.keys()];
    for (const eid of ids) {
      const { v, f, color } = parts.get(eid);
      let l;
      try {
        l = line(eid);
      } catch {
        report.skip('element', 'unreadable in this schema');
        continue;
      }
      const cls = typeName(eid);
      const meta = { ifc_class: cls, ...(val(l.GlobalId) ? { GlobalId: val(l.GlobalId) } : {}), ...(val(l.ObjectType) ? { role: val(l.ObjectType) } : {}) };
      if (opts.properties !== false) {
        try {
          for (const ps of await a.properties.getPropertySets(id, eid, true))
            for (const p of ps.HasProperties || []) {
              const pv = val(p.NominalValue);
              if (pv !== undefined && pv !== null && typeof pv !== 'object') meta[`${val(ps.Name)}.${val(p.Name)}`] = pv;
            }
        } catch {
          report.skip('property sets', 'unreadable');
        }
      }
      let layer = null;
      for (const r of l.Representation ? line(val(l.Representation)).Representations || [] : []) layer ||= repLayer.get(val(r));
      const tag = layer || cls.replace(/^Ifc/, '');
      L.ensureLayer(doc, tag);
      report.layer(tag);
      const hex = color ? `#${[color.x, color.y, color.z].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}` : '#d9d4c7';
      const { mesh, origin } = G.recenter({ v, f });
      D.addEntity(doc, { name: D.uniqueName(doc, val(l.Name) || cls.replace(/^Ifc/, '')), mesh, position: D.round3(origin), parent: where.get(eid) ?? null, tag, material: { color: hex, opacity: color ? Math.round(color.w * 100) / 100 : 1 }, meta });
      report.add('elements');
      report.add(cls);
    }
    return { schema: a.GetModelSchema?.(id) };
  } finally {
    a.CloseModel(id);
  }
}

registerFormat({
  id: 'ifc',
  label: 'IFC (open BIM: IFC4, IFC4X3)',
  extensions: ['ifc'],
  binary: true,
  options: { schema: 'export: IFC4 (default) or IFC4X3', properties: 'import: read property sets (default true)' },
  read: readIfc,
  write: (doc, o) => writeIfc(doc, o).text,
});
