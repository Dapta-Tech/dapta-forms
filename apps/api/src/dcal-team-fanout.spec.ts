/**
 * The dCal picker asks every team for its event types AT ONCE.
 *
 * In sequence, each call with its own timeout, the worst case was the sum of
 * every team's timeout, far past the builder's own abort. Asked in parallel,
 * the worst case is one timeout whatever the number of teams.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEnv } from '@quill/config/env';
import { DcalService } from './dcal.service';

const env = {
  DCAL_API_BASE_URL: 'http://dcal.internal',
  DCAL_APP_URL: 'https://book.example',
} as unknown as ServerEnv;

describe('DcalService team fan-out', () => {
  it('asks every team at the same time and merges their event types', async () => {
    let inFlight = 0;
    let peak = 0;
    const teams = [1, 2, 3, 4, 5].map((n) => ({ id: `t${n}`, slug: `team-${n}`, name: `Team ${n}` }));
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/me') return json({ accountShortCode: 'acme', handle: 'sam' });
      if (path === '/v1/event-types') return json([]);
      if (path === '/v1/teams') return json(teams);
      if (path === '/v1/me/workspaces') return json([]);
      const team = /\/v1\/teams\/(t\d)\/event-types/.exec(path)?.[1];
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return json([{ id: `e-${team}`, slug: 'demo', name: `Demo ${team}`, length: 30 }]);
    }) as unknown as typeof fetch;

    const out = await new DcalService(env, fetchImpl).listEventTypes('a1', 'm1', 'bearer');

    expect(peak).toBe(teams.length);
    if (!out.enabled) throw new Error('expected event types');
    expect(out.eventTypes.map((e) => e.schedulingUrl)).toEqual(
      teams.map((t) => `https://book.example/acme/team/${t.slug}/demo`),
    );
  });
});
