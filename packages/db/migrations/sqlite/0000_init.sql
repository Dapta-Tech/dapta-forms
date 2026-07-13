-- Initial schema (SQLite) — a PORTABLE SUBSET of the Postgres source-of-truth
-- (migrations/pg/0000_init.sql). Instants are INTEGER epoch-ms; booleans are
-- INTEGER 0/1; dates/times and JSON are TEXT. No GiST EXCLUDE (SQLite can't
-- express it) — the app-level overlap-check-in-a-transaction is the guard here.

CREATE TABLE account (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE member (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT NOT NULL,
  handle              TEXT,
  display_name        TEXT,
  email               TEXT,
  avatar_url          TEXT,
  cover_url           TEXT,
  brand_color         TEXT,
  layout              TEXT,
  booking_page_style  TEXT,
  time_zone           TEXT NOT NULL DEFAULT 'UTC',
  week_start          TEXT NOT NULL DEFAULT 'sunday',
  locale              TEXT,
  time_format         INTEGER NOT NULL DEFAULT 12,
  default_schedule_id TEXT,
  created_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX member_account_handle_idx ON member (account_id, handle);

CREATE TABLE schedule (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  time_zone  TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL
);
CREATE INDEX schedule_member_idx ON schedule (member_id);

CREATE TABLE availability (
  id          TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  days        TEXT,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  date        TEXT
);
CREATE INDEX availability_schedule_idx ON availability (schedule_id);

CREATE TABLE team (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  slug          TEXT,
  logo_url      TEXT,
  time_zone     TEXT NOT NULL DEFAULT 'UTC',
  hide_branding INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX team_account_slug_idx ON team (account_id, slug);

CREATE TABLE team_membership (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  team_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  accepted   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX team_membership_team_member_idx ON team_membership (team_id, member_id);
CREATE INDEX team_membership_member_idx ON team_membership (member_id);

CREATE TABLE event_type (
  id                     TEXT PRIMARY KEY,
  account_id             TEXT NOT NULL,
  member_id              TEXT,
  team_id                TEXT,
  slug                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  description            TEXT,
  length_minutes         INTEGER NOT NULL,
  schedule_id            TEXT,
  hidden                 INTEGER NOT NULL DEFAULT 0,
  scheduling_type        TEXT,
  locations              TEXT,
  booking_fields         TEXT,
  metadata               TEXT,
  minimum_booking_notice INTEGER NOT NULL DEFAULT 120,
  before_event_buffer    INTEGER NOT NULL DEFAULT 0,
  after_event_buffer     INTEGER NOT NULL DEFAULT 0,
  slot_interval          INTEGER,
  requires_confirmation  INTEGER NOT NULL DEFAULT 0,
  seats_per_time_slot    INTEGER,
  created_at             INTEGER NOT NULL
);
CREATE UNIQUE INDEX event_type_member_slug_idx ON event_type (account_id, member_id, slug);
CREATE UNIQUE INDEX event_type_team_slug_idx ON event_type (account_id, team_id, slug);

CREATE TABLE event_type_host (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  event_type_id TEXT NOT NULL,
  member_id     TEXT NOT NULL,
  is_fixed      INTEGER NOT NULL DEFAULT 0,
  priority      INTEGER,
  weight        INTEGER,
  schedule_id   TEXT,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX event_type_host_event_member_idx ON event_type_host (event_type_id, member_id);
CREATE INDEX event_type_host_member_idx ON event_type_host (member_id);

CREATE TABLE booking (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT NOT NULL,
  uid                 TEXT NOT NULL UNIQUE,
  event_type_id       TEXT,
  host_member_id      TEXT,
  team_id             TEXT,
  title               TEXT NOT NULL,
  start_ms            INTEGER NOT NULL,
  end_ms              INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'accepted',
  location            TEXT,
  meeting_url         TEXT,
  attendee_time_zone  TEXT,
  responses           TEXT,
  metadata            TEXT,
  cancellation_reason TEXT,
  cancelled_by        TEXT,
  rescheduled         INTEGER,
  from_reschedule     TEXT,
  recurring_event_id  TEXT,
  idempotency_key     TEXT UNIQUE,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX booking_host_status_idx ON booking (host_member_id, status, start_ms, end_ms);
CREATE INDEX booking_account_idx ON booking (account_id, start_ms);

CREATE TABLE booking_attendee (
  id         TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  time_zone  TEXT,
  phone      TEXT,
  notes      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX booking_attendee_booking_idx ON booking_attendee (booking_id);

CREATE TABLE slot_reservation (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  event_type_id TEXT NOT NULL,
  member_id     TEXT NOT NULL,
  slot_start_ms INTEGER NOT NULL,
  slot_end_ms   INTEGER NOT NULL,
  uid           TEXT NOT NULL,
  release_at_ms INTEGER NOT NULL,
  is_seat       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX slot_reservation_release_idx ON slot_reservation (release_at_ms);
CREATE INDEX slot_reservation_lookup_idx ON slot_reservation (event_type_id, member_id, slot_start_ms);

CREATE TABLE connected_calendar (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  member_id      TEXT NOT NULL,
  provider       TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  primary_email  TEXT,
  is_destination INTEGER NOT NULL DEFAULT 0,
  check_conflicts INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);
CREATE INDEX connected_calendar_member_idx ON connected_calendar (member_id);

CREATE TABLE api_key (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL UNIQUE,
  last4           TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  scopes          TEXT,
  event_type_ids  TEXT,
  last_used_at_ms INTEGER,
  expires_at_ms   INTEGER,
  revoked_at_ms   INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX api_key_account_idx ON api_key (account_id);

CREATE TABLE webhook (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL,
  member_id      TEXT,
  team_id        TEXT,
  event_type_id  TEXT,
  subscriber_url TEXT NOT NULL,
  secret         TEXT,
  event_triggers TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);
CREATE INDEX webhook_account_idx ON webhook (account_id);

CREATE TABLE booking_reference (
  id                   TEXT PRIMARY KEY,
  booking_id           TEXT NOT NULL,
  type                 TEXT NOT NULL,
  external_event_id    TEXT,
  external_calendar_id TEXT,
  meeting_url          TEXT,
  created_at           INTEGER NOT NULL
);
CREATE INDEX booking_reference_booking_idx ON booking_reference (booking_id);
