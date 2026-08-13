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
            dateTimezone: '',
          },
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
