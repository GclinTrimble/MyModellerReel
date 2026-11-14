// 3Dconnexion SpaceMouse (#303) over WebHID: reads the device, moves the camera of the pane under the cursor each
// frame, runs the buttons. The decoding and the axis maths are in core/spacemouse.js.
import * as THREE from 'three';
import * as SM from '../core/spacemouse.js';
import * as CV from '../core/clip.js';
import { floorAt } from './scale.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const EYE = 1.6; // walking eye height, as the Walk tool

export class SpaceMouse {
  constructor(app) {
    this.app = app;
    this.state = SM.newState();
    this.devs = new Map(); // HIDDevice → { model, error }
    this.listeners = new Set(); // button presses, for the Settings panel
    this.supported = !!navigator.hid;
    this.rotOff = false;
    this.clip = false;
    this.reload();
    this.onReport = (e) => this.feed(e.reportId, e.data, e.device.productId);
    window.addEventListener('pointermove', (e) => (this.pointer = e), { passive: true }); // the cursor pivot
    if (!this.supported) return;
    navigator.hid.addEventListener('connect', (e) => this.open(e.device));
    navigator.hid.addEventListener('disconnect', (e) => this.close(e.device));
    navigator.hid.getDevices().then((ds) => ds.forEach((d) => this.open(d)), () => {});
  }

  /** The saved settings and mapping (after set_spacemouse / map_spacemouse_button). */
  reload() {
    const s = this.app.settings?.spacemouse || {};
    this.cfg = SM.configure(s);
    this.buttons = s.buttons || {};
  }

  /** Ask for a device (a user gesture: the Settings button); main.cjs picks the 3Dconnexion one. */
  async request() {
    if (!this.supported) throw new Error('This window cannot read HID devices.');
    for (const d of await navigator.hid.requestDevice({ filters: SM.FILTERS })) await this.open(d);
    return this.devices();
  }

  /** Its multi-axis collection only: a receiver also shows other interfaces. */
  usable(d) {
    return SM.isSpaceMouse(d.vendorId, d.productId) && (!d.collections?.length || d.collections.some((c) => c.usagePage === 1 && c.usage === 8));
  }

  async open(d) {
    if (!this.usable(d) || this.devs.has(d)) return;
    const info = { model: SM.modelOf(d.productId), error: null };
    this.devs.set(d, info);
    try {
      if (!d.opened) await d.open();
      d.addEventListener('inputreport', this.onReport);
    } catch (e) {
      info.error = e.message; // shown by list_input_devices, not logged: a busy device is not a page error
    }
    this.app.ui?.renderDock?.();
  }

  close(d) {
    if (!this.devs.delete(d)) return;
    d.removeEventListener('inputreport', this.onReport);
    for (const i of this.state.pressed) this.press(SM.buttonName(d.productId, i), false);
    this.state = SM.newState(); // unplugged mid-push: stop
    this.app.ui?.renderDock?.();
  }

  devices() {
    return [...this.devs].map(([d, i]) => ({ model: i.model, vendor_id: `0x${d.vendorId.toString(16)}`, product_id: `0x${d.productId.toString(16)}`, name: d.productName, open: d.opened && !i.error, error: i.error || undefined }));
  }

  /** One input report, from the device or injected (window.mmr.spacemouse.feed in tests). */
  feed(reportId, bytes, productId = [...this.devs.keys()][0]?.productId ?? 0xc62b) {
    const r = SM.decode(this.state, reportId, bytes);
    if (!r) return;
    if (r.axes) return this.wake();
    for (const i of r.down) this.press(SM.buttonName(productId, i), true);
    for (const i of r.up) this.press(SM.buttonName(productId, i), false);
  }

  // ---------------------------------------------------------------- buttons

  press(name, down) {
    if (down) {
      this.lastButton = name;
      for (const fn of this.listeners) fn(name);
    }
    const a = SM.actionOf(name, this.buttons);
    if (typeof a === 'string' && a.startsWith('key:')) return this.key(a.slice(4), down);
    if (a === 'sm:clip') return this.setClip(down); // held
    if (a && down) this.act(a);
  }

  act(a) {
    const app = this.app;
    const fail = (e) => app.ui.toast(e.message, 'danger');
    if (typeof a === 'object') {
      const pane = app.reg.commands.get(a.command)?.params?.properties?.pane && a.args?.pane === undefined ? app.panes?.target() : {};
      return app.reg.run(a.command, { ...a.args, ...pane }).catch(fail);
    }
    if (a.startsWith('sm:')) return this.smAction(a.slice(3));
    if (a.startsWith('tool:')) return app.tools.set(a.slice(5));
    if (app.ui.actions[a]) return app.ui.actions[a].run();
    return app.reg.run(a, {}).catch(fail);
  }

  smAction(k) {
    const set = (patch, say) => this.app.reg.run('set_spacemouse', patch).then(() => this.app.ui.toast(say), (e) => this.app.ui.toast(e.message, 'danger'));
    const c = this.cfg;
    if (k === 'palette') return this.app.ui.openPalette();
    if (k === 'rotate') return (this.rotOff = !this.rotOff), this.app.ui.toast(`SpaceMouse rotations ${this.rotOff ? 'locked' : 'on'}`);
    if (k === 'mode') return set({ mode: SM.nextMode(c.mode) }, `SpaceMouse: ${SM.nextMode(c.mode)} mode`);
    if (k === 'dominant') return set({ dominant: !c.dominant }, `SpaceMouse dominant axis ${c.dominant ? 'off' : 'on'}`);
    if (k === 'faster' || k === 'slower') {
      const speed = Math.round(Math.min(20, Math.max(0.05, c.speed * (k === 'faster' ? 1.25 : 0.8))) * 100) / 100;
      return set({ speed }, `SpaceMouse speed ${speed}`);
    }
  }

  /** A key held with the button (Esc, Ctrl, Shift, Alt on the Pro and Enterprise). */
  key(key, down) {
    // shortcut: synthetic key events reach key handlers, not the modifier flags of mouse events; read real modifiers if tools need them
    const opts = { key, bubbles: true, ctrlKey: key === 'Control' && down, shiftKey: key === 'Shift' && down, altKey: key === 'Alt' && down };
    (document.activeElement || window).dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', opts));
  }

  // ---------------------------------------------------------------- motion, each frame while the puck is off centre

  wake() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  tick(now) {
    this.raf = 0;
    const m = SM.shape(this.state.raw, this.cfg);
    if (this.rotOff) m[3] = m[4] = m[5] = 0;
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (SM.atRest(m)) return this.rest();
    if (this.clip) this.moveClip(m, dt);
    else this.move(m, dt);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  rest() {
    this.pivot = null;
    if (this.marker?.visible) (this.marker.visible = false), (this.app.viewport.dirty = true);
    const p = this.app.panes?.all()[this.app.panes.focusI];
    if (p && !p.main && this.moved) p.save?.(); // a pane keeps its camera
    else if (this.moved) this.app.viewport.pushView?.();
    this.moved = false;
  }

  /** The pane under the cursor moves: its 3D camera, or the 2D drawing of a road pane. */
  move(m, dt) {
    const { viewport: vp, panes } = this.app;
    const p = panes?.all()[panes.focusI];
    if (p?.board && p.board.style.display !== 'none' && p.view2d?.from !== undefined) this.moveBoard(p, m, dt);
    else vp.withPane(p, () => this.moveCamera(vp, m, dt));
    this.moved = true;
    vp.dirty = true;
  }

  moveBoard(p, m, dt) {
    const t = Math.min(dt, 0.1) * this.cfg.speed;
    const { from, to } = p.view2d;
    const w = to - from;
    const k = Math.exp(m[2] * t); // towards you: see more
    const c = (from + to) / 2 + m[0] * w * t;
    p.view2d = { ...p.view2d, from: c - (w * k) / 2, to: c + (w * k) / 2 };
  }

  moveCamera(vp, m, dt) {
    const cam = vp.camera;
    const ctl = vp.controls;
    const mode = this.cfg.mode;
    if (this.rolled && !cam.quaternion.equals(this.rolled)) this.roll = 0; // the mouse orbited since: OrbitControls levelled it
    this.pivot ||= mode === 'object' ? this.pivotPoint(vp) : ctl.target.clone();
    const { move, turn } = SM.step(m, dt, cam.position.distanceTo(this.pivot), mode);
    const right = V(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = V(0, 1, 0).applyQuaternion(cam.quaternion);
    const back = V(0, 0, 1).applyQuaternion(cam.quaternion);
    if (mode === 'walk') right.setY(0).normalize(), back.setY(0).normalize();
    const pan = right.multiplyScalar(move[0]).addScaledVector(up, mode === 'walk' ? 0 : move[1]);
    if (mode === 'fly' || mode === 'walk') pan.addScaledVector(back, move[2]);
    cam.position.add(pan);
    ctl.target.add(pan);
    if (mode === 'object' || mode === '2d') {
      // zoom: towards the target, never through it
      const d = cam.position.distanceTo(ctl.target);
      cam.position.sub(ctl.target).setLength(Math.max(0.05, d + move[2])).add(ctl.target);
    }
    // turns: object mode around the pivot, the others around the eye; the view never goes past straight up or down
    const centre = mode === 'object' ? this.pivot : cam.position.clone();
    const turnQ = (pitch) => new THREE.Quaternion().setFromAxisAngle(UP, turn[1]).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0).applyQuaternion(cam.quaternion), pitch));
    let q = turnQ(turn[0]);
    if (Math.abs(ctl.target.clone().sub(cam.position).normalize().applyQuaternion(q).y) > 0.995) q = turnQ(0);
    if (mode === 'object') cam.position.sub(centre).applyQuaternion(q).add(centre);
    ctl.target.sub(centre).applyQuaternion(q).add(centre);
    if (mode === 'walk') {
      const y = floorAt(vp, V(cam.position.x, cam.position.y - EYE, cam.position.z), 0.5) + EYE;
      ctl.target.y += y - cam.position.y;
      cam.position.y = y;
    }
    cam.lookAt(ctl.target);
    this.roll = (this.roll || 0) + turn[2];
    if (this.roll) cam.rotateZ(this.roll);
    this.rolled = cam.quaternion.clone();
    if (cam.isOrthographicCamera) vp.fitOrtho();
    if (mode === 'object') this.showPivot(vp);
  }

  /** What object mode turns around, fixed for one push: the view centre, the point under the cursor, or the selection. */
  pivotPoint(vp) {
    const piv = this.cfg.pivot;
    if (piv === 'selection' && this.app.selection?.length) {
      const box = new THREE.Box3();
      for (const id of this.app.selection) {
        const o = vp.objs.get(id);
        if (o) box.expandByObject(o);
      }
      if (!box.isEmpty()) return box.getCenter(V());
    }
    if (piv === 'cursor' && this.pointer && this.pointer.target === vp.input) {
      const hit = vp.pick(this.pointer);
      if (hit) return hit.point;
    }
    return vp.controls.target.clone();
  }

  showPivot(vp) {
    if (!this.marker) {
      this.marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc8553d, depthTest: false, transparent: true, opacity: 0.8 }));
      this.marker.renderOrder = 999;
      vp.overlay.add(this.marker);
    }
    this.marker.position.copy(this.pivot);
    this.marker.scale.setScalar(0.008 * vp.camera.position.distanceTo(this.pivot));
    this.marker.visible = true;
  }

  // ---------------------------------------------------------------- clip box (#291): held, the puck moves the box

  /** The box the puck moves: the clip selected in the view (clipgizmo.js sets activeClip), else the last box that is on. */
  clipBox() {
    const clips = CV.clipsOf(this.app.store.doc);
    const c = clips.find((x) => x.name === this.app.activeClip && x.kind === 'box') || clips.findLast((x) => x.kind === 'box' && x.enabled !== false);
    return c && CV.normalize(c);
  }

  setClip(on) {
    if (on && !this.clip) {
      const c = this.clipBox();
      if (!c) return this.app.ui.toast('Select a clip box first (Clip Box tool or add_clip).');
      this.clip = { name: c.name, c, pose: { center: [...c.center], size: [...c.size], rotation: [...c.rotation] } };
      return;
    }
    if (!on && this.clip) {
      const { name, pose } = this.clip;
      this.clip = false;
      this.app.viewport.clipPreview = null;
      const r4 = (v) => Math.round(v * 1e4) / 1e4;
      // one set_clip for the whole hold: one undo step
      this.app.reg.run('set_clip', { name, center: pose.center.map(r4), size: pose.size.map(r4), rotation: pose.rotation.map(r4) }).catch((e) => (this.app.ui.toast(e.message, 'danger'), this.app.clipGizmo?.sync()));
    }
  }

  /** Translations move the box in the view's directions, turns spin it about its centre; with a face hovered (or
   * picked with Tab), push / pull on the cap moves that face instead. Previewed like the clip handles' drags. */
  moveClip(m, dt) {
    const { viewport: vp, clipGizmo: g } = this.app;
    const { pose, name } = this.clip;
    const cam = vp.mainCam();
    const centre = V(...pose.center);
    const { move, turn } = SM.step(m, dt, cam.position.distanceTo(centre), 'fly');
    const face = g?.name === name ? (g.hover?.faces?.length === 1 ? g.hover.faces[0] : g.face) : null;
    const q = cam.quaternion;
    centre.add(V(move[0], move[1], face ? 0 : move[2]).applyQuaternion(q));
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(turn[0], turn[1], turn[2], 'XYZ'));
    const world = q.clone().multiply(spin).multiply(q.clone().invert()); // the turn in the view's axes
    const r = pose.rotation.map(THREE.MathUtils.degToRad);
    const e = new THREE.Euler().setFromQuaternion(world.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'))), 'XYZ');
    Object.assign(pose, { center: centre.toArray(), rotation: [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg) });
    if (face && move[2]) Object.assign(pose, CV.pushFace({ ...this.clip.c, ...pose }, face, move[2])); // towards you: the face comes out
    vp.clipPreview = { [`clip:${name}`]: { ...pose } };
    g?.sync({ ...pose });
    vp.dirty = true;
  }
}
