// Streaming point cloud octrees (#294): each frame, per pane, the nodes worth drawing for that camera within one point
// budget shared by every cloud (octree.js selectNodes), loaded a few at a time (main process byte ranges, decoded in
// cloud-worker.js), kept in a least-recently-used cache, parents drawn until their children arrive. Picking and
// snapping look at the loaded points and return exact project coordinates.
import * as THREE from 'three';
import * as OT from '../core/octree.js';
import { cloudMaterial } from './cloudmaterial.js';

export const DEFAULTS = { budget: 3e6, cache_mb: 1024, while_moving: true };
const PARALLEL = 6;
const native = () => window.native;

/**
 * A node's arrays as the styles' CPU side reads a preview (cloudstyle.decodePreview: positions in the entity's axes,
 * returns packed), for filters and shown(); positions made only when a filter asks for them.
 */
function nodeData(d, count) {
  const out = { count, classification: d.classification, intensity: d.intensity, gpsTime: d.gpsTime, pointSource: d.pointSource };
  if (d.returnNumber) out.returns = d.returnNumber.map((r, i) => (r & 15) | ((d.numberOfReturns[i] & 15) << 4));
  let pos = null;
  Object.defineProperty(out, 'position', { get: () => (pos ||= d.position.map((v, i) => v + d.origin[i % 3])) });
  return out;
}

/** File coordinates (x east, y north, z up) → model axes about the base point, as a matrix. */
function fileToModel(base) {
  return new THREE.Matrix4().set(1, 0, 0, -base[0], 0, 0, 1, -base[2], 0, -1, 0, base[1], 0, 0, 0, 1);
}

/** Planes that leave nodes out (#290's doc.clips): [nx, ny, nz, d], kept where n·p + d ≥ 0, in model space. */
export function clipPlanes(clips = [], all = false) {
  const on = clips.filter((c) => c.enabled !== false && !c.ids?.length && !c.layers?.length);
  const out = [];
  for (const c of on) {
    if (c.kind === 'plane' && c.normal) {
      const n = c.normal;
      out.push([-n[0], -n[1], -n[2], n[0] * c.point[0] + n[1] * c.point[1] + n[2] * c.point[2]]); // cuts its normal side away
    } else if (c.kind === 'slab' && c.normal) {
      const [n, p, h] = [c.normal, c.point, (c.thickness ?? 1) / 2];
      const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
      out.push([n[0], n[1], n[2], h - d], [-n[0], -n[1], -n[2], h + d]);
    }
  }
  // boxes keeping their inside: each leaves nodes out when they combine as 'all'; as a union only a lone one does
  const boxes = on.filter((c) => c.kind === 'box' && c.keep !== 'outside');
  for (const b of all || boxes.length === 1 ? boxes : []) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(b.rotation || [0, 0, 0]).map((x) => (x * Math.PI) / 180))).elements;
    const ax = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
    ax.forEach((a, k) => {
      const c = a[0] * b.center[0] + a[1] * b.center[1] + a[2] * b.center[2];
      const h = (b.size?.[k] ?? 10) / 2;
      out.push([-a[0], -a[1], -a[2], c + h], [a[0], a[1], a[2], h - c]);
    });
  }
  return out;
}

export class CloudLOD {
  constructor(vp) {
    this.vp = vp;
    this.clouds = new Map(); // entity id → cloud
    this.cache = new Map(); // node key → entry { cloud, node, obj, bytes, used }
    this.queue = [];
    this.active = 0;
    this.bytes = 0;
    this.frame = 0;
    this.waiters = [];
    this.stats = { points: 0, nodes: 0, loaded: 0, pending: 0, cache_mb: 0 };
    this.settings = { ...DEFAULTS };
    this.onMissing = null; // (entity) → the app offers a rebuild or to locate the folder
    this.worker = null;
    this.jobs = new Map();
    this.next = 1;
    this.lastCam = new Map();
  }

  decode(msg, transfer) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./cloud-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const j = this.jobs.get(data.id);
        this.jobs.delete(data.id);
        if (data.error) j?.reject(new Error(data.error));
        else j?.resolve(data.out);
      };
    }
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /** An octree cloud entity, drawn under group (a fresh one per rebuild; loaded nodes move over to it). */
  attach(e, group) {
    const oc = e.pointcloud.octree;
    const key = oc.kind === 'copc' ? `copc|${oc.source}` : `potree|${oc.folder}`;
    let c = this.clouds.get(e.id);
    if (c && c.key !== key) this.drop(e.id), (c = null);
    if (!c) {
      c = { id: e.id, key, kind: oc.kind || 'potree', folder: oc.folder, file: oc.kind === 'copc' ? oc.source : null, base: e.pointcloud.base || [0, 0, 0], material: null, sphere: new THREE.Sphere(), root: null, loadedNodes: new Set() };
      c.F = fileToModel(c.base);
      this.clouds.set(e.id, c);
      c.opening = this.open(c, e);
    }
    c.entity = e;
    c.group = group;
    // the styles' material (#295), with the preview's arrays for its automatic ranges; the entity read afresh
    const pv = group.children.find((o) => o.userData.preview);
    c.material ||= cloudMaterial(e, { data: pv?.geometry.userData.cloudData || null });
    c.material.userData.entity = e;
    c.material.userData.states.clear();
    group.userData.octreeCloud = e.id;
    for (const entry of this.cache.values()) if (entry.cloud === c) group.add(entry.obj), (entry.obj.userData.cloudEntity = e);
    this.previewVisibility(c);
  }

  /** Clouds no longer in the document let go of their nodes. */
  sync(ids) {
    for (const id of [...this.clouds.keys()]) if (!ids.has(id)) this.drop(id);
  }
  drop(id) {
    const c = this.clouds.get(id);
    if (!c) return;
    for (const [k, entry] of this.cache) if (entry.cloud === c) this.evict(k);
    this.clouds.delete(id);
  }
  /** Before a rebuild throws the old groups away: node objects are kept, not disposed with them. */
  detach() {
    for (const entry of this.cache.values()) entry.obj.removeFromParent();
  }

  async open(c, e) {
    try {
      const r = await native().invoke('cloud:open', c.kind === 'copc' ? { file: c.file } : { folder: c.folder });
      if (r.missing) {
        c.missing = true;
        this.onMissing?.(e);
        return;
      }
      c.root = r.root;
      if (r.kind === 'copc') {
        Object.assign(c, { header: r.header, scale: r.header.scale, offset: r.header.origin, rootSpacing: r.info.spacing, timeBase: r.info.gpsTime[0] || 0 });
      } else {
        const m = r.metadata;
        Object.assign(c, { layout: OT.layoutFromMetadata(m), scale: m.scale, offset: m.offset, rootSpacing: m.spacing, timeBase: m.attributes.find((a) => a.name === 'gps-time')?.min?.[0] || 0 });
      }
      this.vp.dirty = true;
    } catch (err) {
      console.error('point cloud octree:', err);
      c.missing = true;
    }
  }

  /**
   * What a slice (#292) reads at full depth: { root, base, read(node) → Float64Array of file coordinates }, nodes in the
   * cache reused, others read and decoded like the streamed ones (not kept). null: no octree open for that entity.
   */
  async source(e) {
    const c = this.clouds.get(e.id);
    await c?.opening;
    if (!c?.root || c.missing) return null;
    // classes (#300): only the points of those ASPRS classes
    const read = async (node, classes = null) => {
      const hit = this.cache.get(this.keyOf(c, node));
      let exact = hit?.obj.userData.exact;
      let cls = hit?.obj.geometry.getAttribute('classification')?.array;
      if (!hit) {
        const bytes = await native().invoke('cloud:read-node', { folder: c.folder, file: c.file, byteOffset: node.byteOffset, byteSize: node.byteSize });
        const d = await this.decode({ kind: c.kind, bytes, layout: c.layout, header: c.header, scale: c.scale, offset: c.offset, count: node.numPoints, min: node.box.min, base: c.base, timeBase: c.timeBase }, [bytes]);
        (exact = d.exact), (cls = d.classification);
      }
      if (!Array.isArray(classes) || !cls) return exact; // (map passes an index as the second argument)
      const keep = new Set(classes);
      const out = [];
      for (let i = 0; i < cls.length; i++) if (keep.has(cls[i])) out.push(exact[i * 3], exact[i * 3 + 1], exact[i * 3 + 2]);
      return Float64Array.from(out);
    };
    return { root: c.root, base: c.base, read };
  }

  previewVisibility(c) {
    const pv = c.group?.children.find((o) => o.userData.preview);
    if (pv) pv.visible = !c.root || !c.loadedNodes.has(c.root.name);
  }

  /** Pick the nodes for this pane's camera, show them, ask for the missing ones. */
  update(camera, width, height, extraClips = []) {
    this.frame++;
    if (!this.clouds.size) return;
    const list = [];
    for (const c of this.clouds.values()) {
      if (!c.root || !c.group?.parent) continue;
      let seen = true;
      c.group.traverseAncestors((a) => (seen &&= a.visible));
      if (!c.group.visible || !seen) continue;
      c.group.updateWorldMatrix(true, false);
      const m = c.group.matrixWorld.clone().multiply(c.F);
      // the whole cloud's sphere in the world: depth colour and fog fit it (cloudmaterial.js reads userData.cloudSphere)
      const b = c.root.box;
      c.sphere.setFromPoints([new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)].map((v) => v.applyMatrix4(m)));
      list.push({ id: c.id, cloud: c, root: c.root, matrix: m.elements, rootSpacing: c.rootSpacing, scale: m.getMaxScaleOnAxis(), loaded: (n) => c.loadedNodes.has(n.name) });
    }
    camera.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cam = { position: camera.getWorldPosition(new THREE.Vector3()).toArray(), planes: fr.planes.map((p) => [p.normal.x, p.normal.y, p.normal.z, p.constant]) };
    if (camera.isOrthographicCamera) cam.ortho = (height * camera.zoom) / (camera.top - camera.bottom);
    else cam.projFactor = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    // fewer points while the camera moves, then refine once it stops
    const sig = camera.matrixWorld.elements.join(',') + camera.projectionMatrix.elements[0];
    const moving = this.lastCam.get(camera) !== undefined && this.lastCam.get(camera) !== sig;
    this.lastCam.set(camera, sig);
    if (moving) {
      clearTimeout(this.still);
      this.still = setTimeout(() => (this.vp.dirty = true), 180);
    }
    const budget = this.settings.budget * (moving && this.settings.while_moving ? 0.35 : 1);
    const sel = OT.selectNodes(list, cam, { budget, minSpacing: 1, clips: extraClips });
    for (const entry of this.cache.values()) entry.obj.visible = false;
    for (const { cloud, node } of sel.visible) {
      const entry = this.cache.get(`${cloud.cloud.key}|${cloud.id}|${node.name}`);
      if (entry) (entry.obj.visible = true), (entry.used = this.frame);
    }
    for (const c of this.clouds.values()) this.previewVisibility(c);
    this.queue = sel.load.filter((l) => !this.cache.has(this.keyOf(l.cloud.cloud, l.node)) && !l.cloud.cloud.loading?.has(l.node.name)).map((l) => ({ c: l.cloud.cloud, node: l.node, priority: l.priority }));
    this.stats = { points: sel.visible.reduce((s, v) => s + v.node.numPoints, 0), nodes: sel.visible.length, loaded: this.cache.size, pending: this.queue.length + this.active, cache_mb: Math.round(this.bytes / 1e6) };
    this.pump();
  }

  keyOf(c, node) {
    return `${c.key}|${c.id}|${node.name}`;
  }

  pump() {
    while (this.active < PARALLEL && this.queue.length) {
      const { c, node } = this.queue.shift();
      (c.loading ||= new Set()).add(node.name);
      this.active++;
      this.load(c, node)
        .catch((err) => console.error('point cloud node:', err))
        .finally(() => {
          c.loading.delete(node.name);
          this.active--;
          this.vp.dirty = true;
          if (!this.active && !this.queue.length) this.waiters.splice(0).forEach((w) => w());
          this.pump();
        });
    }
  }

  async load(c, node) {
    if (!(node.numPoints > 0) || !(node.byteSize > 0)) {
      c.loadedNodes.add(node.name); // an empty node holds up its children: nothing to draw
      return;
    }
    const bytes = await native().invoke('cloud:read-node', { folder: c.folder, file: c.file, byteOffset: node.byteOffset, byteSize: node.byteSize });
    if (!this.clouds.has(c.id)) return;
    const d = await this.decode({ kind: c.kind, bytes, layout: c.layout, header: c.header, scale: c.scale, offset: c.offset, count: node.numPoints, min: node.box.min, base: c.base, timeBase: c.timeBase }, [bytes]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    if (d.rgb) {
      const rgb = new THREE.BufferAttribute(d.rgb, 3, true);
      g.setAttribute('rgb', rgb);
    }
    for (const [k, T] of [['intensity'], ['classification'], ['returnNumber'], ['numberOfReturns'], ['gpsTime'], ['pointSource']]) if (d[k]) g.setAttribute(k, new THREE.BufferAttribute(d[k], 1, T));
    // the node's own box, in its local axes: no bounding computations
    const b = node.box;
    const size = [b.max[0] - b.min[0], b.max[2] - b.min[2], b.max[1] - b.min[1]];
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, -size[2]), new THREE.Vector3(size[0], size[1], 0));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const obj = new THREE.Points(g, c.material);
    obj.position.fromArray(d.origin);
    obj.raycast = () => {};
    obj.userData.cloudNode = node.name;
    obj.userData.exact = d.exact;
    obj.userData.gps = d.gpsExact || null;
    // what the styles read (#295): the node's spacing for adaptive size, the cloud's sphere, the arrays for filters
    Object.assign(obj.userData, { pointcloud: true, cloudEntity: c.entity, spacing: c.rootSpacing / 2 ** node.level, cloudSphere: c.sphere });
    g.userData.cloudData = nodeData(d, node.numPoints);
    obj.visible = false;
    c.group?.add(obj);
    const used = Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) / (d.rgb ? 2 : 1) + d.exact.byteLength;
    this.cache.set(this.keyOf(c, node), { cloud: c, node, obj, bytes: used, used: this.frame });
    this.bytes += used;
    c.loadedNodes.add(node.name);
    this.trim();
  }

  evict(key) {
    const entry = this.cache.get(key);
    if (!entry) return;
    entry.obj.removeFromParent();
    entry.obj.geometry.dispose();
    entry.cloud.loadedNodes.delete(entry.node.name);
    this.bytes -= entry.bytes;
    this.cache.delete(key);
  }
  /** Least recently drawn first, never what this frame draws nor a root. */
  trim() {
    const limit = this.settings.cache_mb * 1e6;
    if (this.bytes <= limit) return;
    const old = [...this.cache.entries()].filter(([, e]) => e.used < this.frame && e.node.level > 0).sort((a, b) => a[1].used - b[1].used || b[1].node.level - a[1].node.level);
    for (const [k] of old) {
      if (this.bytes <= limit) break;
      this.evict(k);
    }
  }

  setSettings(s = {}) {
    this.settings = { ...DEFAULTS, ...s };
    this.trim();
    this.vp.dirty = true;
  }

  busy() {
    return this.active > 0 || this.queue.length > 0;
  }
  /**
   * Draw until every node the frame wants is loaded (renders and screenshots wait for it), or the timeout.
   * redraw() draws a frame (which picks the nodes and asks for the missing ones).
   */
  async settle(redraw, timeout = 8000) {
    const end = performance.now() + timeout;
    redraw();
    while ((this.busy() || [...this.clouds.values()].some((c) => !c.root && !c.missing)) && performance.now() < end) {
      await Promise.race([new Promise((r) => this.waiters.push(r)), new Promise((r) => setTimeout(r, 100))]);
      redraw();
    }
  }

  /**
   * The loaded point nearest a ray within px pixels on screen: { point (world Vector3, from the exact coordinates),
   * project: [e, n, z] doubles, entity, attributes }. pixelOf(worldDistanceAtDepth, depth) → pixels.
   */
  nearest(ray, camera, height, px = 6, keep = null) {
    let best = null;
    const persp = !camera.isOrthographicCamera;
    const k = persp ? height / (2 * Math.tan((camera.fov * Math.PI) / 360)) : (height * camera.zoom) / (camera.top - camera.bottom);
    const inv = new THREE.Matrix4();
    const local = new THREE.Ray();
    const tmp = new THREE.Vector3();
    for (const entry of this.cache.values()) {
      const o = entry.obj;
      if (!o.visible || !o.parent) continue;
      inv.copy(o.matrixWorld).invert();
      local.copy(ray).applyMatrix4(inv);
      const scale = o.matrixWorld.getMaxScaleOnAxis();
      // the node's box, grown by the tolerance at its distance
      const dist = Math.max(0.01, o.getWorldPosition(tmp).distanceTo(ray.origin));
      const tol = persp ? (px * dist) / k / scale : px / k / scale;
      const box = o.geometry.boundingBox.clone().expandByScalar(tol * 3);
      if (!local.intersectsBox(box)) continue;
      const p = o.geometry.attributes.position.array;
      const ox = local.origin.x;
      const oy = local.origin.y;
      const oz = local.origin.z;
      const { x: dx, y: dy, z: dz } = local.direction;
      for (let i = 0; i < p.length; i += 3) {
        const vx = p[i] - ox;
        const vy = p[i + 1] - oy;
        const vz = p[i + 2] - oz;
        const t = vx * dx + vy * dy + vz * dz;
        if (t <= 0) continue;
        const perp = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - t * t)) * scale;
        const onScreen = persp ? (perp * k) / (t * scale) : perp * k;
        if (onScreen <= px && (!best || onScreen < best.px - 0.5 || (Math.abs(onScreen - best.px) <= 0.5 && t * scale < best.t))) {
          if (keep && !keep(tmp.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(o.matrixWorld), entry.cloud.entity)) continue; // clipped away
          best = { px: onScreen, t: t * scale, entry, i: i / 3 };
        }
      }
    }
    if (!best) return null;
    const { entry, i } = best;
    const c = entry.cloud;
    const ex = entry.obj.userData.exact;
    const project = [ex[i * 3], ex[i * 3 + 1], ex[i * 3 + 2]];
    // the exact point in the world: file → model in doubles, then the entity's placement
    const point = new THREE.Vector3(project[0] - c.base[0], project[2] - c.base[2], -(project[1] - c.base[1])).applyMatrix4(c.group.matrixWorld);
    const g = entry.obj.geometry.attributes;
    const attr = (n) => (g[n] ? g[n].array[i] : undefined);
    const rgb = g.rgb ? [g.rgb.array[i * 3], g.rgb.array[i * 3 + 1], g.rgb.array[i * 3 + 2]] : undefined;
    return { point, project, entity: c.id, node: entry.node.name, px: best.px, attributes: { classification: attr('classification'), intensity: attr('intensity'), return_number: attr('returnNumber'), number_of_returns: attr('numberOfReturns'), gps_time: entry.obj.userData.gps ? entry.obj.userData.gps[i] : undefined, point_source: attr('pointSource'), rgb } };
  }
}

/**
 * The app side of conversions (#293): progress in the status bar, the preview and then the octree attached as they
 * arrive (attach_point_cloud_octree), an offer to rebuild or locate a missing octree, and the cloud statistics in a
 * corner of the view (points drawn, nodes, cache, loads pending).
 */
export function watchClouds(app) {
  const lod = app.viewport.clouds;
  lod.setSettings(app.settings?.clouds);
  const offered = new Set();
  const run = (name, args) => app.reg.run(name, args).catch((e) => app.ui.toast(e.message, 'danger'));
  const offer = (e, why) => {
    if (offered.has(e.id)) return;
    offered.add(e.id);
    const box = document.createElement('div');
    box.className = 'toast cloud-offer';
    box.setAttribute('role', 'alert');
    const close = () => box.remove();
    const button = (label, fn) => Object.assign(document.createElement('button'), { className: 'btn small', textContent: label, onclick: () => (close(), fn()) });
    box.append(`${e.name}: ${why}. The preview shows meanwhile.`, button('Rebuild', () => run('rebuild_point_cloud_octree', { id: e.id })), button('Locate folder…', async () => {
      const folder = await window.native.invoke('file:folder-dialog', { title: `The octree folder of ${e.name}` });
      if (folder) run('attach_point_cloud_octree', { id: e.id, folder });
    }), button('Not now', () => {}));
    document.getElementById('toasts')?.append(box);
    setTimeout(close, 30000);
  };
  lod.onMissing = (e) => offer(e, 'its octree folder is missing');
  const overlay = document.createElement('div');
  overlay.className = 'cloud-stats';
  overlay.hidden = true;
  document.querySelector('.viewport-wrap')?.append(overlay);
  let busy = false;
  let ticking = false;
  setInterval(async () => {
    const s = lod.stats;
    overlay.hidden = !lod.clouds.size;
    if (lod.clouds.size) overlay.textContent = `${(s.points / 1e6).toFixed(2)} M points · ${s.nodes} nodes · ${s.loaded} loaded · ${s.cache_mb} MB${s.pending ? ` · ${s.pending} loading` : ''}`;
    if (ticking) return;
    ticking = true;
    try {
      const building = app.store.doc.entities.filter((e) => e.pointcloud?.octree?.status === 'building');
      if (!building.length && busy) app.ui.setStatus(''), (busy = false);
      for (const e of building) {
        const oc = e.pointcloud.octree;
        const j = await window.native.invoke('cloud:job', oc.job).catch(() => null);
        if (!j) {
          offer(e, 'its conversion did not finish');
          continue;
        }
        busy = true;
        app.ui.setStatus(`${e.name}: ${j.stage} ${Math.round((j.fraction || 0) * 100)} %`);
        if ((j.hasPreview && !e.pointcloud.asset) || j.status !== 'running') {
          const r = await app.reg.run('attach_point_cloud_octree', { id: e.id }).catch((err) => ({ error: err.message }));
          if (j.status === 'done' && r.octree === 'ready') app.ui.toast(`${e.name}: ${r.points.toLocaleString()} points, streaming`);
          if (j.status === 'error') app.ui.toast(`${e.name}: ${j.error}`, 'danger');
        }
      }
    } finally {
      ticking = false;
    }
  }, 700);
}
