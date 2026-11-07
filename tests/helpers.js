import assert from 'node:assert/strict';
import { Store, newDoc } from '../src/core/document.js';
import { createRegistry } from '../src/core/commands.js';

export const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
export const nearArr = (a, b, eps = 1e-3) => a.forEach((x, k) => near(x, b[k], eps));

/** A registry on a fresh document, the way the app wires it, minus the viewport. */
export function makeCtx() {
  const store = new Store(newDoc());
  let sel = [];
  const ctx = {
    store,
    get doc() {
      return store.doc;
    },
    selection: { get: () => sel, set: (x) => (sel = x) },
  };
  return { ctx, reg: createRegistry(ctx) };
}
