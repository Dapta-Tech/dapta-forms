import type { FormTracking } from '@quill/types';

/**
 * Third-party tracking ids for the PUBLIC form page, fully resolved (per-form
 * config merged over deployment env defaults). `null` means "tracker off".
 * When every id is null the page renders no tracking markup at all — a bare
 * OSS fork with nothing configured makes zero third-party requests.
 */
export interface ResolvedTracking {
  /** Google Tag Manager container id (GTM-XXXXXXX). */
  gtmId: string | null;
  /** Meta (Facebook) Pixel id. */
  metaPixelId: string | null;
  /** PostHog project API key. */
  posthogKey: string | null;
  /** PostHog ingestion host; only used when `posthogKey` is set. */
  posthogHost: string;
  /** HubSpot tracking code portal id. */
  hubspotTrackingId: string | null;
}

/** PostHog US cloud — the vendor's documented default ingestion host. */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/** Environment shape — injectable so the merge stays a pure, testable function. */
export type TrackingEnv = Partial<
  Record<
    | 'NEXT_PUBLIC_GTM_ID'
    | 'NEXT_PUBLIC_META_PIXEL_ID'
    | 'NEXT_PUBLIC_POSTHOG_KEY'
    | 'NEXT_PUBLIC_POSTHOG_HOST'
    | 'NEXT_PUBLIC_HUBSPOT_TRACKING_ID',
    string | undefined
  >
>;

/** Normalize a candidate id: trim; empty/blank/null/undefined -> null (off). */
function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Merge a form's `config.tracking` over the deployment's env defaults.
 * Precedence per id: form config -> NEXT_PUBLIC_* env -> off. Runs in the
 * Server Component (env is read at request time, server-side), so nothing
 * here touches `window`.
 */
export function resolveTracking(
  config?: FormTracking | null,
  // Cast: ProcessEnv only has an index signature, which TypeScript's weak-type
  // check rejects against the all-optional TrackingEnv despite being compatible.
  env: TrackingEnv = process.env as TrackingEnv,
): ResolvedTracking {
  return {
    gtmId: clean(config?.gtmId) ?? clean(env.NEXT_PUBLIC_GTM_ID),
    metaPixelId: clean(config?.metaPixelId) ?? clean(env.NEXT_PUBLIC_META_PIXEL_ID),
    posthogKey: clean(config?.posthogKey) ?? clean(env.NEXT_PUBLIC_POSTHOG_KEY),
    posthogHost:
      clean(config?.posthogHost) ?? clean(env.NEXT_PUBLIC_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST,
    hubspotTrackingId:
      clean(config?.hubspotTrackingId) ?? clean(env.NEXT_PUBLIC_HUBSPOT_TRACKING_ID),
  };
}

/** True when at least one tracker is enabled (the page renders markup at all). */
export function hasAnyTracking(tracking: ResolvedTracking): boolean {
  return Boolean(
    tracking.gtmId || tracking.metaPixelId || tracking.posthogKey || tracking.hubspotTrackingId,
  );
}
