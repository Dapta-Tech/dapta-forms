// @vitest-environment happy-dom
/**
 * The referral share modal: the person's link with a copy button, and one-tap
 * sharing to WhatsApp, email and X with the message already written in the
 * reader's language. Copying puts the link on the clipboard and records
 * `referral_link_copied`; each share link carries the link and the text,
 * encoded, and records `referral_link_shared` with its channel.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';

const calls = vi.hoisted(() => ({ events: [] as [string, unknown][] }));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props?: unknown) => calls.events.push([event, props]),
}));

import { ReferralShareModal } from './referral-share-modal';

const LINK = 'https://landing.example.test/?ref=abc23def';

let root: Root | null = null;
let host: HTMLElement | null = null;
let writeText: ReturnType<typeof vi.fn>;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  calls.events = [];
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(opts: { locale?: Locale; count?: number; onClose?: () => void } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ReferralShareModal
        open
        onClose={opts.onClose ?? (() => {})}
        link={LINK}
        count={opts.count ?? 0}
        goal={5}
        m={getMessages(opts.locale ?? 'en').admin.chrome.referral}
      />,
    ),
  );
  return (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

const params = (href: string) => new URL(href).searchParams;

describe('ReferralShareModal', () => {
  it('is a dialog that shows the link and the progress', async () => {
    const q = await mount({ count: 0 });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Invite 5 people');
    expect((q('referral-link') as HTMLInputElement).value).toBe(LINK);
    expect(q('referral-progress')!.textContent).toBe('0 of 5 joined with your link');
  });

  it('copy puts the link on the clipboard, says so, and records the copy', async () => {
    const q = await mount();
    await act(async () => q('referral-copy')!.click());
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(q('referral-copy')!.textContent).toBe('Copied');
    expect(calls.events).toEqual([['referral_link_copied', undefined]]);
  });

  it('a clipboard that refuses records nothing and selects the link to copy by hand', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const q = await mount();
    await act(async () => q('referral-copy')!.click());
    expect(calls.events).toEqual([]);
    expect(document.activeElement).toBe(q('referral-link'));
  });

  it('WhatsApp, email and X open with the English message and the link', async () => {
    const q = await mount();
    const wa = q('referral-share-whatsapp') as HTMLAnchorElement;
    expect(wa.href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(params(wa.href).get('text')).toBe(
      `I've been using dForms for my forms. You ask your AI agent (Claude, ChatGPT) and it builds the form, publishes it and sends you the leads. Free, with unlimited responses. Try it with my link: ${LINK}`,
    );
    expect(wa.target).toBe('_blank');

    const mail = q('referral-share-email') as HTMLAnchorElement;
    expect(mail.href.startsWith('mailto:?')).toBe(true);
    const mailParams = new URLSearchParams(mail.href.slice('mailto:?'.length));
    expect(mailParams.get('subject')).toBe('You should try dForms for your forms');
    expect(mailParams.get('body')).toContain('sign up with my link: ' + LINK);
    // Encoded, not raw: a `&` or `?` in the text would cut the body short.
    expect(mail.href).toContain(encodeURIComponent(LINK));

    const x = q('referral-share-x') as HTMLAnchorElement;
    expect(x.href.startsWith('https://x.com/intent/post?')).toBe(true);
    expect(params(x.href).get('text')).toBe('My AI agent builds my forms now with dForms. Free, unlimited responses, open source.');
    expect(params(x.href).get('url')).toBe(LINK);
  });

  it('the Spanish messages', async () => {
    const q = await mount({ locale: 'es' });
    expect(params((q('referral-share-whatsapp') as HTMLAnchorElement).href).get('text')).toBe(
      `Estoy usando dForms para mis formularios. Le pides a tu agente de IA (Claude, ChatGPT) que lo arme y él lo crea, lo publica y te manda los leads. Es gratis y sin límite de respuestas. Pruébalo con mi link: ${LINK}`,
    );
    const mail = q('referral-share-email') as HTMLAnchorElement;
    expect(new URLSearchParams(mail.href.slice('mailto:?'.length)).get('subject')).toBe(
      'Te recomiendo dForms para tus formularios',
    );
    expect(params((q('referral-share-x') as HTMLAnchorElement).href).get('text')).toBe(
      'Mis formularios ahora los arma mi agente de IA con dForms. Gratis, sin límite de respuestas y open source.',
    );
    expect(q('referral-copy')!.textContent).toBe('Copiar link');
  });

  it('each share records its channel', async () => {
    const q = await mount();
    for (const channel of ['whatsapp', 'email', 'x'] as const) {
      const a = q(`referral-share-${channel}`) as HTMLAnchorElement;
      // Keep happy-dom from navigating.
      a.addEventListener('click', (e) => e.preventDefault(), { once: true });
      await act(async () => a.click());
    }
    expect(calls.events).toEqual([
      ['referral_link_shared', { channel: 'whatsapp' }],
      ['referral_link_shared', { channel: 'email' }],
      ['referral_link_shared', { channel: 'x' }],
    ]);
  });

  it('closes from its close button', async () => {
    const onClose = vi.fn();
    const q = await mount({ onClose });
    await act(async () => q('referral-close')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
