// Multiple views (#160–#164): up to four panes over one model. The first pane is the Viewport itself; the others are
// a canvas each with their own renderer, cameras and orbit controls, drawing the same scene. Tools and camera commands
// run in a pane through viewport.withPane. A pane can move to its own window (a second screen) and come back.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as LY from '../core/layout.js';
import { h, icon } from './ui.js';

const LABEL = { perspective: 'Perspective', top: 'Top', front: 'Front', back: 'Back', left: 'Left', right: 'Right', bottom: 'Bottom', iso: 'Iso', custom: 'Custom', scene: 'Scene' };
const GLYPH_LAYER = 1; // the main camera's mark, seen only by the other panes (#164)
const WIRE = new THREE.MeshBasicMaterial({ color: 0x3a3a36, wireframe: true });
const pct = (x) => `${(x * 100).toFixed(3)}%`;

class Pane {
  constructor(mgr, i) {
    Object.assign(this, { mgr, i, visible: true, win: null });
    this.persp = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    for (const c of [this.persp, this.ortho]) c.layers.enable(GLYPH_LAYER);
    this.camera = this.persp;
    this.mount(document, mgr.wrap);
  }

  mount(doc, parent) {
    const vp = this.mgr.vp;
    const win = doc.defaultView;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'pane-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', `View ${this.i + 1}`);
    if (doc !== document) Object.assign(this.canvas.style, { width: '100vw', height: '100vh', display: 'block', outline: 'none' });
    // in pane order, under the labels, the view bar and the chips
    if (doc === document) ([...parent.querySelectorAll('.pane-canvas')].pop() || this.mgr.vp.canvas).after(this.canvas);
    else parent.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(win.devicePixelRatio);
    Object.assign(this.renderer, { localClippingEnabled: true, outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.NeutralToneMapping });
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { zoomToCursor: true, screenSpacePanning: true, mouseButtons: { ...vp.controls.mouseButtons }, touches: { ...vp.controls.touches } });
    if (this.target) this.controls.target.copy(this.target);
    this.controls.addEventListener('change', () => (vp.dirty = true));
    this.controls.addEventListener('end', () => this.save());
    this.mgr.app.tools.bind(this.canvas, this);
    const focus = () => this.mgr.focus(this.i);
    this.canvas.addEventListener('pointerdown', focus);
    this.canvas.addEventListener('pointerenter', focus);
    this.canvas.dataset.tool = vp.canvas.dataset.tool || '';
    this.observer = new win.ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
  }

  unmount() {
    this.target = this.controls.target.clone();
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!w || !hgt) return;
    this.renderer.setSize(w, hgt, false);
    this.persp.aspect = w / hgt;
    this.persp.updateProjectionMatrix();
    this.mgr.vp.withPane(this, () => this.camera.isOrthographicCamera && this.mgr.vp.fitOrtho());
    this.mgr.vp.dirty = true;
  }

  /** Called inside viewport.withPane(this). The same scene, without the main renderer's own GPU targets. */
  draw() {
    const vp = this.mgr.vp;
    const scene = vp.scene;
    vp.syncProjection();
    if (this.i === 1) this.mgr.updateGlyph();
    const keep = { env: scene.environment, bg: scene.background };
    scene.environment = null; // a PMREM map lives in the main renderer's context
    if (keep.bg?.isRenderTargetTexture) scene.background = vp.skyBackground;
    // wireframe: the model's faces only (not curves, drawings, the grid or the shadow catcher)
    const swapped = [];
    if (this.cfg.style === 'wireframe')
      vp.modelRoot.traverse((o) => o.isMesh && !o.isLineSegments2 && !o.userData.underlay && !o.material?.isLineMaterial && (swapped.push([o, o.material]), (o.material = WIRE)));
    this.renderer.toneMappingExposure = vp.renderer.toneMappingExposure;
    try {
      this.renderer.render(scene, this.camera);
    } finally {
      Object.assign(scene, { environment: keep.env, background: keep.bg });
      for (const [o, m] of swapped) o.material = m;
    }
  }

  /** Keep the pane's camera in the document; a standard view orbited away becomes Custom. */
  save() {
    const vp = this.mgr.vp;
    const L = vp.store.doc.settings.layout;
    const cfg = L?.panes?.[this.i];
    if (!cfg) return;
    cfg.camera = vp.withPane(this, () => vp.getCamera());
    this.mgr.markCustom(cfg, this.camera, this.controls);
    this.mgr.layoutDom();
  }
}

export class Panes {
  constructor(app) {
    this.app = app;
    this.vp = app.viewport;
    this.wrap = this.vp.canvas.parentElement;
    this.main = { main: true, i: 0, canvas: this.vp.canvas, visible: true };
    this.extra = [];
    this.focusI = 0;
    this.heads = [];
    this.bars = [];
    this.vp.canvas.addEventListener('pointerdown', () => this.focus(0));
    this.vp.canvas.addEventListener('pointerenter', () => this.focus(0));
    this.vp.controls.addEventListener('end', () => {
      const cfg = this.vp.store.doc.settings.layout?.panes?.[0];
      if (cfg) this.markCustom(cfg, this.vp.camera, this.vp.controls), this.layoutDom();
    });
    // the main camera's mark: the eye, its view cone out to the target and the picture's corners there
    this.glyph = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xc8553d, depthTest: false, transparent: true, opacity: 0.6 }));
    this.glyph.layers.set(GLYPH_LAYER);
    this.glyph.renderOrder = 50;
    this.glyph.frustumCulled = false;
    this.vp.scene.add(this.glyph);
    Object.assign(this.vp, {
      inPane: (n, fn) => this.inPane(n, fn),
      syncPanes: () => this.sync(),
      detachPane: (n, on) => this.detach(n, on),
      layoutInfo: () => this.info(),
    });
    window.addEventListener('beforeunload', () => this.extra.forEach((p) => p.win?.close()));
  }

  get layout() {
    return LY.normalize(this.vp.store.doc.settings.layout);
  }
  all() {
    return [this.main, ...this.extra];
  }

  /** Make the panes match the document's layout: create or drop canvases, place them, frame new ones. */
  sync() {
    const L = this.layout;
    const fresh = [];
    while (this.extra.length < L.count - 1) {
      const p = new Pane(this, this.extra.length + 1);
      p.cfg = L.panes[p.i];
      this.extra.push(p);
      fresh.push(p);
    }
    while (this.extra.length > L.count - 1) {
      const p = this.extra.pop();
      const w = p.win;
      p.win = null;
      p.unmount();
      w?.close();
    }
    if (this.focusI >= L.count) this.focusI = 0;
    this.main.cfg = L.panes[0];
    for (const p of this.extra) p.cfg = L.panes[p.i];
    this.vp.extra = this.extra;
    this.layoutDom();
    for (const p of fresh) {
      p.resize();
      this.vp.withPane(p, () => {
        if (p.cfg.camera) this.vp.setCamera(p.cfg.camera);
        else this.vp.setView(LY.viewDirection(p.cfg.view) ? p.cfg.view : 'iso');
      });
    }
    this.vp.dirty = true;
  }

  /** Run fn in pane n (1-based). */
  inPane(n, fn) {
    this.sync();
    const L = this.layout;
    if (!Number.isInteger(n) || n < 1 || n > L.count) throw new Error(`There ${L.count === 1 ? 'is 1 pane' : `are ${L.count} panes`}: pane is 1 to ${L.count} (set_layout adds panes).`);
    return this.vp.withPane(this.all()[n - 1], fn);
  }

  /** { pane: n } for camera commands from the menus: the pane last worked in, when there are several. */
  target() {
    return this.layout.count > 1 ? { pane: this.focusI + 1 } : {};
  }

  focus(i) {
    if (this.focusI === i) return;
    this.focusI = i;
    this.heads.forEach((el, k) => el?.classList.toggle('focused', k === i));
  }

  markCustom(cfg, camera, controls) {
    const dir = LY.viewDirection(cfg.view);
    if (!dir || cfg.view === 'iso') return;
    const now = camera.position.clone().sub(controls.target).normalize();
    if (now.angleTo(new THREE.Vector3(...dir).normalize()) > 0.02) cfg.view = 'custom';
  }

  /** Place the docked canvases, their title chips and the bars between them. split: a live drag's split. */
  layoutDom(split = null, dragBar = null) {
    const L = this.layout;
    if (split) L.split = split;
    const all = this.all();
    const docked = all.filter((p) => !p.win);
    const maxPane = L.max !== null ? all[L.max] : null;
    const view = { ...L, count: docked.length, max: maxPane && !maxPane.win ? docked.indexOf(maxPane) : null };
    const rects = LY.paneRects(view);
    // the label and caption layers stay over the whole area (labels.js offsets them onto pane 1): a layer exactly
    // the size of the main canvas hid it in Chromium's compositor
    docked.forEach((p, k) => {
      const r = rects[k];
      p.visible = !!r;
      p.canvas.style.display = r ? '' : 'none';
      if (r) Object.assign(p.canvas.style, { position: 'absolute', left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });
    });
    for (const p of all) if (p.win) p.visible = true;
    // title chips
    for (const el of this.heads) el?.remove();
    this.heads = [];
    if (L.count > 1)
      docked.forEach((p, k) => {
        const r = rects[k];
        if (!r) return;
        const el = this.head(p, L);
        Object.assign(el.style, { left: `calc(${pct(r.x)} + 8px)`, top: `calc(${pct(r.y)} + 8px)` });
        this.wrap.append(el);
        this.heads[p.i] = el;
      });
    // bars; while one is dragged it stays (it holds the pointer), only moved
    if (dragBar) {
      const bar = LY.splitters(view).find((b) => b.axis === dragBar.bar.axis);
      if (bar) dragBar.el.style[bar.axis === 'x' ? 'left' : 'top'] = pct(bar.at);
      this.wrap.classList.toggle('multi', L.count > 1);
      this.vp.dirty = true;
      return;
    }
    for (const el of this.bars) el.remove();
    this.bars = LY.splitters(view).map((bar) => {
      const el = h(`div.pane-split.${bar.axis}`, { role: 'separator', 'aria-orientation': bar.axis === 'x' ? 'vertical' : 'horizontal', title: 'Drag to resize the views' });
      if (bar.axis === 'x') Object.assign(el.style, { left: pct(bar.at), top: pct(bar.from), height: pct(bar.to - bar.from) });
      else Object.assign(el.style, { top: pct(bar.at), left: pct(bar.from), width: pct(bar.to - bar.from) });
      el.addEventListener('pointerdown', (e) => this.drag(e, bar, el));
      this.wrap.append(el);
      return el;
    });
    this.wrap.classList.toggle('multi', L.count > 1);
    this.vp.dirty = true;
  }

  head(p, L) {
    const run = (name, args) => this.app.reg.run(name, args).catch((e) => this.app.ui.toast(e.message, 'danger'));
    const n = p.i + 1;
    const cfg = L.panes[p.i];
    const proj = p.main ? this.vp.store.doc.settings.projection || 'perspective' : cfg.projection;
    const scenes = this.vp.store.doc.scenes || [];
    const select = h(
      'select.pane-view',
      { 'aria-label': `View ${n}`, onchange: (e) => (e.target.value.startsWith('scene:') ? run('set_pane', { pane: n, scene: e.target.value.slice(6) }) : run('set_pane', { pane: n, view: e.target.value })) },
      ...LY.VIEWS.map((v) => h('option', { value: v, selected: cfg.view === v }, LABEL[v])),
      ...(['custom', 'scene'].includes(cfg.view) ? [h('option', { value: cfg.view, selected: true, disabled: true }, cfg.view === 'scene' ? cfg.scene : LABEL.custom)] : []),
      ...scenes.map((s) => h('option', { value: `scene:${s.name}` }, `Scene: ${s.name}`)),
    );
    const btn = (ic, label, onclick, pressed) => h('button.icon-btn.sm', { title: label, 'aria-label': label, onclick, 'aria-pressed': pressed === undefined ? undefined : String(!!pressed) }, icon(ic));
    const el = h(
      'div.pane-head',
      { ondblclick: (e) => !e.target.closest('select, button') && run('set_layout', { max: L.max === p.i ? 0 : n }), title: 'Double-click to maximise or restore' },
      h('span.pane-num', {}, String(n)),
      select,
      btn('perspective', proj === 'parallel' ? 'Parallel projection (click for perspective)' : 'Perspective (click for parallel)', () => run('set_pane', { pane: n, projection: proj === 'parallel' ? 'perspective' : 'parallel' }), proj === 'parallel'),
      btn('cube-transparent', 'Wireframe', () => run('set_pane', { pane: n, style: cfg.style === 'wireframe' ? 'shaded' : 'wireframe' }), cfg.style === 'wireframe'),
      btn(L.max === p.i ? 'corners-in' : 'corners-out', L.max === p.i ? 'Restore the views' : 'Maximise this view', () => run('set_layout', { max: L.max === p.i ? 0 : n })),
      ...(p.main ? [] : [btn('arrow-square-out', 'Move to its own window', () => run('detach_pane', { pane: n }))]),
    );
    el.classList.toggle('focused', this.focusI === p.i);
    return el;
  }

  drag(e, bar, el) {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const box = this.wrap.getBoundingClientRect();
    let split = null;
    const move = (ev) => {
      const pos = bar.axis === 'x' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      split = LY.dragSplit(this.layout, bar, pos);
      this.layoutDom(split, { bar, el });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (split) this.app.reg.run('set_layout', { split }).catch(() => {});
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  /** Move pane n to its own window, or back. Closing the window docks it. */
  detach(n, on = true) {
    this.sync();
    const p = this.all()[n - 1];
    if (!p) throw new Error(`No pane ${n}.`);
    if (p.main) throw new Error('Pane 1 is the main view; it stays in the window. Detach pane 2, 3 or 4.');
    if (on && !p.win) {
      const w = window.open('', `mmr-pane-${n}`, 'width=1000,height=700');
      if (!w) throw new Error('The window could not be opened.');
      const d = w.document;
      d.title = `View ${n}: ${LABEL[p.cfg.view] || p.cfg.view} — MyModellerReel`;
      Object.assign(d.body.style, { margin: '0', overflow: 'hidden', background: '#1d1d1b' });
      p.unmount();
      p.win = w;
      p.mount(d, d.body);
      // keys typed in the window work as in the main one (tools, undo, Esc)
      for (const type of ['keydown', 'keyup'])
        w.addEventListener(type, (ev) => window.dispatchEvent(new KeyboardEvent(type, { key: ev.key, code: ev.code, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey, bubbles: true })));
      w.addEventListener('pagehide', () => p.win === w && this.dock(p));
      p.resize();
    } else if (!on && p.win) {
      const w = p.win;
      this.dock(p);
      w.close();
    }
    this.layoutDom();
    return this.info();
  }

  dock(p) {
    p.win = null;
    p.unmount();
    p.mount(document, this.wrap);
    this.layoutDom();
    p.resize();
  }

  /** The main camera drawn in the other panes: eye, view cone to the target, the picture's frame there. */
  updateGlyph() {
    const show = this.layout.count > 1 && this.vp.store.doc.settings.layout?.show_camera !== false;
    this.glyph.visible = show;
    if (!show) return;
    // the main pane's own camera, whichever pane is being drawn
    const cam = this.vp.mainCam();
    const target = this.vp.mainTarget();
    const eye = cam.position;
    // a short cone (a third of the way to the target) and a line to the target: a mark, not a second drawing
    const d = Math.max(0.5, eye.distanceTo(target)) / 3;
    let hw;
    let hh;
    if (cam.isPerspectiveCamera) {
      hh = d * Math.tan((cam.fov * Math.PI) / 360);
      hw = hh * cam.aspect;
    } else {
      hw = (cam.right - cam.left) / 2 / cam.zoom;
      hh = (cam.top - cam.bottom) / 2 / cam.zoom;
    }
    const m = cam.matrixWorld;
    const corner = (x, y) => new THREE.Vector3(x * hw, y * hh, -d).applyMatrix4(m);
    const c = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const pts = [];
    for (const q of c) pts.push(eye, q);
    for (let k = 0; k < 4; k++) pts.push(c[k], c[(k + 1) % 4]);
    pts.push(eye, target);
    this.glyph.geometry.setFromPoints(pts);
  }
  info() {
    const L = this.layout;
    const all = this.all();
    return {
      count: L.count,
      arrangement: L.arrangement,
      split: L.split,
      maximised: L.max === null ? null : L.max + 1,
      show_camera: this.vp.store.doc.settings.layout?.show_camera !== false,
      panes: L.panes.map((cfg, i) => ({
        pane: i + 1,
        view: cfg.view,
        ...(cfg.scene ? { scene: cfg.scene } : {}),
        projection: i ? cfg.projection : this.vp.store.doc.settings.projection || 'perspective',
        style: cfg.style || 'shaded',
        detached: !!all[i]?.win,
        camera: all[i] ? this.vp.withPane(all[i], () => this.vp.getCamera()) : cfg.camera,
      })),
    };
  }
}
