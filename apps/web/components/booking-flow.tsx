'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  groupSlotsByDay,
  detectTimeZone,
  formatSlotDateTime,
  getMessages,
  t,
  validateBookingFieldValue,
  type DisplaySlot,
  type Slot,
} from '@slate/shared';
import type { BookingField } from '@slate/types';
import { bookAction } from '@/app/[accountCode]/[handle]/[slug]/actions';
import { postReservation, type BookResult } from '@/lib/api';
import { signupHref } from '@/lib/growth';

interface Props {
  accountCode: string;
  /** Member handle (personal) or team slug (team). */
  ownerSlug: string;
  slug: string;
  slots: Slot[];
  /**
   * Why `slots` is empty, when it's a config error (API reason code). Public
   * pages map every code to GENERIC copy — internals are never named here;
   * the actionable detail lives on the admin surfaces.
   */
  emptyReason?: string;
  bookingFields: BookingField[];
  initialTimeZone: string;
  mode?: 'personal' | 'team';
  /** Visitor locale ('en' | 'es') for EN/ES copy. */
  locale?: string;
}

interface Hold {
  uid: string;
  expiresAt: string;
}

/**
 * The interactive island: pick a timezone, pick a slot (which places a soft
 * HOLD), fill the form, book. Slots are absolute UTC instants (tz switch
 * regroups with no refetch). Errors surface by HTTP status: 409 slot-taken and
 * 410 hold-expired both offer a Retry (R22 error+retry). Branding renders via
 * the ancestor `.branded-surface` classes + `--bp-*` vars (preview == prod).
 */
export function BookingFlow({
  accountCode,
  ownerSlug,
  slug,
  slots,
  emptyReason,
  bookingFields,
  initialTimeZone,
  mode = 'personal',
  locale = 'en',
}: Props) {
  const m = getMessages(locale).booking;
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [selected, setSelected] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [result, formAction, pending] = useActionState<BookResult | null, FormData>(bookAction, null);

  const days = useMemo(() => groupSlotsByDay(slots, timeZone), [slots, timeZone]);

  async function pick(slot: DisplaySlot) {
    setSelected(slot.startUtc);
    setDismissed(false);
    setHoldError(null);
    setHold(null);
    // Team events resolve their host set at booking time (round-robin picks one,
    // collective/fixed assign the required hosts) — no per-host hold here.
    if (mode !== 'personal') return;
    // Group events (capacity > 1) fill seats on ONE booking; a per-person hold
    // would blank the whole slot, so skip the hold for group slots.
    if ((slot.capacity ?? 1) > 1) return;
    const r = await postReservation({ accountCode, handle: ownerSlug, slug, startUtc: slot.startUtc });
    if (r.ok && r.reservationUid) setHold({ uid: r.reservationUid, expiresAt: r.expiresAt! });
    else setHoldError(r.message ?? 'Could not hold this time.');
  }

  function retry() {
    setSelected(null);
    setHold(null);
    setHoldError(null);
    setDismissed(true);
  }

  // --- Confirmed ----------------------------------------------------------
  if (result?.ok && result.booking) {
    const b = result.booking;
    const isPending = b.status === 'pending';
    const g = getMessages(locale).growth;
    const ctaHref = signupHref('confirmation', accountCode);
    return (
      <div>
        <section className="bp-card border border-border bg-card p-6 text-card-foreground">
          <h2 className="mb-2 text-xl font-semibold">{isPending ? m.requested : m.confirmed}</h2>
          <p className="text-muted-foreground">
            {b.title} — {formatSlotDateTime(b.startUtc, timeZone)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPending
              ? t(m.awaitingConfirmation, { email: b.attendee.email })
              : t(m.confirmationSentTo, { email: b.attendee.email })}
          </p>
          {b.manageUrl ? (
            <a
              href={b.manageUrl}
              className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
            >
              {getMessages(locale).manage.title} →
            </a>
          ) : null}
        </section>
        {/* Growth loop (R11): a quiet secondary line — a link, never a second
            primary CTA (R30) — gated by the same open-core badge switch. */}
        {ctaHref ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {g.ctaQuestion}{' '}
            <a
              href={ctaHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
            >
              {g.ctaAction}
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  const conflict = result && !result.ok && !dismissed && (result.status === 409 || result.status === 410);
  const intakeError = result && !result.ok && !dismissed && result.status === 400;

  // --- Conflict (409/410): R22 error + retry ------------------------------
  // CALENDAR_UNAVAILABLE (booking blocked fail-closed) gets its own localized
  // copy — a generic "try again shortly", never internals.
  if (conflict) {
    const calUnavailable = result!.error === 'CALENDAR_UNAVAILABLE';
    return (
      <section className="bp-card border border-destructive bg-card p-6">
        <h2 className="mb-1 text-lg font-semibold">
          {calUnavailable ? m.calendarUnavailableTitle : result!.status === 410 ? m.holdExpired : m.slotTaken}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {calUnavailable ? m.calendarUnavailableBody : result!.message}
        </p>
        <button
          type="button"
          onClick={retry}
          className="bp-btn px-4 py-2 font-semibold transition-transform active:scale-[0.98]"
        >
          {m.pickAnother}
        </button>
      </section>
    );
  }

  return (
    <div className="bp-canvas grid gap-8 md:grid-cols-[1fr_320px]">
      <section aria-label="Available times">
        <div className="mb-4 flex items-center gap-2">
          <label htmlFor="tz" className="text-sm text-muted-foreground">
            {m.timezone}
          </label>
          <select
            id="tz"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            className="rounded-md border border-input bg-card px-2 py-1 text-sm"
          >
            {[timeZone, detectTimeZone(), 'UTC']
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
          </select>
        </div>

        {days.length === 0 ? (
          <p className="text-muted-foreground">
            {emptyReason === 'CALENDAR_UNAVAILABLE'
              ? m.timesUnavailable
              : emptyReason
                ? m.noTimesNow
                : m.noSlots}
          </p>
        ) : (
          // Page-scroll, no inner scroll region (Design Quality Bar §2): the list
          // flows in the page so there's no native scrollbar or mid-row cut, and
          // the day headers stay sticky for context.
          <div className="flex flex-col gap-4">
            {days.map((day) => (
              <div key={day.dayKey} className="bp-day">
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{day.heading}</h3>
                <div className="bp-slots">
                  {day.slots.map((s) => {
                    const isGroup = (s.capacity ?? 1) > 1;
                    const full = isGroup && (s.spotsLeft ?? 1) <= 0;
                    return (
                      <button
                        key={s.startUtc}
                        type="button"
                        onClick={() => pick(s)}
                        aria-pressed={selected === s.startUtc}
                        disabled={full}
                        className="bp-slot text-sm disabled:opacity-50"
                      >
                        <span className="whitespace-nowrap">{s.label}</span>
                        {isGroup ? (
                          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {full ? m.full : t(m.seatsLeft, { n: s.spotsLeft ?? 0 })}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside aria-label="Your details" className="md:sticky md:top-6 md:self-start">
        {selected ? (
          <form action={formAction} className="bp-card flex flex-col gap-3 border border-border bg-card p-4">
            <input type="hidden" name="accountCode" value={accountCode} />
            <input type="hidden" name="ownerSlug" value={ownerSlug} />
            <input type="hidden" name="kind" value={mode} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="startUtc" value={selected} />
            <input type="hidden" name="timeZone" value={timeZone} />
            {hold ? <input type="hidden" name="reservationUid" value={hold.uid} /> : null}

            <p className="text-sm text-muted-foreground">{formatSlotDateTime(selected, timeZone)}</p>
            {hold ? (
              <p className="text-xs text-muted-foreground">
                {t(m.heldUntil, {
                  time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(hold.expiresAt)),
                })}
              </p>
            ) : holdError ? (
              <p className="text-xs text-destructive">{holdError}</p>
            ) : null}

            <label className="flex flex-col gap-1 text-sm">
              <span>{m.yourName} <span className="text-destructive">*</span></span>
              <input name="name" required className="rounded-md border border-input bg-background px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{m.yourEmail} <span className="text-destructive">*</span></span>
              <input name="email" type="email" required className="rounded-md border border-input bg-background px-3 py-2" />
            </label>

            {bookingFields.map((f) => {
              const validate = (v: string) =>
                setFieldErrors((e) => ({ ...e, [f.name]: validateBookingFieldValue(f.type, v) }));
              const isMulti = f.type === 'textarea' || f.type === 'guests';
              return (
                <label key={f.name} className="flex flex-col gap-1 text-sm">
                  {/* Required marker stays INLINE with the label (Bar §7). */}
                  <span>
                    {f.label}
                    {f.required ? <span className="text-destructive"> *</span> : null}
                  </span>
                  {isMulti ? (
                    <textarea
                      name={`answer_${f.name}`}
                      required={f.required}
                      rows={2}
                      placeholder={f.type === 'guests' ? 'guest1@example.com, guest2@example.com' : f.placeholder}
                      onBlur={(e) => validate(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  ) : (
                    <input
                      name={`answer_${f.name}`}
                      type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : 'text'}
                      required={f.required}
                      placeholder={f.placeholder}
                      onBlur={(e) => validate(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  )}
                  {fieldErrors[f.name] ? (
                    <span className="text-xs text-destructive">{fieldErrors[f.name]}</span>
                  ) : null}
                </label>
              );
            })}

            <label className="flex flex-col gap-1 text-sm">
              <span>{m.notes}</span>
              <textarea name="notes" rows={2} className="rounded-md border border-input bg-background px-3 py-2" />
            </label>

            {intakeError ? <p className="text-sm text-destructive">{result!.message}</p> : null}

            <button
              type="submit"
              disabled={pending || Object.values(fieldErrors).some(Boolean)}
              className="bp-btn px-4 py-2 font-semibold transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? m.confirming : m.confirm}
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            {m.selectTime}
          </p>
        )}
      </aside>
    </div>
  );
}
