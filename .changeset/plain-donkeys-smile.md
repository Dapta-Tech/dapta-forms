---
'@quill/engine': minor
'@quill/shared': minor
---

Give a form two independently editable logos. `resolveFormLogos` resolves the
form's own logo (`branding.logo`) and the cover screen's (`cover.logo`) as
separate axes, where `null` means "show none" and an absent value inherits — so
clearing a logo removes it instead of falling through to the other surface's,
and a logo snapshotted from a workspace brand kit is finally visible and
editable from the Design tab. Configs written before this render unchanged.
