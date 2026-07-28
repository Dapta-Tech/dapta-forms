---
'@quill/types': minor
'@quill/db': minor
'@quill/shared': minor
---

Workspace brand kit: one place to define the account's look, snapshotted into
forms.

`brandKitSchema` (types) is the identity subset of a form's branding — logo,
client logos, the three colors, typography, radius, button style — with
`BRAND_KIT_FIELDS` as the single source of truth for what an apply overwrites.
The kit is stored per account in the new additive `account_branding` table
(migration 0009, both dialects), and forms snapshot it: new forms merge it into
their initial config, and `applyBrandKit` merges only the kit-managed fields
into each selected form's live config AND a pending draft (so publishing can't
silently undo the brand), backing up the previous branding in the new
`form.brand_backup` column so `revertBrandKit` is an exact one-level undo.
Nothing resolves live at render — the engine and public renderer are untouched.
