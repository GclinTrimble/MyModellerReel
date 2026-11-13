// The sketch pad (#229, #230): draw over a snapshot of the view or on plain paper to show Plumb what you mean, or
// sketch a profile that turns into clean straight lines at a real size. Strokes stay vectors until the end, so Straighten
// can redraw them as a tidy outline with each side's length as you go.
import { h, icon } from './ui.js';
import { cleanSketch, scaleOutline } from '../core/sketch.js';

const W = 960;
const H = 560;
const INK = ['#c8553d', '#2f6f86', '#1d262c']; // canvas ink (data, not page style)
const CLEAN = '#2f6f86';

/**
 * Open the pad. mode 'chat' resolves to { image, note } (or null); mode 'profile' saves a sweep profile, or hands the
 * sketch to Plumb. background: 'view' (a snapshot of the 3D view) or 'paper'.
 */
export async function sketchPad(app, { mode = 'chat', background = mode === 'profile' ? 'paper' : 'view' } = {}) {
  const strokes = [];
  let tool = 'pen';
  let ink = INK[0];
  let bg = background;
  let shot = null;
  let live = null;
  const canvas = h('canvas.sketch-canvas', { width: W, height: H, 'aria-label': 'Sketch area: draw with the mouse or a pen' });
  const g = canvas.getContext('2d');
  const label = h('input.sketch-label', { placeholder: 'Label, e.g. 3 m', 'aria-label': 'Label text', value: '3 m', hidden: true });
  const straighten = h('input', { type: 'checkbox', checked: mode === 'profile' });
  const width = h('input.form-num', { inputmode: 'decimal', placeholder: 'width', 'aria-label': 'Real width in metres' });
  const height = h('input.form-num', { inputmode: 'decimal', placeholder: 'height', 'aria-label': 'Real height in metres' });
  const name = h('input', { value: `Sketch ${Object.keys(app.store.doc.profiles || {}).length + 1}`, 'aria-label': 'Profile name' });
  const status = h('div.small.muted.sketch-status', { role: 'status' });

  const outline = () => {
    const lines = strokes.filter((s) => s.kind !== 'text').map((s) => s.pts);
    if (!lines.length) return null;
    try {
      return scaleOutline(cleanSketch(lines), { width: +width.value || undefined, height: +height.value || undefined });
    } catch {
      return null;
    }
  };
  const draw = () => {
    g.fillStyle = '#fbfaf7';
    g.fillRect(0, 0, W, H);
    if (bg === 'view' && shot) {
      const k = Math.min(W / shot.width, H / shot.height);
      g.drawImage(shot, (W - shot.width * k) / 2, (H - shot.height * k) / 2, shot.width * k, shot.height * k);
    } else {
      g.strokeStyle = '#e4e0d6';
      g.lineWidth = 1;
      for (let x = 0; x <= W; x += 20) g.beginPath(), g.moveTo(x + 0.5, 0), g.lineTo(x + 0.5, H), g.stroke();
      for (let y = 0; y <= H; y += 20) g.beginPath(), g.moveTo(0, y + 0.5), g.lineTo(W, y + 0.5), g.stroke();
    }
    const tidy = straighten.checked;
    for (const s of strokes) {
      g.strokeStyle = g.fillStyle = s.color;
      g.globalAlpha = tidy && s.kind !== 'text' ? 0.3 : 1;
      if (s.kind === 'text') {
        g.font = '600 18px system-ui, sans-serif';
        g.fillText(s.text, s.pts[0][0], s.pts[0][1]);
        continue;
      }
      g.lineWidth = 3;
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.globalAlpha = 1;
    status.textContent = '';
    if (!tidy) return;
    // the clean outline over the strokes, with each side's length
    const o = outline();
    if (!o) return void (status.textContent = 'Draw the outline: straight sides, corners where you turn. Close it by ending near the start.');
    const ring = o.closed ? [...o.canvas, o.canvas[0]] : o.canvas;
    g.strokeStyle = CLEAN;
    g.lineWidth = 3;
    g.beginPath();
    ring.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.fillStyle = CLEAN;
    g.font = '600 14px system-ui, sans-serif';
    const real = o.closed ? [...o.points, o.points[0]] : o.points;
    for (let i = 0; i < ring.length - 1; i++) {
      const [a, b] = [ring[i], ring[i + 1]];
      const len = Math.hypot(real[i + 1][0] - real[i][0], real[i + 1][1] - real[i][1]);
      g.fillRect(a[0] - 3, a[1] - 3, 6, 6);
      g.fillText(o.scale !== 1 ? `${len.toFixed(2)} m` : `${Math.round(len)}`, (a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2 - 6);
    }
    status.textContent = `${o.closed ? 'Closed' : 'Open'} outline, ${o.points.length} corners${o.scale !== 1 ? `, ${o.width} × ${o.height} m` : '. Type a real width or height to size it.'}`;
  };
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  };
  const erase = (p) => {
    const i = strokes.findIndex((s) => s.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 12));
    if (i >= 0) strokes.splice(i, 1), draw();
  };
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = at(e);
    if (tool === 'eraser') return erase(p);
    if (tool === 'text') return label.value.trim() && (strokes.push({ kind: 'text', color: ink, pts: [p], text: label.value.trim() }), draw());
    live = { kind: tool, color: ink, pts: tool === 'line' ? [p, p] : [p] };
    strokes.push(live);
  };
  canvas.onpointermove = (e) => {
    if (tool === 'eraser' && e.buttons) return erase(at(e));
    if (!live) return;
    const p = at(e);
    if (live.kind === 'line') live.pts[1] = p;
    else if (Math.hypot(p[0] - live.pts.at(-1)[0], p[1] - live.pts.at(-1)[1]) > 2) live.pts.push(p);
    draw();
  };
  canvas.onpointerup = () => {
    if (live && live.pts.length < 2) strokes.pop();
    live = null;
    draw();
  };

  const seg = (items, get, set) => h('div.segmented', { role: 'radiogroup' }, ...items.map(([v, l, ic]) => h('button.seg', { type: 'button', 'aria-pressed': String(get() === v), title: l, onclick: (e) => (set(v), [...e.currentTarget.parentNode.children].forEach((b, i) => b.setAttribute('aria-pressed', String(items[i][0] === v))), draw()) }, icon(ic), l)));
  const tools = seg([['pen', 'Pen', 'pencil-simple'], ['line', 'Line', 'line-segment'], ['text', 'Label', 'text-t'], ['eraser', 'Eraser', 'eraser']], () => tool, (v) => ((tool = v), (label.hidden = v !== 'text')));
  const inks = h('div.row', { role: 'radiogroup', 'aria-label': 'Ink' }, ...INK.map((c) => h('button.form-swatch', { type: 'button', title: c, 'aria-pressed': String(c === ink), style: { background: c }, onclick: (e) => ((ink = c), [...e.currentTarget.parentNode.children].forEach((b) => b.setAttribute('aria-pressed', String(b.title === c)))) })));
  const undo = () => (strokes.pop(), draw());
  const bgSeg = seg([['view', 'Over the view', 'cube'], ['paper', 'Paper', 'note-blank']], () => bg, (v) => (bg = v));
  const size = h('span.row.sketch-tools', {}, h('span.small', {}, 'Real size'), width, h('span.small', {}, '×'), height, h('span.small.muted', {}, 'm'));
  straighten.onchange = () => ((size.hidden = !straighten.checked), draw());
  size.hidden = !straighten.checked;
  width.oninput = () => ((height.value = ''), draw());
  height.oninput = () => ((width.value = ''), draw());
  const body = h(
    'div.sketch',
    { onkeydown: (e) => e.ctrlKey && e.key.toLowerCase() === 'z' && (e.preventDefault(), undo()) },
    h('div.row.wrap.sketch-tools', {}, tools, label, inks, h('button.icon-btn.sm', { type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: undo }, icon('arrow-counter-clockwise')), h('button.icon-btn.sm', { type: 'button', title: 'Clear', 'aria-label': 'Clear', onclick: () => ((strokes.length = 0), draw()) }, icon('trash')), h('span.grow'), mode === 'chat' ? bgSeg : null),
    canvas,
    h('div.row.wrap.sketch-tools', {}, h('label.check', { title: 'Straight sides and tidy angles, closed when the ends meet: for an outline or a profile' }, straighten, h('span', {}, mode === 'chat' ? 'Straighten (an outline the AI gets as numbers)' : 'Straighten')), size, mode === 'profile' ? h('label.field.grow', {}, h('span', {}, 'Profile name'), name) : null),
    status,
  );
  if (bg === 'view') {
    app.reg
      .run('screenshot', { width: 1280 })
      .then((r) => {
        const im = new Image();
        im.onload = () => ((shot = im), draw());
        im.src = r.image;
      })
      .catch(() => ((bg = 'paper'), draw()));
  }
  draw();
  const buttons = mode === 'profile' ? [['Save profile', 'save'], ['Show the AI', 'ai'], ['Cancel', null]] : [['Attach to message', 'ai'], ['Cancel', null]];
  for (;;) {
    const choice = await app.ui.modal(mode === 'profile' ? 'Sketch a profile' : 'Sketch for the AI', body, buttons);
    if (!choice) return null;
    const lines = strokes.filter((s) => s.kind !== 'text').map((s) => s.pts);
    if (!strokes.length) {
      app.ui.toast('Draw something first.');
      continue;
    }
    const o = straighten.checked ? outline() : null;
    if (choice === 'save') {
      try {
        const r = await app.reg.run('sketch_profile', { name: name.value.trim() || 'Sketch', strokes: lines, width: +width.value || undefined, height: +height.value || (width.value ? undefined : 1) });
        app.ui.toast(`Profile "${r.name}" saved: ${r.width} × ${r.height} m. Sweep it along a curve.`);
        return r;
      } catch (e) {
        app.ui.toast(e.message, 'danger');
        continue;
      }
    }
    const note = o ? `My sketched outline, cleaned (${o.closed ? 'closed' : 'open'}, ${o.scale !== 1 ? `metres, ${o.width} × ${o.height}` : 'sketch units, no real size yet'}, u right, v up): ${JSON.stringify(o.points.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]))}` : '';
    const image = canvas.toDataURL('image/png');
    if (mode === 'profile') return app.ai.attachPicture(image, note, true);
    return { image, note };
  }
}
