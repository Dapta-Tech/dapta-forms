import Script from 'next/script';
import { buildGtmSnippet } from '@/components/tracking/tracking-scripts';

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
 * Renders the GTM loader + its no-JS iframe. Returns null when no container is
 * resolved (every bare fork) — no markup, no request.
 */
export function PlatformGtm({ gtmId }: { gtmId: string | null }) {
  if (!gtmId) return null;
  return (
    <>
      <Script id="platform-gtm" data-testid="platform-gtm" strategy="afterInteractive">
        {buildGtmSnippet(gtmId)}
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
