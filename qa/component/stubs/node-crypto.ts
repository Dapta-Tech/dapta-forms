/**
 * `node:crypto` for qa/component. `@quill/engine`'s short-link helper imports
 * `randomInt`, and the engine is reachable from client components through
 * `@quill/types`; Next's bundler deals with that, a plain esbuild IIFE does
 * not. Web Crypto stands in.
 */
export function randomInt(min: number, max?: number): number {
  const [lo, hi] = max === undefined ? [0, min] : [min, max];
  const range = hi - lo;
  // Rejection sampling keeps the result uniform: a plain modulo favours low
  // values whenever 2^32 is not a multiple of the range.
  const limit = 2 ** 32 - (2 ** 32 % range);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return lo + (buf[0]! % range);
  }
}
