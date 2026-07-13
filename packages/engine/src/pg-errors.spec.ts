import {
  isExclusionViolation,
  isUniqueViolation,
  PG_EXCLUSION_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from './pg-errors';

describe('pg-errors', () => {
  it('reads the code off a direct driver error', () => {
    expect(pgErrorCode({ code: PG_EXCLUSION_VIOLATION })).toBe('23P01');
  });

  it('reads the code off a TypeORM-wrapped error (.driverError)', () => {
    expect(pgErrorCode({ driverError: { code: PG_UNIQUE_VIOLATION } })).toBe('23505');
  });

  it('returns undefined for non-error / codeless inputs', () => {
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode('boom')).toBeUndefined();
    expect(pgErrorCode({})).toBeUndefined();
  });

  it('classifies the anti-double-booking EXCLUDE violation → 409 path', () => {
    const err = { code: '23P01', constraint: 'booking_no_overlap' };
    expect(isExclusionViolation(err)).toBe(true);
    expect(isExclusionViolation({ driverError: { code: '23P01' } })).toBe(true);
    expect(isExclusionViolation({ code: '23505' })).toBe(false);
  });

  it('classifies unique violations (idempotency_key / uid)', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23P01' })).toBe(false);
  });
});
