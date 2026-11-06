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
import * as G from '../core/geometry.js';
import * as D from '../core/document.js';
import * as A from '../core/animation.js';
import { buildModel } from './viewport.js';

const D2R = Math.PI / 180;
const native = () => window.native;
const base = (p) => p.split(/[\\/]/).pop();
const FILTERS = {
  glb: [{ name: 'GLB 3D model', extensions: ['glb'] }],
  gltf: [{ name: 'glTF (JSON)', extensions: ['gltf'] }],
  obj: [{ name: 'Wavefront OBJ', extensions: ['obj'] }],
  stl: [{ name: 'STL (3D printing)', extensions: ['stl'] }],
  png: [{ name: 'PNG image', extensions: ['png'] }],
  video: [{ name: 'MP4 video', extensions: ['mp4'] }, { name: 'WebM video', extensions: ['webm'] }],
  models: [{ name: '3D models', extensions: ['glb', 'gltf', 'obj', 'stl', 'fbx'] }],
};

export class IO {
  constructor(app) {
    this.app = app;
  }

  async pick(kind, save, suggested) {
    return save
      ? native().invoke('file:save-dialog', { defaultPath: suggested, filters: FILTERS[kind] })
      : native().invoke('file:open-dialog', { filters: FILTERS[kind] });
  }

  /** Export scene + baked animation clip. withDoc keeps the editable document inside (our save format). */
  async toGLTF(binary, withDoc) {
    const doc = this.app.store.doc;
    const { root, objs } = buildModel(doc, { edges: false });
    const scene = new THREE.Scene();
    scene.name = 'MyModellerReel';
    scene.add(root);
    if (withDoc) scene.userData.mymodellerreel = JSON.stringify(doc);
    const animations = this.clips(doc, objs, scene);
    return new GLTFExporter().parseAsync(scene, { binary, animations, onlyVisible: false });
  }

  /** Bake keyframes (with their easing) into linear glTF tracks at the timeline frame rate. */
  clips(doc, objs, scene) {
    const { duration, fps } = doc.animation;
    const times = Array.from({ length: Math.round(duration * fps) + 1 }, (_, i) => i / fps);
    const tracks = [];
    const targets = [...new Set(doc.animation.tracks.map((t) => t.target))];
    for (const id of targets) {
      if (id === 'camera') continue;
      const o = objs.get(id);
      const e = D.getEntity(doc, id);
      if (!o || !e) continue;
      const props = new Set(doc.animation.tracks.filter((t) => t.target === id).map((t) => t.property));
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
    if (doc.animation.tracks.some((t) => t.target === 'camera')) {
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

  async load(path) {
    const buf = await native().invoke('file:read', path);
    const ext = path.split('.').pop().toLowerCase();
    if (ext === 'glb' || ext === 'gltf') return new GLTFLoader().parseAsync(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '');
    if (ext === 'obj') return { scene: new OBJLoader().parse(new TextDecoder().decode(buf)) };
    if (ext === 'stl') return { scene: new THREE.Mesh(new STLLoader().parse(buf), new THREE.MeshStandardMaterial({ color: D.DEFAULT_COLOR })) };
    if (ext === 'fbx') return { scene: new FBXLoader().parse(buf, '') };
    throw new Error(`Cannot read .${ext} files.`);
  }

  async open(path) {
    path ||= await this.pick('models', false);
    if (!path) return { cancelled: true };
    const gltf = await this.load(path);
    const raw = gltf.scene?.userData?.mymodellerreel;
    if (raw) {
      this.app.store.replace(JSON.parse(raw));
      this.app.afterOpen(path);
      return { opened: path, entities: this.app.store.doc.entities.length, editable: true };
    }
    this.app.store.replace(D.newDoc());
    const r = this.insert(gltf.scene, base(path));
    this.app.afterOpen(path.replace(/\.\w+$/, '.glb'));
    return { opened: path, ...r, editable: 'imported as shapes' };
  }

  async importModel(path) {
    path ||= await this.pick('models', false);
    if (!path) return { cancelled: true };
    const gltf = await this.load(path);
    this.app.store.checkpoint();
    const r = this.insert(gltf.scene, base(path));
    this.app.store.changed();
    this.app.reg.run('zoom_extents', { ids: [r.group] });
    return r;
  }

  /** Convert any three.js object tree into editable shapes inside one group (world transforms baked in). */
  insert(object, name) {
    const doc = this.app.store.doc;
    object.updateMatrixWorld(true);
    const group = D.addEntity(doc, { type: 'group', name: name.replace(/\.\w+$/, '') });
    let count = 0;
    object.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      const raw = G.fromTriangles(g.attributes.position.array);
      if (!raw.f.length) return;
      const { mesh, origin } = G.recenter(raw);
      const m = [].concat(o.material)[0] || {};
      D.addEntity(doc, {
        name: o.name || `Part ${++count}`,
        parent: group.id,
        mesh,
        position: D.round3(origin),
        material: { color: m.color ? `#${m.color.getHexString()}` : D.DEFAULT_COLOR, opacity: m.opacity ?? 1, metalness: m.metalness ?? 0, roughness: m.roughness ?? 0.85 },
      });
      count++;
    });
    return { group: group.id, parts: count };
  }

  async exportAs(format, path) {
    const name = (this.app.file ? base(this.app.file) : 'Untitled.glb').replace(/\.\w+$/, '');
    if (format === 'video') return this.exportVideo(path);
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
    } else if (format === 'png') {
      const url = await this.app.viewport.screenshot({ width: 3840 });
      data = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0)).buffer;
    } else throw new Error(`Unknown format ${format}`);
    await native().invoke('file:write', path, data);
    this.app.ui.toast(`Exported ${base(path)}`);
    return { exported: path };
  }

  /** Plays the timeline once in real time and records the canvas. */
  async exportVideo(path) {
    const app = this.app;
    const doc = app.store.doc;
    path ||= await this.pick('video', true, 'Reel.mp4');
    if (!path) return { cancelled: true };
    // Electron says yes to H.264 recording but writes nothing, so MP4 is VP9 in an MP4 box (plays in browsers,
    // VLC, Premiere, DaVinci; not in the old Windows "Films & TV"). shortcut: bundle ffmpeg if H.264 is a must.
    const wantMp4 = /\.mp4$/i.test(path);
    const types = wantMp4 ? ['video/mp4;codecs=vp9', 'video/webm;codecs=vp9'] : ['video/webm;codecs=vp9', 'video/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('This system cannot record video.');
    if (wantMp4 && !mime.startsWith('video/mp4')) path = path.replace(/\.mp4$/i, '.webm');
    const tl = app.timeline;
    tl.open();
    tl.pause();
    tl.seek(0);
    const stream = app.viewport.canvas.captureStream(doc.animation.fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    app.ui.toast(`Recording ${doc.animation.duration}s…`);
    rec.start(250);
    tl.recording = true;
    await new Promise((resolve) => {
      tl.onPause = resolve;
      tl.play();
    });
    tl.onPause = null;
    tl.recording = false;
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error(`The video recorder produced no data (${mime}). Try saving as .webm.`);
    await native().invoke('file:write', path, await blob.arrayBuffer());
    app.ui.toast(`Exported ${base(path)}`);
    return { exported: path, seconds: doc.animation.duration, type: mime };
  }
}
