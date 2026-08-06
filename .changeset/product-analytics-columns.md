---
'@quill/db': minor
---

Product analytics groundwork — additive migration 0010 (Postgres + SQLite) adding five nullable columns. `account.activated_at` and `account.first_viewed_at` are write-once MILESTONE CLAIMS (`UPDATE … WHERE <col> IS NULL … RETURNING`), so exactly one caller can ever win and a funnel counts accounts reaching a stage rather than actions taken; both are backfilled from existing submissions and view events so a milestone that already happened is never re-announced. `form.created_by` records the author (authorship for per-user analytics, never authorization; ownership stays with account_id). `member.last_seen_at` turns "N members exist" into "N exist, M came back". `account.attribution` is reserved — nothing writes it yet. Every column is nullable and NULL stays a meaningful "not known"; the drizzle schemas are updated in parity across both dialects.
