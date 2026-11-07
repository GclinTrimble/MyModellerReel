// A small XML reader and writer for exchange formats (LandXML): elements, attributes, text; comments, CDATA and the
// prolog are skipped. Runs the same in Node and the browser (no DOMParser).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
export const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Parse to { name, attrs, children, text }. Element names keep their prefix ("lx:Pnts" stays as written). */
export function parse(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3]) {
      if (m[2]) {
        if (top.name !== m[3]) throw new Error(`XML: </${m[3]}> closes <${top.name}>.`);
        stack.pop();
        continue;
      }
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[3] ?? a[4]);
      const el = { name: m[3], attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.text += unescape(m[6]);
  }
  if (stack.length > 1) throw new Error(`XML: <${stack.at(-1).name}> is not closed.`);
  return root;
}

const local = (n) => n.slice(n.indexOf(':') + 1);
/** Children (or all descendants) named n, prefix-blind. */
export const kids = (el, n) => el.children.filter((c) => local(c.name) === n);
export const kid = (el, n) => el.children.find((c) => local(c.name) === n);
export function all(el, n, out = []) {
  for (const c of el.children) {
    if (local(c.name) === n) out.push(c);
    all(c, n, out);
  }
  return out;
}
export const nums = (s) => String(s).trim().split(/[\s,]+/).filter(Boolean).map(Number);

/** Build: el('Tag', { attr }, children | text). */
export const el = (name, attrs = {}, body = []) => ({ name, attrs, body });
export function write(node, depth = 0) {
  const pad = '  '.repeat(depth);
  const a = Object.entries(node.attrs).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
  if (typeof node.body === 'string' || typeof node.body === 'number') return `${pad}<${node.name}${a}>${escape(node.body)}</${node.name}>`;
  const body = node.body.filter(Boolean);
  if (!body.length) return `${pad}<${node.name}${a}/>`;
  return `${pad}<${node.name}${a}>\n${body.map((c) => write(c, depth + 1)).join('\n')}\n${pad}</${node.name}>`;
}
