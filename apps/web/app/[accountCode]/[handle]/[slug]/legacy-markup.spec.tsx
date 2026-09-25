/**
 * Every form saved before screens existed renders byte for byte as it did.
 *
 * The public page is the one surface a respondent sees, and a change to the
 * slides renderer can move markup nobody meant to touch. So the markup of the
 * forms that already exist is pinned here: every fixture, in the slides
 * layout at every position the builder preview can open it on (the cover,
 * then each step of the walk), and once in the one-page layout.
 *
 * The configs are a FROZEN copy (`__fixtures__/legacy-configs.json`), taken
 * from the seed's sample form, the pilot import (`qa/import-pilot-form.ts`),
 * the onboarding demo and templates (`packages/db/src/templates`) and the
 * builder's templates, stripped the way the API strips a public config. Frozen
 * on purpose: a stored form never changes when a template is edited, and this
 * proof is about the renderer, not about template copy. The copy is the
 * sources' own, except four dashes written as words or commas, so nothing
 * here trips the repo's dash rule.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeScreenGroups, runtimeScreens, runtimeSteps, screenIds, type FormConfig } from '@quill/engine';

// The attribution badge reads the deployment's env at render time, and the
// brand mark at import time: both are pinned so the proof holds on any machine.
const env = vi.hoisted(() => {
  const saved = {
    NEXT_PUBLIC_SIGNUP_URL: process.env.NEXT_PUBLIC_SIGNUP_URL,
    NEXT_PUBLIC_LANDING_URL: process.env.NEXT_PUBLIC_LANDING_URL,
    NEXT_PUBLIC_HIDE_BADGE: process.env.NEXT_PUBLIC_HIDE_BADGE,
    NEXT_PUBLIC_PRODUCT_NAME: process.env.NEXT_PUBLIC_PRODUCT_NAME,
  };
  process.env.NEXT_PUBLIC_SIGNUP_URL = 'https://example.com/signup';
  delete process.env.NEXT_PUBLIC_LANDING_URL;
  delete process.env.NEXT_PUBLIC_HIDE_BADGE;
  delete process.env.NEXT_PUBLIC_PRODUCT_NAME;
  return saved;
});

// `next/font/google` resolves at build time and has no runtime in vitest; the
// renderers only need a className from it.
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
import fixtures from './__fixtures__/legacy-configs.json';

afterAll(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function slides(config: FormConfig, startAt: number | 'cover'): string {
  return renderToStaticMarkup(
    <FormRenderer accountCode="acme" slug="f" name="Legacy form" config={config as never} locale="en" startAt={startAt} />,
  );
}

function onePage(config: FormConfig): string {
  return renderToStaticMarkup(
    <VerticalFormRenderer
      accountCode="acme"
      slug="f"
      name="Legacy form"
      config={{ ...config, layout: 'vertical' } as never}
      locale="en"
    />,
  );
}

describe('legacy forms render byte for byte', () => {
  for (const [name, raw] of Object.entries(fixtures)) {
    it(name, async () => {
      const config = raw as unknown as FormConfig;
      // Every position the preview protocol can ask for with no answers yet.
      const positions: Array<number | 'cover'> = [
        'cover',
        ...runtimeSteps(config, {}).map((_, i) => i),
      ];
      const parts = positions.map((at) => `<!-- slides, startAt ${at} -->\n${slides(config, at)}\n`);
      parts.push(`<!-- one page -->\n${onePage(config)}\n`);
      await expect(parts.join('')).toMatchFileSnapshot(`./__snapshots__/legacy-markup/${name}.html`);
    });
  }
});

describe('legacy forms walk as before: one screen per step, and opening one changes nothing', () => {
  for (const [name, raw] of Object.entries(fixtures)) {
    it(name, () => {
      const config = raw as unknown as FormConfig;
      expect([...screenIds(config).values()].every((id) => id === null)).toBe(true);
      expect(runtimeScreens(config, {})).toEqual(runtimeSteps(config, {}).map((s) => [s]));
      // The editor normalizes on open: the very same array means no edit.
      expect(normalizeScreenGroups(config.steps)).toBe(config.steps);
    });
  }
});
