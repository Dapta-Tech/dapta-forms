---
'@quill/types': minor
'@quill/db': minor
'@quill/shared': minor
---

Build the public member page the handle URL always promised.

`/[accountCode]/[handle]` has existed in the routing shape since the first
public form link, but nothing was ever built at that level — only
`[handle]/[slug]` — so trimming a form link back to see "who is this" hit a real
404. It was never broken; it was never written.

`memberProfileSchema` is the contract (versioned like the form config, extended
the same way: add optional fields, never repurpose one), stored as one JSON blob
on a new nullable `member.profile` column. One column rather than a
bio/links/design column each, matching the `form.config` pattern — which is
exactly why this is the only schema change in the whole branch.

**Nothing is published by default.** The column defaults to NULL and `enabled`
defaults to false, and the endpoint returns 404 for a missing member, a missing
profile and a disabled one alike. A migration that quietly published a page
about every member would be the wrong default in every sense.

`formSlugs` absent lists every published form; `formSlugs: []` lists none, and
the two are deliberately different — an author who unlists everything must not
get everything back. Only a form's name and slug cross the boundary: no steps,
no destination config, no drafts.

The page reuses `resolveDesign` and the public stylesheet rather than inventing
a second set of colours and typefaces, so a profile and the forms it links to
can be made to match. Handles match case-insensitively, since a handle URL gets
typed by hand far more often than a slug does.

Migration `0008_member_profile` in both dialects. Additive and nullable: old
code ignores the column entirely, so deploy order does not matter and a rollback
needs no down-migration.
