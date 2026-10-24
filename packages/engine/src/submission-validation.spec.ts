import { describe, it, expect } from 'vitest';
import { answeredPath, validateSubmission, type FormConfig } from './form-logic';

/** A scored quiz shaped like the QA form: choices, skip logic, a name, an email. */
const quiz: FormConfig = {
  version: 1,
  steps: [
    {
      key: 'team',
      type: 'multiple_choice',
      required: true,
      options: [
        { label: 'Solo', value: 'solo', points: 1 },
        { label: 'Team', value: 'team', points: 5 },
      ],
    },
    // Only for teams.
    {
      key: 'size',
      type: 'dropdown',
      required: true,
      showWhen: { field: 'team', values: ['team'] },
      options: [
        { label: '2-10', value: 'small' },
        { label: '11+', value: 'large' },
      ],
    },
    { key: 'intro', type: 'message', question: 'Almost done' },
    { key: 'utm_seed', type: 'text', hidden: true, required: true },
    { key: 'full', type: 'name', required: true },
    { key: 'email', type: 'email', required: true },
    { key: 'notes', type: 'textarea' },
  ],
};

const solo = { team: 'solo', firstname: 'Ana', lastname: 'Paz', email: 'ana@acme.com' };

describe('validateSubmission', () => {
  it('accepts a complete response on the path it took', () => {
    expect(validateSubmission(quiz, solo)).toEqual({ ok: true });
    expect(validateSubmission(quiz, { ...solo, team: 'team', size: 'large' })).toEqual({ ok: true });
  });

  it('refuses a value that is not an option of a choice step', () => {
    expect(validateSubmission(quiz, { ...solo, team: 'nope' })).toEqual({
      ok: false,
      key: 'team',
      code: 'option',
    });
  });

  it('refuses a required step on the path left empty', () => {
    expect(validateSubmission(quiz, { team: 'nope' })).toMatchObject({ ok: false, key: 'team' });
    expect(validateSubmission(quiz, { team: 'team', ...{ firstname: 'A', lastname: 'B', email: 'a@b.co' } })).toEqual(
      { ok: false, key: 'size', code: 'required' },
    );
    expect(validateSubmission(quiz, { team: 'solo', email: 'ana@acme.com' })).toEqual({
      ok: false,
      key: 'firstname',
      code: 'required',
      nameFields: ['firstname', 'lastname'],
    });
  });

  it('refuses a required text answer of only spaces on submit', () => {
    const config: FormConfig = { version: 1, steps: [{ key: 'company', type: 'text', required: true }] };
    expect(validateSubmission(config, { company: '   ' })).toEqual({ ok: false, key: 'company', code: 'required' });
    expect(validateSubmission(config, { company: 'Acme' })).toEqual({ ok: true });
  });

  it('names the missing sub-field of a name step, even when the name was sent under its own key', () => {
    expect(validateSubmission(quiz, { team: 'solo', full: 'Ana Paz', firstname: 'Ana', email: 'ana@acme.com' })).toEqual({
      ok: false,
      key: 'lastname',
      code: 'required',
      nameFields: ['firstname', 'lastname'],
    });
  });

  it('checks the format of what is on the path', () => {
    expect(validateSubmission(quiz, { ...solo, email: 'not-an-email' })).toEqual({
      ok: false,
      key: 'email',
      code: 'email',
    });
  });

  it('never reads a step logic skipped, a hidden step or an extra key', () => {
    // `size` is off the path for a solo answer: a stale or prefilled value
    // there is not this check's business.
    expect(validateSubmission(quiz, { ...solo, size: 'whatever', utm_source: 'x', '@invitee_name': 'A' })).toEqual({
      ok: true,
    });
  });

  it('stops at the first terminal step', () => {
    const config: FormConfig = {
      version: 1,
      steps: [
        { key: 'fit', type: 'multiple_choice', required: true, terminal: true, options: [{ label: 'No', value: 'no' }] },
        { key: 'email', type: 'email', required: true },
      ],
    };
    expect(answeredPath(config, { fit: 'no' }).map((s) => s.key)).toEqual(['fit']);
    expect(validateSubmission(config, { fit: 'no' })).toEqual({ ok: true });
  });

  it('follows a goto that ends the form', () => {
    const config: FormConfig = {
      version: 1,
      steps: [
        {
          key: 'q',
          type: 'multiple_choice',
          required: true,
          options: [
            { label: 'Out', value: 'out' },
            { label: 'In', value: 'in' },
          ],
          goto: [{ values: ['out'], target: null }],
        },
        { key: 'email', type: 'email', required: true },
      ],
    };
    expect(validateSubmission(config, { q: 'out' })).toEqual({ ok: true });
    expect(validateSubmission(config, { q: 'in' })).toEqual({ ok: false, key: 'email', code: 'required' });
  });

  it('accepts a booked scheduler, a file answer and a multi-select', () => {
    const config: FormConfig = {
      version: 1,
      steps: [
        {
          key: 'tools',
          type: 'multiple_choice',
          selectionMode: 'multiple',
          required: true,
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        },
        { key: 'cv', type: 'file', required: true },
        { key: 'call', type: 'scheduler', required: true },
        { key: 'wait', type: 'reveal' },
      ],
    };
    const answers = {
      tools: ['a', 'b'],
      cv: { key: 'uploads/x/cv.pdf', name: 'cv.pdf', size: '10', mime: 'application/pdf' },
      call: '2026-10-21T15:00:00Z',
    };
    expect(validateSubmission(config, answers)).toEqual({ ok: true });
    expect(validateSubmission(config, { ...answers, tools: ['a', 'zzz'] })).toMatchObject({ key: 'tools' });
    expect(validateSubmission(config, { ...answers, call: '' })).toEqual({
      ok: false,
      key: 'call',
      code: 'required',
    });
  });

  it('leaves an all-optional form alone when nothing was answered', () => {
    const config: FormConfig = { version: 1, steps: [{ key: 'q', type: 'text' }] };
    expect(validateSubmission(config, {})).toEqual({ ok: true });
  });
});
