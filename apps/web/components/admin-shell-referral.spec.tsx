// @vitest-environment happy-dom
/**
 * The referral program's left-menu entry: present in the rail and the drawer
 * only while the program is on, with the person's progress (0/5) as a pill
 * the open rail shows and a screen reader hears, and opening the share modal.
 * Opened from the mobile drawer, the drawer closes so the dialog is not under it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/app/admin/announcement-actions', () => ({ recordAnnouncementAction: async () => ({ ok: true }) }));
vi.mock('@/lib/product-analytics', () => ({ captureEvent: () => {} }));

import { AdminShell, type ShellReferral } from './admin-shell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REFERRAL: ShellReferral = { link: 'https://landing.example.test/?ref=abc23def', count: 0, goal: 5 };

function shell(opts: { collapsed?: boolean; locale?: Locale; referral?: ShellReferral | null } = {}) {
  const m = getMessages(opts.locale ?? 'en').admin;
  return (
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={opts.collapsed ?? false}
      referral={opts.referral === undefined ? REFERRAL : opts.referral}
    >
      <p>page</p>
    </AdminShell>
  );
}

/** The name a screen reader computes: the text, minus what is aria-hidden. */
function accessibleName(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? '';
    if (n.nodeType !== 1) return;
    if ((n as Element).getAttribute('aria-hidden') === 'true') return;
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out.replace(/\s+/g, ' ').trim();
}

const entries = (html: string) =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-testid="nav-referral"]')];

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('min-width'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('AdminShell: the referral entry', () => {
  it('sits in the open rail and the drawer with the progress, read as one name', () => {
    const [desktop, drawer] = entries(renderToStaticMarkup(shell()));
    for (const entry of [desktop!, drawer!]) {
      expect(entry.tagName).toBe('BUTTON');
      expect(entry.querySelector('[data-testid="nav-referral-progress"]')!.textContent).toBe('0/5');
      expect(accessibleName(entry)).toBe('Invite friends, 0 of 5 joined');
    }
  });

  it('shows the count it is given, in Spanish too', () => {
    const [desktop] = entries(renderToStaticMarkup(shell({ locale: 'es', referral: { ...REFERRAL, count: 3 } })));
    expect(desktop!.querySelector('[data-testid="nav-referral-progress"]')!.textContent).toBe('3/5');
    expect(accessibleName(desktop!)).toBe('Invita amigos, 3 de 5 se unieron');
  });

  it('collapsed to the 64px rail: the icon alone, the name and progress still read', () => {
    const [desktop] = entries(renderToStaticMarkup(shell({ collapsed: true })));
    expect(desktop!.querySelector('[data-testid="nav-referral-progress"]')).toBeNull();
    expect(desktop!.getAttribute('title')).toBe('Invite friends, 0 of 5 joined');
    expect(accessibleName(desktop!)).toBe('Invite friends, 0 of 5 joined');
  });

  it('is absent while the program is off', () => {
    expect(entries(renderToStaticMarkup(shell({ referral: null })))).toHaveLength(0);
  });

  it('opens the share modal with the link', async () => {
    await mount(shell());
    expect(document.querySelector('[data-testid="referral-modal"]')).toBeNull();
    await act(async () => document.querySelector<HTMLElement>('[data-testid="nav-referral"]')!.click());
    expect(document.querySelector('[data-testid="referral-modal"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[data-testid="referral-link"]')!.value).toBe(REFERRAL.link);
  });

  it('from the drawer, the drawer closes as the modal opens', async () => {
    await mount(shell());
    await act(async () => document.querySelector<HTMLElement>('button[aria-label="Open navigation"]')!.click());
    const drawer = document.querySelector('aside[role="dialog"]')!;
    expect(drawer.hasAttribute('inert')).toBe(false);
    await act(async () => drawer.querySelector<HTMLElement>('[data-testid="nav-referral"]')!.click());
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('[data-testid="referral-modal"]')).not.toBeNull();
  });
});
