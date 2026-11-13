// OpenUSD (#245, #246). The document written as a .usda stage (Xforms, Meshes, UsdPreviewSurface materials, metres,
// Y up), and live references: another design's file shown here read-only, re-read when it changes, with this window's
// own overrides (move, hide, material) kept as a layer of opinions that is never written back to that file.
import * as D from './document.js';
import { registerFormat } from './formats.js';

const safe = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d|$)/, '_');
/** A prim name that stays the same when the entity is renamed or moved: the entity id is its tail. */
export const primName = (e) => `${safe(e.name)}_${e.id}`;
/** The key of a prim read back: the entity id our writer put in its name, else the prim path. */
export const primKey = (name, path) => name.match(/_(e\d+)$/)?.[1] || path;
/** The readable name of a prim read back. */
export const primLabel = (name) => name.replace(/_e\d+$/, '').replace(/_/g, ' ').trim() || name;

const num = (x) => String(+(+x).toFixed(6));
const tup = (a) => `(${a.map(num).join(', ')})`;
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** '#rrggbb' (sRGB) → linear RGB, which is what UsdPreviewSurface colours are. */
export const linearRgb = (hex) => [1, 3, 5].map((i) => lin(parseInt(String(hex).slice(i, i + 2), 16) / 255 || 0));

/** The entities (default: the whole document) as a .usda stage. Groups and meshes; other kinds are left out. */
export function writeUsda(doc, { ents = doc.entities, name = doc.name } = {}) {
  const keep = new Set(ents.filter((e) => e.type === 'group' || e.mesh?.f?.length).map((e) => e.id));
  const looks = new Map();
  const look = (m = {}) => {
    const k = JSON.stringify([m.color, m.opacity ?? 1, m.metalness ?? 0, m.roughness ?? 0.85]);
    if (!looks.has(k)) looks.set(k, { id: `M_${looks.size}`, m });
    return looks.get(k).id;
  };
  const prim = (e, pad) => {
    // an entity whose parent is not written carries its world placement
    const m = (keep.has(e.parent) ? D.localMatrix(e) : D.worldMatrix(doc, e)).elements;
    const out = [`${pad}def ${e.mesh ? 'Mesh' : 'Xform'} "${primName(e)}"${e.mesh ? ' (\n' + pad + '    prepend apiSchemas = ["MaterialBindingAPI"]\n' + pad + ')' : ''}`, `${pad}{`];
    const p = pad + '    ';
    out.push(`${p}matrix4d xformOp:transform = ( ${[0, 4, 8, 12].map((i) => tup(m.slice(i, i + 4))).join(', ')} )`, `${p}uniform token[] xformOpOrder = ["xformOp:transform"]`);
    if (e.visible === false) out.push(`${p}token visibility = "invisible"`);
    if (e.mesh) {
      out.push(
        `${p}point3f[] points = [${e.mesh.v.map(tup).join(', ')}]`,
        `${p}int[] faceVertexCounts = [${e.mesh.f.map((f) => f.length).join(', ')}]`,
        `${p}int[] faceVertexIndices = [${e.mesh.f.flat().join(', ')}]`,
        `${p}uniform token subdivisionScheme = "none"`,
        `${p}color3f[] primvars:displayColor = [${tup(linearRgb(e.material?.color || D.DEFAULT_COLOR))}]`,
        `${p}rel material:binding = </Root/Looks/${look(e.material)}>`,
      );
    }
    for (const c of ents.filter((x) => x.parent === e.id && keep.has(x.id))) out.push(...prim(c, p));
    out.push(`${pad}}`);
    return out;
  };
  const body = ents.filter((e) => keep.has(e.id) && !keep.has(e.parent)).flatMap((e) => prim(e, '    '));
  const mats = [...looks.values()].flatMap(({ id, m }) => [
    `        def Material "${id}"`,
    '        {',
    `            token outputs:surface.connect = </Root/Looks/${id}/PBR.outputs:surface>`,
    '            def Shader "PBR"',
    '            {',
    '                uniform token info:id = "UsdPreviewSurface"',
    `                color3f inputs:diffuseColor = ${tup(linearRgb(m.color || D.DEFAULT_COLOR))}`,
    `                float inputs:metallic = ${num(m.metalness ?? 0)}`,
    `                float inputs:roughness = ${num(m.roughness ?? 0.85)}`,
    `                float inputs:opacity = ${num(m.opacity ?? 1)}`,
    '                token outputs:surface',
    '            }',
    '        }',
  ]);
  return [
    '#usda 1.0',
    '(',
    '    defaultPrim = "Root"',
    `    doc = ${JSON.stringify(`MyModellerReel${name ? `: ${name}` : ''}`)}`,
    '    metersPerUnit = 1',
    '    upAxis = "Y"',
    ')',
    '',
    'def Xform "Root"',
    '{',
    ...body,
    '    def Scope "Looks"',
    '    {',
    ...mats,
    '    }',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- live references (#246)

const FIELDS = ['position', 'rotation', 'scale', 'visible', 'material'];
/** A cheap fingerprint of a mesh: a hand edit of a referenced part's shape changes it. */
const shape = (m) => `${m.v.length}/${m.f.length}/${num(m.v.reduce((s, p) => s + p[0] + 3 * p[1] + 7 * p[2], 0))}`;

/**
 * Fill or refresh a reference group from the parts read out of its file ([{ key, name, mesh, position, material }]):
 * parts keep their entity (and id) from one read to the next, the file's values become the base, and this window's
 * overrides go on top. Parts gone from the file go here too.
 */
export function applyReference(doc, g, parts) {
  const xr = g.xref;
  xr.overrides ||= {};
  xr.base = {};
  const old = new Map(D.childrenOf(doc, g.id).filter((c) => c.xprim).map((c) => [c.xprim, c]));
  for (const p of parts) {
    const e = old.get(p.key) || D.addEntity(doc, { parent: g.id, xprim: p.key, tag: g.tag });
    old.delete(p.key);
    const base = { position: p.position, rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, material: { ...p.material } };
    Object.assign(e, { name: p.name, mesh: p.mesh }, structuredClone(base), structuredClone(xr.overrides[p.key] || {}));
    xr.base[p.key] = { ...base, shape: shape(p.mesh) };
  }
  for (const e of old.values()) D.removeEntity(doc, e);
  xr.loaded = new Date().toISOString();
  return { parts: parts.length };
}

/** After every change: what differs from the file is an override; a referenced part's shape is not editable here. */
export function syncReferences(doc) {
  for (const g of doc.entities) {
    if (!g.xref?.base) continue;
    const ov = {};
    for (const e of D.childrenOf(doc, g.id)) {
      const b = e.xprim && g.xref.base[e.xprim];
      if (!b) continue;
      if (e.mesh && shape(e.mesh) !== b.shape) throw new Error(`${e.name} comes from the live reference ${g.name}: bind the reference to edit its shape.`);
      for (const k of FIELDS) if (JSON.stringify(e[k]) !== JSON.stringify(b[k])) (ov[e.xprim] ||= {})[k] = structuredClone(e[k]);
    }
    g.xref.overrides = ov;
  }
}

/** Make a reference local: its parts become ordinary shapes, the file is no longer followed. */
export function bindReference(doc, g) {
  for (const e of D.childrenOf(doc, g.id)) delete e.xprim;
  delete g.xref;
}

/** Every file this document follows. */
export const referencePaths = (doc) => [...new Set(doc.entities.filter((e) => e.xref?.path).map((e) => e.xref.path))];

registerFormat({
  id: 'usda',
  label: 'OpenUSD (writes .usda; reads .usda, .usdc and .usdz)',
  extensions: ['usda', 'usd', 'usdc', 'usdz'],
  binary: true,
  // three's USDLoader lives in the page: the desktop app parses, the parts come in as shapes
  read: async (bytes, { io, opts, report }) => {
    if (!io?.insertUsd) throw new Error('Reading USD needs the desktop app.');
    const r = io.insertUsd(bytes, String(opts.path || 'USD').split(/[\\/]/).pop());
    report.add('parts', r.parts);
    if (!r.parts) report.warn('No meshes in that USD file.');
    return { group: r.group };
  },
  write: (doc, { ents }) => writeUsda(doc, { ents }),
});
