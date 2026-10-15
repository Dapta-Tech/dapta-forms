import { describe, expect, it } from 'vitest';
import type { FormStep } from '@quill/engine';
import { allTokenKeys, recallTokenOptionsBefore, tokenOptionsBefore } from './token-textarea';

const steps: FormStep[] = [
  { key: 'name', type: 'name', question: 'What is your name?' },
  { key: 'email', type: 'email', question: 'Your email?' },
  { key: 'role', type: 'text', question: 'Your role?' },
];

describe('the @ picker offers [name] after a name step', () => {
  it('lists [name] with the subfields once the name step is behind', () => {
    expect(recallTokenOptionsBefore(steps, 2).map((o) => o.key)).toEqual([
      'name',
      'firstname',
      'lastname',
      'email',
    ]);
    // It carries the name question as its label, like its subfields.
    expect(recallTokenOptionsBefore(steps, 1)[0]).toMatchObject({
      key: 'name',
      label: 'What is your name?',
    });
  });

  it('does not offer it before the name step, nor on a form without one', () => {
    expect(recallTokenOptionsBefore(steps, 0)).toEqual([]);
    const noName = steps.filter((s) => s.type !== 'name');
    expect(recallTokenOptionsBefore(noName, noName.length).map((o) => o.key)).toEqual([
      'email',
      'role',
    ]);
    expect(allTokenKeys(noName).has('name')).toBe(false);
  });

  it('counts [name] as a known token, so typing it raises no warning', () => {
    expect(allTokenKeys(steps).has('name')).toBe(true);
  });

  it('a step keyed `name` that is not a name step stays one entry', () => {
    const textName: FormStep[] = [{ key: 'name', type: 'text', question: 'Company name?' }];
    expect(recallTokenOptionsBefore(textName, 1).map((o) => o.key)).toEqual(['name']);
  });

  it('leaves the answer-key list (the scheduler autofill) without [name]', () => {
    expect(tokenOptionsBefore(steps, 3).map((o) => o.key)).toEqual([
      'firstname',
      'lastname',
      'email',
      'role',
    ]);
  });
});
