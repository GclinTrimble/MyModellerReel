// Point cloud octrees in the main process (#293, #294): conversion jobs in a worker thread (cloud-worker.cjs) with
// progress and cancel, the cache folder per source (<userData>/clouds/<hash>), opening an octree or a COPC file, and
// node byte ranges for the viewer. Only files this module opened can be read back.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');

const CLOUD_EXT = /\.(las|laz|ply|xyz|pts|csv|txt)$/i;
const convertUrl = pathToFileURL(path.join(__dirname, 'cloud-convert.mjs')).href;

function registerClouds(ipcMain, userData) {
  const cacheRoot = path.join(userData, 'clouds');
  const jobs = new Map();
  const readable = new Set(); // octree.bin files and COPC files opened here
  let next = 1;

  /** The cache folder of a source: a hash of its path, size and time, so an edited file converts again. */
  const hashOf = (file) => {
    const st = fs.statSync(file);
    return crypto.createHash('sha1').update(`${path.resolve(file).toLowerCase()}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  };
  const complete = (folder) => ['metadata.json', 'hierarchy.bin', 'octree.bin'].every((f) => fs.existsSync(path.join(folder, f)));
  const isCopc = (file) => {
    if (!/\.laz$/i.test(file)) return false;
    const fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(400);
      fs.readSync(fd, b, 0, 400, 0);
      const vlr = b.readUInt16LE(94); // the first VLR follows the header
      return b.toString('latin1', vlr + 2, vlr + 6) === 'copc';
    } finally {
      fs.closeSync(fd);
    }
  };
  const summary = (j) => ({ id: j.id, cached: !!j.cached, status: j.status, stage: j.stage, fraction: j.fraction, done: j.done, of: j.of, error: j.error, kind: j.kind, folder: j.folder, hash: j.hash, source: j.source, points: j.points, hasPreview: !!j.preview });

  // a conversion (or an instant result: a finished cache, a COPC file)
  ipcMain.handle('cloud:convert', async (_, { path: file, folder, name, minPoints = 0 } = {}) => {
    if (!CLOUD_EXT.test(file || '')) throw new Error(`${path.basename(file || '')} is not a point cloud file (LAS, LAZ, COPC, PLY, XYZ).`);
    if (!fs.existsSync(file)) throw new Error(`No file at ${file}.`);
    // 'auto': a small LAS (header count) or text / PLY file (about 30 bytes a point) is just thinned, no octree
    if (minPoints && !/\.laz$/i.test(file)) {
      const head = Buffer.alloc(375);
      const fd = fs.openSync(file, 'r');
      fs.readSync(fd, head, 0, 375, 0);
      fs.closeSync(fd);
      const las = head.toString('latin1', 0, 4) === 'LASF';
      const n = las ? (head[25] >= 4 ? Number(head.readBigUInt64LE(247)) : 0) || head.readUInt32LE(107) : fs.statSync(file).size / 30;
      if (n < minPoints) return { status: 'small', points: Math.round(n) };
    }
    const id = `cloud-${next++}`;
    const hash = hashOf(file);
    const job = { id, hash, source: file, status: 'running', stage: 'starting', fraction: 0, kind: 'potree' };
    jobs.set(id, job);
    if (isCopc(file)) {
      const { openCopc } = await import(convertUrl);
      const c = await openCopc(file);
      readable.add(path.resolve(file));
      Object.assign(job, { kind: 'copc', status: 'done', stage: 'done', fraction: 1, folder: null, points: c.points, preview: c.preview, header: c.header });
      return summary(job);
    }
    job.folder = folder || path.join(cacheRoot, hash);
    if (complete(job.folder)) {
      const meta = JSON.parse(fs.readFileSync(path.join(job.folder, 'metadata.json'), 'utf8'));
      const { octreePreview } = await import(convertUrl);
      Object.assign(job, { status: 'done', stage: 'done', fraction: 1, points: meta.points, cached: true, preview: octreePreview(job.folder) });
      return summary(job);
    }
    fs.rmSync(job.folder, { recursive: true, force: true });
    // the worker stays under 4 GB: chunks of 4 M points, typed arrays outside the heap counted by the OS only
    const w = new Worker(path.join(__dirname, 'cloud-worker.cjs'), { workerData: { file, out: job.folder, name, convertUrl }, resourceLimits: { maxOldGenerationSizeMb: 3072 } });
    job.worker = w;
    w.on('message', (m) => {
      if (m.type === 'progress') Object.assign(job, { stage: m.stage, fraction: m.fraction, done: m.done, of: m.of });
      else if (m.type === 'preview') job.preview = m.preview;
      else if (m.type === 'done') Object.assign(job, { status: 'done', stage: 'done', fraction: 1, points: m.metadata.points });
      else if (m.type === 'error') Object.assign(job, { status: 'error', error: m.message });
    });
    w.on('error', (e) => Object.assign(job, { status: 'error', error: e.message }));
    w.on('exit', () => {
      job.worker = null;
      if (job.status === 'running') Object.assign(job, { status: 'error', error: 'The conversion stopped.' });
      if (job.status !== 'done') fs.rmSync(job.folder, { recursive: true, force: true });
    });
    return summary(job);
  });

  // progress; with preview: true, the preview points once they are counted (x, y, z doubles and colours)
  ipcMain.handle('cloud:job', (_, id, { preview = false } = {}) => {
    const j = jobs.get(id);
    if (!j) throw new Error(`No point cloud job ${id}.`);
    return { ...summary(j), preview: preview ? j.preview || null : undefined };
  });
  ipcMain.handle('cloud:jobs', () => [...jobs.values()].map(summary));

  ipcMain.handle('cloud:cancel', async (_, id) => {
    const j = jobs.get(id);
    if (!j) throw new Error(`No point cloud job ${id}.`);
    if (j.status === 'running') {
      j.status = 'cancelled';
      await j.worker?.terminate();
    }
    return summary(j);
  });

  // an octree to stream: { kind, metadata, root } (Potree folder) or { kind: 'copc', header, info, root } (COPC file)
  ipcMain.handle('cloud:open', async (_, { folder, file } = {}) => {
    const conv = await import(convertUrl);
    if (file) {
      if (!/\.laz$/i.test(file) || !isCopc(file)) throw new Error(`${path.basename(file)} is not a COPC file.`);
      const c = await conv.openCopc(file, 0);
      readable.add(path.resolve(file));
      const h = c.header;
      return { kind: 'copc', file, root: c.root, points: c.points, info: c.info, header: { format: h.format, recLen: h.recLen, scale: h.scale, origin: h.origin, min: h.min, max: h.max, count: h.count } };
    }
    if (!folder || !complete(folder)) return { missing: true, folder };
    const o = conv.readOctree(folder);
    readable.add(path.resolve(folder, 'octree.bin'));
    return { kind: 'potree', folder, metadata: o.metadata, root: o.root };
  });

  // node bytes (#294): an octree.bin range, or a COPC chunk (still compressed: the page's worker decodes it)
  ipcMain.handle('cloud:read-node', (_, { folder, file, byteOffset, byteSize }) => {
    const f = path.resolve(file || path.join(folder, 'octree.bin'));
    if (!readable.has(f)) throw new Error('That point cloud is not open.');
    if (!(byteSize > 0) || byteSize > 512e6) throw new Error('Bad node size.');
    const fd = fs.openSync(f, 'r');
    try {
      const b = Buffer.allocUnsafe(byteSize);
      fs.readSync(fd, b, 0, byteSize, byteOffset);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    } finally {
      fs.closeSync(fd);
    }
  });

  ipcMain.handle('cloud:cache-folder', () => cacheRoot);
}

module.exports = { registerClouds };
