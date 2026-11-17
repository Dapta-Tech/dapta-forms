/**
 * Email-shape checks that run in linear time.
 *
 * Both replace a regular expression whose domain part could split at any dot,
 * which backtracks quadratically on a long answer full of dots that fails to
 * match (CodeQL js/polynomial-redos). These run on respondent answers on the
 * public submit path and in the outbox worker, so one crafted answer could
 * stall a request handler or a delivery. Each accepts EXACTLY the strings its
 * regular expression accepted; `email-shape.spec.ts` checks that against the
 * old pattern on random input.
 */

/**
 * The same strings as `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`: no whitespace, exactly one
 * `@` with something before it, and a dot in the domain that is neither its
 * first nor its last character.
 */
export function isEmailAddressShape(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.', 1);
  return dot !== -1 && dot <= domain.length - 2;
}

/**
 * The same strings as `/@[^@]+\.[^@]+$/` (unanchored at the start): after the
 * LAST `@` there is a dot with at least one character on each side of it.
 * Deliberately loose, as the pattern was: it spots an email-looking answer, it
 * does not validate one.
 */
export function hasEmailShapedTail(value: string): boolean {
  const at = value.lastIndexOf('@');
  if (at < 0) return false;
  const dot = value.lastIndexOf('.', value.length - 2);
  return dot >= at + 2;
}
