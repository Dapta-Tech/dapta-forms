import { hostFetch } from '@/lib/auth-session';

/**
 * The scheduler step's event-type list, as a same-origin GET.
 *
 * This used to be a server action called from the panel's mount effect, and
 * the call was LOST on exactly one path: the scheduler step added from the
 * question gallery. The panel mounts in the same commit as the add, and a
 * server action dispatched synchronously from a passive effect in that commit
 * never reached the router's action queue: no request, no rejection, the
 * promise simply pending, and the panel on "Loading event types…" until the
 * author left the step and came back. The same call deferred by a zero-length
 * timeout went through, so this is a scheduling interaction inside the
 * framework, not a failure the caller can observe or retry around.
 *
 * A read has no business on the action queue anyway (serialised behind every
 * autosave), so like the CSV export and the unload flush, this route attaches
 * the session's identity via `hostFetch` and proxies the API's response as is.
 * It adds no authority beyond what the session already has.
 */
export async function GET(): Promise<Response> {
  const upstream = await hostFetch('/v1/integrations/calendly/event-types');
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
