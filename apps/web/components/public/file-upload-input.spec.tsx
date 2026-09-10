/**
 * The `file` step's static render, through `StepInput` the way the renderers
 * reach it.
 *
 * Static markup only, which is the right depth here: the upload itself is an
 * XMLHttpRequest to a bucket, and a jsdom test of that would be a test of a
 * mock. What IS worth pinning is everything a visitor sees before any byte
 * moves, plus the one rule that is a real decision rather than styling: with no
 * upload route, the step renders nothing instead of a control that would fail
 * on the first click.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormStep } from '@quill/engine';
import { StepInput } from './step-input';

const step: FormStep = {
  key: 'cv',
  type: 'file',
  question: 'Upload your CV',
  required: true,
  allowedTypes: ['pdf', 'docx'],
};

function render(over: Partial<Parameters<typeof StepInput>[0]> = {}, s: FormStep = step) {
  return renderToStaticMarkup(
    <StepInput
      step={s}
      value={null}
      answers={{}}
      onChange={() => {}}
      onFieldChange={() => {}}
      onSelect={() => {}}
      dropdownPlaceholder="Pick one"
      dropdownEmpty="No matches"
      onRequestUpload={async () => ({ ok: false, message: 'no' })}
      uploadMaxMb={10}
      {...over}
    />,
  );
}

describe('file step', () => {
  it('renders nothing at all when the deployment has no upload route', () => {
    expect(render({ onRequestUpload: undefined })).toBe('');
  });

  it('offers the picker, with the accepted extensions on the native input', () => {
    const html = render();
    expect(html).toContain('data-testid="upload-choose"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".pdf,.docx"');
  });

  it('tells the visitor what is accepted and how big, before they pick', () => {
    const html = render();
    expect(html).toContain('PDF, DOCX');
    expect(html).toContain('10 MB');
  });

  it("caps the shown limit at the deployment ceiling, never the owner's larger number", () => {
    const html = render({}, { ...step, maxSizeMb: 500 });
    expect(html).toContain('10 MB');
    expect(html).not.toContain('500 MB');
  });

  it("uses the owner's own lower limit when they set one", () => {
    expect(render({}, { ...step, maxSizeMb: 2 })).toContain('2 MB');
  });

  it('shows the uploaded filename, not the object key, once an answer exists', () => {
    const html = render({
      value: {
        key: 'uploads/acct/form/sess/9f3c.pdf',
        name: 'Ada Lovelace CV.pdf',
        size: '40211',
        mime: 'application/pdf',
      } as never,
    });
    expect(html).toContain('Ada Lovelace CV.pdf');
    expect(html).not.toContain('9f3c');
    expect(html).not.toContain('uploads/');
    expect(html).toContain('data-testid="upload-done"');
  });

  it('honors the placeholder the author wrote', () => {
    expect(render({}, { ...step, placeholder: 'Attach your portfolio' })).toContain(
      'Attach your portfolio',
    );
  });

  it('renders Spanish copy for a Spanish form', () => {
    expect(render({ locale: 'es' })).toContain('Elige un archivo');
  });
});
