/**
 * `displayName` is whatever the identity provider handed us, and that is not
 * always a person's name. Two paths in this repo put an address in it:
 *
 *   - local JIT signup stores the FULL address (`auth.provider.ts` — `display_name
 *     = ${email}`), so the dashboard greeted people as "you@example.com";
 *   - member invites store the LOCAL PART (`members.ts` — `EMAIL_LOCAL(email)`),
 *     and the WorkOS adapter only fills `display_name` when it is null, so the
 *     IdP's real name never replaces it. That one greets people as
 *     "josue.hernandez04" forever.
 *
 * Anything that renders `displayName` AS a name has to go through here.
 */

/** `local@domain.tld`, loosely: one `@`, no spaces, a dot in the domain. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a string is an email address rather than a name. */
export function isEmailAddress(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return !!trimmed && LOOKS_LIKE_EMAIL.test(trimmed);
}

/**
 * The person's full name, or null when what we hold is an address in disguise.
 *
 * Pass `email` when the caller has it: it is the only way to catch the invite
 * path, where `displayName` is the local part and looks like an ordinary — if
 * unlovely — string. Without it, only full addresses are caught, which is the
 * right floor for surfaces that must never PUBLISH an address (the public
 * profile page) but cannot see one.
 */
export function personName(
  displayName: string | null | undefined,
  email?: string | null,
): string | null {
  const trimmed = displayName?.trim();
  if (!trimmed || LOOKS_LIKE_EMAIL.test(trimmed)) return null;
  const addr = email?.trim().toLowerCase();
  if (addr && (trimmed.toLowerCase() === addr || trimmed.toLowerCase() === addr.split('@')[0])) {
    return null;
  }
  return trimmed;
}

/**
 * The first name to greet someone by, or null when we do not have one.
 *
 * Null is a real answer here, not a failure. The local part is not a rescue
 * either: `you`, `josue.hernandez04`, `info` are not names, and greeting someone
 * as "you" is worse than not greeting them — so the caller falls back to the
 * un-named greeting, which is a complete sentence on its own.
 */
export function greetingName(
  displayName: string | null | undefined,
  email?: string | null,
): string | null {
  const full = personName(displayName, email);
  if (!full) return null;
  // Split on any whitespace, not just ' ': names arrive with non-breaking spaces
  // from copy-paste often enough that `split(' ')` returns the whole string.
  return full.split(/\s+/)[0] || null;
}
