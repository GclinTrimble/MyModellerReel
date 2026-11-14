// Decodes point cloud nodes off the page's thread (#294): Potree 2.0 records, or COPC chunks (LAZ, through laz-perf's
// WASM), into GPU-ready typed arrays in model axes (x east, y up, z south) relative to the node's corner, plus each
// point's exact project coordinates (doubles) for picking and snapping. A module worker: core modules import as is.
import { decodeRecords } from '../core/octree.js';
import { decompressChunk } from '../core/laz.js';
import { decodeLasRecords } from '../core/pointcloud.js';

let lazPerf = null;
async function lp() {
  if (!lazPerf) {
    // laz-perf's web build is a UMD script: run it at the worker's top level, then make the module
    const dir = new URL('../../node_modules/laz-perf/lib/web/', import.meta.url);
    (0, eval)(await (await fetch(new URL('laz-perf.js', dir))).text());
    lazPerf = await globalThis.createLazPerf({ locateFile: (f) => new URL(f, dir).href });
  }
  return lazPerf;
}

const fromLas = (b) => {
  const n = b.count;
  const position = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) (position[i * 3] = b.x[i]), (position[i * 3 + 1] = b.y[i]), (position[i * 3 + 2] = b.z[i]);
  const rgb = b.r ? new Uint16Array(n * 3) : null;
  if (rgb) for (let i = 0; i < n; i++) (rgb[i * 3] = b.r[i] * 257), (rgb[i * 3 + 1] = b.g[i] * 257), (rgb[i * 3 + 2] = b.b[i] * 257);
  return { count: n, position, rgb, intensity: b.intensity, classification: b.classification, 'return number': b.returnNumber, 'number of returns': b.numberOfReturns, 'gps-time': b.gpsTime, 'point source id': b.pointSourceId };
};

async function decode({ kind, bytes, layout, header, scale, offset, count, min, base, timeBase }) {
  const d = kind === 'copc' ? fromLas(decodeLasRecords(decompressChunk(await lp(), new Uint8Array(bytes), header.format, header.recLen, count), header, 0, count)) : decodeRecords(new Uint8Array(bytes), layout, scale, offset, count);
  const n = d.count;
  const p = d.position;
  const position = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    position[i * 3] = p[i * 3] - min[0];
    position[i * 3 + 1] = p[i * 3 + 2] - min[2];
    position[i * 3 + 2] = -(p[i * 3 + 1] - min[1]);
  }
  const out = { count: n, position, exact: p, origin: [min[0] - base[0], min[2] - base[2], -(min[1] - base[1])] };
  const rgb = d.rgb;
  if (rgb) {
    // 16-bit colour, or 8-bit values in the 16-bit fields
    let max = 0;
    for (let i = 0; i < rgb.length; i += 97) max = Math.max(max, rgb[i]);
    const sh = max > 255 ? 8 : 0;
    out.rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n * 3; i++) out.rgb[i] = rgb[i] >> sh;
  }
  const copy = (name, as, T) => d[name] && (out[as] = T ? T.from(d[name]) : d[name]);
  copy('intensity', 'intensity');
  copy('classification', 'classification');
  copy('return number', 'returnNumber');
  copy('number of returns', 'numberOfReturns');
  copy('point source id', 'pointSource');
  if (d['gps-time']) {
    // float32 on the GPU: seconds from the cloud's first time
    out.gpsTime = new Float32Array(n);
    for (let i = 0; i < n; i++) out.gpsTime[i] = d['gps-time'][i] - timeBase;
    out.gpsExact = d['gps-time'];
  }
  return out;
}

self.onmessage = async ({ data }) => {
  try {
    const out = await decode(data);
    const transfer = Object.values(out).filter((v) => v?.buffer instanceof ArrayBuffer).map((v) => v.buffer);
    self.postMessage({ id: data.id, out }, [...new Set(transfer)]);
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
