import { describe, expect, it } from 'vitest';
import { PUBLIC_FORM_SEGMENT, formEditorPath, formLinks, publicFormPath } from './form-links';

describe('publicFormPath', () => {
  it('builds /{accountCode}/f/{slug}, a path that names the workspace and never a member', () => {
    expect(PUBLIC_FORM_SEGMENT).toBe('f');
    expect(publicFormPath('acme', 'lead-qualifier')).toBe('/acme/f/lead-qualifier');
  });

  it('encodes each segment, so a CRLF or a slash cannot leave its segment', () => {
    expect(publicFormPath('ac\r\nme', 'a/b')).toBe('/ac%0D%0Ame/f/a%2Fb');
  });
});

describe('formEditorPath', () => {
  it('points at the builder route of the admin', () => {
    expect(formEditorPath('f_123')).toBe('/admin/forms/f_123/edit');
  });

  it('encodes the id, so it cannot leave its segment', () => {
    expect(formEditorPath('a/b?c')).toBe('/admin/forms/a%2Fb%3Fc/edit');
  });
});

describe('formLinks', () => {
  const form = { id: 'f_123', slug: 'lead-qualifier' };

  it('joins the app URL with the public path and the editor path', () => {
    expect(formLinks('https://forms.example.com', 'acme', form)).toEqual({
      publicUrl: 'https://forms.example.com/acme/f/lead-qualifier',
      editorUrl: 'https://forms.example.com/admin/forms/f_123/edit',
    });
  });

  it('drops trailing slashes and surrounding whitespace on the app URL', () => {
    expect(formLinks(' https://forms.example.com// ', 'acme', form).publicUrl).toBe(
      'https://forms.example.com/acme/f/lead-qualifier',
    );
  });

  it('keeps a base path the deployment is mounted under', () => {
    expect(formLinks('https://example.com/forms/', 'acme', form).editorUrl).toBe(
      'https://example.com/forms/admin/forms/f_123/edit',
    );
  });

  it.each([undefined, null, '', '   '])('is null on both links without an app URL (%j)', (base) => {
    expect(formLinks(base, 'acme', form)).toEqual({ publicUrl: null, editorUrl: null });
  });

  it('has no public link when the workspace code is unknown, and still a way to the editor', () => {
    expect(formLinks('https://forms.example.com', null, form)).toEqual({
      publicUrl: null,
      editorUrl: 'https://forms.example.com/admin/forms/f_123/edit',
    });
  });
});
