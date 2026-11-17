import { getPublicLinkPageBySlug } from '@/lib/api';
import { linkPageCardResponse } from '@/lib/link-page-og';
import { plausibleAccountCode, plausiblePageSlug } from '@/lib/public-page';

/** The share card of one of a workspace's other pages (`/{accountCode}/p/{pageSlug}`). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ accountCode: string; pageSlug: string }> },
): Promise<Response> {
  const { accountCode, pageSlug } = await ctx.params;
  const ok = plausibleAccountCode(accountCode) && plausiblePageSlug(pageSlug);
  return linkPageCardResponse(ok ? await getPublicLinkPageBySlug(accountCode, pageSlug) : null);
}
