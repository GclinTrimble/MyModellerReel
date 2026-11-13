// Interactive tools. Every tool previews in the overlay and commits through a registry command, so hand-made
// edits and AI edits share one code path (and one undo history).
import * as THREE from 'three';
import * as G from '../core/geometry.js';
import * as D from '../core/document.js';
import { AXIS_COLORS, meshGeometry } from './viewport.js';
import { arcThrough } from '../core/curves.js';
import * as L from '../core/layers.js';
import { LIBRARY as TX_LIBRARY } from '../core/textures.js';
import { fillet as fillet2d } from '../core/drafting.js';
import { formatLength } from '../core/units.js';
import * as MD from '../core/modeling.js';
import { floorAt, blocked } from './scale.js';
import * as TK from '../core/takeoff.js';
import { h } from './ui.js';

const V = (...a) => new THREE.Vector3(...a);
let AXES = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
let GRID = null; // { origin, step } when ground clicks snap to the drawing grid (#32)
/** The drawing axes (#32): turned about up by angle degrees, from origin; grid step and snap. */
export function setAxes(ax) {
  const a = ((ax?.angle || 0) * Math.PI) / 180;
  AXES = { x: V(Math.cos(a), 0, -Math.sin(a)), y: V(0, 1, 0), z: V(Math.sin(a), 0, Math.cos(a)) };
  GRID = ax?.snap && ax.grid > 0 ? { origin: V(...(ax.origin || [0, 0, 0])), step: ax.grid } : null;
}
function snapToGrid(p) {
  if (!GRID) return p;
  const d = p.clone().sub(GRID.origin);
  const s = GRID.step;
  const x = Math.round(d.dot(AXES.x) / s) * s;
  const z = Math.round(d.dot(AXES.z) / s) * s;
  return GRID.origin.clone().addScaledVector(AXES.x, x).addScaledVector(AXES.z, z).setY(p.y);
}
const AXIS_NAME = { x: 'red', y: 'blue', z: 'green' };
const SNAP_PX = 12;
const ACCENT = 0x2f6f86;
const HIGHLIGHT = 0xe8bc5e;

const TX_NAMES = new Set(Object.keys(TX_LIBRARY));

/** Snap kinds (#180) and their defaults; doc.settings.snaps overrides them (set_snaps). */
export const SNAPS = { endpoint: true, midpoint: true, face: true, axis: true, grid: true, drawing: true, cloud: true };
export const SNAP_LABELS = { endpoint: 'Endpoints', midpoint: 'Midpoints', face: 'On faces', axis: 'Along the axes', grid: 'Grid', drawing: 'On drawings', cloud: 'Point cloud points' };

/** The side toolbar (#175): a tool, '-' a divider, or variants sharing one button (a flyout). */
export const TOOLBAR = ['select', '-', ['line', 'curve'], ['rectangle', 'rect3'], ['circle', 'polygon'], ['arc', 'arc3', 'arcc'], 'point', '-', 'pushpull', 'move', 'rotate', 'scale', ['trim', 'extend', 'split', 'join'], 'sculpt', '-', ['tape', 'dimension', 'label', 'text'], ['paint', 'matbrush'], 'eraser', 'section'];

export const TOOLS = [
  { id: 'select', label: 'Select', key: 'Space', icon: 'cursor', group: 'select' },
  { id: 'line', label: 'Line', key: 'L', icon: 'pencil-line', group: 'draw' },
  { id: 'rectangle', label: 'Rectangle', key: 'R', icon: 'rectangle', group: 'draw' },
  { id: 'rect3', label: 'Rotated rectangle (3 points)', key: 'F', icon: 'rectangle-dashed', group: 'draw' },
  { id: 'circle', label: 'Circle', key: 'C', icon: 'circle', group: 'draw' },
  { id: 'polygon', label: 'Polygon', key: 'G', icon: 'hexagon', group: 'draw' },
  { id: 'curve', label: 'Path / alignment (straight, arc, smooth; corner radius)', key: 'U', icon: 'path', group: 'draw' },
  { id: 'arc', label: 'Arc (start, end, bulge)', key: 'A', icon: 'circle-half', group: 'draw' },
  { id: 'arc3', label: 'Arc through three points', key: '', icon: 'circle-half-tilt', group: 'draw' },
  { id: 'arcc', label: 'Arc from its centre', key: '', icon: 'circle-dashed', group: 'draw' },
  { id: 'point', label: 'Survey point (click to add)', key: 'N', icon: 'map-pin', group: 'draw' },
  { id: 'trim', label: 'Trim curves', key: 'W', icon: 'scissors', group: 'draft' },
  { id: 'extend', label: 'Extend curves', key: 'Y', icon: 'arrow-line-right', group: 'draft' },
  { id: 'split', label: 'Split a line (click where)', key: '', icon: 'scissors', group: 'draft' },
  { id: 'join', label: 'Join two lines (click near the ends)', key: '', icon: 'link', group: 'draft' },
  { id: 'calibrate', label: 'Calibrate drawing (scale, orient)', key: 'I', icon: 'ruler', group: 'draft' },
  { id: 'control', label: 'Control points (georeference a drawing)', key: 'J', icon: 'crosshair', group: 'draft' },
  { id: 'sculpt', label: 'Sculpt terrain (type: raise 5 0.5)', key: 'V', icon: 'paint-brush-broad', group: 'edit' },
  { id: 'pushpull', label: 'Push/Pull', key: 'P', icon: 'arrow-fat-lines-up', group: 'edit' },
  { id: 'move', label: 'Move (Ctrl copies)', key: 'M', icon: 'arrows-out-cardinal', group: 'edit' },
  { id: 'rotate', label: 'Rotate', key: 'Q', icon: 'arrow-clockwise', group: 'edit' },
  { id: 'scale', label: 'Scale', key: 'S', icon: 'arrows-out', group: 'edit' },
  { id: 'tape', label: 'Tape Measure (Ctrl: guide line, Alt: guide point)', key: 'T', icon: 'ruler', group: 'construct' },
  { id: 'dimension', label: 'Dimension (two points)', key: 'D', icon: 'arrows-horizontal', group: 'construct' },
  { id: 'label', label: 'Label (click a shape; type a template)', key: 'K', icon: 'tag', group: 'construct' },
  { id: 'text', label: 'Text (no leader)', key: '', icon: 'text-t', group: 'construct' },
  { id: 'surfedit', label: 'Edit surface (swap, delete, add or remove points, outline, holes)', key: '', icon: 'triangle', group: 'site' },
  { id: 'basepoint', label: 'Base point (click a point, type its coordinates)', key: '', icon: 'crosshair-simple', group: 'site' },
  { id: 'paint', label: 'Paint Bucket (Alt samples)', key: 'B', icon: 'paint-bucket', group: 'construct' },
  { id: 'matbrush', label: 'Material brush (paint surface materials for takeoff)', key: '', icon: 'paint-brush', group: 'construct' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser', group: 'construct' },
  { id: 'section', label: 'Section Plane', key: 'X', icon: 'knife', group: 'construct' },
  { id: 'orbit', label: 'Orbit (middle mouse)', key: 'O', icon: 'globe-simple', group: 'camera' },
  { id: 'walk', label: 'Walk (arrows or WASD, drag to look)', key: '', icon: 'person-simple-walk', group: 'camera' },
  { id: 'zoomwin', label: 'Zoom window (drag a box)', key: 'Z', icon: 'magnifying-glass-plus', group: 'camera' },
  { id: 'pan', label: 'Pan (right mouse)', key: 'H', icon: 'hand', group: 'camera' },
];

/** "1.5" → 1.5 m · "150mm" · "15cm" · "3'" · '6"'. Returns metres. */
export function parseLength(s) {
  const m = String(s).trim().match(/^(-?[\d.]+)\s*(mm|cm|m|km|'|"|ft|in)?$/i);
  if (!m) return NaN;
  const f = { mm: 0.001, cm: 0.01, m: 1, km: 1000, "'": 0.3048, ft: 0.3048, '"': 0.0254, in: 0.0254 }[(m[2] || 'm').toLowerCase()];
  return parseFloat(m[1]) * f;
}
let display = {};
/** The model's display units (#52): set by the app when the document changes. */
export const setDisplay = (d) => (display = d);
export const fmt = (m) => formatLength(m, display);

function basis(n) {
  if (Math.abs(n.y) > 0.99) return { u: AXES.x.clone(), v: AXES.z.clone().multiplyScalar(Math.sign(n.y) || 1) };
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
    // two fingers orbit and zoom (#113)
    this.touches = new Set();
    this.bind(this.vp.canvas, null);
    this.set('select');
  }

  /** The tools work on a pane's canvas (#162): each event runs with that pane's camera. */
  bind(c, pane) {
    // the gizmo's handles (#67) win over the tool under them
    const elsewhere = () => this.touches.size > 1 || !!this.vp.gizmo?.tc.axis || !!this.vp.gizmo?.dragging;
    const inPane = (fn) => this.guard(() => this.vp.withPane(pane, fn));
    // touchpads have no middle button: Alt + drag orbits and Alt + Shift + drag pans, with any tool. This capture
    // listener runs before OrbitControls' own, so the left button is mapped for this one drag.
    const altNav = (e) => e.button === 0 && e.altKey && e.pointerType !== 'touch';
    c.addEventListener('pointerdown', (e) => ((pane ? pane.controls : this.vp.controls).mouseButtons.LEFT = altNav(e) ? (e.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE) : this.leftNav ?? null), true);
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.touches.add(e.pointerId);
      // an Alt click that does not move (paint sample, tape guide) still reaches the tool, on release
      if (altNav(e) && this.leftNav == null) return void (this.altDrag = { e, moved: false });
      if (e.button === 0 && !elsewhere()) inPane(() => this.tool.down?.(e));
      if (e.button === 0 && this.only) (this.only = null), this.status(this.tool.hint); // a one-shot snap is used up
    });
    c.addEventListener('pointermove', (e) => {
      const a = this.altDrag;
      if (a) return void (a.moved ||= Math.hypot(e.clientX - a.e.clientX, e.clientY - a.e.clientY) > 4);
      if (!elsewhere()) inPane(() => this.tool.move?.(e));
    });
    c.addEventListener('pointerup', (e) => {
      const multi = elsewhere();
      this.touches.delete(e.pointerId);
      const a = this.altDrag;
      if (a && e.button === 0) {
        this.altDrag = null;
        if (!a.moved) inPane(() => (this.tool.down?.(a.e), this.tool.up?.(e)));
        return;
      }
      if (e.button === 0 && !multi) inPane(() => this.tool.up?.(e));
    });
    c.addEventListener('pointercancel', (e) => this.touches.delete(e.pointerId));
    c.addEventListener('dblclick', (e) => inPane(() => this.tool.dbl?.(e)));
    c.addEventListener('pointerleave', () => (this.label.hidden = true));
    // right-click without dragging (a right drag pans): the context menu (#193)
    let rdown = null;
    c.addEventListener('pointerdown', (e) => e.button === 2 && (rdown = { x: e.clientX, y: e.clientY }));
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (rdown && Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y) > 5) return;
      if (c.ownerDocument === document) inPane(() => this.app.ui.contextMenu(e));
    });
  }

  guard(fn) {
    try {
      const r = fn();
      if (r?.catch) r.catch((e) => this.app.ui.toast(e.message, 'danger'));
    } catch (e) {
      this.app.ui.toast(e.message, 'danger');
    }
  }

  /** Something just made follows the pointer until a click drops it (#207). */
  place(ids) {
    if (ids.some((id) => !this.vp.objs.get(id))) this.vp.rebuild(); // just made: draw it first
    this.placeIds = ids;
    this.set('place');
  }
  /** Let the user click a thing in the view for a form: resolves with its id (null: Esc). */
  pickEntity(hint = '') {
    const back = this.id === 'pick' ? 'select' : this.id;
    return new Promise((resolve) => {
      this.pickCount = 1;
      this.pickWhat = 'entity';
      this.pickHint = `${hint || 'Click it in the view.'} Esc to stop.`;
      this.pickDone = (ids) => {
        this.pickWhat = null;
        this.clear();
        setTimeout(() => this.set(back));
        resolve(ids[0] ?? null);
      };
      this.set('pick');
    });
  }
  /** Let the user click points in the view for a form: resolves with them (count 0: until Enter / Esc). */
  pickPoints(count = 1, hint = '') {
    const back = this.id === 'pick' ? 'select' : this.id;
    return new Promise((resolve) => {
      this.pickCount = count;
      this.pickHint = `${hint || 'Click a point.'}${count === 1 ? '' : ' Enter when done, Esc to stop.'}`;
      this.pickDone = (pts) => {
        this.clear();
        setTimeout(() => this.set(back));
        resolve(pts);
      };
      this.set('pick');
    });
  }

  set(id) {
    this.tool?.cancel?.();
    this.tool?.leave?.();
    this.clear();
    this.lock = null;
    this.id = id;
    this.tool = new IMPL[id](this);
    const left = (this.leftNav = id === 'orbit' ? THREE.MOUSE.ROTATE : id === 'pan' ? THREE.MOUSE.PAN : null);
    this.vp.controls.mouseButtons.LEFT = left;
    this.vp.canvas.dataset.tool = id;
    for (const p of this.vp.extra || []) (p.controls.mouseButtons.LEFT = left), (p.canvas.dataset.tool = id);
    this.app.ui.onTool(id);
    this.status(this.tool.hint);
  }

  status(hint, vcbLabel = this.tool?.vcbLabel || '') {
    this.app.ui.setStatus(hint, vcbLabel);
  }

  key(ev) {
    if (this.tool.key?.(ev)) return true; // a tool's own keys first (A: arc segments in the Line tool)
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
    // which snaps are on (#180): the model's settings, or only one kind for the next click
    const S = { ...SNAPS, ...(this.app.store.doc.settings.snaps || {}) };
    const on = (k) => (this.only ? this.only === k : S[k] !== false);
    const cat = (kind) => (/Mid|middle/.test(kind) ? 'midpoint' : kind === 'Point cloud' ? 'cloud' : 'endpoint');
    if (from && this.lock) return done({ point: closestOnLine(ray, from, AXES[this.lock]), kind: `On ${AXIS_NAME[this.lock]} axis`, axis: this.lock, hit });
    let best = null;
    let bestD = SNAP_PX;
    for (const s of [...extra.map((p) => ({ p, kind: 'Endpoint' })), ...vp.snapPoints()]) {
      if (!on(cat(s.kind))) continue;
      const sp = vp.toScreen(s.p);
      const d = Math.hypot(sp.x - mx, sp.y - my);
      if (!sp.behind && d < bestD) (bestD = d), (best = s);
    }
    if (best) return done({ point: best.p.clone(), kind: best.kind, hit, snapped: true });
    if (from && on('axis'))
      for (const k of ['x', 'z', 'y']) {
        const p = closestOnLine(ray, from, AXES[k]);
        const sp = vp.toScreen(p);
        if (Math.hypot(sp.x - mx, sp.y - my) < 10 && p.distanceTo(from) > 1e-3) return done({ point: p, kind: `On ${AXIS_NAME[k]} axis`, axis: k, hit });
      }
    if (plane) {
      const p = ray.intersectPlane(plane, new THREE.Vector3());
      if (p) return done({ point: Math.abs(plane.normal.y) > 0.99 && on('grid') ? snapToGrid(p) : p, kind: GRID && on('grid') && Math.abs(plane.normal.y) > 0.99 ? 'On grid' : 'On plane', hit });
    }
    if (hit && on('face')) return done({ point: hit.point.clone(), kind: 'On face', hit });
    const u = on('drawing') && vp.pickUnderlay();
    if (u) return done({ point: u.point, kind: 'On drawing', hit: null });
    const p = ray.intersectPlane(fallback || new THREE.Plane(V(0, 1, 0), 0), new THREE.Vector3());
    return done({ point: p ? (on('grid') ? snapToGrid(p) : p) : from?.clone() || V(), kind: fallback ? 'Level' : GRID && on('grid') ? 'On grid' : 'On ground', hit: null });
  }

  showSnap(r) {
    const s = this.vp.toScreen(r.point);
    const wrap = this.vp.canvas.parentElement.getBoundingClientRect(); // the view area: every docked pane is inside it
    if (this.vp.input.ownerDocument !== document) return void (this.label.hidden = true); // a detached pane
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
  hint = 'Click to select, Shift toggles, drag for a box. Drag a corner, edge or curve point of the selected shape to move it. Double-click a group to edit inside it. Esc leaves.';
  constructor(t) {
    this.t = t;
  }
  leave() {
    this.showGrips(null);
  }

  // ---------------------------------------------------------------- grips (#181): corners, edge middles, curve points
  /** The grips of the one selected shape: [{ p (world), kind: corner | edge | point, ids }], or null. */
  gripsOf() {
    const app = this.t.app;
    if (app.selection.length !== 1) return null;
    const e = app.entity(app.selection[0]);
    const doc = app.store.doc;
    if (!e || L.isLocked(doc, e) || e.annotation || e.point) return null;
    // surfaces and road designs are edited through their sources (points, alignment), not by their corners
    const gen = e.derived?.generator;
    if (e.meta?.surface || ['surface', 'corridor', 'finished_ground', 'pad'].includes(gen) || gen?.startsWith('design_')) return null;
    if (e.mesh && e.mesh.v.length <= 400) {
      const wm = D.worldMesh(doc, e);
      const grips = wm.v.map((p, i) => ({ p: V(...p), kind: 'corner', ids: [i] }));
      const seen = new Set();
      for (const f of wm.f)
        f.forEach((a, k) => {
          const b = f[(k + 1) % f.length];
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (seen.has(key)) return;
          seen.add(key);
          grips.push({ p: V(...wm.v[a]).add(V(...wm.v[b])).multiplyScalar(0.5), kind: 'edge', ids: [a, b] });
        });
      return { e, grips };
    }
    if (e.curve && e.curve.points.length <= 400 && !e.alignment) {
      const m = new THREE.Matrix4().fromArray(D.worldMatrix(doc, e).elements);
      return { e, grips: e.curve.points.map((p, i) => ({ p: V(...p).applyMatrix4(m), kind: 'point', ids: [i] })) };
    }
    return null;
  }
  showGrips(g) {
    const vp = this.t.vp;
    if (this.gripObj) vp.scene.remove(this.gripObj), this.gripObj.geometry.dispose();
    this.gripObj = null;
    if (!g) return void (vp.dirty = true);
    const geo = new THREE.BufferGeometry().setFromPoints(g.grips.map((x) => x.p));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.grips.flatMap((x) => (x.kind === 'edge' ? [0.55, 0.75, 0.85] : [0.18, 0.44, 0.53])), 3));
    this.gripObj = new THREE.Points(geo, new THREE.PointsMaterial({ size: 14, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    this.gripObj.renderOrder = 997;
    vp.scene.add(this.gripObj);
    vp.dirty = true;
  }
  /** Keep the grips on the selected shape (cheap: only when the selection or the document changed). */
  syncGrips() {
    const key = `${this.t.app.selection.join()}|${this.t.app.store.doc.journal?.length ?? 0}|${this.t.app.store.doc.entities.length}`;
    if (key === this.gripKey && !this.grip) return this.grips;
    this.gripKey = key;
    this.grips = this.gripsOf();
    this.showGrips(null); // grips show one at a time, near the pointer (#206)
    return this.grips;
  }
  /** Is a world point hidden behind a face (seen from the camera)? */
  occluded(p) {
    const vp = this.t.vp;
    const cam = vp.camera.position;
    const dir = p.clone().sub(cam);
    const dist = dir.length();
    const rc = new THREE.Raycaster(cam.clone(), dir.normalize(), 0, dist);
    const meshes = [];
    vp.modelRoot.traverseVisible((o) => o.isMesh && !o.userData.underlay && !o.userData.isCurve && meshes.push(o));
    const hit = rc.intersectObjects(meshes, false)[0];
    return !!hit && hit.distance < dist - Math.max(0.01, dist * 0.002);
  }
  /** Near a corner or edge of the selected shape: highlight that one grip, like a snap. */
  hoverGrip(ev) {
    const g = this.gripAt(ev);
    const key = g ? `${g.kind}:${g.ids.join()}` : null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.showGrips(g ? { grips: [g] } : null);
    if (g) this.t.status(`Drag the ${g.kind === 'edge' ? 'edge' : g.kind === 'point' ? 'curve point' : 'corner'} to move it.`);
  }
  gripAt(ev) {
    const g = this.syncGrips();
    if (!g) return null;
    let best = null;
    for (const x of g.grips) {
      const s = this.t.vp.toScreen(x.p);
      const d = Math.hypot(s.x - ev.clientX, s.y - ev.clientY);
      if (!s.behind && d < 12 && (!best || d < best.d || (d === best.d && x.kind !== 'edge'))) best = { ...x, d };
    }
    if (best && this.occluded(best.p)) return null; // not through a face
    return best && { e: g.e, ...best };
  }
  gripMove(ev) {
    const g = this.grip;
    const inf = this.t.infer(ev, { from: g.p, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(V(0, 1, 0), g.p) });
    g.to = inf.point.clone();
    this.t.vp.overlay.clear();
    this.t.lines([g.p, g.to], inf.axis ? AXIS_COLORS[inf.axis] : ACCENT);
    this.t.status(`Move the ${g.kind === 'edge' ? 'edge' : g.kind === 'point' ? 'curve point' : 'corner'} ${fmt(g.to.distanceTo(g.p))}. Let go where it goes.`);
  }
  async gripCommit(to) {
    const g = this.grip;
    this.grip = null;
    this.t.clear();
    if (!to || to.distanceTo(g.p) < 1e-6) return;
    const by = to.clone().sub(g.p).toArray().map((x) => Math.round(x * 1e6) / 1e6);
    if (g.kind === 'point') {
      const m = new THREE.Matrix4().fromArray(D.worldMatrix(this.t.app.store.doc, g.e).elements);
      const pts = g.e.curve.points.map((p, i) => (i === g.ids[0] ? to.toArray() : V(...p).applyMatrix4(m).toArray()));
      await this.t.run('set_curve', { id: g.e.id, points: pts });
    } else await this.t.run('move_elements', { id: g.e.id, vertices: g.ids, by });
    this.gripKey = null;
  }
  /** Over a surface: its elevation and slope there, in the status bar. */
  readout(ev) {
    const now = performance.now();
    if (now - (this.last || 0) < 60) return;
    this.last = now;
    const hit = this.t.vp.pick(ev);
    const e = hit && this.t.app.entity(hit.entityId);
    if (!e?.mesh || !(e.meta?.surface || e.derived?.generator === 'surface' || e.derived?.report)) return this.shown && ((this.shown = false), this.t.status(this.hint));
    const base = this.t.app.store.doc.geo?.base?.[2] ?? 0;
    const n = hit.normal;
    const slope = Math.hypot(n.x, n.z) / Math.max(1e-9, Math.abs(n.y));
    this.shown = true;
    this.t.status(`${e.name}: Z ${(hit.point.y + base).toFixed(3)} · slope ${(slope * 100).toFixed(1)} % (${((Math.atan(slope) * 180) / Math.PI).toFixed(1)}°)`);
  }
  down(ev) {
    const g = !ev.shiftKey && !ev.ctrlKey && this.gripAt(ev);
    this.start = { x: ev.clientX, y: ev.clientY };
    if (g) return void (this.grip = { ...g, to: g.p.clone() });
    // a selected dimension or label: drag its text (#182)
    const ann = !ev.shiftKey && !ev.ctrlKey && this.t.vp.pickAnnotation(ev);
    if (ann && this.t.app.selection.includes(ann.entityId)) {
      const e = this.t.app.entity(ann.entityId);
      const at0 = V(...e.annotation.at);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.t.vp.camera.getWorldDirection(V()).negate(), at0);
      const start = this.t.vp.ray(ev).intersectPlane(plane, V());
      if (start) return void (this.annDrag = { e, at0, plane, start, delta: V() });
    }
    this.start = { x: ev.clientX, y: ev.clientY };
  }
  move(ev) {
    if (this.grip) return this.gripMove(ev);
    if (this.annDrag) {
      const d = this.annDrag;
      const p = this.t.vp.ray(ev).intersectPlane(d.plane, V());
      if (!p) return;
      d.delta = p.sub(d.start);
      this.t.vp.overlay.clear();
      this.t.lines([d.at0, d.at0.clone().add(d.delta)], ACCENT);
      return this.t.status(`Move the text of ${d.e.name} ${fmt(d.delta.length())}`);
    }
    if (!this.start) {
      this.hoverGrip(ev);
      return this.readout(ev);
    }
    const r = this.t.vp.canvas.parentElement.getBoundingClientRect();
    const [x0, x1] = [this.start.x, ev.clientX].sort((a, b) => a - b);
    const [y0, y1] = [this.start.y, ev.clientY].sort((a, b) => a - b);
    Object.assign(this.t.box.style, { left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    this.t.box.hidden = x1 - x0 < 4 && y1 - y0 < 4;
    // left to right: a window (what is fully inside); right to left: a crossing (what it touches) (#191)
    const crossing = ev.clientX < this.start.x;
    this.t.box.dataset.mode = crossing ? 'crossing' : 'window';
    if (!this.t.box.hidden) this.t.status(crossing ? 'Crossing: selects what the box touches.' : 'Window: selects what is fully inside the box.');
  }
  up(ev) {
    if (this.annDrag) {
      const { e, delta } = this.annDrag;
      this.annDrag = null;
      this.t.clear();
      this.t.status(this.hint);
      if (delta.length() < 1e-4) return;
      const n = e.annotation;
      const r4 = (x) => Math.round(x * 1e4) / 1e4;
      if (n.type === 'label') {
        const off = n.offset || (n.leader === false ? [0, 0, 0] : [0.6, 0.9, 0]);
        return this.t.run('edit_annotation', { id: e.id, offset: off.map((x, k) => r4(x + delta.getComponent(k))) });
      }
      if (n.frame) {
        const side = V(...n.frame.side);
        const dir = V(...n.frame.dir);
        return this.t.run('edit_annotation', { id: e.id, offset: r4((n.offset ?? 0.5) + delta.dot(side)), text_shift: r4((n.text_shift || 0) + delta.dot(dir)) });
      }
      return;
    }
    if (this.grip) {
      const g = this.grip;
      if (Math.hypot(ev.clientX - this.start.x, ev.clientY - this.start.y) >= 4) {
        this.start = null;
        return this.gripCommit(g.to);
      }
      // a click on a grip without dragging: an ordinary click (it may pick a survey point on that corner)
      this.grip = null;
      this.t.clear();
    }
    const app = this.t.app;
    const s = this.start;
    this.start = null;
    this.t.box.hidden = true;
    if (!s) return;
    let ids;
    if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < 4) {
      const mesh = this.t.vp.pick(ev); // also aims the ray for the two below
      const hit = this.t.vp.pickAnnotation(ev) || this.t.vp.pickPoint() || mesh || this.t.vp.pickCurve() || this.t.vp.pickUnderlay(); // a survey point wins over the surface under it; drawings come last
      ids = hit ? [app.pickTarget(hit.entityId)] : [];
    } else {
      const [x0, x1] = [s.x, ev.clientX].sort((a, b) => a - b);
      const [y0, y1] = [s.y, ev.clientY].sort((a, b) => a - b);
      ids = app.store.doc.entities
        .filter((e) => e.parent === app.context && !L.isLocked(app.store.doc, e))
        .filter((e) => {
          const b = D.worldBox(app.store.doc, e);
          if (!b || !isFinite(b.min[0])) return false;
          const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => this.t.vp.toScreen(V(k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]))).filter((p) => !p.behind);
          if (!corners.length) return false;
          const inside = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
          if (ev.clientX >= s.x) return corners.every(inside); // window
          const [cx0, cx1] = [Math.min(...corners.map((p) => p.x)), Math.max(...corners.map((p) => p.x))];
          const [cy0, cy1] = [Math.min(...corners.map((p) => p.y)), Math.max(...corners.map((p) => p.y))];
          return cx0 <= x1 && cx1 >= x0 && cy0 <= y1 && cy1 >= y0; // crossing: the boxes overlap
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
    this.on = inf.hit && inf.kind !== 'On ground' ? { id: inf.hit.entityId, face: inf.hit.faceIndex } : null;
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
    const on = this.on;
    this.cancel();
    if (area < 1e-8) return;
    if (on && this.t.app.entity(on.id)?.mesh) {
      // drawn on a face: imprint it there, so Push/Pull makes a recess, a boss or a hole
      const ok = await this.t.run('imprint', { id: on.id, face: on.face, points: p }).then(() => true, () => false);
      if (ok) return this.t.status('Imprinted on the face. Push/Pull (P) it in or out; all the way through makes a hole.');
    }
    const r = await this.t.run('create_face', { points: p, normal: this.n.toArray(), name, split: true, ...(this.t.app.context ? { parent: this.t.app.context } : {}) });
    if (r?.split) return this.t.status(`Drawn over ${r.name}: ${r.split} faces now; Push/Pull (P) each part on its own.`);
    this.t.status('Face made. Push/Pull (P) gives it thickness.');
  }
}

class LineTool extends DrawBase {
  hint = 'Click points to draw a line; Enter, Esc or a double-click ends it. Close it on the first point to make a face. Type a length for the next segment.';
  vcbLabel = 'Length';
  pts = [];
  busy() {
    return this.pts.length > 0;
  }
  /** Ending a line keeps it (#176): two or more points are an open polyline. */
  cancel() {
    if (this.pts.length >= 2) this.t.guard(() => this.finish());
    this.pts = [];
    this.t.clear();
  }
  async finish() {
    const pts = this.pts.filter((p, i, a) => !i || p.distanceTo(a[i - 1]) > 1e-6).map((p) => p.toArray());
    this.pts = [];
    this.t.clear();
    if (pts.length < 2) return;
    await this.t.run('create_curve', { points: pts, kind: 'polyline', name: 'Line' });
    this.t.status(`Line of ${pts.length - 1} segment${pts.length > 2 ? 's' : ''} kept. ${this.hint}`);
  }
  dbl() {
    return this.finish();
  }
  /** A while drawing: the next segments are arcs, tangent to the line so far (#177); A again: straight. */
  key(ev) {
    if (ev.key.toLowerCase() !== 'a' || ev.ctrlKey || ev.metaKey || !this.pts.length) return false;
    this.arc = !this.arc;
    this.t.status(this.arc ? 'Arc segments: tangent to the line so far. A again for straight.' : 'Straight segments. A for arcs.');
    return true;
  }
  /** The tangent arc from the last point to p, as points (the last point left out); straight when it cannot bend. */
  arcTo(p) {
    const L = this.pts.at(-1);
    const prev = this.pts.at(-2);
    if (!prev) return [p];
    const t = L.clone().sub(prev).normalize();
    const n = this.n.clone().normalize();
    const side = n.clone().cross(t).normalize(); // in the plane, square to the tangent
    const d = p.clone().sub(L);
    const h = d.dot(side);
    if (Math.abs(h) < 1e-6) return [p];
    const r = d.lengthSq() / (2 * h); // signed: the centre is on the side of p
    const c = L.clone().addScaledVector(side, r);
    const a0 = L.clone().sub(c);
    const a1 = p.clone().sub(c);
    let sweep = Math.atan2(a0.clone().cross(a1).dot(n), a0.dot(a1));
    if (Math.sign(sweep) !== Math.sign(r * 1)) sweep += Math.sign(r) * 2 * Math.PI; // keep going the way the tangent points
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    return Array.from({ length: steps }, (_, k) => a0.clone().applyAxisAngle(n, (sweep * (k + 1)) / steps).add(c));
  }
  move(ev) {
    const last = this.pts.at(-1);
    const inf = this.t.infer(ev, { from: last, extra: this.pts.slice(0, 1) });
    this.cur = inf.point;
    if (!last) return;
    this.t.vp.overlay.clear();
    this.t.lines([...this.pts, ...(this.arc ? this.arcTo(this.cur) : [this.cur])], inf.axis ? AXIS_COLORS[inf.axis] : 0x1d262c);
    this.t.status(`${this.arc ? 'Arc to' : 'Length'} ${fmt(last.distanceTo(this.cur))}${this.arc ? '' : ' · A for an arc'}`, 'Length');
  }
  async down(ev) {
    const inf = this.t.infer(ev, { from: this.pts.at(-1), extra: this.pts.slice(0, 1) });
    if (!this.pts.length && inf.hit) (this.n = inf.hit.normal.clone()), (this.on = inf.kind !== 'On ground' ? { id: inf.hit.entityId, face: inf.hit.faceIndex } : null);
    else if (!this.pts.length) (this.n = V(0, 1, 0)), (this.on = null);
    if (this.arc && this.pts.length >= 2) {
      const arc = this.arcTo(inf.point);
      this.pts.push(...arc.slice(0, -1).map((p) => p.clone()));
    }
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

/** Rotated rectangle (#29): a corner, a point along the first side, then the width. */
class Rect3Tool {
  hint = 'Click a corner, a point along the first side, then drag out the width.';
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
    const inf = this.t.infer(ev, { from: this.pts.at(-1) });
    if (!this.pts.length) return;
    this.t.vp.overlay.clear();
    if (this.pts.length === 1) return this.t.lines([this.pts[0], inf.point], ACCENT);
    try {
      const c = MD.rectangle3(this.pts[0].toArray(), this.pts[1].toArray(), inf.point.toArray()).map((p) => V(...p));
      this.t.lines(c, ACCENT, true);
      this.t.status(`${fmt(c[0].distanceTo(c[1]))} × ${fmt(c[1].distanceTo(c[2]))}`);
    } catch {
      /* no width yet */
    }
  }
  async down(ev) {
    const inf = this.t.infer(ev, { from: this.pts.at(-1) });
    this.pts.push(inf.point.clone());
    if (this.pts.length < 3) return;
    const [a, b, c] = this.pts.map((p) => D.round3(p.toArray()));
    this.cancel();
    await this.t.run('create_rectangle', { points: [a, b, c] });
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
    if (L.isLocked(this.t.app.store.doc, e)) throw new Error(`${e.name} is locked.`);
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
      const locked = e && L.isLocked(this.t.app.store.doc, e);
      if (locked) this.t.app.ui.toast(`${e.name} is locked${e.locked ? '' : ` (layer ${e.tag})`}.`);
      return e && !locked;
    });
    if (!this.ids.length) return (this.ids = null), false;
    this.orig = this.ids.map((id) => ({ o: vp.objs.get(id), m: vp.objs.get(id).matrixWorld.clone() }));
    return true;
  }
  previewWorld(fn) {
    for (const { o, m } of this.orig) {
      if (!o?.parent) continue; // replaced by a rebuild since
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

/**
 * Scale (#185): click a shape and its scale handles appear: the centre box scales it evenly, an axis box along that
 * axis (each drag is one undo step). Or type a factor (2, 0.5) or "1,2,1" and Enter. The handles go when you leave.
 */
class ScaleTool {
  hint = 'Click what to scale: handles appear. Drag the centre box to scale evenly, an axis box along that axis, or type a factor (2, 0.5, "1,2,1") and Enter.';
  vcbLabel = 'Scale';
  constructor(t) {
    this.t = t;
    this.prev = t.app.store.doc.settings.gizmo || null;
  }
  async down(ev) {
    const hit = this.t.vp.pick(ev) || this.t.vp.pickCurve();
    if (!hit) return this.t.app.select([]);
    const id = this.t.app.pickTarget(hit.entityId);
    const e = this.t.app.entity(id);
    if (e && L.isLocked(this.t.app.store.doc, e)) return this.t.app.ui.toast(`${e.name} is locked.`);
    this.t.app.select([id]);
    if (this.t.app.store.doc.settings.gizmo !== 'scale') await this.t.run('set_gizmo', { mode: 'scale' });
    this.t.status(`${e?.name}: drag a handle, or type a factor and Enter.`, 'Scale');
  }
  vcb(text) {
    const ids = this.t.app.selection;
    const f = text.split(/[,;\s]+/).map(Number);
    if (!ids.length || !f.every((x) => x > 0)) return;
    return this.t.run('scale', { ids, factor: f.length === 3 ? f : f[0], pivot: 'base' });
  }
  leave() {
    if (this.t.app.store.doc.settings.gizmo === 'scale' && this.prev !== 'scale') this.t.run('set_gizmo', { mode: this.prev || 'off' }).catch(() => {});
  }
}

class TapeTool {
  hint = 'Click two points to measure. Ctrl on the second click leaves a guide line through them; Alt-click drops a guide point.';
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
    if (!this.p1 && ev.altKey) return void this.t.run('add_guide', { point: D.round3(inf.point.toArray()) });
    if (!this.p1) return void (this.p1 = inf.point);
    if (ev.ctrlKey) {
      const [a, b] = [this.p1, inf.point];
      this.p1 = null;
      this.t.clear();
      return void this.t.run('add_guide', { point: D.round3(a.toArray()), to: D.round3(b.toArray()) });
    }
    const d = this.p1.distanceTo(inf.point);
    const delta = inf.point.clone().sub(this.p1);
    this.p1 = null;
    this.t.status(`Distance ${fmt(d)}  (Δx ${fmt(delta.x)}, Δy ${fmt(delta.y)}, Δz ${fmt(delta.z)})`);
    this.t.app.ui.toast(`Measured ${fmt(d)}`);
  }
}

class PaintTool {
  hint = 'Click a shape to paint it with the colour or textured material chosen in the Materials panel. Alt-click samples one.';
  constructor(t) {
    this.t = t;
  }
  async down(ev) {
    const hit = this.t.vp.pick(ev);
    if (!hit) return;
    const m = this.t.app.entity(hit.entityId).material;
    if (ev.altKey) return this.t.app.ui.setPaint({ ...m, material: m.texture && TX_NAMES.has(m.name) ? m.name : undefined });
    const ids = [this.t.app.pickTarget(hit.entityId)];
    if (this.t.paint.material) return this.t.run('apply_material', { ids, material: this.t.paint.material });
    await this.t.run('set_material', { ids, ...this.t.paint });
  }
}

/**
 * Material brush: paints surface materials face by face for takeoff. Brush (drag; [ ] change the radius), Fill (click:
 * the region up to bends, lines and other paint), Erase. Alt-click samples. The settings live in a bar in the view.
 */
export const BRUSH = { material: 'Asphalt', mode: 'brush', radius: 1, angle: 30 };
class MaterialBrushTool {
  hint = 'Drag over a surface to paint the material (one undo step per stroke). Fill: click a face to fill its region up to lines and edges. Alt-click samples. [ ] change the radius.';
  constructor(t) {
    this.t = t;
    this.s = BRUSH;
    this.bar = h('div.view-hud', { role: 'toolbar', 'aria-label': 'Material brush' });
    document.querySelector('.viewport-wrap').append(this.bar);
    this.renderBar();
  }
  leave() {
    this.bar.remove();
    this.t.vp.overlay.clear();
  }
  lib() {
    return TK.library(this.t.app.store.doc);
  }
  renderBar() {
    const s = this.s;
    if (!TK.find(this.t.app.store.doc, s.material)) s.material = this.lib()[0]?.name;
    const m = TK.find(this.t.app.store.doc, s.material);
    const seg = (id, label, ic) => h('button.btn.sm', { 'aria-pressed': String(s.mode === id), title: label, onclick: () => ((s.mode = id), this.renderBar()) }, h(`i.ph.ph-${ic}`), label);
    const sel = this.t.app.selection.map((id) => this.t.app.entity(id)).find((e) => e?.curve?.closed);
    const kids = [
      h('i.swatch-dot', { style: { background: m?.color || '#888' } }),
      h('select', { 'aria-label': 'Material', title: m ? `${m.code || 'no code'} · ${m.thickness || 0} m thick · ${m.density || 0} kg/m³ · ${m.cost || 0}/m²` : '', onchange: (ev) => ((s.material = ev.target.value), this.renderBar()) }, ...this.lib().map((x) => h('option', { value: x.name, selected: x.name === s.material }, x.name))),
      h('span.seg-group', {}, seg('brush', 'Brush', 'paint-brush'), seg('fill', 'Fill', 'paint-bucket'), seg('erase', 'Erase', 'eraser')),
      s.mode === 'fill'
        ? h('label', { title: 'Largest bend between faces the fill crosses' }, 'Bend ', h('input', { type: 'number', min: 0, max: 180, step: 5, value: s.angle, onchange: (ev) => (s.angle = +ev.target.value || 30) }), '°')
        : h('label', {}, 'Radius ', h('input', { type: 'number', min: 0.05, step: 0.25, value: s.radius, onchange: (ev) => (s.radius = Math.max(0.05, +ev.target.value || 1)) }), ' m'),
      sel ? h('button.btn.sm', { title: `Paint every face inside "${sel.name}"`, onclick: () => this.paintInside(sel) }, h('i.ph.ph-selection'), `Inside ${sel.name}`) : null,
      h('button.btn.sm', { title: 'Material manager: library, show / hide, takeoff', onclick: () => this.t.app.ui.materialManager() }, h('i.ph.ph-table'), 'Manager'),
    ];
    this.bar.replaceChildren(...kids.filter(Boolean));
  }
  material() {
    return this.s.mode === 'erase' ? 'none' : this.s.material;
  }
  /** Every visible mesh with faces inside the closed curve, in one undo step. */
  async paintInside(curve) {
    const doc = this.t.app.store.doc;
    const poly = D.curvePoints(doc, curve).map((p) => [p[0], p[2]]);
    const ids = doc.entities.filter((e) => e.mesh && e.visible !== false && TK.facesInside(D.worldMesh(doc, e), poly).length).map((e) => e.id);
    if (!ids.length) return this.t.app.ui.toast(`No faces inside ${curve.name}`, 'warning');
    await this.t.run('run_script', { code: ids.map((id) => `await api.paint_surface(${JSON.stringify({ id, material: this.material(), inside: curve.id })});`).join('\n') });
    this.t.app.ui.toast(`Painted inside ${curve.name} on ${ids.length} surface${ids.length > 1 ? 's' : ''}`);
  }
  ring(hit) {
    this.t.vp.overlay.clear();
    if (this.stroke) this.preview();
    if (!hit || this.s.mode === 'fill') return hit && this.t.faceHighlight(hit);
    const n = hit.normal;
    const { u, v } = basis(n);
    const pts = Array.from({ length: 49 }, (_, k) => {
      const a = (k / 48) * Math.PI * 2;
      return hit.point.clone().addScaledVector(u, Math.cos(a) * this.s.radius).addScaledVector(v, Math.sin(a) * this.s.radius).addScaledVector(n, 0.02);
    });
    this.t.lines(pts, HIGHLIGHT);
  }
  preview() {
    const { e, faces, obj } = this.stroke;
    if (!faces.size) return;
    const sub = { v: e.mesh.v, f: [...faces].map((fi) => e.mesh.f[fi]) };
    this.t.ghost(sub, obj.matrixWorld, this.s.mode === 'erase' ? 0xffffff : TK.find(this.t.app.store.doc, this.s.material)?.color || ACCENT, 0.6);
  }
  collect(hit) {
    const st = this.stroke;
    if (!hit || hit.entityId !== st.e.id) return;
    for (const fi of TK.facesNear(st.w, hit.point.toArray(), this.s.radius)) st.faces.add(fi);
  }
  async down(ev) {
    const hit = this.t.vp.pick(ev);
    if (!hit) return;
    const e = this.t.app.entity(hit.entityId);
    if (!e?.mesh) return;
    if (ev.altKey) {
      const name = e.fm?.[hit.faceIndex];
      if (name) (this.s.material = name), (this.s.mode = 'brush'), this.renderBar();
      return this.t.status(name ? `Sampled ${name}` : 'That face has no surface material');
    }
    if (this.s.mode === 'fill') return this.t.run('paint_surface', { id: e.id, material: this.material(), seed: hit.faceIndex, fill: true, angle: this.s.angle, breaklines: this.breaklines() }).then((r) => this.t.status(`Filled ${r.faces} faces, ${r.area} m²`));
    this.stroke = { e, w: D.worldMesh(this.t.app.store.doc, e), faces: new Set(), obj: hit.object };
    this.collect(hit);
    this.ring(hit);
  }
  /** Curves and linework in view: the fill does not cross them (kerbs, edges of seal, boundaries). */
  breaklines() {
    return this.t.app.store.doc.entities.filter((e) => e.visible !== false && (e.curve || e.type === 'linework')).map((e) => e.id).slice(0, 200);
  }
  move(ev) {
    const hit = this.t.vp.pick(ev);
    if (this.stroke) this.collect(hit);
    this.ring(hit);
  }
  async up() {
    const st = this.stroke;
    this.stroke = null;
    this.t.vp.overlay.clear();
    if (!st?.faces.size) return;
    const r = await this.t.run('paint_surface', { id: st.e.id, material: this.material(), faces: [...st.faces] });
    this.t.status(`${r.material === 'none' ? 'Cleared' : `Painted ${r.material} on`} ${r.faces} faces, ${r.area} m²`);
  }
  cancel() {
    this.stroke = null;
    this.t.vp.overlay.clear();
  }
  key(ev) {
    if (ev.key !== '[' && ev.key !== ']') return false;
    this.s.radius = Math.max(0.05, Math.round(this.s.radius * (ev.key === ']' ? 1.25 : 0.8) * 100) / 100);
    this.renderBar();
    this.t.status(`Brush radius ${fmt(this.s.radius)}`);
    return true;
  }
}

class EraserTool {
  hint = 'Click a shape, group, line, dimension or label to delete it.';
  constructor(t) {
    this.t = t;
  }
  async down(ev) {
    const mesh = this.t.vp.pick(ev);
    const hit = this.t.vp.pickAnnotation(ev) || this.t.vp.pickPoint() || mesh || this.t.vp.pickCurve();
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
  hint = 'Drag to navigate. With any tool: middle mouse or Alt + drag orbits, right mouse or Alt + Shift + drag pans, the wheel or a pinch zooms.';
  constructor(t) {
    this.t = t;
  }
}

/** Walk (#69): at eye height, arrows or WASD to walk (Shift runs), drag to look; floors and steps followed, walls stop you. */
class WalkTool {
  hint = 'Walk: arrows or W A S D (Shift runs), drag to look around. Steps up to 45 cm are climbed; walls stop you.';
  constructor(t) {
    this.t = t;
    this.eye = 1.6;
    this.keys = new Set();
    const vp = t.vp;
    const cam = vp.camera.position;
    const floor = floorAt(vp, cam.clone(), 0.5);
    if (Math.abs(cam.y - floor - this.eye) > 0.3) vp.walkTo(cam.toArray(), vp.controls.target.toArray(), this.eye);
    const dir = vp.controls.target.clone().sub(vp.camera.position);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(Math.max(-0.99, Math.min(0.99, dir.normalize().y)));
    this.down_ = (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'shift'].includes(k) && !e.target.closest('input, textarea')) this.keys.add(k), e.preventDefault(), e.stopPropagation();
    };
    this.up_ = (e) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', this.down_, true);
    window.addEventListener('keyup', this.up_, true);
    let last = performance.now();
    const tick = (now) => {
      if (this.gone) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.step(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  look() {
    const vp = this.t.vp;
    const p = vp.camera.position;
    const d = V(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    vp.controls.target.copy(p).add(d);
    vp.camera.lookAt(vp.controls.target);
    vp.dirty = true;
  }
  step(dt) {
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    if (!f && !s) return;
    const vp = this.t.vp;
    const speed = (k.has('shift') ? 4 : 1.4) * dt;
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = V(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const d = fwd.multiplyScalar(f * speed).addScaledVector(right, s * speed);
    const p = vp.camera.position;
    if (blocked(vp, p, d, this.eye)) return this.t.status('Something is in the way.');
    const next = p.clone().add(d);
    next.y = floorAt(vp, V(next.x, p.y - this.eye, next.z), 0.5) + this.eye;
    p.copy(next);
    this.look();
  }
  down(ev) {
    this.drag = [ev.clientX, ev.clientY];
  }
  move(ev) {
    if (!this.drag || !(ev.buttons & 1)) return;
    this.yaw -= (ev.clientX - this.drag[0]) * 0.004;
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - (ev.clientY - this.drag[1]) * 0.004));
    this.drag = [ev.clientX, ev.clientY];
    this.look();
  }
  up() {
    this.drag = null;
  }
  leave() {
    this.gone = true;
    window.removeEventListener('keydown', this.down_, true);
    window.removeEventListener('keyup', this.up_, true);
  }
}

/** Survey point: click to add one (snapped); its code card asks for the code (Enter repeats the last one). */
class PointTool {
  hint = 'Click to add a survey point, then type or pick its code and press Enter (Esc: no point). Click a point to change its code. Value box: "E, N, Z" adds one there, #name renames the last one.';
  vcbLabel = 'Code · E,N,Z · #name';
  constructor(t) {
    this.t = t;
    this.code = '';
  }
  move(ev) {
    this.t.infer(ev);
  }
  async down(ev) {
    if (this.asking) return;
    const p = this.t.infer(ev).point;
    const hit = this.t.vp.pickPoint();
    const old = hit && this.t.app.entity(hit.entityId);
    this.asking = true;
    let code;
    try {
      // the code card (#217): click → type or pick a code → Enter
      code = await this.t.app.ui.codeCard(ev, old ? old.point.code : this.code, old ? `Code of ${old.name}` : 'Code of the new point');
    } finally {
      this.asking = false;
    }
    if (code === null) return this.t.status(old ? 'Code unchanged.' : 'No point added.');
    if (old) {
      if (code !== old.point.code) await this.t.run('edit_points', { points: [old.id], code });
      return this.t.status(`Point ${old.name}: code ${code || '(none)'}.`);
    }
    this.code = code;
    const r = await this.t.run('add_point', { at: D.round3(p.toArray()), code });
    this.last = r.id;
    this.t.status(`Point ${r.name}: N ${r.n.toFixed(3)} E ${r.e.toFixed(3)} Z ${r.z.toFixed(3)}${code ? ` · ${code}` : ''}. Type #name to rename it.`);
  }
  /** The value box (#188): coordinates add a point there, #name renames the last point, anything else is the code. */
  async vcb(text) {
    const t = text.trim();
    const nums = t.split(/[,;\s]+/).map(Number);
    if (nums.length >= 2 && nums.length <= 3 && nums.every(Number.isFinite)) {
      const [e, n, z = 0] = nums;
      const r = await this.t.run('add_point', { e, n, z, code: this.code });
      this.last = r.id;
      return this.t.status(`Point ${r.name} at E ${e} N ${n} Z ${z}.`);
    }
    const m = t.match(/^#\s*(.+)$/);
    if (m) {
      if (!this.last) return this.t.status('Place a point first, then type #name to rename it.');
      await this.t.run('set_properties', { ids: [this.last], name: m[1].trim() });
      return this.t.status(`Renamed the point to ${m[1].trim()}.`);
    }
    this.code = t;
    this.t.status(`Code for the next points: ${this.code || '(none)'}`);
  }
}

/** Calibrate a drawing: click two points on it, then type their real distance (scale) or the bearing of A→B (orient). */
class CalibrateTool {
  hint = 'Click two points on a drawing, then type their real distance (12.5) to scale it, or the bearing of that line (90°, 0 = north) to turn it.';
  vcbLabel = 'Distance / °';
  constructor(t) {
    this.t = t;
  }
  busy() {
    return !!this.a;
  }
  cancel() {
    this.a = this.b = this.id = null;
    this.t.clear();
  }
  at(ev) {
    const inf = this.t.infer(ev);
    const u = this.t.vp.pickUnderlay(this.id);
    return { p: inf.snapped || !u ? inf.point : u.point, u };
  }
  move(ev) {
    if (!this.a || this.b) return;
    const { p } = this.at(ev);
    this.t.vp.overlay.clear();
    this.t.lines([this.a, p], HIGHLIGHT);
    this.t.status(`On the drawing it measures ${fmt(this.a.distanceTo(p))}. Click the second point.`);
  }
  down(ev) {
    const { p, u } = this.at(ev);
    if (!this.a || this.b) {
      if (!u) throw new Error('Click on a drawing (import a PDF or an image first).');
      this.cancel();
      this.id = u.entityId;
      this.a = p;
      return;
    }
    this.b = p;
    this.t.vp.overlay.clear();
    this.t.lines([this.a, this.b], HIGHLIGHT);
    this.t.status(`Measures ${fmt(this.a.distanceTo(this.b))} now: type the real distance, or a bearing like 90°.`);
  }
  async vcb(text) {
    if (!this.b) throw new Error('Click two points on the drawing first.');
    const [a, b] = [this.a, this.b].map((p) => D.round3(p.toArray()));
    const deg = text.match(/^(-?[\d.]+)\s*(°|deg|d)$/i);
    if (deg) await this.t.run('calibrate_underlay', { id: this.id, orient: { a, b, bearing: parseFloat(deg[1]) } });
    else {
      const d = parseLength(text);
      if (!(d > 0)) throw new Error('Type a distance (12.5, 40m) or a bearing (90°).');
      await this.t.run('calibrate_underlay', { id: this.id, scale: { a, b, distance: d } });
    }
    this.t.status(deg ? `Turned: that line now points ${deg[1]}°.` : `Scaled: that line is now ${text}.`);
    this.cancel();
  }
}

/** Control points: click a spot on the drawing, then where it really is (a survey point, an end) or type N, E. */
class ControlTool {
  hint = 'Click a spot on a drawing (a grid cross, a corner), then where it really is: a survey point or a model point, or type its N, E. Two or more georeference it.';
  vcbLabel = 'N, E';
  constructor(t) {
    this.t = t;
  }
  busy() {
    return !!this.from;
  }
  cancel() {
    this.from = this.id = null;
    this.t.clear();
  }
  move(ev) {
    const inf = this.t.infer(ev);
    if (!this.from) return;
    this.t.vp.overlay.clear();
    this.t.lines([this.from, inf.point], HIGHLIGHT);
  }
  async down(ev) {
    if (!this.from) {
      const inf = this.t.infer(ev);
      const u = this.t.vp.pickUnderlay();
      if (!u) throw new Error('Click on a drawing first.');
      this.id = u.entityId;
      this.from = inf.snapped ? inf.point : u.point;
      return this.t.status('Now click where that spot really is, or type its N, E.');
    }
    this.t.vp.pick(ev);
    const pt = this.t.vp.pickPoint();
    const to = pt ? this.t.app.entity(pt.entityId).name : D.round3(this.t.infer(ev).point.toArray());
    await this.add(to);
  }
  async vcb(text) {
    if (!this.from) throw new Error('Click a spot on the drawing first.');
    const [n, e] = text.split(/[\s,;]+/).map(Number);
    if (!Number.isFinite(n) || !Number.isFinite(e)) throw new Error('Type the northing and easting: 5400120.5, 650310.2');
    await this.add({ n, e });
  }
  async add(to) {
    const id = this.id;
    const from = D.round3(this.from.toArray());
    const r = await this.t.run('add_control_pair', { id, from, to });
    if (r.pairs === 1) {
      await this.t.run('calibrate_underlay', { id, move: { from: { u: r.pair.u, v: r.pair.v }, to } });
      this.t.status('First control point: the drawing moved onto it. Add a second to scale and turn it.');
    } else {
      const g = await this.t.run('georeference_underlay', { id });
      const flag = g.pairs.find((p) => p.flag);
      this.t.status(`Georeferenced from ${r.pairs} points (${g.method}): RMS ${fmt(g.rms)}${flag ? ` · check ${flag.name}` : ''}.`);
    }
    this.from = null;
    this.t.clear();
  }
}

/** Sculpt (#35): click or drag on a surface; type the operation, radius and strength ("raise 5 0.5", "flatten 8", "smooth"). */
class SculptTool {
  hint = 'Click or drag on a surface to sculpt. Type: raise / lower / flatten / smooth / noise / terrace, then radius and strength (e.g. "lower 6 0.3"). Shift lowers.';
  vcbLabel = 'Brush';
  constructor(t) {
    this.t = t;
    this.op = 'raise';
    this.radius = 5;
    this.strength = 0.3;
  }
  ring(hit) {
    this.t.vp.overlay.clear();
    if (!hit) return;
    const pts = Array.from({ length: 49 }, (_, k) => {
      const a = (k / 48) * Math.PI * 2;
      return V(hit.point.x + Math.cos(a) * this.radius, hit.point.y + 0.05, hit.point.z + Math.sin(a) * this.radius);
    });
    this.t.lines(pts, HIGHLIGHT);
  }
  move(ev) {
    const hit = this.t.vp.pick(ev);
    this.ring(hit);
    if (this.down_ && hit && performance.now() - (this.t0 || 0) > 120) this.stroke(hit, ev);
  }
  async stroke(hit, ev) {
    if (this.busy_) return;
    this.busy_ = true;
    this.t0 = performance.now();
    try {
      await this.t.run('sculpt_terrain', { id: this.t.app.pickTarget(hit.entityId), at: D.round3(hit.point.toArray()), operation: ev.shiftKey && this.op === 'raise' ? 'lower' : this.op, radius: this.radius, strength: this.strength });
    } finally {
      this.busy_ = false;
    }
  }
  async down(ev) {
    this.down_ = true;
    const hit = this.t.vp.pick(ev);
    if (hit) await this.stroke(hit, ev);
  }
  up() {
    this.down_ = false;
  }
  vcb(text) {
    const words = text.split(/[\s,]+/).filter(Boolean);
    const op = words.find((w) => /^(raise|lower|flatten|smooth|noise|terrace)$/i.test(w));
    if (op) this.op = op.toLowerCase();
    // the first number is the radius, the second the strength
    const [r, s] = words.map(Number).filter((x) => Number.isFinite(x) && x > 0);
    if (r) this.radius = r;
    if (s) this.strength = s;
    this.t.status(`Brush: ${this.op}, radius ${fmt(this.radius)}, strength ${this.strength}`);
  }
}

/** A reference stuck to the shape under the cursor (so the dimension follows it), or a plain point. */
function refAt(t, inf) {
  const p = D.round3(inf.point.toArray());
  return inf.hit?.entityId ? { id: inf.hit.entityId, point: p } : p;
}

/** Dimension tool (#50): two clicks; an axis lock (arrow keys) makes it horizontal or vertical. */
class DimensionTool {
  hint = 'Click two points to dimension them (it follows the shapes). Arrow keys lock an axis. Type an offset in m.';
  vcbLabel = 'Offset';
  constructor(t) {
    this.t = t;
    this.offset = 0.5;
  }
  busy() {
    return !!this.a;
  }
  cancel() {
    this.a = null;
    this.t.clear();
  }
  move(ev) {
    const inf = this.t.infer(ev, { from: this.a?.point });
    if (!this.a) return;
    this.t.vp.overlay.clear();
    this.t.lines([this.a.point, inf.point], HIGHLIGHT);
    this.t.status(`Dimension ${fmt(this.a.point.distanceTo(inf.point))}`);
  }
  async down(ev) {
    const inf = this.t.infer(ev, { from: this.a?.point });
    if (!this.a) return void (this.a = inf);
    const a = this.a;
    this.a = null;
    this.t.clear();
    await this.t.run('add_dimension', { from: refAt(this.t, a), to: refAt(this.t, inf), offset: this.offset, ...(inf.axis ? { axis: inf.axis } : {}) });
  }
  vcb(text) {
    const x = parseLength(text);
    if (Number.isFinite(x)) this.offset = x;
    this.t.status(`Dimension offset ${fmt(this.offset)}`);
  }
}

/** Label tool (#51): click a shape; the Measurements box sets the text template ({name} {area} {volume}…). */
class LabelTool {
  hint = 'Click a shape to label it. Type the text first: {name}, {area}, {footprint}, {volume}, {height}, {elevation}, {meta.key}.';
  vcbLabel = 'Text';
  constructor(t) {
    this.t = t;
    this.text = '{name}';
  }
  move(ev) {
    this.t.infer(ev);
  }
  async down(ev) {
    const inf = this.t.infer(ev);
    await this.t.run('add_label', { at: refAt(this.t, inf), text: this.text });
  }
  vcb(text) {
    this.text = text || '{name}';
    this.t.status(`Label text: ${this.text}`);
  }
}

/** Text without a leader (#183): click where it goes, type the words first. */
class TextTool extends LabelTool {
  hint = 'Type the text in the value box, then click where it goes (on a shape, it follows it). Style it in the Entity panel.';
  constructor(t) {
    super(t);
    this.text = 'Text';
  }
  async down(ev) {
    const inf = this.t.infer(ev);
    await this.t.run('add_label', { at: refAt(this.t, inf), text: this.text, leader: false, size: 14 });
  }
  vcb(text) {
    this.text = text || 'Text';
    this.t.status(`Text: ${this.text}. Click where it goes.`);
  }
}

/** Base point (#190): click a point of the model, then type its real coordinates. */
class BasePointTool {
  hint = 'Click a point of the model whose real coordinates you know (a corner, a survey mark); then type them.';
  constructor(t) {
    this.t = t;
  }
  move(ev) {
    this.t.infer(ev);
  }
  async down(ev) {
    const p = this.t.infer(ev).point;
    await this.t.app.ui.basePointDialog(D.round3(p.toArray()));
    this.t.set('select');
  }
}

/** Zoom window: drag a box, the view zooms into it. */
/**
 * Path / alignment (#210): a line whose segments can be straight or arcs (A), smoothed into a spline (S), with every
 * corner rounded to a radius ("r 5"). Enter keeps it as a path (sweeps, motion); Ctrl+Enter makes it an alignment.
 */
class PathTool extends LineTool {
  hint = 'Click points. A: arc segments (A again: straight). S: smooth it into a spline. Type "r 5" to round every corner to 5 m. Enter keeps the path; Ctrl+Enter makes it a road alignment.';
  vcbLabel = 'Length · r radius';
  smooth = false;
  radius = 0;
  key(ev) {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) return this.t.guard(() => this.finish(true)), true;
    if (ev.key.toLowerCase() === 's' && !ev.ctrlKey && this.pts.length) {
      this.smooth = !this.smooth;
      this.t.status(this.smooth ? 'Smooth: a spline through the points. S again for straight lines.' : 'Straight segments. S for smooth.');
      return true;
    }
    return super.key(ev);
  }
  vcb(text) {
    const m = String(text).trim().match(/^r\s*=?\s*([\d.]+)\s*(m)?$/i);
    if (!m) return super.vcb(text);
    this.radius = +m[1];
    this.t.status(this.radius ? `Corners rounded to ${fmt(this.radius)}.` : 'Sharp corners.');
  }
  /** Round the corners in plan (the path lies level), keeping the height of each part. */
  rounded(pts) {
    if (!this.radius || pts.length < 3) return pts;
    const y = pts[0][1];
    if (pts.some((p) => Math.abs(p[1] - y) > 1e-6)) throw new Error('Rounding corners works on a level path; draw it on the ground or a level face.');
    return fillet2d(pts.map((p) => [p[0], p[2]]), this.radius).map(([x, z]) => [x, y, z]);
  }
  async finish(alignment = false) {
    const pts = this.pts.filter((p, i, a) => !i || p.distanceTo(a[i - 1]) > 1e-6).map((p) => p.toArray());
    this.pts = [];
    this.t.clear();
    if (pts.length < 2) return;
    if (alignment) {
      const r = await this.t.run('create_alignment', { points: pts, radii: pts.slice(1, -1).map(() => this.radius), name: 'Alignment' });
      return this.t.status(`${r.name}: ${fmt(r.length ?? 0)} long. Change its radii in the Entity panel; Site › Corridor puts a road on it.`);
    }
    await this.t.run('create_curve', { points: this.smooth ? pts : this.rounded(pts), kind: this.smooth ? 'spline' : 'polyline', name: 'Path' });
    this.t.status(`Path kept. ${this.hint}`);
  }
}

/** A new component or library model follows the pointer (#207): it lands on faces and the ground; click drops it. */
class PlaceTool extends MoveTool {
  hint = 'Move the mouse to place it (it lands on faces and the ground, and snaps); click to drop it. Esc takes it away.';
  vcbLabel = '';
  constructor(t) {
    super(t);
    const ids = t.placeIds || [];
    t.placeIds = null;
    this.fresh = ids;
    t.vp.modelRoot.updateMatrixWorld(true);
    if (!this.grab(ids)) return;
    // the thing being placed is not under the pointer for picking and snapping
    this.muted = [];
    for (const { o } of this.orig) o.traverse((x) => x.isMesh && (this.muted.push([x, x.raycast]), (x.raycast = () => {})));
    const e = t.app.entity(ids[0]);
    this.base = V(...D.worldMatrix(t.app.store.doc, e).elements.slice(12, 15));
    this.delta = V();
  }
  move(ev) {
    if (!this.ids && !this.fresh?.length) return;
    // the view was rebuilt since (the command that made it): take hold of the new objects
    if (!this.ids || this.orig.some(({ o }) => !o?.parent)) {
      const ids = this.ids || this.fresh;
      this.t.vp.modelRoot.updateMatrixWorld(true);
      if (!this.grab(ids)) return;
      this.base ||= V(...D.worldMatrix(this.t.app.store.doc, this.t.app.entity(ids[0])).elements.slice(12, 15));
      this.delta ||= V();
    }
    const inf = this.t.infer(ev);
    this.delta = inf.point.clone().sub(this.base);
    this.show(inf.axis);
    this.t.status(`Place it · ${inf.kind}. Click to drop it, Esc to take it away.`);
  }
  afterRebuild() {
    const ids = this.ids || this.fresh;
    if (!ids?.length || this.placed) return;
    this.t.vp.modelRoot.updateMatrixWorld(true);
    if (!this.grab(ids)) return;
    for (const [x, r] of this.muted || []) x.raycast = r;
    this.muted = [];
    for (const { o } of this.orig) o.traverse((x) => x.isMesh && (this.muted.push([x, x.raycast]), (x.raycast = () => {})));
    if (this.delta) this.show();
  }
  async down() {
    if (!this.ids) return;
    this.placed = true;
    await this.commit();
    this.t.set('select');
  }
  cancel() {
    for (const [x, r] of this.muted || []) x.raycast = r;
    this.muted = null;
    const gone = !this.placed && this.fresh?.length ? this.fresh : null;
    this.fresh = null;
    super.cancel();
    if (gone) this.t.run('delete', { ids: gone }).catch(() => {});
  }
}

/**
 * Edit a surface by hand (#212). Modes (keys, or the value box): D delete a triangle, W swap the edge you click,
 * A add a point, R leave a point out, B draw the outline, H draw a hole; "max 30" / "min 0.5" set the longest and
 * shortest triangle side. Enter finishes an outline or hole; U restores the triangles.
 */
class SurfaceEditTool {
  static MODES = { d: ['delete', 'Delete a triangle: click it'], w: ['swap', 'Swap an edge: click near it'], a: ['add', 'Add a point: click on the surface'], r: ['remove', 'Leave a point out: click near it'], b: ['outline', 'Draw the outline: click its corners, Enter to finish'], h: ['void', 'Draw a hole: click its corners, Enter to finish'] };
  vcbLabel = 'max m · min m';
  constructor(t) {
    this.t = t;
    this.mode = 'delete';
    this.pts = [];
    this.surface = this.pickSurface();
    this.say();
  }
  get hint() {
    return `Edit surface${this.surface ? ` ${this.surface.name}` : ''}: ${Object.entries(SurfaceEditTool.MODES).find(([, [m]]) => m === this.mode)[1][1]}. Keys: D delete · W swap · A add · R remove point · B outline · H hole · U restore. Type "max 30" or "min 0.5" for triangle sides.`;
  }
  say() {
    this.t.status(this.surface ? this.hint : 'Select a TIN surface first (or click one), then edit it.');
  }
  pickSurface(id = null) {
    const app = this.t.app;
    const isTin = (e) => e?.derived?.generator === 'surface';
    return [id, ...app.selection].map((x) => app.entity(x)).find(isTin) || app.store.doc.entities.find(isTin) || null;
  }
  busy() {
    return this.pts.length > 0;
  }
  key(ev) {
    const k = ev.key.toLowerCase();
    if (ev.ctrlKey || ev.metaKey) return false;
    if (SurfaceEditTool.MODES[k]) {
      this.mode = SurfaceEditTool.MODES[k][0];
      this.pts = [];
      this.t.clear();
      this.say();
      return true;
    }
    if (k === 'u' && this.surface) return this.t.run('edit_triangles', { id: this.surface.id, action: 'restore' }).then(() => this.t.status('Triangles and points restored.')), true;
    return false;
  }
  move(ev) {
    const inf = this.t.infer(ev, { from: this.pts.at(-1) });
    if (this.pts.length) (this.t.vp.overlay.clear(), this.t.lines([...this.pts, inf.point], ACCENT, true));
  }
  /** The survey point nearest a world point (in plan). */
  nearestPoint(p, within = 3) {
    let best = null;
    const doc = this.t.app.store.doc;
    for (const e of doc.entities)
      if (e.type === 'point') {
        const w = D.worldMatrix(doc, e).elements.slice(12, 15);
        const d = Math.hypot(w[0] - p.x, w[2] - p.z);
        if (d < within && (!best || d < best.d)) best = { e, d, w };
      }
    return best;
  }
  async down(ev) {
    const hit = this.t.vp.pick(ev);
    if (hit && this.t.app.entity(hit.entityId)?.derived?.generator === 'surface') this.surface = this.t.app.entity(hit.entityId);
    if (!this.surface) return this.say();
    const id = this.surface.id;
    const p = (hit?.point || this.t.infer(ev).point).clone();
    const at = [Math.round(p.x * 1000) / 1000, Math.round(p.z * 1000) / 1000];
    if (this.mode === 'outline' || this.mode === 'void') return void this.pts.push(this.t.infer(ev, { from: this.pts.at(-1) }).point.clone());
    if (!hit && this.mode !== 'add') return this.t.status('Click on the surface.');
    if (this.mode === 'delete') return this.t.run('edit_triangles', { id, action: 'delete', at });
    if (this.mode === 'add') return this.t.run('edit_triangles', { id, action: 'add_point', at });
    if (this.mode === 'remove') {
      const n = this.nearestPoint(p);
      if (!n) return this.t.status('No survey point near there.');
      return this.t.run('edit_triangles', { id, action: 'remove_point', a: n.e.name });
    }
    // swap: the triangle under the pointer, its edge nearest the click, the points at its two ends
    const face = this.surface.mesh.f[hit.faceIndex];
    const wm = new THREE.Matrix4().fromArray(D.worldMatrix(this.t.app.store.doc, this.surface).elements);
    const corners = (face || []).map((i) => V(...this.surface.mesh.v[i]).applyMatrix4(wm));
    if (corners.length !== 3) return;
    let best = null;
    for (let k = 0; k < 3; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 3];
      const d = new THREE.Line3(a, b).closestPointToPoint(p, true, V()).distanceTo(p);
      if (!best || d < best.d) best = { d, a, b };
    }
    const [pa, pb] = [this.nearestPoint(best.a, 0.05), this.nearestPoint(best.b, 0.05)];
    if (!pa || !pb) return this.t.status('That edge does not join two survey points; swap works between points.');
    return this.t.run('edit_triangles', { id, action: 'swap', a: pa.e.name, b: pb.e.name });
  }
  async finish() {
    if (this.pts.length < 3 || !this.surface) return this.cancel();
    const ring = this.pts.map((q) => [Math.round(q.x * 1000) / 1000, Math.round(q.z * 1000) / 1000]);
    const p = this.surface.derived.params;
    this.pts = [];
    this.t.clear();
    if (this.mode === 'outline') await this.t.run('set_surface_sources', { id: this.surface.id, outline: ring });
    else await this.t.run('set_surface_sources', { id: this.surface.id, voids: [...(p.voids || []), ring] });
    this.t.status(this.mode === 'outline' ? 'The surface now stays inside that outline.' : 'That area is left out of the surface.');
  }
  cancel() {
    this.pts = [];
    this.t.clear();
  }
  vcb(text) {
    const m = String(text).trim().match(/^(max|min)\s*([\d.]+)/i);
    if (!m || !this.surface) return this.t.status('Type "max 30" or "min 0.5" (metres).');
    return this.t.run('set_surface_sources', { id: this.surface.id, [`${m[1].toLowerCase()}_edge`]: +m[2] }).then(() => this.t.status(`${m[1] === 'max' ? 'Longest' : 'Shortest'} triangle side: ${m[2]} m.`));
  }
}

/** Points for a form (#201): click them (they snap); Enter, Esc or the count ends it. */
class PickTool {
  constructor(t) {
    this.t = t;
    this.pts = [];
    this.hint = t.pickHint || 'Click a point.';
  }
  busy() {
    return true;
  }
  move(ev) {
    const inf = this.t.infer(ev, { from: this.pts.at(-1) });
    if (this.pts.length) (this.t.vp.overlay.clear(), this.t.lines([...this.pts, inf.point], ACCENT));
  }
  down(ev) {
    if (this.t.pickWhat === 'entity') {
      const vp = this.t.vp;
      const hit = vp.pick(ev);
      const id = vp.pickCurve()?.entityId || vp.pickPoint()?.entityId || hit?.entityId;
      if (!id) return this.t.status(`Nothing there. ${this.hint}`);
      this.pts.push(id);
      return this.finish();
    }
    this.pts.push(this.t.infer(ev, { from: this.pts.at(-1) }).point.clone());
    if (this.t.pickCount && this.pts.length >= this.t.pickCount) this.finish();
  }
  finish() {
    const done = this.t.pickDone;
    this.t.pickDone = null;
    done?.(this.pts);
  }
  cancel() {
    this.finish();
  }
}

class ZoomWindowTool {
  hint = 'Drag a box around what you want to see up close.';
  constructor(t) {
    this.t = t;
  }
  down(ev) {
    this.start = { x: ev.clientX, y: ev.clientY };
  }
  move(ev) {
    if (!this.start) return;
    const r = this.t.vp.canvas.parentElement.getBoundingClientRect();
    const [x0, x1] = [this.start.x, ev.clientX].sort((a, b) => a - b);
    const [y0, y1] = [this.start.y, ev.clientY].sort((a, b) => a - b);
    Object.assign(this.t.box.style, { left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    this.t.box.hidden = false;
  }
  async up(ev) {
    const s = this.start;
    this.start = null;
    this.t.box.hidden = true;
    if (!s) return;
    const r = this.t.vp.input.getBoundingClientRect();
    const f = (x, y) => [(x - r.left) / r.width, (y - r.top) / r.height];
    const pane = this.t.vp.paneNow ? { pane: this.t.vp.paneNow.i + 1 } : {};
    await this.t.run('zoom_window', { ...Object.fromEntries([...f(s.x, s.y), ...f(ev.clientX, ev.clientY)].map((v, i) => [['x0', 'y0', 'x1', 'y1'][i], v])), ...pane });
  }
}

/** Trim: click the piece of a curve to cut away between its crossings with the other curves. */
class TrimTool {
  hint = 'Click the piece of a curve to cut away; the other curves are the cutting edges.';
  constructor(t) {
    this.t = t;
  }
  async down(ev) {
    this.t.vp.pick(ev);
    const hit = this.t.vp.pickCurve();
    if (!hit || !this.t.app.entity(hit.entityId)?.curve) return;
    await this.t.run('trim', { id: hit.entityId, at: D.round3(hit.point.toArray()) });
  }
}

/** Split (#219): click a line where it should come apart: two lines. */
class SplitTool {
  hint = 'Click a line where it should be split in two.';
  constructor(t) {
    this.t = t;
  }
  async down(ev) {
    this.t.vp.pick(ev);
    const hit = this.t.vp.pickCurve();
    if (!hit || !this.t.app.entity(hit.entityId)?.curve) return this.t.status(`No line there. ${this.hint}`);
    await this.t.run('break_curve', { id: hit.entityId, at: D.round3(hit.point.toArray()) });
  }
}

/** Join (#219): click a line near the end to join, then the other line near its end: one line, any gap bridged. */
class JoinTool {
  hint = 'Click the first line near the end to join.';
  constructor(t) {
    this.t = t;
  }
  cancel() {
    this.first = null;
    this.t.vp.overlay.clear();
    this.t.status(this.hint);
  }
  busy() {
    return !!this.first;
  }
  move(ev) {
    if (!this.first) return;
    this.t.vp.overlay.clear();
    this.t.lines([this.first.at, this.t.infer(ev).point], ACCENT);
  }
  async down(ev) {
    this.t.vp.pick(ev);
    const hit = this.t.vp.pickCurve();
    const e = hit && this.t.app.entity(hit.entityId);
    if (!e?.curve) return this.t.status(`No line there. ${this.first ? 'Click the second line near its end.' : this.hint}`);
    if (!this.first || this.first.id === e.id) {
      this.first = { id: e.id, at: hit.point.clone() };
      return this.t.status(`${e.name}: now click the line to join it to, near its end. Esc to start again.`);
    }
    const { id, at } = this.first;
    this.first = null;
    this.t.vp.overlay.clear();
    await this.t.run('connect_curves', { ids: [id, e.id], at: D.round3(at.toArray()), at2: D.round3(hit.point.toArray()) });
    this.t.status(this.hint);
  }
}

/** Extend: click near the end of a curve to stretch it to the next curve ahead. */
class ExtendTool {
  hint = 'Click near the end of a curve to extend it to the next curve ahead.';
  constructor(t) {
    this.t = t;
  }
  async down(ev) {
    this.t.vp.pick(ev);
    const hit = this.t.vp.pickCurve();
    if (!hit || !this.t.app.entity(hit.entityId)?.curve) return;
    await this.t.run('extend', { id: hit.entityId, end: D.round3(hit.point.toArray()) });
  }
}

/** Arc: click its start, its end, then where it bulges through (or type the bulge height). */
class ArcTool extends DrawBase {
  hint = 'Click the start, then the end, then a point the arc passes through. Type a bulge height (sagitta) instead of the last click.';
  vcbLabel = 'Bulge';
  cancel() {
    super.cancel();
    this.p1 = null;
  }
  preview(through) {
    this.t.vp.overlay.clear();
    if (!this.p1) return this.t.lines([this.p0, through], ACCENT);
    try {
      const a = arcThrough(this.p0.toArray(), through.toArray(), this.p1.toArray(), 32);
      this.t.lines(a.points.map((p) => V(...p)), ACCENT);
      this.t.status(`Radius ${fmt(a.radius)}, angle ${Math.round((a.sweep * 180) / Math.PI)}°`);
    } catch {
      this.t.lines([this.p0, this.p1], ACCENT);
    }
  }
  move(ev) {
    if (!this.p0) return this.t.infer(ev);
    this.cur = this.onPlane(ev);
    this.preview(this.cur);
  }
  async down(ev) {
    if (!this.p0) return this.startPlane(this.t.infer(ev));
    if (!this.p1) return void (this.p1 = this.onPlane(ev));
    const [s, t, e] = [this.p0, this.onPlane(ev), this.p1].map((p) => D.round3(p.toArray()));
    this.cancel();
    await this.t.run('create_arc', { kind: 'three_point', start: s, through: t, end: e });
  }
  async vcb(text) {
    const h = parseLength(text);
    if (!this.p0 || !this.p1 || !h) return;
    const [s, e] = [this.p0, this.p1].map((p) => D.round3(p.toArray()));
    const n = this.n.toArray();
    this.cancel();
    await this.t.run('create_arc', { kind: 'two_point', start: s, end: e, sagitta: h, normal: n });
  }
}

/** Arc through three points (#178): start, a point on the arc, end. */
class Arc3Tool extends ArcTool {
  hint = 'Click the start, a point the arc passes through, then the end.';
  vcbLabel = '';
  preview(cur) {
    this.t.vp.overlay.clear();
    if (!this.p1) return this.t.lines([this.p0, cur], ACCENT);
    try {
      const a = arcThrough(this.p0.toArray(), this.p1.toArray(), cur.toArray(), 32);
      this.t.lines(a.points.map((p) => V(...p)), ACCENT);
      this.t.status(`Radius ${fmt(a.radius)}, angle ${Math.round((a.sweep * 180) / Math.PI)}°`);
    } catch {
      this.t.lines([this.p0, this.p1, cur], ACCENT);
    }
  }
  async down(ev) {
    if (!this.p0) return this.startPlane(this.t.infer(ev));
    if (!this.p1) return void (this.p1 = this.onPlane(ev));
    const [s, t, e] = [this.p0, this.p1, this.onPlane(ev)].map((p) => D.round3(p.toArray()));
    this.cancel();
    await this.t.run('create_arc', { kind: 'three_point', start: s, through: t, end: e });
  }
  vcb() {}
}

/** Arc from its centre (#178): the centre, the start (the radius), then the end, counter-clockwise; type an angle. */
class ArcCenterTool extends ArcTool {
  hint = 'Click the centre, then the start (it sets the radius), then the end. Type the angle (90) instead of the last click.';
  vcbLabel = 'Angle °';
  points(endDir, sweepDeg = null) {
    const c = this.p0;
    const r0 = this.p1.clone().sub(c);
    const n = this.n.clone().normalize();
    let sweep = sweepDeg !== null ? (sweepDeg * Math.PI) / 180 : Math.atan2(r0.clone().cross(endDir).dot(n), r0.dot(endDir));
    if (sweepDeg === null && sweep <= 0) sweep += 2 * Math.PI;
    return [0, 0.5, 1].map((k) => r0.clone().applyAxisAngle(n, sweep * k).add(c));
  }
  preview(cur) {
    this.t.vp.overlay.clear();
    if (!this.p1) return this.t.lines([this.p0, cur], ACCENT), this.t.status(`Radius ${fmt(this.p0.distanceTo(cur))}`);
    const [s, m, e] = this.points(cur.clone().sub(this.p0));
    try {
      const a = arcThrough(s.toArray(), m.toArray(), e.toArray(), 48);
      this.t.lines([this.p0, ...a.points.map((p) => V(...p)), this.p0], ACCENT);
      this.t.status(`Radius ${fmt(a.radius)}, angle ${Math.round((a.sweep * 180) / Math.PI)}°`, 'Angle °');
    } catch {}
  }
  async commit3(s, m, e) {
    this.cancel();
    await this.t.run('create_arc', { kind: 'three_point', start: D.round3(s.toArray()), through: D.round3(m.toArray()), end: D.round3(e.toArray()) });
  }
  async down(ev) {
    if (!this.p0) return this.startPlane(this.t.infer(ev));
    if (!this.p1) return void (this.p1 = this.onPlane(ev));
    return this.commit3(...this.points(this.onPlane(ev).sub(this.p0)));
  }
  vcb(text) {
    const deg = parseFloat(text);
    if (!this.p1 || !deg) return;
    return this.commit3(...this.points(null, deg));
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
  curve: PathTool,
  arc: ArcTool,
  arc3: Arc3Tool,
  text: TextTool,
  basepoint: BasePointTool,
  pick: PickTool,
  surfedit: SurfaceEditTool,
  place: PlaceTool,
  arcc: ArcCenterTool,
  point: PointTool,
  calibrate: CalibrateTool,
  control: ControlTool,
  trim: TrimTool,
  split: SplitTool,
  join: JoinTool,
  zoomwin: ZoomWindowTool,
  sculpt: SculptTool,
  extend: ExtendTool,
  pushpull: PushPullTool,
  move: MoveTool,
  rotate: RotateTool,
  scale: ScaleTool,
  tape: TapeTool,
  rect3: Rect3Tool,
  dimension: DimensionTool,
  label: LabelTool,
  paint: PaintTool,
  matbrush: MaterialBrushTool,
  eraser: EraserTool,
  section: SectionTool,
  orbit: CameraTool,
  walk: WalkTool,
  pan: CameraTool,
};
