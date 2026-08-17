---
'@quill/db': minor
'@quill/types': minor
'@quill/shared': minor
---

The identity service's workspaces ARE the workspaces.

Until now one local `account` was born per identity-service ACCOUNT (the billing
layer above workspaces): a person with three workspaces upstream had exactly one
here, and a workspace created here was invisible upstream. From migration 0015 on,
`account.external_id` means the upstream WORKSPACE id and the local
`account`/`member` rows are a projection of what the identity service says: read
on login (at most once per TTL), on demand when the switcher opens, and after
every write, which goes upstream first.

- `packages/db/src/workspaces.ts` — `projectMemberships`, `projectRoster`,
  `rebindLegacyAccount`, `pickHomeAccount`, `createLocalWorkspace`,
  `humanHasCompletedOnboarding`. Three additive columns: `account.iam_account_id`,
  `account.synced_at`, `member.iam_workspace_user_id`.
- Home is the workspace the person opened LAST, in either app: the upstream
  `feature_flags.last_workspace`, which this product now also writes on every
  switch. Pre-0015 rows are rebound lazily on the owner's next login, keeping their
  id, public code and forms.
- New: create a workspace (upstream first, under the caller's own account, then
  projected), rename it, refresh the list; the switcher is always visible and is
  where "New workspace" lives.
- Members: the roster is re-projected from the upstream `users[]`; invitations,
  their email and their acceptance live upstream; removals and role changes go
  upstream first. Pending invitations are listed and can be resent.
- Roles: `OWNER` → owner, `MEMBER` holding `workspace_admin` → admin, any other →
  member — one function (`roleFromIam`) so a future `forms` permission component
  changes exactly one place.
- Onboarding is per person, not per workspace: someone who finished the wizard is
  not sent through it again for a workspace projected from upstream.
- Without `IAM_BASE_URL` (every fork, plain local dev) nothing changes: the same
  operations act on local rows only.
