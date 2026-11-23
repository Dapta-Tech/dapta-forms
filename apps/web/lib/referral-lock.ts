/**
 * The referral program on the badge switch, shared by the server pages that
 * read `/v1/me` and the client controls that draw it. No React here, so a
 * server component can call it.
 */

/** What the locked badge switch needs from `/v1/me.referral` to offer the program. */
export interface ReferralLock {
  link: string;
  count: number;
  goal: number;
}

/**
 * The block a locked badge switch offers when the referral program is on and
 * the reader OWNS the workspace (a referral unlock reaches only the
 * workspaces its holder owns, so it is no way out for an admin or a member).
 * Null otherwise: the switch keeps its "Only for Dapta AI subscribers." note.
 */
export function referralLockOf(me: {
  role: string;
  referral?: { enabled: boolean; link?: string; count?: number; goal?: number };
}): ReferralLock | null {
  const r = me.referral;
  if (me.role !== 'owner' || !r?.enabled || !r.link) return null;
  return { link: r.link, count: r.count ?? 0, goal: r.goal ?? 5 };
}

/** Fill `{count}`, `{goal}` and `{product}` in an attribution string. */
export function fillLock(template: string, values: { count?: number; goal: number; product: string }): string {
  return template
    .replaceAll('{count}', String(values.count ?? 0))
    .replaceAll('{goal}', String(values.goal))
    .replaceAll('{product}', values.product);
}
