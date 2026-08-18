/**
 * DatePicker closed-state contract: the trigger is a dialog-opening button that
 * shows the value in the viewer's locale (or the catalog placeholder), and no
 * calendar is in the markup until it opens. Rendered with react-dom/server since
 * the web vitest env has no DOM; open-state behaviour lives in the e2e.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import { DatePicker } from './date-picker';

const noop = () => {};

describe('DatePicker (closed)', () => {
  it('shows the formatted date per locale', () => {
    const en = renderToStaticMarkup(
      <DatePicker value="2026-08-18" onChange={noop} locale="en" ariaLabel="From" testId="dp" />,
    );
    expect(en).toContain('Aug 18, 2026');
    expect(en).toContain('data-testid="dp"');
    const es = renderToStaticMarkup(
      <DatePicker value="2026-08-18" onChange={noop} locale="es" ariaLabel="Desde" />,
    );
    expect(es).toMatch(/18 ago/);
  });

  it('shows the catalog placeholder when empty and no clear button', () => {
    const en = renderToStaticMarkup(
      <DatePicker value="" onChange={noop} locale="en" ariaLabel="From" testId="dp" />,
    );
    expect(en).toContain(getMessages('en').admin.datePicker.placeholder);
    expect(en).not.toContain('data-testid="dp-clear"');
    const es = renderToStaticMarkup(
      <DatePicker value="" onChange={noop} locale="es" ariaLabel="Desde" />,
    );
    expect(es).toContain(getMessages('es').admin.datePicker.placeholder);
  });

  it('exposes a clear button when a value is set', () => {
    const html = renderToStaticMarkup(
      <DatePicker value="2026-08-18" onChange={noop} locale="en" ariaLabel="From" testId="dp" />,
    );
    expect(html).toContain('data-testid="dp-clear"');
    // Two pickers sit side by side on the analytics page, so each clear button
    // names its field.
    expect(html).toContain(`aria-label="${getMessages('en').admin.datePicker.clear}: From"`);
  });

  it('announces the set value in the trigger name, not only the field label', () => {
    const html = renderToStaticMarkup(
      <DatePicker value="2026-08-18" onChange={noop} locale="en" ariaLabel="From" />,
    );
    expect(html).toContain('aria-label="From, Aug 18, 2026"');
  });

  it('is a dialog trigger, closed by default, with no calendar in the markup', () => {
    const html = renderToStaticMarkup(
      <DatePicker value="2026-08-18" onChange={noop} locale="en" ariaLabel="From" />,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="From, Aug 18, 2026"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('role="grid"');
    expect(html).not.toContain('<input');
  });
});
