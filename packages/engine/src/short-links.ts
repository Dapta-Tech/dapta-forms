/**
 * Short public links — the pure rules (no DB, no I/O):
 *   - 6-char short account codes over an unambiguous alphabet
 *   - vanity account slug validation + the reserved-word blocklist
 *   - auto-handle derivation from a display name / email
 *   - the paid-plan gate for claiming a vanity slug (OSS-unlockable via env)
 *
 * Collision handling (retry loops against the DB) lives in @quill/db; these
 * helpers only generate candidates and validate shapes.
 */
import { randomInt } from 'node:crypto';

/**
 * Unambiguous alphabet: a-z + 2-9 minus the look-alikes 0/o and 1/l.
 * 32 symbols → 32^6 ≈ 1.07e9 distinct 6-char codes.
 */
export const SHORT_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const SHORT_CODE_LENGTH = 6;

const SHORT_CODE_RE = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

/** One random candidate short code (uniqueness is the caller's retry loop). */
export function generateShortCode(): string {
  let out = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    out += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

export function isShortCode(value: string): boolean {
  return SHORT_CODE_RE.test(value);
}

/**
 * Slugs that can never be claimed as a vanity account slug (or generated as a
 * short code): top-level routes, infra paths, and confusables. Superset of the
 * per-account handle blocklists so an account slug can't shadow app routes.
 */
export const RESERVED_PUBLIC_SLUGS = new Set([
  'about', 'admin', 'api', 'app', 'apps', 'assets', 'auth', 'billing', 'blog',
  'forms', 'form', 'submissions', 'connections', 'contact', 'dashboard', 'demo', 'dev',
  'docs', 'events', 'event-types', 'favicon', 'health', 'help', 'home', 'internal', 'login',
  'logout', 'mail', 'manage', 'me', 'null', 'oauth', 'pricing', 'privacy', 'public', 'reserved',
  'robots', 'root', 'settings', 'signin', 'signup', 'sitemap', 'static', 'status', 'support',
  'team', 'teams', 'terms', 'test', 'undefined', 'v1', 'v2', 'webhooks', 'www',
]);

export function isReservedPublicSlug(value: string): boolean {
  return RESERVED_PUBLIC_SLUGS.has(value.toLowerCase());
}

export const VANITY_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;

export type VanitySlugIssue = 'invalid' | 'reserved' | null;

/** Shape + blocklist validation. Uniqueness (codes/aliases/other vanities) is the DB's job. */
export function validateVanitySlug(slug: string): VanitySlugIssue {
  const s = slug.toLowerCase();
  if (!VANITY_SLUG_RE.test(s) || s.includes('--')) return 'invalid';
  if (isReservedPublicSlug(s)) return 'reserved';
  return null;
}

/**
 * The single policy gate for claiming a vanity slug (open-core). Forms is
 * ALWAYS free — there is no Forms-side plan. Premium unlocks come from the
 * customer's Dapta AI subscription, validated upstream (IAM) and passed in
 * here as `isPaidDaptaCustomer`. OSS forks default to `open`
 * (`PREMIUM_FEATURES=open`): no upsell, they just don't get cloud entitlements.
 */
export function canClaimVanitySlug(
  mode: 'open' | 'locked',
  isPaidDaptaCustomer: boolean,
): boolean {
  return mode === 'open' || isPaidDaptaCustomer;
}

/**
 * Derive the base auto-handle for a member: "Felipe Gomez" → `fgomez`;
 * single-word names pass through; fallback is the email local part, then
 * `host`. Result always matches the handle shape `[a-z0-9]+(-[a-z0-9]+)*`,
 * length ≥ 3. Collisions are the caller's suffix loop (`fgomez2`, `fgomez3`…).
 */
export function deriveHandleBase(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip accents: Gómez → gomez
      .replace(/[^a-z0-9]+/g, '');

  const words = (displayName ?? '')
    .trim()
    .split(/\s+/)
    .map(clean)
    .filter(Boolean);
  let base = '';
  if (words.length >= 2) base = `${words[0]![0]}${words[words.length - 1]}`;
  else if (words.length === 1) base = words[0]!;
  if (base.length < 3) {
    const local = clean((email ?? '').split('@')[0] ?? '');
    if (local.length >= 3) base = local;
  }
  if (base.length < 3) base = 'host';
  return base.slice(0, 30);
}

/** The Nth candidate for a base: n=1 → base, n=2 → base2, n=3 → base3 … */
export function handleCandidate(base: string, n: number): string {
  return n <= 1 ? base : `${base}${n}`;
}
