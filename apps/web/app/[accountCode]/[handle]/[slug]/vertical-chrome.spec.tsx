// @vitest-environment happy-dom
/**
 * The one-page form's chrome for an embed (#126): the header above the
 * questions can be switched off (`branding.showHeader: false`), the answered
 * counter goes with the bar under `progressStyle: 'none'`, and a value the
 * page put there (a default, a URL prefill) does not count as answered until
 * the person touches the question.
 *
 * The first half pins static markup; the second drives the real renderer with
 * the server actions mocked.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `next/font/google` resolves at build time and has no runtime in vitest.
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

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOGO = 'https://cdn.example.com/clinic-logo.png';

const twoSteps = [
  { key: 'email', type: 'email', question: 'Email?' },
  { key: 'notes', type: 'textarea', question: 'Anything else?' },
];

function vertical(config: Record<string, unknown>) {
  return renderToStaticMarkup(
    <VerticalFormRenderer
      accountCode="acme"
      slug="f"
      name="Clinic contact"
      config={{ version: 1, layout: 'vertical', steps: twoSteps, ...config } as never}
      locale="en"
    />,
  );
}

function slides(config: Record<string, unknown>, startAt: number | 'cover') {
  return renderToStaticMarkup(
    <FormRenderer
      accountCode="acme"
      slug="f"
      name="Clinic contact"
      config={{ version: 1, steps: twoSteps, ...config } as never}
      locale="en"
      startAt={startAt}
    />,
  );
}

describe('the one-page header', () => {
  it('shows the form name in the header when there is no logo and no setting', () => {
    const html = vertical({});
    expect(html).toContain('pf-v__header');
    expect(html).toContain('<span class="pf__logo--fallback">Clinic contact</span>');
  });

  it('drops the header node with showHeader false', () => {
    const html = vertical({ branding: { showHeader: false } });
    expect(html).not.toContain('pf-v__header');
    expect(html).not.toContain('pf__logo');
  });

  it('keeps the hero when the cover is on, without the header above it', () => {
    const html = vertical({ branding: { showHeader: false }, cover: { enabled: true, headline: 'Hola' } });
    expect(html).toContain('pf-v__hero');
    expect(html).toContain('Hola');
    expect(html).not.toContain('pf-v__header');
  });

  it('is ignored by slides: same markup with or without it', () => {
    for (const startAt of ['cover', 0] as const) {
      const base = { cover: { enabled: true, headline: 'Hola' }, branding: { logo: LOGO } };
      expect(slides({ ...base, branding: { logo: LOGO, showHeader: false } }, startAt)).toBe(slides(base, startAt));
      expect(slides({ branding: { showHeader: false } }, startAt)).toBe(slides({}, startAt));
    }
  });
});

describe('the one-page progress strip', () => {
  it('is gone, label included, under progressStyle none', () => {
    const html = vertical({ branding: { progressStyle: 'none' } });
    expect(html).not.toContain('pf-v__progressbar');
    expect(html).not.toContain('pf-v__progress-label');
  });

  it('shows the bar and the counter for every other value', () => {
    for (const progressStyle of [undefined, 'bar', 'dots', 'steps']) {
      const html = vertical(progressStyle ? { branding: { progressStyle } } : {});
      expect(html, String(progressStyle)).toContain('pf-v__progressbar');
      expect(html, String(progressStyle)).toContain('pf-v__progress-label');
    }
  });
});

// --- Interactive ------------------------------------------------------------

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/acme/f/contact');
  actions.submitForm.mockReset();
  actions.submitForm.mockImplementation(async () => ({ ok: true, score: 0, outcome: null }));
  actions.recordEvent.mockClear();
  actions.recordEvents.mockClear();
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
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

async function mount(steps: unknown[], extra: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="Clinic contact"
        config={{ version: 1, layout: 'vertical', steps, ...extra } as never}
        locale="en"
      />,
    ),
  );
  await settle();
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function typeInto(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const label = () => q('.pf-v__progress-label')?.textContent;
const question = (key: string) => q(`[data-vf-step="${key}"]`)!;

/** Open a dropdown question (clearing its search) and click one of its options. */
async function pick(key: string, optionLabel: string) {
  const input = question(key).querySelector<HTMLInputElement>('input[role="combobox"]')!;
  await act(async () => typeInto(input, ''));
  const option = [...question(key).querySelectorAll<HTMLButtonElement>('.pf-dropdown__option')].find(
    (b) => b.textContent?.trim() === optionLabel,
  );
  expect(option, `${key} → ${optionLabel}`).toBeTruthy();
  await act(async () => option!.click());
  await settle();
}

const sizes = [
  { label: 'Small', value: 's' },
  { label: 'Large', value: 'l' },
];
const plans = [
  { label: 'Free', value: 'free' },
  { label: 'Pro', value: 'pro' },
];

/** Six questions, two dropdowns that come with a default. */
const sixWithDefaults = [
  { key: 'full', type: 'text', question: 'Your name?' },
  { key: 'email', type: 'email', question: 'Email?' },
  { key: 'plan', type: 'dropdown', question: 'Plan?', options: plans, defaultValue: 'pro' },
  { key: 'size', type: 'dropdown', question: 'Clinic size?', options: sizes, defaultValue: 's' },
  { key: 'city', type: 'text', question: 'City?' },
  { key: 'notes', type: 'textarea', question: 'Anything else?' },
];

describe('what the answered counter counts', () => {
  it('does not count a default until the person picks, even the same option', async () => {
    await mount(sixWithDefaults);
    expect(label()).toBe('0 of 6 answered');
    await pick('plan', 'Free');
    expect(label()).toBe('1 of 6 answered');
    await pick('size', 'Small'); // the option that was already the default
    expect(label()).toBe('2 of 6 answered');
  });

  it('does not count a URL prefill until the person edits it', async () => {
    window.history.replaceState(null, '', '/acme/f/contact?email=a@b.co');
    await mount(sixWithDefaults);
    expect(label()).toBe('0 of 6 answered');
    const email = question('email').querySelector<HTMLInputElement>('input')!;
    expect(email.value).toBe('a@b.co');
    await act(async () => typeInto(email, 'a@b.com'));
    await settle();
    expect(label()).toBe('1 of 6 answered');
  });

  it('does not count a name step prefilled through one of its subfields', async () => {
    window.history.replaceState(null, '', '/acme/f/contact?firstname=Ana');
    await mount([
      { key: 'who', type: 'name', question: 'Your name?' },
      { key: 'email', type: 'email', question: 'Email?' },
    ]);
    expect(question('who').querySelector<HTMLInputElement>('input')!.value).toBe('Ana');
    expect(label()).toBe('0 of 2 answered');
  });

  it('does not cut the page at a terminal question that only has a default', async () => {
    await mount([
      { key: 'plan', type: 'dropdown', question: 'Plan?', options: plans, defaultValue: 'pro', terminal: true },
      { key: 'email', type: 'email', question: 'Email?' },
      { key: 'notes', type: 'textarea', question: 'Anything else?' },
    ]);
    expect(q('[data-vf-step="email"]')).not.toBeNull();
    expect(q('[data-vf-step="notes"]')).not.toBeNull();
    expect(label()).toBe('0 of 3 answered');
  });
});

describe('the header switch after Submit', () => {
  const submitButton = () => q<HTMLButtonElement>('button.pf__btn')!;

  it('keeps the logo off the reveal screen', async () => {
    const steps = [{ key: 'notes', type: 'textarea', question: 'Anything else?' }, { key: 'r', type: 'reveal' }];
    // Control: the same form with the header on shows the logo on the reveal.
    await mount(steps, { branding: { logo: LOGO } });
    await act(async () => submitButton().click());
    await settle();
    expect(q('.pf-reveal__inner')).not.toBeNull();
    expect(q('.pf-reveal__brand')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();

    await mount(steps, { branding: { logo: LOGO, showHeader: false } });
    await act(async () => submitButton().click());
    await settle();
    expect(q('.pf-reveal__inner')).not.toBeNull();
    expect(q('.pf-reveal__brand')).toBeNull();
  });

  it('keeps the logo off the submitting screen', async () => {
    actions.submitForm.mockImplementation(() => new Promise(() => {})); // stays on "submitting"
    const steps = [{ key: 'notes', type: 'textarea', question: 'Anything else?' }];
    await mount(steps, { branding: { logo: LOGO } });
    await act(async () => submitButton().click());
    await settle();
    expect(q('.pf--reveal')).not.toBeNull();
    expect(q('.pf-reveal__brand')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();

    await mount(steps, { branding: { logo: LOGO, showHeader: false } });
    await act(async () => submitButton().click());
    await settle();
    expect(q('.pf--reveal')).not.toBeNull();
    expect(q('.pf-reveal__brand')).toBeNull();
  });
});
