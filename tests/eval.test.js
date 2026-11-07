// The eval harness (npm run eval): every task's reference solution scores 100 % through the real agent loop, and a
// model that does nothing scores below it, so the scorers measure something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASKS } from '../scripts/eval-tasks.js';
import { runTask } from '../scripts/eval.mjs';

test('eval: reference solutions score 100 %, doing nothing does not', async () => {
  for (const t of TASKS) {
    const r = await runTask(t, 'mock');
    assert.equal(r.score, 1, `${t.name}: ${r.failed.join('; ')}`);
    assert.equal(r.errors, 0, t.name);
    const idle = await runTask({ ...t, solution: [] }, 'mock');
    assert.ok(idle.score < 1, `${t.name} scores an empty answer ${idle.score}`);
  }
});
