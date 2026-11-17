/**
 * Why the dCal picker has no list, kept as a code the builder can word.
 *
 * Every refusal used to reach the builder as the same `{ enabled: false }`
 * and read "dCal is not available on this deployment", which is true of one
 * cause only. An author whose session dCal refused, who has no booking page
 * yet, or who caught dCal down, was sent looking for an operator.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEnv } from '@quill/config/env';
import { DcalService } from './dcal.service';

const env = {
  DCAL_API_BASE_URL: 'http://dcal.internal',
  DCAL_APP_URL: 'https://book.example/',
} as unknown as ServerEnv;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A dCal whose `/v1/me` answers `me`; every other read answers an empty list. */
const dcal = (me: () => Response | Promise<Response>) =>
  (async (input: string | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/me') return me();
    return json([]);
  }) as unknown as typeof fetch;

const list = (fetchImpl: typeof fetch, e: ServerEnv = env, bearer: string | null = 'bearer') =>
  new DcalService(e, fetchImpl).listEventTypes('a1', 'm1', bearer);

describe('DcalService: why there is no list', () => {
  it('says not_configured on a deployment without dCal', async () => {
    const out = await list(dcal(() => json({})), {} as ServerEnv);
    expect(out).toMatchObject({ enabled: false, code: 'not_configured' });
  });

  it('says no_session when there is no session to forward', async () => {
    expect(await list(dcal(() => json({})), env, null)).toMatchObject({ enabled: false, code: 'no_session' });
  });

  it('says session_rejected when dCal refuses the session', async () => {
    for (const status of [401, 403]) {
      expect(await list(dcal(() => json({ error: 'no' }, status)))).toMatchObject({
        enabled: false,
        code: 'session_rejected',
      });
    }
  });

  it('says dcal_error when dCal errors or does not answer', async () => {
    expect(await list(dcal(() => json({}, 503)))).toMatchObject({ enabled: false, code: 'dcal_error' });
    expect(
      await list(
        dcal(() => {
          throw new Error('connect ECONNREFUSED');
        }),
      ),
    ).toMatchObject({ enabled: false, code: 'dcal_error' });
  });

  it('says no_booking_page, with where to set one up, when dCal knows the author but has no page', async () => {
    const out = await list(dcal(() => json({ email: 'sam@example.com' })));
    expect(out).toMatchObject({
      enabled: false,
      code: 'no_booking_page',
      setupUrl: 'https://book.example/admin',
    });
  });

  it('still lists when dCal answers in full', async () => {
    const out = await list(dcal(() => json({ accountShortCode: 'acme', handle: 'sam' })));
    expect(out.enabled).toBe(true);
  });
});
