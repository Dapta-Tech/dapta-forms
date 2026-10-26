import { getPublicLinkPage } from '@/lib/api';
import { linkPageCardResponse } from '@/lib/link-page-og';
import { plausibleAccountCode } from '@/lib/public-page';

/** The default link page's share card (`/{accountCode}`); drawn by `linkPageCardResponse`. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ accountCode: string }> },
): Promise<Response> {
  const { accountCode } = await ctx.params;
  return linkPageCardResponse(plausibleAccountCode(accountCode) ? await getPublicLinkPage(accountCode) : null);
}
