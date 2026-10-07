// @vitest-environment happy-dom
/**
 * One confirmed complete is one response, in both renderers. The server keeps
 * one row per (form, session) and delivers nothing for a complete that lands on
 * a row already completed, so a second person registering in the same tab
 * after a reload must arrive under a NEW session id, or their answers overwrite
 * the first person's and no webhook, CRM delivery or email leaves for them.
 *
 * The server actions are mocked: no request leaves the test.
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
  submitFormAction: vi.fn(),
  recordEventAction: vi.fn(async () => undefined),
  recordEventsAction: vi.fn(async () => undefined),
  recordBookingAction: vi.fn(async () => undefined),
  presignUploadAction: vi.fn(async () => ({ ok: false })),
}));
vi.mock('./actions', () => actions);

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'quill-form-acme-f';
const steps = [
  { key: 'email', type: 'email' as const, question: 'Email?' },
  { key: 'company', type: 'text' as const, question: 'Company?' },
];
const slides = { version: 1, steps } as never;
const onePage = { version: 1, layout: 'vertical', steps } as never;

let root: Root | undefined;
let el: HTMLDivElement | undefined;

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/acme/f/quote');
  actions.submitFormAction.mockReset();
  actions.submitFormAction.mockImplementation(async () => ({ ok: true, score: 0, outcome: null }));
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
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(node));
}

/** What a reload of the tab does to the renderer: a fresh mount, same storage. */
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
const completeSessions = () =>
  actions.submitFormAction.mock.calls
    .map((c) => c[2] as { sessionId: string; partial?: boolean })
    .filter((p) => !p.partial)
    .map((p) => p.sessionId);

async function answerSlides(email: string) {
  await act(async () => typeInto(el!.querySelector<HTMLInputElement>('.pf__fields input')!, email));
  await act(async () => button().click());
  await settle();
  await act(async () => typeInto(el!.querySelector<HTMLInputElement>('.pf__fields input')!, 'Acme'));
  await act(async () => button().click());
  await settle();
}

async function answerOnePage(email: string) {
  const inputs = el!.querySelectorAll<HTMLInputElement>('.pf-v__question input');
  await act(async () => typeInto(inputs[0]!, email));
  await act(async () => typeInto(inputs[1]!, 'Acme'));
  await settle();
  await act(async () => button().click());
  await settle();
}

const layouts = [
  {
    name: 'slides',
    render: () => <FormRenderer accountCode="acme" slug="f" name="Quote" config={slides} locale="en" />,
    answer: answerSlides,
  },
  {
    name: 'one page',
    render: () => <VerticalFormRenderer accountCode="acme" slug="f" name="Quote" config={onePage} locale="en" />,
    answer: answerOnePage,
  },
];

describe.each(layouts)('$name: one confirmed complete is one response', ({ render, answer }) => {
  it('a second registration after a reload arrives under a new session', async () => {
    await mount(render());
    const first = window.sessionStorage.getItem(KEY);
    expect(first).toBeTruthy();
    await answer('ana@example.com');
    expect(completeSessions()).toEqual([first]);
    // Released once the server confirmed it.
    expect(window.sessionStorage.getItem(KEY)).toBeNull();

    await unmount();
    await mount(render());
    const second = window.sessionStorage.getItem(KEY);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    await answer('beto@example.com');
    expect(completeSessions()).toEqual([first, second]);
  });

  it('keeps the session when the complete was NOT confirmed, so the retry stays one response', async () => {
    actions.submitFormAction.mockImplementation(async () => ({ ok: false, message: 'Try again.' }));
    await mount(render());
    const first = window.sessionStorage.getItem(KEY);
    await answer('ana@example.com');
    expect(completeSessions().length).toBeGreaterThan(0);
    expect(window.sessionStorage.getItem(KEY)).toBe(first);

    await unmount();
    await mount(render());
    expect(window.sessionStorage.getItem(KEY)).toBe(first);
  });
});
