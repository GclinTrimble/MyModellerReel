// Features in a scan (#300) off the page's thread: runFeatures of cloudfeatures.js on the points sent, with progress.
// A module worker: core modules import as is.
import { runFeatures } from '../core/cloudfeatures.js';

self.onmessage = ({ data }) => {
  try {
    let last = 0;
    const out = runFeatures(data.points, data.req, (fraction, stage) => {
      const now = Date.now();
      if (now - last > 150) (last = now), self.postMessage({ id: data.id, progress: fraction, stage });
    });
    self.postMessage({ id: data.id, out });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
