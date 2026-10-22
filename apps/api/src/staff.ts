/**
 * Who the deployment's STAFF are: people whose email is on one of the
 * domains `IAM_STAFF_DOMAINS` lists. Staff may search every workspace and
 * enter any of them as an admin, through an access grant
 * (`member.access_grant = 'staff'`).
 *
 * The one rule every surface applies: the web app's workspace switcher (the
 * email the identity service's token carries) and MCP connections (the email
 * the person directory holds for the person). A pure function, so the rule
 * cannot drift between them.
 */

/**
 * Why staff access refuses a workspace where the person holds a membership
 * that is not active (`StaffGrantRefused`): the web app's switcher and the
 * MCP door say the same.
 */
export const MEMBERSHIP_NOT_ACTIVE_MESSAGE =
  'You have a membership in this workspace that is not active: its owner disabled or removed it, or it is still an invitation. Staff access never replaces a membership.';

/**
 * The identity service's workspace id behind a local account's
 * `external_id`, or null for an account the identity service does not own
 * (none, or a local-only `local:`/`dev:`/`legacy:` id). Only such a
 * workspace can be granted into, or written upstream.
 */
export function upstreamWorkspaceIdOf(externalId: string | null | undefined): string | null {
  if (!externalId || externalId.startsWith('local:') || externalId.startsWith('dev:') || externalId.startsWith('legacy:')) return null;
  return externalId;
}

/**
 * One local part, one `@`, one domain, no whitespace or control character
 * anywhere. Anything else (`evil@x.com@example.com`, `@example.com`, a line
 * break) is not an address this rule judges, so it is never staff.
 */
// eslint-disable-next-line no-control-regex
const EMAIL_SHAPE = /^[^@\s\x00-\x1f\x7f]+@([^@\s\x00-\x1f\x7f]+)$/;

/**
 * True when `email` (trimmed) is a single `local@domain` and its domain,
 * lowercased, is exactly one of `domains` (lowercase, no `@`). No email, an
 * email of any other shape, or no domains listed: false, so an unset list
 * makes nobody staff, never everybody, and `x@notexample.com` is never staff
 * of `example.com`.
 */
export function isStaffEmail(email: string | null | undefined, domains: readonly string[] | undefined): boolean {
  if (!domains?.length || !email) return false;
  const match = EMAIL_SHAPE.exec(email.trim());
  if (!match) return false;
  return domains.includes(match[1]!.toLowerCase());
}
