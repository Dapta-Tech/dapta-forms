import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { serverApiUrl } from '@/lib/api-url';
import { getSession, hostHeaders, refreshUpstreamSession, setSession } from '@/lib/auth-session';
import { asPlaybookLocale, isPlaybookSlug, playbookPdfFileName, type PlaybookContentLocale } from '@/lib/playbooks';
import { canonicalHop, requestOrigin } from '@/lib/request-origin';
import { withNextPath } from '@/lib/return-path';

export const dynamic = 'force-dynamic';

/** On every answer: nothing here is cached or indexed. */
const BASE_HEADERS = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
} as const;

/**
 * The PDF of one playbook, for someone signed in.
 *
 * The files live outside `public/` (`assets/playbooks-pdf/<locale>/<slug>.pdf`,
 * traced into the standalone build by `next.config.mjs`) and this handler is
 * the only way to one. It asks the API for the playbook as the caller: that one
 * answer says whether the session is still good, whether the slug is a
 * published playbook, and in which language it comes (the Spanish one when it
 * has no version in the language asked for).
 *
 * Without a session the person is sent to sign in and back to the playbook,
 * where the download starts on its own (`?pdf=1`). The button and the
 * automatic download are plain navigations, so that redirect is followed.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  // Sessions live on PUBLIC_APP_URL; no cookie is read or rotated elsewhere.
  const hop = canonicalHop(req);
  if (hop) return hop;

  const { slug } = await ctx.params;
  const lang = asPlaybookLocale(new URL(req.url).searchParams.get('lang'));
  if (!isPlaybookSlug(slug) || !lang) return failure(404);

  let res = await askPlaybook(slug, lang);
  if (res?.status === 401) {
    // An expired access token is not a signed-out person: trade the refresh
    // token once, like `hostFetch` does, and ask again.
    const refreshed = await refreshUpstreamSession(await getSession());
    if (refreshed) {
      await setSession(refreshed);
      res = await askPlaybook(slug, lang);
    }
  }
  const page = `/admin/playbooks/${slug}?lang=${lang}`;
  if (res?.status === 401) return redirectTo(req, withNextPath('/api/auth/login', `${page}&pdf=1`));
  // The chosen workspace is no longer theirs: the dashboard page puts that right.
  if (res?.status === 403) return redirectTo(req, page);
  if (res?.status === 404) return failure(404);
  if (!res?.ok) return failure(502);

  const body = (await res.json().catch(() => null)) as { playbook?: { locale?: string } } | null;
  const locale = asPlaybookLocale(body?.playbook?.locale);
  if (!locale) return failure(502);

  // `slug` and `locale` are checked shapes, so neither can leave the folder.
  const root = join(/* turbopackIgnore: true */ process.cwd(), 'assets', 'playbooks-pdf');
  const file = await readFile(join(root, locale, `${slug}.pdf`)).catch(() => null);
  if (!file) return failure(404);

  return new NextResponse(new Uint8Array(file), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${playbookPdfFileName(slug, locale)}"`,
      'content-length': String(file.byteLength),
      'x-content-type-options': 'nosniff',
    },
  });
}

/** The playbook as this caller may read it, or null when the API is unreachable. */
async function askPlaybook(slug: string, locale: PlaybookContentLocale): Promise<Response | null> {
  return fetch(`${serverApiUrl}/v1/me/playbooks/${slug}?locale=${locale}`, {
    headers: await hostHeaders(),
    cache: 'no-store',
  }).catch(() => null);
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, requestOrigin(req)), { status: 302, headers: BASE_HEADERS });
}

function failure(status: 404 | 502): NextResponse {
  return NextResponse.json(
    { error: status === 404 ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE' },
    { status, headers: BASE_HEADERS },
  );
}
