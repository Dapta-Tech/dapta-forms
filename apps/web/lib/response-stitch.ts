import { PH_ID_QUERY_KEY } from './attribution';

/**
 * Hands the response's analytics id to the deployment's OWN landing when a
 * form redirects there, so the server's `forms_response_completed` and the
 * landing's pageview share one person and a funnel can run across both.
 *
 * Only the landing's host (`NEXT_PUBLIC_LANDING_URL`) and its `www.` twin get
 * the id, under the same `ph_id` key the landing already hands to the app. A
 * redirect anywhere else, which is every customer's own site, comes back
 * byte-identical, and so does every redirect on a deployment with no landing
 * configured (a bare fork). The id is random and says nothing about the
 * response: it is not the row id and carries no answer.
 */

/** The hosts that may receive the id: the landing's, with and without `www.`. */
export function stitchHosts(landingUrl: string | null | undefined): string[] {
  if (!landingUrl) return [];
  let host: string;
  try {
    host = new URL(landingUrl).host.toLowerCase();
  } catch {
    return [];
  }
  if (!host) return [];
  const apex = host.startsWith('www.') ? host.slice(4) : host;
  return [apex, `www.${apex}`];
}

/**
 * `url` with `ph_id=<analyticsId>` added when it points at the landing, else
 * `url` unchanged. An id already in the URL is left alone, as is a URL that
 * does not parse.
 */
export function stitchRedirect(
  url: string,
  analyticsId: string | null | undefined,
  landingUrl: string | null | undefined = process.env.NEXT_PUBLIC_LANDING_URL,
): string {
  if (!analyticsId) return url;
  const hosts = stitchHosts(landingUrl);
  if (hosts.length === 0) return url;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return url;
  if (!hosts.includes(parsed.host.toLowerCase())) return url;
  if (parsed.searchParams.has(PH_ID_QUERY_KEY)) return url;
  parsed.searchParams.set(PH_ID_QUERY_KEY, analyticsId);
  return parsed.toString();
}
