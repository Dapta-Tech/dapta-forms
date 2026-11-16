/**
 * Whether the Connections page shows dCal, and where its button sends the
 * author. The same rule as `DcalService.configured()`: both hosts, or nothing.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEnv } from '@quill/config/env';
import { dcalCreateEventUrl } from './dcal.service';

const env = (over: Partial<ServerEnv>) => over as ServerEnv;

describe('dcalCreateEventUrl', () => {
  it('points at the app host when both dCal hosts are set', () => {
    expect(
      dcalCreateEventUrl(env({ DCAL_API_BASE_URL: 'http://api.internal', DCAL_APP_URL: 'https://book.example/' })),
    ).toBe('https://book.example/admin/event-types');
  });

  it('is null with either host missing, so the card is left out', () => {
    expect(dcalCreateEventUrl(env({ DCAL_APP_URL: 'https://book.example' }))).toBeNull();
    expect(dcalCreateEventUrl(env({ DCAL_API_BASE_URL: 'http://api.internal' }))).toBeNull();
    expect(dcalCreateEventUrl(undefined)).toBeNull();
  });
});
