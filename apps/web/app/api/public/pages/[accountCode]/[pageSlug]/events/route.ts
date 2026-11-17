import { relayLinkPageEvent } from '@/lib/link-page-events-relay';
import { plausiblePageSlug } from '@/lib/public-page';

/** A view of, or a click on, one of the workspace's other link pages. See `relayLinkPageEvent`. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ accountCode: string; pageSlug: string }> },
): Promise<Response> {
  const { accountCode, pageSlug } = await ctx.params;
  if (!plausiblePageSlug(pageSlug)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  return relayLinkPageEvent(req, accountCode, pageSlug);
}
