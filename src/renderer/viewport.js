// The 3D viewport: turns the document into three.js objects, renders, picks, and shows animation poses.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as G from '../core/geometry.js';
import * as D from '../core/document.js';
import * as A from '../core/animation.js';

const D2R = Math.PI / 180;
export const AXIS_COLORS = { x: 0xd2453c, y: 0x2f6fb8, z: 0x3c9a4e }; // red, blue (up), green
const EDGE_COLOR = 0x1d262c;

export function meshGeometry(mesh) {
  const b = G.toBuffers(mesh);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
  g.userData.triFace = b.triFace;
  return g;
}

export function makeMaterial(m, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: m.color,
    roughness: m.roughness ?? 0.85,
    metalness: m.metalness ?? 0,
    emissive: m.emissive || '#000000',
    side: THREE.DoubleSide,
    transparent: m.opacity < 1 || !!opts.xray,
    opacity: opts.xray ? Math.min(m.opacity, 0.45) : m.opacity,
    depthWrite: !(opts.xray || m.opacity < 1),
    polygonOffset: true,
    polygonOffsetFactor: opts.flat ? -2 : 1, // lone faces win over the face they were drawn on; edges win over faces
    polygonOffsetUnits: opts.flat ? -2 : 1,
  });
  return mat;
}

export function applyTransform(obj, e) {
  obj.position.fromArray(e.position);
  obj.rotation.set(e.rotation[0] * D2R, e.rotation[1] * D2R, e.rotation[2] * D2R);
  obj.scale.fromArray(e.scale);
}

/** Build the object tree for a document. Used by the viewport and by exporters (edges: false). */
export function buildModel(doc, { edges = true, xray = false, wireframe = false, clipping = [] } = {}) {
  const root = new THREE.Group();
  root.name = 'Model';
  const objs = new Map();
  const tagVisible = new Map(doc.tags.map((t) => [t.name, t.visible]));
  for (const e of doc.entities) {
    let o;
    if (e.mesh) {
      o = new THREE.Mesh(meshGeometry(e.mesh), makeMaterial(e.material, { xray, flat: e.mesh.f.length === 1 }));
      o.material.clippingPlanes = clipping;
      o.castShadow = o.receiveShadow = true;
      if (wireframe) o.material.visible = false;
      if (edges || wireframe) {
        const lines = new THREE.LineSegments(
          featureEdges(o.geometry),
          new THREE.LineBasicMaterial({ color: EDGE_COLOR, clippingPlanes: clipping }),
        );
        lines.raycast = () => {};
        lines.userData.isEdges = true;
        o.add(lines);
      }
    } else o = new THREE.Group();
    o.name = e.name;
    o.userData.entityId = e.id;
    applyTransform(o, e);
    o.visible = e.visible && tagVisible.get(e.tag) !== false;
    objs.set(e.id, o);
  }
  for (const e of doc.entities) (e.parent && objs.get(e.parent) ? objs.get(e.parent) : root).add(objs.get(e.id));
  return { root, objs };
}

export /**
 * Crease and outline edges only. Booleans leave T-junctions, so a seam between two coplanar triangles can look
 * like a boundary; an edge is dropped when there is coplanar surface on both of its sides.
 */
function featureEdges(geo) {
  const eg = new THREE.EdgesGeometry(geo, 25);
  const tris = geo.attributes.position.count / 3;
  if (tris > 4000) return eg; // shortcut: skip the cleanup on big imports; move it to a worker if those matter
  const p = geo.attributes.position;
  const T = [];
  for (let i = 0; i < tris; i++) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i * 3);
    const b = new THREE.Vector3().fromBufferAttribute(p, i * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i * 3 + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-14) continue;
    T.push({ tri: new THREE.Triangle(a, b, c), n: n.normalize(), d: n.dot(a) });
  }
  const covered = (q, n) => T.some((t) => Math.abs(t.n.dot(n)) > 0.9999 && Math.abs(t.n.dot(q) - t.d) < 1e-4 && t.tri.containsPoint(q));
  const e = eg.attributes.position;
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < e.count; i += 2) {
    a.fromBufferAttribute(e, i);
    b.fromBufferAttribute(e, i + 1);
    const m = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    // the faces that own this edge: any triangle that contains the midpoint
    const owners = T.filter((t) => Math.abs(t.n.dot(m) - t.d) < 1e-4 && t.tri.closestPointToPoint(m, new THREE.Vector3()).distanceToSquared(m) < 1e-10);
    const interior = owners.length && owners.every((t) => {
      const side = t.n.clone().cross(dir).multiplyScalar(1e-3);
      return covered(m.clone().add(side), t.n) && covered(m.clone().sub(side), t.n);
    });
    if (!interior) keep.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  eg.dispose();
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
}

export function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Viewport {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.store = store;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture('#cfe1e6', '#f4efe6');
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => (this.dirty = true));

    this.hemi = new THREE.HemisphereLight(0xeef4f6, 0x8a7f6c, 1.6);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.18 }));
    this.ground.receiveShadow = true;
    this.ground.position.y = -0.001;
    this.grid = new THREE.GridHelper(100, 100, 0xb9b2a3, 0xd9d2c4);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.grid.position.y = -0.002;
    this.axes = new THREE.Group();
    for (const [k, dir] of Object.entries({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] })) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...dir).multiplyScalar(60)]);
      this.axes.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: AXIS_COLORS[k] })));
      const neg = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...dir).multiplyScalar(-60)]),
        new THREE.LineDashedMaterial({ color: AXIS_COLORS[k], dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.6 }),
      );
      neg.computeLineDistances();
      this.axes.add(neg);
    }
    this.scene.add(this.ground, this.grid, this.axes);

    this.modelRoot = new THREE.Group();
    this.overlay = new THREE.Group();
    this.scene.add(this.modelRoot, this.overlay);
    this.objs = new Map();
    this.selection = [];
    this.pose = null; // animation overrides currently shown
    this.raycaster = new THREE.Raycaster();
    this.listeners = new Set();

    this.setCamera(store.doc.camera);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.dirty) this.render();
    };
    loop();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  render() {
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    for (const fn of this.listeners) fn();
  }

  /** Rebuild everything from the document. shortcut: full rebuild per change; fine to a few thousand entities. */
  rebuild() {
    const doc = this.store.doc;
    const s = doc.settings;
    this.clipping = s.section ? [new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...s.section.normal).negate(), new THREE.Vector3(...s.section.point))] : [];
    for (const o of this.modelRoot.children) disposeTree(o);
    this.modelRoot.clear();
    const { root, objs } = buildModel(doc, { edges: s.edges, xray: s.xray, wireframe: s.wireframe, clipping: this.clipping });
    if (root.children.length) this.modelRoot.add(...root.children);
    this.objs = objs;
    this.grid.visible = this.axes.visible = s.grid;
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.castShadow = s.shadows;
    this.ground.visible = s.shadows;
    this.updateSun();
    this.vertexCache = null;
    if (this.pose) this.applyPose(this.pose, false);
    this.highlight(this.selection);
    this.dirty = true;
  }

  updateSun() {
    const { azimuth, elevation } = this.store.doc.settings.sun;
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const size = box.isEmpty() ? 10 : Math.max(10, box.getSize(new THREE.Vector3()).length());
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const az = azimuth * D2R;
    const el = elevation * D2R;
    this.sun.position.set(c.x + Math.sin(az) * Math.cos(el) * size * 2, c.y + Math.sin(el) * size * 2, c.z - Math.cos(az) * Math.cos(el) * size * 2);
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -size;
    cam.right = cam.top = size;
    cam.near = 0.1;
    cam.far = size * 5;
    cam.updateProjectionMatrix();
  }

  /** Show the model as it is at an animation time: transforms, visibility, opacity, colour, camera. */
  applyPose(pose, moveCamera = true) {
    this.pose = pose;
    const doc = this.store.doc;
    for (const e of doc.entities) {
      const o = this.objs.get(e.id);
      if (!o) continue;
      const p = pose?.[e.id] || {};
      o.position.fromArray(p.position || e.position);
      const r = p.rotation || e.rotation;
      o.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
      o.scale.fromArray(p.scale || e.scale);
      const tagOn = doc.tags.find((t) => t.name === e.tag)?.visible !== false;
      o.visible = (p.visible ?? e.visible) && tagOn;
      if (o.isMesh) {
        const op = p.opacity ?? e.material.opacity;
        o.material.opacity = doc.settings.xray ? Math.min(op, 0.45) : op;
        o.material.transparent = op < 1 || doc.settings.xray;
        o.material.depthWrite = !o.material.transparent;
        o.material.color.set(p.color || e.material.color);
        for (const c of o.children) if (c.userData.isEdges) c.material.opacity = op, (c.material.transparent = op < 1);
      }
    }
    const cam = pose?.camera;
    if (moveCamera && cam) this.setCamera({ position: cam.position, target: cam.target, fov: cam.fov });
    this.dirty = true;
  }

  highlight(ids) {
    this.selection = ids;
    const doc = this.store.doc;
    const lit = new Set();
    for (const id of ids) for (const d of [id, ...D.descendants(doc, id).map((x) => x.id)]) lit.add(d);
    for (const [id, o] of this.objs) {
      if (!o.isMesh) continue;
      const on = lit.has(id);
      o.material.emissive.set(on ? '#2f6f86' : doc.entities.find((e) => e.id === id)?.material.emissive || '#000000');
      o.material.emissiveIntensity = on ? 0.35 : 1;
      for (const c of o.children) if (c.userData.isEdges) c.material.color.set(on ? '#2f6f86' : EDGE_COLOR);
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- camera
  getCamera() {
    return {
      position: D.round3(this.camera.position.toArray()),
      target: D.round3(this.controls.target.toArray()),
      fov: this.camera.fov,
    };
  }
  setCamera({ position, target, fov }) {
    if (position) this.camera.position.fromArray(position);
    if (target) this.controls.target.fromArray(target);
    if (fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.dirty = true;
  }
  modelBox(ids = null) {
    const box = new THREE.Box3();
    const list = ids ? ids.map((id) => this.objs.get(id)).filter(Boolean) : this.modelRoot.children;
    for (const o of list) box.expandByObject(o);
    return box;
  }
  zoomExtents(ids = null, dir = null) {
    const box = this.modelBox(ids);
    if (box.isEmpty()) box.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2, 3));
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getBoundingSphere(new THREE.Sphere()).radius;
    const d = dir || this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = r / Math.sin((this.camera.fov * D2R) / 2) * 1.05;
    this.setCamera({ position: c.clone().add(d.multiplyScalar(dist)).toArray(), target: c.toArray() });
  }
  setView(preset) {
    const dirs = { top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], iso: [1, 0.8, 1] };
    this.zoomExtents(null, new THREE.Vector3(...(dirs[preset] || dirs.iso)).normalize());
  }

  // ---------------------------------------------------------------- picking & projection
  ndc(ev) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  ray(ev) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    return this.raycaster.ray;
  }
  /** First visible face under the mouse: { entityId, faceIndex, point, normal } in world space. */
  pick(ev) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const meshes = [];
    this.modelRoot.traverseVisible((o) => o.isMesh && o.material.visible !== false && meshes.push(o));
    const hits = this.raycaster.intersectObjects(meshes, false).filter((h) => !this.clipping?.some((p) => p.distanceToPoint(h.point) < 0));
    const h = hits[0];
    if (!h) return null;
    const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate(); // back side of a lone face
    return { entityId: h.object.userData.entityId, faceIndex: h.object.geometry.userData.triFace[h.faceIndex], point: h.point.clone(), normal, object: h.object };
  }
  toScreen(p) {
    const v = p.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width + r.left, y: ((1 - v.y) / 2) * r.height + r.top, behind: v.z > 1 };
  }
  /** World-space vertices and edge midpoints of visible shapes, for inference snapping. */
  snapPoints() {
    if (this.vertexCache) return this.vertexCache;
    const pts = [];
    this.modelRoot.updateMatrixWorld(true);
    for (const [id, o] of this.objs) {
      const e = this.store.doc.entities.find((x) => x.id === id);
      if (!e?.mesh || !o.visible || e.mesh.v.length > 5000) continue;
      const w = e.mesh.v.map((p) => new THREE.Vector3(...p).applyMatrix4(o.matrixWorld));
      for (const p of w) pts.push({ p, kind: 'Endpoint' });
      for (const f of e.mesh.f) for (let k = 0; k < f.length; k++) pts.push({ p: w[f[k]].clone().lerp(w[f[(k + 1) % f.length]], 0.5), kind: 'Midpoint' });
    }
    return (this.vertexCache = pts);
  }

  async screenshot({ width = 1024 } = {}) {
    this.render();
    const src = this.canvas;
    const w = Math.min(width, src.width);
    const h = Math.round((src.height / src.width) * w);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/png');
  }
}

export function disposeTree(o) {
  o.traverse((x) => {
    x.geometry?.dispose();
    if (x.material) [].concat(x.material).forEach((m) => m.dispose());
  });
}
