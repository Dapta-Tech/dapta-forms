import { NextResponse, type NextRequest } from 'next/server';
import { serverApiUrl } from '@/lib/api-url';
import { getSession, hostHeaders, refreshUpstreamSession, setSession } from '@/lib/auth-session';
import { requestOrigin } from '@/lib/request-origin';
import { buildSkillFiles, SKILL_ZIP_NAME } from '@/lib/developer-skill/skill-files';
import { publicApiUrl } from '@/lib/developer-skill/public-api-url';
import { createZip } from '@/lib/developer-skill/zip';

/**
 * The dForms API skill as a zip, built for the environment it is downloaded
 * from: the API and dashboard addresses are written into the files here, at
 * request time, because the repository may not carry a real host.
 *
 * Signed-in members only. A cookie alone is not enough: it must still be one
 * the API accepts, so a session that was revoked or expired answers 401 too.
 * The archive holds no secret (the key is never in it), but the Developers page
 * is the only door to it and that door is behind a login.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  let me = await whoAmI();
  if (me?.status === 401) {
    // An expired access token is not a signed-out member: trade the refresh
    // token once, like `hostFetch` does, and ask again. Without this, a click
    // on the download long after the page loaded answered 401 to someone the
    // dashboard still shows as signed in.
    const refreshed = await refreshUpstreamSession(session);
    if (refreshed) {
      await setSession(refreshed);
      me = await whoAmI();
    }
  }
  if (me?.status === 401) return unauthorized();
  if (me?.status === 403) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'You are not a member of this workspace any more.' },
      { status: 403, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (!me?.ok) {
    return NextResponse.json(
      { error: 'UPSTREAM_UNAVAILABLE', message: 'Could not confirm your session. Try again.' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }

  const apiUrl = publicApiUrl();
  if (!apiUrl) {
    return NextResponse.json(
      { error: 'API_URL_NOT_CONFIGURED', message: 'This deployment has no public API address configured.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
  // PUBLIC_APP_URL first, request headers only as a self-host fallback: the
  // same trust order every other absolute link in the web app uses.
  const appUrl = requestOrigin(request);

  const zip = createZip(buildSkillFiles({ apiUrl, appUrl }));
  return new NextResponse(zip, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${SKILL_ZIP_NAME}"`,
      'content-length': String(zip.byteLength),
      'cache-control': 'no-store',
    },
  });
}

/** The API's answer to "who is this session?", or null when it is unreachable. */
async function whoAmI(): Promise<Response | null> {
  return fetch(`${serverApiUrl}/v1/me`, {
    headers: await hostHeaders(),
    cache: 'no-store',
  }).catch(() => null);
}

function unauthorized() {
  return NextResponse.json(
    { error: 'UNAUTHENTICATED', message: 'Sign in to download the skill.' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}
