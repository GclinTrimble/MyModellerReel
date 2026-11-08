// Road panes (#167, #168): the long section (profile) and the cross-section of a corridor, drawn in 2D on a pane's
// board canvas. Data comes from core (roads.js through sitework.corridorOf); this file only draws and pans / zooms.
import { lineAt } from '../core/roads.js';

const C = { bg: '#fbfaf6', grid: '#e4e0d6', text: '#3b3f45', muted: '#7d8288', ground: '#7a5a3c', design: '#1d262c', cut: 'rgba(196, 112, 58, 0.35)', fill: 'rgba(79, 134, 176, 0.35)', marker: '#c8553d', pave: '#5d6066' };
const M = { l: 58, r: 16, t: 34, b: 34 }; // margins for the axes
const sta = (s) => `${Math.floor(s / 1000)}+${String(Math.round(s % 1000)).padStart(3, '0')}`;

function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) || 10 * p;
}

/** Size the board to its box and return a 2D context in CSS pixels. */
function prepare(board) {
  const dpr = board.ownerDocument.defaultView.devicePixelRatio || 1;
  const w = board.clientWidth;
  const h = board.clientHeight;
  if (board.width !== Math.round(w * dpr) || board.height !== Math.round(h * dpr)) (board.width = Math.round(w * dpr)), (board.height = Math.round(h * dpr));
  const g = board.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = C.bg;
  g.fillRect(0, 0, w, h);
  g.font = '11px "Open Sans", system-ui, sans-serif';
  return { g, w, h };
}

/** Axes with grid lines; returns the world → screen maps. */
function axes(g, w, h, [x0, x1], [y0, y1], fmtX, fmtY) {
  const X = (x) => M.l + ((x - x0) / (x1 - x0 || 1)) * (w - M.l - M.r);
  const Y = (y) => h - M.b - ((y - y0) / (y1 - y0 || 1)) * (h - M.t - M.b);
  g.strokeStyle = C.grid;
  g.fillStyle = C.muted;
  g.lineWidth = 1;
  const sx = niceStep(x1 - x0, (w - M.l - M.r) / 80);
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) {
    g.beginPath();
    g.moveTo(X(x), M.t);
    g.lineTo(X(x), h - M.b);
    g.stroke();
    g.textAlign = 'center';
    g.fillText(fmtX(x), X(x), h - M.b + 14);
  }
  const sy = niceStep(y1 - y0, (h - M.t - M.b) / 40);
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1; y += sy) {
    g.beginPath();
    g.moveTo(M.l, Y(y));
    g.lineTo(w - M.r, Y(y));
    g.stroke();
    g.textAlign = 'right';
    g.fillText(fmtY(y), M.l - 6, Y(y) + 4);
  }
  return { X, Y, unX: (px) => x0 + ((px - M.l) / (w - M.l - M.r)) * (x1 - x0) };
}

/** Shade between two lines given as functions over [a, b]: cut where the ground is above the design, fill below. */
function shade(g, X, Y, a, b, design, ground, step) {
  for (let x = a; x < b - 1e-9; x += step) {
    const x2 = Math.min(b, x + step);
    const [d1, d2, g1, g2] = [design(x), design(x2), ground(x), ground(x2)];
    if ([d1, d2, g1, g2].some((v) => v === null || v === undefined)) continue;
    g.fillStyle = (d1 + d2) / 2 < (g1 + g2) / 2 ? C.cut : C.fill;
    g.beginPath();
    g.moveTo(X(x), Y(d1));
    g.lineTo(X(x2), Y(d2));
    g.lineTo(X(x2), Y(g2));
    g.lineTo(X(x), Y(g1));
    g.closePath();
    g.fill();
  }
}

const polyline = (g, pts, color, width) => {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    pen ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
    pen = true;
  }
  g.stroke();
};

function title(g, w, text, right) {
  g.fillStyle = C.text;
  g.font = '600 12px "Open Sans", system-ui, sans-serif';
  g.textAlign = 'right';
  g.fillText(text, w - M.r, 20);
  if (right) {
    g.font = '11px "Open Sans", system-ui, sans-serif';
    g.fillStyle = C.muted;
    g.fillText(right, w - M.r, M.t + 12);
  }
  g.font = '11px "Open Sans", system-ui, sans-serif';
}

/**
 * The profile: data { name, samples: [{ station, design, ground }], pvis: [[s, z]], length, station, base }, view
 * { from, to } (stations shown). Returns the maps for picking a station.
 */
export function drawProfile(board, data, view) {
  const { g, w, h } = prepare(board);
  if (!data) return message(g, w, h, 'No corridor yet: Site › Corridor, then choose it here.');
  const from = view.from ?? 0;
  const to = view.to ?? data.length;
  const vis = data.samples.filter((s) => s.station >= from - 5 && s.station <= to + 5);
  const zs = vis.flatMap((s) => [s.design, s.ground]).filter((z) => z !== null);
  const pad = Math.max(0.5, (Math.max(...zs) - Math.min(...zs)) * 0.12);
  const y0 = Math.min(...zs) - pad;
  const y1 = Math.max(...zs) + pad;
  const base = data.base || 0;
  const m = axes(g, w, h, [from, to], [y0, y1], sta, (z) => (z + base).toFixed(1));
  const at = (key) => (s) => {
    const i = data.samples.findIndex((x) => x.station >= s);
    if (i <= 0) return data.samples[0]?.[key] ?? null;
    const [p, q] = [data.samples[i - 1], data.samples[i]];
    if (p[key] === null || q[key] === null) return null;
    return p[key] + ((q[key] - p[key]) * (s - p.station)) / (q.station - p.station || 1);
  };
  shade(g, m.X, m.Y, Math.max(0, from), Math.min(data.length, to), at('design'), at('ground'), Math.max(0.5, (to - from) / 400));
  polyline(g, data.samples.map((s) => (s.ground === null ? null : [m.X(s.station), m.Y(s.ground)])), C.ground, 1.5);
  polyline(g, data.samples.map((s) => [m.X(s.station), m.Y(s.design)]), C.design, 2.2);
  // PVIs and grades
  const pv = data.pvis || [];
  g.fillStyle = C.design;
  for (let k = 0; k < pv.length; k++) {
    const [s, z] = [pv[k][0], pv[k][1] - base];
    g.beginPath();
    g.arc(m.X(s), m.Y(z), 3.5, 0, Math.PI * 2);
    g.stroke();
    if (k) {
      const gr = ((pv[k][1] - pv[k - 1][1]) / (pv[k][0] - pv[k - 1][0])) * 100;
      const mx = (m.X(pv[k - 1][0]) + m.X(s)) / 2;
      const my = (m.Y(pv[k - 1][1] - base) + m.Y(z)) / 2;
      g.textAlign = 'center';
      g.fillText(`${gr >= 0 ? '+' : ''}${gr.toFixed(2)} %`, mx, my - 8);
    }
  }
  if (data.station !== undefined && data.station !== null) {
    g.strokeStyle = C.marker;
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(m.X(data.station), M.t);
    g.lineTo(m.X(data.station), h - M.b);
    g.stroke();
    g.setLineDash([]);
  }
  const ex = ((h - M.t - M.b) / (y1 - y0)) / ((w - M.l - M.r) / (to - from));
  title(g, w, `Profile · ${data.name}`, `V × ${ex.toFixed(1)} · red cut, blue fill · click to cut a section`);
  return m;
}

/** The cross-section: sec from roads.sectionAt, view { from, to } (offsets shown, default its width). */
export function drawSection(board, sec, view, name, base = 0) {
  const { g, w, h } = prepare(board);
  if (!sec) return message(g, w, h, 'No corridor yet: Site › Corridor, then choose it here.');
  const o0 = view.from ?? sec.points[0].o - 3;
  const o1 = view.to ?? sec.points.at(-1).o + 3;
  const zs = [...sec.points, ...sec.ground].filter((q) => q.o >= o0 && q.o <= o1).map((q) => q.y);
  const pad = Math.max(0.5, (Math.max(...zs) - Math.min(...zs)) * 0.15);
  // equal scales across and up where the pane allows, so slopes look like slopes
  const sx = (w - M.l - M.r) / (o1 - o0);
  const span = Math.max(Math.max(...zs) - Math.min(...zs) + 2 * pad, (h - M.t - M.b) / sx);
  const mid = (Math.max(...zs) + Math.min(...zs)) / 2;
  const m = axes(g, w, h, [o0, o1], [mid - span / 2, mid + span / 2], (o) => `${o > 0 ? '+' : ''}${o.toFixed(0)}`, (z) => (z + base).toFixed(1));
  const G = (o) => (sec.ground.length && o >= sec.ground[0].o && o <= sec.ground.at(-1).o ? lineAt(sec.ground, o) : null);
  shade(g, m.X, m.Y, sec.earth[0].o, sec.earth.at(-1).o, (o) => lineAt(sec.earth, o), G, 0.1);
  // pavement: between the finished surface and the earthworks line under the road
  if (sec.pavement > 0) {
    g.fillStyle = C.pave;
    g.beginPath();
    const top = sec.points.filter((q) => q.o >= sec.edges[0] - 1e-9 && q.o <= sec.edges[1] + 1e-9);
    top.forEach((q, i) => (i ? g.lineTo(m.X(q.o), m.Y(q.y)) : g.moveTo(m.X(q.o), m.Y(q.y))));
    for (const q of [...top].reverse()) g.lineTo(m.X(q.o), m.Y(lineAt(sec.earth.filter((e) => e.o >= sec.edges[0] - 1e-9 && e.o <= sec.edges[1] + 1e-9).slice(1, -1), q.o)));
    g.closePath();
    g.fill();
  }
  polyline(g, sec.ground.map((q) => [m.X(q.o), m.Y(q.y)]), C.ground, 1.5);
  polyline(g, sec.points.map((q) => [m.X(q.o), m.Y(q.y)]), C.design, 2.2);
  g.fillStyle = C.design;
  for (const q of sec.points) {
    g.beginPath();
    g.arc(m.X(q.o), m.Y(q.y), 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = C.muted;
  g.textAlign = 'center';
  const [L, R] = [sec.points[0], sec.points.at(-1)];
  g.fillText(`${Math.abs(L.o).toFixed(1)} m`, m.X(L.o), m.Y(L.y) - 8);
  g.fillText(`${R.o.toFixed(1)} m`, m.X(R.o), m.Y(R.y) - 8);
  g.fillText(`${(sec.points.find((q) => q.code === 'centre').y + base).toFixed(2)}`, m.X(0), m.Y(sec.points.find((q) => q.code === 'centre').y) - 10);
  title(g, w, `Section ${sta(sec.station)} · ${name}`, `Cut ${sec.cut.toFixed(1)} m² · Fill ${sec.fill.toFixed(1)} m² · left ${sec.left}, right ${sec.right}`);
  return m;
}

function message(g, w, h, text) {
  g.fillStyle = C.muted;
  g.textAlign = 'center';
  g.fillText(text, w / 2, h / 2);
  return null;
}

/** Wheel zoom and drag pan on a board, along x; click reports the x under the pointer. */
export function boardInput(board, getView, setView, onClick) {
  let drag = null;
  board.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = getView();
    if (!v.map) return;
    const x = v.map.unX(e.offsetX);
    const k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    setView({ from: x - (x - v.from) * k, to: x + (v.to - x) * k });
  }, { passive: false });
  board.addEventListener('pointerdown', (e) => {
    board.setPointerCapture(e.pointerId);
    const v = getView();
    drag = { x: e.offsetX, from: v.from, to: v.to, moved: false };
  });
  board.addEventListener('pointermove', (e) => {
    const v = getView();
    if (!drag || !v.map) return;
    if (Math.abs(e.offsetX - drag.x) > 3) drag.moved = true;
    if (!drag.moved) return;
    const per = (drag.to - drag.from) / Math.max(1, board.clientWidth - M.l - M.r);
    const dx = (e.offsetX - drag.x) * per;
    setView({ from: drag.from - dx, to: drag.to - dx });
  });
  board.addEventListener('pointerup', (e) => {
    const v = getView();
    if (drag && !drag.moved && v.map) onClick(v.map.unX(e.offsetX));
    drag = null;
  });
}
