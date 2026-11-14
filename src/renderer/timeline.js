// Timeline: playback clock, scrubbing, and the track/keyframe editor at the bottom of the stage.
import * as A from '../core/animation.js';
import { h, icon } from './ui.js';
import { drawCaptions } from './captions.js';
import { AudioPlayer } from './audio.js';

const PAD = 12; // px before 0 s in the lanes

const keyId = (tr, t) => `${tr.target}|${tr.property}|${Math.round(t * 1000)}`;

export class Timeline {
  selKeys = new Set();
  clipboard = null;

  /** The selected keys as [{ track, key }] in the live document. */
  selectedKeys() {
    const out = [];
    for (const tr of this.doc.animation.tracks) for (const k of tr.keys) if (this.selKeys.has(keyId(tr, k.t))) out.push({ track: tr, key: k });
    return out;
  }
  layoutNow() {
    const ruler = this.lanes?.querySelector('.ruler');
    if (ruler) this.layout(ruler);
  }

  /** Shift-drag a box on the lanes: the keys inside it are selected. */
  boxSelect(e) {
    const r = this.lanes.getBoundingClientRect();
    const box = h('div.tl-box');
    this.lanes.append(box);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const place = (ev) => Object.assign(box.style, { left: `${Math.min(x0, ev.clientX) - r.left + this.lanes.scrollLeft}px`, top: `${Math.min(y0, ev.clientY) - r.top + this.lanes.scrollTop}px`, width: `${Math.abs(ev.clientX - x0)}px`, height: `${Math.abs(ev.clientY - y0)}px` });
    place(e);
    this.lanes.setPointerCapture(e.pointerId);
    this.lanes.onpointermove = place;
    this.lanes.onpointerup = (ev) => {
      this.lanes.onpointermove = this.lanes.onpointerup = null;
      const [xa, xb, ya, yb] = [Math.min(x0, ev.clientX), Math.max(x0, ev.clientX), Math.min(y0, ev.clientY), Math.max(y0, ev.clientY)];
      for (const el of this.lanes.querySelectorAll('.kf')) {
        const b = el.getBoundingClientRect();
        if (b.right >= xa && b.left <= xb && b.bottom >= ya && b.top <= yb) this.selKeys.add(el.dataset.key);
      }
      box.remove();
      this.layoutNow();
    };
  }

  /** Drag every selected key by the same time. */
  dragMany(e, t0) {
    const r = this.lanes.getBoundingClientRect();
    const els = [...this.lanes.querySelectorAll('.kf.sel')].map((el) => [el, parseFloat(el.style.left)]);
    let dt = 0;
    const target = e.target;
    target.setPointerCapture(e.pointerId);
    target.onpointermove = (ev) => {
      dt = this.tAt(ev.clientX - r.left) - t0;
      const dx = this.x(Math.max(0, t0 + dt)) - this.x(t0);
      for (const [el, left] of els) el.style.left = `${left + dx}px`;
    };
    target.onpointerup = () => {
      target.onpointermove = target.onpointerup = null;
      if (Math.abs(dt) < 1e-6) return;
      this.moveSelected(dt);
    };
  }
  moveSelected(dt) {
    const store = this.app.store;
    store.checkpoint();
    const sel = this.selectedKeys();
    const min = Math.min(...sel.map((s) => s.key.t));
    dt = Math.max(-min, dt); // nothing before 0
    const moved = new Set(sel.map((s) => s.key));
    const next = new Set();
    for (const { track, key } of sel) {
      key.t = Math.round((key.t + dt) * 1000) / 1000;
      next.add(keyId(track, key.t));
    }
    for (const tr of store.doc.animation.tracks) {
      tr.keys = tr.keys.filter((k) => moved.has(k) || !tr.keys.some((m) => moved.has(m) && Math.abs(m.t - k.t) < 1e-3));
      tr.keys.sort((a, b) => a.t - b.t);
    }
    const last = Math.max(0, ...store.doc.animation.tracks.flatMap((tr) => tr.keys.map((k) => k.t)));
    if (last > store.doc.animation.duration) store.doc.animation.duration = Math.ceil(last);
    this.selKeys = next;
    store.changed();
  }

  /** Keys for selected keyframes: Ctrl+C, Ctrl+V (at the playhead; onto the selected shapes when copied from one), Delete. */
  handleKey(ev) {
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    const store = this.app.store;
    if (ctrl && k === 'c' && this.selKeys.size) {
      const sel = this.selectedKeys();
      const min = Math.min(...sel.map((s) => s.key.t));
      this.clipboard = sel.map(({ track, key }) => ({ target: track.target, property: track.property, dt: key.t - min, v: structuredClone(key.v), ease: key.ease, bezier: key.bezier }));
      this.app.ui.toast(`Copied ${sel.length} keyframes`);
      return ev.preventDefault(), true;
    }
    if (ctrl && k === 'v' && this.clipboard) {
      const sources = [...new Set(this.clipboard.map((c) => c.target))];
      const dests = sources.length === 1 && this.app.selection.length ? this.app.selection : null;
      store.checkpoint();
      for (const c of this.clipboard) for (const target of dests || [c.target]) A.setKey(store.doc, target, c.property, this.time + c.dt, c.v, c.ease, c.bezier || null);
      store.changed();
      this.app.ui.toast(`Pasted ${this.clipboard.length * (dests?.length || 1)} keyframes at ${this.time.toFixed(2)} s`);
      return ev.preventDefault(), true;
    }
    if ((k === 'delete' || k === 'backspace') && this.selKeys.size) {
      store.checkpoint();
      const gone = new Set(this.selectedKeys().map((s) => s.key));
      for (const tr of store.doc.animation.tracks) tr.keys = tr.keys.filter((x) => !gone.has(x));
      store.doc.animation.tracks = store.doc.animation.tracks.filter((t) => t.keys.length);
      this.selKeys = new Set();
      this.selKey = null;
      store.changed();
      return ev.preventDefault(), true;
    }
    return false;
  }

  /** The curve editor (#77): drag the two handles of the easing into the selected key. */
  curveDialog() {
    const k = this.keyObj();
    if (!k) return;
    const tr = this.selKey.track;
    let b = k.bezier ? [...k.bezier] : [0.42, 0, 0.58, 1];
    const S = 240;
    const P = 30;
    const X = (x) => P + x * S;
    const Y = (y) => P + (1 - y) * S;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${S + 2 * P} ${S + 2 * P}`);
    svg.setAttribute('class', 'curve-editor');
    const draw = () => {
      svg.innerHTML = `<rect x="${P}" y="${P}" width="${S}" height="${S}" class="ce-frame"/><line x1="${X(0)}" y1="${Y(0)}" x2="${X(b[0])}" y2="${Y(b[1])}" class="ce-arm"/><line x1="${X(1)}" y1="${Y(1)}" x2="${X(b[2])}" y2="${Y(b[3])}" class="ce-arm"/><path d="M${X(0)},${Y(0)} C${X(b[0])},${Y(b[1])} ${X(b[2])},${Y(b[3])} ${X(1)},${Y(1)}" class="ce-curve"/><circle cx="${X(b[0])}" cy="${Y(b[1])}" r="7" class="ce-handle" data-i="0"/><circle cx="${X(b[2])}" cy="${Y(b[3])}" r="7" class="ce-handle" data-i="2"/>`;
      readout.textContent = `cubic-bezier(${b.map((x) => x.toFixed(2)).join(', ')})`;
    };
    const readout = h('p.small.muted', {});
    svg.onpointerdown = (e) => {
      const i = e.target.dataset?.i;
      if (i === undefined) return;
      svg.setPointerCapture(e.pointerId);
      const r = svg.getBoundingClientRect();
      svg.onpointermove = (ev) => {
        const sx = ((ev.clientX - r.left) / r.width) * (S + 2 * P);
        const sy = ((ev.clientY - r.top) / r.height) * (S + 2 * P);
        b[+i] = Math.round(Math.max(0, Math.min(1, (sx - P) / S)) * 100) / 100;
        b[+i + 1] = Math.round(Math.max(-0.5, Math.min(1.5, 1 - (sy - P) / S)) * 100) / 100;
        draw();
      };
      svg.onpointerup = () => (svg.onpointermove = svg.onpointerup = null);
    };
    draw();
    const presets = h('div.row', {}, ...[['Ease in-out', [0.42, 0, 0.58, 1]], ['Ease out', [0, 0, 0.2, 1]], ['Overshoot', [0.3, 1.4, 0.6, 1]], ['Slow start', [0.8, 0, 0.9, 0.6]]].map(([l, v]) => h('button.btn.sm', { onclick: () => ((b = [...v]), draw()) }, l)));
    this.app.ui.modal(`Easing into ${tr.property} @ ${k.t}s`, h('div', {}, svg, readout, presets), [['Apply', 'ok'], ['Cancel', null]]).then((r) => {
      if (r !== 'ok') return;
      this.app.reg.run('set_ease', { id: tr.target, property: tr.property, time: k.t, bezier: b }).catch((e) => this.app.ui.toast(e.message, 'danger'));
    });
  }

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
    this.audio ||= new AudioPlayer();
    if (!this.recording) this.audio.update(this.doc, this.time);
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const t = this.time + (now - last) / 1000;
      last = now;
      if (t >= this.doc.animation.duration) {
        if (this.loop && !this.recording) this.seek(0);
        else return this.seek(this.doc.animation.duration), this.pause();
      } else this.seek(t);
      if (!this.recording) this.audio.update(this.doc, this.time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.renderHead();
  }
  pause() {
    this.playing = false;
    this.audio?.stop();
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
      this.selKey ? h('select', { title: 'Easing into the selected keyframe', onchange: (e) => this.setEase(e.target.value) }, Object.keys(A.EASES).map((k) => h('option', { value: k, selected: this.keyObj()?.ease === k }, k)), this.keyObj()?.bezier ? h('option', { value: 'bezier', selected: true }, 'custom curve') : null) : null,
      this.selKey ? btn('bezier-curve', 'Curve editor: drag the easing handles', () => this.curveDialog()) : null,
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
    if (k && ease !== 'bezier') (k.ease = ease), delete k.bezier;
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
    // a survey replay reads as the day's work: a band per setup, a dot per measurement (#284)
    for (const r of doc.animation.replays || []) {
      names.append(h('div', { title: `${r.name}: ${r.dots.length} measurements, ${r.mode} time${r.speed === 1 ? '' : ` × ${r.speed}`}` }, icon('crosshair'), r.name, h('span.prop', {}, `· ${r.dots.length} shots`)));
      const lane = h('div.lane');
      this.lanes.append(lane);
      this.special.push({
        lane,
        bars: r.bands.map((b) => ({ t0: b.t0, t1: b.t1, label: b.station || 'Keyed in', cls: 'setup', title: `${b.kind === 'base' ? 'Base' : b.kind === 'station' ? 'Station' : 'Keyed in'} ${b.station}`.trim() })),
        dots: r.dots,
      });
    }
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
    const shots = doc.animation.shots || [];
    if (shots.length) {
      names.append(h('div', {}, icon('film-strip'), 'Shots'));
      const lane = h('div.lane');
      this.lanes.append(lane);
      this.special.push({ lane, bars: shots.map((s) => ({ t0: s.start, t1: s.end, label: s.name, cls: 'shot', title: `${s.name} · ${s.start}–${s.end}s${s.camera_end ? ' · moving' : ''}. Double-click to delete.`, del: () => run('remove_shot', { name: s.name }) })) });
    }
    for (const c of doc.animation.audio || []) {
      names.append(h('div', { title: c.name }, icon('music-notes'), c.name));
      const lane = h('div.lane');
      this.lanes.append(lane);
      this.special.push({ lane, bars: [{ t0: c.start, t1: doc.animation.duration, label: `${c.name} · ${Math.round((c.volume ?? 0.8) * 100)} %`, cls: 'audio', title: `${c.name} from ${c.start}s. Double-click to remove.`, del: () => run('remove_audio', { name: c.name }) }] });
    }
    for (const c of doc.animation.constraints || []) {
      const what = c.type === 'look_at' ? `looks at ${Array.isArray(c.at) ? 'a point' : labelOf(c.at)}` : `${c.type === 'attach' ? 'on' : 'follows'} ${labelOf(c.parent)}`;
      names.append(h('div', {}, icon(c.type === 'look_at' ? 'eye' : 'link'), labelOf(c.target), h('span.prop', {}, `· ${c.type}`)));
      const lane = h('div.lane');
      this.lanes.append(lane);
      this.special.push({ lane, bars: [{ t0: c.start ?? 0, t1: c.end ?? doc.animation.duration, label: what, cls: 'motion', title: `${labelOf(c.target)} ${what}. Double-click to remove its constraints.`, del: () => run('remove_constraints', { id: c.target }) }] });
    }
    if (!tracks.length && !this.special.length) {
      body.append(h('div.tl-empty', {}, 'No animation yet. Select something, move the playhead, change it and press K (or turn on Auto-key). Or ask the AI: "animate the door opening over 2 seconds", "make a build sequence", "add a turntable".'));
    }
    const label = (target) => (target === 'camera' ? 'Camera' : target === 'section' ? 'Section plane' : target.startsWith('clip:') ? `Clip ${target.slice(5)}` : this.app.entity(target)?.name || target);
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
      if (e.shiftKey) return this.boxSelect(e);
      const r = this.lanes.getBoundingClientRect();
      const scrub = (ev) => this.seek(this.tAt(ev.clientX - r.left));
      scrub(e);
      this.lanes.setPointerCapture(e.pointerId);
      this.lanes.onpointermove = scrub;
      this.lanes.onpointerup = () => (this.lanes.onpointermove = null);
    };
    new ResizeObserver(() => this.layout(ruler)).observe(this.lanes);
  }

  /** A replay's dots, thinned to what the lane can show: flagged shots always survive. */
  dotsOf(row) {
    if (!row.dots) return [];
    let last = -Infinity;
    return row.dots.filter((d) => {
      const x = this.x(d.t);
      if (!d.flagged && x - last < 3) return false;
      last = x;
      return true;
    });
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
        ...this.dotsOf(row).map((d) =>
          h(`div.tl-dot.${d.flagged ? 'flag' : d.kind}`, {
            style: { left: `${this.x(d.t)}px` },
            title: `${d.name}${d.code ? ` (${d.code})` : ''} · ${{ ts: 'prism', dr: 'reflectorless', gnss: 'GNSS', keyed: 'keyed in', computed: 'computed' }[d.kind] || d.kind}${d.cls ? ` ${d.cls}` : ''}${d.time ? ` · ${d.time}` : ''}${d.flagged ? ' · flagged by review_survey' : ''}. Click to select it.`,
            onpointerdown: (e) => e.stopPropagation(),
            onclick: () => {
              this.seek(d.t);
              const p = this.doc.entities.find((e) => e.type === 'point' && e.name === d.name);
              if (p) this.app.select([p.id]);
            },
          }),
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
          const sel = (this.selKey?.track === tr && Math.abs(this.selKey.t - k.t) < 1e-3) || this.selKeys.has(keyId(tr, k.t));
          const d = h(`div.kf${sel ? '.sel' : ''}`, { style: { left: `${this.x(k.t)}px` }, title: `${tr.property} @ ${k.t}s · ${k.ease}${k.bezier ? ` (${k.bezier.join(', ')})` : ''}\n${JSON.stringify(k.v)}\nShift-click or shift-drag to select several; Ctrl+C / Ctrl+V / Delete` });
          d.dataset.key = keyId(tr, k.t);
          d.onpointerdown = (e) => this.dragKey(e, tr, k, d);
          return d;
        }),
      );
    }
    this.updateHead();
  }

  dragKey(e, tr, k, el) {
    e.stopPropagation();
    const id = keyId(tr, k.t);
    if (e.shiftKey) {
      this.selKeys.has(id) ? this.selKeys.delete(id) : this.selKeys.add(id);
      return this.layoutNow();
    }
    if (this.selKeys.size > 1 && this.selKeys.has(id)) return this.dragMany(e, k.t);
    this.selKeys = new Set([id]);
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
