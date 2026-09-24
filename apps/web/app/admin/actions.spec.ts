import { beforeEach, describe, expect, it, vi } from 'vitest';

const setFormSlug = vi.fn();
const me = vi.fn();
vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    setFormSlug: (...a: unknown[]) => setFormSlug(...a),
    me: () => me(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { renameFormSlugAction } from './actions';

describe('renameFormSlugAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hands the editor the neutral link, not one naming whoever renamed it', async () => {
    setFormSlug.mockResolvedValue({ id: 'form-1', slug: 'spring-launch' });
    me.mockResolvedValue({ accountCode: 'acme', handle: 'alex-rivera' });

    await expect(renameFormSlugAction('form-1', 'spring-launch')).resolves.toEqual({
      ok: true,
      slug: 'spring-launch',
      publicPath: '/acme/f/spring-launch',
    });
    expect(setFormSlug).toHaveBeenCalledWith('form-1', 'spring-launch');
  });
});
