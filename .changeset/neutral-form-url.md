---
'@quill/db': patch
---

The demo seed prints its form at the neutral link, `/acme/f/lead-qualifier`.

A form's public URL no longer names a member: every link the product hands out
is `/{accountCode}/f/{slug}`, and `seed()` now returns `formPath` in that same
shape, so `pnpm db:seed` and `pnpm db:reset` stop teaching the old one. The
seeded owner keeps the `alex-rivera` handle, and the old link still serves the
form.
