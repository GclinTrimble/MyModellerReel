// Routing for scans (#302): each point cloud keyword picks the pointcloud toolset first, and a small model gets
// describe_cloud and the toolset's best matches for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLSETS, toolsetFor, routeTools, rankCommands, tokens } from '../src/core/routing.js';
import { makeCtx } from './helpers.js';

const ASKS = {
  scan: 'what is in this scan',
  'point cloud': 'load the point cloud of the site',
  las: 'open the LAS file from the drone',
  laz: 'the LAZ tiles from the survey',
  copc: 'stream the COPC from the site survey',
  potree: 'use the Potree folder',
  slice: 'slice level 1 and draft the walls',
  'limit box': 'put a limit box around the culvert',
  clip: 'clip the model to the retaining wall',
  classify: 'classify the ground and hide the trees',
  intensity: 'colour it by intensity',
  'x-ray': 'show it in x-ray from above',
  façade: 'draw the façade of the shed',
  facade: 'facade lines of the building',
  corner: 'find the building corners',
  footprint: 'find the building footprints on this site',
  kerb: 'extract the kerb lines along Main road',
  curb: 'curb lines along the access road',
  'edge of pavement': 'trace the edge of pavement',
  'wall line': 'the wall line of the retaining wall',
};

test('every point cloud keyword routes to the pointcloud toolset', () => {
  const { reg } = makeCtx();
  const list = reg.list();
  const cloud = new Set(TOOLSETS.pointcloud.names);
  for (const [word, ask] of Object.entries(ASKS)) {
    assert.equal(toolsetFor(ask), 'pointcloud', word);
    const routed = routeTools(list, { query: ask }).map((c) => c.name);
    assert.ok(routed.includes('describe_cloud'), `${word}: ${routed.join()}`);
    const top = rankCommands(list, { query: ask })[0]?.name;
    assert.ok(cloud.has(top), `${word}: ${top} ranks first`);
  }
  assert.equal(toolsetFor('build a red box'), null);
  assert.equal(toolsetFor('vectorise the scanned drawing'), null);
  assert.deepEqual(tokens('X-ray the façade'), ['xray', 'facade']);
});
