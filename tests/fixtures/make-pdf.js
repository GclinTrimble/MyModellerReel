// A tiny PDF writer for tests: one page, a content stream, optional layers (optional content groups).
export function makePdf({ content, layers = [], width = 595, height = 842 }) {
  const objs = [];
  const ocg = layers.map((name, i) => 6 + i);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R${layers.length ? ` /OCProperties << /OCGs [${ocg.map((n) => `${n} 0 R`).join(' ')}] /D << /Order [${ocg.map((n) => `${n} 0 R`).join(' ')}] >> >>` : ''} >>`;
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >>${layers.length ? ` /Properties << ${layers.map((_, i) => `/oc${i + 1} ${ocg[i]} 0 R`).join(' ')} >>` : ''} >> >>`;
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  layers.forEach((name, i) => (objs[ocg[i]] = `<< /Type /OCG /Name (${name}) >>`));
  let out = '%PDF-1.7\n';
  const offs = [];
  for (let i = 1; i < objs.length; i++) {
    offs[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
