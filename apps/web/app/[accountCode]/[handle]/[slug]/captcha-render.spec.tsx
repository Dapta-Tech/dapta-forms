/**
 * Spam protection in the renderers' markup. The renderers act on the API's
 * `captcha` (the deployment has keys AND the owner switched it on) and never on
 * the owner's switch in the config, which is what keeps the builder preview,
 * a deployment without keys and every legacy form exactly as they were.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicCaptcha } from '@quill/types';

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

const steps = [
  { key: 'email', type: 'email' as const, question: 'Email?' },
  { key: 'company', type: 'text' as const, question: 'Company?' },
];
// The owner's switch, fully on. Only `captcha` below decides what renders.
const switchedOn = { version: 1, steps, spamProtection: { captcha: true, strict: true } };
const STRICT: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key', strict: true };
const AUTO: PublicCaptcha = { provider: 'turnstile', siteKey: 'site-key' };

function both(captcha: PublicCaptcha | undefined, config: Record<string, unknown> = switchedOn): string[] {
  return [
    renderToStaticMarkup(
      <FormRenderer accountCode="acme" slug="f" name="F" config={config as never} locale="en" captcha={captcha} startAt={0} />,
    ),
    renderToStaticMarkup(
      <VerticalFormRenderer
        accountCode="acme"
        slug="f"
        name="F"
        config={{ ...config, layout: 'vertical' } as never}
        locale="en"
        captcha={captcha}
      />,
    ),
  ];
}

describe('spam protection in the public markup', () => {
  it('strict: both layouts carry the hidden field on the screen the respondent answers on', () => {
    for (const html of both(STRICT)) {
      expect(html).toContain('name="pf_hp"');
      expect(html).toMatch(/<input[^>]*name="pf_hp"[^>]*>/);
      const input = html.match(/<input[^>]*name="pf_hp"[^>]*>/)![0];
      expect(input).toContain('tabindex="-1"');
      expect(input).toContain('aria-hidden="true"');
      // Static markup keeps React's camelCase; HTML attribute names are case-insensitive.
      expect(input.toLowerCase()).toContain('autocomplete="off"');
      expect(input).toContain('class="pf-hp"');
    }
  });

  it('automatic: no hidden field, and no widget in the page until the person starts', () => {
    for (const html of both(AUTO)) {
      expect(html).not.toContain('pf_hp');
      expect(html).not.toContain('captcha-widget');
    }
  });

  it('one-page: the empty slot for the check sits in the footer, right before Submit', () => {
    for (const captcha of [AUTO, STRICT]) {
      const vertical = both(captcha)[1]!;
      const footer = vertical.slice(vertical.indexOf('pf-v__footer'));
      expect(footer).toMatch(/data-testid="captcha-inline"[^>]*><\/div><button[^>]*class="pf__btn"/);
      expect(footer).toContain(`data-captcha-mode="${captcha.strict ? 'strict' : 'auto'}"`);
    }
  });

  it('slides: the slot only on a step whose own button ends the form', () => {
    const render = (startAt: number) =>
      renderToStaticMarkup(
        <FormRenderer accountCode="acme" slug="f" name="F" config={switchedOn as never} locale="en" captcha={AUTO} startAt={startAt} />,
      );
    expect(render(0)).not.toContain('captcha-inline'); // step 1 of 2: its button goes on
    expect(render(1)).toMatch(/data-testid="captcha-inline"[^>]*><\/div><button[^>]*class="pf__btn pf__btn--inline"/);
    // A terminal step ends the form from its own button too.
    const terminal = { ...switchedOn, steps: [{ ...steps[0]!, terminal: true }, steps[1]!] };
    expect(
      renderToStaticMarkup(
        <FormRenderer accountCode="acme" slug="f" name="F" config={terminal as never} locale="en" captcha={AUTO} startAt={0} />,
      ),
    ).toContain('captcha-inline');
  });

  it('without `captcha` (the builder preview, a deployment without keys) nothing renders, whatever the config says', () => {
    for (const html of both(undefined)) {
      expect(html).not.toContain('pf_hp');
      expect(html).not.toContain('captcha');
    }
  });

  it('never ships the provider script in the page: it loads on demand, and only for a form with a check', () => {
    for (const html of [...both(STRICT), ...both(AUTO), ...both(undefined)]) {
      expect(html).not.toContain('challenges.cloudflare.com');
    }
  });

  it('a legacy config with no switch at all renders exactly as before', () => {
    const legacy = { version: 1, steps };
    const [slides, vertical] = both(undefined, legacy);
    const [slidesSwitched, verticalSwitched] = both(undefined, switchedOn);
    // The switch in the config changes nothing on its own: same markup.
    expect(slidesSwitched).toBe(slides);
    expect(verticalSwitched).toBe(vertical);
  });
});
