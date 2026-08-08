import { describe, expect, it } from 'vitest';
import { greetingName, isEmailAddress, personName } from './person';

describe('isEmailAddress', () => {
  it('recognises an address and nothing else', () => {
    expect(isEmailAddress('you@example.com')).toBe(true);
    expect(isEmailAddress('Josue Hernandez')).toBe(false);
    expect(isEmailAddress('Jean-Luc')).toBe(false);
    expect(isEmailAddress(null)).toBe(false);
  });
});

describe('personName', () => {
  it('keeps a real name whole', () => {
    expect(personName('Josue Hernandez')).toBe('Josue Hernandez');
    expect(personName('  Grace   Hopper ')).toBe('Grace   Hopper');
  });

  it('rejects a full address even with no email to compare against', () => {
    // The local-signup path: `display_name = ${email}`. This is the floor for the
    // public profile page, which must never publish an address but cannot see one.
    expect(personName('you@example.com')).toBeNull();
  });

  it('rejects the local part when the email is supplied', () => {
    // The invite path: `EMAIL_LOCAL(email)`. Indistinguishable from a name without
    // the address, which is why callers that have it must pass it.
    expect(personName('josue.hernandez04', 'josue.hernandez04@gmail.com')).toBeNull();
    expect(personName('You', 'you@example.com')).toBeNull();
    expect(personName('you@example.com', 'you@example.com')).toBeNull();
  });

  it('keeps a real name that merely shares a prefix with nothing', () => {
    expect(personName('Josue', 'different.person@gmail.com')).toBe('Josue');
  });

  it('returns null when there is no name at all', () => {
    expect(personName(null)).toBeNull();
    expect(personName(undefined)).toBeNull();
    expect(personName('   ')).toBeNull();
  });
});

describe('greetingName', () => {
  it('takes the first name from a real name', () => {
    expect(greetingName('Josue Hernandez')).toBe('Josue');
    expect(greetingName('Ada')).toBe('Ada');
  });

  it('splits on any whitespace, not just a plain space', () => {
    expect(greetingName('  Grace   Hopper ')).toBe('Grace');
  });

  it('inherits every rejection from personName', () => {
    expect(greetingName('you@example.com')).toBeNull();
    expect(greetingName('josue.hernandez04', 'josue.hernandez04@gmail.com')).toBeNull();
    expect(greetingName(null)).toBeNull();
  });

  it('keeps a name that merely contains an @ or a dot', () => {
    // Not an address — no domain — so it is still the best name we have.
    expect(greetingName('Jean-Luc')).toBe('Jean-Luc');
    expect(greetingName('J. Random Hacker')).toBe('J.');
  });
});
