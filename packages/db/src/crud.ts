/**
 * Shared result shape for admin write paths — a typed success/failure union so
 * controllers can map a reason to an HTTP status without exceptions for the
 * common cases (not-found, slug clash, last-owner guard, …).
 */
export type CrudResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | 'NOT_FOUND'
        | 'SLUG_TAKEN'
        | 'SLUG_INVALID'
        | 'CONFLICT'
        | 'LAST_OWNER'
        | 'EMAIL_TAKEN'
        | 'NAME_TAKEN';
      message?: string;
    };
