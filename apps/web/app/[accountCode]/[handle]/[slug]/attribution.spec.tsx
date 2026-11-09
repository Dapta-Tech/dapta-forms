/**
 * The workspace's "Made with dForms" setting on the public form: the API's
 * `showAttribution` reaches every place the renderers draw the attribution,
 * and the deployment rule still applies on top.
 *
 *   - slides: the cover footer, every step, the empty form, and the
 *     thank-you CTA;
 *   - one page: the in-flow footer;
 *   - `MadeWithBadge` itself: `show={false}` draws nothing, and absent is the
 *     old behavior (the legacy-markup snapshots are the proof for that).
 *
 * The embed (`?embed=1`) and the builder preview mount these same renderers,
 * so this covers them too; the preview's hand-off is in `preview-document`.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import { runtimeSteps, type FormConfig } from '@quill/engine';

const env = vi.hoisted(() => {
  const saved = {
    NEXT_PUBLIC_SIGNUP_URL: process.env.NEXT_PUBLIC_SIGNUP_URL,
    NEXT_PUBLIC_LANDING_URL: process.env.NEXT_PUBLIC_LANDING_URL,
    NEXT_PUBLIC_HIDE_BADGE: process.env.NEXT_PUBLIC_HIDE_BADGE,
  };
  process.env.NEXT_PUBLIC_SIGNUP_URL = 'https://example.com/signup';
  delete process.env.NEXT_PUBLIC_LANDING_URL;
  delete process.env.NEXT_PUBLIC_HIDE_BADGE;
  return saved;
});

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

import { FormRenderer } from './form-renderer';
import { VerticalFormRenderer } from './vertical-form-renderer';
import { DoneScreen } from './renderer-shared';
import { MadeWithBadge } from '@/components/made-with-badge';
import fixtures from './__fixtures__/legacy-configs.json';

afterAll(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const config = fixtures['seed-lead-qualifier'] as unknown as FormConfig;
const BADGE = 'pf__attribution';

function slides(startAt: number | 'cover', showAttribution?: boolean, cfg: FormConfig = config): string {
  return renderToStaticMarkup(
    <FormRenderer
      accountCode="acme"
      slug="f"
      name="Form"
      config={cfg as never}
      locale="en"
      startAt={startAt}
      showAttribution={showAttribution}
    />,
  );
}

function onePage(showAttribution?: boolean): string {
  return renderToStaticMarkup(
    <VerticalFormRenderer
      accountCode="acme"
      slug="f"
      name="Form"
      config={{ ...config, layout: 'vertical' } as never}
      locale="en"
      showAttribution={showAttribution}
    />,
  );
}

describe('the public form obeys the workspace setting', () => {
  const positions: Array<number | 'cover'> = ['cover', ...runtimeSteps(config, {}).map((_, i) => i)];

  it('slides: the badge is on every screen by default and on none when hidden', () => {
    for (const at of positions) {
      expect(slides(at), `startAt ${at}`).toContain(BADGE);
      expect(slides(at, true), `startAt ${at}`).toContain(BADGE);
      expect(slides(at, false), `startAt ${at}`).not.toContain(BADGE);
    }
  });

  it('slides: a form with no steps drops it too', () => {
    const empty = { version: 1, steps: [] } as unknown as FormConfig;
    expect(slides('cover', undefined, empty)).toContain(BADGE);
    expect(slides('cover', false, empty)).not.toContain(BADGE);
  });

  it('one page: the in-flow footer follows the setting', () => {
    expect(onePage()).toContain(BADGE);
    expect(onePage(false)).not.toContain(BADGE);
  });

  it('the thank-you screen drops its growth CTA when hidden', () => {
    const m = getMessages('en').renderer;
    const done = (showAttribution?: boolean) =>
      renderToStaticMarkup(
        <DoneScreen
          ending={{ headline: null, body: null } as never}
          answers={{}}
          m={m}
          accountCode="acme"
          showAttribution={showAttribution}
        />,
      );
    expect(done()).toContain('pf-done__cta');
    expect(done()).toContain(m.ctaAction);
    expect(done(false)).not.toContain('pf-done__cta');
    expect(done(false)).not.toContain(m.ctaQuestion);
  });
});

describe('MadeWithBadge', () => {
  it('draws nothing with show={false}, and the pill when absent or true', () => {
    expect(renderToStaticMarkup(<MadeWithBadge accountCode="acme" show={false} />)).toBe('');
    expect(renderToStaticMarkup(<MadeWithBadge accountCode="acme" />)).toContain(BADGE);
    expect(renderToStaticMarkup(<MadeWithBadge accountCode="acme" show />)).toContain(BADGE);
  });

  it('the deployment rule still wins: no signup URL, no pill, whatever the workspace says', () => {
    const saved = process.env.NEXT_PUBLIC_SIGNUP_URL;
    delete process.env.NEXT_PUBLIC_SIGNUP_URL;
    try {
      expect(renderToStaticMarkup(<MadeWithBadge accountCode="acme" show />)).toBe('');
    } finally {
      process.env.NEXT_PUBLIC_SIGNUP_URL = saved;
    }
  });
});
