import { beforeEach, describe, expect, it, vi } from 'vitest';

const completeOnboarding = vi.fn();
vi.mock('@/lib/admin-api', () => ({
  adminApi: { completeOnboarding: (...a: unknown[]) => completeOnboarding(...a) },
}));

const redirect = vi.fn((url: string) => {
  // Mirror Next's real behavior: redirect() throws, ending the action.
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  unstable_rethrow: (e: unknown) => {
    throw e;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const store = new Map<string, string>();
const cookieJar = {
  get: vi.fn((name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined)),
  set: vi.fn(),
  delete: vi.fn((name: string) => store.delete(name)),
};
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieJar) }));

import { completeOnboardingAction } from './actions';

const finish = () => completeOnboardingAction({ template: 'blank' });

/**
 * The wizard is the last stop of the return path (lib/return-path.ts): a parked
 * destination beats the editor of the form it just made, and is spent here.
 */
describe('completeOnboardingAction, the parked destination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    completeOnboarding.mockResolvedValue({ formId: 'f1' });
  });

  it('ends on the new form when nothing was parked', async () => {
    await expect(finish()).rejects.toThrow('NEXT_REDIRECT:/admin/forms/f1/edit?tour=1');
  });

  it('ends on a playbook with the reader language, query kept, and spends the cookie', async () => {
    store.set('quill_next', '/admin/playbooks/guia-de-calificacion?lang=en');

    await expect(finish()).rejects.toThrow('NEXT_REDIRECT:/admin/playbooks/guia-de-calificacion?lang=en');
    expect(cookieJar.delete).toHaveBeenCalledWith('quill_next');
  });

  it.each(['/admin/playbooks/x?lang=fr', '/admin/forms?lang=en', '/admin/playbooks/x?lang=en&x=1'])(
    'ignores a refused destination (%s) and ends on the new form',
    async (next) => {
      store.set('quill_next', next);

      await expect(finish()).rejects.toThrow('NEXT_REDIRECT:/admin/forms/f1/edit?tour=1');
    },
  );
});
