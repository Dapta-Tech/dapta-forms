import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Db } from '@slate/db';
import {
  checkHandleAvailable,
  confirmBooking,
  createApiKey,
  createBooking,
  createConnection,
  updateConnection,
  connectionExists,
  getConnectionRef,
  declineBooking,
  createWebhook,
  updateWebhook,
  pingWebhook,
  deleteConnection,
  deleteWebhook,
  enqueueWebhookDeliveries,
  getAvailability,
  getMe,
  listApiKeys,
  listBookings,
  listConnections,
  listWebhooks,
  recordConnectionHealth,
  revokeApiKey,
  updateBranding,
  updateHandle,
  updateMemberSettings,
  cancelBooking,
  cacheEntitlement,
  setVanitySlug,
  sql,
  type VanityOutcome,
  defaultNotificationSetting,
  getNotificationSettings,
  resetNotificationTemplate,
  upsertNotificationSetting,
} from '@slate/db';
import {
  EMAIL_TEMPLATE_KEYS,
  TEMPLATE_VARIABLES,
  defaultEnabledFor,
  defaultTemplate,
  renderTemplate,
  resolveTemplate,
  templateVars,
  unknownTokens,
  type BookingNotification,
  type EmailTemplateKey,
} from '@slate/notifications';
import { canClaimVanitySlug } from '@slate/engine';
import type { HostPrincipal } from './auth.service';
import { CalendarEffects } from './calendar-effects';
import { asConnector } from './calendar.http-provider';
import { EmailEffects, DEFAULT_REMINDER_LEAD_MINUTES, DEFAULT_FOLLOW_UP_LEAD_MINUTES } from './email-effects';
import { DisabledEntitlementsProvider, type EntitlementsProvider } from './entitlements.provider';
import { DB, ENTITLEMENTS, PREMIUM_MODE } from './tokens';

/** How long a cached Dapta AI entitlement verdict stays fresh before re-asking upstream. */
const ENTITLEMENT_TTL_MS = 6 * 3600_000;

/** Authed host/dashboard operations. All are scoped to the caller's account. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CalendarEffects) private readonly calendar: CalendarEffects,
    @Inject(EmailEffects) private readonly email: EmailEffects,
    // Optional so existing direct constructions keep working: OSS default is
    // no upstream + `open` premium mode (fork-friendly).
    @Optional() @Inject(ENTITLEMENTS) private readonly entitlements: EntitlementsProvider = new DisabledEntitlementsProvider(),
    @Optional() @Inject(PREMIUM_MODE) private readonly premiumMode: 'open' | 'locked' = 'open',
  ) {}

  me(p: HostPrincipal) {
    return getMe(this.db, p.accountId, p.memberId);
  }

  handleAvailable(p: HostPrincipal, handle: string) {
    return checkHandleAvailable(this.db, p.accountId, handle, p.memberId);
  }

  updateBranding(p: HostPrincipal, patch: Parameters<typeof updateBranding>[2]) {
    return updateBranding(this.db, p.memberId, patch);
  }

  updateSettings(p: HostPrincipal, patch: Parameters<typeof updateMemberSettings>[2]) {
    return updateMemberSettings(this.db, p.memberId, patch);
  }

  /** Rename the handle after confirming it's available (reserved/taken → error). */
  async renameHandle(p: HostPrincipal, handle: string): Promise<{ ok: boolean; reason: string | null }> {
    const check = await checkHandleAvailable(this.db, p.accountId, handle, p.memberId);
    if (!check.available) return { ok: false, reason: check.reason };
    await updateHandle(this.db, p.memberId, check.handle);
    return { ok: true, reason: null };
  }

  // Host bookings (R29): the on-behalf path with the singular-attendee shape.
  listBookings(p: HostPrincipal, q: { from?: string; to?: string; status?: string; limit?: number }) {
    return listBookings(this.db, {
      accountId: p.accountId,
      memberId: p.memberId,
      from: q.from ? new Date(q.from).getTime() : undefined,
      to: q.to ? new Date(q.to).getTime() : undefined,
      status: q.status,
      limit: q.limit,
    });
  }

  async hostCreate(
    p: HostPrincipal,
    body: {
      handle?: string;
      slug: string;
      startUtc: string;
      attendee: { name: string; email: string; timeZone: string; notes?: string; phone?: string };
      answers?: Record<string, unknown>;
    },
    accountCode: string,
  ) {
    const outcome = await createBooking(
      this.db,
      {
        accountCode,
        // Hosts can create manual bookings before setting a public handle: fall
        // back to their own member id when no handle is on the payload.
        handle: body.handle || undefined,
        memberId: body.handle ? undefined : p.memberId,
        slug: body.slug,
        startMs: new Date(body.startUtc).getTime(),
        attendee: body.attendee,
        answers: body.answers,
        onBehalf: true,
      },
      // Fail-closed external conflict check at create time (no-op when disabled).
      this.calendar.provider,
    );
    // Write out only a fresh ACCEPTED booking (pending waits for confirm).
    if (outcome.ok && outcome.booking.status === 'accepted')
      this.calendar.onBookingAccepted(outcome.booking.uid);
    return outcome;
  }

  async hostCancel(p: HostPrincipal, uid: string, reason?: string) {
    const out = await cancelBooking(this.db, { uid, reason, byHost: true, accountId: p.accountId });
    // B2: the host-dashboard cancel bypassed BookingService and sent NOTHING.
    // Now it deletes the remote event, emails the attendee (+ host), and fires
    // the webhook — all durably via the outbox. Skip side-effects on an
    // idempotent retry (already cancelled) so nothing is duplicated (P1-1).
    if (out.ok && !out.alreadyApplied) {
      this.calendar.onBookingCancelled(uid);
      void this.email.enqueueCancellation(uid, { reason: reason ?? null });
      // The booking is off — its still-pending reminders must never fire.
      // (The public cancel path already did this; the host path missed it.)
      void this.email.cancelReminders(uid);
      void this.email.cancelFollowUps(uid);
      void enqueueWebhookDeliveries(this.db, p.accountId, 'booking.cancelled', {
        uid,
        reason: reason ?? null,
      }).catch(() => undefined);
    }
    return out;
  }

  async confirm(p: HostPrincipal, uid: string) {
    const out = await confirmBooking(this.db, uid, p.accountId);
    if (out.ok) {
      // pending→accepted: NOW write the event to the host's calendar and send
      // the attendee the confirmation (they already hold the manage link from
      // the "request received" email; the token isn't retrievable here).
      this.calendar.onBookingAccepted(uid);
      void this.email.enqueueConfirmation(uid);
      // Now that it's confirmed, schedule its pre-meeting reminders.
      void this.email.enqueueReminders(uid);
      void this.email.enqueueFollowUps(uid);
      void enqueueWebhookDeliveries(this.db, p.accountId, 'booking.confirmed', { uid }).catch(
        () => undefined,
      );
    }
    return out;
  }

  async decline(p: HostPrincipal, uid: string, reason?: string) {
    const out = await declineBooking(this.db, uid, reason, p.accountId);
    if (out.ok) {
      // B3: tell the attendee their pending request was declined (previously
      // nobody was notified — they'd show up to a meeting that never was).
      void this.email.enqueueDeclined(uid, { reason: reason ?? null });
      // Safety: drop any reminders (a declined pending booking usually has none).
      void this.email.cancelReminders(uid);
      void this.email.cancelFollowUps(uid);
      void enqueueWebhookDeliveries(this.db, p.accountId, 'booking.cancelled', {
        uid,
        reason: reason ?? null,
      }).catch(() => undefined);
    }
    return out;
  }

  // Connections (behind the CalendarProvider port — generic).
  listConnections(p: HostPrincipal) {
    return listConnections(this.db, p.memberId);
  }
  createConnection(p: HostPrincipal, body: { provider: string; externalId: string; primaryEmail?: string; isDestination?: boolean; checkConflicts?: boolean }) {
    return createConnection(this.db, { accountId: p.accountId, memberId: p.memberId, ...body });
  }
  deleteConnection(p: HostPrincipal, id: string) {
    return deleteConnection(this.db, p.memberId, id);
  }
  updateConnection(p: HostPrincipal, id: string, patch: { isDestination?: boolean; checkConflicts?: boolean }) {
    return updateConnection(this.db, p.memberId, id, patch);
  }

  /** The wired calendar provider (from the effects seam). */
  private get provider() {
    return this.calendar.provider;
  }

  /**
   * Start a connect flow: mint the connect token/URL from the provider. Returns
   * an honest disabled status when no external provider is wired (OSS default),
   * so the UI can say so instead of silently failing.
   */
  async connectionToken(
    p: HostPrincipal,
    provider: string,
  ): Promise<{ enabled: boolean; token: string | null; connectUrl: string | null; message: string }> {
    const connector = asConnector(this.provider);
    if (!connector) {
      return {
        enabled: false,
        token: null,
        connectUrl: null,
        message: 'No external calendar provider configured (OSS default). Add a connection manually.',
      };
    }
    const start = await connector.startConnect(provider, p.memberId);
    return { enabled: true, token: start.token, connectUrl: start.connectUrl, message: 'Connect started.' };
  }

  /**
   * After the OAuth popup completes, discover the tenant's connection(s) for the
   * provider and persist any not already stored (first destination wins R20).
   * Returns the connections now on record.
   */
  async discoverConnections(p: HostPrincipal, provider: string) {
    const connector = asConnector(this.provider);
    if (!connector) return listConnections(this.db, p.memberId);
    const discovered = await connector.discoverConnections(p.memberId, provider);
    const haveDestination = (await listConnections(this.db, p.memberId)).some((c) => c.isDestination);
    let firstNew = !haveDestination;
    for (const conn of discovered) {
      if (await connectionExists(this.db, p.memberId, conn.connectionRef)) continue;
      // Old-app parity: when discovery doesn't carry the account email, derive
      // it from the provider's primary calendar (its id IS the account email).
      // Best-effort — a label-less connection is still a working connection.
      let primaryEmail = conn.primaryEmail ?? null;
      if (!primaryEmail) {
        try {
          const calendars = await this.provider.listCalendars(conn.connectionRef);
          primaryEmail =
            calendars.find((c) => c.isPrimary)?.primaryEmail ??
            calendars.find((c) => c.primaryEmail)?.primaryEmail ??
            null;
        } catch {
          /* keep null */
        }
      }
      await createConnection(this.db, {
        accountId: p.accountId,
        memberId: p.memberId,
        provider: conn.provider || provider,
        externalId: conn.connectionRef,
        primaryEmail: primaryEmail ?? undefined,
        // First calendar the host connects becomes the default destination.
        isDestination: firstNew,
        checkConflicts: true,
      });
      firstNew = false;
    }
    return listConnections(this.db, p.memberId);
  }

  /** List the calendars a connected account exposes (post-connect pick). */
  async listConnectionCalendars(p: HostPrincipal, id: string) {
    const ref = await getConnectionRef(this.db, p.memberId, id);
    if (!ref) return [];
    if (!this.provider.enabled) return [];
    return this.provider.listCalendars(ref.externalId);
  }

  /** Probe a connection's live health for the UI (never throws). */
  async pingConnection(
    p: HostPrincipal,
    id: string,
  ): Promise<{ ok: boolean; enabled: boolean; message: string }> {
    if (!this.provider.enabled) {
      return { ok: true, enabled: false, message: 'No external calendar provider configured (OSS default).' };
    }
    const ref = await getConnectionRef(this.db, p.memberId, id);
    if (!ref) return { ok: false, enabled: true, message: 'Connection not found.' };
    const health = await this.provider.checkConnection(ref.externalId);
    // Persist the outcome so the Calendars page can show health with
    // last-checked info even before the next live probe.
    await recordConnectionHealth(this.db, p.memberId, id, { ok: health.ok, detail: health.detail });
    return { ok: health.ok, enabled: true, message: health.detail };
  }

  // API keys.
  listApiKeys(p: HostPrincipal) {
    return listApiKeys(this.db, p.accountId);
  }
  createApiKey(p: HostPrincipal, body: { name: string; scopes: string[]; eventTypeIds?: string[]; expiresAtMs?: number }) {
    return createApiKey(this.db, { accountId: p.accountId, ...body });
  }
  revokeApiKey(p: HostPrincipal, id: string) {
    return revokeApiKey(this.db, p.accountId, id);
  }

  // Webhooks.
  listWebhooks(p: HostPrincipal) {
    return listWebhooks(this.db, p.accountId);
  }
  createWebhook(p: HostPrincipal, body: { subscriberUrl: string; eventTriggers: string[]; secret?: string }) {
    return createWebhook(this.db, { accountId: p.accountId, ...body });
  }
  deleteWebhook(p: HostPrincipal, id: string) {
    return deleteWebhook(this.db, p.accountId, id);
  }
  updateWebhook(p: HostPrincipal, id: string, patch: { active?: boolean }) {
    return updateWebhook(this.db, p.accountId, id, patch);
  }
  pingWebhook(p: HostPrincipal, id: string) {
    return pingWebhook(this.db, p.accountId, id);
  }

  /** Resolve the account code for a principal (for host on-behalf booking). */
  async accountCode(p: HostPrincipal): Promise<string | null> {
    const me = await getMe(this.db, p.accountId, p.memberId);
    return me?.accountCode ?? null;
  }

  // --- Vanity slug (premium — included with the Dapta AI subscription) -----

  /**
   * Is this account entitled to premium features? Calendars is ALWAYS free —
   * the unlock is the customer's Dapta AI subscription, validated upstream and
   * CACHED on the account row (TTL) so nothing user-facing blocks on the
   * entitlement service. `PREMIUM_FEATURES=open` (the OSS default) short-circuits.
   */
  private async isEntitled(accountId: string): Promise<boolean> {
    if (this.premiumMode === 'open') return true;
    const acc = await this.db.get<{
      external_id: string | null;
      dapta_entitlement: string | null;
      entitlement_checked_at: number | null;
    }>(
      sql`SELECT external_id, dapta_entitlement, entitlement_checked_at
          FROM account WHERE id = ${accountId} LIMIT 1`,
    );
    if (!acc) return false;
    const checked = acc.entitlement_checked_at ? Number(acc.entitlement_checked_at) : 0;
    if (checked && Date.now() - checked < ENTITLEMENT_TTL_MS) {
      return acc.dapta_entitlement === 'paid';
    }
    if (!this.entitlements.enabled) return acc.dapta_entitlement === 'paid';
    // Refresh from the source of truth: keyed by the account owner's email
    // (the upstream service resolves customers by owner email) + org id.
    const owner = await this.db.get<{ email: string | null }>(
      sql`SELECT email FROM member
          WHERE account_id = ${accountId} AND role = 'owner' AND status = 'active'
          ORDER BY created_at ASC LIMIT 1`,
    );
    const paid = await this.entitlements.isPaidCustomer({
      ownerEmail: owner?.email,
      externalOrgId: acc.external_id,
    });
    await cacheEntitlement(this.db, accountId, paid ? 'paid' : 'free');
    return paid;
  }

  /** The Settings surface's view of the vanity feature. */
  async vanityStatus(
    p: HostPrincipal,
  ): Promise<{ vanitySlug: string | null; shortCode: string; canClaim: boolean }> {
    const me = await getMe(this.db, p.accountId, p.memberId);
    const entitled = await this.isEntitled(p.accountId);
    return {
      vanitySlug: me?.vanitySlug ?? null,
      shortCode: me?.accountShortCode ?? '',
      canClaim: canClaimVanitySlug(this.premiumMode, entitled),
    };
  }

  /** Claim / change / clear (null) the vanity slug. Caller enforces admin role. */
  async setVanity(
    p: HostPrincipal,
    slug: string | null,
  ): Promise<VanityOutcome | { ok: false; reason: 'NOT_ENTITLED' }> {
    const entitled = await this.isEntitled(p.accountId);
    if (!canClaimVanitySlug(this.premiumMode, entitled)) return { ok: false, reason: 'NOT_ENTITLED' };
    return setVanitySlug(this.db, p.accountId, slug);
  }

  /**
   * The authenticated host's own availability for one of their events — resolved
   * by member id, so it works before the member sets a public handle (the
   * public /v1/availability requires one). Powers /admin/bookings/new.
   */
  async myAvailability(p: HostPrincipal, q: { slug: string; from: string; to: string; timeZone?: string }) {
    const accountCode = await this.accountCode(p);
    if (!accountCode) return null;
    const fromMs = new Date(q.from).getTime();
    if (!Number.isFinite(fromMs)) return null;
    // Same 60-day window cap as the public endpoint (contract §Engine).
    const toMs = Math.min(new Date(q.to).getTime(), fromMs + 60 * 86_400_000);
    if (!Number.isFinite(toMs)) return null;
    const result = await getAvailability(
      this.db,
      { accountCode, memberId: p.memberId, slug: q.slug, fromMs, toMs, displayTimeZone: q.timeZone },
      this.calendar.provider,
    );
    if (!result) return null;
    return {
      eventType: result.eventType,
      timeZone: result.timeZone,
      slots: result.slots,
      // Config-error reason (admin surface renders the actionable copy).
      emptyReason: result.emptyReason,
    };
  }

  // --- Notification settings (Settings → Notifications; admin-gated) --------

  /**
   * The full catalog for the settings screen: every email key with its toggle,
   * custom template (or null), the shipped default in the caller's locale, and
   * the effective reminder lead times. Absent rows read as the defaults.
   */
  async listNotificationSettings(p: HostPrincipal) {
    const me = await getMe(this.db, p.accountId, p.memberId);
    const locale = me?.locale === 'es' ? 'es' : 'en';
    const stored = await getNotificationSettings(this.db, p.accountId);
    return {
      variables: [...TEMPLATE_VARIABLES],
      defaultReminderLeadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
      settings: EMAIL_TEMPLATE_KEYS.map((key) => {
        const s =
          stored.get(key) ??
          { ...defaultNotificationSetting(key), enabled: defaultEnabledFor(key) };
        const def = defaultTemplate(key, locale);
        return {
          key,
          enabled: s.enabled,
          subject: s.subject,
          body: s.body,
          defaultSubject: def.subject,
          defaultBody: def.body,
          customized: s.subject != null || s.body != null,
          reminderLeadMinutes:
            key === 'attendee_reminder'
              ? (s.reminderLeadMinutes ?? DEFAULT_REMINDER_LEAD_MINUTES)
              : key === 'follow_up'
                ? (s.reminderLeadMinutes ?? DEFAULT_FOLLOW_UP_LEAD_MINUTES)
                : undefined,
        };
      }),
    };
  }

  updateNotificationSetting(
    p: HostPrincipal,
    key: string,
    patch: { enabled?: boolean; subject?: string | null; body?: string | null; reminderLeadMinutes?: number[] | null },
  ) {
    return upsertNotificationSetting(this.db, p.accountId, key, patch);
  }

  resetNotificationTemplate(p: HostPrincipal, key: string) {
    return resetNotificationTemplate(this.db, p.accountId, key);
  }

  /**
   * Server-side preview: render the (possibly still-unsaved) template against
   * fixed sample data — the same renderer the outbox uses, so preview ===
   * reality. Also reports tokens outside the whitelist so the editor can flag
   * them before saving.
   */
  async previewNotificationTemplate(
    p: HostPrincipal,
    key: EmailTemplateKey,
    draft: { subject?: string | null; body?: string | null },
  ) {
    const me = await getMe(this.db, p.accountId, p.memberId);
    const locale = me?.locale === 'es' ? 'es' : 'en';
    const template = resolveTemplate(key, draft, locale);
    const sample: BookingNotification & { reminderLeadMinutes?: number } = {
      accountId: p.accountId,
      uid: 'sample-uid',
      title: locale === 'es' ? 'Llamada de presentación' : 'Intro Call',
      startUtc: new Date(Date.now() + 26 * 3_600_000).toISOString(),
      endUtc: new Date(Date.now() + 26 * 3_600_000 + 30 * 60_000).toISOString(),
      host: { name: me?.displayName ?? 'Alex Rivera', email: me?.email ?? 'host@example.com' },
      attendee: {
        name: locale === 'es' ? 'Ana García' : 'Sam Guest',
        email: 'guest@example.com',
        timeZone: me?.timeZone ?? 'UTC',
      },
      location: 'Google Meet',
      manageUrl: 'https://example.com/manage/sample',
      bookingLink: 'https://example.com/acme/alex-rivera/intro-call',
      cancellationReason: locale === 'es' ? 'Conflicto de agenda' : 'Schedule conflict',
      previousStartUtc: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      pending: key === 'host_booked',
      reminderLeadMinutes: 60,
    };
    const rendered = renderTemplate(template, templateVars(sample, locale));
    return {
      ...rendered,
      unknownTokens: unknownTokens(`${template.subject}\n${template.body}`),
    };
  }
}
