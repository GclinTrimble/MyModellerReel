// Audio on the timeline (#83): clips play with the timeline (with fades) and are mixed into rendered MP4 / WebM.
import * as Assets from '../core/assets.js';

const urls = new Map();
const urlOf = (asset) => {
  if (!urls.has(asset)) {
    const a = Assets.get(asset);
    if (!a) return null;
    urls.set(asset, URL.createObjectURL(new Blob([a.bytes], { type: a.mime })));
  }
  return urls.get(asset);
};

/** Gain of a clip at a time into it (fades in and out), times its volume. */
export function gainAt(c, local, length) {
  let g = c.volume ?? 0.8;
  if (c.fade_in > 0) g *= Math.min(1, local / c.fade_in);
  if (c.fade_out > 0 && Number.isFinite(length)) g *= Math.min(1, Math.max(0, (length - local) / c.fade_out));
  return Math.max(0, Math.min(1, g));
}

export class AudioPlayer {
  constructor() {
    this.els = new Map();
  }
  /** Called every frame while playing (and once at play): start, stop and fade clips for timeline time t. */
  update(doc, t) {
    const live = new Set();
    for (const c of doc.animation.audio || []) {
      const key = `${c.name}|${c.asset}`;
      live.add(key);
      let el = this.els.get(key);
      if (!el) {
        const url = urlOf(c.asset);
        if (!url) continue;
        el = new Audio(url);
        el.preload = 'auto';
        this.els.set(key, el);
      }
      const local = t - c.start;
      const length = Number.isFinite(el.duration) ? el.duration : Infinity;
      if (local < 0 || local >= length) {
        if (!el.paused) el.pause();
        continue;
      }
      el.volume = gainAt(c, local, length);
      if (el.paused) {
        el.currentTime = local;
        el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = local; // drifted, or the playhead jumped
    }
    for (const [k, el] of this.els) if (!live.has(k)) el.pause(), this.els.delete(k);
  }
  stop() {
    for (const el of this.els.values()) el.pause();
  }
}

/** The audio of [from, to] mixed to stereo 48 kHz, or null when there is none. */
export async function mixAudio(doc, from, to) {
  const clips = (doc.animation.audio || []).filter((c) => Assets.get(c.asset));
  if (!clips.length) return null;
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((to - from) * rate)), rate);
  for (const c of clips) {
    const a = Assets.get(c.asset);
    const buf = await ctx.decodeAudioData(a.bytes.slice().buffer);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const at = c.start - from; // where the clip starts in the render (negative: it started before)
    const t0 = Math.max(0, at);
    const offset = Math.max(0, -at);
    const peak = c.volume ?? 0.8;
    gain.gain.setValueAtTime(c.fade_in > 0 && offset < c.fade_in ? peak * (offset / c.fade_in) : peak, t0);
    if (c.fade_in > 0 && offset < c.fade_in) gain.gain.linearRampToValueAtTime(peak, t0 + c.fade_in - offset);
    const end = at + buf.duration;
    if (c.fade_out > 0) gain.gain.setValueAtTime(peak, Math.max(t0, end - c.fade_out)), gain.gain.linearRampToValueAtTime(0, Math.max(t0, end));
    src.connect(gain).connect(ctx.destination);
    if (offset < buf.duration) src.start(t0, offset);
  }
  return ctx.startRendering();
}
