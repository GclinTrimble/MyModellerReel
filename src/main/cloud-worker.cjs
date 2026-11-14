// The point cloud conversion thread (#293): converts one file to a Potree 2.0 octree (cloud-convert.mjs), posting
// progress and the preview. Cancelled by terminating it (clouds.cjs removes the half-written folder).
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  const { convertCloud } = await import(workerData.convertUrl);
  let last = 0;
  const { metadata } = await convertCloud(workerData.file, workerData.out, {
    name: workerData.name,
    onProgress: (p) => {
      const now = Date.now();
      if (now - last > 200 || p.stage === 'done') (last = now), parentPort.postMessage({ type: 'progress', ...p });
    },
    onPreview: (preview) => parentPort.postMessage({ type: 'preview', preview }),
  });
  parentPort.postMessage({ type: 'done', metadata });
})().catch((e) => parentPort.postMessage({ type: 'error', message: e.message }));
