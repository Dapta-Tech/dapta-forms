---
'@quill/shared': minor
---

Settings moved behind the profile button, and became Account settings.

The rail is Home · Forms · Submissions · Analytics · Integrations. Bottom-left
sits a profile button (avatar, name, email) whose menu lists the account
entries under an "Account settings" eyebrow (Workspaces · Brand kit ·
Notifications · Public page) and Log out, the way the Dapta app's admin panel
does it. `/admin/account` is the area behind it, with the same four entries as
a sub-nav:

- **Workspaces**: every workspace the person belongs to, as cards (role,
  active member count, Current / Invited badges) with Open (switch into it),
  Manage (members and invitations of THAT workspace, without switching; hidden
  on an invitation, which is accepted by opening) and New workspace. Managing
  a workspace by id sends the API a per-call workspace header instead of the
  cookie; every action carries the id explicitly.
- **Workspace detail**: rename, Members table (role change, Activate /
  Deactivate, Remove for owners; admins may retract invitations) and
  Invitations table (pending invitations from the identity service with
  Resend, plus locally invited members), invite dialog.
- **Brand kit**, **Notifications**, **Public page** (with the person's identity
  fields) moved from `/admin/branding` and `/admin/settings`; both old URLs
  redirect. Brand kit and Notifications name the workspace they act on.
- i18n: `admin.chrome.profileMenu.*`, `admin.account.*` (EN + ES);
  `admin.chrome.nav.branding/settings`, `admin.chrome.signOut/viewPublic`,
  `admin.settings.appearance*` and the orphaned settings headings are gone.
