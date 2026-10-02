/**
 * The inbox mock behind the preview's expand button, and the body helper that
 * draws the answers the way the HTML email does. Rendered with
 * react-dom/server: the web vitest env has no DOM.
 *
 * What it pins: the mock shows the subject and body with the sample values
 * filled in, the `{{answers}}` token becomes the two-column table the real
 * email carries (not "Label: value" lines), it renders nothing while closed,
 * and the expand button sits on both layouts of the shared fields.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mockBodyLines } from '@/lib/notification-preview';
import { NotificationEmailMock, type NotificationMockLabels } from './notification-email-mock';
import { NotificationEmailFields } from './notification-email-fields';

const MOCK: NotificationMockLabels = {
  title: 'How the email arrives',
  inbox: 'Inbox',
  toMe: 'to me',
  justNow: 'Just now',
  reply: 'Reply',
  forward: 'Forward',
  close: 'Close',
  note: 'A mock of an inbox.',
};

const noop = () => {};

function mock(open: boolean, subject = 'New submission: {{formName}}', body = 'From {{respondentEmail}}\n\n{{answers}}') {
  return renderToStaticMarkup(
    <NotificationEmailMock open={open} onClose={noop} subject={subject} body={body} labels={MOCK} />,
  );
}

describe('mockBodyLines', () => {
  const values = { formName: 'Lead Qualifier', respondentEmail: 'lead@acme.io' };

  it('fills tokens and keeps the lines apart', () => {
    expect(mockBodyLines('Hi {{formName}}\nBye', values)).toEqual([
      [{ kind: 'text', text: 'Hi Lead Qualifier' }],
      [{ kind: 'text', text: 'Bye' }],
    ]);
  });

  it('turns the answers token into a table segment, keeping the text around it', () => {
    expect(mockBodyLines('Answers:\n{{answers}}\nThanks {{ answers }} done', values)).toEqual([
      [{ kind: 'text', text: 'Answers:' }],
      [{ kind: 'answers' }],
      [
        { kind: 'text', text: 'Thanks ' },
        { kind: 'answers' },
        { kind: 'text', text: ' done' },
      ],
    ]);
  });

  it('leaves an unknown token literal so a typo shows', () => {
    expect(mockBodyLines('{{nope}}', values)).toEqual([[{ kind: 'text', text: '{{nope}}' }]]);
  });

  it('trims blank ends and collapses a run of blank lines to one', () => {
    expect(mockBodyLines('\n\nA\n\n\n\nB\n\n', values)).toEqual([
      [{ kind: 'text', text: 'A' }],
      [],
      [{ kind: 'text', text: 'B' }],
    ]);
  });
});

describe('NotificationEmailMock', () => {
  it('renders nothing while closed', () => {
    expect(mock(false)).toBe('');
  });

  it('shows the subject with the sample filled in, under the sender and the inbox label', () => {
    const html = mock(true);
    expect(html).toContain('data-testid="email-mock"');
    expect(html).toContain('New submission: Lead Qualifier');
    expect(html).toContain('Inbox');
    expect(html).toContain('to me');
    expect(html).toContain('Just now');
  });

  it('draws the answers as the email does, a table of label and value', () => {
    const html = mock(true);
    expect(html).toContain('data-testid="email-mock-answers"');
    expect(html).toContain('What best describes you?');
    expect(html).toContain('Founder / Owner');
    // The text body's "Label: value" shape is for the plain-text part only.
    expect(html).not.toContain('What best describes you?: ');
  });

  it('omits the table when the body does not use the answers token', () => {
    expect(mock(true, 'S', 'Just a note')).not.toContain('email-mock-answers');
  });

  it('draws Reply and Forward as shapes, not controls', () => {
    const html = mock(true);
    expect(html).toContain('Reply');
    expect(html).toContain('Forward');
    expect(html).not.toMatch(/<button[^>]*>\s*Reply/);
  });
});

describe('the expand button', () => {
  const labels = {
    enabledLabel: 'Send',
    enabledHint: 'Hint',
    subjectLabel: 'Subject',
    bodyLabel: 'Body',
    tokensLabel: 'Variables',
    tokensHint: 'Click.',
    previewLabel: 'Preview',
    previewSubject: 'Subject',
    previewExpand: 'Expand preview',
    previewMock: MOCK,
    tokenLabels: {},
  };

  for (const layout of ['stacked', 'split'] as const) {
    it(`is on the ${layout} layout, and the mock stays closed until it is pressed`, () => {
      const html = renderToStaticMarkup(
        <NotificationEmailFields
          value={{ enabled: true, subject: 'S', body: 'B' }}
          onChange={noop}
          tokens={[]}
          labels={labels}
          layout={layout}
          testIdPrefix="t"
        />,
      );
      expect(html).toContain('data-testid="t-preview-expand"');
      expect(html).toContain('aria-label="Expand preview"');
      expect(html).not.toContain('data-testid="email-mock"');
    });
  }
});
