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
import { formConfigSchema, hasExtraHubspotDestination, submissionSchema } from './index';

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

/**
 * The one-HubSpot rule is a WRITE-path predicate, not a schema refinement, so
 * it gets tested where it lives. What matters most here is the false cases: it
 * is called on request bodies, so anything that is not a well-formed array of
 * destination objects must answer "no extra" rather than throw and turn a bad
 * request into a 500.
 */
describe('hasExtraHubspotDestination', () => {
  const hubspot = { type: 'hubspot', enabled: true, settings: {} };
  const webhook = { type: 'webhook', enabled: true, settings: { url: 'https://x.test/h' } };

  it('is true only from the second HubSpot entry onwards', () => {
    expect(hasExtraHubspotDestination([])).toBe(false);
    expect(hasExtraHubspotDestination([hubspot])).toBe(false);
    expect(hasExtraHubspotDestination([hubspot, hubspot])).toBe(true);
    expect(hasExtraHubspotDestination([hubspot, hubspot, hubspot])).toBe(true);
  });

  it('counts HubSpot entries wherever they sit, and ignores webhooks', () => {
    expect(hasExtraHubspotDestination([webhook, webhook, webhook])).toBe(false);
    expect(hasExtraHubspotDestination([webhook, hubspot, webhook])).toBe(false);
    expect(hasExtraHubspotDestination([webhook, hubspot, webhook, hubspot])).toBe(true);
  });

  // `enabled` is deliberately not consulted: a disabled first + enabled second
  // is the sharpest form of the trap, since the two readers disagree on it.
  it('ignores `enabled` entirely', () => {
    expect(hasExtraHubspotDestination([{ ...hubspot, enabled: false }, hubspot])).toBe(true);
  });

  it('never throws on input that is not a destinations array', () => {
    for (const junk of [undefined, null, {}, 'hubspot', 42, [null], [undefined], ['hubspot']]) {
      expect(hasExtraHubspotDestination(junk)).toBe(false);
    }
    // Two junk entries next to two real ones must still be caught.
    expect(hasExtraHubspotDestination([null, hubspot, 'x', hubspot])).toBe(true);
  });

  /**
   * The rule is "never go UP", because screens that edit ONE field write the
   * whole array back. Without the comparison, a legacy form's every unrelated
   * save is a 400 and its Build tab stops working.
   */
  describe('compared against what is stored', () => {
    it('allows a legacy pair to round-trip unchanged', () => {
      expect(hasExtraHubspotDestination([hubspot, hubspot], [hubspot, hubspot])).toBe(false);
    });

    it('allows a legacy form to collapse toward one', () => {
      expect(hasExtraHubspotDestination([hubspot], [hubspot, hubspot])).toBe(false);
    });

    it('refuses any increase', () => {
      expect(hasExtraHubspotDestination([hubspot, hubspot], [hubspot])).toBe(true);
      expect(hasExtraHubspotDestination([hubspot, hubspot], [])).toBe(true);
      expect(hasExtraHubspotDestination([hubspot, hubspot, hubspot], [hubspot, hubspot])).toBe(true);
    });

    it('never lets a stored violation authorise a bigger one', () => {
      // Three is refused even though two are already stored.
      expect(hasExtraHubspotDestination([hubspot, hubspot, hubspot], [hubspot, hubspot])).toBe(true);
    });

    it('treats an absent or unreadable stored value as nothing stored', () => {
      expect(hasExtraHubspotDestination([hubspot, hubspot], undefined)).toBe(true);
      expect(hasExtraHubspotDestination([hubspot, hubspot], null)).toBe(true);
      expect(hasExtraHubspotDestination([hubspot, hubspot], 'nonsense')).toBe(true);
      // One is always fine, whatever is stored.
      expect(hasExtraHubspotDestination([hubspot], undefined)).toBe(false);
    });

    it('still ignores webhooks on both sides', () => {
      expect(hasExtraHubspotDestination([webhook, webhook, hubspot], [hubspot])).toBe(false);
    });
  });
});

describe('formConfigSchema: form language and button labels (additive)', () => {
  it('a legacy config parses with neither field set (Auto language, stock labels)', () => {
    const parsed = formConfigSchema.parse(baseConfig());
    expect(parsed.language).toBeUndefined();
    expect(parsed.labels).toBeUndefined();
  });

  it('keeps an explicit language and partial labels', () => {
    const parsed = formConfigSchema.parse({
      ...baseConfig(),
      language: 'es',
      labels: { next: 'Siguiente' },
    });
    expect(parsed.language).toBe('es');
    expect(parsed.labels).toEqual({ next: 'Siguiente' });
  });

  it('accepts null for both (the editor clears back to Auto / stock this way)', () => {
    const parsed = formConfigSchema.parse({ ...baseConfig(), language: null, labels: null });
    expect(parsed.language).toBeNull();
    expect(parsed.labels).toBeNull();
  });

  it('rejects a language the product does not ship and a label over 80 characters', () => {
    expect(() => formConfigSchema.parse({ ...baseConfig(), language: 'fr' })).toThrow();
    expect(() => formConfigSchema.parse({ ...baseConfig(), labels: { submit: 'x'.repeat(81) } })).toThrow();
  });
});

describe('submissionSchema: the locale the respondent saw (additive)', () => {
  it('carries an optional locale and rejects an unknown one', () => {
    expect(submissionSchema.parse({ sessionId: 's', data: {} }).locale).toBeUndefined();
    expect(submissionSchema.parse({ sessionId: 's', data: {}, locale: 'es' }).locale).toBe('es');
    expect(() => submissionSchema.parse({ sessionId: 's', data: {}, locale: 'fr' })).toThrow();
  });
});
