// Pictures and sketches for the copilot (#229) and profiles sketched by hand (#230).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, near } from './helpers.js';
import * as K from '../src/core/sketch.js';
import { userMessage } from '../src/core/agent.js';

/** A hand-drawn line: points along a→b with a wobble. */
const wobbly = (a, b, n = 20, amp = 2.5, seed = 1) => {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280 - 0.5) * 2 * amp;
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n + rnd(), a[1] + ((b[1] - a[1]) * i) / n + rnd()]);
};
const path = (corners, seed, amp = 2.5) => corners.slice(1).flatMap((c, i) => wobbly(corners[i], c, 20, amp, seed + i).slice(i ? 1 : 0));

test('sketch: a wobbly rectangle in two strokes becomes four square corners', () => {
  const a = path([[100, 300], [100, 100], [400, 100]], 3); // up, then right (canvas y down)
  const b = path([[400, 100], [400, 300], [104, 297]], 7); // down, then back near the start
  const o = K.cleanSketch([a, b]);
  assert.equal(o.closed, true);
  assert.equal(o.points.length, 4);
  near(o.width, 300, 6);
  near(o.height, 200, 6);
  const s = K.scaleOutline(o, { width: 3 });
  near(s.width, 3, 1e-9);
  near(s.height, 2, 0.05);
  for (const [x, y] of s.points) assert.ok([0, 3].some((v) => Math.abs(x - v) < 1e-6) && (Math.abs(y) < 1e-6 || Math.abs(y - s.height) < 1e-6), `corner ${x}, ${y} is square`);
});

test('sketch: an L-shaped kerb keeps its six corners; angles snap only when close', () => {
  const kerb = path([[0, 0], [0, 150], [200, 150], [200, 120], [40, 120], [40, 0], [3, 2]], 11);
  const o = K.cleanSketch([kerb]);
  assert.equal(o.closed, true);
  assert.equal(o.points.length, 6);
  const slant = K.cleanSketch([path([[0, 0], [100, 30]], 5)], { snap: 15 });
  assert.equal(slant.closed, false);
  assert.equal(slant.points.length, 2);
  near(Math.atan2(slant.points[1][1] - slant.points[0][1], slant.points[1][0] - slant.points[0][0]) * (180 / Math.PI), -15, 1e-6); // 16.7° drawn down the page → −15° with y up
  const free = K.cleanSketch([path([[0, 0], [100, 41.42]], 5, 0)], { snap: 15 });
  const ang = Math.atan2(free.points[1][1] - free.points[0][1], free.points[1][0] - free.points[0][0]) * (180 / Math.PI);
  assert.ok(Math.abs(ang + 22.5) < 1, `22.5° is between steps and stays (${ang})`);
  assert.throws(() => K.cleanSketch([]), /Draw the outline/);
});

test('copilot: a message with pictures, for each provider', () => {
  const png = 'data:image/png;base64,AAAA';
  const jpg = 'data:image/jpeg;base64,BBBB';
  assert.deepEqual(userMessage('anthropic', 'hi'), { role: 'user', content: 'hi' });
  const a = userMessage('anthropic', 'a wall like this', [png, jpg]);
  assert.deepEqual(a.content.map((b) => b.type), ['image', 'image', 'text']);
  assert.equal(a.content[1].source.media_type, 'image/jpeg');
  assert.equal(a.content[0].source.data, 'AAAA');
  assert.deepEqual(userMessage('ollama', 't', [png]), { role: 'user', content: 't', images: ['AAAA'] });
  const o = userMessage('openai', 't', [png]);
  assert.equal(o.content[1].image_url.url, png);
  assert.throws(() => userMessage('anthropic', 't', ['not a picture']), /PNG or JPEG/);
});

test('sketch_profile: a sketch becomes a saved profile at a real size, ready to sweep', async () => {
  const { reg, ctx } = makeCtx();
  const kerb = path([[0, 0], [0, 150], [200, 150], [200, 120], [40, 120], [40, 0], [3, 2]], 11);
  const r = await reg.run('sketch_profile', { name: 'my kerb', strokes: [kerb], width: 0.4 });
  assert.equal(r.closed, true);
  near(r.width, 0.4, 1e-9);
  assert.equal(ctx.doc.profiles['my kerb'].points.length, 6);
  assert.ok((await reg.run('list_profiles', {})).some?.((p) => p.name === 'my kerb') ?? JSON.stringify(await reg.run('list_profiles', {})).includes('my kerb'));
  await reg.run('create_curve', { points: [[0, 0, 0], [10, 0, 0]] }).catch(() => null);
  const line = await reg.run('sketch_profile', { name: 'edge', strokes: [path([[0, 50], [300, 50]], 2)], width: 1 });
  assert.equal(line.closed, false);
  assert.equal(ctx.doc.profiles.edge.points.length, 4, 'an open line is saved as a thin strip');
});
