// Frame-accurate offline render (#72): step the timeline frame by frame, draw each frame at the output size,
// burn in captions and encode. No real-time capture, so no dropped frames at any resolution.
// MP4 is H.264 (VP9 when this PC has no H.264 encoder), WebM is VP9 (with transparency), plus GIF and PNG sequences.
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_MEDIUM, QUALITY_HIGH, QUALITY_VERY_HIGH, canEncodeVideo, canEncodeAudio } from 'mediabunny';
import { mixAudio } from './audio.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { drawCaptions } from './captions.js';

const QUALITY = { medium: QUALITY_MEDIUM, high: QUALITY_HIGH, 'very-high': QUALITY_VERY_HIGH };
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

/** Hide what must not be in a frame (grid, axes, previews, selection) and size the renderer; returns an undo. */
export function stage(vp, w, h, transparent) {
  const r = vp.renderer;
  const saved = {
    ratio: r.getPixelRatio(),
    bg: vp.scene.background,
    clear: r.getClearAlpha(),
    vis: [vp.grid, vp.axes, vp.overlay, vp.ghosts].map((o) => o.visible),
    selection: vp.selection,
    proposed: vp.proposed,
    aspect: vp.persp.aspect,
  };
  for (const o of [vp.grid, vp.axes, vp.overlay, vp.ghosts]) o.visible = false;
  vp.proposed = new Set();
  vp.highlight([]);
  if (transparent) {
    vp.scene.background = null;
    r.setClearAlpha(0);
  }
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  vp.setAspect(w / h);
  vp.rendering = true; // the viewport's own loop must not redraw at the wrong size meanwhile
  return () => {
    vp.rendering = false;
    vp.scene.background = saved.bg;
    r.setClearAlpha(saved.clear);
    [vp.grid, vp.axes, vp.overlay, vp.ghosts].forEach((o, i) => (o.visible = saved.vis[i]));
    vp.proposed = saved.proposed;
    vp.highlight(saved.selection);
    r.setPixelRatio(saved.ratio);
    vp.persp.aspect = saved.aspect;
    vp.resize();
  };
}

/**
 * opts: { path, format, width, height, fps, from, to, transparent, quality }. Writes through the main process.
 * Returns what was written.
 */
export async function renderVideo(app, opts, write) {
  const doc = app.store.doc;
  const format = (opts.format || opts.path.split('.').pop() || 'mp4').toLowerCase();
  if (!['mp4', 'webm', 'gif', 'png'].includes(format)) throw new Error(`Cannot render .${format}: use mp4, webm, gif or png.`);
  if (format === 'mp4' && opts.transparent) throw new Error('MP4 has no transparency: render webm, png or gif for a transparent background.');
  const w = even(opts.width || 1920);
  const h = even(opts.height || 1080);
  if (w > 7680 || h > 4320) throw new Error('At most 7680 × 4320 pixels.');
  const fps = opts.fps || doc.animation.fps || 30;
  const from = opts.from ?? 0;
  const to = opts.to ?? doc.animation.duration;
  const frames = Math.max(1, Math.round((to - from) * fps));
  const vp = app.viewport;
  const tl = app.timeline;
  tl.open();
  tl.pause();
  const t0 = performance.now();
  const comp = document.createElement('canvas');
  comp.width = w;
  comp.height = h;
  const g = comp.getContext('2d', { alpha: !!opts.transparent, willReadFrequently: format === 'gif' });
  const restore = stage(vp, w, h, opts.transparent);
  tl.recording = true;
  const draw = (i) => {
    const t = from + i / fps;
    tl.seek(t);
    vp.draw();
    g.clearRect(0, 0, w, h);
    g.drawImage(vp.canvas, 0, 0, w, h);
    drawCaptions(g, doc.animation.captions, t, w, h);
  };
  const progress = (i) => i % 10 === 0 && app.ui.setStatus(`Rendering frame ${i + 1} of ${frames}…`);
  let codec = null;
  try {
    if (format === 'mp4' || format === 'webm') {
      codec = format === 'webm' ? 'vp9' : (await canEncodeVideo('avc', { width: w, height: h })) ? 'avc' : 'vp9';
      const output = new Output({ format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
      const source = new CanvasSource(comp, { codec, bitrate: QUALITY[opts.quality || 'high'] || QUALITY_HIGH, alpha: opts.transparent ? 'keep' : 'discard', keyFrameInterval: 2 });
      output.addVideoTrack(source, { frameRate: fps });
      // music and voiceover (#83): mixed for the rendered span, AAC in MP4, Opus in WebM
      const mix = await mixAudio(doc, from, to).catch((e) => (console.error('audio mix:', e), null));
      const acodec = mix && (format === 'webm' ? 'opus' : (await canEncodeAudio('aac')) ? 'aac' : 'opus');
      const audio = mix && acodec && (format === 'webm' || acodec === 'aac') ? new AudioBufferSource({ codec: acodec, bitrate: 160e3 }) : null;
      if (audio) output.addAudioTrack(audio);
      await output.start();
      if (audio) await audio.add(mix);
      for (let i = 0; i < frames; i++) {
        draw(i);
        await source.add(i / fps, 1 / fps);
        progress(i);
      }
      await output.finalize();
      await write(opts.path, output.target.buffer);
    } else if (format === 'gif') {
      const gif = GIFEncoder();
      for (let i = 0; i < frames; i++) {
        draw(i);
        const { data } = g.getImageData(0, 0, w, h);
        const palette = quantize(data, 256, { format: opts.transparent ? 'rgba4444' : 'rgb565', oneBitAlpha: !!opts.transparent });
        gif.writeFrame(applyPalette(data, palette, opts.transparent ? 'rgba4444' : 'rgb565'), w, h, { palette, delay: Math.round(1000 / fps), transparent: !!opts.transparent });
        progress(i);
      }
      gif.finish();
      await write(opts.path, gif.bytes());
    } else {
      const base = opts.path.replace(/(_\d+)?\.png$/i, '');
      for (let i = 0; i < frames; i++) {
        draw(i);
        const blob = await new Promise((r) => comp.toBlob(r, 'image/png'));
        await write(`${base}_${String(i + 1).padStart(4, '0')}.png`, await blob.arrayBuffer());
        progress(i);
      }
    }
  } finally {
    tl.recording = false;
    restore();
    tl.seek(from);
    app.ui.setStatus('');
  }
  return { exported: format === 'png' ? `${opts.path.replace(/(_\d+)?\.png$/i, '')}_0001.png …` : opts.path, format, codec, frames, width: w, height: h, fps, seconds: Math.round((performance.now() - t0) / 100) / 10 };
}
