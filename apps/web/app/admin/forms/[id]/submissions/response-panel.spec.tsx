/**
 * The response panel as it renders: opened from `?response=`, closed otherwise,
 * and every answer printed in full in the shape its kind calls for.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The file and delete controls reach server actions; the panel test only needs them to render.
vi.mock('./actions', () => ({
  deleteSubmissionAction: vi.fn(),
  submissionFileUrlAction: vi.fn(),
}));

import { ResponsesViewer, type PanelLabels } from './response-panel';
import type { ResponseDetail } from './response-detail';

const labels: PanelLabels = {
  responseTitle: 'Response',
  prevResponse: 'Previous response',
  nextResponse: 'Next response',
  closeResponse: 'Close',
  responsePosition: '{n} of {total}',
  answersTitle: 'Answers',
  detailsTitle: 'Details',
  noAnswer: 'No answer',
  colStatus: 'Status',
  colSubmitted: 'Submitted',
  colStarted: 'Started',
  colScore: 'Score',
  responseId: 'Response ID',
  utmTitle: 'Campaign (UTM)',
  badgeCompleted: 'Completed',
  badgePartial: 'Partial',
  delete: 'Delete',
  deleteConfirm: 'Delete this submission?',
};

const fileLabels = {
  download: 'Download',
  downloadFailed: 'Could not download',
  loading: 'Loading',
  failed: 'Failed',
  reload: 'Reload',
  unavailable: 'Unavailable',
  approx: 'Approximate',
  close: 'Close',
};

const detail = (over: Partial<ResponseDetail> = {}): ResponseDetail => ({
  id: 'sub_1',
  completed: true,
  submittedAt: 'Sep 3, 2026, 9:05 AM',
  startedAt: 'Sep 3, 2026, 9:00 AM',
  score: 4,
  answers: [
    {
      key: 'story',
      label: 'Tell us about your LLC',
      kind: 'text',
      text: 'Line one.\nLine two.',
      long: true,
    },
    { key: 'role', label: 'Your role?', kind: 'choices', choices: ['Founder', 'Sales lead'] },
    {
      key: 'site',
      label: 'Website',
      kind: 'link',
      href: 'https://example.com',
      text: 'https://example.com',
    },
    { key: 'id_doc', label: 'Upload your ID', kind: 'file', name: 'passport.png' },
    { key: 'budget', label: 'Budget?', kind: 'empty' },
  ],
  utm: [['utm_source', 'qr']],
  ...over,
});

const render = (items: ResponseDetail[], initialId?: string) =>
  renderToStaticMarkup(
    <ResponsesViewer
      formId="form_1"
      items={items}
      initialId={initialId}
      labels={labels}
      fileLabels={fileLabels}
    >
      <table>
        <tbody>
          <tr data-response-id="sub_1">
            <td>row</td>
          </tr>
        </tbody>
      </table>
    </ResponsesViewer>,
  );

describe('ResponsesViewer', () => {
  it('renders only the table until a response is opened', () => {
    const html = render([detail()]);
    expect(html).toContain('data-response-id="sub_1"');
    expect(html).not.toContain('role="dialog"');
  });

  it('opens the response named by ?response= and shows where it sits in the page', () => {
    const html = render([detail({ id: 'sub_0' }), detail(), detail({ id: 'sub_2' })], 'sub_1');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="response-panel-title"');
    expect(html).toContain('2 of 3');
  });

  it('ignores a ?response= that is not on this page', () => {
    expect(render([detail()], 'sub_elsewhere')).not.toContain('role="dialog"');
  });

  it('disables Previous on the first response and Next on the last', () => {
    /** Whether the button with this test id carries the `disabled` attribute (not the CSS variant). */
    const disabled = (html: string, id: string) => {
      const tag = html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? '';
      return / disabled=""/.test(tag);
    };
    const first = render([detail(), detail({ id: 'sub_2' })], 'sub_1');
    expect(disabled(first, 'response-prev')).toBe(true);
    expect(disabled(first, 'response-next')).toBe(false);
    const last = render([detail({ id: 'sub_0' }), detail()], 'sub_1');
    expect(disabled(last, 'response-prev')).toBe(false);
    expect(disabled(last, 'response-next')).toBe(true);
  });

  it('prints every answer in full, in the shape its kind calls for', () => {
    const html = render([detail()], 'sub_1');
    expect(html).toContain('Tell us about your LLC');
    // The paragraph keeps its line break (pre-wrap), rather than being cut to one line.
    expect(html).toMatch(/whitespace-pre-wrap[^>]*>Line one\.\nLine two\.</);
    expect(html).toContain('>Founder<');
    expect(html).toContain('>Sales lead<');
    expect(html).toMatch(
      /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer"/,
    );
    expect(html).toContain('passport.png');
    expect(html).toContain('No answer');
  });

  it('lists the details, the score only when the form scores, and the UTM parameters', () => {
    const scored = render([detail()], 'sub_1');
    expect(scored).toContain('Sep 3, 2026, 9:00 AM');
    expect(scored).toContain('>Score<');
    expect(scored).toContain('>4<');
    expect(scored).toContain('utm_source');
    expect(scored).toContain('>qr<');
    expect(scored).toContain('sub_1');

    const plain = render([detail({ score: null, utm: [] })], 'sub_1');
    expect(plain).not.toContain('>Score<');
    expect(plain).not.toContain('Campaign (UTM)');
  });

  it('offers delete from the panel', () => {
    expect(render([detail()], 'sub_1')).toContain('>Delete<');
  });
});
