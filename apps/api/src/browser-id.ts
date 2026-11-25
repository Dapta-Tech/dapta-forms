import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The first-party BROWSER id behind the current request, for the referral
 * program's same-browser rule (0034): a referral does not count when the new
 * person signs up in a browser the referrer was seen in.
 *
 * The web app keeps a random, opaque id in a long-lived httpOnly cookie
 * (`dforms_bid`, see `apps/web/lib/browser-id.ts`) and forwards it in one
 * header on its server-side API calls. This module checks its shape, hashes it
 * (SHA-256, hex) and keeps only the hash for the lifetime of the request, so
 * the referral service reads it wherever it runs, including inside a sign-in
 * (the invite credit) where no request object is at hand. The raw value is
 * never stored or logged.
 *
 * Attacker-controllable, and treated that way: a missing or malformed header
 * means "no browser" and the rule is simply not asked, never a refusal. It is
 * a speed bump for one person in one browser, not an identity: a private
 * window or a second browser gets a new id (accepted, see ADR 0005). A network
 * address is never used.
 */

/** Kept in step with `apps/web/lib/browser-id.ts`. */
export const BROWSER_ID_HEADER = 'x-quill-browser';

/** The web mints 32 random bytes as base64url (43 characters). Bounded on both sides. */
const BROWSER_ID = /^[A-Za-z0-9_-]{22,128}$/;

const store = new AsyncLocalStorage<string | null>();

/** A header value that is a well-formed browser id, else null. */
export function parseBrowserId(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && BROWSER_ID.test(v) ? v : null;
}

/** The stored form of a browser id: its SHA-256, hex. */
export function browserHash(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

/** The hash of this request's browser id, or null outside a request or without one. */
export function currentBrowserHash(): string | null {
  return store.getStore() ?? null;
}

/** Run `fn` with `id` (raw, unchecked) as the current request's browser (middleware and tests). */
export function runWithBrowserId<T>(id: string | string[] | undefined | null, fn: () => T): T {
  const parsed = parseBrowserId(id ?? undefined);
  return store.run(parsed ? browserHash(parsed) : null, fn);
}

/** Express-style middleware: scope the rest of the request to its browser. */
export function browserIdMiddleware() {
  return (req: IncomingMessage, _res: ServerResponse, next: () => void): void => {
    runWithBrowserId(req.headers[BROWSER_ID_HEADER], next);
  };
}
