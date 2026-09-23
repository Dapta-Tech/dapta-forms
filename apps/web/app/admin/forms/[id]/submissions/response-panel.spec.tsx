/**
 * The response panel as it renders: opened from `?response=`, closed otherwise,
 * and every answer printed in full in the shape its kind calls for.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The file and delete controls reach server actions; the panel test only needs them to render.
vi.mock('./actions', () => ({
  deleteSubmissionAction: vi.fn(),
  deleteSubmissionsAction: vi.fn(),
  submissionFileUrlAction: vi.fn(),
}));

// The delete controls refresh the page after deleting.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { ResponseDetailView, ResponsesViewer, type PanelLabels } from './response-panel';
import type { ResponseDetail } from './response-detail';

const labels: PanelLabels = {
  responseTitle: 'Anonymous response',
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
  answeredCount: '{n} of {total} answered',
  badgeCompleted: 'Completed',
  badgePartial: 'Partial',
  delete: 'Delete',
  deleteConfirm: 'Delete this submission?',
  sheetOpen: 'Full screen',
  sheetClose: 'Exit full screen',
  scoreValue: 'Score {score}',
};

const selectionLabels = {
  selectedCount: '{n} selected',
  selectedCountOne: '1 selected',
  exportSelected: 'Export CSV',
  delete: 'Delete',
  clearSelection: 'Clear',
  bulkDeleteTitle: 'Delete {n} responses?',
  bulkDeleteTitleOne: 'Delete 1 response?',
  bulkDeleteBody: 'This cannot be undone.',
  bulkDeleteFailed: 'Could not delete them.',
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
  respondent: { name: null, email: null, phone: null },
  ...over,
});

const render = (items: ResponseDetail[], initialId?: string, initialSheet = false) =>
  renderToStaticMarkup(
    <ResponsesViewer
      formId="form_1"
      title="Brief"
      items={items}
      initialId={initialId}
      initialSheet={initialSheet}
      labels={labels}
      fileLabels={fileLabels}
      selectionLabels={selectionLabels}
      pager={<p>page 1</p>}
    >
      <table>
        <tbody>
          <tr data-response-id="sub_1">
            <td data-answer-key="story">row</td>
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

  it('titles the panel with who answered, and says how much of the form they covered', () => {
    const named = render(
      [detail({ respondent: { name: 'Clara Restrepo', email: 'clara@example.com', phone: null } })],
      'sub_1',
    );
    expect(named).toMatch(/<h2 id="response-panel-title"[^>]*>Clara Restrepo</);
    expect(named).toContain('clara@example.com');
    expect(named).toMatch(/data-testid="response-avatar"[^>]*>CR</);
    // Four of the five fixture answers have a value; the fifth was never reached.
    expect(named).toContain('4 of 5 answered');

    // Only a phone: it becomes the title, and the avatar falls back to the icon.
    const phoneOnly = render(
      [detail({ respondent: { name: null, email: null, phone: '+573001234567' } })],
      'sub_1',
    );
    expect(phoneOnly).toMatch(/<h2 id="response-panel-title"[^>]*>\+573001234567</);
    expect(phoneOnly).toMatch(/data-testid="response-avatar"[^>]*><i[^>]*pi-user/);

    // No contact step at all: same header, anonymous title.
    const anonymous = render([detail()], 'sub_1');
    expect(anonymous).toMatch(/<h2 id="response-panel-title"[^>]*>Anonymous response</);
  });

  it('shows the table in place with a way to full screen, and the pager under it', () => {
    const html = render([detail()]);
    expect(html).not.toContain('data-sheet');
    expect(html).toMatch(/data-testid="sheet-open"[^>]*>.*Full screen/);
    expect(html).toContain('page 1');
  });

  it('opens as the full-screen sheet from ?view=sheet, titled with the form and with a way out', () => {
    const html = render([detail()], undefined, true);
    expect(html).toMatch(/data-sheet=""[^>]*class="fixed inset-0/);
    expect(html).toContain('>Brief<');
    const exit = html.match(/<button[^>]*data-testid="sheet-close"[^>]*>/)?.[0] ?? '';
    expect(exit).toContain('aria-label="Exit full screen"');
    expect(html).not.toContain('data-testid="sheet-open"');
    // The table and the pager ride along into the sheet.
    expect(html).toContain('data-answer-key="story"');
    expect(html).toContain('page 1');
  });

  it('opens the panel over the sheet', () => {
    const html = render([detail()], 'sub_1', true);
    expect(html).toContain('data-sheet=""');
    expect(html).toContain('role="dialog"');
  });

  it('offers delete from the panel', () => {
    expect(render([detail()], 'sub_1')).toContain('>Delete<');
  });
});

describe('ResponseDetailView', () => {
  const view = (focusKey?: string | null) =>
    renderToStaticMarkup(
      <ResponseDetailView
        detail={detail()}
        formId="form_1"
        labels={labels}
        fileLabels={fileLabels}
        focusKey={focusKey}
      />,
    );

  it('marks each answer with its question, so a table cell can land on it', () => {
    const html = view();
    for (const key of ['story', 'role', 'site', 'id_doc', 'budget'])
      expect(html).toContain(`data-answer-key="${key}"`);
    expect(html).not.toContain('data-focused');
  });

  it('outlines only the question opened from a cell, answered or not', () => {
    const focused = (html: string) =>
      [...html.matchAll(/<li[^>]*data-answer-key="([^"]+)"[^>]*data-focused=""/g)].map((m) => m[1]);
    expect(focused(view('role'))).toEqual(['role']);
    expect(focused(view('budget'))).toEqual(['budget']);
    expect(view('role')).toMatch(/<li class="[^"]*ring-2[^"]*"[^>]*data-answer-key="role"/);
  });
});
