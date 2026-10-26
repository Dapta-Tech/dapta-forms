import { relayLinkPageEvent } from '@/lib/link-page-events-relay';

/** A view of, or a click on, the workspace's default link page. See `relayLinkPageEvent`. */
export async function POST(req: Request, ctx: { params: Promise<{ accountCode: string }> }): Promise<Response> {
  return relayLinkPageEvent(req, (await ctx.params).accountCode, null);
}
