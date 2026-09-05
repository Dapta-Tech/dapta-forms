---
'@quill/db': minor
'@quill/types': minor
'@quill/shared': minor
---

A workspace timezone: every date in the admin, the analytics day cuts and the CSV local columns read in one shared zone.

Until now every timestamp in the dashboard was rendered on the server's clock
(UTC) and the analytics buckets were UTC days, so a team in Bogota read its
evening submissions as tomorrow's. The workspace now carries one IANA zone
(`account.timezone`, migration 0020) that everyone in it shares.

- **Default**: the first owner or admin to open the dashboard while the zone
  is unset seeds it from their browser (a write-once claim, so two admins in
  different zones cannot flip it), with a toast saying where to change it.
  Staff entering an estate workspace never seed it. Until then dates read in
  UTC, exactly as before.
- **Two places to change it**, both writing the same column through
  `PATCH /v1/workspaces/current/timezone` (admin/owner): Account settings,
  under the workspace name, and a dropdown beside the submissions filter.
  A member sees the zone with a lock and the note that only an admin can
  change it.
- **Dates**: the forms list, the submissions table, the delivery history,
  the webhook health line and the brand kit stamp all go through
  `formatDateTime` / `formatDate` in `@quill/shared` (Intl only; an unknown
  zone renders as UTC with a warning, never a 500).
- **Analytics**: day buckets are named in the workspace zone inside SQL
  (`(col + offset) / 86400000` with the offset picked by a CASE over the DST
  boundaries of the queried window), the range presets and custom dates cut
  at local midnight, the picker's "today" is the zone's today, `?tz=` can
  override per request, the response echoes `range.timeZone`, and a caption
  under the trends chart names the zone.
- **CSV export** keeps `started_at` / `completed_at` in UTC (`Z`) and adds
  `started_at_local` / `completed_at_local` as ISO with the zone offset
  (`2026-09-03T18:30:15-05:00`).
- `@quill/shared`: `datetime.ts` (`isValidTimeZone`, `resolveTimeZone`,
  `tzOffsetMs`, `localDayIndex`, `zonedMidnightMs`, `dayBoundsInZone`,
  `isoDateInZone`, `utcOffsetSegments`, `formatDateTime`, `formatDate`,
  `formatIsoWithOffset`). `@quill/types`: `timeZoneSchema`,
  `workspaceTimezoneSchema`, `analyticsResponseSchema.range.timeZone`.
- i18n: `admin.settings.workspaceTimezone*`, `admin.submissions.timezone*`,
  `admin.analytics.timezoneNote`, `admin.chrome.timezoneAutoSet` (EN + ES).
