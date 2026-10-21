import { NextResponse, type NextRequest } from 'next/server';
import { canonicalHop } from '@/lib/request-origin';

/**
 * Keeps the session pages and the session refresh on the `PUBLIC_APP_URL` host.
 *
 * After a domain move the old host keeps serving, but the session cookie is
 * host-only and the login only starts on `PUBLIC_APP_URL`. An old link to the
 * dashboard (an owner email, a bookmark) therefore rendered on a host with no
 * session, whose 401 sent the browser to `/api/auth/refresh`, whose failure
 * sent it to the logout route on `PUBLIC_APP_URL`: the person was signed out
 * of the canonical host, upstream session included, by opening a link.
 *
 * So a GET or HEAD for these paths on any other hostname is answered with a
 * 302 to the same path and query on `PUBLIC_APP_URL` before anything reads a
 * cookie (`canonicalHop` holds the rules: hostname only, case-insensitive, no
 * `PUBLIC_APP_URL` = no hop, the target never taken from a header).
 *
 * Here and not in the admin layout: a layout renders in parallel with its page
 * and under a streamed 200, so its redirect can lose the race to the page's
 * own 401 and is never a real HTTP redirect; and it would not cover the wizard
 * or the refresh route. The proxy answers first, with a real 302, and the
 * matcher keeps every other path (public forms, embeds, `/embed.js`, files,
 * `/api/public/*`, `/_next/*`, OG images, icons) from running it at all.
 *
 * The dashboard and the wizard hop browser navigations only: a request whose
 * `Sec-Fetch-Mode` is `navigate`, or one without fetch metadata (curl, an old
 * client). A `fetch()` from a tab opened on the old host before the move (the
 * router's page loads, a Server Action's follow-up render, the editor's own
 * GETs) cannot follow a cross-origin redirect anyway, so a hop would only break
 * it; it keeps working on the host it came from, like that tab's POSTs. It
 * cannot carry the canonical host's cookies either, so it cannot reach that
 * host's session. The refresh route hops always: it is nothing but session
 * logic, and on another host it could only end on a redirect to the canonical
 * host's logout.
 */
export function proxy(req: NextRequest): NextResponse {
  const fetchMode = req.headers.get('sec-fetch-mode');
  const navigation = fetchMode === null || fetchMode === 'navigate';
  if (!navigation && req.nextUrl.pathname !== '/api/auth/refresh') return NextResponse.next();

  const hop = canonicalHop(req);
  if (!hop) return NextResponse.next();
  // Next rewrites a proxy redirect aimed at the server's OWN listen address
  // into a relative Location, which the browser resolves against the host it
  // is already on: a loop. Only a local setup gets here (PUBLIC_APP_URL set to
  // the dev server's own address and the app opened under another name for it,
  // such as 127.0.0.1), and today's behavior is the right answer there.
  if (new URL(hop.headers.get('location')!).host === req.nextUrl.host) return NextResponse.next();
  return hop;
}

export const config = {
  // Exact paths: `/admin/:path*` is `/admin` and everything under it, the
  // wizard has no sub-pages (its `/onboarding/*.svg` logos are static files
  // that must keep loading anywhere), and the refresh is one route.
  matcher: ['/admin/:path*', '/onboarding', '/api/auth/refresh'],
};
