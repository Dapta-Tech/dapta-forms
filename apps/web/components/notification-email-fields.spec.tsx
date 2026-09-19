/**
 * The recipient-list editor inside NotificationEmailFields: the control that
 * decides who the new-submission notice reaches. Rendered with
 * react-dom/server, since the web vitest env has no DOM.
 *
 * What it pins is the shape the editor has to hold at every count and state:
 * the empty list says where the notice goes instead (the owner), a filled row
 * that is not an address is marked ON THAT ROW rather than as "something
 * failed", the add button stops at the ceiling, and the whole block is absent
 * on the email that addresses the respondent.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  looksLikeEmail,
  NotificationEmailFields,
  type NotificationEmailValue,
} from './notification-email-fields';

const noop = () => {};

const LABELS = {
  enabledLabel: 'Send this email',
  enabledHint: 'Turn it off to stop sending.',
  subjectLabel: 'Subject',
  bodyLabel: 'Body',
  tokensLabel: 'Variables',
  tokensHint: 'Click to insert.',
  previewLabel: 'Preview',
  previewSubject: 'Subject',
  tokenLabels: { formName: 'Form name' },
  recipientsLabel: 'Send to',
  recipientsHint: 'Each address receives its own copy.',
  recipientsEmpty: 'No addresses yet, so this email goes to the workspace owner.',
  recipientsAdd: 'Add address',
  recipientsRemove: 'Remove address',
  recipientsPlaceholder: 'name@example.com',
  recipientsInvalid: 'Enter a valid email address.',
};

function render(
  value: Partial<NotificationEmailValue>,
  recipients?: { max: number; note?: string | null },
) {
  return renderToStaticMarkup(
    <NotificationEmailFields
      value={{ enabled: true, subject: 'Subject', body: 'Body', ...value }}
      onChange={noop}
      tokens={['formName']}
      labels={LABELS}
      testIdPrefix="t"
      recipients={recipients}
    />,
  );
}

const count = (html: string, needle: string): number => html.split(needle).length - 1;

/**
 * The whole opening tag carrying `data-testid`, so assertions ignore attribute
 * order. Callers look for the `disabled=""` ATTRIBUTE: a bare "disabled" also
 * matches the `disabled:*` Tailwind variants every Button carries in its class.
 */
function tagWith(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`no element with data-testid="${testId}"`);
  return match[0];
}

describe('looksLikeEmail', () => {
  it('accepts an address and rejects a half-typed one', () => {
    expect(looksLikeEmail('ceo@acme.io')).toBe(true);
    expect(looksLikeEmail('  ceo@acme.io ')).toBe(true);
    expect(looksLikeEmail('ceo@')).toBe(false);
    expect(looksLikeEmail('ceo')).toBe(false);
    expect(looksLikeEmail('a b@example.com')).toBe(false);
  });
});

describe('recipient list', () => {
  it('is absent entirely when the email addresses itself (no prop)', () => {
    const html = render({ recipients: ['ceo@acme.io'] });
    expect(html).not.toContain('Send to');
    expect(html).not.toContain('data-testid="t-recipients"');
  });

  it('with no addresses, says where the notice goes instead of showing a blank row', () => {
    const html = render({ recipients: [] }, { max: 5 });
    expect(html).toContain('data-testid="t-recipients-empty"');
    expect(html).toContain('No addresses yet, so this email goes to the workspace owner.');
    expect(count(html, 'data-testid="t-recipient-')).toBe(1); // the add button alone
  });

  it('renders one row with its own remove control per address', () => {
    const html = render({ recipients: ['ceo@acme.io', 'sales@example.com'] }, { max: 5 });
    expect(html).toContain('value="ceo@acme.io"');
    expect(html).toContain('value="sales@example.com"');
    expect(count(html, 'data-testid="t-recipient-remove-')).toBe(2);
    expect(html).not.toContain('data-testid="t-recipients-empty"');
  });

  it('marks the offending ROW, not the block, and leaves a row still being typed alone', () => {
    const html = render({ recipients: ['ceo@acme.io', 'nope', ''] }, { max: 5 });
    expect(html).toContain('data-testid="t-recipient-1-invalid"');
    expect(html).not.toContain('data-testid="t-recipient-0-invalid"');
    // An empty row is not yet wrong: it is a row someone just added.
    expect(html).not.toContain('data-testid="t-recipient-2-invalid"');
    expect(count(html, 'Enter a valid email address.')).toBe(1);
  });

  it('stops offering "add" at the ceiling', () => {
    const four = ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'];
    expect(tagWith(render({ recipients: four }, { max: 5 }), 't-recipient-add')).not.toContain(
      'disabled=""',
    );
    const full = render({ recipients: [...four, 'e@example.com'] }, { max: 5 });
    expect(tagWith(full, 't-recipient-add')).toContain('disabled=""');
  });

  it('disables every control while the email itself is turned off', () => {
    const html = render({ enabled: false, recipients: ['ceo@acme.io'] }, { max: 5 });
    for (const id of ['t-recipient-0', 't-recipient-remove-0', 't-recipient-add']) {
      expect(tagWith(html, id)).toContain('disabled=""');
    }
  });

  it('shows which layer the list comes from when the surface passes a note', () => {
    const html = render({ recipients: ['ceo@acme.io'] }, { max: 5, note: 'Following the account list.' });
    expect(html).toContain('Following the account list.');
    expect(render({ recipients: ['ceo@acme.io'] }, { max: 5 })).not.toContain('Following the account');
  });
});
