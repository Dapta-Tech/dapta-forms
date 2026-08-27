/**
 * The integrations `Card` shell, and specifically its `notice` slot.
 *
 * `Card` hides its CHILDREN when the toggle is off — that is the whole point of
 * the toggle. A warning about what saving this card will destroy must not obey
 * that rule: a card switched off is exactly where the warning matters most,
 * because flipping the switch is itself an edit, and the autosave it triggers is
 * what performs the destructive collapse.
 *
 * That is not hypothetical. The "second HubSpot destination" notice originally
 * shipped as a child, so on a legacy form whose FIRST HubSpot destination was
 * stored disabled, the card rendered collapsed and the warning never mounted —
 * while the second destination was the one actually running bookings, and one
 * toggle would have deleted it silently. Hence the slot, and hence this file.
 */
import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ContactKeyReadiness } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { Card } from './integrations-card';
import { HubspotCard } from './integrations-editor';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const m = getMessages('en').admin.integrations;

function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  collect((node.props as AnyProps).children, out);
  return out;
}

function byTestId(els: ReactElement[], id: string): ReactElement | undefined {
  return els.find((el) => (el.props as AnyProps)['data-testid'] === id);
}

function render(enabled: boolean, withNotice: boolean): ReactElement[] {
  return collect(
    Card({
      title: 'HubSpot',
      desc: 'Sync submissions.',
      enabled,
      onToggle: () => {},
      m,
      notice: withNotice ? <div data-testid="a-notice">heads up</div> : undefined,
      children: <div data-testid="a-child">the settings</div>,
    }),
  );
}

describe('integrations Card — the notice slot', () => {
  it('renders the notice while the card is switched OFF, where children are hidden', () => {
    const els = render(false, true);
    expect(byTestId(els, 'a-notice')).toBeDefined();
    // The contrast that makes the slot necessary — this is the regression.
    expect(byTestId(els, 'a-child')).toBeUndefined();
  });

  it('renders the notice while the card is switched ON, alongside the children', () => {
    const els = render(true, true);
    expect(byTestId(els, 'a-notice')).toBeDefined();
    expect(byTestId(els, 'a-child')).toBeDefined();
  });

  it('renders nothing extra when there is no notice', () => {
    for (const enabled of [true, false]) {
      expect(byTestId(render(enabled, false), 'a-notice')).toBeUndefined();
    }
  });
});

/**
 * And the call site. The slot above is only half the fix — the bug was passing
 * the warning as a CHILD, which the slot cannot prevent on its own. These render
 * `HubspotCard` for real (it has hooks, so the shallow walker above cannot reach
 * it) and check the warning survives a switched-off card, which is the shape
 * that hid it: the tab reads `enabled` off the FIRST stored destination, while
 * booking resolves the first ENABLED one — so on a disabled-first pair the
 * invisible second destination is the one running bookings.
 */
describe('HubspotCard — where the extra-destination notice goes', () => {
  const im = getMessages('en').admin.integrations;
  const ready: ContactKeyReadiness = {
    ok: true,
    blocker: null,
    source: { kind: 'question', key: 'email' },
  } as ContactKeyReadiness;

  function markup(over: { enabled: boolean; extraHubspotStored: boolean }): string {
    return renderToStaticMarkup(
      <HubspotCard
        state={{
          enabled: over.enabled,
          fieldMappings: [],
          utmMappings: {},
          scoreProperty: '',
          dateProperty: '',
          note: true,
          formActivity: false,
          valueMaps: [],
          outcomeProperty: '',
          staticProperties: [],
          inferCompanyFromEmail: false,
          bookingSync: {
            stageProperty: '',
            stageValue: '',
            dateProperty: '',
            hoursProperty: '',
          },
          dayTimezone: '',
        }}
        onChange={() => {}}
        properties={[]}
        pickerEnabled
        accountConnected
        showMapping
        extraHubspotStored={over.extraHubspotStored}
        readiness={ready}
        questions={[{ key: 'email', type: 'email', label: 'Email' }]}
        formId="form-1"
        m={im}
      />,
    );
  }

  const NOTICE = 'data-testid="hubspot-extra-destination"';

  // The regression, exactly: as a child this vanished with the settings.
  it('shows the notice on a card that is switched OFF', () => {
    const html = markup({ enabled: false, extraHubspotStored: true });
    expect(html).toContain(NOTICE);
    expect(html).toContain(im.extraHubspotTitle);
    // The settings really are hidden — otherwise the assertion above is trivial.
    expect(html).not.toContain('data-testid="hubspot-how"');
  });

  it('shows the notice on a card that is switched ON', () => {
    const html = markup({ enabled: true, extraHubspotStored: true });
    expect(html).toContain(NOTICE);
    expect(html).toContain('data-testid="hubspot-how"');
  });

  it('shows nothing on a normal form, switched either way', () => {
    for (const enabled of [true, false]) {
      expect(markup({ enabled, extraHubspotStored: false })).not.toContain(NOTICE);
    }
  });
});

/**
 * The Day-timezone control reveals itself beside a `date`-type property pick
 * and stays hidden for a `datetime` one — the instant needs no zone. One shared
 * value, so two qualifying picks render two controls editing the same thing.
 */
describe('HubspotCard — Day timezone visibility by property type', () => {
  const im = getMessages('en').admin.integrations;
  const ready: ContactKeyReadiness = {
    ok: true,
    blocker: null,
    source: { kind: 'question', key: 'email' },
  } as ContactKeyReadiness;

  const PROPERTIES = [
    { name: 'submitted_day', label: 'Submitted day', type: 'date' },
    { name: 'booked_day', label: 'Booked day', type: 'date' },
    { name: 'meeting_at', label: 'Meeting at', type: 'datetime' },
  ];

  function markup(over: {
    dateProperty?: string;
    bookingDateProperty?: string;
    hoursProperty?: string;
  }): string {
    return renderToStaticMarkup(
      <HubspotCard
        state={{
          enabled: true,
          fieldMappings: [],
          utmMappings: {},
          scoreProperty: '',
          dateProperty: over.dateProperty ?? '',
          note: true,
          formActivity: false,
          valueMaps: [],
          outcomeProperty: '',
          staticProperties: [],
          inferCompanyFromEmail: false,
          bookingSync: {
            stageProperty: '',
            stageValue: '',
            dateProperty: over.bookingDateProperty ?? '',
            hoursProperty: over.hoursProperty ?? '',
          },
          dayTimezone: '',
        }}
        onChange={() => {}}
        properties={PROPERTIES}
        pickerEnabled
        accountConnected
        showMapping
        extraHubspotStored={false}
        readiness={ready}
        questions={[{ key: 'email', type: 'email', label: 'Email' }]}
        formId="form-1"
        m={im}
      />,
    );
  }

  // The control's own aria-label — the label text alone also appears inside
  // the day-field help copy, which would count phantom controls.
  const count = (html: string) =>
    html.split(`aria-label="${im.bookingDateTimezone}"`).length - 1;

  it('hidden with no day property picked anywhere', () => {
    expect(count(markup({}))).toBe(0);
  });

  it('shows beside a date-type submitted-date pick', () => {
    expect(count(markup({ dateProperty: 'submitted_day' }))).toBeGreaterThan(0);
  });

  it('hidden for a datetime submitted-date pick — the instant needs no zone', () => {
    expect(count(markup({ dateProperty: 'meeting_at' }))).toBe(0);
  });

  it('shows beside a date-type booking-date pick', () => {
    expect(count(markup({ bookingDateProperty: 'booked_day' }))).toBeGreaterThan(0);
  });

  it('meeting time: hidden for datetime (the default), shown for a date pick', () => {
    expect(count(markup({ hoursProperty: 'meeting_at' }))).toBe(0);
    expect(count(markup({ hoursProperty: 'booked_day' }))).toBeGreaterThan(0);
  });

  it('an unknown type reveals it for the day fields — the server day-collapses too', () => {
    expect(count(markup({ dateProperty: 'not_in_the_portal_list' }))).toBeGreaterThan(0);
  });
});
