// File formats (#152): one registry, so LandXML, IFC, DXF and plugins' formats behave the same for people, Plumb
// and scripts. A format reads into the document and returns a report; it writes the document (or a selection) out.
const formats = new Map();

/**
 * { id, label, extensions: ['dxf'], binary: false, sniff(text|bytes) → bool,
 *   read(data, { doc, cmd, opts, report }) (async ok), write(doc, { ents, opts }) → string | Uint8Array }
 */
export function registerFormat(f) {
  formats.set(f.id, f);
  return f;
}
export const getFormat = (id) => formats.get(id);
export const listFormats = () =>
  [...formats.values()].map((f) => ({ id: f.id, label: f.label, extensions: f.extensions, import: !!f.read, export: !!f.write, ...(f.options ? { options: f.options } : {}) }));

/** The format for a path (by extension, then by content when an extension is shared, like .xml). */
export function formatFor(path, data) {
  const ext = String(path).match(/\.(\w+)$/)?.[1]?.toLowerCase();
  const hits = [...formats.values()].filter((f) => f.extensions.includes(ext));
  if (hits.length > 1 && data !== undefined) return hits.find((f) => f.sniff?.(data)) || hits[0];
  return hits[0] || null;
}

/** What an import did: counts per kind, layers touched, what was skipped and why, warnings. */
export function newReport() {
  const r = { created: {}, layers: new Set(), skipped: {}, warnings: [] };
  return {
    add: (kind, n = 1) => (r.created[kind] = (r.created[kind] || 0) + n),
    layer: (name) => r.layers.add(name),
    skip: (what, why) => {
      const k = `${what}: ${why}`;
      r.skipped[k] = (r.skipped[k] || 0) + 1;
    },
    warn: (w) => r.warnings.includes(w) || r.warnings.push(w),
    done: (extra = {}) => ({ created: r.created, layers: [...r.layers], skipped: Object.entries(r.skipped).map(([what, count]) => ({ what, count })), warnings: r.warnings, ...extra }),
  };
}
