/**
 * Contract tests for `formConfigSchema` — architecture invariant #4: the form
 * config is a versioned schema that gets EXTENDED, never broken. Every field
 * added here is optional, so the assertions that matter are the ones about what
 * a config saved before the field existed still does.
 *
 * The presentation axes added alongside the banner/reveal/marquee work are the
 * first ones to be pinned this way; the file exists so the next additive field
 * has somewhere obvious to prove the same thing.
 */
import { describe, expect, it } from 'vitest';
import { formConfigSchema } from './index';

/** The smallest config the schema accepts — one step, nothing configured. */
function baseConfig() {
  return {
    version: 1 as const,
    steps: [{ key: 'q1', type: 'text' as const, question: 'Your name?' }],
  };
}

describe('formConfigSchema — banner presentation (additive)', () => {
  it('a config with a banner and no look still parses, and sets no look', () => {
    const parsed = formConfigSchema.parse({
      ...baseConfig(),
      cover: { bannerText: 'Free credits when you book' },
    });
    expect(parsed.cover?.bannerText).toBe('Free credits when you book');
    // Absent, not defaulted: the renderer's CSS fallback owns the legacy look,
    // so writing a default in here would be the one way to change it.
    expect(parsed.cover?.bannerColor).toBeUndefined();
    expect(parsed.cover?.bannerSize).toBeUndefined();
  });

  it('accepts the authored banner look', () => {
    const parsed = formConfigSchema.parse({
      ...baseConfig(),
      cover: {
        bannerText: 'Free credits',
        bannerColor: '#c6f24e',
        bannerTextColor: '#0b0b0b',
        bannerSize: 'lg',
      },
    });
    expect(parsed.cover?.bannerColor).toBe('#c6f24e');
    expect(parsed.cover?.bannerTextColor).toBe('#0b0b0b');
    expect(parsed.cover?.bannerSize).toBe('lg');
  });

  it('rejects a banner color that could break out of the CSS color context', () => {
    const bad = { ...baseConfig(), cover: { bannerColor: 'red;} body{display:none' } };
    expect(formConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown banner size rather than silently ignoring it', () => {
    const bad = { ...baseConfig(), cover: { bannerSize: 'huge' } };
    expect(formConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe('formConfigSchema — client-logo scope (additive)', () => {
  it('a legacy marquee parses with no scope — the renderer reads that as the cover', () => {
    const parsed = formConfigSchema.parse({
      ...baseConfig(),
      cover: { clientLogos: [{ name: 'Acme' }] },
    });
    expect(parsed.cover?.clientLogos).toHaveLength(1);
    expect(parsed.cover?.clientLogosScope).toBeUndefined();
  });

  it('accepts each scope', () => {
    for (const clientLogosScope of ['cover', 'reveal', 'both'] as const) {
      const parsed = formConfigSchema.parse({ ...baseConfig(), cover: { clientLogosScope } });
      expect(parsed.cover?.clientLogosScope).toBe(clientLogosScope);
    }
  });
});

describe('formConfigSchema — reveal presentation (additive)', () => {
  it('a legacy reveal parses with no presentation set', () => {
    const parsed = formConfigSchema.parse({
      ...baseConfig(),
      reveal: { headline: 'Matching you…', durationMs: 5000 },
    });
    expect(parsed.reveal?.durationMs).toBe(5000);
    expect(parsed.reveal?.loader).toBeUndefined();
    expect(parsed.reveal?.accentBackground).toBeUndefined();
  });

  it('accepts the full presentation on a reveal STEP as well as the form-level one', () => {
    const reveal = {
      loader: 'versus' as const,
      loaderSize: 'lg' as const,
      textSize: 'sm' as const,
      accentBackground: true,
      versusYouLabel: 'You',
      versusMatchLabel: 'Your [role]',
    };
    const parsed = formConfigSchema.parse({
      version: 1 as const,
      steps: [{ key: 'r1', type: 'reveal' as const, question: '', reveal }],
      reveal,
    });
    expect(parsed.steps[0]?.reveal?.loader).toBe('versus');
    expect(parsed.steps[0]?.reveal?.versusMatchLabel).toBe('Your [role]');
    expect(parsed.reveal?.accentBackground).toBe(true);
  });

  it('rejects an unknown loader', () => {
    const bad = { ...baseConfig(), reveal: { loader: 'fireworks' } };
    expect(formConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('keeps the existing duration bounds', () => {
    expect(formConfigSchema.safeParse({ ...baseConfig(), reveal: { durationMs: 400 } }).success).toBe(
      false,
    );
    expect(
      formConfigSchema.safeParse({ ...baseConfig(), reveal: { durationMs: 30_001 } }).success,
    ).toBe(false);
  });
});
