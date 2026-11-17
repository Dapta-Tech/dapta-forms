/**
 * The booking page a form hands its visitor carries the visitor's campaign,
 * never the form's own session id.
 *
 * The embed used to put the session id in `utm_content`, which overwrote the
 * campaign's own `utm_content` on every booking dCal and Calendly recorded
 * (and on the CRM contact their integrations wrote from it). Nothing read the
 * id back: the booking reaches its submission through the renderer's callback.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookingScreen } from './booking-screen';

const DCAL = 'https://book.example.test/acme/sam/intro';

function iframeSrc(html: string, testId: string): URL {
  const tag = new RegExp(`<iframe[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
  const src = /src="([^"]+)"/.exec(tag)?.[1] ?? '';
  return new URL(src.replace(/&amp;/g, '&'));
}

describe('BookingScreen: the campaign on the booking page', () => {
  it('hands dCal the visitor utm_content, not the session id', () => {
    const html = renderToStaticMarkup(
      <BookingScreen
        booking={{ provider: 'dcal', url: DCAL }}
        answers={{ email: 'ada@example.com' }}
        sessionId="sess_123"
        utm={{ utm_source: 'linkedin', utm_content: 'carousel-2' }}
        onBooked={() => {}}
      />,
    );
    const src = iframeSrc(html, 'booking-iframe-dcal');
    expect(src.searchParams.get('utm_content')).toBe('carousel-2');
    expect(src.searchParams.get('utm_source')).toBe('linkedin');
    expect(src.toString()).not.toContain('sess_123');
  });

  it('puts nothing in utm_content for a visitor who came with no campaign', () => {
    const html = renderToStaticMarkup(
      <BookingScreen booking={{ provider: 'dcal', url: DCAL }} answers={{}} sessionId="sess_123" onBooked={() => {}} />,
    );
    const src = iframeSrc(html, 'booking-iframe-dcal');
    expect(src.searchParams.has('utm_content')).toBe(false);
    expect(src.toString()).not.toContain('sess_123');
  });
});
