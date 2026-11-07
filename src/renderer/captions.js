// Captions (#82): drawn with the 2D canvas API so the same code shows them over the viewport and burns them into
// rendered video frames. Darkroom styles: title (cream on an ink band), caption (lower third with a mustard bar),
// label (small light pill).
const INK = 'rgba(30, 58, 76, 0.78)';
const FERN = 'rgba(35, 59, 44, 0.88)';
const CREAM = '#f3e9d7';
const MUSTARD = '#e8bc5e';
const FONT = '"Open Sans", system-ui, sans-serif';

/** 0..1: how visible a caption is at time t (fades in and out). */
export function captionAlpha(c, t) {
  if (t < c.start || t > c.end) return 0;
  const f = Math.max(1e-3, Math.min(c.fade ?? 0.3, (c.end - c.start) / 2));
  return Math.min(1, (t - c.start) / f, (c.end - t) / f);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/** Draw every caption visible at time t onto a w × h 2D context. */
export function drawCaptions(g, captions, t, w, h) {
  const u = h / 1080; // design unit: sizes are for a 1080p frame
  const m = 64 * u;
  for (const c of captions || []) {
    const a = captionAlpha(c, t);
    if (a <= 0) continue;
    const style = c.style || 'caption';
    const size = (style === 'title' ? 72 : style === 'label' ? 28 : 40) * u;
    g.save();
    g.globalAlpha = a;
    g.font = `${style === 'title' ? 700 : 600} ${size}px ${FONT}`;
    g.textBaseline = 'middle';
    const lines = String(c.text).split('\n');
    const lh = size * 1.3;
    const tw = Math.max(...lines.map((l) => g.measureText(l).width));
    const pad = (style === 'label' ? 14 : 24) * u;
    const bw = tw + pad * 2 + (style === 'caption' ? 10 * u : 0);
    const bh = lines.length * lh + pad * (style === 'label' ? 0.8 : 1.2);
    const pos = c.position || 'bottom';
    let x = pos.includes('left') ? m : pos.includes('right') ? w - m - bw : (w - bw) / 2;
    let y = pos.startsWith('top') ? m : pos.startsWith('bottom') ? h - m - bh : (h - bh) / 2;
    if (style === 'title') {
      // a full-width band behind the title
      g.fillStyle = INK;
      g.fillRect(0, y, w, bh);
      g.fillStyle = CREAM;
    } else if (style === 'caption') {
      g.fillStyle = FERN;
      roundRect(g, x, y, bw, bh, 8 * u);
      g.fillStyle = MUSTARD;
      g.fillRect(x, y, 10 * u, bh);
      g.fillStyle = '#ffffff';
      x += 10 * u;
    } else {
      g.fillStyle = 'rgba(255, 255, 255, 0.92)';
      roundRect(g, x, y, bw, bh, bh / 2);
      g.fillStyle = '#1e3a4c';
    }
    g.textAlign = style === 'title' ? 'center' : 'left';
    lines.forEach((l, i) => g.fillText(l, style === 'title' ? x + bw / 2 : x + pad, y + bh / 2 + (i - (lines.length - 1) / 2) * lh));
    g.restore();
  }
}
