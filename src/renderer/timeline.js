// Timeline: playback clock, scrubbing, and the track/keyframe editor at the bottom of the stage.
import * as A from '../core/animation.js';
import { h, icon } from './ui.js';
import { drawCaptions } from './captions.js';

const PAD = 12; // px before 0 s in the lanes

export class Timeline {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('timeline');
    this.time = 0;
    this.playing = false;
    this.active = false;
    this.loop = true;
    this.selKey = null; // { track, t }
    this.laneOf = new Map(); // track → its lane element (kept out of the document, which is plain JSON)
    this.captionLayer = document.getElementById('caption-layer');
  }

  /** Captions at the playhead, over the viewport (the same drawing render_video burns into frames). */
  drawCaptions() {
    const c = this.captionLayer;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) (c.width = Math.round(r.width * dpr)), (c.height = Math.round(r.height * dpr));
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (this.active && !this.recording) drawCaptions(g, this.doc.animation.captions, this.time, c.width, c.height);
  }

  get doc() {
    return this.app.store.doc;
  }

  open() {
    if (this.active) return;
    this.active = true;
    this.el.hidden = false;
    this.seek(this.time);
    this.render();
    this.app.ui.renderViewbar();
  }
  close() {
    this.pause();
    this.active = false;
    this.el.hidden = true;
    this.app.viewport.applyPose(null, false);
    this.drawCaptions();
    this.app.ui.renderViewbar();
  }
  toggle() {
    this.active ? this.close() : this.open();
  }

  seek(t) {
    const dur = this.doc.animation.duration;
    this.time = Math.max(0, Math.min(dur, t));
    if (this.active) this.app.viewport.applyPose(A.evaluate(this.doc, this.time), true);
    this.updateHead();
    if (!this.recording) this.drawCaptions();
  }
  play() {
    if (!this.active) this.open();
    if (this.time >= this.doc.animation.duration - 1e-3) this.seek(0);
    this.playing = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const t = this.time + (now - last) / 1000;
      last = now;
      if (t >= this.doc.animation.duration) {
        if (this.loop && !this.recording) this.seek(0);
        else return this.seek(this.doc.animation.duration), this.pause();
      } else this.seek(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.renderHead();
  }
  pause() {
    this.playing = false;
    this.renderHead();
    this.onPause?.();
  }
  stop() {
    this.pause();
    this.seek(0);
  }

  x(t) {
    const w = this.lanes?.clientWidth || 600;
    return PAD + (t / this.doc.animation.duration) * (w - PAD * 2);
  }
  tAt(px) {
    const w = this.lanes.clientWidth;
    return Math.round(((px - PAD) / (w - PAD * 2)) * this.doc.animation.duration * this.doc.animation.fps) / this.doc.animation.fps;
  }

  renderHead() {
    if (!this.head) return;
    const a = this.doc.animation;
    const app = this.app;
    const run = (n, x) => app.reg.run(n, x).catch((e) => app.ui.toast(e.message, 'danger'));
    const btn = (ic, label, fn, pressed) => h('button.icon-btn.sm', { title: label, 'aria-label': label, onclick: fn, 'aria-pressed': pressed === undefined ? undefined : String(pressed) }, icon(ic, pressed));
    this.timeLabel = h('span.tl-time', {});
    this.head.replaceChildren(...[
      btn('skip-back', 'To start', () => this.seek(0)),
      this.playing ? btn('pause', 'Pause (Shift+Space)', () => this.pause()) : btn('play', 'Play (Shift+Space)', () => this.play()),
      btn('stop', 'Stop', () => this.stop()),
      btn('skip-forward', 'Next keyframe', () => this.seek(A.keyTimes(this.doc).find((t) => t > this.time + 1e-3) ?? a.duration)),
      this.timeLabel,
      btn('diamond', 'Key the selection here (K)', () => app.keySelection()),
      btn('video-camera', 'Key the camera here', () => run('add_keyframe', { target: 'camera' })),
      btn('record', 'Auto-key: moves, rotations and scales record keyframes', () => app.setAutoKey(!app.ctx.autoKey), !!app.ctx.autoKey),
      btn('flag', 'Add a marker at the playhead', () => app.ui.commandDialog('add_marker', { time: this.time })),
      btn('subtitles', 'Add a caption at the playhead', () => app.ui.commandDialog('add_caption', { start: this.time })),
      btn('wave-sine', 'Add a procedural motion (spin, oscillate, wiggle, orbit, pulse)', () => app.ui.commandDialog('add_motion', { target: app.selection[0] || 'camera', start: this.time })),
      h('label', {}, 'Length', h('input', { type: 'number', min: 1, step: 1, value: a.duration, onchange: (e) => run('set_timeline', { duration: +e.target.value }) }), 's'),
      h('label', {}, 'FPS', h('input', { type: 'number', min: 1, max: 120, value: a.fps, onchange: (e) => run('set_timeline', { fps: +e.target.value }) })),
      h('span.spacer'),
      this.selKey ? h('select', { title: 'Easing into the selected keyframe', onchange: (e) => this.setEase(e.target.value) }, Object.keys(A.EASES).map((k) => h('option', { value: k, selected: this.keyObj()?.ease === k }, k))) : null,
      this.selKey ? btn('trash', 'Delete the selected keyframe (Del)', () => this.deleteKey()) : null,
      btn('film-script', 'Render video (frame by frame)…', () => app.ui.commandDialog('render_video', {})),
      btn('x', 'Close timeline (Ctrl+T)', () => this.close()),
    ].filter(Boolean));
    this.updateHead();
  }

  updateHead() {
    const f = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
    if (this.timeLabel) this.timeLabel.textContent = `${f(this.time)} / ${f(this.doc.animation.duration)}`;
    if (this.playhead) this.playhead.style.left = `${this.x(this.time)}px`;
  }

  keyObj() {
    const k = this.selKey;
    return k && k.track.keys.find((x) => Math.abs(x.t - k.t) < 1e-3);
  }
  setEase(ease) {
    const store = this.app.store;
    store.checkpoint();
    const k = this.keyObj();
    if (k) k.ease = ease;
    store.changed();
  }
  deleteKey() {
    const k = this.selKey;
    if (!k) return;
    const store = this.app.store;
    store.checkpoint();
    k.track.keys = k.track.keys.filter((x) => Math.abs(x.t - k.t) > 1e-3);
    store.doc.animation.tracks = store.doc.animation.tracks.filter((t) => t.keys.length);
    this.selKey = null;
    store.changed();
  }

  render() {
    if (!this.active) return;
    const doc = this.doc;
    // The doc may have been replaced (undo): re-find the selected key's track.
    if (this.selKey) {
      const tr = doc.animation.tracks.find((t) => t.target === this.selKey.track.target && t.property === this.selKey.track.property);
      this.selKey = tr ? { track: tr, t: this.selKey.t } : null;
    }
    this.head = h('div.tl-head');
    const names = h('div.tl-names', {}, h('div', { style: { background: 'var(--my-surface-2)' } }, h('span.overline', {}, 'Tracks')));
    this.lanes = h('div.tl-lanes');
    const body = h('div.tl-body', {}, names, this.lanes);
    this.el.replaceChildren(this.head, body);
    this.renderHead();

    const tracks = doc.animation.tracks;
    const ruler = h('div.ruler');
    this.lanes.append(ruler);
    this.laneOf = new Map();
    const run = (n, a) => this.app.reg.run(n, a).catch((e) => this.app.ui.toast(e.message, 'danger'));
    // captions and procedural motions get a row each, above the keyframe tracks
    this.special = [];
    for (const c of doc.animation.captions || []) {
      names.append(h('div', { title: c.text }, icon('subtitles'), 'Caption', h('span.prop', {}, `· ${c.style}`)));
      const lane = h('div.lane');
      this.lanes.append(lane);
      this.special.push({ lane, bars: [{ t0: c.start, t1: c.end, label: c.text.split('\n')[0], cls: 'cap', title: `${c.id} · ${c.style} · ${c.start}–${c.end}s. Double-click to delete.`, del: () => run('remove_caption', { id: c.id }) }] });
    }
    const labelOf = (target) => (target === 'camera' ? 'Camera' : this.app.entity(target)?.name || target);
    for (const m of doc.animation.motions || []) {
      names.append(h('div', {}, icon('wave-sine'), labelOf(m.target), h('span.prop', {}, `· ${m.type}`)));
      const lane = h('div.lane');
      this.lanes.append(lane);
      this.special.push({ lane, bars: [{ t0: m.start ?? 0, t1: m.end ?? doc.animation.duration, label: m.type, cls: 'motion', title: `${m.id} · ${m.type}. Double-click to delete.`, del: () => run('remove_motion', { id: m.id }) }] });
    }
    if (!tracks.length && !this.special.length) {
      body.append(h('div.tl-empty', {}, 'No animation yet. Select something, move the playhead, change it and press K (or turn on Auto-key). Or ask the AI: "animate the door opening over 2 seconds", "make a build sequence", "add a turntable".'));
    }
    const label = (target) => (target === 'camera' ? 'Camera' : this.app.entity(target)?.name || target);
    for (const tr of tracks) {
      const sel = this.app.selection.includes(tr.target);
      names.append(h(`div${sel ? '.sel' : ''}`, { onclick: () => tr.target !== 'camera' && this.app.select([tr.target]) }, icon(tr.target === 'camera' ? 'video-camera' : 'cube'), label(tr.target), h('span.prop', {}, `· ${tr.property}`)));
      const lane = h('div.lane');
      this.lanes.append(lane);
      this.laneOf.set(tr, lane);
    }
    requestAnimationFrame(() => this.layout(ruler));
    this.playhead = h('div.playhead');
    this.lanes.append(this.playhead);
    this.lanes.onpointerdown = (e) => {
      if (e.target.classList.contains('kf')) return;
      const r = this.lanes.getBoundingClientRect();
      const scrub = (ev) => this.seek(this.tAt(ev.clientX - r.left));
      scrub(e);
      this.lanes.setPointerCapture(e.pointerId);
      this.lanes.onpointermove = scrub;
      this.lanes.onpointerup = () => (this.lanes.onpointermove = null);
    };
    new ResizeObserver(() => this.layout(ruler)).observe(this.lanes);
  }

  layout(ruler) {
    const doc = this.doc;
    const dur = doc.animation.duration;
    const step = dur <= 10 ? 1 : dur <= 30 ? 2 : dur <= 120 ? 10 : 30;
    const run = (n, a) => this.app.reg.run(n, a).catch((e) => this.app.ui.toast(e.message, 'danger'));
    ruler.replaceChildren(
      ...Array.from({ length: Math.floor(dur / step) + 1 }, (_, i) => h('span', { style: { left: `${this.x(i * step)}px` } }, `${i * step}s`)),
      ...(doc.animation.markers || []).map((m) =>
        h('button.marker', { style: { left: `${this.x(m.t)}px` }, title: `${m.name} · ${m.t}s. Click to go there, double-click to delete.`, onpointerdown: (e) => e.stopPropagation(), onclick: () => this.seek(m.t), ondblclick: () => run('remove_marker', { name: m.name }) }, icon('flag', true), m.name),
      ),
    );
    for (const row of this.special || [])
      row.lane.replaceChildren(
        ...row.bars.map((b) =>
          h(`div.span-bar.${b.cls}`, { style: { left: `${this.x(b.t0)}px`, width: `${Math.max(4, this.x(Math.min(dur, b.t1)) - this.x(b.t0))}px` }, title: b.title, onpointerdown: (e) => e.stopPropagation(), onclick: () => this.seek(b.t0), ondblclick: b.del }, b.label),
        ),
      );
    for (const tr of doc.animation.tracks) {
      const lane = this.laneOf.get(tr);
      if (!lane) continue;
      const k0 = tr.keys[0].t;
      const k1 = tr.keys.at(-1).t;
      lane.replaceChildren(
        h('div.bar', { style: { left: `${this.x(k0)}px`, width: `${Math.max(0, this.x(k1) - this.x(k0))}px` } }),
        ...tr.keys.map((k) => {
          const sel = this.selKey?.track === tr && Math.abs(this.selKey.t - k.t) < 1e-3;
          const d = h(`div.kf${sel ? '.sel' : ''}`, { style: { left: `${this.x(k.t)}px` }, title: `${tr.property} @ ${k.t}s · ${k.ease}\n${JSON.stringify(k.v)}` });
          d.onpointerdown = (e) => this.dragKey(e, tr, k, d);
          return d;
        }),
      );
    }
    this.updateHead();
  }

  dragKey(e, tr, k, el) {
    e.stopPropagation();
    this.selKey = { track: tr, t: k.t };
    const r = this.lanes.getBoundingClientRect();
    const t0 = k.t;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (ev) => {
      const t = Math.max(0, this.tAt(ev.clientX - r.left));
      if (!moved && Math.abs(this.x(t) - this.x(t0)) < 3) return;
      moved = true;
      el.style.left = `${this.x(t)}px`;
      el.dataset.t = t;
    };
    el.onpointerup = () => {
      el.onpointermove = el.onpointerup = null;
      const store = this.app.store;
      if (moved && el.dataset.t !== undefined) {
        const t = +el.dataset.t;
        store.checkpoint();
        const live = store.doc.animation.tracks.find((x) => x.target === tr.target && x.property === tr.property);
        const key = live.keys.find((x) => Math.abs(x.t - t0) < 1e-3);
        live.keys = live.keys.filter((x) => x === key || Math.abs(x.t - t) > 1e-3);
        key.t = t;
        live.keys.sort((a, b) => a.t - b.t);
        if (t > store.doc.animation.duration) store.doc.animation.duration = Math.ceil(t);
        this.selKey = { track: live, t };
        store.changed();
      } else {
        this.seek(t0);
        this.render();
      }
    };
  }
}
