// @vitest-environment happy-dom
/**
 * `[name]` as the respondent's full name (#65), through both real renderers
 * with the transport mocked: a `name` step stores `firstname` and
 * `lastname`, and the thank-you copy, the next question and the redirect URL
 * all read `[name]` as the two joined. The token rules themselves (a step
 * keyed `name` wins, no stray space, the URL encoding) are pinned in the
 * engine's `form-logic.spec.ts`.
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

const nameStep = { key: 'name', type: 'name' as const, question: 'Your name?' };
const roleStep = { key: 'role', type: 'text' as const, question: 'What is your role, [name]?' };

const thankYou = (layout?: 'vertical') =>
  ({
    version: 1,
    ...(layout ? { layout } : {}),
    steps: [nameStep, roleStep],
    scoring: { enabled: true },
    outcomes: [
      {
        id: 'all',
        label: 'Done, [name]',
        minScore: 0,
        message: 'Thanks [name], we will be in touch.',
      },
    ],
  }) as never;

const redirect = (layout?: 'vertical') =>
  ({
    version: 1,
    ...(layout ? { layout } : {}),
    steps: [nameStep, roleStep],
    ending: { redirectUrl: 'https://example.com/welcome?who=[name]&role=[role]' },
  }) as never;

let root: Root;
let el: HTMLDivElement;

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/acme/f/quote');
  nav.navigateTop.mockReset();
  actions.submitForm.mockReset();
  actions.submitForm.mockImplementation(async () => ({ ok: true, score: 0, outcome: 'all' }));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  el?.remove();
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
  [...el.querySelectorAll<HTMLButtonElement>('button.pf__btn')].find(
    (b) => !b.classList.contains('pf__back'),
  )!;

/** Slides: first and last name, then the role question, then submit. */
async function answerSlides(): Promise<string> {
  const [first, last] = el.querySelectorAll<HTMLInputElement>('.pf-name-fields input');
  await act(async () => typeInto(first!, 'Ana'));
  await act(async () => typeInto(last!, 'Ruiz'));
  await act(async () => button().click());
  await settle();
  const asked = el.textContent ?? '';
  await act(async () => typeInto(el.querySelector<HTMLInputElement>('.pf__fields input')!, 'CEO'));
  await act(async () => button().click());
  await settle();
  return asked;
}

/** One page: every question at once, then the one submit button. */
async function answerOnePage(): Promise<string> {
  const [first, last] = el.querySelectorAll<HTMLInputElement>('.pf-name-fields input');
  await act(async () => typeInto(first!, 'Ana'));
  await act(async () => typeInto(last!, 'Ruiz'));
  await settle();
  const asked = el.textContent ?? '';
  const inputs = el.querySelectorAll<HTMLInputElement>('.pf-v__question input');
  await act(async () => typeInto(inputs[inputs.length - 1]!, 'CEO'));
  await settle();
  await act(async () => button().click());
  await settle();
  return asked;
}

describe('slides: [name] is the full name', () => {
  it('in the next question, the outcome heading and the outcome text', async () => {
    await mount(
      <FormRenderer accountCode="acme" slug="f" name="Quote" config={thankYou()} locale="en" />,
    );
    expect(await answerSlides()).toContain('What is your role, Ana Ruiz?');
    expect(el.querySelector('.pf-done__title')?.textContent).toBe('Done, Ana Ruiz');
    expect(el.querySelector('.pf-done__body')?.textContent).toBe(
      'Thanks Ana Ruiz, we will be in touch.',
    );
    // The answers sent are still the two fields: nothing is stored under `name`.
    const sent = actions.submitForm.mock.calls.at(-1)![2] as {
      data: Record<string, unknown>;
    };
    expect(sent.data).toMatchObject({ firstname: 'Ana', lastname: 'Ruiz' });
    expect(sent.data).not.toHaveProperty('name');
  });

  it('in the redirect URL, percent-encoded', async () => {
    await mount(
      <FormRenderer accountCode="acme" slug="f" name="Quote" config={redirect()} locale="en" />,
    );
    await answerSlides();
    expect(nav.navigateTop).toHaveBeenCalledWith(
      'https://example.com/welcome?who=Ana%20Ruiz&role=CEO',
    );
  });
});

describe('one page: [name] is the full name', () => {
  it('in a later question, the outcome heading and the outcome text', async () => {
    await mount(
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="Quote"
        config={thankYou('vertical')}
        locale="en"
      />,
    );
    expect(await answerOnePage()).toContain('What is your role, Ana Ruiz?');
    expect(el.querySelector('.pf-done__title')?.textContent).toBe('Done, Ana Ruiz');
    expect(el.querySelector('.pf-done__body')?.textContent).toBe(
      'Thanks Ana Ruiz, we will be in touch.',
    );
  });

  it('in the redirect URL, percent-encoded', async () => {
    await mount(
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="Quote"
        config={redirect('vertical')}
        locale="en"
      />,
    );
    await answerOnePage();
    expect(nav.navigateTop).toHaveBeenCalledWith(
      'https://example.com/welcome?who=Ana%20Ruiz&role=CEO',
    );
  });
});

/**
 * Embedded (`?embed=1` or in a frame), the redirect never carries an answer:
 * every query parameter holding a token is dropped whole, the rest of the URL
 * stays as written. Standalone, the same URL is filled in. Every redirect
 * path, in both layouts. `navigateTop` is the one function that both posts the
 * redirect to the host page and writes `top.location`, so the URL it receives
 * is the URL that leaves the frame either way.
 */
describe('the redirect carries answers only on a standalone form', () => {
  const TEMPLATE = 'https://example.com/welcome?src=form&who=[name]&role=[role]#top';
  const FILLED = 'https://example.com/welcome?src=form&who=Ana%20Ruiz&role=CEO#top';
  const STRIPPED = 'https://example.com/welcome?src=form#top';
  const BOOKING = {
    provider: 'hubspot_meetings',
    url: 'https://meetings.hubspot.com/example/demo',
  };

  const configFor = (path: 'immediate' | 'delayed' | 'booking', layout: 'slides' | 'vertical') =>
    ({
      version: 1,
      ...(layout === 'vertical' ? { layout: 'vertical' } : {}),
      steps: [nameStep, roleStep],
      ...(path === 'booking'
        ? {
            scoring: { enabled: true },
            outcomes: [
              { id: 'all', label: 'Book', minScore: 0, redirectUrl: TEMPLATE, booking: BOOKING },
            ],
          }
        : {
            ending: {
              redirectUrl: TEMPLATE,
              ...(path === 'delayed' ? { redirectDelayMs: 30 } : {}),
            },
          }),
    }) as never;

  async function run(
    path: 'immediate' | 'delayed' | 'booking',
    layout: 'slides' | 'vertical',
    embedded: boolean,
  ): Promise<string> {
    window.history.replaceState(null, '', embedded ? '/acme/f/quote?embed=1' : '/acme/f/quote');
    const Renderer = layout === 'vertical' ? VerticalFormRenderer : FormRenderer;
    await mount(
      <Renderer
        accountCode="acme"
        slug="f"
        name="Quote"
        config={configFor(path, layout)}
        locale="en"
      />,
    );
    await (layout === 'vertical' ? answerOnePage() : answerSlides());
    if (path === 'delayed') {
      // The thank-you shows first; the deferred redirect fires from it.
      expect(el.querySelector('.pf-done__title')).not.toBeNull();
      for (let i = 0; i < 40 && nav.navigateTop.mock.calls.length === 0; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
      }
    }
    if (path === 'booking') {
      expect(nav.navigateTop).not.toHaveBeenCalled(); // the booking screen shows first
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://meetings.hubspot.com',
            data: { meetingBookSucceeded: true },
          }),
        );
      });
      await settle();
    }
    expect(nav.navigateTop).toHaveBeenCalledTimes(1);
    return nav.navigateTop.mock.calls[0]![0] as string;
  }

  for (const layout of ['slides', 'vertical'] as const) {
    for (const path of ['immediate', 'delayed', 'booking'] as const) {
      it(`${layout}, ${path}: standalone fills the tokens`, async () => {
        expect(await run(path, layout, false)).toBe(FILLED);
      });

      it(`${layout}, ${path}: embedded drops every parameter with a token`, async () => {
        const url = await run(path, layout, true);
        expect(url).toBe(STRIPPED);
        for (const answer of ['Ana', 'Ruiz', 'CEO', 'who=', 'role='])
          expect(url).not.toContain(answer);
      });
    }
  }
});
