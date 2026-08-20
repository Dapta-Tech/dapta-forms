import { Logger } from '@nestjs/common';
import { HUBSPOT_API_BASE } from '@quill/destinations';

/**
 * The HubSpot portal a token belongs to, cached per account.
 *
 * The mirror form's submit URL carries the portal id, so posting the "Form
 * submission" activity needs it and nothing else in the product does. It is
 * therefore resolved lazily rather than stored, and a form with no mirror never
 * pays for the lookup at all.
 *
 * Keyed on the token as well as the account so a rotated credential cannot keep
 * serving the previous portal's id, which would post one customer's submissions
 * at another customer's forms.
 *
 * Shared by both delivery paths on purpose. The submit-time path
 * (`DestinationEffects`) and the booking-time path (`BookingSyncEffects`) each
 * build the HubSpot adapter themselves, and the booking path shipped without a
 * portal at all: every form whose contact key comes from its scheduler synced
 * its answers and its Note but silently never posted the mirror, because the
 * adapter skips mirroring when either the guid or the portal is missing. One
 * resolver here is what keeps the two from drifting again.
 *
 * A failure returns null and the caller simply skips the mirror; the contact
 * still syncs.
 */
export class HubspotPortalResolver {
  private readonly log = new Logger('HubspotPortal');
  private readonly portalIds = new Map<string, { token: string; portalId: string }>();

  async resolve(accountId: string, token: string, fetchImpl: typeof fetch): Promise<string | null> {
    if (!token) return null;
    const cached = this.portalIds.get(accountId);
    if (cached && cached.token === token) return cached.portalId;
    try {
      const res = await fetchImpl(`${HUBSPOT_API_BASE}/account-info/v3/details`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.log.warn(`could not resolve HubSpot portal: HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json().catch(() => ({}))) as { portalId?: number | string };
      const portalId = body.portalId == null ? null : String(body.portalId);
      if (portalId) this.portalIds.set(accountId, { token, portalId });
      return portalId;
    } catch (err) {
      this.log.warn(`could not resolve HubSpot portal: ${String(err)}`);
      return null;
    }
  }
}

/**
 * The mirror form this destination posts to, or null.
 *
 * Gated on the author's switch as well as the guid: the guid SURVIVES the switch
 * being turned off, so that turning it back on reuses the same form instead of
 * orphaning the activities already attached to it. Policy lives here rather than
 * in the adapter, which simply posts when it is given somewhere to post to.
 */
export function mirrorGuidFor(
  settings: { formActivity?: boolean; formGuid?: string | null } | undefined,
): string | null {
  return settings?.formActivity === true ? (settings?.formGuid ?? null) : null;
}
