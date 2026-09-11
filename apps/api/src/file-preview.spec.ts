/**
 * What may be rendered in place, and as what.
 *
 * This is a security boundary wearing a lookup table. Everything it says yes to
 * gets served from the bucket with `Content-Disposition: inline`, so the rules
 * that matter here are the refusals: a type no browser draws, a type that can
 * carry script, a file too large to open in a dialog, and above all a file
 * whose answer LIES about its type. The extension decides, because the
 * extension is the only claim the upload path actually verified.
 */
import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_BYTES, previewFor } from './file-preview';

const SMALL = 40_000;

describe('previewFor', () => {
  it('renders the image formats a browser draws, under their real type', () => {
    expect(previewFor('logo.png', SMALL)).toEqual({ kind: 'image', inlineContentType: 'image/png' });
    expect(previewFor('shot.gif', SMALL)).toEqual({ kind: 'image', inlineContentType: 'image/gif' });
    expect(previewFor('photo.webp', SMALL)).toEqual({
      kind: 'image',
      inlineContentType: 'image/webp',
    });
  });

  it('treats .jpeg and .jpg as the one format they are', () => {
    expect(previewFor('a.jpg', SMALL)).toEqual(previewFor('b.jpeg', SMALL));
    expect(previewFor('b.jpeg', SMALL).inlineContentType).toBe('image/jpeg');
  });

  it('reads an extension whatever its case', () => {
    expect(previewFor('SCAN.PDF', SMALL).kind).toBe('pdf');
    expect(previewFor('Resume.DocX', SMALL).kind).toBe('docx');
  });

  it('shows text as characters, never as a document the browser might parse', () => {
    for (const name of ['notes.txt', 'rows.csv', 'readme.md', 'data.json', 'feed.xml', 'ci.yml']) {
      expect(previewFor(name, SMALL)).toEqual({
        kind: 'text',
        inlineContentType: 'text/plain; charset=utf-8',
      });
    }
  });

  it('gives a .docx a preview but no inline type, because the dashboard renders it', () => {
    expect(previewFor('CV.docx', SMALL)).toEqual({ kind: 'docx', inlineContentType: null });
  });

  it('refuses every type that can carry script, even though upload refuses them first', () => {
    // These cannot reach a stored answer: DENIED_EXTENSIONS rejects them at
    // presign and again at verify. Their absence here is the second lock, so
    // that loosening the first one could not quietly make the bucket a page host.
    for (const name of ['x.svg', 'x.html', 'x.htm', 'x.xhtml', 'x.js', 'x.mjs']) {
      expect(previewFor(name, SMALL).kind).toBe('none');
      expect(previewFor(name, SMALL).inlineContentType).toBeNull();
    }
  });

  it('refuses the formats no browser can draw, so they fall through to a download', () => {
    for (const name of ['sheet.xlsx', 'old.doc', 'old.xls', 'deck.pptx', 'portfolio.zip', 'a.heic']) {
      expect(previewFor(name, SMALL).kind).toBe('none');
    }
  });

  it('refuses a file with no extension at all', () => {
    expect(previewFor('resume', SMALL).kind).toBe('none');
    expect(previewFor('my.resume.', SMALL).kind).toBe('none');
  });

  it('refuses a file too large to open in a dialog', () => {
    expect(previewFor('big.pdf', PREVIEW_MAX_BYTES).kind).toBe('pdf');
    expect(previewFor('big.pdf', PREVIEW_MAX_BYTES + 1).kind).toBe('none');
  });

  it('lets an unknown size through rather than blocking on a missing field', () => {
    // `parseFileAnswer` defaults a missing size to '0', so a zero here means the
    // answer never carried one. Refusing on that would break every older answer.
    expect(previewFor('scan.pdf', 0).kind).toBe('pdf');
    expect(previewFor('scan.pdf', Number.NaN).kind).toBe('pdf');
  });
});
