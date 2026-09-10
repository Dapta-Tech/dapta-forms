/**
 * The preview dialog's body, which is where every rule about it lives.
 *
 * Static markup only: the web app's vitest runs in plain node with no DOM, so
 * the fetch-and-convert half cannot be exercised here and a test of it would be
 * a test of a mock. What IS worth pinning is what each kind renders, that a
 * Word document is confined to a sandboxed frame, and that a failure never
 * leaves a broken image where a way out should be.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';
import type { SubmissionFile } from '@quill/types';
import { FilePreviewView, readableSize, type DocxState } from './file-preview-modal';

const m = getMessages('en').admin.submissions;

const LABELS = {
  loading: m.previewLoading,
  failed: m.previewFailed,
  reload: m.previewReload,
  unavailable: m.previewUnavailable,
  approx: m.previewApprox,
  close: m.previewClose,
  download: m.download,
};

const PDF: SubmissionFile = {
  name: 'Ada Lovelace CV.pdf',
  size: '40211',
  kind: 'pdf',
  url: 'https://bucket.example/uploads/a/f/s/9f3c.pdf?sig=dl',
  previewUrl: 'https://bucket.example/uploads/a/f/s/9f3c.pdf?sig=view',
};

function render(
  over: Partial<SubmissionFile> = {},
  opts: { docx?: DocxState; broken?: boolean; labels?: typeof LABELS } = {},
): string {
  return renderToStaticMarkup(
    <FilePreviewView
      file={{ ...PDF, ...over }}
      docx={opts.docx ?? { kind: 'loading' }}
      broken={opts.broken ?? false}
      busy={false}
      labels={opts.labels ?? LABELS}
      onBroken={() => {}}
      onReload={() => {}}
      onDownload={() => {}}
      onClose={() => {}}
    />,
  );
}

describe('FilePreviewView', () => {
  it('frames a PDF at the URL the API signed for viewing, not the download one', () => {
    const html = render();
    expect(html).toContain('data-testid="preview-pdf"');
    expect(html).toContain('sig=view');
    expect(html).not.toContain('sig=dl');
  });

  it('draws an image as an image, labelled with the respondent’s own filename', () => {
    const html = render({ kind: 'image', name: 'logo.png', previewUrl: 'https://b.example/1.png' });
    expect(html).toContain('data-testid="preview-image"');
    expect(html).toContain('alt="logo.png"');
  });

  it('frames text, which the signed URL delivers as plain characters', () => {
    expect(render({ kind: 'text', name: 'rows.csv' })).toContain('data-testid="preview-text"');
  });

  it('confines a Word document to a frame that can run nothing', () => {
    const html = render(
      { kind: 'docx', name: 'CV.docx' },
      { docx: { kind: 'ready', html: '<!doctype html><html><body><p>Hi</p></body></html>' } },
    );
    expect(html).toContain('data-testid="preview-docx"');
    // The empty sandbox is the whole security story for this branch: no
    // allow-scripts means nothing runs, no allow-same-origin means it could not
    // reach this origin if it did.
    expect(html).toContain('sandbox=""');
    // Lowercased before matching: React serializes the prop under its own name
    // and HTML parses attribute names case-insensitively, so the assertion
    // should not break on a React version that spells it the other way.
    expect(html.toLowerCase()).toContain('srcdoc=');
    // Rendered from a document, never pointed at the file's own URL.
    expect(html).not.toContain('src="https://bucket.example');
  });

  it('says a Word conversion is approximate, and says it only once it is showing', () => {
    const docx: DocxState = { kind: 'ready', html: '<html></html>' };
    expect(render({ kind: 'docx' }, { docx })).toContain(m.previewApprox);
    expect(render({ kind: 'docx' }, { docx: { kind: 'loading' } })).not.toContain(m.previewApprox);
    expect(render()).not.toContain(m.previewApprox);
  });

  it('waits out the Word conversion with a message rather than an empty box', () => {
    expect(render({ kind: 'docx' }, { docx: { kind: 'loading' } })).toContain(
      'data-testid="preview-loading"',
    );
  });

  it('offers a way out when the Word conversion fails', () => {
    const html = render({ kind: 'docx' }, { docx: { kind: 'failed' } });
    expect(html).toContain('data-testid="preview-failed"');
    expect(html).toContain(m.previewReload);
  });

  it('replaces a broken preview with a retry instead of leaving a dead frame', () => {
    // The signature expired while the dialog sat open. Retrying the same URL
    // would fail again, so the way out has to be a re-mint.
    const html = render({}, { broken: true });
    expect(html).toContain('data-testid="preview-failed"');
    expect(html).not.toContain('data-testid="preview-pdf"');
  });

  it('says so plainly for a kind with no viewer', () => {
    const html = render({ kind: 'none', previewUrl: null });
    expect(html).toContain('data-testid="preview-none"');
    expect(html).toContain(m.previewUnavailable);
  });

  it('always offers the download, whatever the preview is doing', () => {
    for (const html of [render(), render({}, { broken: true }), render({ kind: 'none', previewUrl: null })]) {
      expect(html).toContain('data-testid="preview-download"');
    }
  });

  it('renders Spanish copy for a Spanish dashboard', () => {
    const es = getMessages('es').admin.submissions;
    const labels = { ...LABELS, unavailable: es.previewUnavailable, download: es.download };
    const html = render({ kind: 'none', previewUrl: null }, { labels });
    expect(html).toContain('Descargar');
    expect(html).toContain(es.previewUnavailable);
  });
});

describe('readableSize', () => {
  it('scales the unit to the number', () => {
    expect(readableSize('512')).toBe('512 B');
    expect(readableSize('40211')).toBe('40 KB');
    expect(readableSize('4200000')).toBe('4.2 MB');
  });

  it('says nothing rather than "0 B" when the answer carried no size', () => {
    // `parseFileAnswer` defaults a missing size to '0', so a zero here means
    // unknown, and an empty string is the honest way to show that.
    expect(readableSize('0')).toBe('');
    expect(readableSize('')).toBe('');
    expect(readableSize('not-a-number')).toBe('');
  });
});
