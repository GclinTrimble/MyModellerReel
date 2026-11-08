// File bytes the document refers to (PDFs, images), kept out of the document JSON so undo snapshots stay small.
// The document holds only the asset id; files save the bytes next to it (io.js), and opening puts them back here.
import { lookAssets } from './look.js';

const store = new Map();

/** Keep bytes; the same bytes give the same id (an underlay imported twice shares one copy). */
export function put(bytes, { mime = 'application/octet-stream', name = '' } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let h = 2166136261 ^ b.length;
  const step = Math.max(1, Math.floor(b.length / 65536)); // shortcut: samples big files, the length guards collisions
  for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 16777619);
  const id = `a${(h >>> 0).toString(36)}${b.length.toString(36)}`;
  if (!store.has(id)) store.set(id, { bytes: b, mime, name });
  return id;
}

export const get = (id) => store.get(id);
export function bytes(id) {
  const a = store.get(id);
  if (!a) throw new Error(`A file this model uses is missing (asset ${id}): import it again.`);
  return a.bytes;
}
export const ids = () => [...store.keys()];

/** For saving: the assets a document uses, as base64. */
/** The asset ids a document uses (drawings, scans, audio, textures). */
export const usedIds = (doc) => new Set([...doc.entities.filter((e) => e.underlay).map((e) => e.underlay.asset), ...doc.entities.filter((e) => e.pointcloud).map((e) => e.pointcloud.asset), ...(doc.animation?.audio || []).map((c) => c.asset), ...lookAssets(doc)]);

export function pack(doc) {
  const used = usedIds(doc);
  const out = {};
  for (const id of used) {
    const a = store.get(id);
    if (!a) continue;
    let s = '';
    for (let i = 0; i < a.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, a.bytes.subarray(i, i + 0x8000));
    out[id] = { mime: a.mime, name: a.name, data: btoa(s) };
  }
  return out;
}

export function unpack(packed = {}) {
  for (const [id, a] of Object.entries(packed)) {
    const s = atob(a.data);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    store.set(id, { bytes: b, mime: a.mime, name: a.name });
  }
}
