// Interactive tools. Every tool previews in the overlay and commits through a registry command, so hand-made
// edits and AI edits share one code path (and one undo history).
import * as THREE from 'three';
import * as G from '../core/geometry.js';
import * as D from '../core/document.js';
import { AXIS_COLORS, meshGeometry } from './viewport.js';

const V = (...a) => new THREE.Vector3(...a);
const AXES = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
const AXIS_NAME = { x: 'red', y: 'blue', z: 'green' };
const SNAP_PX = 12;
const ACCENT = 0x2f6f86;
const HIGHLIGHT = 0xe8bc5e;

export const TOOLS = [
  { id: 'select', label: 'Select', key: 'Space', icon: 'cursor', group: 'select' },
  { id: 'line', label: 'Line', key: 'L', icon: 'pencil-line', group: 'draw' },
  { id: 'rectangle', label: 'Rectangle', key: 'R', icon: 'rectangle', group: 'draw' },
  { id: 'circle', label: 'Circle', key: 'C', icon: 'circle', group: 'draw' },
  { id: 'polygon', label: 'Polygon', key: 'G', icon: 'hexagon', group: 'draw' },
  { id: 'curve', label: 'Curve (path for sweeps and motion)', key: 'U', icon: 'bezier-curve', group: 'draw' },
  { id: 'pushpull', label: 'Push/Pull', key: 'P', icon: 'arrow-fat-lines-up', group: 'edit' },
  { id: 'move', label: 'Move (Ctrl copies)', key: 'M', icon: 'arrows-out-cardinal', group: 'edit' },
  { id: 'rotate', label: 'Rotate', key: 'Q', icon: 'arrow-clockwise', group: 'edit' },
  { id: 'scale', label: 'Scale', key: 'S', icon: 'arrows-out', group: 'edit' },
  { id: 'tape', label: 'Tape Measure', key: 'T', icon: 'ruler', group: 'construct' },
  { id: 'paint', label: 'Paint Bucket (Alt samples)', key: 'B', icon: 'paint-bucket', group: 'construct' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser', group: 'construct' },
  { id: 'section', label: 'Section Plane', key: 'X', icon: 'knife', group: 'construct' },
  { id: 'orbit', label: 'Orbit (middle mouse)', key: 'O', icon: 'globe-simple', group: 'camera' },
  { id: 'pan', label: 'Pan (right mouse)', key: 'H', icon: 'hand', group: 'camera' },
];

/** "1.5" → 1.5 m · "150mm" · "15cm" · "3'" · '6"'. Returns metres. */
export function parseLength(s) {
  const m = String(s).trim().match(/^(-?[\d.]+)\s*(mm|cm|m|km|'|"|ft|in)?$/i);
  if (!m) return NaN;
  const f = { mm: 0.001, cm: 0.01, m: 1, km: 1000, "'": 0.3048, ft: 0.3048, '"': 0.0254, in: 0.0254 }[(m[2] || 'm').toLowerCase()];
  return parseFloat(m[1]) * f;
}
export const fmt = (m) => (Math.abs(m) < 1 ? `${Math.round(m * 1000)} mm` : `${(Math.round(m * 1000) / 1000).toFixed(3)} m`);

function basis(n) {
  if (Math.abs(n.y) > 0.99) return { u: V(1, 0, 0), v: V(0, 0, 1).multiplyScalar(Math.sign(n.y) || 1) };
  const u = V(0, 1, 0).cross(n).normalize();
  return { u, v: n.clone().cross(u).normalize() };
}

function closestOnLine(ray, origin, dir) {
  const p = new THREE.Vector3();
  ray.distanceSqToSegment(origin.clone().addScaledVector(dir, -1e4), origin.clone().addScaledVector(dir, 1e4), null, p);
  return p;
}

export class Tools {
  constructor(app) {
    this.app = app;
    this.vp = app.viewport;
    this.lock = null;
    this.copy = false;
    this.paint = { color: '#c8553d', opacity: 1, metalness: 0, roughness: 0.8 };
    this.label = document.getElementById('snap-label');
    this.box = document.getElementById('select-box');
    const c = this.vp.canvas;
    c.addEventListener('pointerdown', (e) => e.button === 0 && this.guard(() => this.tool.down?.(e)));
    c.addEventListener('pointermove', (e) => this.guard(() => this.tool.move?.(e)));
    c.addEventListener('pointerup', (e) => e.button === 0 && this.guard(() => this.tool.up?.(e)));
    c.addEventListener('dblclick', (e) => this.guard(() => this.tool.dbl?.(e)));
    c.addEventListener('pointerleave', () => (this.label.hidden = true));
    this.set('select');
  }

  guard(fn) {
    try {
      const r = fn();
      if (r?.catch) r.catch((e) => this.app.ui.toast(e.message, 'danger'));
    } catch (e) {
      this.app.ui.toast(e.message, 'danger');
    }
  }

  set(id) {
    this.tool?.cancel?.();
    this.clear();
    this.lock = null;
    this.id = id;
    this.tool = new IMPL[id](this);
    this.vp.controls.mouseButtons.LEFT = id === 'orbit' ? THREE.MOUSE.ROTATE : id === 'pan' ? THREE.MOUSE.PAN : null;
    this.vp.canvas.dataset.tool = id;
    this.app.ui.onTool(id);
    this.status(this.tool.hint);
  }

  status(hint, vcbLabel = this.tool?.vcbLabel || '') {
    this.app.ui.setStatus(hint, vcbLabel);
  }

  key(ev) {
    const arrows = { ArrowRight: 'x', ArrowLeft: 'z', ArrowUp: 'y', ArrowDown: null };
    if (ev.key in arrows) {
      this.lock = this.lock === arrows[ev.key] ? null : arrows[ev.key];
      this.status(this.lock ? `Locked to the ${AXIS_NAME[this.lock]} axis. ${this.tool.hint}` : this.tool.hint);
      return true;
    }
    if (ev.key === 'Control' && this.id === 'move') {
      this.copy = !this.copy;
      this.status(this.copy ? 'Copy mode: click to drop a copy. Then type x5 for five.' : this.tool.hint);
      return true;
    }
    if (ev.key === 'Enter' && this.tool.finish) {
      this.guard(() => this.tool.finish());
      return true;
    }
    if (ev.key === 'Escape') {
      if (this.tool.busy?.()) this.tool.cancel?.();
      else if (this.app.context) this.app.setContext(null);
      else this.app.select([]);
      this.clear();
      this.status(this.tool.hint);
      return true;
    }
    return false;
  }

  vcb(text) {
    if (this.tool.vcb) this.guard(() => this.tool.vcb(text.trim()));
  }

  /** Where the mouse is "really" pointing: snaps to endpoints and midpoints, infers axes, falls back to faces and the ground. */
  infer(ev, { from = null, plane = null, extra = [], fallback = null } = {}) {
    const vp = this.vp;
    const ray = vp.ray(ev).clone();
    const hit = vp.pick(ev);
    const mx = ev.clientX;
    const my = ev.clientY;
    const done = (r) => this.showSnap(r) || r;
    if (from && this.lock) return done({ point: closestOnLine(ray, from, AXES[this.lock]), kind: `On ${AXIS_NAME[this.lock]} axis`, axis: this.lock, hit });
    let best = null;
    let bestD = SNAP_PX;
    for (const s of [...extra.map((p) => ({ p, kind: 'Endpoint' })), ...vp.snapPoints()]) {
      const sp = vp.toScreen(s.p);
      const d = Math.hypot(sp.x - mx, sp.y - my);
      if (!sp.behind && d < bestD) (bestD = d), (best = s);
    }
    if (best) return done({ point: best.p.clone(), kind: best.kind, hit, snapped: true });
    if (from)
      for (const k of ['x', 'z', 'y']) {
        const p = closestOnLine(ray, from, AXES[k]);
        const sp = vp.toScreen(p);
        if (Math.hypot(sp.x - mx, sp.y - my) < 10 && p.distanceTo(from) > 1e-3) return done({ point: p, kind: `On ${AXIS_NAME[k]} axis`, axis: k, hit });
      }
    if (plane) {
      const p = ray.intersectPlane(plane, new THREE.Vector3());
      if (p) return done({ point: p, kind: 'On plane', hit });
    }
    if (hit) return done({ point: hit.point.clone(), kind: 'On face', hit });
    const p = ray.intersectPlane(fallback || new THREE.Plane(V(0, 1, 0), 0), new THREE.Vector3());
    return done({ point: p || from?.clone() || V(), kind: fallback ? 'Level' : 'On ground', hit: null });
  }

  showSnap(r) {
    const s = this.vp.toScreen(r.point);
    const wrap = this.vp.canvas.getBoundingClientRect();
    Object.assign(this.label.style, { left: `${s.x - wrap.left}px`, top: `${s.y - wrap.top}px` });
    this.label.textContent = r.kind;
    this.label.dataset.kind = r.axis || r.kind.split(' ')[0].toLowerCase();
    this.label.hidden = false;
  }

  // ---------------------------------------------------------------- overlay drawing
  clear() {
    for (const o of this.vp.overlay.children) o.traverse((x) => (x.geometry?.dispose(), x.material?.dispose?.()));
    this.vp.overlay.clear();
    this.vp.renderer.clippingPlanes = [];
    this.label.hidden = true;
    this.vp.dirty = true;
  }
  lines(points, color = 0x1d262c, closed = false) {
    const pts = closed ? [...points, points[0]] : points;
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false }));
    l.renderOrder = 999;
    this.vp.overlay.add(l);
    this.vp.dirty = true;
    return l;
  }
  ghost(mesh, matrixWorld, color = ACCENT, opacity = 0.35) {
    const g = meshGeometry(mesh);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false }));
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x1d262c, depthTest: false })));
    m.matrixAutoUpdate = false;
    m.matrix.copy(matrixWorld);
    m.renderOrder = 998;
    this.vp.overlay.add(m);
    this.vp.dirty = true;
    return m;
  }
  faceHighlight(hit) {
    const e = this.app.entity(hit.entityId);
    if (!e?.mesh) return;
    const face = { v: e.mesh.f[hit.faceIndex].map((i) => e.mesh.v[i]), f: [e.mesh.f[hit.faceIndex].map((_, k) => k)] };
    this.ghost(face, hit.object.matrixWorld, HIGHLIGHT, 0.45);
  }
  /** Ids to act on: the selection, else what is under the mouse. */
  targetsAt(ev) {
    if (this.app.selection.length) return this.app.selection;
    const hit = this.vp.pick(ev);
    return hit ? [this.app.pickTarget(hit.entityId)] : [];
  }
  run(name, args) {
    return this.app.reg.run(name, args);
  }
}

// ---------------------------------------------------------------- tools

class SelectTool {
  hint = 'Click to select, Shift toggles, drag for a box. Double-click a group to edit inside it. Esc leaves.';
  constructor(t) {
    this.t = t;
  }
  down(ev) {
    this.start = { x: ev.clientX, y: ev.clientY };
  }
  move(ev) {
    if (!this.start) return;
    const r = this.t.vp.canvas.getBoundingClientRect();
    const [x0, x1] = [this.start.x, ev.clientX].sort((a, b) => a - b);
    const [y0, y1] = [this.start.y, ev.clientY].sort((a, b) => a - b);
    Object.assign(this.t.box.style, { left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    this.t.box.hidden = x1 - x0 < 4 && y1 - y0 < 4;
  }
  up(ev) {
    const app = this.t.app;
    const s = this.start;
    this.start = null;
    this.t.box.hidden = true;
    if (!s) return;
    let ids;
    if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < 4) {
      const hit = this.t.vp.pick(ev) || this.t.vp.pickCurve();
      ids = hit ? [app.pickTarget(hit.entityId)] : [];
    } else {
      const [x0, x1] = [s.x, ev.clientX].sort((a, b) => a - b);
      const [y0, y1] = [s.y, ev.clientY].sort((a, b) => a - b);
      ids = app.store.doc.entities
        .filter((e) => e.parent === app.context && !e.locked)
        .filter((e) => {
          const b = D.worldBox(app.store.doc, e);
          const p = this.t.vp.toScreen(V(...b.min).add(V(...b.max)).multiplyScalar(0.5));
          return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
        })
        .map((e) => e.id);
    }
    if (ev.shiftKey) app.select([...app.selection.filter((x) => !ids.includes(x)), ...ids.filter((x) => !app.selection.includes(x))]);
    else if (ev.ctrlKey) app.select([...new Set([...app.selection, ...ids])]);
    else app.select(ids);
  }
  dbl(ev) {
    const app = this.t.app;
    const hit = this.t.vp.pick(ev);
    if (!hit) return app.setContext(null);
    const id = app.pickTarget(hit.entityId);
    if (app.entity(id)?.type === 'group') {
      app.setContext(id);
      app.select([app.pickTarget(hit.entityId)]);
    }
  }
}

/** Shared by Line, Rectangle, Circle, Polygon: pick a drawing plane on the first click. */
class DrawBase {
  constructor(t) {
    this.t = t;
    this.p0 = null;
  }
  busy() {
    return !!this.p0;
  }
  cancel() {
    this.p0 = null;
    this.t.clear();
  }
  startPlane(inf) {
    this.p0 = inf.point.clone();
    const n = inf.hit && inf.kind !== 'On ground' ? inf.hit.normal.clone() : V(0, 1, 0);
    this.n = n;
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.p0);
    Object.assign(this, basis(n));
  }
  onPlane(ev) {
    const inf = this.t.infer(ev, { from: this.p0, plane: this.plane });
    return this.plane.projectPoint(inf.point, new THREE.Vector3());
  }
  async commit(points, name) {
    const p = points.map((x) => D.round3(x.toArray()));
    const area = G.len(G.cross(G.sub(p[1], p[0]), G.sub(p[2], p[0])));
    this.cancel();
    if (area < 1e-8) return;
    await this.t.run('create_face', { points: p, normal: this.n.toArray(), name });
    this.t.status('Face made. Push/Pull (P) gives it thickness.');
  }
}

class LineTool extends DrawBase {
  hint = 'Click points. Close the loop on the first point to make a face. Type a length, Enter. Esc cancels.';
  vcbLabel = 'Length';
  pts = [];
  busy() {
    return this.pts.length > 0;
  }
  cancel() {
    this.pts = [];
    this.t.clear();
  }
  move(ev) {
    const last = this.pts.at(-1);
    const inf = this.t.infer(ev, { from: last, extra: this.pts.slice(0, 1) });
    this.cur = inf.point;
    if (!last) return;
    this.t.vp.overlay.clear();
    this.t.lines([...this.pts, this.cur], inf.axis ? AXIS_COLORS[inf.axis] : 0x1d262c);
    this.t.status(`Length ${fmt(last.distanceTo(this.cur))}`, 'Length');
  }
  async down(ev) {
    const inf = this.t.infer(ev, { from: this.pts.at(-1), extra: this.pts.slice(0, 1) });
    if (!this.pts.length && inf.hit) this.n = inf.hit.normal.clone();
    else if (!this.pts.length) this.n = V(0, 1, 0);
    await this.add(inf.point);
  }
  async add(p) {
    if (this.pts.length >= 3 && p.distanceTo(this.pts[0]) < 1e-4) {
      const pts = this.pts.map((x) => x.toArray());
      if (!G.isPlanar(pts, 1e-3)) {
        this.cancel();
        throw new Error('These lines are not on one plane, so they cannot make a face.');
      }
      let n = V(...G.polygonNormal(pts));
      if (Math.abs(n.y) > 0.99) n = V(0, Math.sign(n.y), 0).set(0, 1, 0);
      else if (n.dot(this.t.vp.camera.position.clone().sub(this.pts[0])) < 0) n.negate();
      this.n = n;
      return this.commit(this.pts, 'Face');
    }
    this.pts.push(p.clone());
  }
  vcb(text) {
    const d = parseLength(text);
    const last = this.pts.at(-1);
    if (!last || !this.cur || !(d > 0)) return;
    return this.add(last.clone().add(this.cur.clone().sub(last).normalize().multiplyScalar(d)));
  }
  async commit(points, name) {
    this.pts = [];
    return DrawBase.prototype.commit.call(this, points, name);
  }
}

class RectangleTool extends DrawBase {
  hint = 'Click a corner on the ground or on a face, then the opposite corner. Type "3,2" for exact sizes.';
  vcbLabel = 'Dimensions';
  corners(a, b) {
    return [this.p0, this.p0.clone().addScaledVector(this.u, a), this.p0.clone().addScaledVector(this.u, a).addScaledVector(this.v, b), this.p0.clone().addScaledVector(this.v, b)];
  }
  move(ev) {
    if (!this.p0) return this.t.infer(ev);
    const q = this.onPlane(ev).sub(this.p0);
    this.a = q.dot(this.u);
    this.b = q.dot(this.v);
    this.t.vp.overlay.clear();
    this.t.lines(this.corners(this.a, this.b), ACCENT, true);
    this.t.status(`${fmt(Math.abs(this.a))} × ${fmt(Math.abs(this.b))}`);
  }
  down(ev) {
    if (!this.p0) return this.startPlane(this.t.infer(ev));
    this.move(ev);
    return this.commit(this.corners(this.a, this.b), 'Rectangle');
  }
  vcb(text) {
    const [w, d] = text.split(/[,;]/).map(parseLength);
    if (!this.p0 || !(w > 0)) return;
    return this.commit(this.corners(Math.sign(this.a || 1) * w, Math.sign(this.b || 1) * (d > 0 ? d : w)), 'Rectangle');
  }
}

class CircleTool extends DrawBase {
  hint = 'Click the centre, then the radius. Type a radius, or "48s" for the number of sides.';
  vcbLabel = 'Radius';
  sides = 24;
  ring(r) {
    return Array.from({ length: this.sides }, (_, i) => {
      const a = (i / this.sides) * Math.PI * 2;
      return this.p0.clone().addScaledVector(this.u, Math.cos(a) * r).addScaledVector(this.v, Math.sin(a) * r);
    });
  }
  move(ev) {
    if (!this.p0) return this.t.infer(ev);
    this.r = this.onPlane(ev).distanceTo(this.p0);
    this.t.vp.overlay.clear();
    this.t.lines(this.ring(this.r), ACCENT, true);
    this.t.status(`Radius ${fmt(this.r)} · ${this.sides} sides`);
  }
  down(ev) {
    if (!this.p0) return this.startPlane(this.t.infer(ev));
    this.move(ev);
    return this.commit(this.ring(this.r), this.sides > 12 ? 'Circle' : 'Polygon');
  }
  vcb(text) {
    const s = text.match(/^(\d+)s$/i);
    if (s) return void (this.sides = Math.max(3, +s[1]), this.t.status(`${this.sides} sides`));
    const r = parseLength(text);
    if (this.p0 && r > 0) return this.commit(this.ring(r), this.sides > 12 ? 'Circle' : 'Polygon');
  }
}

class PolygonTool extends CircleTool {
  sides = 6;
  hint = 'Click the centre, then a corner. Type a radius, or "8s" for eight sides.';
}

class PushPullTool {
  hint = 'Click a face and move to push or pull it; click again or type a distance. Double-click repeats the last one.';
  vcbLabel = 'Distance';
  static last = 0;
  constructor(t) {
    this.t = t;
  }
  busy() {
    return !!this.s;
  }
  cancel() {
    if (this.s) this.s.object.visible = true;
    this.s = null;
    this.t.clear();
  }
  move(ev) {
    const t = this.t;
    if (!this.s) {
      t.clear();
      const hit = t.vp.pick(ev);
      if (hit) t.faceHighlight(hit);
      return;
    }
    const { p0, n } = this.s;
    const inf = t.infer(ev);
    this.d = inf.snapped ? inf.point.clone().sub(p0).dot(n) : closestOnLine(t.vp.ray(ev), p0, n).sub(p0).dot(n);
    this.preview();
  }
  preview() {
    const s = this.s;
    this.t.vp.overlay.clear();
    this.t.ghost(G.pushPull(s.mesh, s.fi, this.d * s.sign), s.object.matrixWorld, 0xd9d4c7, 0.9);
    this.t.status(`Distance ${fmt(this.d)}`);
  }
  start(hit) {
    const e = this.t.app.entity(hit.entityId);
    if (!e?.mesh) return false;
    if (e.locked) throw new Error(`${e.name} is locked.`);
    const nf = V(...G.faceNormal(e.mesh, hit.faceIndex)).transformDirection(hit.object.matrixWorld);
    this.s = { id: e.id, fi: hit.faceIndex, mesh: e.mesh, object: hit.object, p0: hit.point.clone(), n: hit.normal.clone(), sign: Math.sign(nf.dot(hit.normal)) || 1 };
    hit.object.visible = false;
    this.d = 0;
    return true;
  }
  async down(ev) {
    if (!this.s) {
      const hit = this.t.vp.pick(ev);
      if (hit) this.start(hit);
      return;
    }
    await this.commit(this.d);
  }
  async commit(d) {
    const s = this.s;
    this.cancel();
    if (Math.abs(d) < 1e-6) return;
    PushPullTool.last = d;
    await this.t.run('push_pull', { id: s.id, face: s.fi, distance: d * s.sign });
  }
  async dbl(ev) {
    if (this.s) this.cancel();
    const hit = this.t.vp.pick(ev);
    if (hit && PushPullTool.last && this.start(hit)) await this.commit(PushPullTool.last);
  }
  vcb(text) {
    const d = parseLength(text);
    if (!Number.isNaN(d) && this.s) return this.commit(d);
  }
}

/** Shared by Move, Rotate, Scale: preview by changing the three objects, commit with a command. */
class XformBase {
  constructor(t) {
    this.t = t;
  }
  busy() {
    return !!this.ids;
  }
  grab(ids) {
    const vp = this.t.vp;
    vp.modelRoot.updateMatrixWorld(true);
    this.ids = ids.filter((id) => {
      const e = this.t.app.entity(id);
      if (e?.locked) this.t.app.ui.toast(`${e.name} is locked.`);
      return e && !e.locked;
    });
    if (!this.ids.length) return (this.ids = null), false;
    this.orig = this.ids.map((id) => ({ o: vp.objs.get(id), m: vp.objs.get(id).matrixWorld.clone() }));
    return true;
  }
  previewWorld(fn) {
    for (const { o, m } of this.orig) {
      const w = fn(m.clone());
      const local = o.parent.matrixWorld.clone().invert().multiply(w);
      local.decompose(o.position, o.quaternion, o.scale);
    }
    this.t.vp.dirty = true;
  }
  cancel() {
    if (this.orig) this.previewWorld((m) => m);
    this.ids = this.orig = null;
    this.t.clear();
  }
  about(p, x) {
    return new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(x).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  }
}

class MoveTool extends XformBase {
  hint = 'Click a point on what to move, then where it goes. Ctrl toggles copy. Arrows lock an axis. Type a distance.';
  vcbLabel = 'Distance';
  move(ev) {
    if (!this.ids) return this.t.infer(ev);
    // Over empty space, slide level with the grabbed point instead of dropping onto the ground.
    const inf = this.t.infer(ev, { from: this.base, fallback: new THREE.Plane(V(0, 1, 0), -this.base.y) });
    this.delta = inf.point.clone().sub(this.base);
    this.show(inf.axis);
  }
  show(axis) {
    this.previewWorld((m) => new THREE.Matrix4().makeTranslation(this.delta.x, this.delta.y, this.delta.z).multiply(m));
    for (const l of this.t.vp.overlay.children.slice()) this.t.vp.overlay.remove(l);
    this.t.lines([this.base, this.base.clone().add(this.delta)], axis ? AXIS_COLORS[axis] : 0x1d262c);
    this.t.status(`${this.t.copy ? 'Copy' : 'Move'} ${fmt(this.delta.length())}`);
  }
  async down(ev) {
    if (!this.ids) {
      const inf = this.t.infer(ev);
      if (this.grab(this.t.targetsAt(ev))) (this.base = inf.point), (this.delta = V());
      return;
    }
    await this.commit();
  }
  async commit() {
    const ids = this.ids;
    const by = D.round3(this.delta.toArray());
    this.cancel();
    if (this.t.copy) {
      MoveTool.lastCopy = { ids, by };
      await this.t.run('duplicate', { ids, offset: by, count: 1 });
    } else await this.t.run('move', { ids, by });
  }
  async vcb(text) {
    const arr = text.match(/^[x*](\d+)$|^(\d+)[x*]$/i);
    const div = text.match(/^\/(\d+)$/);
    const lc = MoveTool.lastCopy;
    if ((arr || div) && lc && !this.ids) {
      await this.t.run('undo');
      const n = +(arr ? arr[1] || arr[2] : div[1]);
      return this.t.run('duplicate', { ids: lc.ids, offset: div ? lc.by.map((x) => x / n) : lc.by, count: div ? n - 1 : n });
    }
    const d = parseLength(text);
    if (!this.ids || Number.isNaN(d) || this.delta.length() < 1e-9) return;
    this.delta.setLength(d);
    await this.commit();
  }
}

class RotateTool extends XformBase {
  hint = 'Click the centre (on a face to tilt the protractor), then a start point, then the angle. Arrows pick the axis.';
  vcbLabel = 'Angle';
  step = 0;
  cancel() {
    this.step = 0;
    super.cancel();
  }
  busy() {
    return this.step > 0;
  }
  protractor(c, axis) {
    const { u, v } = basis(axis);
    const pts = Array.from({ length: 49 }, (_, i) => c.clone().addScaledVector(u, Math.cos((i / 48) * Math.PI * 2) * 0.6).addScaledVector(v, Math.sin((i / 48) * Math.PI * 2) * 0.6));
    const color = Math.abs(axis.x) > 0.99 ? AXIS_COLORS.x : Math.abs(axis.z) > 0.99 ? AXIS_COLORS.z : AXIS_COLORS.y;
    this.t.lines(pts, color);
  }
  move(ev) {
    if (this.step === 0) return this.t.infer(ev);
    const p = this.t.vp.ray(ev).intersectPlane(this.plane, new THREE.Vector3());
    if (!p) return;
    this.t.vp.overlay.clear();
    this.protractor(this.c, this.axis);
    if (this.step === 1) return void this.t.lines([this.c, p], HIGHLIGHT);
    const a = this.ref.clone().sub(this.c).normalize();
    const b = p.clone().sub(this.c).normalize();
    let ang = (Math.atan2(a.clone().cross(b).dot(this.axis), a.dot(b)) * 180) / Math.PI;
    if (Math.abs(ang - Math.round(ang / 15) * 15) < 2.5) ang = Math.round(ang / 15) * 15; // snap to 15°
    this.angle = ang;
    this.t.lines([this.ref, this.c, p], HIGHLIGHT);
    this.apply();
  }
  apply() {
    const R = new THREE.Matrix4().makeRotationAxis(this.axis, (this.angle * Math.PI) / 180);
    this.previewWorld((m) => this.about(this.c, R).multiply(m));
    this.t.status(`Angle ${Math.round(this.angle * 10) / 10}°`);
  }
  async down(ev) {
    if (this.step === 0) {
      if (!this.grab(this.t.targetsAt(ev))) return;
      const inf = this.t.infer(ev);
      this.c = inf.point;
      this.axis = this.t.lock ? AXES[this.t.lock].clone() : inf.hit && inf.kind === 'On face' ? inf.hit.normal.clone() : V(0, 1, 0);
      this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.axis, this.c);
      this.step = 1;
      this.angle = 0;
      return;
    }
    const p = this.t.vp.ray(ev).intersectPlane(this.plane, new THREE.Vector3());
    if (this.step === 1) return void (p && ((this.ref = p), (this.step = 2)));
    await this.commit();
  }
  async commit() {
    const args = { ids: this.ids, angle: Math.round(this.angle * 1000) / 1000, axis: D.round3(this.axis.toArray()), pivot: D.round3(this.c.toArray()) };
    this.cancel();
    if (args.angle) await this.t.run('rotate', args);
  }
  vcb(text) {
    const a = parseFloat(text);
    if (this.step === 2 && !Number.isNaN(a)) {
      this.angle = a;
      return this.commit();
    }
  }
}

class ScaleTool extends XformBase {
  hint = 'Click what to scale, then move away from or towards its base. Type a factor (0.5, 2) or "1,2,1".';
  vcbLabel = 'Scale';
  move(ev) {
    if (!this.ids) return;
    const p = this.t.vp.ray(ev).intersectPlane(this.plane, new THREE.Vector3());
    if (!p) return;
    this.f = Math.max(0.01, p.distanceTo(this.pivot) / this.r0);
    const S = new THREE.Matrix4().makeScale(this.f, this.f, this.f);
    this.previewWorld((m) => this.about(this.pivot, S).multiply(m));
    this.t.status(`Scale ×${this.f.toFixed(3)}`);
  }
  async down(ev) {
    if (!this.ids) {
      if (!this.grab(this.t.targetsAt(ev))) return;
      const doc = this.t.app.store.doc;
      const b = D.unionBox(this.ids.map((id) => D.worldBox(doc, this.t.app.entity(id))));
      this.pivot = V((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2);
      this.plane = new THREE.Plane(V(0, 1, 0), -this.pivot.y);
      const p = this.t.vp.ray(ev).intersectPlane(this.plane, new THREE.Vector3());
      this.r0 = Math.max(0.05, p ? p.distanceTo(this.pivot) : 1);
      this.f = 1;
      return;
    }
    await this.commit(this.f);
  }
  async commit(factor) {
    const ids = this.ids;
    this.cancel();
    await this.t.run('scale', { ids, factor, pivot: 'base' });
  }
  vcb(text) {
    if (!this.ids) return;
    const f = text.split(/[,;]/).map(Number);
    if (f.every((x) => x > 0)) return this.commit(f.length === 3 ? f : f[0]);
  }
}

class TapeTool {
  hint = 'Click two points to measure the distance between them.';
  constructor(t) {
    this.t = t;
  }
  busy() {
    return !!this.p1;
  }
  cancel() {
    this.p1 = null;
    this.t.clear();
  }
  move(ev) {
    const inf = this.t.infer(ev, { from: this.p1 });
    if (!this.p1) return;
    this.t.vp.overlay.clear();
    this.t.lines([this.p1, inf.point], HIGHLIGHT);
    this.t.status(`Distance ${fmt(this.p1.distanceTo(inf.point))}`);
  }
  down(ev) {
    const inf = this.t.infer(ev, { from: this.p1 });
    if (!this.p1) return void (this.p1 = inf.point);
    const d = this.p1.distanceTo(inf.point);
    const delta = inf.point.clone().sub(this.p1);
    this.p1 = null;
    this.t.status(`Distance ${fmt(d)}  (Δx ${fmt(delta.x)}, Δy ${fmt(delta.y)}, Δz ${fmt(delta.z)})`);
    this.t.app.ui.toast(`Measured ${fmt(d)}`);
  }
}

class PaintTool {
  hint = 'Click a shape to paint it with the colour from the Materials panel. Alt-click samples a colour.';
  constructor(t) {
    this.t = t;
  }
  async down(ev) {
    const hit = this.t.vp.pick(ev);
    if (!hit) return;
    if (ev.altKey) return this.t.app.ui.setPaint({ ...this.t.app.entity(hit.entityId).material });
    await this.t.run('set_material', { ids: [this.t.app.pickTarget(hit.entityId)], ...this.t.paint });
  }
}

class EraserTool {
  hint = 'Click a shape or group to delete it.';
  constructor(t) {
    this.t = t;
  }
  async down(ev) {
    const hit = this.t.vp.pick(ev) || this.t.vp.pickCurve();
    if (hit) await this.t.run('delete', { ids: [this.t.app.pickTarget(hit.entityId)] });
  }
}

class SectionTool extends PushPullTool {
  hint = 'Click a face, then move into the model to slide the cut. Click again to place it. Click empty space to remove the cut.';
  move(ev) {
    if (!this.s) return super.move(ev);
    this.d = Math.max(0, -closestOnLine(this.t.vp.ray(ev), this.s.p0, this.s.n).sub(this.s.p0).dot(this.s.n));
    this.preview();
  }
  preview() {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.s.n.clone().negate(), this.point());
    this.s.object.visible = true;
    this.t.vp.renderer.clippingPlanes = [plane];
    this.t.vp.dirty = true;
    this.t.status(`Section ${fmt(this.d)} deep`);
  }
  point() {
    return this.s.p0.clone().addScaledVector(this.s.n, -this.d);
  }
  async down(ev) {
    if (!this.s) {
      const hit = this.t.vp.pick(ev);
      if (!hit) return this.t.run('section', { enabled: false });
      this.s = { p0: hit.point.clone(), n: hit.normal.clone(), object: hit.object };
      this.d = 0.05;
      return this.preview();
    }
    const args = { normal: D.round3(this.s.n.toArray()), point: D.round3(this.point().toArray()) };
    this.cancel();
    await this.t.run('section', args);
  }
  dbl() {}
  vcb(text) {
    const d = parseLength(text);
    if (this.s && d >= 0) {
      this.d = d;
      return this.down({});
    }
  }
}

class CameraTool {
  hint = 'Drag to navigate. Middle mouse orbits, right mouse pans and the wheel zooms with any tool.';
  constructor(t) {
    this.t = t;
  }
}

/** Click points of a path; Enter or double-click finishes. Three or more points make a smooth spline. */
class CurveTool {
  hint = 'Click the points of a path (they snap like lines). Enter or double-click finishes; 3+ points make a smooth curve. Esc cancels.';
  constructor(t) {
    this.t = t;
    this.pts = [];
  }
  busy() {
    return this.pts.length > 0;
  }
  cancel() {
    this.pts = [];
    this.t.clear();
  }
  move(ev) {
    const inf = this.t.infer(ev, { from: this.pts.at(-1), extra: this.pts.slice(0, 1) });
    this.cur = inf.point;
    if (!this.pts.length) return;
    this.t.vp.overlay.clear();
    this.t.lines([...this.pts, this.cur], ACCENT);
  }
  down(ev) {
    const inf = this.t.infer(ev, { from: this.pts.at(-1), extra: this.pts.slice(0, 1) });
    if (!this.pts.length || inf.point.distanceTo(this.pts.at(-1)) > 1e-4) this.pts.push(inf.point.clone());
    this.t.status(`${this.pts.length} point${this.pts.length > 1 ? 's' : ''}. Enter finishes.`);
  }
  dbl() {
    return this.finish();
  }
  async finish() {
    const pts = this.pts.map((p) => D.round3(p.toArray()));
    this.cancel();
    if (pts.length < 2) return;
    const closed = pts.length > 3 && G.len(G.sub(pts[0], pts.at(-1))) < 1e-3;
    await this.t.run('create_curve', { points: closed ? pts.slice(0, -1) : pts, kind: pts.length > 2 ? 'spline' : 'polyline', closed });
    this.t.status('Curve made. Sweep a profile along it (Library tab), or animate something along it.');
  }
}

const IMPL = {
  select: SelectTool,
  line: LineTool,
  rectangle: RectangleTool,
  circle: CircleTool,
  polygon: PolygonTool,
  curve: CurveTool,
  pushpull: PushPullTool,
  move: MoveTool,
  rotate: RotateTool,
  scale: ScaleTool,
  tape: TapeTool,
  paint: PaintTool,
  eraser: EraserTool,
  section: SectionTool,
  orbit: CameraTool,
  pan: CameraTool,
};
