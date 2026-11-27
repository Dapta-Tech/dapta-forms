// @vitest-environment happy-dom
/**
 * The reader's language: the toggle asks the page again in the other language
 * (`router.replace` with `?lang=`), keeps the choice per person and emits
 * `forms_playbooks_locale_changed`; a stored choice applies on open unless the
 * address names a language; and the open is recorded once, in the language
 * that was read.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

const calls = vi.hoisted(() => ({
  seen: [] as [string, string | undefined][],
  events: [] as [string, unknown][],
  replaced: [] as string[],
}));
vi.mock('@/app/admin/playbook-actions', () => ({
  recordPlaybookSeenAction: async (slug: string, locale?: string) => {
    calls.seen.push([slug, locale]);
    return { ok: true };
  },
}));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props: unknown) => calls.events.push([event, props]),
}));
const router = vi.hoisted(() => ({ replace: (href: string) => calls.replaced.push(href) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { PlaybookOpened } from './playbook-opened';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'dforms.playbooks.lang.member-1';
type Props = Parameters<typeof PlaybookOpened>[0];
const BASE: Props = {
  slug: 'hook',
  category: 'ads',
  locale: 'es',
  shownLocale: 'es',
  fallback: false,
  langInUrl: false,
  storageKey: KEY,
  m: getMessages('es').admin.playbooks.contentLanguage,
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function render(over: Partial<Props> = {}) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(<PlaybookOpened {...BASE} {...over} />));
}
const pressed = () => [...host!.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'));
const click = (locale: 'es' | 'en') =>
  act(async () => host!.querySelector<HTMLElement>(`[data-testid="playbooks-locale-${locale}"]`)!.click());

beforeEach(() => {
  calls.seen = [];
  calls.events = [];
  calls.replaced = [];
  window.localStorage.clear();
  window.history.replaceState(null, '', '/admin/playbooks/hook#paso-1');
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
});

describe('PlaybookOpened', () => {
  it("puts the account's first-touch utm tags on the open and on a language change", async () => {
    const campaign = { utm_source: 'linkedin', utm_medium: 'social' };
    await render({ campaign });
    await click('en');
    expect(calls.events.map(([e]) => e)).toEqual(['playbook_opened', 'playbooks_locale_changed']);
    for (const [, props] of calls.events) expect(props).toMatchObject(campaign);
  });

  it('records the open once, with the language read', async () => {
    await render();
    await render();
    expect(calls.seen).toEqual([['hook', 'es']]);
    expect(calls.events).toEqual([
      ['playbook_opened', { slug: 'hook', category: 'ads', locale: 'es', requested_locale: 'es', fallback: false }],
    ]);
    expect(pressed()).toEqual(['true', 'false']);
  });

  it('reports a Spanish fallback read under English', async () => {
    await render({ locale: 'en', shownLocale: 'es', fallback: true, langInUrl: true });
    expect(calls.events[0]).toEqual([
      'playbook_opened',
      { slug: 'hook', category: 'ads', locale: 'es', requested_locale: 'en', fallback: true },
    ]);
    expect(pressed()).toEqual(['false', 'true']);
  });

  it('asks the page again in the other language on a click, keeping the hash, the choice and the event', async () => {
    await render();
    await click('en');
    expect(calls.replaced).toEqual(['/admin/playbooks/hook?lang=en#paso-1']);
    expect(window.localStorage.getItem(KEY)).toBe('en');
    expect(pressed()).toEqual(['false', 'true']);
    expect(calls.events.at(-1)).toEqual(['playbooks_locale_changed', { from: 'es', to: 'en', surface: 'reader', slug: 'hook' }]);
    // The page in English comes: the open is not recorded again.
    await render({ locale: 'en', shownLocale: 'en', langInUrl: true });
    expect(calls.seen).toEqual([['hook', 'es']]);
  });

  it('applies the stored choice on open, and records the open only in that language', async () => {
    window.localStorage.setItem(KEY, 'en');
    await render();
    expect(calls.replaced).toEqual(['/admin/playbooks/hook?lang=en#paso-1']);
    expect(calls.seen).toEqual([]);
    expect(pressed()).toEqual(['false', 'true']);
    await render({ locale: 'en', shownLocale: 'en', langInUrl: true });
    expect(calls.seen).toEqual([['hook', 'en']]);
    expect(calls.events).toEqual([
      ['playbook_opened', { slug: 'hook', category: 'ads', locale: 'en', requested_locale: 'en', fallback: false }],
    ]);
  });

  it('lets the address win over the stored choice', async () => {
    window.localStorage.setItem(KEY, 'en');
    await render({ langInUrl: true });
    expect(calls.replaced).toEqual([]);
    expect(calls.seen).toEqual([['hook', 'es']]);
  });
});
