import 'server-only';
import type { OnboardingCohort } from '@quill/types';
import { getSession } from './auth-session';

/**
 * Did this person already answer Dapta AI's onboarding?
 *
 * Forms and Dapta AI share an identity: `member.external_id` is the `sub` of the
 * IAM-minted JWT, and the IAM translates WorkOS ids before signing — so that
 * value IS the Dapta `user.id`. Which means Forms can ask "do we already know
 * this person?" with an id it already stores, and no integration to build.
 *
 * This runs in the WEB, not the API, and that is deliberate rather than
 * incidental: `IAM_BASE_URL` is already in the web's environment (the login and
 * logout routes read it), while the API has never needed it. Probing from the
 * API would mean a configmap change owned by another team, for a lookup the web
 * can do on the request it is already serving.
 */

/** The shape the IAM answers with. Everything past the two flags is unused here. */
interface DaptaOnboardingStatus {
  has_completed_onboarding?: boolean;
  is_migrated_user?: boolean;
}

/**
 * How long to wait before giving up.
 *
 * This sits in front of the wizard's FIRST paint, so the budget is a UX number,
 * not a network one. Past this the answer stops being worth its latency and the
 * fallback below takes over.
 */
const PROBE_TIMEOUT_MS = 800;

/**
 * The Dapta `user.id` behind the current session, or null.
 *
 * Read from the `sub` of the IAM-minted access token the session already holds,
 * rather than from a new field on `/v1/me`. The claim is the same value either
 * way — the API's own WorkOS adapter stores that `sub` as `member.external_id` —
 * and taking it from the cookie keeps the Dapta user id off the API contract
 * entirely.
 *
 * Decoded, NOT verified, and that is safe for exactly this use: the token comes
 * out of our own httpOnly, HMAC-signed session cookie, and the only thing this
 * value decides is WHICH QUESTIONS TO SHOW. It grants nothing. Every request
 * that actually reads or writes data still carries the token to the API, which
 * verifies it properly — that authority is not moved here.
 */
async function daptaUserId(): Promise<string | null> {
  const session = await getSession();
  if (session?.provider !== 'workos') return null;
  const payload = session.accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof claims.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

/** The cohort for whoever is signed in right now. */
export async function currentOnboardingCohort(): Promise<OnboardingCohort> {
  return resolveOnboardingCohort(await daptaUserId());
}

/**
 * Which set of questions this person gets.
 *
 * Answers `'dapta'` — the SHORT path — for anyone who completed Dapta's
 * onboarding or was migrated into it. `is_migrated_user` matters as much as the
 * completion flag: a migrated customer is a customer, whether or not they ever
 * walked through `pre_signup`.
 *
 * FAILS CLOSED on a FAILURE. A timeout, a 500, a DNS blip, a member with no
 * external id — every one of those resolves to `'dapta'`, the cohort that gets
 * asked LESS. The asymmetry is the point: guessing "cold" on a failure would let
 * a few seconds of IAM latency ask Dapta's entire customer base for a phone
 * number they already gave, which is the exact experience this probe exists to
 * prevent. Guessing "dapta" costs three unasked questions.
 *
 * NO IAM CONFIGURED IS NOT A FAILURE. A self-hosting fork, or `pnpm dev`, has no
 * Dapta behind it at all — nobody there can be arriving from a product the
 * deployment does not know about, so everyone is cold and gets the full wizard.
 * Folding that into the failure case would give a bare clone the short path and
 * make three of the five screens unreachable in local development.
 */
export async function resolveOnboardingCohort(
  externalId: string | null | undefined,
): Promise<OnboardingCohort> {
  const base = process.env.IAM_BASE_URL?.replace(/\/$/, '');
  // No upstream identity service → no cross-sell cohort to protect.
  if (!base) return 'cold';
  // Configured, but this member has no id to look up. Anomalous in a deployment
  // that has an IAM, so treat it as the failure it probably is.
  if (!externalId) return 'dapta';

  try {
    const res = await fetch(`${base}/onboarding/status/${encodeURIComponent(externalId)}`, {
      // The endpoint is key-gated. Sent only when configured: without the key
      // the IAM answers 401, `!res.ok` fails closed to 'dapta', and nothing
      // leaks — the header line just isn't worth a conditional shape.
      headers: process.env.IAM_API_KEY ? { 'x-api-key': process.env.IAM_API_KEY } : undefined,
      // `no-store`: the answer is per-person and changes the screen they see.
      // A cached verdict would hand the next signup the previous one's cohort.
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return 'dapta';
    const status = (await res.json()) as DaptaOnboardingStatus;
    return status.has_completed_onboarding || status.is_migrated_user ? 'dapta' : 'cold';
  } catch {
    // Includes the timeout. Nothing here is worth failing a page load over — the
    // wizard still works, it just asks less.
    return 'dapta';
  }
}
