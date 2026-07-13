/**
 * Handle shape contract (ported verbatim from the original util) — validate +
 * normalize a public handle as the member types. The API stays the source
 * of truth for global uniqueness; this pre-empts obviously-invalid input.
 */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 40;

/** Reserved words a handle may not take. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'team',
  'teams',
  'forms',
  'form',
  'reservations',
  'reservation',
  'api',
  'v1',
  'public',
  'health',
  'me',
  'login',
  'logout',
  'signin',
  'signup',
  'auth',
  'home',
  'settings',
  'events',
  'connections',
  'admin',
  'app',
  'www',
  'about',
  'help',
  'support',
  'docs',
  'terms',
  'privacy',
  'pricing',
  'demo',
  'test',
  'static',
  'assets',
  'favicon',
  'robots',
  'sitemap',
  'null',
  'undefined',
]);

export type HandleError =
  | 'HANDLE_ERR_SHORT'
  | 'HANDLE_ERR_LONG'
  | 'HANDLE_ERR_INVALID'
  | 'HANDLE_ERR_RESERVED';

/** Normalize raw input into a url-safe handle candidate. */
export function slugifyHandle(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HANDLE_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/** Validate a NORMALIZED handle; returns an error key or null when valid. */
export function validateHandle(handle: string): HandleError | null {
  if (handle.length < HANDLE_MIN_LENGTH) return 'HANDLE_ERR_SHORT';
  if (handle.length > HANDLE_MAX_LENGTH) return 'HANDLE_ERR_LONG';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) return 'HANDLE_ERR_INVALID';
  if (RESERVED_HANDLES.has(handle)) return 'HANDLE_ERR_RESERVED';
  return null;
}
