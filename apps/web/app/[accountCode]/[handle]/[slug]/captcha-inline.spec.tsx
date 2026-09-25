// @vitest-environment happy-dom
/**
 * Spam protection's check right above the button that ends the form, driven
 * through both real renderers: the widget waits for the person to start AND
 * for the button area to be on screen, a click on the button submits right
 * there (the button says it is sending, the page never swaps to the
 * submitting screen), and a refusal lands next to the button with every
 * answer intact. A slides finish with no button keeps the submitting screen.
 *
 * The provider's browser API and the IntersectionObserver are stand-ins, and
 * the server actions are mocked: no request leaves the test.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';
import type { PublicCaptcha } from '@quill/types';
import { resetTurnstileLoaderForTests, type TurnstileRenderOptions } from '@/lib/captcha';

// `next/font/google` resolves at build time and has no runtime in vitest.
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

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('en').renderer;
const AUTO: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key' };
const STRICT: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key', strict: true };

const textSteps = [
  { key: 'email', type: 'email' as const, question: 'Email?' },
  { key: 'company', type: 'text' as const, question: 'Company?' },
];
const choiceLast = [
  { key: 'email', type: 'email' as const, question: 'Email?' },
  {
    key: 'size',
    type: 'multiple_choice' as const,
    question: 'Size?',
    options: [
      { label: 'Small', value: 'small' },
      { label: 'Large', value: 'large' },
    ],
  },
];

interface Rendered {
  el: HTMLElement;
  opts: TurnstileRenderOptions;
}
let renders: Rendered[];
let observers: { cb: IntersectionObserverCallback; el?: Element }[];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  resetTurnstileLoaderForTests();
  window.sessionStorage.clear();
  document.head.querySelectorAll('link[rel="preconnect"]').forEach((l) => l.remove());
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
      observe(el: Element) {
        this.entry.el = el;
      }
      unobserve() {}
      disconnect() {}
    },
  );
  window.turnstile = {
    render: (el, opts) => {
      renders.push({ el, opts });
      return `w${renders.length}`;
    },
    reset: () => {},
    remove: () => {},
  };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  delete window.turnstile;
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(node));
}

/** Let the submit's promise chain run to its end. */
async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Everything the page watches with an observer comes into view. */
async function scrollToEnd() {
  await act(async () => {
    for (const o of observers) {
      if (o.el) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
  await settle();
}

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const submitButton = () =>
  [...host.querySelectorAll<HTMLButtonElement>('button.pf__btn')].find((b) => !b.classList.contains('pf__back'))!;

async function fillOnePage() {
  const inputs = host.querySelectorAll<HTMLInputElement>('.pf-v__question input');
  await act(async () => typeInto(inputs[0]!, 'laura@example.com'));
  await act(async () => typeInto(inputs[1]!, 'Acme'));
}

describe('one-page: the check right above Submit', () => {
  it('loads nothing for a person who answers but never reaches the end', async () => {
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps: textSteps } as never} locale="en" captcha={AUTO} />);
    const slot = q('.pf-v__footer [data-testid="captcha-inline"]')!;
    expect(slot).not.toBeNull();
    // The slot sits right before the button.
    expect(slot.nextElementSibling).toBe(submitButton());
    await fillOnePage();
    expect(renders).toHaveLength(0);
    // Not even the connection warm-up: the one-page form waits for its end.
    expect(document.head.querySelector('link[rel="preconnect"]')).toBeNull();
    await scrollToEnd();
    expect(renders).toHaveLength(1);
    expect(renders[0]!.opts.appearance).toBe('interaction-only');
    expect(slot.contains(renders[0]!.el)).toBe(true);
  });

  it('loads nothing for a visitor who only looks, even with the end on screen', async () => {
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps: textSteps } as never} locale="en" captcha={AUTO} />);
    await scrollToEnd();
    expect(renders).toHaveLength(0);
    // A short form fits on one screen: the first answer is what starts it.
    await fillOnePage();
    await settle();
    expect(renders).toHaveLength(1);
  });

  it('a click before the token: the button sends, the page stays, and the submit goes once the token lands', async () => {
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps: textSteps } as never} locale="en" captcha={AUTO} />);
    await fillOnePage();
    await scrollToEnd();
    await act(async () => submitButton().click());
    await settle();
    expect(submitButton().textContent).toBe(m.submitting);
    expect(submitButton().disabled).toBe(true);
    expect(q('.pf--vertical')).not.toBeNull(); // no submitting screen
    expect(q('.pf-reveal__subtitle')).toBeNull();
    expect(actions.submitFormAction).not.toHaveBeenCalled();

    await act(async () => renders[0]!.opts.callback!('tok-1'));
    await settle();
    expect(actions.submitFormAction).toHaveBeenCalledTimes(1);
    expect(actions.submitFormAction.mock.calls[0]![2]).toMatchObject({ captchaToken: 'tok-1' });
    expect(actions.submitFormAction.mock.calls[0]![2].partial).toBeUndefined();
    expect(q('.pf-done__title')).not.toBeNull();
  });

  it('a token won while the person finished is spent at once', async () => {
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps: textSteps } as never} locale="en" captcha={AUTO} />);
    await fillOnePage();
    await scrollToEnd();
    await act(async () => renders[0]!.opts.callback!('early'));
    await act(async () => submitButton().click());
    await settle();
    expect(actions.submitFormAction.mock.calls[0]![2]).toMatchObject({ captchaToken: 'early' });
    expect(renders).toHaveLength(1);
    expect(q('.pf-done__title')).not.toBeNull();
  });

  it('a refusal stays next to the button, with every answer intact and the button back', async () => {
    actions.submitFormAction.mockImplementation(async () => ({ ok: false, error: 'CAPTCHA_FAILED', message: 'x' }));
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps: textSteps } as never} locale="en" captcha={AUTO} />);
    await fillOnePage();
    await scrollToEnd();
    await act(async () => renders[0]!.opts.callback!('first'));
    await act(async () => submitButton().click());
    await settle();
    // One automatic retry on a fresh widget, in the same place.
    expect(renders).toHaveLength(2);
    expect(q('.pf-v__footer')!.contains(renders[1]!.el)).toBe(true);
    await act(async () => renders[1]!.opts.callback!('second'));
    await settle();
    expect(actions.submitFormAction).toHaveBeenCalledTimes(2);
    const error = q('.pf-v__footer .pf__error')!;
    expect(error.textContent).toBe(m.errors.captcha);
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).not.toBe(m.submitting);
    const inputs = host.querySelectorAll<HTMLInputElement>('.pf-v__question input');
    expect(inputs[0]!.value).toBe('laura@example.com');
    expect(inputs[1]!.value).toBe('Acme');
  });

  it('strict: the widget is visible above the button, and the hidden field rides the submit', async () => {
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps: textSteps } as never} locale="en" captcha={STRICT} />);
    expect(q('[data-testid="captcha-inline"]')!.getAttribute('data-captcha-mode')).toBe('strict');
    await fillOnePage();
    await scrollToEnd();
    expect(renders[0]!.opts.appearance).toBe('always');
    await act(async () => renders[0]!.opts.callback!('s-tok'));
    await act(async () => submitButton().click());
    await settle();
    expect(actions.submitFormAction.mock.calls[0]![2]).toMatchObject({ captchaToken: 's-tok', hp: '' });
  });

  it('with a reveal before the submit, the check still runs above Submit and the reveal plays after it', async () => {
    const steps = [...textSteps, { key: 'r', type: 'reveal' as const, reveal: { enabled: true, durationMs: 100 } }];
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps } as never} locale="en" captcha={AUTO} />);
    await fillOnePage();
    await scrollToEnd();
    await act(async () => submitButton().click());
    await settle();
    // Waiting on the check, still at the button: no reveal yet.
    expect(submitButton().textContent).toBe(m.submitting);
    expect(q('.pf--reveal')).toBeNull();
    await act(async () => renders[0]!.opts.callback!('before-reveal'));
    await settle();
    expect(q('.pf--reveal')).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await settle();
    // The token won above the button is the one the submit spends: no second widget.
    expect(renders).toHaveLength(1);
    expect(actions.submitFormAction.mock.calls.at(-1)![2]).toMatchObject({ captchaToken: 'before-reveal' });
    expect(q('.pf-done__title')).not.toBeNull();
  });

  it('without a check the footer has no slot and Submit works exactly as before', async () => {
    await mount(<VerticalFormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, layout: 'vertical', steps: textSteps } as never} locale="en" />);
    expect(q('[data-testid="captcha-inline"]')).toBeNull();
    await fillOnePage();
    await scrollToEnd();
    await act(async () => submitButton().click());
    await settle();
    expect(renders).toHaveLength(0);
    expect(actions.submitFormAction.mock.calls[0]![2].captchaToken).toBeUndefined();
    expect(q('.pf-done__title')).not.toBeNull();
  });
});

describe('slides: the check above the button of a step that ends the form', () => {
  it('shows the slot only on the step whose button ends the form, and Enter there submits in place', async () => {
    await mount(<FormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, steps: textSteps } as never} locale="en" captcha={AUTO} />);
    expect(q('[data-testid="captcha-inline"]')).toBeNull(); // step 1 of 2
    await act(async () => typeInto(q<HTMLInputElement>('.pf__fields input')!, 'laura@example.com'));
    await act(async () => submitButton().click());
    await settle();
    const slot = q('.pf__fields [data-testid="captcha-inline"]')!;
    expect(slot).not.toBeNull();
    expect(slot.nextElementSibling).toBe(submitButton());
    await scrollToEnd();
    expect(renders).toHaveLength(1);

    await act(async () => typeInto(q<HTMLInputElement>('.pf__fields input')!, 'Acme'));
    await act(async () => {
      q('.pf')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();
    expect(submitButton().textContent).toBe(m.submitting);
    expect(submitButton().disabled).toBe(true);
    expect(q<HTMLButtonElement>('.pf__back')!.disabled).toBe(true);
    expect(q('.pf-reveal__subtitle')).toBeNull(); // still on the step
    await act(async () => renders[0]!.opts.callback!('slide-tok'));
    await settle();
    expect(actions.submitFormAction.mock.calls.at(-1)![2]).toMatchObject({ captchaToken: 'slide-tok' });
    expect(q('.pf-done__title')).not.toBeNull();
  });

  it('a refusal returns the button on the same step, the message beside it', async () => {
    actions.submitFormAction.mockImplementation(async (_a: string, _s: string, p: { partial?: boolean }) =>
      p.partial ? { ok: true } : { ok: false, error: 'RATE_LIMITED', message: 'x' },
    );
    await mount(<FormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, steps: textSteps } as never} locale="en" captcha={AUTO} startAt={1} />);
    await act(async () => typeInto(q<HTMLInputElement>('.pf__fields input')!, 'Acme'));
    await act(async () => submitButton().click());
    await settle();
    await act(async () => renders[0]!.opts.callback!('tok'));
    await settle();
    expect(q('.pf__fields .pf__error')!.textContent).toBe(m.errors.rate_limited);
    expect(submitButton().disabled).toBe(false);
    expect(q<HTMLInputElement>('.pf__fields input')!.value).toBe('Acme');
  });

  it('a legacy reveal after the last step: the check runs above its button, then the reveal, then the submit', async () => {
    const config = { version: 1, steps: textSteps, reveal: { enabled: true, durationMs: 100 } };
    await mount(<FormRenderer accountCode="acme" slug="f" name="F" config={config as never} locale="en" captcha={AUTO} startAt={1} />);
    expect(q('.pf__fields [data-testid="captcha-inline"]')).not.toBeNull();
    await act(async () => typeInto(q<HTMLInputElement>('.pf__fields input')!, 'Acme'));
    await act(async () => submitButton().click());
    await settle();
    expect(submitButton().textContent).toBe(m.submitting);
    expect(q('.pf--reveal')).toBeNull();
    await act(async () => renders[0]!.opts.callback!('held'));
    await settle();
    expect(q('.pf--reveal')).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await settle();
    expect(renders).toHaveLength(1);
    expect(actions.submitFormAction.mock.calls.at(-1)![2]).toMatchObject({ captchaToken: 'held' });
    expect(q('.pf-done__title')).not.toBeNull();
  });

  it('a single-choice last step (no button) keeps the submitting screen', async () => {
    await mount(<FormRenderer accountCode="acme" slug="f" name="F" config={{ version: 1, steps: choiceLast } as never} locale="en" captcha={AUTO} startAt={1} />);
    expect(q('[data-testid="captcha-inline"]')).toBeNull();
    const option = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')][0]!;
    await act(async () => option.click());
    await settle();
    expect(q('.pf-reveal__subtitle')).not.toBeNull(); // the submitting screen
    expect(renders).toHaveLength(1);
    expect(q('.pf-reveal__inner')!.contains(renders[0]!.el)).toBe(true);
    await act(async () => renders[0]!.opts.callback!('screen-tok'));
    await settle();
    expect(actions.submitFormAction.mock.calls.at(-1)![2]).toMatchObject({ captchaToken: 'screen-tok' });
    expect(q('.pf-done__title')).not.toBeNull();
  });
});
