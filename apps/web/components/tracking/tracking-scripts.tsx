import Script from 'next/script';
import { hasAnyTracking, type ResolvedTracking } from './resolve-tracking';

/**
 * Third-party tracking snippets for the PUBLIC form page only (never admin).
 * One component, four optional vendors — Google Tag Manager, Meta Pixel,
 * PostHog, HubSpot — each rendered ONLY when its resolved id is present, so a
 * deployment (or fork) with nothing configured produces zero third-party
 * requests. Ids arrive pre-resolved via {@link ResolvedTracking} (per-form
 * config over env, see resolve-tracking.ts).
 *
 * All snippets are inline `next/script` tags with `afterInteractive` (no
 * vendor npm packages) and are SSR-safe: nothing touches `window` during
 * render — next/script injects them client-side after hydration. Every tag
 * carries a `data-testid` (tracking-gtm / tracking-meta-pixel /
 * tracking-posthog / tracking-hubspot) so e2e can assert presence/absence.
 *
 * Anti-duplication (mirrors the pilot): Meta Pixel fires a single PageView on
 * init; PostHog is initialized with `capture_pageview: false` plus exactly one
 * manual `$pageview` (a public form is a single-route multi-step SPA — step
 * changes are not route changes, so one pageview per visit is correct).
 */

/**
 * Serialize a value for interpolation inside an inline JS snippet. JSON encoding
 * neutralizes quotes/backslashes; escaping `<` prevents `</script>` breakout.
 * Ids are loosely validated strings from form config/env — treat as data.
 *
 * Exported for `components/analytics/platform-gtm.tsx`, which inlines a snippet
 * of its own. ONE escaper for every inline script in the app, deliberately: a
 * second copy is a second thing to remember to fix, and the values it guards
 * against there come off a query string anyone can compose.
 *
 * Objects are accepted as well as strings — the platform snippet serializes a
 * whole `dataLayer` payload. `undefined` is not: `JSON.stringify` returns the
 * value `undefined` rather than a string, which would interpolate the bare word
 * into the snippet. Callers pass a value or skip the call.
 */
export function js(value: string | Record<string, string>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Standard GTM head snippet (inlined — the pilot's @next/third-parties dep is not ported). */
export function buildGtmSnippet(gtmId: string): string {
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(i)+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${js(gtmId)});`;
}

/** Meta Pixel bootstrap: fbq stub + init + a single PageView. */
export function buildMetaPixelSnippet(pixelId: string): string {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${js(pixelId)});fbq('track','PageView');`;
}

/**
 * PostHog JS snippet (vendor's documented loader stub) + init + one manual
 * `$pageview`. `capture_pageview: false` keeps posthog-js's automatic
 * history-change capture off so the manual capture is the only pageview.
 */
export function buildPosthogSnippet(key: string, host: string): string {
  return (
    `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);` +
    `posthog.init(${js(key)},{api_host:${js(host)},capture_pageview:false});` +
    `posthog.capture('$pageview');`
  );
}

/** HubSpot tracking-code loader URL for a portal id. */
export function buildHubspotSrc(portalId: string): string {
  return `https://js.hs-scripts.com/${encodeURIComponent(portalId)}.js`;
}

/**
 * Renders the enabled tracking snippets. Returns null (no markup, no
 * requests) when every tracker is off.
 */
export function TrackingScripts({ tracking }: { tracking: ResolvedTracking }) {
  if (!hasAnyTracking(tracking)) return null;
  return (
    <>
      {tracking.gtmId ? (
        <>
          <Script id="tracking-gtm" data-testid="tracking-gtm" strategy="afterInteractive">
            {buildGtmSnippet(tracking.gtmId)}
          </Script>
          <noscript data-testid="tracking-gtm-noscript">
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(tracking.gtmId)}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
              title="Google Tag Manager"
            />
          </noscript>
        </>
      ) : null}

      {tracking.metaPixelId ? (
        <>
          <Script
            id="tracking-meta-pixel"
            data-testid="tracking-meta-pixel"
            strategy="afterInteractive"
          >
            {buildMetaPixelSnippet(tracking.metaPixelId)}
          </Script>
          <noscript data-testid="tracking-meta-pixel-noscript">
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              alt=""
              src={`https://www.facebook.com/tr?id=${encodeURIComponent(tracking.metaPixelId)}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      ) : null}

      {tracking.posthogKey ? (
        <Script id="tracking-posthog" data-testid="tracking-posthog" strategy="afterInteractive">
          {buildPosthogSnippet(tracking.posthogKey, tracking.posthogHost)}
        </Script>
      ) : null}

      {tracking.hubspotTrackingId ? (
        // HubSpot's embed contract expects id="hs-script-loader" on the tag.
        <Script
          id="hs-script-loader"
          data-testid="tracking-hubspot"
          strategy="afterInteractive"
          src={buildHubspotSrc(tracking.hubspotTrackingId)}
        />
      ) : null}
    </>
  );
}
