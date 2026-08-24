/**
 * The options editor's stored-value disclosure, rendered for real.
 *
 * `packages/engine/src/option-value.spec.ts` proves WHEN a value may move; this
 * file proves the panel around it tells the truth: that the values are out of
 * the way until asked for, that one the author wrote themselves is never hidden
 * from them, and that a value the form can no longer move renders as read-only
 * rather than as an editable box that will refuse the edit.
 *
 * Rendered with `renderToStaticMarkup` because these components use hooks (the
 * web suite runs in plain node — see `vitest.config.ts`). That means the initial
 * render only, which is exactly the surface at issue: every one of these
 * decisions is a `useState` initialiser, and each was wrong once.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormOption } from '@quill/engine';
import { getMessages } from '@quill/shared';
import { OptionsEditor } from './options-editor';

const m = getMessages('en').admin.editor.options;

function render(options: FormOption[], locked: string[] = []) {
  return renderToStaticMarkup(
    <OptionsEditor
      options={options}
      onChange={() => {}}
      onLabelChange={() => {}}
      onValueChange={() => {}}
      locked={new Set(locked)}
      m={m}
    />,
  );
}

const derived: FormOption[] = [
  { label: 'Under 50', value: 'under_50' },
  { label: 'Over 50', value: 'over_50' },
];

describe('OptionsEditor — stored values', () => {
  it('keeps the values out of the row while they still track their labels', () => {
    const html = render(derived);

    expect(html, 'the labels are the row').toContain('value="Under 50"');
    expect(html, 'the values are not').not.toContain('value="under_50"');
    expect(html).toContain('options-advanced-toggle');
    expect(html).toContain('aria-expanded="false"');
  });

  it('opens itself when a value has stopped tracking its label', () => {
    // A value chosen to match something outside this form is the one an author
    // most needs to see, and the one a label edit will not move.
    const html = render([derived[0]!, { label: 'Over 50', value: 'ENTERPRISE_TIER' }]);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('value="ENTERPRISE_TIER"');
  });

  it('treats the created placeholder as still tracking, so a stuck form stays tidy', () => {
    // `option_2` is what creating an option puts there, not a choice anybody
    // made — opening the section for it would flag every untouched new form.
    const html = render([derived[0]!, { label: 'Over 50', value: 'option_2' }]);

    expect(html).toContain('aria-expanded="false"');
  });

  it('renders a value the form can no longer move as read-only, not as absent', () => {
    // Hiding it would leave the author hunting for a value that is still real
    // and still theirs; an editable box that refuses the edit is worse.
    const html = render(derived, ['over_50']);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('readonly');
    expect(html, 'and says why').toContain('options-value-locked');
  });

  it('says nothing about locked values when none of THIS question’s are', () => {
    // The hint is scoped to the step, so an unpublished form never reads a
    // warning about a rule that is not applying to it.
    const html = render(derived);

    expect(html).not.toContain('options-value-locked');
  });

  it('offers no disclosure at all before there are options', () => {
    expect(render([])).not.toContain('options-advanced-toggle');
  });
});
