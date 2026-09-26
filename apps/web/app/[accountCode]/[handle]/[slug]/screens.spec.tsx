/**
 * Screens in the slides layout (#200), pinned through static markup: the
 * members of a screen share one card and one button, progress counts
 * screens, a position inside a screen opens the whole screen, and the
 * one-page layout never reads the ids. What a respondent DOES on a screen
 * (validation, Enter, events, jumps) is in `screens-flow.spec.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

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

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';

const roleOptions = [
  { label: 'Founder', value: 'founder' },
  { label: 'Employee', value: 'employee' },
];

/** Three screens: a heading and two questions; a choice with a live follow-up; a last question. */
const steps = [
  {
    key: 'intro',
    type: 'message',
    question: 'Your details',
    helper: 'We only use them to reply.',
    buttonText: 'Continue',
    screenGroup: 'you',
  },
  { key: 'name', type: 'text', question: 'Name?', required: true, screenGroup: 'you' },
  { key: 'email', type: 'email', question: 'Email?', required: true, screenGroup: 'you' },
  { key: 'role', type: 'multiple_choice', question: 'Role?', options: roleOptions, screenGroup: 'work' },
  {
    key: 'company',
    type: 'text',
    question: 'Company?',
    showWhen: { field: 'role', values: ['founder'] },
    screenGroup: 'work',
  },
  { key: 'notes', type: 'textarea', question: 'Anything else?' },
];

function slides(config: Record<string, unknown>, startAt: number | 'cover' = 0) {
  return renderToStaticMarkup(
    <FormRenderer
      accountCode="acme"
      slug="f"
      name="F"
      config={{ version: 1, steps, ...config } as never}
      locale="en"
      startAt={startAt}
    />,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The buttons that move the form on, never the back arrow. */
const primaryButtons = (html: string) => html.match(/<button type="button" class="pf__btn[^"]*"[^>]*>[^<]*<\/button>/g) ?? [];

describe('a screen of several questions', () => {
  it('shows every member on one card, with one button, and progress by screens', () => {
    const html = slides({});
    expect(count(html, 'data-pf-step="')).toBe(3);
    expect(html).toContain('data-pf-screen-size="3"');
    expect(primaryButtons(html)).toHaveLength(1);
    // Three screens: yours, work (the follow-up is hidden until it applies), the last question.
    expect(html).toContain('aria-label="Step 1 of 3"');
  });

  it('labels the button from the last member, and a leading message does not lend its Continue', () => {
    const html = slides({});
    expect(primaryButtons(html)[0]).toContain('>Next<');
    const own = slides({ steps: steps.map((s) => (s.key === 'email' ? { ...s, buttonText: 'Almost there' } : s)) });
    expect(primaryButtons(own)[0]).toContain('>Almost there<');
  });

  it('marks required questions with an asterisk once the card holds two or more', () => {
    const html = slides({});
    expect(count(html, 'class="pf-v__required"')).toBe(2); // name + email, never the heading
  });

  it('a position inside a screen opens the whole screen', () => {
    expect(slides({}, 1)).toBe(slides({}, 0));
    expect(slides({}, 2)).toBe(slides({}, 0));
  });

  it('a screen that logic leaves with one question keeps its button, and slide typography', () => {
    const html = slides({}, 3);
    expect(count(html, 'data-pf-step="')).toBe(1);
    expect(html).toContain('data-pf-screen-size="1"');
    expect(primaryButtons(html)).toHaveLength(1); // a single choice here never advances by itself
    expect(html).not.toContain('pf-v__required');
    expect(html).toContain('aria-label="Step 2 of 3"');
  });

  it('a question with a screen of its own renders exactly as a legacy slide', () => {
    const html = slides({}, 4);
    expect(html).not.toContain('data-pf-step');
    expect(html).not.toContain('data-pf-screen-size');
    expect(primaryButtons(html)[0]).toContain('>Submit<');
    expect(html).toContain('aria-label="Step 3 of 3"');
  });

  it('solo types stay on a screen of their own even when they carry an id', () => {
    const withScheduler = [
      { key: 'a', type: 'text', question: 'A?', screenGroup: 's' },
      { key: 'meet', type: 'scheduler', question: 'Pick a time', screenGroup: 's' },
      { key: 'b', type: 'text', question: 'B?', screenGroup: 's' },
    ];
    const html = slides({ steps: withScheduler }, 1);
    expect(html).toContain('data-testid="scheduler-unconfigured"');
    expect(html).not.toContain('data-pf-step');
    expect(html).toContain('aria-label="Step 2 of 3"');
  });

  it('the check of a protected form sits right above the one button of a grouped last screen', () => {
    const last = steps.map((s) => (s.key === 'notes' ? { ...s, screenGroup: 'work' } : s));
    const html = renderToStaticMarkup(
      <FormRenderer
        accountCode="acme"
        slug="f"
        name="F"
        config={{ version: 1, steps: last } as never}
        locale="en"
        startAt={3}
        captcha={{ provider: 'turnstile', siteKey: 'site-key' }}
      />,
    );
    expect(count(html, 'data-testid="captcha-inline"')).toBe(1);
    expect(html).toMatch(/data-testid="captcha-inline"[^>]*>(<[^>]*>)*<\/div><button type="button" class="pf__btn/);
    expect(primaryButtons(html)[0]).toContain('>Submit<');
    // The screen before it does not end the form: no check there.
    const first = renderToStaticMarkup(
      <FormRenderer
        accountCode="acme"
        slug="f"
        name="F"
        config={{ version: 1, steps: last } as never}
        locale="en"
        startAt={0}
        captcha={{ provider: 'turnstile', siteKey: 'site-key' }}
      />,
    );
    expect(first).not.toContain('captcha-inline');
  });
});

describe('the one-page layout never reads screen ids', () => {
  it('renders byte for byte the same with or without them', () => {
    const render = (list: typeof steps) =>
      renderToStaticMarkup(
        <VerticalFormRenderer
          accountCode="acme"
          slug="f"
          name="F"
          config={{ version: 1, layout: 'vertical', steps: list } as never}
          locale="en"
        />,
      );
    const bare = steps.map(({ screenGroup: _drop, ...s }) => s);
    expect(render(steps)).toBe(render(bare as typeof steps));
  });
});
