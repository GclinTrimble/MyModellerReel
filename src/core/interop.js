// Interop and scale (#101, #105, #106, #107, #95): 3MF for 3D printing, a stand-alone web viewer page, version
// history inside the file, CC0 asset sources (Poly Haven) and text / image to 3D services. Pure: the renderer and the
// main process do the drawing, the files and the network.
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';
import * as G from './geometry.js';
import * as D from './document.js';
import { registerFormat } from './formats.js';

// ---------------------------------------------------------------- 3MF (#101)

const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toUpperCase() : '#D9D4C7');

/**
 * A 3MF package (zip bytes) of world meshes [{ name, mesh, color }]: one object each, metres, z up (y up in the
 * model becomes z up in the file), colours as base materials.
 */
export function write3mf(parts, { title = 'MyModellerReel model' } = {}) {
  if (!parts.length) throw new Error('Nothing to export: no shapes.');
  const colors = [...new Set(parts.map((p) => hex6(p.color)))];
  const objs = parts.map((p, k) => {
    const tri = [];
    for (let fi = 0; fi < p.mesh.f.length; fi++) tri.push(...G.triangulateFace(p.mesh, fi));
    const vs = p.mesh.v.map(([x, y, z]) => `<vertex x="${+x.toFixed(6)}" y="${+(-z).toFixed(6)}" z="${+y.toFixed(6)}"/>`).join('');
    const ts = tri.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');
    return `<object id="${k + 2}" type="model" name="${esc(p.name)}" pid="1" pindex="${colors.indexOf(hex6(p.color))}"><mesh><vertices>${vs}</vertices><triangles>${ts}</triangles></mesh></object>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="meter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc(title)}</metadata><metadata name="Application">MyModellerReel</metadata><resources><basematerials id="1">${colors.map((c, i) => `<base name="Colour ${i + 1}" displaycolor="${c}"/>`).join('')}</basematerials>${objs.join('')}</resources><build>${parts.map((_, k) => `<item objectid="${k + 2}"/>`).join('')}</build></model>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
  });
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- web viewer (#105)

/**
 * One HTML file that shows a GLB (base64) with orbit controls and plays its animation, with three.js inlined
 * (three: the module's source; addons: { 'GLTFLoader.js': source, 'OrbitControls.js': source, … }). No network.
 */
export function webViewerHtml({ title = 'Model', glb64, three, core = null, addons, background = '#eef1ec', autoplay = true }) {
  // relative imports inside the add-ons ("../utils/BufferGeometryUtils.js") become bare names a blob can resolve
  const flat = (src) => src.replace(/from\s+(['"])\.{1,2}\/(?:[\w-]+\/)*([\w-]+\.js)\1/g, "from 'three/addons/$2'");
  // three.module.js imports './three.core.js' (r16x+): that becomes a module of its own too
  const mods = { three: core ? three.replace(/(['"])\.\/three\.core\.js\1/g, "'three-core'") : three, ...(core ? { 'three-core': core } : {}), ...Object.fromEntries(Object.entries(addons).map(([k, v]) => [`three/addons/${k}`, flat(v)])) };
  // each module becomes a blob URL in an import map written at load time
  const payload = JSON.stringify(Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, v])));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;background:${background};font-family:system-ui,sans-serif}canvas{display:block;width:100%;height:100%}
#bar{position:fixed;left:12px;bottom:12px;display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.88);padding:6px 10px;border-radius:999px;font-size:13px;color:#1e3a4c}
#bar button{border:0;background:#2f6f86;color:#fff;border-radius:999px;padding:4px 12px;cursor:pointer}</style></head>
<body><div id="bar"><b>${esc(title)}</b><button id="play" hidden>Pause</button><span>drag to orbit · scroll to zoom</span></div>
<script id="mods" type="application/json">${payload.replace(/<\/script/gi, '<\\/script')}</script>
<script>
const mods = JSON.parse(document.getElementById('mods').textContent);
const urls = {};
// rewrite the bare specifiers so every module resolves to its blob
for (const k of Object.keys(mods)) urls[k] = null;
const order = Object.keys(mods);
const map = { imports: {} };
for (const k of order) { const u = URL.createObjectURL(new Blob([mods[k]], { type: 'text/javascript' })); map.imports[k] = u; }
const im = document.createElement('script'); im.type = 'importmap'; im.textContent = JSON.stringify(map); document.head.append(im);
const main = document.createElement('script'); main.type = 'module';
main.textContent = \`
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setPixelRatio(devicePixelRatio); document.body.prepend(r.domElement);
r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NeutralToneMapping; r.shadowMap.enabled = true;
const scene = new THREE.Scene(); scene.background = new THREE.Color('${background}');
scene.add(new THREE.HemisphereLight(0xeef4f6, 0x8a7f6c, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(30, 40, 20); sun.castShadow = true; scene.add(sun);
const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
const ctl = new OrbitControls(cam, r.domElement); ctl.enableDamping = true;
const bin = Uint8Array.from(atob('${glb64}'), (c) => c.charCodeAt(0));
const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
scene.add(gltf.scene);
gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
const box = new THREE.Box3().setFromObject(gltf.scene); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length() || 10;
sun.position.copy(c).add(new THREE.Vector3(0.6, 1, 0.4).multiplyScalar(s)); sun.target.position.copy(c); scene.add(sun.target);
Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: s * 4 }); sun.shadow.camera.updateProjectionMatrix();
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
cam.position.copy(c).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(s * 1.2)); ctl.target.copy(c);
let mixer = null; const btn = document.getElementById('play');
if (gltf.animations.length) { mixer = new THREE.AnimationMixer(gltf.scene); for (const a of gltf.animations) mixer.clipAction(a).play(); btn.hidden = false; if (!${autoplay}) mixer.timeScale = 0;
  btn.onclick = () => { mixer.timeScale = mixer.timeScale ? 0 : 1; btn.textContent = mixer.timeScale ? 'Pause' : 'Play'; }; }
const clock = new THREE.Timer();
function size() { r.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', size); size();
r.setAnimationLoop((t) => { clock.update(t); mixer?.update(clock.getDelta()); ctl.update(); r.render(scene, cam); });
\`;
document.body.append(main);
</script></body></html>`;
}

// ---------------------------------------------------------------- versions (#107)

/** A version: the document without its own version list. */
export function snapshot(doc, name) {
  const { versions, ...rest } = doc;
  void versions;
  return { name, time: new Date().toISOString(), doc: JSON.parse(JSON.stringify(rest)) };
}

// ---------------------------------------------------------------- free asset sources (#106)

export const ASSET_HOSTS = ['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com'];
/** Poly Haven search URL for models, textures or HDRIs. */
export const polyhavenList = (type) => `https://api.polyhaven.com/assets?t=${{ models: 'models', textures: 'textures', hdris: 'hdris' }[type] || 'models'}`;
export const polyhavenFiles = (id) => `https://api.polyhaven.com/files/${encodeURIComponent(id)}`;

/** Matching assets from a Poly Haven list: [{ id, name, categories, licence }], best first. */
export function polyhavenSearch(list, query, limit = 12) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return Object.entries(list)
    .map(([id, a]) => {
      const hay = `${id} ${a.name} ${(a.tags || []).join(' ')} ${(a.categories || []).join(' ')}`.toLowerCase();
      return { id, name: a.name, categories: a.categories || [], score: words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) + (a.download_count || 0) / 1e9, licence: 'CC0 (Poly Haven)' };
    })
    .filter((x) => !words.length || x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * What to download for a Poly Haven asset at a resolution: { kind, files: [{ url, path }] } where path is relative
 * (a glTF and its buffers and textures), or one texture image / HDRI.
 */
export function polyhavenDownload(files, type, res = '1k') {
  if (type === 'hdris') {
    const f = files.hdri?.[res]?.hdr || files.hdri?.['1k']?.hdr;
    if (!f) throw new Error('No HDR file at that resolution.');
    return { kind: 'hdri', files: [{ url: f.url, path: f.url.split('/').pop() }] };
  }
  if (type === 'textures') {
    const d = files.Diffuse || files.diff || files.Color;
    const f = d?.[res]?.jpg || d?.[res]?.png || d?.['1k']?.jpg;
    if (!f) throw new Error('No colour map at that resolution.');
    return { kind: 'texture', files: [{ url: f.url, path: f.url.split('/').pop() }] };
  }
  const g = files.gltf?.[res]?.gltf || files.gltf?.['1k']?.gltf;
  if (!g) throw new Error('No glTF of that model at that resolution.');
  const out = [{ url: g.url, path: g.url.split('/').pop() }];
  for (const [rel, f] of Object.entries(g.include || {})) out.push({ url: f.url, path: rel });
  return { kind: 'model', files: out };
}

// ---------------------------------------------------------------- text / image to 3D (#95)

/** A Tripo-style task request: text, or an image already uploaded (file token). */
export function meshTask({ prompt, imageToken = null }) {
  if (imageToken) return { type: 'image_to_model', file: { type: 'png', file_token: imageToken } };
  if (!prompt) throw new Error('Give a prompt or an image.');
  return { type: 'text_to_model', prompt };
}
/** The model URL of a finished task, null while it runs; throws when it failed. */
export function meshResult(json) {
  const d = json?.data;
  if (!d) throw new Error(json?.message || 'The 3D service sent nothing.');
  if (['failed', 'cancelled', 'banned', 'expired'].includes(d.status)) throw new Error(`The 3D service: ${d.status}.`);
  if (d.status !== 'success') return null;
  return d.output?.pbr_model || d.output?.model || d.result?.pbr_model?.url || d.result?.model?.url || null;
}

// 3MF in the export list
registerFormat({
  id: '3mf',
  label: '3MF (3D printing)',
  extensions: ['3mf'],
  binary: true,
  write: (doc, { ents }) => write3mf(ents.filter((e) => e.mesh?.f.length && e.visible !== false).map((e) => ({ name: e.name, mesh: D.worldMesh(doc, e), color: e.material?.color })), { title: doc.name || 'MyModellerReel model' }),
});
