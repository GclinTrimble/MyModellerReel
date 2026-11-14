// The synthetic corridor scan (scan.js) as a point cloud entity in a document, the way import_point_cloud keeps a
// preview (layout 2: positions, colours, intensity, classes, returns, time, source), with the project base point on
// the site's corner. For tests and eval tasks that need a scan without the desktop app.
import * as D from '../../src/core/document.js';
import * as Assets from '../../src/core/assets.js';
import * as CS from '../../src/core/cloudstyle.js';
import { geo } from '../../src/core/survey.js';
import { makeScan, SITE } from './scan.js';

/** classified: false gives every point class 1 (unclassified), a scan straight from the field. */
export function addScanCloud(doc, { points = 60000, seed = 1, name = 'Site scan', classified = true } = {}) {
  const s = makeScan({ points, seed });
  if (!classified) s.classification.fill(1);
  const base = SITE.origin;
  geo(doc).base = [...base];
  const n = s.count;
  const keep = Array.from({ length: n }, (_, i) => i);
  const pos = new Float32Array(n * 3);
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set([s.x[i] - base[0], s.z[i] - base[2], -(s.y[i] - base[1])], i * 3);
    rgb.set([s.r[i], s.g[i], s.b[i]], i * 3);
  }
  const { attributes, parts } = CS.encodeAttributes({ ...s, pointSource: s.pointSourceId }, keep);
  const blocks = [new Uint8Array(pos.buffer), rgb, ...parts];
  const bytes = new Uint8Array(blocks.reduce((t, b) => t + b.byteLength, 0));
  blocks.reduce((at, b) => (bytes.set(b, at), at + b.byteLength), 0);
  const asset = Assets.put(bytes, { mime: 'application/x-mmr-points', name: `${name}.las` });
  return D.addEntity(doc, { type: 'pointcloud', name, pointcloud: { asset, count: n, colors: true, base: [...base], format: 'LAS', of: n * 10, layout: 2, attributes }, material: { color: '#7a8a96' } });
}
