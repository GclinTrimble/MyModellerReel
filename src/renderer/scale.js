// Scale and input in the view (#67, #69, #102, #111, #149): point clouds, snapping to PDF drawings without
// extracting them, the on-canvas transform gizmo, walking at eye height, draw statistics and faster picking.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import * as Assets from '../core/assets.js';
import * as PDF from '../core/pdf.js';
import * as DW from '../core/drawings.js';
import * as CS from '../core/cloudstyle.js';
import * as CSel from '../core/cloudselect.js';
import { styleCloud, shown } from './cloudmaterial.js';

// picking through a bounding volume tree (#111): big imports stay quick to click on
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
/** A tree for a geometry worth it (thousands of triangles); called as geometries are made. */
export function bvh(g) {
  if (!g.boundsTree && g.attributes.position?.count > 6000) g.computeBoundsTree();
  return g;
}

// ---------------------------------------------------------------- point clouds

const clouds = new Map();
/** A point cloud entity as THREE.Points (positions, colours and attributes from its asset), shared per asset. */
export function cloudObject(e) {
  const pc = e.pointcloud;
  const key = `${pc.asset}|${pc.layout || 1}`;
  let g = clouds.get(key);
  if (!g) {
    const bytes = Assets.get(pc.asset)?.bytes;
    g = new THREE.BufferGeometry();
    if (bytes) {
      const d = CS.decodePreview(pc, bytes);
      g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
      if (d.rgb) g.setAttribute('rgb', new THREE.BufferAttribute(d.rgb, 3, true));
      if (d.intensity) g.setAttribute('intensity', new THREE.BufferAttribute(d.intensity, 1));
      if (d.classification) g.setAttribute('classification', new THREE.BufferAttribute(d.classification, 1));
      if (d.returns) {
        g.setAttribute('returnNumber', new THREE.BufferAttribute(d.returns.map((r) => r & 15), 1));
        g.setAttribute('numberOfReturns', new THREE.BufferAttribute(d.returns.map((r) => r >> 4), 1));
      }
      if (d.gpsTime) g.setAttribute('gpsTime', new THREE.BufferAttribute(d.gpsTime, 1));
      if (d.pointSource) g.setAttribute('pointSource', new THREE.BufferAttribute(d.pointSource, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const s = g.boundingBox.getSize(new THREE.Vector3());
      g.userData.spacing = Math.sqrt(Math.max(s.x * s.z, 1e-6) / Math.max(1, d.count)); // average plan spacing, for adaptive size
      g.userData.cloudData = d;
      clouds.set(key, g); // a missing file may be imported again under the same asset id
    }
  }
  if (g.userData.cloudData) previewClasses(g, e);
  const o = styleCloud(new THREE.Points(g), e, g.userData.cloudData);
  o.raycast = () => {};
  return o;
}

/** The preview's classes with the cloud's class edits (#299) on its 'preview' points, redone when the edits change. */
function previewClasses(g, e) {
  const edits = e.pointcloud.edits || [];
  const key = edits.join();
  if ((g.userData.editsKey || '') === key) return;
  const d = g.userData.cloudData;
  g.userData.baseClass ||= d.classification ? d.classification.slice() : null;
  const deltas = CSel.deltasFor(edits, (x) => Assets.bytes(x));
  const { classes } = CSel.effective(g.userData.baseClass, d.count, deltas, 'preview');
  if (!g.attributes.classification) g.setAttribute('classification', new THREE.BufferAttribute(classes, 1));
  else g.attributes.classification.array.set(classes), (g.attributes.classification.needsUpdate = true);
  d.classification = g.attributes.classification.array;
  g.userData.editsKey = key;
}

/** The point selection's preview points highlighted on a preview cloud object. */
export function highlightPreview(o, s) {
  const g = o.geometry;
  const sel = s?.id === o.userData.cloudEntity?.id ? s.sel.nodes.get('preview') : null;
  if (!sel && !g.attributes.selected) return;
  const a = g.attributes.selected || g.setAttribute('selected', new THREE.BufferAttribute(new Uint8Array(g.attributes.position.count), 1)).attributes.selected;
  a.array.fill(0);
  if (sel) for (const i of sel.idx) a.array[i] = 1;
  a.needsUpdate = true;
}
/** Snap points from a cloud: a few thousand of the points it shows (its filter and the section), or with keep (a world-point test: the clips) up to max of those kept. */
export function cloudSnaps(o, max = 4000, keep = null) {
  const p = o.geometry?.attributes.position; // an octree group snaps near the cursor instead (cloudlod.js)
  if (!p) return [];
  const ok = shown(o);
  const v = new THREE.Vector3();
  const at = (i) => v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
  const idx = [];
  for (let i = 0; i < p.count; i += keep ? 1 : Math.max(1, Math.floor(p.count / max))) if (ok(i) && (!keep || keep(at(i)))) idx.push(i);
  const step = Math.max(1, idx.length / max);
  const out = [];
  for (let j = 0; j < idx.length; j += step) out.push({ p: at(idx[Math.floor(j)]).clone(), kind: 'Point cloud' });
  return out;
}

// ---------------------------------------------------------------- snapping to PDF drawings (#149)

const vectors = new Map();
/** Ends and middles of a PDF underlay's lines in the world, loaded once (async: null until ready). */
export function underlaySnaps(doc, e, onReady) {
  const key = `${e.id}|${e.underlay.asset}|${e.underlay.page || 0}|${JSON.stringify(e.underlay.affine)}|${e.position.join(',')}`;
  const v = vectors.get(key);
  if (v) return v === 'loading' ? null : v;
  vectors.set(key, 'loading');
  (async () => {
    const c = await PDF.content(await PDF.open(Assets.bytes(e.underlay.asset), e.underlay.asset), e.underlay.page);
    const f = DW.frame(doc, e);
    const toW = (q) => new THREE.Vector3(...f.toWorld(q));
    const out = [];
    for (const path of c.paths.slice(0, 20000)) {
      const pts = path.pts || [];
      for (let i = 0; i < pts.length; i++) {
        out.push({ p: toW(pts[i]), kind: 'Drawing end' });
        if (i) out.push({ p: toW([(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2]), kind: 'Drawing middle' });
      }
      if (out.length > 60000) break;
    }
    vectors.set(key, out);
    onReady?.();
  })().catch((err) => (console.error('underlay snaps:', err), vectors.set(key, [])));
  return null;
}

// ---------------------------------------------------------------- the gizmo (#67)

/** Drag handles on the selected shape; the change is committed as one set_transform when the drag ends. */
export class Gizmo {
  constructor(vp, commit) {
    this.vp = vp;
    this.tc = new TransformControls(vp.camera, vp.canvas);
    this.helper = this.tc.getHelper();
    vp.scene.add(this.helper);
    this.tc.addEventListener('dragging-changed', (ev) => {
      vp.controls.enabled = !ev.value;
      if (!ev.value && this.tc.object) {
        const o = this.tc.object;
        const r = [o.rotation.x, o.rotation.y, o.rotation.z].map((x) => Math.round(((x * 180) / Math.PI) * 1000) / 1000);
        commit(o.userData.entityId, { position: o.position.toArray().map((x) => Math.round(x * 10000) / 10000), rotation: r, scale: o.scale.toArray().map((x) => Math.round(x * 10000) / 10000) });
      }
    });
    this.tc.addEventListener('change', () => (vp.dirty = true));
  }
  /** Show it on one entity's object in a mode (move | rotate | scale), or hide it. */
  sync(mode, object) {
    this.tc.camera = this.vp.camera;
    if (!mode || !object) {
      if (this.tc.object) this.tc.detach();
      this.helper.visible = false;
      return;
    }
    this.tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[mode] || 'translate');
    if (this.tc.object !== object) this.tc.attach(object);
    this.helper.visible = true;
  }
  get dragging() {
    return this.tc.dragging;
  }
}

// ---------------------------------------------------------------- walking (#69)

/** Where the floor is under a point (the highest surface below it), or 0. */
export function floorAt(vp, p, from = 50) {
  const rc = new THREE.Raycaster(new THREE.Vector3(p.x, p.y + from, p.z), new THREE.Vector3(0, -1, 0));
  const meshes = [];
  vp.modelRoot.traverseVisible((o) => o.isMesh && !o.userData.underlay && !o.userData.isCurve && !o.userData.lightMarker && meshes.push(o));
  const hits = rc.intersectObjects(meshes, false).filter((h) => h.point.y <= p.y + 0.45); // a step up to 45 cm
  return hits.length ? hits[0].point.y : 0;
}
/** Is something in the way of a step from p by d (at knee and chest height)? */
export function blocked(vp, p, d, eye) {
  const meshes = [];
  vp.modelRoot.traverseVisible((o) => o.isMesh && !o.userData.underlay && !o.userData.isCurve && !o.userData.lightMarker && meshes.push(o));
  const dir = d.clone().setY(0).normalize();
  const len = d.length() + 0.25;
  for (const h of [eye - 1.1, eye - 0.4]) {
    const rc = new THREE.Raycaster(new THREE.Vector3(p.x, p.y - eye + h + 0.45, p.z), dir, 0, len);
    if (rc.intersectObjects(meshes, false).length) return true;
  }
  return false;
}
