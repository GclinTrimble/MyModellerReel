// The point cloud conversion thread (#293): converts one file to a Potree 2.0 octree (cloud-convert.mjs), posting
// progress and the preview. Cancelled by terminating it (clouds.cjs removes the half-written folder).
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  if (workerData.task) {
    // classification or export of a whole octree (#298, #299): cloud-task.mjs
    const T = await import(workerData.taskUrl);
    let last = 0;
    const progress = (p) => {
      const now = Date.now();
      if (now - last > 200 || p.stage === 'done') (last = now), parentPort.postMessage({ type: 'progress', ...p });
    };
    const part = (p) => parentPort.postMessage({ type: 'part', ...p });
    const result = await (workerData.task === 'classify' ? T.classifyTree : T.exportTree)(workerData.opts, { progress, part });
    parentPort.postMessage({ type: 'done', result });
    return;
  }
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
