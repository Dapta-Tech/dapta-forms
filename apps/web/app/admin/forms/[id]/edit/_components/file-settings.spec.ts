/**
 * Extension parsing for the file question's settings.
 *
 * This is the one piece of that panel with a decision in it. The author types
 * freely, and what they type becomes the list the public input filters on and
 * the server checks against, so ".PDF", "pdf" and "  pdf , pdf " all have to
 * arrive as the same single entry.
 */
import { describe, expect, it } from 'vitest';
import { parseExtensions } from './file-settings';

describe('parseExtensions', () => {
  it('lowercases and drops the leading dot', () => {
    expect(parseExtensions('.PDF, .Docx')).toEqual(['pdf', 'docx']);
  });

  it('accepts commas, spaces or both as separators', () => {
    expect(parseExtensions('pdf docx')).toEqual(['pdf', 'docx']);
    expect(parseExtensions('pdf,docx')).toEqual(['pdf', 'docx']);
    expect(parseExtensions('pdf,  docx,')).toEqual(['pdf', 'docx']);
  });

  it('de-duplicates, including across spellings', () => {
    expect(parseExtensions('pdf, .pdf, PDF')).toEqual(['pdf']);
  });

  it('is empty for empty input rather than producing a blank extension', () => {
    expect(parseExtensions('')).toEqual([]);
    expect(parseExtensions('  ,  ,')).toEqual([]);
    expect(parseExtensions('.')).toEqual([]);
  });
});
