// @vitest-environment happy-dom
/**
 * The Home's top row: the agents banner alone and full width when there is no
 * announcement banner; with one, two banners with the same three parts (title
 * and line, a sliding row of logo chips, the button), side by side from a
 * 60rem content width and stacked below it, agents first. The integrations
 * banner has no close button, and its button files the visit as the banner's.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCEMENTS, getMessages, type Locale } from '@quill/shared';

const calls = vi.hoisted(() => ({ events: [] as [string, unknown][] }));
vi.mock('@/app/admin/announcement-actions', () => ({ recordAnnouncementAction: async () => ({ ok: true }) }));
vi.mock('@/lib/product-analytics', () => ({
  captureEvent: (event: string, props: unknown) => calls.events.push([event, props]),
}));

import { AgentBanner } from './agent-banner';
import { HomeTopRow } from './home-banner';
import { IntegrationsBanner } from './integrations-banner';
import { resetAnnouncementLoad, takeAnnouncementSurface } from '@/components/announcement/announcement-client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const a = ANNOUNCEMENTS.find((x) => x.id === 'integrations-2026-11')!;

function row(locale: Locale = 'en', withBanner = true) {
  const m = getMessages(locale).admin;
  return (
    <HomeTopRow split={withBanner}>
      <AgentBanner m={m.home.agentBanner} layout={withBanner ? 'split' : 'wide'} />
      {withBanner ? (
        <IntegrationsBanner id={a.id} copy={m.announcements.items[a.copy]} cta={a.cta} logos={a.banner!.logos} />
      ) : null}
    </HomeTopRow>
  );
}

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

let root: Root | undefined;
let host: HTMLDivElement | undefined;
beforeEach(() => {
  calls.events = [];
  window.sessionStorage.clear();
  resetAnnouncementLoad();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
});

describe('HomeTopRow', () => {
  it('without an announcement banner, keeps the agents banner alone and wide, as before', () => {
    const doc = parse(renderToStaticMarkup(row('en', false)));
    expect(doc.querySelector('[data-testid="home-top-row"]')).toBeNull();
    expect(doc.querySelector('[data-testid="home-agent-banner"]')!.getAttribute('data-layout')).toBeNull();
    expect(doc.querySelector('[data-testid="home-announcement-banner"]')).toBeNull();
  });

  it('with one, sets two banners side by side from 60rem, stacked below, agents first', () => {
    const doc = parse(renderToStaticMarkup(row()));
    const grid = doc.querySelector('[data-testid="home-top-row"] > div')!;
    expect(doc.querySelector('[data-testid="home-top-row"]')!.className).toContain('@container');
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('@min-[60rem]:grid-cols-2');
    const banners = [...grid.children].map((el) => el.getAttribute('data-testid'));
    expect(banners).toEqual(['home-agent-banner', 'home-announcement-banner']);
  });

  it('gives both banners the same three parts, on a shared subgrid', () => {
    const doc = parse(renderToStaticMarkup(row()));
    for (const id of ['home-agent-banner', 'home-announcement-banner']) {
      const b = doc.querySelector(`[data-testid="${id}"]`)!;
      expect(b.getAttribute('data-layout')).toBe('split');
      expect(b.className).toContain('@min-[60rem]:grid-rows-subgrid');
      expect(b.className).toContain('@min-[60rem]:row-span-3');
      const parts = [...b.children];
      expect(parts).toHaveLength(3);
      expect(parts[0]!.querySelector('h2')).not.toBeNull();
      expect(parts[1]!.className).toContain('ap-marquee');
      expect(parts[2]!.querySelector('a')).not.toBeNull();
    }
    // Green for the agents, neutral for the announcement.
    expect(doc.querySelector('[data-testid="home-agent-banner"]')!.className).toContain('border-signal/40');
    expect(doc.querySelector('[data-testid="home-announcement-banner"]')!.className).toContain('border-border');
  });

  it('says the integrations news in both languages, with its marks sliding, and no close button', () => {
    for (const locale of ['en', 'es'] as const) {
      const copy = getMessages(locale).admin.announcements.items[a.copy];
      const doc = parse(renderToStaticMarkup(row(locale)));
      const b = doc.querySelector('[data-testid="home-announcement-banner"]')!;
      expect(b.querySelector('h2')!.textContent).toBe(copy.title);
      expect(b.textContent).toContain(copy.body);
      const cta = b.querySelector<HTMLAnchorElement>('[data-testid="home-announcement-banner-cta"]')!;
      expect(cta.getAttribute('href')).toBe('/admin/integrations');
      expect(cta.textContent).toContain(locale === 'en' ? 'See integrations' : 'Ver integraciones');
      expect(b.querySelector('button')).toBeNull();
      // Twice, for a seamless loop; both copies hidden, one plain list for screen readers.
      const lists = b.querySelectorAll('[data-testid="home-announcement-marquee"] ul');
      expect(lists).toHaveLength(2);
      expect(lists[1]!.className).toContain('ap-marquee__copy');
      expect([...lists[0]!.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'HighLevel',
        'Salesforce',
        'Google Sheets',
        'HubSpot',
        'Calendly',
        'dCal',
      ]);
      expect(b.querySelector('.sr-only')!.textContent).toBe('HighLevel, Salesforce, Google Sheets, HubSpot, Calendly, dCal');
    }
  });

  it('files the visit its button starts as the banner’s, and tells analytics it was seen', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(row()));
    expect(calls.events).toEqual([['announcement_seen', { announcement_id: a.id, surface: 'banner' }]]);
    const cta = document.querySelector<HTMLElement>('[data-testid="home-announcement-banner-cta"]')!;
    cta.addEventListener('click', (e) => e.preventDefault());
    await act(async () => cta.click());
    expect(takeAnnouncementSurface()).toBe('banner');
  });
});
