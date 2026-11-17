import { hostFetch } from '@/lib/auth-session';

/**
 * The scheduler step's dCal event-type list, as a same-origin GET.
 *
 * Same shape and the same reasons as the Calendly route beside it: a read has
 * no business on the server-action queue (serialised behind every autosave),
 * and a server action dispatched from the panel's mount effect was lost on the
 * one path where the step had just been added from the gallery.
 *
 * Two query params are forwarded, and nothing else: `workspaceId` (the
 * picker's workspace switcher) and `refresh` (drop the cached list, which is
 * what the empty state's refresh asks for after the author went to dCal and
 * created an event). The session's identity is attached by `hostFetch`; this
 * route adds no authority of its own.
 */
export async function GET(request: Request): Promise<Response> {
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const workspaceId = incoming.get('workspaceId')?.trim();
  if (workspaceId) query.set('workspaceId', workspaceId);
  if (incoming.get('refresh') === '1') query.set('refresh', '1');
  const suffix = query.size > 0 ? `?${query.toString()}` : '';

  const upstream = await hostFetch(`/v1/integrations/dcal/event-types${suffix}`);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
