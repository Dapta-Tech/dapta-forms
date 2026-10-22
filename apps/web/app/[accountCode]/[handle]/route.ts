import { NextResponse } from 'next/server';
import { isReservedPublicSlug } from '@quill/engine';
import { plausibleAccountCode } from '@/lib/public-page';

/**
 * The old per-member page, `/{accountCode}/{handle}`, now lands on the
 * workspace's link page with a real 308.
 *
 * A route handler and not a page: a page streams before it can redirect, so
 * Next answers a page's `permanentRedirect` with a 200 and a meta refresh. A
 * handler answers before anything renders. Only this exact depth is handled
 * here; the form routes below it (`/{accountCode}/{handle}/{slug}` and the
 * neutral `/{accountCode}/f/{slug}`) are separate segments and do not pass
 * through this file.
 *
 * A two-segment path whose first segment is a static route of the app
 * (`/admin/<typo>`, `/login/x`, `/preview/x`, `/onboarding/x`) falls through
 * to this handler too, because the static folder has no page at that depth.
 * Those are a 404, never a redirect: a 308 is cached by the browser for good,
 * and nobody's workspace lives at `/admin`. The same goes for anything that
 * cannot be a workspace code at all.
 *
 * Every other handle redirects, known or not, without asking the API: the
 * member pages are gone, so the workspace page (or its 404) is the answer for
 * all of them. The query string rides along, so a campaign's UTMs survive.
 */
function workspaceRedirect(req: Request, accountCode: string): Response {
  if (!plausibleAccountCode(accountCode) || isReservedPublicSlug(accountCode)) {
    return new Response(null, { status: 404 });
  }
  const url = new URL(req.url);
  // Relative Location: resolved against the host the visitor is already on,
  // and the segment is re-encoded so no visitor input can bend the header.
  const location = `/${encodeURIComponent(accountCode)}${url.search}`;
  return new NextResponse(null, { status: 308, headers: { location } });
}

type Ctx = { params: Promise<{ accountCode: string; handle: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return workspaceRedirect(req, (await ctx.params).accountCode);
}

export async function HEAD(req: Request, ctx: Ctx): Promise<Response> {
  return workspaceRedirect(req, (await ctx.params).accountCode);
}
