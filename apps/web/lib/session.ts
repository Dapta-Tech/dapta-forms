/** OSS local-auth session cookie name (the FE gate for the dashboard). */
export const SESSION_COOKIE = 'quill_session';

/**
 * The workspace the person chose to act in.
 *
 * Deliberately its OWN cookie rather than a field inside the session, because
 * the two have different lifetimes and different requirements. A session cookie
 * may not exist at all — the OSS `local` provider resolves a developer with no
 * cookie whatsoever — and folding the choice into it meant the switcher
 * silently did nothing for exactly those users.
 *
 * It is a preference, not a credential: it names an account and grants nothing.
 * The API re-derives membership from the database on every request and answers
 * 403 when the caller has no row in that account, so the worst a forged value
 * can do is bounce you home.
 */
export const WORKSPACE_COOKIE = 'quill_workspace';
