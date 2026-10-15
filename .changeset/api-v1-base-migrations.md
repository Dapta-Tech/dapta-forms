---
'@quill/db': minor
---

Add the schema the public API v1 builds on, in both dialects (migration 0024).

Purely additive: every new column is nullable, no existing row is rewritten, and
nothing reads or writes the new columns yet.

- `api_key.member_id`, the member who created the key, plus the
  `api_key_account_member_idx` index on `(account_id, member_id)` for listing a
  workspace's keys or one member's keys in it.
- `form.created_via` (`web`, `api` or `mcp`; NULL for every form created before
  the column).
- `form.previous_config` and `form.previous_published_at_ms`, the live config a
  publish replaced and when it had been published, for reverting a publish.

Both Drizzle schemas expose them as `apiKey.memberId`, `form.createdVia`,
`form.previousConfig` and `form.previousPublishedAtMs`.
