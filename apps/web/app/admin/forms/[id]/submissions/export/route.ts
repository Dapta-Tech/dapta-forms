import type { NextRequest } from 'next/server';
import { hostFetch } from '@/lib/auth-session';

/**
 * CSV export proxy. The API's `/submissions.csv` needs the caller's identity
 * headers, which live in the httpOnly session cookie — a plain `<a download>` to
 * the API can't carry them. This server route attaches identity via `hostFetch`
 * and streams the CSV straight back (no buffering), preserving the filter query.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const search = req.nextUrl.searchParams.toString();
  const upstream = await hostFetch(`/v1/forms/${id}/submissions.csv${search ? `?${search}` : ''}`);

  if (!upstream.ok || !upstream.body) {
    return new Response('Export failed.', { status: upstream.status || 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition':
        upstream.headers.get('content-disposition') ?? 'attachment; filename="submissions.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
