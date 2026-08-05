---
'@quill/db': minor
---

Product analytics groundwork — additive migration 0010 (Postgres + SQLite) adding three nullable columns: `account.attribution` (first-touch acquisition context: utm_*, referrer, landing_path, persisted so attribution survives a cookie wipe and can be joined in SQL), `form.created_by` (member.id of the author — authorship for per-user analytics, never authorization; ownership stays with account_id), and `member.last_seen_at` (epoch-ms of the last authenticated request, so "N members exist" becomes "N exist, M came back"). Nothing writes to these columns yet; the drizzle schemas in both dialects are updated in parity. NULL stays a meaningful "not known" on every one — no backfill, no default that would misreport history.
