// @vitest-environment happy-dom
/**
 * A respondent on a screen of several questions (#200), driven through the
 * real slides renderer with the server actions mocked:
 *
 *  - one click per screen, validated as a whole: every empty required member
 *    gets its own error, one summary is announced, and focus lands on the
 *    first invalid question;
 *  - Enter walks the fields and submits from the last one, and never fires
 *    from the dropdown;
 *  - a member shown by another member's answer appears live, and never
 *    advances the screen on its own;
 *  - funnel events per question (E1): a view per visible member when the
 *    screen shows (and one for a member revealed live), and on submit
 *    `start`, a completion per member and the partial save when the
 *    threshold is on the screen;
 *  - a jump from the first member runs after the screen, and a terminal
 *    member ends the form on submit;
 *  - an embedded form asks its host to scroll on a screen change, never on
 *    load;
 *  - spam protection runs right above the one button of a grouped last
 *    screen, in automatic and strict mode.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@quill/shared';
import type { PublicCaptcha } from '@quill/types';
import { resetTurnstileLoaderForTests, type TurnstileRenderOptions } from '@/lib/captcha';
import { EMBED_SCREEN_EVENT } from '@/lib/embed-screen';

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = getMessages('en').renderer;

const yesNo = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

/**
 * Screen 1: name and email (required), city and phone. Screen 2: a choice
 * whose "yes" shows a follow-up on the same screen, and a dropdown. Then two
 * questions of their own.
 */
const steps = [
  { key: 'name', type: 'text', question: 'Name?', required: true, screenGroup: 'you' },
  { key: 'email', type: 'email', question: 'Email?', required: true, screenGroup: 'you' },
  { key: 'city', type: 'text', question: 'City?', screenGroup: 'you' },
  { key: 'phone', type: 'phone', question: 'Phone?', screenGroup: 'you' },
  { key: 'team', type: 'multiple_choice', question: 'Do you have a team?', options: yesNo, screenGroup: 'work' },
  {
    key: 'size',
    type: 'text',
    question: 'How many people?',
    showWhen: { field: 'team', values: ['yes'] },
    screenGroup: 'work',
  },
  {
    key: 'plan',
    type: 'dropdown',
    question: 'Plan?',
    options: [
      { label: 'Free', value: 'free' },
      { label: 'Pro', value: 'pro' },
    ],
    screenGroup: 'work',
  },
  { key: 'goal', type: 'text', question: 'Goal?' },
  { key: 'notes', type: 'textarea', question: 'Anything else?' },
];

let root: Root;
let host: HTMLDivElement;
let observers: { cb: IntersectionObserverCallback; el?: Element }[];
let renders: { el: HTMLElement; opts: TurnstileRenderOptions }[];

beforeEach(() => {
  resetTurnstileLoaderForTests();
  window.sessionStorage.clear();
  actions.submitFormAction.mockReset();
  actions.submitFormAction.mockImplementation(async () => ({ ok: true, score: 0, outcome: null }));
  actions.recordEventAction.mockClear();
  observers = [];
  renders = [];
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

function form(config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return (
    <FormRenderer
      accountCode="acme"
      slug="f"
      name="F"
      config={{ version: 1, steps, ...config } as never}
      locale="en"
      {...extra}
    />
  );
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const member = (key: string) => q(`[data-pf-step="${key}"]`)!;
const input = (key: string) => member(key).querySelector<HTMLInputElement>('input')!;
const button = () =>
  [...host.querySelectorAll<HTMLButtonElement>('button.pf__btn')].find((b) => !b.classList.contains('pf__back'))!;
const progress = () => q('[data-testid="pf-progress"]')!.getAttribute('aria-label');
const events = (type: string) =>
  actions.recordEventAction.mock.calls
    .map((c) => (c as unknown[])[2] as { type: string; stepIndex: number | null; stepKey: string | null })
    .filter((e) => e.type === type)
    .map((e) => [e.stepIndex, e.stepKey]);
const enter = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await settle();
};

async function fillFirstScreen() {
  await act(async () => typeInto(input('name'), 'Ana'));
  await act(async () => typeInto(input('email'), 'ana@example.com'));
}

describe('one click per screen', () => {
  it('moves screen by screen, counting screens in the progress', async () => {
    await mount(form());
    expect(progress()).toBe('Step 1 of 4');
    expect(host.querySelectorAll('[data-pf-step]')).toHaveLength(4);
    await fillFirstScreen();
    await act(async () => button().click());
    await settle();
    expect(progress()).toBe('Step 2 of 4');
    expect([...host.querySelectorAll('[data-pf-step]')].map((e) => e.getAttribute('data-pf-step'))).toEqual([
      'team',
      'plan',
    ]);
    await act(async () => button().click());
    await settle();
    expect(progress()).toBe('Step 3 of 4');
    expect(q('[data-pf-step]')).toBeNull(); // a question of its own: the legacy slide
    expect(q('.pf__question')!.textContent).toBe('Goal?');
  });

  it('Back returns to the start of the previous screen with every answer kept', async () => {
    await mount(form());
    await fillFirstScreen();
    await act(async () => button().click());
    await settle();
    await act(async () => q<HTMLButtonElement>('.pf__back')!.click());
    await settle();
    expect(progress()).toBe('Step 1 of 4');
    expect(input('name').value).toBe('Ana');
    expect(input('email').value).toBe('ana@example.com');
  });
});

describe('validation on a screen', () => {
  it('two empty required questions give two errors, one announced summary, and focus on the first', async () => {
    await mount(form());
    await act(async () => typeInto(input('city'), 'Bogotá'));
    await act(async () => button().click());
    await settle();
    expect(progress()).toBe('Step 1 of 4'); // still here
    expect(member('name').querySelector('.pf__error')!.textContent).toBe(m.errors.required);
    expect(member('email').querySelector('.pf__error')!.textContent).toBe(m.errors.required);
    expect(member('city').querySelector('.pf__error')).toBeNull();
    // Per-question errors are quiet; one summary speaks for the screen.
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(q('[role="alert"]')!.textContent).toBe(m.verticalErrors);
    expect(document.activeElement).toBe(input('name'));
    expect(actions.submitFormAction).not.toHaveBeenCalled();
  });

  it('a fixed answer clears its own error and the summary', async () => {
    await mount(form());
    await act(async () => button().click());
    await settle();
    await act(async () => typeInto(input('name'), 'Ana'));
    expect(member('name').querySelector('.pf__error')).toBeNull();
    expect(member('email').querySelector('.pf__error')).not.toBeNull();
    expect(q('[role="alert"]')).toBeNull();
  });

  it('checks the shape too: a bad email is its own error', async () => {
    await mount(form());
    await act(async () => typeInto(input('name'), 'Ana'));
    await act(async () => typeInto(input('email'), 'not-an-email'));
    await act(async () => button().click());
    await settle();
    expect(member('email').querySelector('.pf__error')!.textContent).toBe(m.errors.email);
    expect(document.activeElement).toBe(input('email'));
  });

  it('focuses the first question that takes input when the screen opens, and no other', async () => {
    await mount(form());
    // The phone field further down would take focus by itself on a slide of its own.
    expect(document.activeElement).toBe(input('name'));
  });
});

describe('Enter on a screen', () => {
  it('walks the fields and submits from the last one', async () => {
    await mount(form());
    await act(async () => typeInto(input('name'), 'Ana'));
    await enter(input('name'));
    expect(document.activeElement).toBe(input('email'));
    await act(async () => typeInto(input('email'), 'ana@example.com'));
    await enter(input('email'));
    expect(document.activeElement).toBe(input('city'));
    await enter(input('city'));
    // The phone's number field, past its country button.
    const phone = member('phone').querySelector<HTMLInputElement>('input[type="tel"]')!;
    expect(document.activeElement).toBe(phone);
    await enter(phone);
    expect(progress()).toBe('Step 2 of 4');
  });

  it('never fires from the dropdown, whose Enter picks an option', async () => {
    await mount(form({}, { startAt: 4 }));
    const combo = member('plan').querySelector<HTMLInputElement>('input')!;
    await act(async () => combo.focus());
    await enter(combo);
    expect(progress()).toBe('Step 2 of 4');
  });
});

describe('logic inside a screen', () => {
  it('a member shown by another member appears live, is viewed, and nothing advances by itself', async () => {
    await mount(form({}, { startAt: 4 }));
    expect(q('[data-pf-step="size"]')).toBeNull();
    actions.recordEventAction.mockClear();
    const yes = member('team').querySelector<HTMLButtonElement>('[role="radio"]')!;
    await act(async () => yes.click());
    await settle();
    expect(q('[data-pf-step="size"]')).not.toBeNull();
    expect(progress()).toBe('Step 2 of 4'); // a single choice on a screen never auto-advances
    expect(events('step_view')).toEqual([[5, 'size']]);
    // And it goes away again when the answer changes.
    const no = member('team').querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!;
    await act(async () => no.click());
    await settle();
    expect(q('[data-pf-step="size"]')).toBeNull();
  });

  it('a jump from the first member runs after the screen, not before the rest of it', async () => {
    const jumping = steps.map((s) =>
      s.key === 'team' ? { ...s, goto: [{ values: ['no'], target: 'notes' }] } : s,
    );
    await mount(form({ steps: jumping }, { startAt: 4 }));
    const no = member('team').querySelectorAll<HTMLButtonElement>('[role="radio"]')[1]!;
    await act(async () => no.click());
    await settle();
    // The rest of the screen is still here to answer.
    expect(q('[data-pf-step="plan"]')).not.toBeNull();
    await act(async () => button().click());
    await settle();
    expect(q('.pf__question')!.textContent).toBe('Anything else?'); // "Goal?" was jumped over
  });

  it('a terminal member ends the form when its screen is submitted', async () => {
    const ending = steps.map((s) => (s.key === 'city' ? { ...s, terminal: true } : s));
    await mount(form({ steps: ending }));
    await fillFirstScreen();
    await act(async () => button().click());
    await settle();
    expect(actions.submitFormAction).toHaveBeenCalledTimes(1);
    expect(actions.submitFormAction.mock.calls[0]![2].partial).toBeUndefined();
    expect(q('.pf-done__title')).not.toBeNull();
  });
});

describe('funnel events per question (E1)', () => {
  it('a view per visible member on show; on submit start, a completion per member, and the partial', async () => {
    await mount(form({ partialSubmitAfterStep: 2 }));
    await settle();
    expect(events('step_view')).toEqual([
      [0, 'name'],
      [1, 'email'],
      [2, 'city'],
      [3, 'phone'],
    ]);
    await fillFirstScreen();
    await act(async () => button().click());
    await settle();
    expect(events('start')).toHaveLength(1);
    expect(events('step_complete')).toEqual([
      [0, 'name'],
      [1, 'email'],
      [2, 'city'],
      [3, 'phone'],
    ]);
    // The threshold (email) is on this screen: the partial fires on its submit.
    expect(events('partial_submit')).toEqual([[1, 'email']]);
    const partial = actions.submitFormAction.mock.calls.find((c) => c[2].partial === true)!;
    expect(partial[2].data).toMatchObject({ name: 'Ana', email: 'ana@example.com' });
    // The next screen's views: its visible members only.
    expect(events('step_view').slice(4)).toEqual([
      [4, 'team'],
      [5, 'plan'],
    ]);
  });

  it('coming back to a screen is a new visit: its members are viewed again', async () => {
    await mount(form());
    await fillFirstScreen();
    await act(async () => button().click());
    await settle();
    actions.recordEventAction.mockClear();
    await act(async () => q<HTMLButtonElement>('.pf__back')!.click());
    await settle();
    expect(events('step_view')).toEqual([
      [0, 'name'],
      [1, 'email'],
      [2, 'city'],
      [3, 'phone'],
    ]);
  });
});

describe('embedded: the host is asked to scroll on a screen change, never on load', () => {
  it('announces each screen change once, and stays quiet while answering', async () => {
    let heard = 0;
    const listen = () => {
      heard += 1;
    };
    window.addEventListener(EMBED_SCREEN_EVENT, listen);
    try {
      await mount(form());
      await settle();
      expect(heard).toBe(0);
      await fillFirstScreen();
      expect(heard).toBe(0);
      await act(async () => button().click());
      await settle();
      expect(heard).toBe(1);
      await act(async () => q<HTMLButtonElement>('.pf__back')!.click());
      await settle();
      expect(heard).toBe(2);
    } finally {
      window.removeEventListener(EMBED_SCREEN_EVENT, listen);
    }
  });
});

describe('spam protection on a grouped last screen', () => {
  const AUTO: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key' };
  const STRICT: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key', strict: true };
  const lastGrouped = [
    { key: 'name', type: 'text', question: 'Name?', required: true, screenGroup: 'you' },
    { key: 'email', type: 'email', question: 'Email?', required: true, screenGroup: 'you' },
  ];
  async function scrollToEnd() {
    await act(async () => {
      for (const o of observers) {
        if (o.el) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    });
    await settle();
  }

  it('automatic: the check sits right above the one button, and the click submits in place', async () => {
    await mount(form({ steps: lastGrouped }, { captcha: AUTO }));
    const slot = q('[data-testid="captcha-inline"]')!;
    expect(host.querySelectorAll('[data-testid="captcha-inline"]')).toHaveLength(1);
    expect(slot.nextElementSibling).toBe(button());
    // The first answer arms it; it loads once the end is on screen.
    await fillFirstScreen();
    await scrollToEnd();
    expect(renders).toHaveLength(1);
    expect(slot.contains(renders[0]!.el)).toBe(true);
    await act(async () => button().click());
    await settle();
    expect(button().textContent).toBe(m.submitting);
    expect(q('.pf-reveal__subtitle')).toBeNull(); // no submitting screen
    await act(async () => renders[0]!.opts.callback!('tok'));
    await settle();
    expect(actions.submitFormAction.mock.calls.at(-1)![2]).toMatchObject({ captchaToken: 'tok' });
    expect(q('.pf-done__title')).not.toBeNull();
  });

  it('strict: the widget shows above the button and the hidden field rides the submit', async () => {
    await mount(form({ steps: lastGrouped }, { captcha: STRICT }));
    expect(q('[data-testid="captcha-inline"]')!.getAttribute('data-captcha-mode')).toBe('strict');
    expect(q('input.pf-hp')).not.toBeNull();
    await fillFirstScreen();
    await scrollToEnd();
    expect(renders[0]!.opts.appearance).toBe('always');
    await act(async () => renders[0]!.opts.callback!('s-tok'));
    await act(async () => button().click());
    await settle();
    expect(actions.submitFormAction.mock.calls.at(-1)![2]).toMatchObject({ captchaToken: 's-tok', hp: '' });
  });

  it('a refusal lands on the screen, with every answer intact and the button back', async () => {
    actions.submitFormAction.mockImplementation(async (_a: string, _s: string, p: { partial?: boolean }) =>
      p.partial ? { ok: true } : { ok: false, error: 'RATE_LIMITED', message: 'x' },
    );
    await mount(form({ steps: lastGrouped }, { captcha: AUTO }));
    await fillFirstScreen();
    await scrollToEnd();
    await act(async () => renders[0]!.opts.callback!('tok'));
    await act(async () => button().click());
    await settle();
    expect(q('[role="alert"]')!.textContent).toBe(m.errors.rate_limited);
    expect(button().disabled).toBe(false);
    expect(input('name').value).toBe('Ana');
    expect(input('email').value).toBe('ana@example.com');
  });
});
