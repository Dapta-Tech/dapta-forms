/**
 * Unit tests for the reveal interstitial's pure copy/duration resolution —
 * configured copy vs. localized fallbacks, subtitleTemplate interpolation via
 * the engine's `interpolate`, and the 2200ms default duration.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_REVEAL_MS, resolveRevealCopy } from './reveal-screen';

const messages = {
  headline: 'Reviewing your answers…',
  subtitle: 'One moment.',
  versusYou: 'You',
  versusMatch: 'Your match',
  versusStatus: 'Searching…',
};

describe('resolveRevealCopy', () => {
  it('falls back to the localized messages when the config has no copy', () => {
    expect(resolveRevealCopy(null, {}, messages)).toEqual({
      headline: messages.headline,
      subtitle: messages.subtitle,
      durationMs: DEFAULT_REVEAL_MS,
      versusYou: messages.versusYou,
      versusMatch: messages.versusMatch,
      versusStatus: messages.versusStatus,
    });
    expect(resolveRevealCopy({}, {}, messages).headline).toBe(messages.headline);
  });

  it('an EMPTY status survives, because clearing it means "no status line"', () => {
    // The two labels fall back on any falsy value — a blank label is just an
    // unnamed side. The status is different: the line exists or it does not, so
    // only an ABSENT value may take the localized default.
    expect(resolveRevealCopy({ versusStatusLabel: '' }, {}, messages).versusStatus).toBe('');
    expect(resolveRevealCopy({ versusStatusLabel: null }, {}, messages).versusStatus).toBe(
      messages.versusStatus,
    );
    expect(resolveRevealCopy({}, {}, messages).versusStatus).toBe(messages.versusStatus);
  });

  it('interpolates the status line', () => {
    const out = resolveRevealCopy(
      { versusStatusLabel: 'Searching in [industry]…' },
      { industry: 'fintech' },
      messages,
    );
    expect(out.versusStatus).toBe('Searching in fintech…');
  });

  it('uses the configured versus labels and interpolates them', () => {
    const out = resolveRevealCopy(
      { versusYouLabel: '[firstname]', versusMatchLabel: 'Your [role]' },
      { firstname: 'Ana', role: 'advisor' },
      messages,
    );
    expect(out.versusYou).toBe('Ana');
    expect(out.versusMatch).toBe('Your advisor');
  });

  it('uses the configured headline/subtitle when present', () => {
    const out = resolveRevealCopy(
      { headline: 'Hold tight', subtitle: 'Crunching numbers' },
      {},
      messages,
    );
    expect(out.headline).toBe('Hold tight');
    expect(out.subtitle).toBe('Crunching numbers');
  });

  it('interpolates the subtitleTemplate from the answers, winning over subtitle', () => {
    const out = resolveRevealCopy(
      { subtitle: 'ignored', subtitleTemplate: 'Finding the best advisor for [industry]…' },
      { industry: 'fintech' },
      messages,
    );
    expect(out.subtitle).toBe('Finding the best advisor for fintech…');
  });

  it('joins array answers and blanks missing tokens in templates', () => {
    const out = resolveRevealCopy(
      { subtitleTemplate: 'For [tools] ([missing])' },
      { tools: ['crm', 'ads'] },
      messages,
    );
    expect(out.subtitle).toBe('For crm, ads ()');
  });

  it('honors a configured durationMs and defaults to 2200', () => {
    expect(resolveRevealCopy({ durationMs: 5000 }, {}, messages).durationMs).toBe(5000);
    expect(resolveRevealCopy({}, {}, messages).durationMs).toBe(DEFAULT_REVEAL_MS);
    expect(DEFAULT_REVEAL_MS).toBe(2200);
  });
});
