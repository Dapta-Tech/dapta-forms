// @vitest-environment happy-dom
/**
 * The dCal picker, and above all its EMPTY state.
 *
 * An author with no event type in dCal is not misconfigured, so this must not
 * read as an error: it offers the two things they might actually do. Switch
 * workspace, but only when they have another one to switch to, and create one
 * in dCal, in a new tab so the half-built form is not navigated away from.
 *
 * The refresh is the part worth pinning hardest. The server caches the list
 * for five minutes, which is exactly the window an author who just created an
 * event is pressing this in, so the request has to carry `refresh=1`. Without
 * it the button looks like it works and changes nothing, which is worse than
 * having no button at all.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FormStep } from '@quill/engine';
import type { DcalEventTypesResponse } from '@/lib/admin-api';
import { SchedulerDcalPicker } from './scheduler-dcal';
import { getBuilderMessages } from './builder-messages';

const s = getBuilderMessages('en').settings;

const EVENT = {
  id: 'et_1',
  name: 'Intro call',
  schedulingUrl: 'https://cal.example.test/acme/ana/intro-call',
  active: true,
  durationMinutes: 30,
  teamName: null,
  bookingFields: [{ name: 'company', label: 'Company', type: 'text', required: true }],
};

/** Answers captured before the scheduler, the only ones a mapping may use. */
const FIELDS = [
  { key: 'email_1', label: 'What is your email?' },
  { key: 'company_1', label: 'Where do you work?' },
];

const ONE_WORKSPACE = [{ id: 'ws_1', name: 'Acme', current: true }];
const TWO_WORKSPACES = [
  { id: 'ws_1', name: 'Acme', current: true },
  { id: 'ws_2', name: 'Northwind', current: false },
];

let root: Root | null = null;
let container: HTMLElement | null = null;
const fetchMock = vi.fn();

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  fetchMock.mockReset();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Answer every list read with this body. */
function answer(body: DcalEventTypesResponse) {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => body }));
}

function ready(over: Partial<Extract<DcalEventTypesResponse, { enabled: true }>> = {}): DcalEventTypesResponse {
  return {
    enabled: true,
    cached: false,
    connectedAs: 'ana@example.com',
    workspaces: ONE_WORKSPACE,
    eventTypes: [],
    createEventUrl: 'https://cal.example.test/admin/event-types',
    ...over,
  };
}

async function mount(
  scheduler: NonNullable<FormStep['scheduler']> = { provider: 'dcal' },
  onChange: (next: NonNullable<FormStep['scheduler']>) => void = () => {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <SchedulerDcalPicker scheduler={scheduler} onChange={onChange} fields={FIELDS} s={s} />,
    );
  });
  return container;
}

/** The query of every list read, in order. */
const reads = () =>
  fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost').searchParams);

describe('the dCal picker with no event type yet', () => {
  it('says so, and offers to create one in dCal in a new tab', async () => {
    answer(ready());
    const el = await mount();
    expect(el.querySelector('[data-testid="scheduler-dcal-empty"]')).not.toBeNull();
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="scheduler-dcal-create"]')!;
    expect(link.getAttribute('href')).toBe('https://cal.example.test/admin/event-types');
    expect(link.getAttribute('target')).toBe('_blank');
    // Without `noopener` the opened tab can reach back into this one.
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('asks the server to drop its cached list when refresh is pressed', async () => {
    answer(ready());
    const el = await mount();
    expect(reads()[0]!.get('refresh')).toBeNull();
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="scheduler-dcal-refresh"]')!.click());
    expect(reads().at(-1)!.get('refresh')).toBe('1');
  });

  it('shows the event type once it exists, and drops the empty state', async () => {
    answer(ready());
    const el = await mount();
    answer(ready({ eventTypes: [EVENT] }));
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="scheduler-dcal-refresh"]')!.click());
    expect(el.querySelector('[data-testid="scheduler-dcal-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="scheduler-dcal-event-type"]')).not.toBeNull();
  });

  it('offers to switch workspace only when there is another one', async () => {
    answer(ready({ workspaces: ONE_WORKSPACE }));
    const alone = await mount();
    expect(alone.querySelector('[data-testid="scheduler-dcal-workspace"]')).toBeNull();
    expect(alone.textContent).not.toContain(s.schedulerDcalEmptySwitch);

    await act(async () => root?.unmount());
    container?.remove();
    answer(ready({ workspaces: TWO_WORKSPACES }));
    const several = await mount();
    expect(several.querySelector('[data-testid="scheduler-dcal-workspace"]')).not.toBeNull();
    expect(several.textContent).toContain(s.schedulerDcalEmptySwitch);
  });
});

describe('the dCal picker with event types', () => {
  it('stores the id, the name and the public URL of the picked event', async () => {
    answer(ready({ eventTypes: [EVENT] }));
    const seen: NonNullable<FormStep['scheduler']>[] = [];
    const el = await mount({ provider: 'dcal' }, (next) => seen.push(next));
    // `Select` is a listbox, not a native `<select>`: its trigger opens a
    // `role="option"` list, and each option is its own button.
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[data-testid="scheduler-dcal-event-type"] button')!.click(),
    );
    await act(async () => {
      const option = [...el.querySelectorAll<HTMLElement>('[role="option"] button')].find((o) =>
        o.textContent?.includes(EVENT.name),
      );
      option!.click();
    });
    expect(seen.at(-1)).toMatchObject({
      provider: 'dcal',
      eventTypeUri: EVENT.id,
      eventTypeName: EVENT.name,
      url: EVENT.schedulingUrl,
      // The old mapping cannot carry over: its keys are the previous
      // provider's field ids, so they would prefill the wrong question.
      prefillMap: {},
    });
  });

  it('names the team on a team event, so it reads apart from the author’s own', async () => {
    answer(ready({ eventTypes: [{ ...EVENT, id: 'et_2', name: 'Demo', teamName: 'Sales' }] }));
    // Preselected, so the team rides the trigger's own label: the option list
    // is only in the DOM while the listbox is open.
    const el = await mount({ provider: 'dcal', eventTypeUri: 'et_2' });
    expect(el.querySelector('[data-testid="scheduler-dcal-event-type"]')!.textContent).toContain('Sales');
  });

  it('says whose list it is', async () => {
    answer(ready({ eventTypes: [EVENT] }));
    const el = await mount();
    expect(el.textContent).toContain('ana@example.com');
  });
});

describe('the dCal picker when dCal is not there', () => {
  it('says it is unavailable rather than telling the author to connect something', async () => {
    // There is no credential to connect, so "connect dCal" would be a dead end.
    answer({ enabled: false, reason: 'This deployment has no dCal configured (DCAL_API_BASE_URL).' });
    const el = await mount();
    expect(el.textContent).toContain(s.schedulerDcalUnavailable);
    expect(el.querySelector('[data-testid="scheduler-dcal-empty"]')).toBeNull();
  });

  it('words each refusal by its cause, not all of them as a missing dCal', async () => {
    const cases = [
      ['not_configured', s.schedulerDcalUnavailable],
      ['session_rejected', s.schedulerDcalSignIn],
      // A fork on local auth forwards no session; signing in cannot fix it.
      ['no_session', s.schedulerDcalUnavailable],
      ['no_booking_page', s.schedulerDcalNoPage],
      ['dcal_error', s.schedulerDcalError],
    ] as const;
    for (const [code, sentence] of cases) {
      answer({ enabled: false, code, reason: 'operator text' });
      const el = await mount();
      const box = el.querySelector('[data-testid="scheduler-dcal-unavailable"]')!;
      expect(box.getAttribute('data-code'), code).toBe(code);
      expect(box.textContent, code).toContain(sentence);
      // "Not available on this deployment" is true of one cause only.
      if (code !== 'not_configured' && code !== 'no_session') {
        expect(box.textContent, code).not.toContain(s.schedulerDcalUnavailable);
      }
      await act(async () => root?.unmount());
      container?.remove();
    }
  });

  it('links to setting up a booking page, in a new tab, and re-reads past the cache', async () => {
    answer({
      enabled: false,
      code: 'no_booking_page',
      reason: 'dCal has no booking page for this user yet.',
      setupUrl: 'https://cal.example.test/admin',
    });
    const el = await mount();
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="scheduler-dcal-setup"]')!;
    expect(link.textContent).toContain(s.schedulerDcalNoPageLink);
    expect(link.getAttribute('href')).toBe('https://cal.example.test/admin');
    expect(link.getAttribute('target')).toBe('_blank');
    answer(ready({ eventTypes: [EVENT] }));
    await act(async () =>
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes(s.schedulerDcalRefresh))!
        .click(),
    );
    expect(reads().at(-1)?.get('refresh')).toBe('1');
    expect(el.querySelector('[data-testid="scheduler-dcal-event-type"]')).not.toBeNull();
  });

  it('offers a retry when dCal itself errored', async () => {
    answer({ enabled: false, code: 'dcal_error', reason: 'dCal did not answer the session check.' });
    const el = await mount();
    answer(ready({ eventTypes: [EVENT] }));
    await act(async () =>
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes(s.schedulerRetry))!
        .click(),
    );
    expect(el.querySelector('[data-testid="scheduler-dcal-event-type"]')).not.toBeNull();
  });

  it('reads an answer with no code, from an older API, as not configured', async () => {
    answer({ enabled: false, reason: 'whatever' });
    const el = await mount();
    expect(el.textContent).toContain(s.schedulerDcalUnavailable);
  });

  it('offers a retry when the list request itself failed', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503 }));
    const el = await mount();
    expect(el.textContent).toContain(s.schedulerListError);
    answer(ready({ eventTypes: [EVENT] }));
    await act(async () =>
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes(s.schedulerRetry))!
        .click(),
    );
    expect(el.querySelector('[data-testid="scheduler-dcal-event-type"]')).not.toBeNull();
  });
});

describe('the autofill mapping', () => {
  it('appears only once an event type is picked', async () => {
    answer(ready({ eventTypes: [EVENT] }));
    const none = await mount();
    expect(none.querySelector('[data-testid="scheduler-dcal-map"]')).toBeNull();

    await act(async () => root?.unmount());
    container?.remove();
    answer(ready({ eventTypes: [EVENT] }));
    const picked = await mount({ provider: 'dcal', eventTypeUri: EVENT.id });
    expect(picked.querySelector('[data-testid="scheduler-dcal-map"]')).not.toBeNull();
  });

  it('offers the three fields dCal always asks, then the event’s own', async () => {
    answer(ready({ eventTypes: [EVENT] }));
    const el = await mount({ provider: 'dcal', eventTypeUri: EVENT.id });
    for (const name of ['name', 'email', 'notes', 'company']) {
      expect(el.querySelector(`[data-testid="scheduler-dcal-map-${name}"]`), name).not.toBeNull();
    }
  });

  it('writes the mapping under the field’s NAME, which is what dCal prefills by', async () => {
    answer(ready({ eventTypes: [EVENT] }));
    const seen: NonNullable<FormStep['scheduler']>[] = [];
    const el = await mount({ provider: 'dcal', eventTypeUri: EVENT.id }, (next) => seen.push(next));
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[data-testid="scheduler-dcal-map-company"] button')!.click(),
    );
    await act(async () => {
      const option = [...el.querySelectorAll<HTMLElement>('[role="option"] button')].find((o) =>
        o.textContent?.includes('Where do you work?'),
      );
      option!.click();
    });
    expect(seen.at(-1)?.prefillMap).toEqual({ company: 'company_1' });
  });

  it('says, beside Notes, what Automatic fills it from', async () => {
    answer(ready({ eventTypes: [EVENT] }));
    const auto = await mount({ provider: 'dcal', eventTypeUri: EVENT.id });
    const notesRow = auto.querySelector('[data-testid="scheduler-dcal-map-notes"]')!.parentElement!;
    expect(notesRow.textContent).toContain(s.schedulerMapNotesAuto);
    // Only Notes: Automatic for name and email finds the obvious question.
    const emailRow = auto.querySelector('[data-testid="scheduler-dcal-map-email"]')!.parentElement!;
    expect(emailRow.textContent).not.toContain(s.schedulerMapNotesAuto);
    await act(async () => root?.unmount());
    container?.remove();

    answer(ready({ eventTypes: [EVENT] }));
    const mapped = await mount({ provider: 'dcal', eventTypeUri: EVENT.id, prefillMap: { notes: 'company_1' } });
    expect(mapped.textContent).not.toContain(s.schedulerMapNotesAuto);
  });

  it('maps nothing for an event whose form asks nothing extra', async () => {
    answer(ready({ eventTypes: [{ ...EVENT, bookingFields: [] }] }));
    const el = await mount({ provider: 'dcal', eventTypeUri: EVENT.id });
    expect(el.querySelector('[data-testid="scheduler-dcal-map-company"]')).toBeNull();
    // The three built-ins are still there: every dCal booking form asks them.
    expect(el.querySelector('[data-testid="scheduler-dcal-map-email"]')).not.toBeNull();
  });
});
