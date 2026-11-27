// @vitest-environment happy-dom
/**
 * The reader's PDF: the button downloads the file of the language read, and
 * `?pdf=1` starts that download once, leaves the address, keeps a notice with
 * a button on screen, and waits for the stored language when the page is about
 * to be asked again in it. Each download is `forms_playbook_pdf_downloaded`.
 */
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';

const calls = vi.hoisted(() => ({
  events: [] as [string, unknown][],
  /** Every download started: the anchor's target and name, and the address at that moment. */
  downloads: [] as { href: string | null; name: string; address: string }[],
}));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props: unknown) => calls.events.push([event, props]),
}));

import { PlaybookPdf } from './playbook-pdf';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'dforms.playbooks.lang.member-1';
type Props = Parameters<typeof PlaybookPdf>[0];
const BASE: Props = {
  slug: 'hook',
  category: 'ads',
  locale: 'es',
  shownLocale: 'es',
  fallback: false,
  langInUrl: false,
  storageKey: KEY,
  m: getMessages('es').admin.playbooks.pdf,
};
const EN: Partial<Props> = { locale: 'en', shownLocale: 'en', langInUrl: true, m: getMessages('en').admin.playbooks.pdf };

let root: Root | undefined;
let host: HTMLDivElement | undefined;
async function render(over: Partial<Props> = {}, strict = false) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  const element = <PlaybookPdf {...BASE} {...over} />;
  await act(async () => root!.render(strict ? <StrictMode>{element}</StrictMode> : element));
}
async function unmount() {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
}
const go = (address: string) => window.history.replaceState(null, '', address);
const address = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const buttons = () => [...host!.querySelectorAll<HTMLAnchorElement>('[data-testid="playbook-pdf-download"]')];
const notice = () => host!.querySelector('[data-testid="playbook-pdf-notice"]');

beforeEach(() => {
  calls.events = [];
  calls.downloads = [];
  window.localStorage.clear();
  go('/admin/playbooks/hook');
  // The browser's download: record it instead of following the link.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    calls.downloads.push({ href: this.getAttribute('href'), name: this.download, address: address() });
  });
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

describe('PlaybookPdf, the button', () => {
  it('links the file of the language read, as a download, and downloads nothing on its own', async () => {
    await render();
    const [link, ...others] = buttons();
    expect(others).toEqual([]);
    expect(link!.getAttribute('href')).toBe('/playbooks/pdf/es/hook.pdf');
    expect(link!.getAttribute('download')).toBe('hook-es.pdf');
    expect(link!.textContent).toBe('Descargar PDF');
    expect(link!.closest('[lang]')!.getAttribute('lang')).toBe('es');
    expect(notice()).toBeNull();
    expect(calls.downloads).toEqual([]);
    expect(calls.events).toEqual([]);
  });

  it('follows the language on screen, in its file, its words and its event', async () => {
    await render(EN);
    const link = buttons()[0]!;
    expect(link.getAttribute('href')).toBe('/playbooks/pdf/en/hook.pdf');
    expect(link.textContent).toBe('Download PDF');
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => void link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(calls.events).toEqual([
      [
        'playbook_pdf_downloaded',
        { slug: 'hook', category: 'ads', locale: 'en', requested_locale: 'en', fallback: false, trigger: 'button' },
      ],
    ]);
  });

  it('serves the Spanish file of a Spanish fallback read under English', async () => {
    await render({ locale: 'en', shownLocale: 'es', fallback: true, langInUrl: true });
    expect(buttons()[0]!.getAttribute('href')).toBe('/playbooks/pdf/es/hook.pdf');
  });
});

describe('PlaybookPdf, ?pdf=1', () => {
  it('downloads once, out of the address before the download, with the campaign on the event', async () => {
    go('/admin/playbooks/hook?lang=en&pdf=1#paso-1');
    const campaign = { utm_source: 'ig_homerovende' };
    await render({ ...EN, campaign });
    await render({ ...EN, campaign });
    await render({ ...EN, campaign: { ...campaign } });
    expect(calls.downloads).toEqual([
      { href: '/playbooks/pdf/en/hook.pdf', name: 'hook-en.pdf', address: '/admin/playbooks/hook?lang=en#paso-1' },
    ]);
    expect(address()).toBe('/admin/playbooks/hook?lang=en#paso-1');
    expect(calls.events).toEqual([
      [
        'playbook_pdf_downloaded',
        {
          slug: 'hook',
          category: 'ads',
          locale: 'en',
          requested_locale: 'en',
          fallback: false,
          trigger: 'auto',
          utm_source: 'ig_homerovende',
        },
      ],
    ]);
  });

  it('keeps a notice with the one large button, which downloads again by hand', async () => {
    go('/admin/playbooks/hook?pdf=1');
    await render();
    expect(notice()!.textContent).toContain('Tu PDF se está descargando');
    expect(notice()!.closest('[role="status"]')).not.toBeNull();
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]!.textContent).toBe('Descargar tu PDF');
    expect(notice()!.contains(buttons()[0]!)).toBe(true);
    // A later render (the server's refresh) leaves it on screen.
    await render({ langInUrl: false });
    expect(notice()).not.toBeNull();
  });

  it('downloads once under strict mode', async () => {
    go('/admin/playbooks/hook?pdf=1');
    await render({}, true);
    expect(calls.downloads).toHaveLength(1);
    expect(calls.events).toHaveLength(1);
  });

  it('does not download again on a reload', async () => {
    go('/admin/playbooks/hook?pdf=1');
    await render();
    await unmount();
    await render();
    expect(calls.downloads).toHaveLength(1);
    expect(notice()).toBeNull();
  });

  it('waits for the stored language, then downloads that file', async () => {
    window.localStorage.setItem(KEY, 'en');
    go('/admin/playbooks/hook?pdf=1');
    await render();
    expect(calls.downloads).toEqual([]);
    expect(address()).toBe('/admin/playbooks/hook?pdf=1');
    // The router asks the page again in English, keeping ?pdf=1.
    go('/admin/playbooks/hook?pdf=1&lang=en');
    await render(EN);
    expect(calls.downloads.map((d) => d.href)).toEqual(['/playbooks/pdf/en/hook.pdf']);
    expect(address()).toBe('/admin/playbooks/hook?lang=en');
  });

  it('lets the address language win over the stored one', async () => {
    window.localStorage.setItem(KEY, 'en');
    go('/admin/playbooks/hook?lang=es&pdf=1');
    await render({ langInUrl: true });
    expect(calls.downloads.map((d) => d.href)).toEqual(['/playbooks/pdf/es/hook.pdf']);
  });

  it.each(['?pdf=0', '?pdf=true', '?pdf='])('does nothing for %s', async (query) => {
    go(`/admin/playbooks/hook${query}`);
    await render();
    expect(calls.downloads).toEqual([]);
    expect(address()).toBe(`/admin/playbooks/hook${query}`);
  });

  it("drops the notice on another playbook's page", async () => {
    go('/admin/playbooks/hook?pdf=1');
    await render();
    go('/admin/playbooks/otro?lang=es');
    await render({ slug: 'otro', langInUrl: true });
    expect(notice()).toBeNull();
    expect(calls.downloads).toHaveLength(1);
  });
});
