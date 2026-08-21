---
'@quill/engine': minor
'@quill/types': minor
'@quill/db': minor
---

A form's public link can be renamed, and the old link keeps working.

The third segment of a form's URL (`/{accountCode}/{handle}/{slug}`) was
written once, derived from the form's name at creation, with nothing in the
product to change it. It is editable now, from a pencil beside Copy link in the
builder's topbar: the one place that already shows the URL is where people go to
change it.

Renaming does not break what is already published. The previous slug is retired
into a new `form_alias` ledger rather than dropped, so a QR code on a printed
flyer, a campaign email already sent, an iframe embedded on someone else's site
and a CRM property holding the old URL all keep resolving. The public page then
redirects the retired slug to the canonical one with a 308, forwarding the query
string untouched so campaign parameters, `?embed=1` and `?step=N` survive the
hop. One address, one set of analytics, one thing to index.

Details worth knowing:

- `PUT /v1/forms/{id}/slug` is the new endpoint. 409 `SLUG_TAKEN` when another
  form in the account holds the slug (as its current one OR as one it retired),
  409 `SLUG_INVALID` on shape. Any member of the account may call it, the same
  gate as editing the form.
- A `slug` sent to `PUT /v1/forms/{id}` now renames through the same path, so
  the field that predates this feature retires the old value too instead of
  silently discarding it.
- New form slugs skip values another form retired. Handing one out would let a
  new form quietly inherit somebody else's already-published traffic.
- A rename follows into `profile.formSlugs`, the by-slug selection on member
  public pages. Without that the form would drop off those pages silently, since
  they filter on the canonical slug.
- Deleting a form releases the slugs it retired.
