/**
 * A random UUID v4 that also works outside a secure context.
 *
 * `crypto.randomUUID` only exists on secure origins. A form embedded in a host
 * page served over plain `http://` runs its iframe in a non-secure context, and
 * calling it there threw and took the whole form down ("This page didn't
 * load"). `crypto.getRandomValues` has no such restriction; `Math.random` is
 * the last resort for an environment with neither (the id only has to be
 * unique per browser session, not secret).
 */
export function randomId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // Fall through to the manual version below.
    }
  }
  const bytes = new Uint8Array(16);
  try {
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('no crypto');
    c.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
