// @vitest-environment happy-dom
/**
 * The page a form is answered on (#199), as both renderers send it: every
 * partial and complete submit carries the `visit` the host was asked for, the
 * landing's campaign fills `data.utm` when the iframe `src` carried none, the
 * wait for the host overlaps the human check instead of following it, and the
 * builder preview never asks anyone anything.
 *
 * `lib/host-visit` is replaced by a stand-in whose answer the test sets (the
 * protocol itself is covered in `lib/host-visit.spec.ts`), and the server
 * actions are mocked: no request leaves the test.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCaptcha } from '@quill/types';
import { resetTurnstileLoaderForTests, type TurnstileRenderOptions } from '@/lib/captcha';

vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: '--font', style: { fontFamily: 'font' } });
  return {
    DM_Sans: font,
    Figtree: font,
    Fraunces: font,
    IBM_Plex_Mono: font,
    Inter: font,
    Manrope: font,
    Playfair_Display: font,
    Poppins: font,
    Space_Grotesk: font,
    Work_Sans: font,
  };
});

const actions = vi.hoisted(() => ({
  submitFormAction: vi.fn(),
  recordEventAction: vi.fn(async () => undefined),
  recordBookingAction: vi.fn(async () => undefined),
  presignUploadAction: vi.fn(async () => ({ ok: false })),
}));
vi.mock('./actions', () => actions);

/** The host, as the renderer sees it through `createHostVisit`. */
const host = vi.hoisted(() => ({
  created: [] as Array<{ hubspotTracking: boolean; formTitle: string }>,
  started: 0,
  asked: 0,
  answer: undefined as unknown,
}));
vi.mock('@/lib/host-visit', async (importOriginal) => ({
  // The real UTM reader: only the host is played by the test.
  ...(await importOriginal<typeof import('@/lib/host-visit')>()),
  createHostVisit: (opts: { hubspotTracking: boolean; formTitle: string }) => {
    host.created.push(opts);
    return {
      start: () => {
        host.started += 1;
        return () => {};
      },
      resolve: async () => {
        host.asked += 1;
        return host.answer;
      },
    };
  },
}));

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';
import { captureUtm, mergeHostUtm } from './renderer-shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HUTK = '0123456789abcdef0123456789abcdef';
const LANDED = {
  visit: {
    pageUri: 'https://landing.example.com/offer?utm_source=facebook&utm_medium=paid_social',
    pageName: 'Home insurance',
    hutk: HUTK,
    embedded: true,
  },
  hostUtm: { utm_source: 'facebook', utm_medium: 'paid_social' },
};
const CAPTURE = { hubspotTracking: false };
const AUTO: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key' };

const steps = [
  { key: 'email', type: 'email' as const, question: 'Email?' },
  { key: 'company', type: 'text' as const, question: 'Company?' },
];
const slides = { version: 1, steps, partialSubmitAfterStep: 1 } as never;
const onePage = { version: 1, layout: 'vertical', steps, partialSubmitAfterStep: 1 } as never;

let root: Root;
let el: HTMLDivElement;
let renders: Array<{ opts: TurnstileRenderOptions }>;
let observers: { cb: IntersectionObserverCallback; el?: Element }[];

beforeEach(() => {
  resetTurnstileLoaderForTests();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/acme/f/quote?embed=1');
  host.created = [];
  host.started = 0;
  host.asked = 0;
  host.answer = LANDED;
  renders = [];
  observers = [];
  actions.submitFormAction.mockReset();
  actions.submitFormAction.mockImplementation(async () => ({ ok: true, score: 0, outcome: null }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private entry: { cb: IntersectionObserverCallback; el?: Element };
      constructor(cb: IntersectionObserverCallback) {
        this.entry = { cb };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.el = target;
      }
      unobserve() {}
      disconnect() {}
    },
  );
  window.turnstile = {
    render: (_el, opts) => {
      renders.push({ opts });
      return `w${renders.length}`;
    },
    reset: () => {},
    remove: () => {},
  };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  el?.remove();
  delete window.turnstile;
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(node));
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
  [...el.querySelectorAll<HTMLButtonElement>('button.pf__btn')].find((b) => !b.classList.contains('pf__back'))!;
const calls = () => actions.submitFormAction.mock.calls.map((c) => c[2] as Record<string, unknown>);
const completes = () => calls().filter((p) => !p.partial);
const partials = () => calls().filter((p) => p.partial === true);

async function answerSlides() {
  await act(async () => typeInto(el.querySelector<HTMLInputElement>('.pf__fields input')!, 'laura@example.com'));
  await act(async () => button().click());
  await settle();
  await act(async () => typeInto(el.querySelector<HTMLInputElement>('.pf__fields input')!, 'Acme'));
  await act(async () => button().click());
  await settle();
}

async function answerOnePage() {
  const inputs = el.querySelectorAll<HTMLInputElement>('.pf-v__question input');
  await act(async () => typeInto(inputs[0]!, 'laura@example.com'));
  // React listens for `focusout`: this is the email question being left.
  await act(async () => inputs[0]!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  await act(async () => typeInto(inputs[1]!, 'Acme'));
  await settle();
  await act(async () => button().click());
  await settle();
}

describe('mergeHostUtm: the landing campaign, all or nothing', () => {
  it('keeps the iframe src campaign whole when it has one, never mixing in the landing', () => {
    expect(mergeHostUtm({ utm_source: 'newsletter' }, { utm_source: 'facebook', utm_medium: 'paid_social' })).toEqual({
      utm_source: 'newsletter',
    });
  });

  it('takes the landing campaign when the src has none', () => {
    expect(mergeHostUtm({}, { utm_source: 'facebook', utm_medium: 'paid_social' })).toEqual({
      utm_source: 'facebook',
      utm_medium: 'paid_social',
    });
  });

  it('is empty when neither has one', () => {
    expect(mergeHostUtm({}, undefined)).toEqual({});
    expect(mergeHostUtm({}, {})).toEqual({});
  });
});

describe('captureUtm: the form\'s own campaign, read like the landing\'s', () => {
  it('drops a pair whose key carries a control, and removes controls from values', () => {
    window.history.replaceState(null, '', '/acme/f/quote?embed=1&utm_%00=1&utm_source=newsletter&utm_medium=%00&utm_term=a%00b');
    const utm = captureUtm();
    expect(utm).toEqual({ utm_source: 'newsletter', utm_term: 'ab' });
    expect(JSON.stringify(utm)).not.toMatch(/\\u00[01][0-9a-f]/i);
  });
});

describe('slides: the visit on every submit', () => {
  it('sends the visit and the landing campaign with the partial and the complete', async () => {
    await mount(<FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" visitCapture={CAPTURE} />);
    expect(host.created).toEqual([{ hubspotTracking: false, formTitle: 'Quote' }]);
    expect(host.started).toBe(1);
    await answerSlides();
    expect(partials()).toHaveLength(1);
    expect(completes()).toHaveLength(1);
    for (const payload of [...partials(), ...completes()]) {
      expect(payload.visit).toEqual(LANDED.visit);
      expect((payload.data as { utm: unknown }).utm).toEqual(LANDED.hostUtm);
    }
    expect(host.asked).toBe(2); // once per submit, never per retry
  });

  it('lets the campaign on the iframe src win, whole', async () => {
    window.history.replaceState(null, '', '/acme/f/quote?embed=1&utm_source=newsletter');
    await mount(<FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" visitCapture={CAPTURE} />);
    await answerSlides();
    expect((completes()[0]!.data as { utm: unknown }).utm).toEqual({ utm_source: 'newsletter' });
    expect(completes()[0]!.visit).toEqual(LANDED.visit);
  });

  it('submits without a visit, as ever, when none could be had', async () => {
    host.answer = undefined; // the page switched it off
    await mount(<FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" visitCapture={CAPTURE} />);
    await answerSlides();
    expect(completes()[0]).not.toHaveProperty('visit');
    expect(completes()[0]!.data).not.toHaveProperty('utm');
  });

  it('passes the form tracking switch on, for the direct-link cookie', async () => {
    await mount(
      <FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" visitCapture={{ hubspotTracking: true }} />,
    );
    expect(host.created).toEqual([{ hubspotTracking: true, formTitle: 'Quote' }]);
  });
});

describe('one page: the visit on every submit', () => {
  it('sends the visit and the landing campaign with the partial and the complete', async () => {
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="Quote" config={onePage} locale="en" visitCapture={CAPTURE} />);
    await answerOnePage();
    expect(partials()).toHaveLength(1);
    expect(completes()).toHaveLength(1);
    for (const payload of calls()) {
      expect(payload.visit).toEqual(LANDED.visit);
      expect((payload.data as { utm: unknown }).utm).toEqual(LANDED.hostUtm);
    }
  });
});

describe('the builder preview', () => {
  it('asks no host and sends no visit, in either layout', async () => {
    await mount(<FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" />);
    await answerSlides();
    await act(async () => root.unmount());
    el.remove();
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="Quote" config={onePage} locale="en" />);
    await answerOnePage();
    expect(host.created).toEqual([]);
    expect(calls().length).toBeGreaterThan(0);
    for (const payload of calls()) expect(payload).not.toHaveProperty('visit');
  });
});

describe('with spam protection on', () => {
  async function scrollToEnd() {
    await act(async () => {
      for (const o of observers) {
        if (o.el) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    });
    await settle();
  }

  it('asks the host the moment Submit is pressed, while the check runs, and sends ONE submit with both', async () => {
    const config = { version: 1, layout: 'vertical', steps } as never;
    await mount(
      <VerticalFormRenderer accountCode="acme" slug="f" name="Quote" config={config} locale="en" captcha={AUTO} visitCapture={CAPTURE} />,
    );
    const inputs = el.querySelectorAll<HTMLInputElement>('.pf-v__question input');
    await act(async () => typeInto(inputs[0]!, 'laura@example.com'));
    await act(async () => typeInto(inputs[1]!, 'Acme'));
    await scrollToEnd();
    await act(async () => button().click());
    await settle();
    // The check has not answered yet, and the host was already asked.
    expect(host.asked).toBe(1);
    expect(actions.submitFormAction).not.toHaveBeenCalled();

    await act(async () => renders[0]!.opts.callback!('tok-1'));
    await settle();
    expect(completes()).toHaveLength(1);
    expect(completes()[0]).toMatchObject({ captchaToken: 'tok-1', visit: LANDED.visit });
  });

  it('keeps the visit it asked for through the automatic retry of a refused check', async () => {
    actions.submitFormAction.mockImplementationOnce(async () => ({ ok: false, error: 'CAPTCHA_FAILED', message: 'x' }));
    const config = { version: 1, layout: 'vertical', steps } as never;
    await mount(
      <VerticalFormRenderer accountCode="acme" slug="f" name="Quote" config={config} locale="en" captcha={AUTO} visitCapture={CAPTURE} />,
    );
    const inputs = el.querySelectorAll<HTMLInputElement>('.pf-v__question input');
    await act(async () => typeInto(inputs[0]!, 'laura@example.com'));
    await act(async () => typeInto(inputs[1]!, 'Acme'));
    await scrollToEnd();
    await act(async () => renders[0]!.opts.callback!('first'));
    await act(async () => button().click());
    await settle();
    await act(async () => renders[1]!.opts.callback!('second'));
    await settle();
    expect(completes()).toHaveLength(2);
    expect(completes().map((p) => p.visit)).toEqual([LANDED.visit, LANDED.visit]);
    expect(host.asked).toBe(1);
  });

  it('keeps the visit on the partial it saves when the check is unavailable', async () => {
    const config = { version: 1, layout: 'vertical', steps } as never;
    await mount(
      <VerticalFormRenderer accountCode="acme" slug="f" name="Quote" config={config} locale="en" captcha={AUTO} visitCapture={CAPTURE} />,
    );
    const inputs = el.querySelectorAll<HTMLInputElement>('.pf-v__question input');
    await act(async () => typeInto(inputs[0]!, 'laura@example.com'));
    await act(async () => typeInto(inputs[1]!, 'Acme'));
    await scrollToEnd();
    await act(async () => button().click());
    await settle();
    // The widget fails twice: the answers are kept as a partial, visit and all.
    await act(async () => renders[0]!.opts['error-callback']!('600010'));
    await settle();
    await act(async () => renders[1]!.opts['error-callback']!('600010'));
    await settle();
    expect(partials()).toHaveLength(1);
    expect(partials()[0]!.visit).toEqual(LANDED.visit);
    expect(host.asked).toBe(1);
  });
});
