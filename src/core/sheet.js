// Drawing sheets (#55): orthographic views laid out at a common scale on a sheet with a title block and overall
// dimensions, written as SVG or PDF. The pictures come from the renderer (JPEG); this module does the layout and the
// files, so it runs in tests too.
import { esc } from './section.js';

export const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], Letter: [279.4, 215.9], Tabloid: [431.8, 279.4] };
const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

/**
 * views: [{ name, image (data URL or bytes), px: [w, h], extent: [w, h] metres the picture covers, model: [w, h]
 * metres of the model inside it, ortho: bool }]. Returns the layout in mm: { size, scale, cells, title block }.
 */
export function layoutSheet(views, { sheet = 'A3', scale = null, title = 'Untitled', project = '', author = '', date = '', number = '1', units = (m) => `${m.toFixed(3)} m` } = {}) {
  const [W, H] = SHEETS[sheet] || SHEETS.A3;
  const m = 10;
  const tb = { w: 120, h: 34 };
  const n = views.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cw = (W - 2 * m) / cols;
  const ch = (H - 2 * m - tb.h - 4) / rows;
  // the largest standard scale where every orthographic view fits its cell (with room for its dimensions)
  const fit = (v) => Math.max(v.extent[0] / (cw - 24), v.extent[1] / (ch - 22)) * 1000;
  const need = Math.max(1, ...views.filter((v) => v.ortho).map(fit));
  const s = scale || SCALES.find((x) => x >= need) || Math.ceil(need / 1000) * 1000;
  const cells = views.map((v, i) => {
    const [cx, cy] = [m + (i % cols) * cw, m + Math.floor(i / cols) * ch];
    const k = v.ortho ? 1000 / s : Math.min((cw - 24) / v.extent[0], (ch - 22) / v.extent[1]); // mm per metre
    const [w, h] = [v.extent[0] * k, v.extent[1] * k];
    const x = cx + (cw - w) / 2;
    const y = cy + 6 + (ch - 22 - h) / 2;
    const dims = v.ortho && v.model ? { w: units(v.model[0]), h: units(v.model[1]), box: [x + (w - v.model[0] * k) / 2, y + (h - v.model[1] * k) / 2, v.model[0] * k, v.model[1] * k] } : null;
    return { ...v, x, y, w, h, label: { x: cx + cw / 2, y: cy + ch - 6, text: `${v.name}  ${v.ortho ? `1:${s}` : 'not to scale'}` }, dims };
  });
  const block = { x: W - m - tb.w, y: H - m - tb.h, w: tb.w, h: tb.h, rows: [['Title', title], ['Project', project], ['Scale', `1:${s} (${sheet})`], ['Drawn', [author, date].filter(Boolean).join(' · ')], ['Sheet', number]] };
  return { size: [W, H], margin: m, scale: s, cells, block };
}

// base64 without Buffer: this runs in the renderer too
const toB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const dataUrl = (img) => (typeof img === 'string' ? img : `data:image/jpeg;base64,${toB64(img)}`);

/** Lines of the overall dimensions of a view (mm on the sheet): [[x1, y1, x2, y2], …] and their texts. */
function dimLines(c) {
  if (!c.dims) return { lines: [], texts: [] };
  const [x, y, w, h] = c.dims.box;
  const yb = y + h + 6;
  const xr = x + w + 6;
  const t = 1.2;
  return {
    lines: [[x, y + h + 1, x, yb + 1.5], [x + w, y + h + 1, x + w, yb + 1.5], [x, yb, x + w, yb], [x - t, yb + t, x + t, yb - t], [x + w - t, yb + t, x + w + t, yb - t],
      [x + w + 1, y, xr + 1.5, y], [x + w + 1, y + h, xr + 1.5, y + h], [xr, y, xr, y + h], [xr - t, y + t, xr + t, y - t], [xr - t, y + h + t, xr + t, y + h - t]],
    texts: [{ x: x + w / 2, y: yb - 1.2, text: c.dims.w, anchor: 'middle' }, { x: xr + 1.2, y: y + h / 2, text: c.dims.h, anchor: 'start', rotate: true }],
  };
}

export function sheetSvg(L) {
  const [W, H] = L.size;
  const o = [`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`, `<rect width="${W}" height="${H}" fill="#fff"/>`, `<rect x="${L.margin / 2}" y="${L.margin / 2}" width="${W - L.margin}" height="${H - L.margin}" fill="none" stroke="#111" stroke-width="0.5"/>`];
  for (const c of L.cells) {
    o.push(`<image x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${c.w.toFixed(2)}" height="${c.h.toFixed(2)}" href="${dataUrl(c.image)}" preserveAspectRatio="none"/>`);
    o.push(`<text x="${c.label.x.toFixed(2)}" y="${c.label.y.toFixed(2)}" font-size="3.2" text-anchor="middle" font-weight="bold">${esc(c.label.text)}</text>`);
    const d = dimLines(c);
    for (const [a, b, e, f] of d.lines) o.push(`<line x1="${a.toFixed(2)}" y1="${b.toFixed(2)}" x2="${e.toFixed(2)}" y2="${f.toFixed(2)}" stroke="#111" stroke-width="0.18"/>`);
    for (const t of d.texts) o.push(`<text x="${t.x.toFixed(2)}" y="${t.y.toFixed(2)}" font-size="2.5" text-anchor="${t.anchor}"${t.rotate ? ` transform="rotate(-90 ${t.x.toFixed(2)} ${t.y.toFixed(2)})"` : ''}${t.rotate ? ' dominant-baseline="hanging"' : ''}>${esc(t.text)}</text>`);
  }
  const b = L.block;
  o.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#fff" stroke="#111" stroke-width="0.35"/>`);
  b.rows.forEach(([k, v], i) => {
    const y = b.y + (i + 1) * (b.h / b.rows.length);
    if (i < b.rows.length - 1) o.push(`<line x1="${b.x}" y1="${y}" x2="${b.x + b.w}" y2="${y}" stroke="#111" stroke-width="0.18"/>`);
    o.push(`<text x="${b.x + 2}" y="${y - 2}" font-size="2.2" fill="#555">${esc(k)}</text><text x="${b.x + 22}" y="${y - 2}" font-size="${i === 0 ? 3.6 : 2.8}"${i === 0 ? ' font-weight="bold"' : ''}>${esc(v)}</text>`);
  });
  o.push('</svg>', '');
  return o.join('\n');
}

/**
 * The same sheet as a one-page PDF: JPEG pictures (DCTDecode), lines and Helvetica text. images: JPEG bytes
 * (Uint8Array) with their pixel sizes, in the order of L.cells.
 */
export function sheetPdf(L) {
  const pt = 72 / 25.4;
  const [W, H] = L.size;
  const X = (x) => (x * pt).toFixed(2);
  const Y = (y) => ((H - y) * pt).toFixed(2);
  const enc = new TextEncoder();
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const pdfStr = (s) => `(${String(s).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, (c) => (c === '·' ? '\\267' : c === '²' ? '\\262' : c === '³' ? '\\263' : c === 'Ø' ? '\\330' : c === '°' ? '\\260' : '?'))})`;
  const imgs = L.cells.map((c, i) => {
    const bytes = typeof c.image === 'string' ? fromB64(c.image.split(',')[1]) : c.image;
    return { name: `Im${i}`, bytes, px: c.px };
  });
  const ops = ['0.5 w 0 G'];
  ops.push(`${X(L.margin / 2)} ${Y(H - L.margin / 2)} ${((W - L.margin) * pt).toFixed(2)} ${((H - L.margin) * pt).toFixed(2)} re S`);
  const text = (x, y, s, size, bold = false, rotate = false) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${(size * pt).toFixed(2)} Tf ${rotate ? `0 1 -1 0 ${X(x)} ${Y(y)} Tm` : `${X(x)} ${Y(y)} Td`} ${pdfStr(s)} Tj ET`);
  const width = (s, size) => String(s).length * size * 0.5; // shortcut: an average Helvetica width; centring is close, not exact
  L.cells.forEach((c, i) => {
    ops.push(`q ${(c.w * pt).toFixed(2)} 0 0 ${(c.h * pt).toFixed(2)} ${X(c.x)} ${Y(c.y + c.h)} cm /${imgs[i].name} Do Q`);
    text(c.label.x - width(c.label.text, 3.2) / 2, c.label.y, c.label.text, 3.2, true);
    const d = dimLines(c);
    ops.push('0.5 w');
    for (const [a, b, e, f] of d.lines) ops.push(`${X(a)} ${Y(b)} m ${X(e)} ${Y(f)} l S`);
    for (const t of d.texts) t.rotate ? text(t.x + 2.5, t.y + width(t.text, 2.5) / 2, t.text, 2.5, false, true) : text(t.x - (t.anchor === 'middle' ? width(t.text, 2.5) / 2 : 0), t.y, t.text, 2.5);
  });
  const b = L.block;
  ops.push('1 w', `${X(b.x)} ${Y(b.y + b.h)} ${(b.w * pt).toFixed(2)} ${(b.h * pt).toFixed(2)} re S`, '0.5 w');
  b.rows.forEach(([k, v], i) => {
    const y = b.y + (i + 1) * (b.h / b.rows.length);
    if (i < b.rows.length - 1) ops.push(`${X(b.x)} ${Y(y)} m ${X(b.x + b.w)} ${Y(y)} l S`);
    ops.push('0.33 g');
    text(b.x + 2, y - 2, k, 2.2);
    ops.push('0 g');
    text(b.x + 22, y - 2, v, i === 0 ? 3.6 : 2.8, i === 0);
  });
  const content = ops.join('\n');
  // objects: 1 catalog, 2 pages, 3 page, 4 content, 5–6 fonts, then images
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const xo = imgs.map((im, i) => `/${im.name} ${7 + i} 0 R`).join(' ');
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(W * pt).toFixed(2)} ${(H * pt).toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << ${xo} >> >> >>`);
  add({ dict: `<< /Length ${enc.encode(content).length} >>`, data: enc.encode(content) });
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  for (const im of imgs) add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.px[0]} /Height ${im.px[1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, data: im.bytes });
  const parts = [enc.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let off = parts[0].length;
  const xref = [];
  objs.forEach((o, i) => {
    xref.push(off);
    const head = enc.encode(`${i + 1} 0 obj\n${typeof o === 'string' ? o : `${o.dict}\nstream\n`}`);
    const tail = enc.encode(typeof o === 'string' ? '\nendobj\n' : '\nendstream\nendobj\n');
    const chunk = typeof o === 'string' ? [head, tail] : [head, o.data, tail];
    for (const c of chunk) (parts.push(c), (off += c.length));
  });
  const tbl = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`;
  parts.push(enc.encode(tbl));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let k = 0;
  for (const p of parts) out.set(p, k), (k += p.length);
  return out;
}
