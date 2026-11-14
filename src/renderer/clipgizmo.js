// Clip box handles (#291): every clip volume drawn as thin edges; the selected one gets translucent faces, a handle at
// each face centre (push / pull), each edge middle (two faces) and each corner (three), and TransformControls on a
// proxy in its own axes (W move, E rotate, R scale; L local / world). A drag previews through the shader uniforms and
// commits one set_clip on release, like the entity gizmo's set_transform. Works in any pane (tools.js routes events).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as CV from '../core/clip.js';
import * as SEC from '../core/section.js';
import { fmt, parseLength } from './tools.js';

const EDGE = 0x2f6f86;
const SEL = 0xc8553d;
const V = (a) => new THREE.Vector3(...a);
const HANDLE_PX = 9;
const FIELDS = { box: ['center', 'size', 'rotation'], slab: ['point', 'normal', 'thickness'], plane: ['point', 'normal'] };
const pick = (c) => Object.fromEntries(FIELDS[c.kind].map((k) => [k, c[k]]));
const round = (v) => (Array.isArray(v) ? v.map((x) => Math.round(x * 1e4) / 1e4 || 0) : Math.round(v * 1e4) / 1e4);

function closestOnLine(ray, origin, dir) {
  const p = new THREE.Vector3();
  ray.distanceSqToSegment(origin.clone().addScaledVector(dir, -1e4), origin.clone().addScaledVector(dir, 1e4), null, p);
  return p;
}
const segDist = (p, a, b) => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1)));
  return Math.hypot(p.x - a.x - t * ab.x, p.y - a.y - t * ab.y);
};

export class ClipGizmo {
  constructor(app) {
    this.app = app;
    const vp = (this.vp = app.viewport);
    this.group = new THREE.Group();
    this.group.name = 'Clip volumes';
    vp.scene.add(this.group);
    this.name = null; // the selected clip
    this.drag = null;
    this.face = null; // the active face: Tab, typed distances, arrow nudges
    this.mode = null; // W / E / R show TransformControls (move / rotate / scale); off, the face handles are all reachable
    this.proxy = new THREE.Object3D();
    vp.scene.add(this.proxy);
    this.tc = new TransformControls(vp.camera, vp.canvas);
    this.tc.setSpace('local');
    this.helper = this.tc.getHelper();
    this.helper.visible = false;
    vp.scene.add(this.helper);
    this.tc.addEventListener('dragging-changed', (ev) => {
      (this.pane?.controls || vp.controls).enabled = !ev.value;
      if (ev.value) this.start = this.clip();
      else if (this.start) this.commit(this.fromProxy());
    });
    this.tc.addEventListener('objectChange', () => this.start && this.preview(this.fromProxy()));
    this.tc.addEventListener('change', () => (vp.dirty = true));
    window.addEventListener('keyup', (e) => e.key === 'Shift' && this.tc.setRotationSnap(null));
  }

  /** The selected clip, filled in (null: none). */
  clip() {
    const c = this.name && CV.clipsOf(this.app.store.doc).find((x) => x.name === this.name);
    return c ? CV.normalize(c) : null;
  }
  get dragging() {
    return !!this.drag || this.tc.dragging || !!this.tc.axis;
  }

  /** Select a clip by name (null: none): its handles show, the Clipping panel row lights up. */
  select(name) {
    this.name = name || null;
    this.face = null;
    this.app.clipSelected = this.app.activeClip = this.name; // activeClip: the SpaceMouse clip hold (#303) moves this one
    this.sync();
    this.app.ui.refreshClips?.();
    this.app.tools?.status(this.name ? `Clip ${this.name}: drag a face handle (Ctrl: both sides; edges and corners: Shift keeps proportions), type a distance. W move · E rotate · R scale · L local/world · Tab next face · arrows nudge · Delete · Esc done.` : this.app.tools.tool?.hint);
  }

  /** TransformControls follow the pane the pointer is in (#162). */
  usePane(pane) {
    const vp = this.vp;
    const canvas = pane ? pane.canvas : vp.canvas;
    if (this.tc.dragging) return;
    if (this.tc.domElement !== canvas) this.tc.disconnect(), this.tc.connect(canvas);
    this.pane = pane;
    this.tc.camera = vp.camera; // called inside withPane: the pane's camera, perspective or parallel
  }

  // ---------------------------------------------------------------- drawing
  /** Redraw from the document (and a preview while dragging). */
  sync(preview = null) {
    const vp = this.vp;
    const doc = this.app.store.doc;
    for (const o of this.group.children) o.traverse((x) => (x.geometry?.dispose(), x.material?.dispose?.()));
    this.group.clear();
    this.handles = [];
    this.edges = [];
    if (this.name && !CV.clipsOf(doc).some((c) => c.name === this.name)) (this.name = null), (this.app.clipSelected = null);
    const box = vp.modelBox?.();
    const extent = box && !box.isEmpty?.() ? Math.max(10, box.getSize(new THREE.Vector3()).length()) : 20;
    for (const c0 of CV.clipsOf(doc)) {
      let c = CV.normalize(c0);
      const sel = c.name === this.name;
      if (sel && preview) c = CV.normalize({ ...c, ...preview });
      const segs = this.outline(c, extent);
      this.edges.push({ name: c.name, segs });
      const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs.flat()), new THREE.LineBasicMaterial({ color: sel ? SEL : EDGE, transparent: true, opacity: c.enabled ? 0.9 : 0.35, depthTest: false }));
      l.renderOrder = 990;
      this.group.add(l);
      if (sel) this.decorate(c, extent);
    }
    if (!preview) this.attach();
    vp.dirty = true;
  }
  /** Segments of a clip's edges: a box's twelve, a slab's two squares, a plane's square. */
  outline(c, extent) {
    if (c.kind === 'box') {
      const ax = CV.axes(c).map(V);
      const at = (i, j, k) => V(c.center).addScaledVector(ax[0], (i * c.size[0]) / 2).addScaledVector(ax[1], (j * c.size[1]) / 2).addScaledVector(ax[2], (k * c.size[2]) / 2);
      const segs = [];
      for (const s of [-1, 1]) for (const t of [-1, 1]) segs.push([at(-1, s, t), at(1, s, t)], [at(s, -1, t), at(s, 1, t)], [at(s, t, -1), at(s, t, 1)]);
      return segs;
    }
    const f = SEC.planeFrame(c.normal);
    const h = extent / 2;
    return CV.planesOf(c).flatMap((p) => {
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => V(p.point).addScaledVector(V(f.u), a * h).addScaledVector(V(f.v), b * h));
      return q.map((x, i) => [x, q[(i + 1) % 4]]);
    });
  }
  /** The selected clip: translucent faces, the active face brighter, handles. */
  decorate(c, extent) {
    const faceMat = (o) => new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const planes = CV.planesOf(c);
    if (c.kind === 'box') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), faceMat(0.07));
      m.matrixAutoUpdate = false;
      m.matrix.compose(V(c.center), new THREE.Quaternion().setFromRotationMatrix(CV.rotationMatrix(c.rotation)), V(c.size));
      this.group.add(m);
    }
    const f = SEC.planeFrame(c.normal || [0, 1, 0]);
    for (const p of planes) {
      if (p.face !== this.face && c.kind === 'box') continue;
      const ax = c.kind === 'box' ? CV.axes(c).filter((_, k) => k !== 'xyz'.indexOf(p.face[1])) : [f.u, f.v];
      const ext = c.kind === 'box' ? c.size.filter((_, k) => k !== 'xyz'.indexOf(p.face[1])) : [extent, extent];
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMat(p.face === this.face ? 0.22 : 0.06));
      q.matrixAutoUpdate = false;
      q.matrix.makeBasis(V(ax[0]).multiplyScalar(ext[0]), V(ax[1]).multiplyScalar(ext[1]), V(p.normal)).setPosition(V(p.point));
      this.group.add(q);
    }
    // handles: face centres, and for a box edge middles and corners
    this.handles = planes.map((p) => ({ faces: [p.face], p: V(p.point) }));
    if (c.kind === 'box') {
      const F = planes.map((p) => p.face);
      const axis = (x) => x[1];
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (axis(F[i]) !== axis(F[j])) this.handles.push({ faces: [F[i], F[j]], p: V(planes[i].point).add(V(planes[j].point)).sub(V(c.center)) });
      for (const x of ['+x', '-x']) for (const y of ['+y', '-y']) for (const z of ['+z', '-z']) {
        const pts = [x, y, z].map((k) => V(planes[F.indexOf(k)].point));
        this.handles.push({ faces: [x, y, z], p: pts[0].add(pts[1]).add(pts[2]).sub(V(c.center).multiplyScalar(2)) });
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(this.handles.map((h) => h.p));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.handles.flatMap((h) => (h === this.hover ? [0.91, 0.74, 0.37] : h.faces.length === 1 ? [0.78, 0.33, 0.24] : h.faces.length === 2 ? [0.18, 0.44, 0.53] : [0.12, 0.23, 0.3])), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 12, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    pts.renderOrder = 1000;
    this.group.add(pts);
  }
  /** TransformControls on a proxy in the clip's frame (a plane / slab: its normal is the proxy's Y). */
  attach() {
    const c = this.clip();
    if (!c || !this.mode) {
      this.tc.detach();
      this.helper.visible = false;
      return;
    }
    const q = c.kind === 'box' ? new THREE.Quaternion().setFromRotationMatrix(CV.rotationMatrix(c.rotation)) : new THREE.Quaternion().setFromUnitVectors(V([0, 1, 0]), V(c.normal));
    this.proxy.position.copy(V(c.center || c.point));
    this.proxy.quaternion.copy(q);
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld();
    this.tc.setMode(this.mode);
    if (this.tc.object !== this.proxy) this.tc.attach(this.proxy);
    this.helper.visible = true;
  }
  /** The clip's fields from the proxy TransformControls moved. */
  fromProxy() {
    const c = this.start;
    const p = this.proxy;
    p.updateMatrixWorld();
    const rot = new THREE.Matrix4().extractRotation(p.matrixWorld);
    if (c.kind === 'box') {
      const s = this.mode === 'scale' ? p.scale.toArray() : [1, 1, 1];
      return { center: round(p.position.toArray()), rotation: CV.eulerOf(rot), size: round(c.size.map((x, k) => Math.max(1e-3, x * Math.abs(s[k])))) };
    }
    const normal = round(V([0, 1, 0]).applyMatrix4(rot).normalize().toArray());
    return { point: round(p.position.toArray()), normal, ...(c.kind === 'slab' ? { thickness: round(Math.max(1e-3, c.thickness * Math.abs(this.mode === 'scale' ? p.scale.y : 1))) } : {}) };
  }

  // ---------------------------------------------------------------- preview and commit
  preview(fields) {
    this.vp.clipPreview = { [`clip:${this.name}`]: fields };
    this.sync(fields);
    const c = CV.normalize({ ...this.clip(), ...fields });
    const d = this.drag?.dists?.[0];
    this.app.tools.status(`${c.kind === 'box' ? `Box ${c.size.map((x) => fmt(x)).join(' × ')}` : c.kind === 'slab' ? `Slab ${fmt(c.thickness)} thick` : 'Plane'}${d !== undefined ? ` · moved ${fmt(d)}` : ''}`, 'Distance');
    if (d !== undefined && this.drag?.h) this.label(this.drag.h.p, `${d >= 0 ? '+' : ''}${fmt(d)}`);
  }
  label(p, text) {
    const t = this.app.tools;
    t.showSnap({ point: p, kind: text });
  }
  async commit(fields) {
    this.start = null;
    this.vp.clipPreview = null;
    if (!fields || !this.name) return this.sync();
    try {
      await this.app.reg.run('set_clip', { name: this.name, ...fields });
    } catch (e) {
      this.app.ui.toast(e.message, 'danger');
      this.sync();
    }
  }
  cancel() {
    this.drag = null;
    this.start = null;
    this.vp.clipPreview = null;
    (this.pane?.controls || this.vp.controls).enabled = true;
    this.sync();
  }

  // ---------------------------------------------------------------- pointer (called by tools.js inside the pane)
  handleAt(ev) {
    let best = null;
    let bd = HANDLE_PX;
    for (const h of this.handles || []) {
      const s = this.vp.toScreen(h.p);
      const d = Math.hypot(s.x - ev.clientX, s.y - ev.clientY) + (h.faces.length - 1) * 2; // on top of each other (a parallel view): the face wins
      if (!s.behind && d < bd) (bd = d), (best = h);
    }
    return best;
  }
  edgeAt(ev) {
    let best = null;
    let bd = 6;
    for (const { name, segs } of this.edges || [])
      for (const [a, b] of segs) {
        const sa = this.vp.toScreen(a);
        const sb = this.vp.toScreen(b);
        if (sa.behind || sb.behind) continue;
        const d = segDist({ x: ev.clientX, y: ev.clientY }, sa, sb);
        if (d < bd) (bd = d), (best = name);
      }
    return best;
  }
  /** The face of the selected box under the pointer (anywhere on it, not only its handle): { face, p }. */
  faceAt(ev) {
    const c = this.clip();
    if (c?.kind !== 'box') return null;
    const ray = this.vp.ray(ev).clone();
    let best = null;
    for (const p of CV.planesOf(c)) {
      const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(V(p.normal), V(p.point)), new THREE.Vector3());
      if (!hit) continue;
      const l = CV.toLocal(c, hit.toArray());
      if (!l.every((x, k) => Math.abs(x) <= c.size[k] / 2 + 1e-6)) continue;
      const d = hit.distanceTo(ray.origin);
      if (!best || d < best.d) best = { d, face: p.face, p: hit };
    }
    return best;
  }
  /** A press: a handle starts a drag; with Select or Clip Box, a clip's edge selects it. True: the event is used. */
  down(ev, toolId) {
    if (this.tc.axis) return true;
    const f = this.name && !this.handleAt(ev) && this.faceAt(ev);
    const h = (this.name && this.handleAt(ev)) || (f && { faces: [f.face], p: f.p }); // a click on a face picks it too
    if (h) {
      const c = this.clip();
      this.drag = { h, c, ctrl: ev.ctrlKey, shift: ev.shiftKey, x: ev.clientX, y: ev.clientY, moved: false, dists: h.faces.map(() => 0) };
      this.face = h.faces.length === 1 ? h.faces[0] : this.face;
      this.vp.controls.enabled = false;
      return true;
    }
    if (toolId === 'select' || toolId === 'clipbox') {
      const name = this.edgeAt(ev);
      if (name) return this.select(name), true;
    }
    return false;
  }
  move(ev) {
    const d = this.drag;
    if (!d) {
      const h = this.name && this.handleAt(ev);
      if (h !== this.hover) (this.hover = h), this.sync();
      return false;
    }
    if (d.done) return true;
    d.moved ||= Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 3;
    if (!d.moved) return true;
    const vp = this.vp;
    const ns = d.h.faces.map((f) => V(CV.planesOf(d.c).find((p) => p.face === f).normal));
    const ray = vp.ray(ev).clone();
    let P;
    if (ns.length === 1) {
      const r = this.app.tools.infer(ev); // snaps to points, cloud points, vertices
      P = r.snapped ? d.h.p.clone().addScaledVector(ns[0], r.point.clone().sub(d.h.p).dot(ns[0])) : closestOnLine(ray, d.h.p, ns[0]);
    } else {
      const look = vp.camera.getWorldDirection(new THREE.Vector3());
      let pn = ns.length === 2 ? ns[0].clone().cross(ns[1]).normalize() : look;
      if (Math.abs(pn.dot(ray.direction)) < 0.2) pn = look; // the edge's plane seen edge-on: drag on the screen plane
      P = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(pn, d.h.p), new THREE.Vector3());
      if (!P) return true;
    }
    const delta = P.sub(d.h.p);
    d.dists = ns.map((n) => round(delta.dot(n)));
    this.preview(this.applied(d, d.dists));
    return true;
  }
  /** The fields after moving the drag's faces by dists (Ctrl: symmetric; Shift on edges / corners: proportional). */
  applied(d, dists) {
    const c = d.c;
    if (d.shift && c.kind === 'box' && d.h.faces.length > 1) {
      const ks = d.h.faces.map((f) => 'xyz'.indexOf(f[1]));
      const r = Math.max(1e-3, ks.reduce((s, k, i) => s + (c.size[k] + dists[i] * (d.ctrl ? 2 : 1)) / c.size[k], 0) / ks.length);
      const size = c.size.map((x) => x * r);
      const ax = CV.axes(c);
      let center = V(c.center);
      if (!d.ctrl) d.h.faces.forEach((f, i) => (center = center.addScaledVector(V(ax[ks[i]]), ((f[0] === '-' ? -1 : 1) * (size[ks[i]] - c.size[ks[i]])) / 2)));
      return { center: round(center.toArray()), size: round(size), rotation: c.rotation };
    }
    let cur = { ...c };
    d.h.faces.forEach((f, i) => (cur = { ...cur, ...CV.pushFace(cur, f, dists[i], { symmetric: d.ctrl }) }));
    return pick(CV.normalize(cur));
  }
  up() {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    this.vp.controls.enabled = true;
    this.app.tools.label.hidden = true;
    if (d.done) return true;
    if (d.moved) this.commit(this.applied(d, d.dists));
    else {
      // a click on a face or its handle: that face is active, type a distance (outward +) or drag it
      this.sync();
      if (this.face) this.app.tools.status(`Face ${this.face} of ${this.name}: type a distance (+ out, − in) and Enter, or drag it. Ctrl: both sides.`, 'Distance');
    }
    return true;
  }

  // ---------------------------------------------------------------- keys and typed values
  /** A distance typed for the active face ("2.5"; while dragging it takes the drag's direction), or "x, y, z" for a box's size. */
  vcb(text) {
    const c = this.clip();
    if (!c) return false;
    const parts = text.split(/[,;]\s*/).map(parseLength);
    if (parts.length === 3 && c.kind === 'box' && parts.every((x) => x > 0)) return this.commit({ size: parts, center: c.center, rotation: c.rotation }), true;
    const face = this.drag?.h.faces.length === 1 ? this.drag.h.faces[0] : this.face;
    if (!face || !Number.isFinite(parts[0])) return false;
    const sign = this.drag && this.drag.dists[0] < 0 ? -1 : 1;
    const fields = pick(CV.normalize({ ...c, ...CV.pushFace(c, face, sign * parts[0], { symmetric: this.drag?.ctrl }) }));
    if (this.drag) this.drag.done = true;
    this.commit(fields);
    return true;
  }
  key(ev) {
    const c = this.clip();
    if (!c) return false;
    const k = ev.key;
    if (k === 'Escape') return this.drag || this.start ? this.cancel() : this.select(null), true;
    if (k === 'Delete' || k === 'Backspace') {
      this.app.reg.run('delete_clip', { name: c.name }).catch((e) => this.app.ui.toast(e.message, 'danger'));
      this.select(null);
      return true;
    }
    if (k === 'Tab') {
      const faces = CV.planesOf(c).map((p) => p.face);
      this.face = faces[(faces.indexOf(this.face) + (ev.shiftKey ? faces.length - 1 : 1)) % faces.length];
      this.sync();
      this.app.tools.status(`Face ${this.face} of ${c.name}: type a distance, or arrows nudge it.`);
      return true;
    }
    if (k.startsWith('Arrow') && this.face) {
      const step = this.app.store.doc.settings.axes?.grid > 0 ? this.app.store.doc.settings.axes.grid : 0.1;
      const s = k === 'ArrowUp' || k === 'ArrowRight' ? 1 : -1;
      this.commit(pick(CV.normalize({ ...c, ...CV.pushFace(c, this.face, s * step, { symmetric: ev.ctrlKey }) })));
      return true;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    const lk = k.toLowerCase();
    if (lk === 'l') return this.tc.setSpace(this.tc.space === 'local' ? 'world' : 'local'), this.app.tools.status(`Handles in ${this.tc.space} axes.`), true;
    const modes = { w: 'translate', e: 'rotate', r: 'scale' };
    if (modes[lk]) return (this.mode = this.mode === modes[lk] ? null : modes[lk]), this.attach(), true;
    if (k === 'Shift') return this.tc.setRotationSnap(Math.PI / 12), false; // 15° steps while held
    return false;
  }
}
