/**
 * Strip a repeated character from the ends of a string, in linear time.
 *
 * The regex equivalents (`/\/+$/`, `/^-+|-+$/g`) backtrack on a long run of
 * the character that is not at the end, which static analysis flags as a
 * polynomial ReDoS. These loops never backtrack.
 */

/** `value` without any trailing `char` (`'a//'` → `'a'`). */
export function trimTrailing(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end--;
  return value.slice(0, end);
}

/** `value` without any leading or trailing `char` (`'--a--'` → `'a'`). */
export function trimChar(value: string, char: string): string {
  let start = 0;
  while (start < value.length && value[start] === char) start++;
  return trimTrailing(value.slice(start), char);
}
