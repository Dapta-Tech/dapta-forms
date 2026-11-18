/**
 * `node:crypto` for qa/component. `@quill/engine`'s short-link helper imports
 * `randomInt`, and the engine is reachable from client components through
 * `@quill/types`; Next's bundler deals with that, a plain esbuild IIFE does
 * not. Web Crypto stands in.
 */
export function randomInt(min: number, max?: number): number {
  const [lo, hi] = max === undefined ? [0, min] : [min, max];
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return lo + (n! % (hi - lo));
}
