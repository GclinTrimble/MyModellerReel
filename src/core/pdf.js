// PDF reading (#141, #145) with pdf.js: page sizes, layers (optional content groups), and the vector content of a page
// as plain paths and text in the page's own coordinates (PDF points, top-left origin, v down). Drawing pages to
// pictures happens in the renderer; everything here also runs in Node tests.
const BROWSER = typeof window !== 'undefined';
let lib;
async function pdfjs() {
  if (!lib) {
    lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (BROWSER) lib.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  }
  return lib;
}

const docs = new Map();
/** The pdf.js document for some bytes, cached by key (the asset id). */
export async function open(bytes, key) {
  if (key && docs.has(key)) return docs.get(key);
  const p = (async () => {
    const { getDocument } = await pdfjs();
    const opts = { data: bytes.slice(), verbosity: 0, isEvalSupported: false };
    if (BROWSER) opts.standardFontDataUrl = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href;
    try {
      return await getDocument(opts).promise;
    } catch (e) {
      throw new Error(e.name === 'PasswordException' ? 'This PDF is password-protected: save an unprotected copy first.' : `Not a readable PDF (${e.message}).`);
    }
  })();
  if (key) docs.set(key, p);
  p.catch(() => docs.delete(key));
  return p;
}

/** Pages (size in points as shown, rotation applied) and layers. */
export async function info(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
    pages.push({ page: i, size: [round(vp.width), round(vp.height)] });
  }
  return { pages, layers: await layers(pdf) };
}

export async function layers(pdf) {
  const oc = await pdf.getOptionalContentConfig();
  const out = [];
  for (const [id, g] of oc) out.push({ id, name: g.name || id, visible: g.visible });
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const tp = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * The page's paths and text, in page coordinates. paths: { pts, closed, color, width (points), dashed, layer, fill,
 * hatch }; texts: { str, at: [u, v], size, angle }.
 */
export async function content(pdf, pageNo = 1) {
  const L = await pdfjs();
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ocg = new Map((await layers(pdf)).map((l) => [l.id, l.name]));
  const ops = await page.getOperatorList();
  return { size: [round(vp.width), round(vp.height)], paths: pathsFromOps(ops, L.OPS, vp.transform, ocg), texts: await texts(page, vp.transform) };
}

async function texts(page, vt) {
  const tc = await page.getTextContent();
  return tc.items
    .filter((t) => t.str && t.str.trim())
    .map((t) => {
      const m = mul(vt, t.transform);
      return { str: t.str.trim(), at: tp(vt, t.transform[4], t.transform[5]).map(round), size: round(Math.hypot(m[2], m[3])), angle: round((Math.atan2(m[1], m[0]) * 180) / Math.PI) };
    });
}

/** Walk a pdf.js operator list into paths (exported for tests). vt maps PDF user space to page coordinates. */
export function pathsFromOps({ fnArray, argsArray }, OPS, vt, ocg = new Map()) {
  const paths = [];
  const st = [];
  let g = { m: [1, 0, 0, 1, 0, 0], color: '#000000', fillColor: '#000000', width: 1, dashed: false };
  const marks = [];
  const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const CLOSE = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const a = argsArray[i];
    if (fn === OPS.save) st.push({ ...g });
    else if (fn === OPS.restore) g = st.pop() || g;
    else if (fn === OPS.transform) g.m = mul(g.m, a);
    else if (fn === OPS.paintFormXObjectBegin) st.push({ ...g }), a?.[0] && (g.m = mul(g.m, a[0]));
    else if (fn === OPS.paintFormXObjectEnd) g = st.pop() || g;
    else if (fn === OPS.setStrokeRGBColor) g.color = typeof a[0] === 'string' ? a[0] : hex(a);
    else if (fn === OPS.setFillRGBColor) g.fillColor = typeof a[0] === 'string' ? a[0] : hex(a);
    else if (fn === OPS.setLineWidth) g.width = a[0];
    else if (fn === OPS.setDash) g.dashed = !!a[0]?.length;
    else if (fn === OPS.setGState) for (const [k, v] of a[0] || []) k === 'LW' ? (g.width = v) : k === 'D' && (g.dashed = !!v?.[0]?.length);
    else if (fn === OPS.beginMarkedContentProps) marks.push(a[0] === 'OC' ? ocg.get(a[1]?.id) ?? null : undefined);
    else if (fn === OPS.beginMarkedContent) marks.push(undefined);
    else if (fn === OPS.endMarkedContent) marks.pop();
    else if (fn === OPS.constructPath) {
      const paint = a[0];
      const stroke = STROKE.has(paint);
      const fill = FILL.has(paint);
      if (!stroke && !fill) continue; // clipping paths and endPath draw nothing
      const m = mul(vt, g.m);
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const layer = marks.findLast((x) => x !== undefined) ?? null;
      const subs = subpaths(a[1], m, k);
      const hatch = stroke && subs.length >= 6 && isHatch(subs);
      for (const s of subs) {
        if (CLOSE.has(paint) && s.pts.length > 2) s.closed = true;
        paths.push({ pts: s.pts, closed: s.closed, color: stroke ? g.color : g.fillColor, width: round(g.width * k), dashed: g.dashed, layer, fill: !stroke, hatch });
      }
    }
  }
  return markHatchRuns(paths);
}

/** Hatching drawn stroke by stroke: 6+ consecutive single parallel segments with the same pen, under 6 pt apart. */
const gap = (a, b) => {
  const [p, q] = a.pts;
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return Math.abs((q[0] - p[0]) * (b.pts[0][1] - p[1]) - (q[1] - p[1]) * (b.pts[0][0] - p[0])) / L;
};
function markHatchRuns(paths) {
  const one = (p) => p.pts.length === 2 && !p.closed && !p.fill;
  const ang = (p) => Math.atan2(p.pts[1][1] - p.pts[0][1], p.pts[1][0] - p.pts[0][0]);
  let i = 0;
  while (i < paths.length) {
    let j = i;
    if (one(paths[i]))
      while (j + 1 < paths.length && one(paths[j + 1]) && paths[j + 1].color === paths[i].color && paths[j + 1].width === paths[i].width && paths[j + 1].layer === paths[i].layer && Math.abs(Math.sin(ang(paths[j + 1]) - ang(paths[i]))) < 0.035 && gap(paths[j], paths[j + 1]) < 6) j++;
    if (j - i + 1 >= 6) for (let q = i; q <= j; q++) paths[q].hatch = true;
    i = j + 1;
  }
  return paths;
}

const hex = (a) => `#${a.slice(0, 3).map((x) => Math.round(x * (x <= 1 ? 255 : 1)).toString(16).padStart(2, '0')).join('')}`;

/** pdf.js 6 path data: 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath. */
function subpaths(list, m, k) {
  const out = [];
  let cur = null;
  const add = (p) => cur.pts.push(p.map(round));
  for (const d of list || []) {
    for (let j = 0; j < d.length; ) {
      const op = d[j++];
      if (op === 0) {
        if (cur && cur.pts.length > 1) out.push(cur);
        cur = { pts: [], closed: false };
        add(tp(m, d[j++], d[j++]));
      } else if (op === 1) {
        cur ||= { pts: [], closed: false };
        add(tp(m, d[j++], d[j++]));
      } else if (op === 2 || op === 3) {
        const n = op === 2 ? 3 : 2;
        const ctrl = [];
        for (let q = 0; q < n; q++) ctrl.push(tp(m, d[j++], d[j++]));
        const p0 = cur.pts.at(-1);
        const P = [p0, ...ctrl];
        const len = P.slice(1).reduce((s, p, q) => s + Math.hypot(p[0] - P[q][0], p[1] - P[q][1]), 0);
        const segs = Math.max(4, Math.min(48, Math.ceil(len / 3)));
        for (let t = 1; t <= segs; t++) add(bezier(P, t / segs));
      } else if (op === 4) {
        if (cur && cur.pts.length > 2) {
          const [f, l] = [cur.pts[0], cur.pts.at(-1)];
          if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) cur.pts.pop();
          cur.closed = true;
        }
        if (cur && cur.pts.length > 1) out.push(cur);
        cur = cur && { pts: [cur.pts[0]], closed: false };
      } else break; // unknown op: stop reading this path rather than misread it
    }
  }
  if (cur && cur.pts.length > 1) out.push(cur);
  return out;
}

function bezier(P, t) {
  if (P.length === 3) {
    const u = 1 - t;
    return [0, 1].map((i) => u * u * P[0][i] + 2 * u * t * P[1][i] + t * t * P[2][i]);
  }
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]);
}

/** Many single straight strokes, all parallel: a hatch pattern, not linework. */
function isHatch(subs) {
  if (!subs.every((s) => s.pts.length === 2 && !s.closed)) return false;
  const ang = subs.map((s) => Math.atan2(s.pts[1][1] - s.pts[0][1], s.pts[1][0] - s.pts[0][0]) % Math.PI);
  const a0 = ang[0];
  return ang.every((a) => Math.abs(Math.sin(a - a0)) < 0.035);
}
