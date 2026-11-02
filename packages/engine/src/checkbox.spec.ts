import { describe, it, expect } from 'vitest';
import {
  FORM_FIELD_TYPES,
  canonicalizeAnswer,
  inlineLinksPlainText,
  isCheckboxChecked,
  parseInlineLinks,
  resolveStepDisplay,
  validateAnswer,
  validateAnswerCode,
  visibleSteps,
  canShareScreen,
  type FormConfig,
  type FormStep,
} from './form-logic';
import { createEmptyStep } from './form-config';

const box = (over: Partial<FormStep> = {}): FormStep => ({
  key: 'consent',
  type: 'checkbox',
  question: 'Acepto la [política](https://a.co)',
  required: true,
  ...over,
});

describe('checkbox: the type', () => {
  it('is the last of FORM_FIELD_TYPES', () => {
    expect(FORM_FIELD_TYPES[FORM_FIELD_TYPES.length - 1]).toBe('checkbox');
  });

  it('createEmptyStep gives an empty, required, qualification step and nothing else', () => {
    const s = createEmptyStep('checkbox');
    expect(s).toEqual({ key: s.key, type: 'checkbox', question: '', required: true, flowGroup: 'qualification' });
  });
});

describe('checkbox: validateAnswerCode', () => {
  it('required: checked passes, empty is `consent`, anything else is `option`', () => {
    const s = box();
    expect(validateAnswerCode(s, true)).toEqual({ ok: true });
    expect(validateAnswerCode(s, 'true')).toEqual({ ok: true });
    for (const v of [undefined, null, '', false])
      expect(validateAnswerCode(s, v)).toEqual({ ok: false, code: 'consent' });
    expect(validateAnswerCode(s, 'yes')).toEqual({ ok: false, code: 'option' });
  });

  it('optional: unchecked passes', () => {
    const s = box({ required: false });
    expect(validateAnswerCode(s, undefined)).toEqual({ ok: true });
    expect(validateAnswerCode(s, false)).toEqual({ ok: true });
    expect(validateAnswerCode(s, 'yes')).toEqual({ ok: false, code: 'option' });
  });
});

describe('checkbox: validateAnswer (server copy)', () => {
  it('required', () => {
    const s = box();
    expect(validateAnswer(s, true)).toEqual({ ok: true });
    expect(validateAnswer(s, 'true')).toEqual({ ok: true });
    for (const v of [undefined, null, '', false])
      expect(validateAnswer(s, v)).toEqual({ ok: false, error: 'Check the box to continue.' });
    expect(validateAnswer(s, 'yes')).toEqual({ ok: false, error: 'Choose one of the available options.' });
  });

  it('optional', () => {
    const s = box({ required: false });
    expect(validateAnswer(s, undefined)).toEqual({ ok: true });
    expect(validateAnswer(s, false)).toEqual({ ok: true });
  });
});

describe('checkbox: canonicalizeAnswer', () => {
  it("turns 'true' into true only on a checkbox", () => {
    expect(canonicalizeAnswer(box(), 'true')).toBe(true);
    expect(canonicalizeAnswer(box(), true)).toBe(true);
    expect(canonicalizeAnswer({ key: 't', type: 'text' }, 'true')).toBe('true');
  });
});

describe('checkbox: runtime ignores hidden', () => {
  it('visibleSteps keeps a checkbox that carries hidden: true', () => {
    const config: FormConfig = {
      version: 1,
      steps: [
        { key: 'email', type: 'email', question: 'Email', hidden: true },
        box({ hidden: true }),
      ],
    };
    expect(visibleSteps(config, {}).map((s) => s.key)).toEqual(['consent']);
  });

  it('a hidden checkbox can still share a screen', () => {
    expect(canShareScreen(box({ hidden: true }))).toBe(true);
    expect(canShareScreen({ key: 't', type: 'text', hidden: true })).toBe(false);
  });
});

describe('checkbox: resolveStepDisplay', () => {
  it('keeps the question as written, links and tokens alike', () => {
    const answers = { email: 'a@b.co', datos: 'x' };
    expect(resolveStepDisplay(box({ question: 'Acepto los [datos](https://a.co)' }), answers).question).toBe(
      'Acepto los [datos](https://a.co)',
    );
    expect(resolveStepDisplay(box({ question: 'Enviar a [email]' }), answers).question).toBe('Enviar a [email]');
  });

  it('still interpolates the helper', () => {
    expect(resolveStepDisplay(box({ helper: 'Para [email]' }), { email: 'a@b.co' }).helper).toBe('Para a@b.co');
  });

  it('a text step still interpolates', () => {
    expect(resolveStepDisplay({ key: 't', type: 'text', question: 'Hola [email]' }, { email: 'a@b.co' }).question).toBe(
      'Hola a@b.co',
    );
  });
});

describe('parseInlineLinks', () => {
  it('plain text', () => {
    expect(parseInlineLinks('Acepto todo')).toEqual([{ kind: 'text', text: 'Acepto todo' }]);
  });

  it('one link', () => {
    expect(parseInlineLinks('Acepto la [política](https://a.co).')).toEqual([
      { kind: 'text', text: 'Acepto la ' },
      { kind: 'link', text: 'política', href: 'https://a.co' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('two links', () => {
    expect(parseInlineLinks('[a](https://a.co) y [b](http://b.co)')).toEqual([
      { kind: 'link', text: 'a', href: 'https://a.co' },
      { kind: 'text', text: ' y ' },
      { kind: 'link', text: 'b', href: 'http://b.co' },
    ]);
  });

  it('a javascript: link stays literal text', () => {
    expect(parseInlineLinks('Ver [esto](javascript:alert(1)) ya')).toEqual([
      { kind: 'text', text: 'Ver [esto](javascript:alert(1)) ya' },
    ]);
    expect(parseInlineLinks('[m](mailto:a@b.co)')).toEqual([{ kind: 'text', text: '[m](mailto:a@b.co)' }]);
  });

  it('an unclosed bracket stays text', () => {
    expect(parseInlineLinks('Acepto [la política(https://a.co)')).toEqual([
      { kind: 'text', text: 'Acepto [la política(https://a.co)' },
    ]);
  });

  it('empty string', () => {
    expect(parseInlineLinks('')).toEqual([]);
  });
});

describe('inlineLinksPlainText / isCheckboxChecked', () => {
  it('replaces each link with its text', () => {
    expect(inlineLinksPlainText('Acepto la [política](https://a.co) y los [términos](https://b.co)')).toBe(
      'Acepto la política y los términos',
    );
  });

  it('checked is true or the string true', () => {
    expect(isCheckboxChecked(true)).toBe(true);
    expect(isCheckboxChecked('true')).toBe(true);
    expect(isCheckboxChecked(false)).toBe(false);
    expect(isCheckboxChecked(undefined)).toBe(false);
    expect(isCheckboxChecked('yes')).toBe(false);
  });
});
