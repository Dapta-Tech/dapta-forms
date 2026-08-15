/**
 * `saveMyProfileAction` is the only authority the public page screen has over
 * what is stored: the browser cannot see the member row, so whatever this
 * returns is what the switch and the "View page" link render. A bare `ok: true`
 * left the screen reconciling against the boolean it had just sent — fine while
 * saves succeed, wrong the moment one is refused. Success therefore carries the
 * persisted profile back, the same contract `saveNotificationAction` already
 * uses for a notification setting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberProfile } from '@quill/types';

const saveMyProfile = vi.fn();
const myProfile = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    saveMyProfile: (...a: unknown[]) => saveMyProfile(...a),
    myProfile: (...a: unknown[]) => myProfile(...a),
  },
  ApiError: class ApiError extends Error {},
  isAdminRole: () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));

import { myProfileAction, saveMyProfileAction } from './actions';

const profile: MemberProfile = {
  version: 1,
  enabled: true,
  headline: 'Growth partner',
  bio: null,
};

describe('saveMyProfileAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hands back the profile the API says it stored, not the request', async () => {
    // The API's copy differs from what was sent (it applies the schema's
    // defaults). Echoing the request back would hide that, and would claim a
    // stored state on a response that never carried one.
    const stored = { ...profile, headline: null };
    saveMyProfile.mockResolvedValue({ ok: true, profile: stored });

    const res = await saveMyProfileAction(profile);

    expect(res).toEqual({ ok: true, profile: stored });
    expect(saveMyProfile).toHaveBeenCalledWith(profile);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
  });

  it('carries a removed page back as the stored null', async () => {
    saveMyProfile.mockResolvedValue({ ok: true, profile: null });

    expect(await saveMyProfileAction(null)).toEqual({ ok: true, profile: null });
  });

  it('reports a refusal with the reason and no profile to adopt', async () => {
    saveMyProfile.mockRejectedValue(new Error('Handle taken.'));

    const res = await saveMyProfileAction(profile);

    expect(res).toEqual({ ok: false, message: 'Handle taken.' });
    // Nothing changed server-side, so nothing is revalidated.
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('myProfileAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the stored profile back, which is the only authority after a timeout', async () => {
    myProfile.mockResolvedValue({ handle: 'alex-rivera', profile });

    expect(await myProfileAction()).toEqual({ ok: true, profile });
  });

  it('reports a still-unknown state rather than inventing one', async () => {
    myProfile.mockRejectedValue(new Error('offline'));

    expect(await myProfileAction()).toEqual({ ok: false });
  });
});
