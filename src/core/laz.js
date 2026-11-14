// LAZ (#293): the open LASzip compression, read chunk by chunk so a file of any size streams. The chunk table (an
// arithmetic-coded list of chunk sizes at the end of the point data) is decoded here, after LASzip's
// ArithmeticDecoder and IntegerCompressor (LGPL, re-written); the chunks themselves are decompressed by laz-perf
// (Apache-2.0, WASM). COPC nodes (copc.js) are LAZ chunks too.

import { lasHeader, decodeLasRecords } from './pointcloud.js';

const MIN_LENGTH = 0x01000000;
const BM_SHIFT = 13;
const BM_MAX = 1 << 13;
const DM_SHIFT = 15;
const DM_MAX = 1 << 15;

class Model {
  constructor(symbols) {
    this.symbols = symbols;
    this.last = symbols - 1;
    if (symbols > 16) {
      let bits = 3;
      while (symbols > 1 << (bits + 2)) bits++;
      this.tableSize = 1 << bits;
      this.tableShift = DM_SHIFT - bits;
      this.table = new Uint32Array(this.tableSize + 2);
    } else this.tableSize = 0;
    this.dist = new Uint32Array(symbols);
    this.count = new Uint32Array(symbols).fill(1);
    this.total = 0;
    this.cycle = symbols;
    this.update();
    this.until = this.cycle = (symbols + 6) >> 1;
  }
  update() {
    if ((this.total += this.cycle) > DM_MAX) {
      this.total = 0;
      for (let n = 0; n < this.symbols; n++) this.total += this.count[n] = (this.count[n] + 1) >> 1;
    }
    const scale = Math.floor(0x80000000 / this.total);
    let sum = 0;
    let s = 0;
    for (let k = 0; k < this.symbols; k++) {
      this.dist[k] = Math.floor((scale * sum) / 2 ** (31 - DM_SHIFT));
      sum += this.count[k];
      if (this.tableSize) {
        const w = this.dist[k] >>> this.tableShift;
        while (s < w) this.table[++s] = k - 1;
      }
    }
    if (this.tableSize) {
      this.table[0] = 0;
      while (s <= this.tableSize) this.table[++s] = this.symbols - 1;
    }
    this.cycle = (5 * this.cycle) >> 2;
    this.cycle = Math.min(this.cycle, (this.symbols + 6) << 3);
    this.until = this.cycle;
  }
}

class BitModel {
  constructor() {
    this.zeros = 1;
    this.bits = 2;
    this.p0 = 1 << (BM_SHIFT - 1);
    this.cycle = this.until = 4;
  }
  update() {
    if ((this.bits += this.cycle) > BM_MAX) {
      this.bits = (this.bits + 1) >> 1;
      this.zeros = (this.zeros + 1) >> 1;
      if (this.zeros === this.bits) this.bits++;
    }
    this.p0 = Math.floor((this.zeros * Math.floor(0x80000000 / this.bits)) / 2 ** (31 - BM_SHIFT));
    this.cycle = Math.min(64, (5 * this.cycle) >> 2);
    this.until = this.cycle;
  }
}

/** LASzip's arithmetic decoder over bytes from at. */
export class ArithmeticDecoder {
  constructor(u8, at = 0) {
    this.u8 = u8;
    this.p = at;
    this.length = 0xffffffff;
    this.value = ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }
  byte() {
    return this.u8[this.p++] ?? 0;
  }
  renorm() {
    do {
      this.value = ((this.value << 8) | this.byte()) >>> 0;
      this.length = (this.length << 8) >>> 0;
    } while (this.length < MIN_LENGTH);
  }
  bit(m) {
    const x = m.p0 * (this.length >>> BM_SHIFT);
    const sym = this.value >= x ? 1 : 0;
    if (!sym) {
      this.length = x;
      m.zeros++;
    } else {
      this.value -= x;
      this.length -= x;
    }
    if (this.length < MIN_LENGTH) this.renorm();
    if (--m.until === 0) m.update();
    return sym;
  }
  symbol(m) {
    let sym;
    let x;
    let y = this.length;
    if (m.tableSize) {
      this.length >>>= DM_SHIFT;
      const dv = Math.floor(this.value / this.length);
      const t = dv >>> m.tableShift;
      sym = m.table[t];
      let n = m.table[t + 1] + 1;
      while (n > sym + 1) {
        const k = (sym + n) >> 1;
        if (m.dist[k] > dv) n = k;
        else sym = k;
      }
      x = m.dist[sym] * this.length;
      if (sym !== m.last) y = m.dist[sym + 1] * this.length;
    } else {
      x = sym = 0;
      this.length >>>= DM_SHIFT;
      let n = m.symbols;
      let k = n >> 1;
      do {
        const z = this.length * m.dist[k];
        if (z > this.value) (n = k), (y = z);
        else (sym = k), (x = z);
      } while ((k = (sym + n) >> 1) !== sym);
    }
    this.value -= x;
    this.length = y - x;
    if (this.length < MIN_LENGTH) this.renorm();
    m.count[sym]++;
    if (--m.until === 0) m.update();
    return sym;
  }
  bits(n) {
    if (n > 19) {
      const lo = this.short();
      return this.bits(n - 16) * 65536 + lo;
    }
    this.length = Math.floor(this.length / 2 ** n);
    const sym = Math.floor(this.value / this.length);
    this.value -= this.length * sym;
    if (this.length < MIN_LENGTH) this.renorm();
    return sym;
  }
  short() {
    this.length >>>= 16;
    const sym = Math.floor(this.value / this.length);
    this.value -= this.length * sym;
    if (this.length < MIN_LENGTH) this.renorm();
    return sym;
  }
}

/** LASzip's IntegerCompressor, decompressing 32-bit values (range 0), as the chunk table uses it. */
export class IntegerDecompressor {
  constructor(dec, contexts = 1, bitsHigh = 8) {
    this.dec = dec;
    this.high = bitsHigh;
    this.mBits = Array.from({ length: contexts }, () => new Model(33));
    this.corr = [new BitModel()];
    for (let i = 1; i <= 32; i++) this.corr.push(new Model(i <= bitsHigh ? 1 << i : 1 << bitsHigh));
  }
  decompress(pred, context = 0) {
    const d = this.dec;
    const k = d.symbol(this.mBits[context]);
    let c;
    if (k) {
      if (k < 32) {
        if (k <= this.high) c = d.symbol(this.corr[k]);
        else {
          const k1 = k - this.high;
          c = d.symbol(this.corr[k]) * 2 ** k1 + d.bits(k1);
        }
        if (c >= 2 ** (k - 1)) c += 1;
        else c -= 2 ** k - 1;
      } else c = -0x80000000;
    } else c = d.bit(this.corr[0]);
    return (pred + c) | 0;
  }
}

/** The laszip VLR (22204): its chunk size (0xffffffff: variable) and items. */
export function laszipInfo(h) {
  const v = h.vlrs.find((r) => r.user === 'laszip encoded' && r.record === 22204);
  if (!v) throw new Error('This LAZ has no laszip VLR.');
  const dv = new DataView(v.data.buffer, v.data.byteOffset, v.data.byteLength);
  return { compressor: dv.getUint16(0, true), chunkSize: dv.getUint32(12, true) };
}

/**
 * The chunks of a LAZ file: [{ start, size, count }] in bytes and points. readRange(at, length) → Uint8Array reads
 * the file (whole bytes or a file handle). The table's place is the 8 bytes at the start of the point data, or the
 * file's last 8 bytes when the writer could not go back to fill it in.
 */
export function lazChunks(h, readRange, fileSize) {
  const { chunkSize } = laszipInfo(h);
  const first = new DataView(readRange(h.offset, 8).slice().buffer);
  let tableAt = Number(first.getBigInt64(0, true));
  if (tableAt === -1) tableAt = Number(new DataView(readRange(fileSize - 8, 8).slice().buffer).getBigInt64(0, true));
  const head = new DataView(readRange(tableAt, 8).slice().buffer);
  const n = head.getUint32(4, true);
  const variable = chunkSize === 0xffffffff;
  const counts = new Array(n).fill(chunkSize);
  const sizes = new Array(n);
  if (n) {
    const dec = new ArithmeticDecoder(readRange(tableAt + 8, Math.min(fileSize - tableAt - 8, 16 + n * 16)));
    const ic = new IntegerDecompressor(dec, 2);
    for (let i = 0; i < n; i++) {
      if (variable) counts[i] = ic.decompress(i ? counts[i - 1] : 0, 0);
      sizes[i] = ic.decompress(i ? sizes[i - 1] : 0, 1);
    }
  }
  const out = [];
  let at = h.offset + 8;
  let left = h.count;
  for (let i = 0; i < n; i++) {
    const count = variable ? counts[i] : Math.min(chunkSize, left);
    out.push({ start: at, size: sizes[i], count });
    at += sizes[i];
    left -= count;
  }
  return out;
}

let lazPerf = null;
/** laz-perf's WASM module, loaded once (Node build in the main process and its workers). */
export async function loadLazPerf() {
  if (!lazPerf) {
    const m = await import('laz-perf');
    lazPerf = await (m.createLazPerf || m.default?.createLazPerf || m.default)();
  }
  return lazPerf;
}

/** Decompress one LAZ chunk (count points) to raw LAS records. */
export function decompressChunk(LP, bytes, format, recLen, count) {
  const src = LP._malloc(bytes.length);
  const dst = LP._malloc(recLen);
  const out = new Uint8Array(count * recLen);
  const dec = new LP.ChunkDecoder();
  try {
    LP.HEAPU8.set(bytes, src);
    dec.open(format, recLen, src);
    for (let i = 0; i < count; i++) {
      dec.getPoint(dst);
      out.set(LP.HEAPU8.subarray(dst, dst + recLen), i * recLen);
    }
  } finally {
    dec.delete();
    LP._free(src);
    LP._free(dst);
  }
  return out;
}

/** Decoded points of a chunk: a batch like decodeLasRecords'. */
export function decodeChunk(LP, h, bytes, count) {
  const raw = decompressChunk(LP, bytes, h.format, h.recLen, count);
  return decodeLasRecords(raw, h, 0, count);
}

/** A whole LAZ file in memory, decoded (for small files and tests). */
export async function parseLaz(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const h = lasHeader(u8);
  const LP = await loadLazPerf();
  const parts = lazChunks(h, (at, n) => u8.subarray(at, at + n), u8.length).map((c) => decodeChunk(LP, h, u8.subarray(c.start, c.start + c.size), c.count));
  return { parts, header: h };
}
