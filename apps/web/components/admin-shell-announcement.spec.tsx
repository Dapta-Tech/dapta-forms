// @vitest-environment happy-dom
/**
 * The rail's "New" badge for an in-app announcement: a pill after the label in
 * the open rail and the drawer, a dot on the icon in the collapsed rail, part
 * of the link's name for a screen reader ("Integrations, new"), in the server
 * markup (no flash), and gone from the builder. Reaching the announcement's
 * route ends it there and then, and is reported.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@quill/shared';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
const calls = vi.hoisted(() => ({ actions: [] as [string, string][], events: [] as [string, unknown][] }));
vi.mock('@/app/admin/announcement-actions', () => ({
  recordAnnouncementAction: async (id: string, event: string) => {
    calls.actions.push([id, event]);
    return { ok: true };
  },
}));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props: unknown) => calls.events.push([event, props]),
}));

import { AdminShell, type ShellAnnouncement } from './admin-shell';
import { resetAnnouncementLoad } from './announcement/announcement-client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANN: ShellAnnouncement = {
  id: 'integrations-2026-11',
  cta: '/admin/integrations',
  railBadge: 'integrations',
  badge: true,
};

function shell(opts: { collapsed?: boolean; locale?: Locale; announcement?: ShellAnnouncement | null } = {}) {
  const m = getMessages(opts.locale ?? 'en').admin;
  return (
    <AdminShell
      user={{ displayName: 'Alex Rivera', email: 'alex@example.com' }}
      messages={m.chrome}
      accountNav={m.account.nav}
      initialCollapsed={opts.collapsed ?? false}
      announcement={opts.announcement === undefined ? ANN : opts.announcement}
    >
      <p>page</p>
    </AdminShell>
  );
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

/** The name a screen reader computes for a link: its text, minus what is aria-hidden. */
function accessibleName(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? '';
    if (n.nodeType !== 1) return;
    if ((n as Element).getAttribute('aria-hidden') === 'true') return;
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out.trim();
}

/** The Integrations link in the desktop rail and in the drawer, parsed from server markup. */
function integrationLinks(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const [desktop, drawer] = [...doc.querySelectorAll('[data-testid="nav-integrations"]')];
  return { desktop: desktop!, drawer: drawer! };
}

/** The viewport: wide shows the desktop rail, narrow only the drawer. */
function viewport(wide: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('min-width') ? wide : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  nav.pathname = '/admin';
  calls.actions = [];
  calls.events = [];
  window.sessionStorage.clear();
  resetAnnouncementLoad();
  viewport(true);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('AdminShell: the announcement badge in the server markup', () => {
  it('marks Integrations "New" in the open rail and the drawer, read as "Integrations, new"', () => {
    const { desktop, drawer } = integrationLinks(renderToStaticMarkup(shell()));
    for (const link of [desktop, drawer]) {
      expect(link.getAttribute('data-badge')).toBe('new');
      expect(link.querySelector('[data-testid="nav-badge"]')!.textContent).toBe('New');
      expect(link.querySelector('[data-testid="nav-badge"]')!.getAttribute('aria-hidden')).toBe('true');
      expect(link.querySelector('[data-testid="nav-badge-dot"]')).toBeNull();
      expect(accessibleName(link)).toBe('Integrations, new');
      // The rotating logos stay the icon.
      expect(link.querySelector('[data-testid="integration-logos"]')).not.toBeNull();
    }
  });

  it('is a dot on the icon in the collapsed rail, still named, still a tooltip', () => {
    const { desktop, drawer } = integrationLinks(renderToStaticMarkup(shell({ collapsed: true })));
    expect(desktop.querySelector('[data-testid="nav-badge"]')).toBeNull();
    expect(desktop.querySelector('[data-testid="nav-badge-dot"]')).not.toBeNull();
    expect(accessibleName(desktop)).toBe('Integrations, new');
    expect(desktop.getAttribute('title')).toBe('Integrations, new');
    // The drawer is always the open rail.
    expect(drawer.querySelector('[data-testid="nav-badge"]')).not.toBeNull();
  });

  it('speaks Spanish', () => {
    const { desktop } = integrationLinks(renderToStaticMarkup(shell({ locale: 'es' })));
    expect(desktop.querySelector('[data-testid="nav-badge"]')!.textContent).toBe('Nuevo');
    expect(accessibleName(desktop)).toBe('Integraciones, nuevo');
  });

  it('marks nothing without an announcement, or with one that has no badge', () => {
    for (const announcement of [null, { ...ANN, badge: false }, { ...ANN, railBadge: null }]) {
      const html = renderToStaticMarkup(shell({ announcement }));
      expect(html).not.toContain('data-badge');
      expect(html).not.toContain('nav-badge');
      expect(accessibleName(integrationLinks(html).desktop)).toBe('Integrations');
    }
  });

  it('marks nothing in the builder', () => {
    nav.pathname = '/admin/forms/f1/edit';
    expect(renderToStaticMarkup(shell())).not.toContain('nav-badge');
  });
});

describe('AdminShell: what the rail reports', () => {
  it('reports one sighting per load of the dashboard, and the badge to analytics', async () => {
    await mount(shell());
    nav.pathname = '/admin/forms';
    await act(async () => root!.render(shell()));
    expect(calls.actions).toEqual([['integrations-2026-11', 'seen']]);
    expect(calls.events).toEqual([['announcement_seen', { announcement_id: 'integrations-2026-11', surface: 'rail' }]]);
  });

  it('reaching Integrations on its own ends the badge and is reported as followed', async () => {
    await mount(shell());
    expect(document.querySelector('[data-testid="nav-badge"]')).not.toBeNull();
    nav.pathname = '/admin/integrations';
    await act(async () => root!.render(shell()));
    expect(document.querySelector('[data-testid="nav-badge"]')).toBeNull();
    expect(calls.actions).toEqual([
      ['integrations-2026-11', 'seen'],
      ['integrations-2026-11', 'clicked'],
    ]);
    expect(calls.events.at(-1)).toEqual([
      'announcement_clicked',
      { announcement_id: 'integrations-2026-11', surface: 'page' },
    ]);
    // Leaving again does not bring it back.
    nav.pathname = '/admin';
    await act(async () => root!.render(shell()));
    expect(document.querySelector('[data-testid="nav-badge"]')).toBeNull();
    expect(calls.actions).toHaveLength(2);
  });

  it('files a click on the marked item as the rail’s', async () => {
    await mount(shell());
    const link = document.querySelector<HTMLElement>('[data-testid="nav-integrations"]')!;
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => link.click());
    nav.pathname = '/admin/integrations';
    await act(async () => root!.render(shell()));
    expect(calls.events.at(-1)).toEqual([
      'announcement_clicked',
      { announcement_id: 'integrations-2026-11', surface: 'rail' },
    ]);
  });

  it('a load straight onto Integrations reports the visit and no sighting', async () => {
    nav.pathname = '/admin/integrations/dcal';
    await mount(shell());
    expect(calls.actions).toEqual([['integrations-2026-11', 'clicked']]);
  });

  it('on a phone, counts a sighting only once the drawer shows the badge', async () => {
    viewport(false);
    nav.pathname = '/admin/forms';
    await mount(shell());
    expect(calls.actions).toEqual([]);
    await act(async () => document.querySelector<HTMLElement>('header button[aria-expanded]')!.click());
    expect(calls.actions).toEqual([['integrations-2026-11', 'seen']]);
  });

  it('follows a different announcement handed in later', async () => {
    await mount(shell());
    nav.pathname = '/admin/integrations';
    await act(async () => root!.render(shell()));
    const next = { ...ANN, id: 'next-one' };
    nav.pathname = '/admin';
    await act(async () => root!.render(shell({ announcement: next })));
    expect(document.querySelector('[data-testid="nav-badge"]')).not.toBeNull();
    expect(calls.actions.at(-1)).toEqual(['next-one', 'seen']);
  });

  it('reports nothing from the builder', async () => {
    nav.pathname = '/admin/forms/f1/edit';
    await mount(shell());
    expect(calls.actions).toEqual([]);
    expect(calls.events).toEqual([]);
  });
});
