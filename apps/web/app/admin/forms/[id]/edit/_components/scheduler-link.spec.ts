import { describe, expect, it } from 'vitest';
import { isLinkConfigured, parseCalendlyLink } from './scheduler-link';

describe('parseCalendlyLink', () => {
  it('accepts the event page link as copied from the browser', () => {
    expect(parseCalendlyLink('https://calendly.com/dapta-onboarding/onboarding-scale_up')).toEqual({
      url: 'https://calendly.com/dapta-onboarding/onboarding-scale_up',
      slug: 'onboarding-scale_up',
      name: 'Onboarding scale up',
    });
  });

  it('drops the query string and hash — the renderer builds its own', () => {
    const link = parseCalendlyLink(
      'https://calendly.com/acme/demo?month=2026-09&hide_gdpr_banner=1#top',
    );
    expect(link?.url).toBe('https://calendly.com/acme/demo');
  });

  it('pulls the data-url out of the whole embed snippet', () => {
    const snippet = `<!-- Calendly inline widget begin -->
<div class="calendly-inline-widget" data-url="https://calendly.com/dapta-onboarding/onboarding-scale_up" style="min-width:320px;height:700px;"></div>
<script type="text/javascript" src="https://assets.calendly.com/assets/external/widget.js" async></script>
<!-- Calendly inline widget end -->`;
    expect(parseCalendlyLink(snippet)?.url).toBe(
      'https://calendly.com/dapta-onboarding/onboarding-scale_up',
    );
  });

  it('finds a link pasted inside other text, and tolerates a missing scheme', () => {
    expect(parseCalendlyLink('here: https://calendly.com/acme/intro thanks')?.slug).toBe('intro');
    expect(parseCalendlyLink('calendly.com/acme/intro')?.url).toBe('https://calendly.com/acme/intro');
    expect(parseCalendlyLink('http://calendly.com/acme/intro')?.url).toBe(
      'https://calendly.com/acme/intro',
    );
  });

  it('keeps a Calendly subdomain and a deeper path (single-use links)', () => {
    expect(parseCalendlyLink('https://acme.calendly.com/sales/demo')?.url).toBe(
      'https://acme.calendly.com/sales/demo',
    );
    expect(parseCalendlyLink('https://calendly.com/d/abc-123/discovery')?.slug).toBe('discovery');
  });

  it('rejects anything that is not a Calendly EVENT page', () => {
    expect(parseCalendlyLink('')).toBeNull();
    expect(parseCalendlyLink('   ')).toBeNull();
    expect(parseCalendlyLink('https://calendly.com/acme'), 'owner landing, no event').toBeNull();
    expect(parseCalendlyLink('https://example.com/acme/demo'), 'wrong host').toBeNull();
    expect(parseCalendlyLink('https://notcalendly.com/acme/demo'), 'lookalike host').toBeNull();
    expect(parseCalendlyLink('https://calendly.com.evil.io/acme/demo'), 'host prefix').toBeNull();
    expect(parseCalendlyLink('not a url'), 'plain text').toBeNull();
  });
});

describe('isLinkConfigured', () => {
  it('is true only when a url was stored without a picked event type', () => {
    expect(isLinkConfigured({ eventTypeUri: null, url: 'https://calendly.com/a/b' })).toBe(true);
    expect(isLinkConfigured({ eventTypeUri: 'et/1', url: 'https://calendly.com/a/b' })).toBe(false);
    expect(isLinkConfigured({ eventTypeUri: null, url: null })).toBe(false);
    expect(isLinkConfigured({})).toBe(false);
  });
});
