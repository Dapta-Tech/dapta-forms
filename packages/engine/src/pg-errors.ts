/**
 * Postgres SQLSTATE helpers — recognise the DB constraint violations the engine
 * maps to HTTP outcomes. TypeORM wraps the driver error, so the code can sit on
 * the error itself or on `.driverError`.
 *
 * The critical one: `23P01` exclusion_violation, raised by the
 * DB-level constraints (unique indexes, EXCLUDE) — the last line of defense
 * for integrity guarantees, mapped to 409 conflicts at the API.
 */

/** SQLSTATE codes we care about. */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_UNIQUE_VIOLATION = '23505';

/** Extract the SQLSTATE code from a (possibly TypeORM-wrapped) error. */
export function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; driverError?: { code?: unknown } };
  if (typeof e.code === 'string') return e.code;
  if (e.driverError && typeof e.driverError.code === 'string') return e.driverError.code;
  return undefined;
}

/** True when the error is an EXCLUDE (exclusion-constraint) violation. */
export function isExclusionViolation(err: unknown): boolean {
  return pgErrorCode(err) === PG_EXCLUSION_VIOLATION;
}

/** True for a unique-constraint violation (e.g. duplicate idempotency_key/uid). */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === PG_UNIQUE_VIOLATION;
}
