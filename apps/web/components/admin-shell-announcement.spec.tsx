// @vitest-environment happy-dom
/**
 * The rail's half of an in-app announcement, and the pop-up it opens.
 *
 * The "New" badge: a pill after the label in the open rail and the drawer, a
 * dot on the icon in the collapsed rail, part of the link's name for a screen
 * reader ("Integrations, new"), in the server markup (no flash), and gone from
 * the builder. Reaching the announcement's route ends it there and then.
 *
 * The pop-up: opens on the first dashboard load of a session where it is due,
 * focus on its close button; X, Escape, a click outside and its button all
 * close it and report the close; never in the builder, on its own page, over
 * another dialog, or again in the same session.
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

const copy = (locale: Locale = 'en') => getMessages(locale).admin.announcements;
/** Badge only: the pop-up was closed earlier (the API says `modal: false`). */
const ANN: ShellAnnouncement = {
  id: 'integrations-2026-11',
  cta: '/admin/integrations',
  railBadge: 'integrations',
  badge: true,
  modal: false,
  copy: copy().items['integrations-2026-11'],
  closeLabel: copy().close,
  visual: { kind: 'video', src: '/announcements/announce-integrations', width: 1280, height: 720 },
};
/** The pop-up is due. */
const DUE: ShellAnnouncement = { ...ANN, modal: true };
const ID = 'integrations-2026-11';
const sleep = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

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
  it('tells analytics the badge was seen, once, and stores nothing for it', async () => {
    await mount(shell());
    nav.pathname = '/admin/forms';
    await act(async () => root!.render(shell()));
    expect(calls.actions).toEqual([]);
    expect(calls.events).toEqual([['announcement_seen', { announcement_id: ID, surface: 'rail' }]]);
  });

  it('reaching Integrations on its own ends the badge and is reported as followed', async () => {
    await mount(shell());
    expect($('[data-testid="nav-badge"]')).not.toBeNull();
    nav.pathname = '/admin/integrations';
    await act(async () => root!.render(shell()));
    expect($('[data-testid="nav-badge"]')).toBeNull();
    expect(calls.actions).toEqual([[ID, 'clicked']]);
    expect(calls.events.at(-1)).toEqual(['announcement_clicked', { announcement_id: ID, surface: 'page' }]);
    // Leaving again does not bring it back.
    nav.pathname = '/admin';
    await act(async () => root!.render(shell()));
    expect($('[data-testid="nav-badge"]')).toBeNull();
    expect(calls.actions).toHaveLength(1);
  });

  it('files a click on the marked item as the rail’s', async () => {
    await mount(shell());
    const link = $('[data-testid="nav-integrations"]')!;
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => link.click());
    nav.pathname = '/admin/integrations';
    await act(async () => root!.render(shell()));
    expect(calls.events.at(-1)).toEqual(['announcement_clicked', { announcement_id: ID, surface: 'rail' }]);
  });

  it('on a phone, tells analytics only once the drawer shows the badge', async () => {
    viewport(false);
    nav.pathname = '/admin/forms';
    await mount(shell());
    expect(calls.events).toEqual([]);
    await act(async () => $('header button[aria-expanded]')!.click());
    expect(calls.events).toEqual([['announcement_seen', { announcement_id: ID, surface: 'rail' }]]);
  });

  it('reports nothing from the builder', async () => {
    nav.pathname = '/admin/forms/f1/edit';
    await mount(shell({ announcement: DUE }));
    await sleep(450);
    expect(calls.actions).toEqual([]);
    expect(calls.events).toEqual([]);
    expect($('[role="dialog"][aria-modal="true"]')).toBeNull();
  });
});

describe('AdminShell: the announcement pop-up', () => {
  const dialog = () => $('[role="dialog"][aria-modal="true"]');

  it('opens on load over the page, focused on its close button, and reports the sighting', async () => {
    await mount(shell({ announcement: DUE }));
    expect(dialog()).toBeNull();
    await sleep(450);
    expect(dialog()).not.toBeNull();
    // Portalled: a child of <body>, not of the shell.
    expect(host!.contains(dialog())).toBe(false);
    expect(dialog()!.getAttribute('aria-labelledby')).toBe(`announcement-${ID}-title`);
    expect($(`#announcement-${ID}-title`)!.textContent).toBe(copy().items[ID].title);
    expect(document.activeElement).toBe($('[data-testid="announcement-close"]'));
    expect(document.body.style.overflow).toBe('hidden');
    expect(calls.actions).toEqual([[ID, 'seen']]);
    expect(calls.events).toContainEqual(['announcement_seen', { announcement_id: ID, surface: 'modal' }]);
  });

  const closers: [string, () => Promise<void>][] = [
    ['close', async () => $('[data-testid="announcement-close"]')!.click()],
    [
      'escape',
      async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      },
    ],
    ['backdrop', async () => dialog()!.parentElement!.querySelector<HTMLElement>('button[aria-hidden]')!.click()],
  ];
  for (const [how, act_] of closers) {
    it(`closing it by ${how} ends it for good and gives the page back`, async () => {
      await mount(shell({ announcement: DUE }));
      await sleep(450);
      await act(act_);
      expect(dialog()).toBeNull();
      expect(document.body.style.overflow).toBe('');
      expect(calls.actions).toEqual([
        [ID, 'seen'],
        [ID, 'dismissed'],
      ]);
      expect(calls.events.at(-1)).toEqual([
        'announcement_dismissed',
        { announcement_id: ID, surface: 'modal', via: how },
      ]);
      // The badge outlives the pop-up.
      expect($('[data-testid="nav-badge"]')).not.toBeNull();
    });
  }

  it('its button closes it and files the visit it starts as the pop-up’s', async () => {
    await mount(shell({ announcement: DUE }));
    await sleep(450);
    const cta = $('[data-testid="announcement-cta"]')!;
    expect(cta.getAttribute('href')).toBe('/admin/integrations');
    cta.addEventListener('click', (e) => e.preventDefault());
    await act(async () => cta.click());
    expect(dialog()).toBeNull();
    nav.pathname = '/admin/integrations';
    await act(async () => root!.render(shell({ announcement: DUE })));
    expect(calls.actions).toEqual([
      [ID, 'seen'],
      [ID, 'dismissed'],
      [ID, 'clicked'],
    ]);
    expect(calls.events.at(-1)).toEqual(['announcement_clicked', { announcement_id: ID, surface: 'modal' }]);
  });

  it('does not open again on another load of the same browser session', async () => {
    await mount(shell({ announcement: DUE }));
    await sleep(450);
    await act(async () => root!.unmount());
    host!.remove();
    await mount(shell({ announcement: DUE }));
    await sleep(450);
    expect(dialog()).toBeNull();
  });

  it('never opens once the API says it is done (closed earlier, in any browser)', async () => {
    await mount(shell({ announcement: ANN }));
    await sleep(450);
    expect(dialog()).toBeNull();
  });

  it('never opens on its own page, or in the builder', async () => {
    for (const path of ['/admin/integrations', '/admin/forms/f1/edit']) {
      window.sessionStorage.clear();
      nav.pathname = path;
      await mount(shell({ announcement: DUE }));
      await sleep(450);
      expect(dialog(), path).toBeNull();
      await act(async () => root!.unmount());
      host!.remove();
    }
    root = undefined;
  });

  it('waits for another open dialog to close before it opens', async () => {
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('aria-modal', 'true');
    other.id = 'other-dialog';
    document.body.append(other);
    await mount(shell({ announcement: DUE }));
    await sleep(450);
    expect($('[data-testid="announcement-modal"]')).toBeNull();
    other.remove();
    await sleep(1100);
    expect($('[data-testid="announcement-modal"]')).not.toBeNull();
  });

  it('speaks Spanish', async () => {
    const es = { ...DUE, copy: copy('es').items[ID], closeLabel: copy('es').close };
    await mount(shell({ announcement: es, locale: 'es' }));
    await sleep(450);
    expect($('[data-testid="announcement-close"]')!.getAttribute('aria-label')).toBe('Cerrar anuncio');
    expect($('[data-testid="announcement-cta"]')!.textContent).toContain('Ver integraciones');
  });
});
