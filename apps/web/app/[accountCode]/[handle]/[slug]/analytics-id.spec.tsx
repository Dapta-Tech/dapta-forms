// @vitest-environment happy-dom
/**
 * The response's analytics id, through both real renderers with the transport
 * mocked: every submit of one response carries the same id, a new response
 * gets a new one, and a redirect to the deployment's own landing hands it over
 * as `ph_id` on every way out (immediate, delayed, after a booking, embedded),
 * while a redirect anywhere else leaves exactly as it did before.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    Hanken_Grotesk: font,
    JetBrains_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});

const actions = vi.hoisted(() => ({
  submitForm: vi.fn(),
  recordEvent: vi.fn(async () => undefined),
  recordEvents: vi.fn(async () => undefined),
  recordBooking: vi.fn(async () => undefined),
  presignUpload: vi.fn(async () => ({ ok: false })),
}));
vi.mock('./transport', () => actions);

const nav = vi.hoisted(() => ({ navigateTop: vi.fn() }));
vi.mock('@/lib/top-navigate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/top-navigate')>()),
  navigateTop: nav.navigateTop,
}));

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = 'quill-form-acme-f';
const emailStep = { key: 'email', type: 'email' as const, question: 'Email?' };
const companyStep = { key: 'company', type: 'text' as const, question: 'Company?' };

let root: Root | undefined;
let el: HTMLDivElement | undefined;

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/acme/f/quote');
  nav.navigateTop.mockReset();
  actions.submitForm.mockReset();
  actions.submitForm.mockImplementation(async () => ({ ok: true, score: 0, outcome: 'all' }));
  vi.stubEnv('NEXT_PUBLIC_LANDING_URL', 'https://dforms.ai/');
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(node));
}

async function unmount() {
  await act(async () => root?.unmount());
  el?.remove();
  root = undefined;
  el = undefined;
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = () =>
  [...el!.querySelectorAll<HTMLButtonElement>('button.pf__btn')].find((b) => !b.classList.contains('pf__back'))!;

async function answerSlides() {
  await act(async () => typeInto(el!.querySelector<HTMLInputElement>('.pf__fields input')!, 'ana@example.com'));
  await act(async () => button().click());
  await settle();
  await act(async () => typeInto(el!.querySelector<HTMLInputElement>('.pf__fields input')!, 'Acme'));
  await act(async () => button().click());
  await settle();
}

async function answerOnePage() {
  const inputs = el!.querySelectorAll<HTMLInputElement>('.pf-v__question input');
  await act(async () => typeInto(inputs[0]!, 'ana@example.com'));
  await act(async () => typeInto(inputs[1]!, 'Acme'));
  await settle();
  await act(async () => button().click());
  await settle();
}

type Payload = { sessionId: string; analyticsId?: string; partial?: boolean };
const payloads = () => actions.submitForm.mock.calls.map((c) => c[2] as Payload);

const layouts = [
  { name: 'slides', vertical: false, answer: answerSlides },
  { name: 'one page', vertical: true, answer: answerOnePage },
] as const;

function render(vertical: boolean, config: Record<string, unknown>) {
  const full = { version: 1, ...(vertical ? { layout: 'vertical' } : {}), steps: [emailStep, companyStep], ...config } as never;
  return vertical ? (
    <VerticalFormRenderer accountCode="acme" slug="f" name="Quote" config={full} locale="en" />
  ) : (
    <FormRenderer accountCode="acme" slug="f" name="Quote" config={full} locale="en" />
  );
}

describe.each(layouts)('$name: one analytics id per response', ({ vertical, answer }) => {
  it('the partial and the complete carry the same id, a new response gets a new one', async () => {
    // A threshold makes the renderer save a partial on the first question.
    const config = { partialSubmitAfterStep: 1 };
    await mount(render(vertical, config));
    await answer();
    const first = payloads();
    expect(first.length).toBeGreaterThan(0);
    const id = first[0]!.analyticsId!;
    expect(id).toMatch(UUID_V7);
    expect(id).not.toBe(first[0]!.sessionId);
    for (const p of first) expect(p.analyticsId).toBe(id);
    // Released with the session once the complete was confirmed.
    expect(window.sessionStorage.getItem(`${KEY}#aid`)).toBeNull();

    actions.submitForm.mockClear();
    await unmount();
    await mount(render(vertical, config));
    await answer();
    const second = payloads();
    expect(second.length).toBeGreaterThan(0);
    for (const p of second) expect(p.analyticsId).toMatch(UUID_V7);
    expect(second[0]!.analyticsId).not.toBe(id);
  });

  it('a reload mid-response keeps the id, like the session', async () => {
    await mount(render(vertical, {}));
    const stored = window.sessionStorage.getItem(`${KEY}#aid`);
    expect(stored).toMatch(UUID_V7);
    await unmount();
    await mount(render(vertical, {}));
    expect(window.sessionStorage.getItem(`${KEY}#aid`)).toBe(stored);
  });
});

describe('the redirect hands the id to the landing only', () => {
  const LANDING = 'https://dforms.ai/ventas/?utm_source=ig_homerovende&utm_campaign=vsl_ventas#top';
  const ELSEWHERE = 'https://example.com/welcome?src=form#top';
  const BOOKING = { provider: 'hubspot_meetings', url: 'https://meetings.hubspot.com/example/demo' };

  const configFor = (path: 'immediate' | 'delayed' | 'booking', url: string, forwardUtm?: boolean) =>
    path === 'booking'
      ? {
          scoring: { enabled: true },
          outcomes: [{ id: 'all', label: 'Book', minScore: 0, redirectUrl: url, booking: BOOKING }],
          ...(forwardUtm !== undefined ? { ending: { forwardUtm } } : {}),
        }
      : {
          ending: {
            redirectUrl: url,
            ...(path === 'delayed' ? { redirectDelayMs: 30 } : {}),
            ...(forwardUtm !== undefined ? { forwardUtm } : {}),
          },
        };

  async function run(
    path: 'immediate' | 'delayed' | 'booking',
    vertical: boolean,
    url: string,
    opts: { embedded?: boolean; utm?: string; forwardUtm?: boolean } = {},
  ): Promise<{ to: string; id: string }> {
    const query = [opts.embedded ? 'embed=1' : '', opts.utm ?? ''].filter(Boolean).join('&');
    window.history.replaceState(null, '', query ? `/acme/f/quote?${query}` : '/acme/f/quote');
    await mount(render(vertical, configFor(path, url, opts.forwardUtm)));
    await (vertical ? answerOnePage() : answerSlides());
    if (path === 'delayed') {
      for (let i = 0; i < 40 && nav.navigateTop.mock.calls.length === 0; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
      }
    }
    if (path === 'booking') {
      expect(nav.navigateTop).not.toHaveBeenCalled();
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', { origin: 'https://meetings.hubspot.com', data: { meetingBookSucceeded: true } }),
        );
      });
      await settle();
    }
    expect(nav.navigateTop).toHaveBeenCalledTimes(1);
    return { to: nav.navigateTop.mock.calls[0]![0] as string, id: payloads()[0]!.analyticsId! };
  }

  for (const { name, vertical } of layouts) {
    for (const path of ['immediate', 'delayed', 'booking'] as const) {
      it(`${name}, ${path}: the landing gets ph_id, the same id the submit carried`, async () => {
        const { to, id } = await run(path, vertical, LANDING);
        expect(id).toMatch(UUID_V7);
        expect(to).toBe(
          `https://dforms.ai/ventas/?utm_source=ig_homerovende&utm_campaign=vsl_ventas&ph_id=${id}#top`,
        );
      });

      it(`${name}, ${path}: embedded, the landing still gets ph_id`, async () => {
        const { to, id } = await run(path, vertical, LANDING, { embedded: true });
        expect(new URL(to).searchParams.get('ph_id')).toBe(id);
      });

      it(`${name}, ${path}: any other host leaves byte-identical`, async () => {
        const { to } = await run(path, vertical, ELSEWHERE);
        expect(to).toBe(ELSEWHERE);
      });

      it(`${name}, ${path}: forwardUtm behaves as before, and ph_id rides along`, async () => {
        const plain = 'https://dforms.ai/ventas/';
        const on = await run(path, vertical, plain, { utm: 'utm_source=google', forwardUtm: true });
        expect(on.to).toBe(`https://dforms.ai/ventas/?utm_source=google&ph_id=${on.id}`);
        await unmount();
        nav.navigateTop.mockReset();
        actions.submitForm.mockClear();
        window.sessionStorage.clear();
        const off = await run(path, vertical, plain, { utm: 'utm_source=google' });
        expect(off.to).toBe(`https://dforms.ai/ventas/?ph_id=${off.id}`);
      });
    }
  }

  it('with no landing configured (a bare fork) every redirect leaves untouched', async () => {
    vi.stubEnv('NEXT_PUBLIC_LANDING_URL', '');
    const { to } = await run('immediate', false, LANDING);
    expect(to).toBe(LANDING);
  });
});
