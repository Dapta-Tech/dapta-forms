import { describe, it, expect } from 'vitest';
import { groupSlotsByDay, isNavItemActive } from './booking';
import { slugifyHandle, validateHandle } from './handle';
import { t, en, es } from './i18n';
import { phoneValidator, parseGuests, guestsValidator } from './booking-fields';
import { validateDayRanges, copyRangesToDays, daysToBlocks, blocksToDays } from './availability';
import {
  clampAccent,
  accentWasAdjusted,
  matchTheme,
  widgetStyleVars,
  THEME_PRESETS,
  DEFAULT_ACCENT,
} from './branding';

describe('branding engine', () => {
  it('AA-clamps a too-dark accent lighter, leaves a safe one', () => {
    // Near-black gets nudged lighter (adjusted); the DS lime is already safe.
    expect(accentWasAdjusted('#000000')).toBe(true);
    expect(clampAccent('#000000')).not.toBe('#000000');
    expect(accentWasAdjusted(DEFAULT_ACCENT)).toBe(false);
    // Unparseable falls back to the DS accent.
    expect(clampAccent('nope')).toBe(DEFAULT_ACCENT);
  });

  it('widgetStyleVars maps corners/density to the exact radii/spacing', () => {
    const v = widgetStyleVars({ corners: 'round', density: 'compact', buttons: 'pill' });
    expect(v['--bp-radius']).toBe('28px');
    expect(v['--bp-btn-radius']).toBe('999px');
    expect(v['--bp-pad']).toBe('12px');
  });

  it('matchTheme derives the active theme from axes (not stored)', () => {
    expect(matchTheme(THEME_PRESETS.bold)).toBe('bold');
    expect(matchTheme({ ...THEME_PRESETS.bold, font: 'serif' })).toBeNull();
  });
});

describe('groupSlotsByDay', () => {
  it('buckets slots by the visitor day and labels local times', () => {
    const slots = [
      { startUtc: '2026-08-03T13:00:00.000Z' }, // 9:00 AM New_York
      { startUtc: '2026-08-03T13:30:00.000Z' },
      { startUtc: '2026-08-04T13:00:00.000Z' },
    ];
    const days = groupSlotsByDay(slots, 'America/New_York');
    expect(days).toHaveLength(2);
    expect(days[0]!.slots).toHaveLength(2);
    expect(days[0]!.slots[0]!.label).toMatch(/9:00/);
  });
});

describe('isNavItemActive (admin shell)', () => {
  it('exact-matches the /admin root, prefix-matches others', () => {
    expect(isNavItemActive('/admin', '/admin')).toBe(true);
    expect(isNavItemActive('/admin/bookings', '/admin')).toBe(false); // root must not light up everywhere
    expect(isNavItemActive('/admin/bookings', '/admin/bookings')).toBe(true);
    expect(isNavItemActive('/admin/bookings/new', '/admin/bookings')).toBe(true);
    expect(isNavItemActive('/admin/event-types', '/admin/bookings')).toBe(false);
  });
  it('honours extra matches', () => {
    const m = ['/admin/settings'];
    expect(isNavItemActive('/admin/settings/general', '/admin/settings', m)).toBe(true);
    expect(isNavItemActive('/admin/teams', '/admin/settings', m)).toBe(false);
  });
  it('Calendars is a top-level item owning /admin/connections (not Settings)', () => {
    expect(isNavItemActive('/admin/connections', '/admin/connections')).toBe(true);
    expect(isNavItemActive('/admin/connections', '/admin/settings', ['/admin/settings'])).toBe(false);
  });
});

describe('handle', () => {
  it('slugifies and validates', () => {
    expect(slugifyHandle('Álex Rivera!')).toBe('alex-rivera');
    expect(validateHandle('alex-rivera')).toBeNull();
    expect(validateHandle('ab')).toBe('HANDLE_ERR_SHORT');
    expect(validateHandle('api')).toBe('HANDLE_ERR_RESERVED');
  });
});

describe('t', () => {
  it('interpolates placeholders', () => {
    expect(t('{minutes} min', { minutes: 30 })).toBe('30 min');
  });
});

describe('booking-fields validators (H5)', () => {
  it('phoneValidator accepts intl formats, rejects junk, allows empty', () => {
    expect(phoneValidator('')).toBeNull();
    expect(phoneValidator('+1 (555) 123-4567')).toBeNull();
    expect(phoneValidator('abc')).not.toBeNull();
  });
  it('parseGuests dedupes + lowercases; guestsValidator flags bad emails', () => {
    expect(parseGuests('A@x.com, a@x.com\n b@y.io')).toEqual(['a@x.com', 'b@y.io']);
    expect(guestsValidator('a@x.com, b@y.io')).toBeNull();
    expect(guestsValidator('a@x.com, nope')).toMatch(/valid email/);
  });
});

describe('availability-editor util (H1)', () => {
  it('validateDayRanges flags bad times, inverted, and overlaps', () => {
    expect(validateDayRanges([{ start: '09:00', end: '17:00' }])).toBeNull();
    expect(validateDayRanges([{ start: '17:00', end: '09:00' }])).not.toBeNull();
    expect(
      validateDayRanges([
        { start: '09:00', end: '12:00' },
        { start: '11:00', end: '13:00' },
      ]),
    ).toMatch(/overlap/);
  });
  it('copyRangesToDays clones one day into others; blocks round-trip', () => {
    const copied = copyRangesToDays({ 1: [{ start: '09:00', end: '17:00' }] }, 1, [2, 3]);
    expect(copied[2]).toEqual([{ start: '09:00', end: '17:00' }]);
    const blocks = daysToBlocks(copied);
    expect(blocksToDays(blocks)[3]).toEqual([{ start: '09:00', end: '17:00' }]);
  });
});

describe('i18n parity', () => {
  const keys = (o: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object'
        ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`],
    );

  it('EN and ES have identical key sets (no missing translations)', () => {
    expect(keys(es as unknown as Record<string, unknown>).sort()).toEqual(
      keys(en as unknown as Record<string, unknown>).sort(),
    );
  });

  it('every message is a non-empty string in both locales', () => {
    for (const cat of [en, es]) {
      for (const k of keys(cat as unknown as Record<string, unknown>)) {
        const val = k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], cat);
        expect(typeof val === 'string' && val.length > 0).toBe(true);
      }
    }
  });
});
