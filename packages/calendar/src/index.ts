/**
 * @slate/calendar — the CalendarProvider PORT. The engine/availability depends
 * ONLY on this interface: it asks for busy times when computing slots, and asks
 * for event write/delete when a booking is created/cancelled. NO external
 * vendor is named anywhere in this public package (R15) — a concrete adapter
 * lives in a private overlay. The OSS default is `disabled`: it returns no busy
 * and no-ops writes, so a bare fork runs with no calendar configured.
 */

export interface BusyInterval {
  startUtc: string;
  endUtc: string;
}

export interface ListBusyInput {
  /** Opaque connection references (never OAuth tokens) to read busy from. */
  connectionRefs: string[];
  fromUtc: string;
  toUtc: string;
}

export interface CreateEventInput {
  connectionRef: string;
  title: string;
  description?: string | null;
  startUtc: string;
  endUtc: string;
  attendeeEmails: string[];
  organizerEmail?: string | null;
  /** Request a conferencing link when true. */
  requestConferenceLink?: boolean;
  timeZone?: string | null;
}

export interface CreatedEvent {
  externalEventId: string;
  externalCalendarId?: string | null;
  meetingUrl?: string | null;
}

export interface DeleteEventInput {
  connectionRef: string;
  externalEventId: string;
}

/**
 * Move an EXISTING remote event to a new time (a true reschedule). Keeps the same
 * `externalEventId` so attendees see the event MOVE rather than a cancel + a fresh
 * invite, and no duplicate is created.
 */
export interface UpdateEventInput {
  connectionRef: string;
  externalEventId: string;
  title: string;
  description?: string | null;
  startUtc: string;
  endUtc: string;
  attendeeEmails: string[];
  organizerEmail?: string | null;
  timeZone?: string | null;
}

/** One calendar exposed by a connected account (for the post-connect pick). */
export interface CalendarSummary {
  /** Opaque calendar ref the provider round-trips (never an OAuth token). */
  id: string;
  name: string;
  primaryEmail?: string | null;
  /** The account's default calendar — a sensible default destination. */
  isPrimary?: boolean;
}

/** Health of a single connection, surfaced in the connections UI. */
export interface ConnectionHealth {
  ok: boolean;
  /** Human-readable detail (e.g. "Connected", "Reauthorization required"). */
  detail: string;
}

export interface CalendarProvider {
  /** True when a real provider is wired; false disables all calendar effects. */
  readonly enabled: boolean;
  listBusy(input: ListBusyInput): Promise<BusyInterval[]>;
  createEvent(input: CreateEventInput): Promise<CreatedEvent>;
  /** Move an existing event in place (true reschedule). */
  updateEvent(input: UpdateEventInput): Promise<CreatedEvent>;
  deleteEvent(input: DeleteEventInput): Promise<void>;
  /** List the calendars a connected account exposes (post-connect pick). */
  listCalendars(connectionRef: string): Promise<CalendarSummary[]>;
  /** Probe a connection's live health (drives the per-row status + ping). */
  checkConnection(connectionRef: string): Promise<ConnectionHealth>;
}

/**
 * The OSS default: no external calendar. Returns no busy times and no-ops
 * writes. A fork "just works" without any calendar integration; slots then
 * subtract only local bookings + holds (documented degrade). A private adapter
 * replaces this to subtract real external busy times.
 */
export class DisabledCalendarProvider implements CalendarProvider {
  readonly enabled = false;
  listBusy(): Promise<BusyInterval[]> {
    return Promise.resolve([]);
  }
  createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    return Promise.resolve({ externalEventId: `disabled-${input.connectionRef}`, meetingUrl: null });
  }
  updateEvent(input: UpdateEventInput): Promise<CreatedEvent> {
    return Promise.resolve({ externalEventId: input.externalEventId, meetingUrl: null });
  }
  deleteEvent(): Promise<void> {
    return Promise.resolve();
  }
  listCalendars(): Promise<CalendarSummary[]> {
    return Promise.resolve([]);
  }
  checkConnection(): Promise<ConnectionHealth> {
    return Promise.resolve({ ok: false, detail: 'No external calendar provider configured.' });
  }
}

/** In-memory fake for tests: seed busy per connection ref, inspect writes. */
export class InMemoryCalendarProvider implements CalendarProvider {
  readonly enabled = true;
  private busy = new Map<string, BusyInterval[]>();
  private calendars = new Map<string, CalendarSummary[]>();
  readonly created: CreateEventInput[] = [];
  readonly updated: UpdateEventInput[] = [];
  readonly deleted: DeleteEventInput[] = [];
  private seq = 0;

  seedBusy(connectionRef: string, intervals: BusyInterval[]): void {
    this.busy.set(connectionRef, intervals);
  }

  seedCalendars(connectionRef: string, calendars: CalendarSummary[]): void {
    this.calendars.set(connectionRef, calendars);
  }

  listBusy(input: ListBusyInput): Promise<BusyInterval[]> {
    const out: BusyInterval[] = [];
    for (const ref of input.connectionRefs) {
      for (const b of this.busy.get(ref) ?? []) {
        if (b.endUtc > input.fromUtc && b.startUtc < input.toUtc) out.push(b);
      }
    }
    return Promise.resolve(out);
  }
  createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    this.created.push(input);
    return Promise.resolve({ externalEventId: `evt-${++this.seq}`, meetingUrl: null });
  }
  updateEvent(input: UpdateEventInput): Promise<CreatedEvent> {
    this.updated.push(input);
    // A move keeps the same external event id.
    return Promise.resolve({ externalEventId: input.externalEventId, meetingUrl: null });
  }
  deleteEvent(input: DeleteEventInput): Promise<void> {
    this.deleted.push(input);
    return Promise.resolve();
  }
  listCalendars(connectionRef: string): Promise<CalendarSummary[]> {
    return Promise.resolve(this.calendars.get(connectionRef) ?? []);
  }
  checkConnection(): Promise<ConnectionHealth> {
    return Promise.resolve({ ok: true, detail: 'Connected' });
  }
}
