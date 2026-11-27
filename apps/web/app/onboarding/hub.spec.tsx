/**
 * The short wizard is for one door only: the parked return path of a playbook
 * page. The page reads it and hands it to the wizard, the wizard asks two
 * questions.
 */
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

const store = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
  })),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  unstable_rethrow: () => {},
}));
let foundingMember: boolean | undefined = true;
vi.mock('@/lib/admin-api', () => ({
  adminApi: { me: async () => ({ onboardingRequired: true, foundingMember }) },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale', () => ({ preferredLocale: async () => 'en' }));
vi.mock('@/lib/dapta-onboarding', () => ({ currentOnboardingCohort: async () => 'cold' }));
vi.mock('./actions', () => ({ saveOnboardingStepAction: vi.fn(), completeOnboardingAction: vi.fn() }));

import OnboardingPage from './page';
import { OnboardingWizard } from './wizard';

async function wizardProps(): Promise<Record<string, unknown>> {
  const page = (await OnboardingPage({ searchParams: Promise.resolve({}) })) as ReactElement<{
    children: ReactNode;
  }>;
  const wizard = (page.props.children as ReactElement[]).find((c) => c.type === OnboardingWizard);
  return wizard!.props as Record<string, unknown>;
}

describe('the onboarding page and the resource hub', () => {
  beforeEach(() => {
    store.clear();
    foundingMember = true;
  });

  it.each([
    ['/admin/playbooks/hook-de-dolor', null],
    ['/admin/playbooks/hook-de-dolor?lang=en', 'en'],
    ['/admin/playbooks/hook-de-dolor?lang=es&pdf=1', 'es'],
  ])('reads the hub entry from the parked %s', async (next, playbookLocale) => {
    store.set('quill_next', next);
    expect((await wizardProps()).hub).toEqual({ playbook: 'hook-de-dolor', playbookLocale });
  });

  it.each([false, undefined])(
    'passes no hub entry to someone who did not found the workspace (%s)',
    async (founding) => {
      foundingMember = founding;
      store.set('quill_next', '/admin/playbooks/hook-de-dolor');
      expect((await wizardProps()).hub).toBeNull();
    },
  );

  it('gives a slug that names no playbook the ordinary wizard', async () => {
    store.set('quill_next', '/admin/playbooks/no-such-playbook');
    const props = await wizardProps();
    expect(props.hub).toBeNull();
    const html = renderToStaticMarkup(<OnboardingWizard {...(props as unknown as ComponentProps<typeof OnboardingWizard>)} />);
    expect(html).toContain('Question 1 of 6');
  });

  it.each([undefined, '/admin/playbooks', '/admin/developers/keys'])(
    'passes no hub entry for the parked %s',
    async (next) => {
      if (next) store.set('quill_next', next);
      expect((await wizardProps()).hub).toBeNull();
    },
  );
});

describe('the wizard', () => {
  const messages = getMessages('en').admin.onboarding;
  const render = (hub?: { playbook: string; playbookLocale: null }) =>
    renderToStaticMarkup(
      <OnboardingWizard messages={messages} locale="en" cohort="cold" hub={hub ?? null} />,
    );

  it('opens on the first of two questions for a hub signup', () => {
    const html = render({ playbook: 'hook-de-dolor', playbookLocale: null });
    expect(html).toContain('Question 1 of 2');
    expect(html).toContain(messages.leadSource.question.replace(/'/g, '&#x27;'));
  });

  it('opens on the first of six for everyone else', () => {
    expect(render()).toContain('Question 1 of 6');
  });
});
