/**
 * Unit tests for the reveal interstitial's pure copy/duration resolution —
 * configured copy vs. localized fallbacks, subtitleTemplate interpolation via
 * the engine's `interpolate`, and the 2200ms default duration.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_REVEAL_MS, RevealScreen, resolveRevealCopy } from './reveal-screen';

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

/**
 * The brand logo on the interstitial.
 *
 * Two guarantees worth a test rather than an eyeball. The first is the absent
 * case: a form with no logo has to render byte-identical to what it rendered
 * before this prop existed, and "byte-identical" is exactly the kind of claim
 * that rots silently. The second is that a broken image prints NOTHING — the
 * `name` here is the author's internal name for the form, and it must never
 * reach a respondent because a URL 404'd.
 */
describe('RevealScreen — the brand logo', () => {
  const base = { answers: {}, messages, name: 'Q3 paid-ads lead gen v2' };

  it('renders no brand block, and no name, when there is no logo', () => {
    const html = renderToStaticMarkup(<RevealScreen {...base} />);
    expect(html).not.toContain('pf-reveal__brand');
    // The whole reason for `fallback="none"`.
    expect(html).not.toContain('Q3 paid-ads lead gen v2');
  });

  it('a null logo is the same as no logo', () => {
    expect(renderToStaticMarkup(<RevealScreen {...base} logo={null} />)).toBe(
      renderToStaticMarkup(<RevealScreen {...base} />),
    );
  });

  it('renders the logo above the copy when there is one', () => {
    const html = renderToStaticMarkup(<RevealScreen {...base} logo="https://cdn.test/logo.svg" />);
    expect(html).toContain('pf-reveal__brand');
    expect(html).toContain('https://cdn.test/logo.svg');
    // Above the headline, not merely present.
    expect(html.indexOf('pf-reveal__brand')).toBeLessThan(html.indexOf('pf-reveal__headline'));
    // The name rides as the alt only — never as visible text.
    expect(html).toContain('alt="Q3 paid-ads lead gen v2"');
  });

  it('sits above every loader variant', () => {
    for (const loader of ['spinner', 'bar', 'versus', 'none'] as const) {
      const html = renderToStaticMarkup(
        <RevealScreen {...base} reveal={{ enabled: true, loader }} logo="https://cdn.test/l.svg" />,
      );
      expect(html).toContain('pf-reveal__brand');
    }
  });
});
