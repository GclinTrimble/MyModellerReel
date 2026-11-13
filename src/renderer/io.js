// Files. The native format is plain .glb: any 3D tool opens it, and MyModellerReel also tucks the editable
// document into the glTF scene extras, so its own files reopen with groups, pivots, tags and keyframes intact.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import * as USD from '../core/usd.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as G from '../core/geometry.js';
import * as D from '../core/document.js';
import * as A from '../core/animation.js';
import { buildModel } from './viewport.js';
import { renderVideo } from './render.js';
import { stripForSave, hydrate } from '../core/components.js';
import { migrateSurfaces } from '../core/sitework.js';
import * as Assets from '../core/assets.js';
import { tiffInfo, demRead } from './underlays.js';

const D2R = Math.PI / 180;
const native = () => window.native;
const base = (p) => p.split(/[\\/]/).pop();
/** The mean of a texture's pixels as [r, g, b] 0–1 (sRGB), or null without an image. */
function avgOf(tex) {
  const img = tex?.image;
  if (!img?.width) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const s = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k];
  return s.map((x) => x / 256 / 255);
}
/**
 * GLTFLoader reads any node's extras.pivot as GLTFExporter's container (first child at -pivot) and zeroes that child's
 * position. Rigs from other tools keep their own pivot note there (animated machines): drop it unless the pattern is
 * really GLTFExporter's, or their arms and buckets come apart.
 */
const keepForeignPivots = (parser) => ({
  name: 'mmr_foreign_pivots',
  beforeRoot() {
    const nodes = parser.json.nodes || [];
    for (const n of nodes) {
      const p = n.extras?.pivot;
      if (!Array.isArray(p)) continue;
      const t = nodes[n.children?.[0]]?.translation;
      if (!t || p.some((v, k) => Math.abs(v + t[k]) > 1e-6)) delete n.extras.pivot;
    }
  },
});
/** A three.js mesh as one of our shapes: world transform baked, recentred, its material's look. Null when empty. */
function meshPart(o) {
  if (!o.isMesh || !o.geometry?.attributes?.position) return null;
  let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
  if (g.index) g = g.toNonIndexed();
  const raw = G.fromTriangles(g.attributes.position.array);
  if (!raw.f.length) return null;
  const { mesh, origin } = G.recenter(raw);
  const m = [].concat(o.material)[0] || {};
  // shortcut: texture maps are not kept (no UVs on our meshes); their average colour stands in for them
  const color = m.color?.clone();
  const avg = avgOf(m.map);
  if (color && avg) color.multiply(new THREE.Color().setRGB(...avg, THREE.SRGBColorSpace));
  const metal = avgOf(m.metalnessMap);
  const rough = avgOf(m.roughnessMap);
  return { mesh, position: D.round3(origin), material: { color: color ? `#${color.getHexString()}` : D.DEFAULT_COLOR, opacity: m.opacity ?? 1, metalness: +((m.metalness ?? 0) * (metal ? metal[2] : 1)).toFixed(2), roughness: +((m.roughness ?? 0.85) * (rough ? rough[1] : 1)).toFixed(2) } };
}
const FILTERS = {
  jsonl: [{ name: 'Training records (JSONL)', extensions: ['jsonl'] }],
  glb: [{ name: 'GLB 3D model', extensions: ['glb'] }],
  gltf: [{ name: 'glTF (JSON)', extensions: ['gltf'] }],
  obj: [{ name: 'Wavefront OBJ', extensions: ['obj'] }],
  stl: [{ name: 'STL (3D printing)', extensions: ['stl'] }],
  png: [{ name: 'PNG image', extensions: ['png'] }],
  video: [{ name: 'MP4 video (H.264)', extensions: ['mp4'] }, { name: 'WebM video (VP9, can be transparent)', extensions: ['webm'] }, { name: 'Animated GIF', extensions: ['gif'] }, { name: 'PNG sequence', extensions: ['png'] }],
  models: [{ name: '3D models', extensions: ['glb', 'gltf', 'obj', 'stl', 'fbx', 'usda', 'usdc', 'usdz', 'usd'] }],
  reference: [{ name: 'Designs to follow', extensions: ['usda', 'usdc', 'usdz', 'usd', 'glb', 'gltf', 'obj', 'stl', 'fbx'] }],
  usda: [{ name: 'OpenUSD (text)', extensions: ['usda'] }],
  import: [{ name: 'Models and exchange files', extensions: ['glb', 'gltf', 'obj', 'stl', 'fbx', 'usda', 'usdc', 'usdz', 'usd', 'xml', 'landxml', 'ifc', 'dxf', 'jxl', 'fxl', 'geojson', 'json', 'shp', 'gpkg'] }, { name: 'Trimble JobXML / feature library', extensions: ['jxl', 'fxl'] }, { name: 'GeoJSON / Shapefile / GeoPackage', extensions: ['geojson', 'json', 'shp', 'gpkg'] }, { name: 'LandXML', extensions: ['xml', 'landxml'] }, { name: 'IFC', extensions: ['ifc'] }, { name: 'DXF', extensions: ['dxf'] }, { name: '3D models', extensions: ['glb', 'gltf', 'obj', 'stl', 'fbx'] }],
  landxml: [{ name: 'LandXML 1.2', extensions: ['xml'] }],
  ifc: [{ name: 'IFC', extensions: ['ifc'] }],
  dxf: [{ name: 'DXF (R12)', extensions: ['dxf'] }],
  section: [{ name: 'SVG drawing', extensions: ['svg'] }, { name: 'DXF (R12)', extensions: ['dxf'] }],
  texture: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  hdri: [{ name: 'HDR panoramas', extensions: ['hdr', 'exr'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }],
  schedule: [{ name: 'Schedules', extensions: ['csv', 'xml', 'xer', 'txt'] }],
  drawing2d: [{ name: '2D drawings', extensions: ['svg', 'dxf'] }],
  cloud: [{ name: 'Point clouds', extensions: ['ply', 'las', 'xyz', 'pts', 'csv', 'txt'] }],
  html: [{ name: 'Web page', extensions: ['html'] }],
  usdz: [{ name: 'USDZ (AR Quick Look)', extensions: ['usdz'] }],
  '3mf': [{ name: '3MF', extensions: ['3mf'] }],
  sheet: [{ name: 'PDF', extensions: ['pdf'] }, { name: 'SVG drawing', extensions: ['svg'] }],
  geojson: [{ name: 'GeoJSON', extensions: ['geojson'] }],
  owc: [{ name: 'OWS Context (GeoJSON)', extensions: ['json'] }],
  gpkg: [{ name: 'OGC GeoPackage', extensions: ['gpkg'] }],
  infragml: [{ name: 'OGC InfraGML Survey', extensions: ['gml'] }],
  report: [{ name: 'Report (HTML)', extensions: ['html'] }],
  takeoff: [{ name: 'CSV table', extensions: ['csv'] }, { name: 'GeoJSON (painted faces, OGC API Features)', extensions: ['geojson'] }, { name: 'JSON', extensions: ['json'] }],
  matlib: [{ name: 'Material library', extensions: ['json', 'csv'] }],
  shp: [{ name: 'Shapefile', extensions: ['shp'] }],
};

export class IO {
  constructor(app) {
    this.app = app;
  }

  async pick(kind, save, suggested, multi = false) {
    return save
      ? native().invoke('file:save-dialog', { defaultPath: suggested, filters: FILTERS[kind] })
      : native().invoke('file:open-dialog', { filters: FILTERS[kind], multi });
  }

  /**
   * Export scene + baked animation clip. withDoc keeps the editable document inside (our save format), with the files
   * it uses (assets) packed in, except those in outside (a project keeps them as files in assets/).
   */
  async toGLTF(binary, withDoc, outside = null) {
    const doc = this.app.store.doc;
    // shared parts (component instances) share one geometry, which the GLB then stores once
    const { root, objs } = buildModel(doc, { edges: false, cache: { map: new WeakMap(), used: new Set() } });
    const scene = new THREE.Scene();
    scene.name = 'MyModellerReel';
    scene.add(root);
    if (withDoc) scene.userData.mymodellerreel = JSON.stringify(doc, stripForSave);
    if (withDoc) {
      // every asset the model uses: underlays, point clouds, audio, textures, field-book photos (only underlays were
      // packed before, so a model without a drawing lost its point clouds and photos on save)
      const packed = Assets.pack(doc);
      for (const id of outside || []) delete packed[id];
      if (Object.keys(packed).length) scene.userData.mymodellerreel_assets = packed;
    }
    if (doc.geo?.base) scene.userData.georef = { base_point_enz: doc.geo.base, crs: doc.geo.crs, axes: 'x = Easting − base, y = Elevation − base, z = −(Northing − base)' };
    const animations = this.clips(doc, objs, scene);
    return new GLTFExporter().parseAsync(scene, { binary, animations, onlyVisible: false });
  }

  /** Bake keyframes (with their easing) into linear glTF tracks at the timeline frame rate. */
  clips(doc, objs, scene) {
    const { duration, fps } = doc.animation;
    const times = Array.from({ length: Math.round(duration * fps) + 1 }, (_, i) => i / fps);
    const tracks = [];
    // keyframes and procedural motions both end up as baked tracks
    const animated = [...doc.animation.tracks.map((t) => [t.target, t.property]), ...(doc.animation.motions || []).map((m) => [m.target, m.property || A.MOTIONS[m.type]?.property])];
    const targets = [...new Set(animated.map(([t]) => t))];
    for (const id of targets) {
      if (id === 'camera') continue;
      const o = objs.get(id);
      const e = D.getEntity(doc, id);
      if (!o || !e) continue;
      const props = new Set(animated.filter(([t]) => t === id).map(([, p]) => p));
      const pose = times.map((t) => A.evaluate(doc, t)[id] || {});
      if (props.has('position')) tracks.push(new THREE.VectorKeyframeTrack(`${o.uuid}.position`, times, pose.flatMap((p) => p.position || e.position)));
      if (props.has('rotation'))
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${o.uuid}.quaternion`,
            times,
            pose.flatMap((p) => {
              const r = p.rotation || e.rotation;
              return new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R)).toArray();
            }),
          ),
        );
      // glTF has no visibility track: hidden frames scale to zero, the usual workaround.
      if (props.has('scale') || props.has('visible'))
        tracks.push(new THREE.VectorKeyframeTrack(`${o.uuid}.scale`, times, pose.flatMap((p) => ((p.visible ?? e.visible) ? p.scale || e.scale : [0, 0, 0]))));
    }
    if (targets.includes('camera')) {
      const cam = new THREE.PerspectiveCamera(doc.camera.fov || 45, 16 / 9, 0.05, 5000);
      cam.name = 'Camera';
      scene.add(cam);
      const v = this.app.viewport.getCamera();
      const poses = times.map((t) => ({ position: v.position, target: v.target, ...(A.evaluate(doc, t).camera || {}) }));
      const q = (p) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(...p.position), new THREE.Vector3(...p.target), new THREE.Vector3(0, 1, 0))).toArray();
      cam.position.fromArray(poses[0].position);
      tracks.push(new THREE.VectorKeyframeTrack(`${cam.uuid}.position`, times, poses.flatMap((p) => p.position)));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${cam.uuid}.quaternion`, times, poses.flatMap(q)));
    }
    return tracks.length ? [new THREE.AnimationClip('Timeline', duration, tracks)] : [];
  }

  async save(path) {
    path ||= await this.pick('glb', true, this.app.file || 'Untitled.glb');
    if (!path) return { cancelled: true };
    if (!/\.glb$/i.test(path)) path += '.glb';
    await native().invoke('file:write', path, await this.toGLTF(true, true));
    this.app.setFile(path, false);
    this.app.ui.toast(`Saved ${base(path)}`);
    return { saved: path };
  }

  // ---- projects (#277): the folder, files copied in, the model written without the assets kept beside it
  pickFolder(title) {
    return native().invoke('file:folder-dialog', { title });
  }
  copyInto(src, destDir) {
    return native().invoke('project:copy', src, destDir);
  }
  exists(path) {
    return native().invoke('file:exists', path);
  }
  writeFile(path, data) {
    return native().invoke('file:write', path, data);
  }
  async writeModel(path, outside) {
    await native().invoke('file:write', path, await this.toGLTF(true, true, outside));
    this.app.setFile(path, false);
    return path;
  }
  /** After a command changed the document outside the undo steps (a project's settings applied on open). */
  refresh() {
    this.app.store.changed();
  }

  async load(path) {
    const buf = await native().invoke('file:read', path);
    const ext = path.split('.').pop().toLowerCase();
    if (ext === 'glb' || ext === 'gltf') {
      // compressed GLBs (#104) read back: meshopt and draco
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(keepForeignPivots);
      this.draco ||= new DRACOLoader().setDecoderPath(new URL('../../node_modules/three/examples/jsm/libs/draco/gltf/', import.meta.url).href);
      loader.setDRACOLoader(this.draco);
      return loader.parseAsync(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '');
    }
    if (ext === 'obj') return { scene: new OBJLoader().parse(new TextDecoder().decode(buf)) };
    if (ext === 'stl') return { scene: new THREE.Mesh(new STLLoader().parse(buf), new THREE.MeshStandardMaterial({ color: D.DEFAULT_COLOR })) };
    if (ext === 'fbx') return { scene: new FBXLoader().parse(buf, '') };
    if (/^usd[acz]?$/.test(ext)) return { scene: new USDLoader().parse(buf) };
    throw new Error(`Cannot read .${ext} files.`);
  }

  async open(path) {
    path ||= await this.pick('models', false);
    if (!path) return { cancelled: true };
    const gltf = await this.load(path);
    const raw = gltf.scene?.userData?.mymodellerreel;
    if (raw) {
      const opened = JSON.parse(raw);
      Assets.unpack(gltf.scene.userData.mymodellerreel_assets);
      hydrate(opened);
      migrateSurfaces(opened); // older files: surfaces onto the editable definition (#239)
      this.app.store.replace(opened);
      this.app.afterOpen(path);
      return { opened: path, entities: this.app.store.doc.entities.length, editable: true };
    }
    this.app.store.replace(D.newDoc());
    const r = this.insert(gltf.scene, base(path));
    this.app.store.changed(); // the parts were added after replace() redrew the empty model
    if (!r.parts) this.app.ui.toast(`${base(path)} has no meshes to show.`, 'warning');
    this.app.afterOpen(path.replace(/\.\w+$/, '.glb'));
    return { opened: path, ...r, editable: 'imported as shapes' };
  }

  /** Bring a model into this one. at: a world point its base centre lands on (a drop), else it is framed. */
  async importModel(path, at = null) {
    path ||= await this.pick('models', false);
    if (!path) return { cancelled: true };
    const gltf = await this.load(path);
    this.app.store.checkpoint();
    const r = this.insert(gltf.scene, base(path));
    this.app.store.changed();
    if (!r.parts) this.app.ui.toast(`${base(path)} has no meshes to show.`, 'warning');
    if (at && r.parts) {
      await this.app.reg.run('move', { ids: [r.group], to: at.map((x) => Math.round(x * 1000) / 1000) });
    } else this.app.reg.run('zoom_extents', { ids: [r.group] });
    return r;
  }

  /** Copy model files into the component library (other formats become GLB), with a group and tags. No paths: a dialog that takes many. */
  async addToLibrary(paths, meta = null) {
    paths = [].concat(paths || (await this.pick('models', false, '', true)) || []);
    if (!paths.length) return { cancelled: true };
    const added = [];
    const failed = [];
    for (const path of paths) {
      try {
        let data;
        if (/\.glb$/i.test(path)) data = await native().invoke('file:read', path);
        else data = await new GLTFExporter().parseAsync((await this.load(path)).scene, { binary: true });
        added.push(await native().invoke('library:add', base(path), data, meta));
      } catch (e) {
        failed.push(`${base(path)}: ${e.message}`);
      }
    }
    this.thumbs = null;
    if (this.app.ui.tab === 'library') this.app.ui.renderDock();
    return { added, ...(failed.length ? { failed } : {}) };
  }
  /** Set the group and / or tags of library models. */
  async organizeLibrary(names, meta) {
    const out = [];
    for (const n of names) out.push({ name: n, ...(await native().invoke('library:meta', n, meta)) });
    if (this.app.ui.tab === 'library') this.app.ui.renderDock();
    return out;
  }

  /** Convert any three.js object tree into editable shapes inside one group (world transforms baked in). */
  insert(object, name) {
    const doc = this.app.store.doc;
    object.updateMatrixWorld(true);
    const group = D.addEntity(doc, { type: 'group', name: name.replace(/\.\w+$/, '') });
    let count = 0;
    object.traverse((o) => {
      const p = meshPart(o);
      if (!p) return;
      D.addEntity(doc, { name: o.name || `Part ${++count}`, parent: group.id, ...p });
      count++;
    });
    return { group: group.id, parts: count };
  }

  /** A USD file's bytes (.usda, .usdc or .usdz) as shapes in one group (#245). */
  insertUsd(bytes, name) {
    return this.insert(new USDLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), name);
  }

  /** A file's meshes as live reference parts (#246), keyed by prim: the entity id our .usda writer puts in each name. */
  async referenceParts(path) {
    const { scene } = await this.load(path);
    scene.updateMatrixWorld(true);
    const parts = [];
    const seen = new Set();
    scene.traverse((o) => {
      const p = meshPart(o);
      if (!p) return;
      const names = [];
      for (let x = o; x && x !== scene; x = x.parent) names.unshift(x.name || '');
      let key = USD.primKey(o.name || '', names.join('/'));
      while (seen.has(key)) key += '+'; // unnamed twins in other formats
      seen.add(key);
      parts.push({ key, name: USD.primLabel(o.name || `Part ${parts.length + 1}`), ...p });
    });
    return parts;
  }

  /** Publish the design as a live reference (#246): a .usda written now and after every change, debounced. */
  async publish(path) {
    this.published = path;
    if (!path) return { publishing: false };
    await this.republish(true);
    this.app.ui.toast(`Publishing to ${base(path)}: other windows can reference it`);
    return { publishing: path };
  }
  async republish(now) {
    if (!this.published) return;
    clearTimeout(this.publishT);
    const write = () => {
      const doc = this.app.store.doc;
      const shown = (e) => !e || (e.visible !== false && shown(e.parent && D.getEntity(doc, e.parent)));
      return native().invoke('file:write', this.published, USD.writeUsda(doc, { ents: doc.entities.filter(shown) }));
    };
    if (now) return write();
    this.publishT = setTimeout(() => write().catch((e) => this.app.ui.toast(`Publishing: ${e.message}`, 'danger')), 300);
  }

  async exportAs(format, path) {
    const name = (this.app.file ? base(this.app.file) : 'Untitled.glb').replace(/\.\w+$/, '');
    if (format === 'video') return this.renderVideo({ path });
    path ||= await this.pick(format, true, `${name}.${format}`);
    if (!path) return { cancelled: true };
    let data;
    if (format === 'glb' || format === 'gltf') {
      data = await this.toGLTF(format === 'glb', false);
      if (format === 'gltf') data = JSON.stringify(data, null, 1);
    } else if (format === 'obj' || format === 'stl') {
      const { root } = buildModel(this.app.store.doc, { edges: false });
      root.updateMatrixWorld(true);
      data = format === 'obj' ? new OBJExporter().parse(root) : new STLExporter().parse(root, { binary: true }).buffer;
    } else if (format === 'usdz') {
      // iPhone / iPad AR Quick Look (#101)
      const { root } = buildModel(this.app.store.doc, { edges: false });
      root.updateMatrixWorld(true);
      data = (await new USDZExporter().parseAsync(root)).buffer;
    } else if (format === 'png') {
      const url = await this.app.viewport.screenshot({ width: 3840 });
      data = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0)).buffer;
    } else throw new Error(`Unknown format ${format}`);
    await native().invoke('file:write', path, data);
    this.app.ui.toast(`Exported ${base(path)}`);
    return { exported: path };
  }

  /** A GeoTIFF elevation grid (#37). */
  demRead(bytes) {
    return demRead(bytes);
  }

  /** A how-to page's Markdown (#158). */
  readHowto(id) {
    return native().invoke('help:read', id);
  }

  /** Updates (#108). */
  checkUpdates() {
    return native().invoke('update:check');
  }
  async installUpdate() {
    await this.app.autosave?.();
    return native().invoke('update:install');
  }

  /** The system clipboard (copy / paste between models); fails quietly when the window is not focused. */
  clipboardWrite(text) {
    return navigator.clipboard.writeText(text);
  }
  clipboardRead() {
    return navigator.clipboard.readText();
  }

  /** Read a PDF or an image (underlays). */
  async readBinary(path) {
    return new Uint8Array(await native().invoke('file:read-binary', path));
  }

  /** Size and GeoTIFF tags of a TIFF. */
  tiffInfo(bytes) {
    return tiffInfo(bytes);
  }

  /** Read a text file (survey points, feature libraries). */
  readText(path) {
    return native().invoke('file:read-text', path);
  }

  /** Write a text file (reports). The main process only allows known extensions. */
  async writeText(path, text) {
    await native().invoke('file:write', path, text);
    this.app.ui.toast(`Wrote ${base(path)}`);
    return path;
  }

  /** The component library (#45): files, a file's path, and a thumbnail (rendered once, kept for the session). */
  listLibrary() {
    return native().invoke('library:list');
  }
  libraryPath(name) {
    return native().invoke('library:path', name);
  }
  async libraryThumb(name) {
    this.thumbs ||= new Map();
    if (this.thumbs.has(name)) return this.thumbs.get(name);
    const job = (async () => {
      const gltf = await this.load(await this.libraryPath(name));
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(3, 5, 4);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f6c, 2.2), sun);
      scene.add(gltf.scene);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(0.1, box.getSize(new THREE.Vector3()).length() / 2);
      const cam = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100);
      cam.position.copy(c).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(r * 3.2));
      cam.lookAt(c);
      const R = (this.thumbRenderer ||= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }));
      R.setSize(128, 128, false);
      R.outputColorSpace = THREE.SRGBColorSpace;
      R.render(scene, cam);
      return R.domElement.toDataURL('image/png');
    })();
    this.thumbs.set(name, job);
    return job;
  }

  // ---------------------------------------------------------------- Phase 15
  compressGlb(path, method, out) {
    return native().invoke('glb:compress', path, method, out);
  }
  // ---------------------------------------------------------------- Phase 22: OGC services, map services, GeoPackage
  /** An image file's pixels: { width, height, rgba } (elevation tiles packed in RGB). */
  async imageRgba(bytes) {
    const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    g.drawImage(bmp, 0, 0);
    return { width: bmp.width, height: bmp.height, rgba: g.getImageData(0, 0, bmp.width, bmp.height).data };
  }
  ogcGet(url, opts = {}) {
    return native().invoke('ogc:get', url, opts);
  }
  ogcCache(args) {
    return native().invoke('ogc:cache', args);
  }
  ogcCacheInfo() {
    return native().invoke('ogc:cache-info');
  }
  ogcCacheClear() {
    return native().invoke('ogc:cache-clear');
  }
  ogcCacheLimit(mb) {
    return native().invoke('ogc:cache-limit', mb);
  }
  mapServices(args) {
    return native().invoke('map:services', args);
  }
  gpkgWrite(path, payload) {
    return native().invoke('gpkg:write', path, payload);
  }
  gpkgRead(path) {
    return native().invoke('gpkg:read', path);
  }
  netJson(url) {
    return native().invoke('net:json', url);
  }
  netDownload(files) {
    return native().invoke('net:download', files);
  }
  generateMesh(req) {
    return native().invoke('mesh:generate', req);
  }
  detectModels() {
    return native().invoke('ai:detect');
  }
  /** Local AI setup (#224): one call per step. */
  aiSetup(step, arg) {
    return native().invoke({ status: 'ai:setup-status', start: 'ai:ollama-start', install: 'ai:ollama-install', pull: 'ai:ollama-pull', download: 'ai:builtin-download', delete: 'ai:builtin-delete', cancel: 'ai:ollama-pull-cancel' }[step], arg);
  }
  /** Copilot feedback (#232): save | list | share | export. */
  feedback(step, ...args) {
    return native().invoke(`feedback:${step}`, ...args);
  }
  transcribe(input, lang) {
    return native().invoke('voice:transcribe', input, lang);
  }
  settings() {
    return this.app.settings;
  }
  async setSettings(patch) {
    this.app.settings = await native().invoke('settings:set', patch);
    this.app.applySettings?.();
    return this.app.settings;
  }
  autosaves() {
    return native().invoke('autosave:list');
  }
  readAutosave(name) {
    return native().invoke('autosave:read', name);
  }
  /** The web viewer's parts (#105): the model as GLB (with its animation) and three.js's own module sources. */
  async webViewerParts() {
    const bytes = new Uint8Array(await this.toGLTF(true, false));
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const src = async (p) => (await fetch(new URL(`../../node_modules/three/${p}`, import.meta.url))).text();
    const [three, core, gltf, utils, skel, orbit] = await Promise.all(['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/controls/OrbitControls.js'].map(src));
    return { glb64: btoa(s), three, core, addons: { 'GLTFLoader.js': gltf, 'BufferGeometryUtils.js': utils, 'SkeletonUtils.js': skel, 'OrbitControls.js': orbit } };
  }

  /** A picture from the image model in AI settings (main process: keys stay there). → { b64 } PNG. */
  aiImage(req) {
    return native().invoke('ai:image', req);
  }

  /** Write a binary file (PDF sheets). */
  async writeBinary(path, bytes) {
    await native().invoke('file:write', path, bytes);
    this.app.ui.toast(`Wrote ${base(path)}`);
    return path;
  }

  /** Frame-by-frame render of the timeline (render.js). Asks for a path when none is given. */
  async renderVideo(opts = {}) {
    const path = opts.path || (await this.pick('video', true, `${(this.app.file ? base(this.app.file) : 'Reel.glb').replace(/\.\w+$/, '')}.mp4`));
    if (!path) return { cancelled: true };
    this.app.ui.toast('Rendering… (the view pauses until it is done)');
    const r = await renderVideo(this.app, { ...opts, path }, (p, data) => native().invoke('file:write', p, data));
    this.app.ui.toast(`Rendered ${r.frames} frames to ${base(r.exported)}`);
    return r;
  }
}
