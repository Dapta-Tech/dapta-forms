import Script from 'next/script';
import { attributionEventProps, attributionSchema } from '@quill/types';
import { buildGtmSnippet, js } from '@/components/tracking/tracking-scripts';

/**
 * Dapta's own Google Tag Manager container for PLATFORM pages — login,
 * onboarding, and the admin dashboard. The marketing site (daptaforms.com)
 * carries the same container, and mounting it here is what joins the two
 * domains into one funnel: landing → signup → onboarding → dashboard.
 *
 * Mounted from `app/login/page.tsx`, `app/onboarding/page.tsx` and
 * `app/admin/layout.tsx` ONLY. Public form pages must never load it: the
 * visitor there is a form owner's respondent, and the page may already carry
 * the OWNER's GTM container (see components/tracking/tracking-scripts.tsx) —
 * loading ours beside it would cross-fire both containers through the shared
 * `dataLayer` and file a customer's traffic under our marketing account.
 * That is also why the Script id differs from `tracking-gtm`: the two must
 * never deduplicate against each other.
 */
export const DAPTA_PLATFORM_GTM_ID = 'GTM-KXVQBMHD';

export type PlatformGtmEnv = Partial<
  Record<'NEXT_PUBLIC_PLATFORM_GTM_ID' | 'AUTH_PROVIDER', string | undefined>
>;

/**
 * Which container to load, if any. Resolved server-side at request time (every
 * mount point is a dynamic route), so the value is never baked into the bundle
 * — the prd build that once shipped a stale NEXT_PUBLIC_ value cannot repeat
 * here.
 *
 * The fallback is gated on `AUTH_PROVIDER=workos` — true for every Dapta
 * deployment, never for a bare fork — for the same reason the check exists at
 * all: a Dapta build must load Dapta's container even if the env var goes
 * missing, and a fork must keep making zero third-party requests. The check
 * mirrors `authProvider()` (lib/auth-session.ts) rather than importing it:
 * that module is `server-only`, which this component's node-run spec is not.
 */
export function resolvePlatformGtmId(
  env: PlatformGtmEnv = process.env as PlatformGtmEnv,
): string | null {
  // Server-only on purpose. In a client bundle `process.env` is empty — the
  // parameter object defeats Next's build-time inlining — so a client-side
  // call would silently resolve null: the exact no-op this resolver exists to
  // prevent. Fail loud instead; resolve in the page/layout and pass the id in.
  if (typeof window !== 'undefined') {
    throw new Error('resolvePlatformGtmId is server-only — pass the resolved id down as a prop.');
  }
  const configured = env.NEXT_PUBLIC_PLATFORM_GTM_ID?.trim();
  if (configured) return configured;
  return env.AUTH_PROVIDER === 'workos' ? DAPTA_PLATFORM_GTM_ID : null;
}

/**
 * The two tags whose `dataLayer` names do NOT match the stored field.
 *
 * The marketing container declares its variables once and reads them on both
 * domains, so these names are a CONTRACT with daptaforms.ai — which publishes
 * `first_touch_referrer` / `first_touch_path` to say plainly that they describe
 * the visit that started everything, not the page the tag fired on. Renaming
 * either side alone does not fail: the variable simply resolves undefined and
 * every tag reading it goes quiet.
 */
const DATALAYER_RENAMES: Record<string, string> = {
  referrer: 'first_touch_referrer',
  landing_path: 'first_touch_path',
};

/** Event name, shared with the server-side product-analytics capture. */
export const SIGNUP_DATALAYER_EVENT = 'forms_signup_completed';

/**
 * `Me.attribution` as `dataLayer` variables.
 *
 * These are FIRST-touch tags read back from `account.attribution`, not the query
 * string of the current URL — which is exactly the part GA4 cannot reconstruct on
 * its own here. The signup round-trip leaves our origin for the identity provider
 * and comes back with a bare URL and a third-party referrer, so by the time any
 * platform page renders, the campaign exists only in our own column.
 *
 * Returns `{}` — never keys with empty values — when there is nothing to say. A
 * blank `utm_source` in the layer is worse than an absent one: it overwrites a
 * value a previous push may have set, and reads in the container as "we know this
 * signup was untagged" rather than "we do not know".
 */
export function platformDataLayerVars(
  attribution: Record<string, string | number | null | undefined> | null | undefined,
): Record<string, string> {
  if (!attribution) return {};
  // Parse rather than trust: the value crosses the API as loose JSON, and
  // `attributionEventProps` promises a validated `Attribution`. A drifted row
  // yields `{}` here, which degrades to "no campaign" instead of injecting
  // whatever shape the column happens to hold into an inline script.
  const parsed = attributionSchema.safeParse(attribution);
  if (!parsed.success) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributionEventProps(parsed.data))) {
    out[DATALAYER_RENAMES[key] ?? key] = value;
  }
  return out;
}

/**
 * The `dataLayer` writes that must happen BEFORE the container boots.
 *
 * Ordering is the whole point, and it is why this is concatenated into the GTM
 * script tag rather than rendered as a sibling `<Script>`: a tag that fires on
 * container initialization reads the layer as it stands at that moment, so a push
 * that lands afterwards produces an event with no campaign on it — which is the
 * shape of the bug this fixes. Keeping both in one snippet makes the order a fact
 * of the string, not a behavior of the framework's script scheduler.
 *
 * Every interpolated value is escaped through `js()`. They originate in a query
 * string: `utm_source` is whatever the last person to compose a link typed, it is
 * stored verbatim, and it lands inside an inline `<script>`.
 */
export function buildPlatformPrelude(
  vars: Record<string, string>,
  signupAccountId?: string | null,
): string {
  let out = 'window.dataLayer=window.dataLayer||[];';
  if (Object.keys(vars).length > 0) out += `window.dataLayer.push(${js(vars)});`;
  if (signupAccountId) out += buildSignupEventSnippet(signupAccountId);
  return out;
}

/**
 * One `forms_signup_completed` per account, per browser.
 *
 * The wizard's first paint IS the moment the account came into being — it is the
 * first page a new workspace ever renders — but it is not a moment that happens
 * only once: a reload, or coming back tomorrow to an abandoned wizard, renders it
 * again. Hence the `localStorage` latch, which is the honest bound on this: it is
 * per browser, so the same person finishing signup on their phone would count
 * twice. Ad platforms de-duplicate conversions on their own side, and the
 * alternative — a server-side latch — cannot be read here: the cookie that would
 * carry it is httpOnly and a Server Component cannot clear it.
 *
 * A blocked `localStorage` (private mode) FIRES rather than stays silent. Given
 * the choice between a conversion counted twice and a real signup never counted,
 * the double is the recoverable one.
 */
function buildSignupEventSnippet(accountId: string): string {
  const key = `dapta_forms_signup:${accountId}`;
  return (
    `(function(w,k){try{if(w.localStorage.getItem(k))return;w.localStorage.setItem(k,'1')}catch(e){}` +
    `w.dataLayer.push({event:${js(SIGNUP_DATALAYER_EVENT)}})})(window,${js(key)});`
  );
}

/**
 * Renders the GTM loader + its no-JS iframe. Returns null when no container is
 * resolved (every bare fork) — no markup, no request, and with it no `dataLayer`
 * write either: a fork has no container to read one.
 *
 * `attribution` is the caller's `me.attribution`; `signupAccountId` is passed by
 * the ONE surface that represents a brand-new workspace (the wizard). The
 * dashboard passes the tags without it — an account signing in three years later
 * still wants its funnel sliced by campaign, and does not want a second signup.
 */
export function PlatformGtm({
  gtmId,
  attribution,
  signupAccountId,
}: {
  gtmId: string | null;
  attribution?: Record<string, string | number | null | undefined> | null;
  signupAccountId?: string | null;
}) {
  if (!gtmId) return null;
  const prelude = buildPlatformPrelude(platformDataLayerVars(attribution), signupAccountId);
  return (
    <>
      <Script id="platform-gtm" data-testid="platform-gtm" strategy="afterInteractive">
        {prelude + buildGtmSnippet(gtmId)}
      </Script>
      <noscript data-testid="platform-gtm-noscript">
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtmId)}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}
