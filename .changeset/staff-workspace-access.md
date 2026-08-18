---
'@quill/db': minor
'@quill/config': minor
'@quill/shared': minor
---

Type-to-find in the workspace switcher, and estate-wide access for the
deployment's staff.

- The switcher's menu has a search box (from six workspaces, or always for
  staff): typing filters your own workspaces instantly. Own workspaces list
  first; the ones you hold by access grant carry a Staff badge.
- `IAM_STAFF_DOMAINS` (comma-separated email domains; unset = nobody, every
  fork) names the deployment's staff. With the identity service configured,
  a person on one of those domains ALSO searches the whole estate, the way the
  Dapta app's sidebar does (`GET /workspace/search?query=`), and can enter any
  workspace of it. Nothing is projected by looking: entering one re-reads the
  workspace upstream, projects it (no onboarding stamp, no demo form, no signup
  event) and mints an `admin` row marked `member.access_grant = 'staff'`.
- Migration 0016: `member.access_grant` (nullable). Grant rows are excluded
  from rosters and member counts (a customer's team list never shows staff),
  never send the wizard to the staff member, are never pruned by the
  membership projection, and turn into a real membership the moment upstream
  names the person. "First member" (demo form, signup) counts real memberships
  only, so an account a grant created ahead of its owner still welcomes the
  owner.
- API: `GET /v1/workspaces/search?q=&page=`, `POST
  /v1/workspaces/estate/:workspaceId/enter`; `/v1/me` carries `staff` and
  `accessGrant`.
