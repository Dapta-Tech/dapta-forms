/**
 * Booking events — one row per scheduling callback (HubSpot Meetings /
 * Calendly) the public renderer reports after a meeting is booked through an
 * outcome's scheduling handoff. Tied to the submission session via
 * (form_id, session_id) so a booking can be joined to its submission. Same
 * portable shape as the rest of the repository: everything goes through the
 * `Db` port and portable `sql` templates, identical on SQLite and Postgres.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Db } from './client';
import { parseJsonColumn, jsonParam } from './forms';

export interface BookingEventRow {
  id: string;
  formId: string;
  sessionId: string;
  provider: string;
  eventUri: string | null;
  inviteeUri: string | null;
  /** Scheduled start, epoch-ms (null when the provider did not report one). */
  startTime: number | null;
  /** The raw callback payload (diagnostics / later delivery enrichment). */
  payload: unknown | null;
  createdAt: number;
}

function mapBookingEvent(r: Record<string, unknown>): BookingEventRow {
  return {
    id: String(r.id),
    formId: String(r.form_id),
    sessionId: String(r.session_id),
    provider: String(r.provider),
    eventUri: r.event_uri == null ? null : String(r.event_uri),
    inviteeUri: r.invitee_uri == null ? null : String(r.invitee_uri),
    startTime: r.start_time == null ? null : Number(r.start_time),
    payload: r.payload == null ? null : parseJsonColumn(r.payload, null),
    createdAt: Number(r.created_at),
  };
}

/** Record one scheduling callback for a form + session. Returns the new row. */
export async function insertBookingEvent(
  db: Db,
  input: {
    formId: string;
    sessionId: string;
    provider: string;
    eventUri?: string | null;
    inviteeUri?: string | null;
    startTime?: number | null;
    payload?: unknown;
    now?: number;
  },
): Promise<BookingEventRow> {
  const id = randomUUID();
  await db.run(
    sql`INSERT INTO booking_event
          (id, form_id, session_id, provider, event_uri, invitee_uri, start_time, payload, created_at)
        VALUES (${id}, ${input.formId}, ${input.sessionId}, ${input.provider},
          ${input.eventUri ?? null}, ${input.inviteeUri ?? null}, ${input.startTime ?? null},
          ${input.payload == null ? null : jsonParam(input.payload)}, ${input.now ?? Date.now()})`,
  );
  const row = await db.get<Record<string, unknown>>(
    sql`SELECT * FROM booking_event WHERE id = ${id} LIMIT 1`,
  );
  return mapBookingEvent(row!);
}

/** A form's booking events for one session, oldest first (backed by the index). */
export async function listBookingEvents(
  db: Db,
  formId: string,
  sessionId: string,
): Promise<BookingEventRow[]> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM booking_event
        WHERE form_id = ${formId} AND session_id = ${sessionId}
        ORDER BY created_at ASC`,
  );
  return rows.map(mapBookingEvent);
}
