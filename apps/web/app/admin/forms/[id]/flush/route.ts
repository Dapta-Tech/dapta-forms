import type { NextRequest } from 'next/server';
import { hostFetch } from '@/lib/auth-session';

/**
 * Unload-flush proxy for the editors' last-gasp save (V5 stuck-"Saving…" fix).
 *
 * A hard tab close can't await a server action, so the editors fire a
 * `keepalive` fetch instead. That fetch used to go STRAIGHT to the API host —
 * which authenticates with identity headers minted from the httpOnly session
 * cookie (`Authorization: Bearer` / `x-quill-email`), headers client JS can
 * never attach. Every unload flush was a guaranteed 401; it also pinned the
 * API's absolute URL into the client bundle. This same-origin route carries
 * the session cookie like any admin page, attaches identity via `hostFetch`,
 * and forwards the write — so the flush finally lands, from the same origin.
 *
 * Body: `{ kind: 'config', name, config }` → PUT /v1/forms/:id
 *       `{ kind: 'destinations', destinations }` → PUT /v1/forms/:id/destinations
 * The API validates payloads and scopes the write to the session's account —
 * this proxy adds no authority beyond what the session already has.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  // Same-origin guard: browsers always send Origin on cross-origin POSTs, so a
  // mismatched value is a cross-site request riding the session cookie.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return Response.json({ ok: false }, { status: 403 });
  }

  const { id } = await ctx.params;
  // The id rides into the upstream path — reject anything that is not a plain
  // opaque token so an encoded `../` can never re-aim the identity-carrying PUT.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return Response.json({ ok: false }, { status: 400 });
  let body: {
    kind?: string;
    name?: string;
    config?: unknown;
    destinations?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const upstream =
      body.kind === 'destinations'
        ? await hostFetch(`/v1/forms/${id}/destinations`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ destinations: body.destinations }),
          })
        : await hostFetch(`/v1/forms/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: body.name, config: body.config }),
          });
    return Response.json({ ok: upstream.ok }, { status: upstream.ok ? 200 : upstream.status });
  } catch {
    // `hostFetch` redirects on 401 (throws) — the tab is closing anyway; a
    // plain status is all this best-effort path owes anyone.
    return Response.json({ ok: false }, { status: 401 });
  }
}
