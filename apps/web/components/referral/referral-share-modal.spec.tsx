// @vitest-environment happy-dom
/**
 * The referral dialog: the badge (a mini form with the pill at its foot, and
 * what it is), how it works in three steps, the progress on the flowing bar,
 * the person's link with a copy button, and one-tap sharing to WhatsApp, email
 * and X with the message already written in the reader's language. Opening it
 * records `referral_dialog_opened`; copying puts the link on the clipboard and
 * records `referral_link_copied`; each share link carries the link and the
 * text, encoded, and records `referral_link_shared` with its channel.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';

const calls = vi.hoisted(() => ({ events: [] as [string, unknown][] }));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props?: unknown) => calls.events.push([event, props]),
}));

// The real mark, swapped for a marker: which artwork it draws depends on the build.
vi.mock('@/components/brand/brand', () => ({
  BrandMark: ({ className }: { className?: string }) => <svg data-testid="brand-mark" className={className} />,
}));

import { ReferralShareModal } from './referral-share-modal';
import type { ReferralSurface } from './use-referral-copy';

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

async function mount(
  opts: {
    locale?: Locale;
    count?: number;
    onClose?: () => void;
    surface?: ReferralSurface;
    /** Keep the open event in `calls.events` (the other tests start after it). */
    keepOpenEvent?: boolean;
  } = {},
) {
  const m = getMessages(opts.locale ?? 'en');
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
        badgeLabel={m.growth.madeWith}
        m={m.admin.chrome.referral}
        surface={opts.surface}
      />,
    ),
  );
  if (!opts.keepOpenEvent) calls.events = [];
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
    expect(q('referral-progress')!.textContent).toBe('0 of 5');
  });

  it('shows the badge: the mini form with the pill at its foot, and what it is', async () => {
    const q = await mount();
    const badge = q('referral-badge')!;
    const pill = q('referral-mock-pill')!;
    expect(badge.contains(pill)).toBe(true);
    expect(pill.textContent).toBe('Made with dForms');
    expect(pill.dataset.strike).toBe('0');
    expect(pill.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(badge.textContent).toContain('This is the badge. It shows at the foot of every form, page and email');
  });

  it('says how it works in three steps, the goal naming the badge', async () => {
    const q = await mount();
    const steps = [...q('referral-steps')!.querySelectorAll('li')].map((li) => li.textContent);
    expect(steps).toEqual([
      '1Copy your link or share it.',
      '2Each person who signs up to dForms with it counts.',
      '3At 5, “Made with dForms” disappears from all your forms, for life.',
    ]);
  });

  it('the progress: the count and the same flowing bar as the banner', async () => {
    const q = await mount({ count: 3 });
    expect(q('referral-progress')!.textContent).toBe('3 of 5');
    const track = q('referral-track')!;
    expect(track.getAttribute('role')).toBe('img');
    expect(track.getAttribute('aria-label')).toBe('3 of 5 joined with your link');
    expect(track.dataset.heat).toBe('warm');
    expect(q('referral-track-fill')!.style.width).toBe('60%');
    expect(track.querySelector('.rb-flag')).not.toBeNull();
  });

  it('records each opening with the surface it came from', async () => {
    for (const surface of ['menu', 'banner', 'banner_help', 'badge_switch'] as const) {
      calls.events = [];
      await mount({ surface, keepOpenEvent: true });
      expect(calls.events).toEqual([['referral_dialog_opened', { surface }]]);
      await act(async () => root!.unmount());
      host!.remove();
      root = null;
    }
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

  it('opened from the banner, the copy and every share say so', async () => {
    const q = await mount({ surface: 'banner' });
    await act(async () => q('referral-copy')!.click());
    const wa = q('referral-share-whatsapp') as HTMLAnchorElement;
    wa.addEventListener('click', (e) => e.preventDefault(), { once: true });
    await act(async () => wa.click());
    expect(calls.events).toEqual([
      ['referral_link_copied', { surface: 'banner' }],
      ['referral_link_shared', { channel: 'whatsapp', surface: 'banner' }],
    ]);
  });

  it('names the badge as the pill reads, in Spanish too', async () => {
    const q = await mount({ locale: 'es', count: 1 });
    const text = document.querySelector('[role="dialog"]')!.textContent;
    expect(text).toContain('«Hecho con dForms»');
    expect(text).not.toContain('Made with');
    expect(q('referral-mock-pill')!.textContent).toBe('Hecho con dForms');
    expect(q('referral-steps')!.textContent).toContain('Con 5, «Hecho con dForms» desaparece de todos tus formularios, de por vida.');
    expect(q('referral-progress')!.textContent).toBe('1 de 5');
    expect(text).toContain('Cómo funciona');
  });
});
