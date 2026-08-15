/**
 * `saveMyProfileAction` is the only way this screen writes, and the only thing
 * that can tell it what is stored. Three things are pinned here:
 *
 *  - it always sends the revision it read (there is no unguarded overload, and
 *    no fallback to the deprecated `/v1` writer),
 *  - an aborted or dropped call comes back as `unknown` — never as a failure,
 *    because the write may have landed,
 *  - only outcomes that actually moved stored state revalidate the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberProfile } from '@quill/types';

const saveMyProfileV2 = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/admin-api', () => ({
  adminApi: {},
  ApiError: class ApiError extends Error {},
  isAdminRole: () => true,
  saveMyProfileV2: (...a: unknown[]) => saveMyProfileV2(...a),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));

import { saveMyProfileAction } from './actions';

const profile: MemberProfile = { version: 1, enabled: true, headline: 'Growth partner', bio: null };
const stored: MemberProfile = { ...profile, headline: null };

describe('saveMyProfileAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the expected revision with every write', async () => {
    saveMyProfileV2.mockResolvedValue({ status: 'ok', profile: stored, revision: 5 });

    const res = await saveMyProfileAction(profile, 4);

    expect(saveMyProfileV2).toHaveBeenCalledWith(profile, 4);
    expect(res).toEqual({ status: 'ok', profile: stored, revision: 5 });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
  });

  it('hands back the API’s stored copy, not the request', async () => {
    saveMyProfileV2.mockResolvedValue({ status: 'ok', profile: stored, revision: 2 });

    const res = await saveMyProfileAction(profile, 1);

    expect(res).toMatchObject({ profile: stored });
  });

  it('passes a conflict through with the authoritative state to adopt', async () => {
    saveMyProfileV2.mockResolvedValue({ status: 'conflict', profile: stored, revision: 9 });

    expect(await saveMyProfileAction(profile, 4)).toEqual({
      status: 'conflict',
      profile: stored,
      revision: 9,
    });
    // Stored state moved (somebody else's write), so the render is stale too.
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
  });

  it('reports an aborted call as unknown, never as a failure', async () => {
    saveMyProfileV2.mockResolvedValue({ status: 'unknown' });

    expect(await saveMyProfileAction(profile, 4)).toEqual({ status: 'unknown' });
    // Nothing is known to have changed, so nothing is revalidated.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports an invocation that threw as unknown too', async () => {
    saveMyProfileV2.mockRejectedValue(new Error('socket hang up'));

    expect(await saveMyProfileAction(profile, 4)).toEqual({ status: 'unknown' });
  });

  it('surfaces an API that cannot guard writes instead of writing anyway', async () => {
    saveMyProfileV2.mockResolvedValue({ status: 'unsupported' });

    expect(await saveMyProfileAction(profile, 4)).toEqual({ status: 'unsupported' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
