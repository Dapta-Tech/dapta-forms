import { describe, expect, it } from 'vitest';
import { suiteHref } from './suite';

describe('suiteHref — the in-app doors to the suite', () => {
  it('tags the link with the product as source and the chrome as medium', () => {
    const url = new URL(suiteHref('https://app.example.com', 'sidebar'));
    expect(url.searchParams.get('utm_source')).toBe('forms');
    expect(url.searchParams.get('utm_medium')).toBe('sidebar');
  });

  it('names the door, so the switcher and the rail item stay distinguishable', () => {
    expect(new URL(suiteHref('https://app.example.com', 'app_switcher')).searchParams.get('utm_medium')).toBe(
      'app_switcher',
    );
  });

  it('keeps an existing query and path', () => {
    const url = new URL(suiteHref('https://app.example.com/agents?ref=x', 'sidebar'));
    expect(url.pathname).toBe('/agents');
    expect(url.searchParams.get('ref')).toBe('x');
    expect(url.searchParams.get('utm_source')).toBe('forms');
  });

  it('returns an unparseable base verbatim rather than hiding it', () => {
    // A suite link that looks broken is a bug worth seeing; only the public
    // badge hides, because a fork may legitimately have no destination.
    expect(suiteHref('not a url', 'sidebar')).toBe('not a url');
  });
});
