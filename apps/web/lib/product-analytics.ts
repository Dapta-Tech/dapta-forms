/**
 * PRODUCT ANALYTICS — this deployment's own telemetry about the people who USE
 * Dapta Forms (the admin dashboard), resolved from env and driven from the
 * browser.
 *
 * Not to be confused with `components/tracking/` — that renders the marketing
 * pixels a form OWNER configures on their own PUBLIC form page to measure THEIR
 * respondents. Different audience, different keys, different surface. This
 * module never runs on a public form page; respondents are not our users and
 * are never captured here.
 *
 * Zero new dependencies: the vendor's documented loader stub is inlined the
 * same way `tracking-scripts.tsx` does it, rather than pulling `posthog-js`
 * into an open-source repo for a feature that ships OFF.
 */

/** Vendor default ingestion host, used when nothing is configured. */
export const DEFAULT_ANALYTICS_HOST = 'https://us.i.posthog.com';

/**
 * Every event name this product emits carries this prefix — the browser half of
 * the same rule the API enforces in `AnalyticsEffects`. Telemetry lands in an
 * analytics project SHARED with the rest of Dapta, so an unprefixed name would
 * silently merge with another product's event of the same name.
 */
const EVENT_PREFIX = 'forms_';

/** Resolved browser-side analytics config. `key: null` means "off". */
export interface ResolvedProductAnalytics {
  /** Write-only ingestion key; null = analytics disabled, render nothing. */
  key: string | null;
  host: string;
}

/** Environment shape — injectable so the resolve stays a pure, testable function. */
export type ProductAnalyticsEnv = Partial<
  Record<'NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY' | 'NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST', string | undefined>
>;

/** Who the events are about. Mirrors the fields `/v1/me` already returns. */
export interface AnalyticsIdentity {
  /** The member's email — the distinct id, shared with the rest of Dapta. */
  email: string | null;
  memberId: string;
  accountId: string;
  accountCode: string;
  role: string;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read the deployment's analytics config. Runs in a Server Component (env is
 * read at request time, server-side), so nothing here touches `window`.
 */
export function resolveProductAnalytics(
  // Cast: ProcessEnv only has an index signature, which TypeScript's weak-type
  // check rejects against the all-optional env type despite being compatible.
  env: ProductAnalyticsEnv = process.env as ProductAnalyticsEnv,
): ResolvedProductAnalytics {
  return {
    key: clean(env.NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY),
    host: clean(env.NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST) ?? DEFAULT_ANALYTICS_HOST,
  };
}

/**
 * Serialize a value for interpolation into an inline JS snippet. JSON encoding
 * neutralizes quotes/backslashes; escaping `<` prevents `</script>` breakout.
 */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The vendor loader stub + init for the ADMIN dashboard.
 *
 * `capture_pageview` is left ON (unlike the public form page, which is a
 * single-route multi-step SPA where one manual pageview is correct). The admin
 * is a genuine multi-route app: every navigation is a real page and its own
 * event, which is what makes "what does this account actually use" answerable
 * without instrumenting a single screen.
 *
 * `person_profiles: 'always'` so a member gets a person record even before
 * their first identified event, keeping the pre-login part of the session
 * attached to them.
 */
export function buildAnalyticsSnippet(key: string, host: string): string {
  return (
    `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);` +
    `posthog.init(${js(key)},{api_host:${js(host)},person_profiles:'always'});`
  );
}

/**
 * The minimal slice of the vendor's browser API this app calls. Typed by hand
 * because the loader stub installs `window.posthog` — there is no npm package
 * to import types from, and every method here exists on the stub's queue so it
 * is safe to call before the real script finishes loading.
 */
interface PosthogBrowser {
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  register(properties: Record<string, unknown>): void;
  group(type: string, key: string, properties?: Record<string, unknown>): void;
  capture(event: string, properties?: Record<string, unknown>): void;
  reset(): void;
}

function client(): PosthogBrowser | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { posthog?: PosthogBrowser }).posthog ?? null;
}

/**
 * Attach the identity to the current browser session.
 *
 * Three calls, each load-bearing:
 *
 *  - `identify(email)` — EMAIL, not member id, and deliberately so. The Dapta
 *    admin panel identifies people by email too, so a Dapta user who arrives at
 *    Forms is ONE person across both products and the "saw Forms in the admin
 *    panel → signed up" funnel is answerable at all. Keying on member id would
 *    make the same human two unrelated people.
 *  - `register(...)` — SUPER properties, merged into every event automatically,
 *    including the ones the vendor captures on its own (pageviews, clicks). The
 *    alternative (attaching them per manual capture) leaves autocaptured events
 *    unattributed, so "what did this account do" silently excludes most of the
 *    activity.
 *  - `group('forms_account', ...)` — activation belongs to a WORKSPACE, not a
 *    person. Without a group, account-level funnels can only be approximated by
 *    filtering a property. `forms_account` rather than `account` keeps our id
 *    space from colliding with another Dapta product's in the shared project.
 */
export function identifyMember(identity: AnalyticsIdentity): void {
  const ph = client();
  if (!ph || !identity.email) return;
  ph.identify(identity.email, {
    member_id: identity.memberId,
    account_id: identity.accountId,
    role: identity.role,
  });
  ph.register({
    product: 'forms',
    account_id: identity.accountId,
    account_code: identity.accountCode,
    member_id: identity.memberId,
    role: identity.role,
  });
  ph.group('forms_account', identity.accountId, { account_code: identity.accountCode });
}

/**
 * Emit one product-analytics event. The `forms_` prefix is added here, never at
 * the call site. A no-op when analytics is off or the script has not loaded —
 * telemetry never throws into a user-facing path.
 */
export function captureEvent(event: string, properties?: Record<string, unknown>): void {
  client()?.capture(`${EVENT_PREFIX}${event}`, properties);
}

/**
 * Drop the current identity. MUST run on logout: without it the next person to
 * use this browser inherits the previous member's distinct id and their events
 * are silently attributed to someone else.
 */
export function resetAnalytics(): void {
  client()?.reset();
}
