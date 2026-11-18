// @vitest-environment happy-dom
/**
 * The Connections grid: opening one card's connect form must not resize the
 * card beside it.
 *
 * Every card is two rows of a subgrid. Its header stretches to the row's
 * tallest header, which lines the buttons up at rest; its body sits at the top
 * of its track at its own height, so only the card that opens grows. The old
 * frame stretched the whole card to the row and pinned the button to the
 * bottom (`mt-auto`), so the neighbour of an open form grew with it and its
 * button slid down to the bottom of a mostly empty card.
 *
 * happy-dom has no layout: this pins the classes that produce the behaviour.
 * The heights themselves were measured in Chromium and WebKit (see the PR).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';

vi.mock('./actions', () => ({
  startGoogleSheetsAuthAction: vi.fn(),
  connectIntegrationAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
  disconnectIntegrationAction: vi.fn(),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

import { ConnectionsPanel } from './connections-panel';

const m = getMessages('en').admin.connections;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <ConnectionsPanel
        initialProviders={[]}
        encryptionAvailable
        dcal={{ createEventUrl: 'https://book.dcal.example/admin/event-types' }}
        messages={m}
        locale="en"
      />,
    );
  });
  return container;
}

const cards = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-testid="connections-grid"] > section')];
const body = (card: HTMLElement) => card.querySelector<HTMLElement>(':scope > [data-testid="card-body"]')!;
const classes = (node: Element) => (node.getAttribute('class') ?? '').split(/\s+/);

async function openConnect(card: HTMLElement) {
  const button = [...card.querySelectorAll('button')].find((b) => b.textContent?.trim() === m.connect)!;
  await act(async () => button.click());
}

describe('the Connections grid', () => {
  it('frames every card, dCal included, as a two-row subgrid: header on top, body at its own height', async () => {
    const all = cards(await mount());
    expect(all.length).toBe(6);
    for (const card of all) {
      expect(classes(card)).toEqual(expect.arrayContaining(['row-span-2', 'grid', 'grid-rows-subgrid', 'gap-y-0']));
      // The section draws nothing: no border or fill to stretch.
      expect(card.className).not.toMatch(/\bborder\b|\bbg-card\b|\brounded-xl\b/);
      const [top, bottom] = [...card.children];
      expect(top!.tagName).toBe('HEADER');
      expect(bottom).toBe(body(card));
      expect(classes(bottom!)).toContain('self-start');
      expect(bottom!.className).not.toContain('mt-auto');
    }
  });

  it('opening HubSpot marks only HubSpot as open; its neighbour keeps its body and its button', async () => {
    const el = await mount();
    const [hubspot, dcal] = cards(el);
    expect(hubspot!.dataset.provider).toBe('hubspot');
    expect(dcal!.dataset.testid).toBe('dcal-card');
    const before = body(dcal!).innerHTML;

    await openConnect(hubspot!);

    expect(hubspot!.dataset.open).toBe('true');
    expect(body(hubspot!).querySelector('.connect-reveal input')).not.toBeNull();
    for (const other of cards(el).slice(1)) expect(other.dataset.open).toBeUndefined();
    expect(body(dcal!).innerHTML).toBe(before);
    expect(classes(body(dcal!))).toContain('self-start');
  });

  it('opening Salesforce leaves HighLevel, beside it, untouched', async () => {
    const el = await mount();
    const salesforce = cards(el).find((c) => c.dataset.provider === 'salesforce')!;
    const highlevel = cards(el).find((c) => c.dataset.provider === 'gohighlevel')!;
    const before = body(highlevel).innerHTML;
    await openConnect(salesforce);
    expect(salesforce.dataset.open).toBe('true');
    expect(highlevel.dataset.open).toBeUndefined();
    expect(body(highlevel).innerHTML).toBe(before);
  });

  it('closes again on Cancel, and the card is no longer marked open', async () => {
    const el = await mount();
    const [hubspot] = cards(el);
    await openConnect(hubspot!);
    const cancel = [...hubspot!.querySelectorAll('button')].find((b) => b.textContent?.trim() === m.cancel)!;
    await act(async () => cancel.click());
    expect(hubspot!.dataset.open).toBeUndefined();
    expect(hubspot!.querySelector('.connect-reveal')).toBeNull();
  });
});
