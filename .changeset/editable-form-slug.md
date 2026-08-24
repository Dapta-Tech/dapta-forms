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
sends the visitor on to the canonical URL, forwarding the query string untouched
so campaign parameters, `?embed=1` and `?step=N` survive the hop.

That redirect resolves in the browser rather than as a redirect status: Next 16
has already begun streaming by the time the page resolves the form, so the
response is a 200 carrying a client-side redirect. Alongside it the page emits
`<link rel="canonical">` naming the current URL, which is what a crawler, a link
checker or a social unfurler reads. A retired slug therefore still points
everything at one address, but non-browser clients learn it from the tag, not
from a status code.

Details worth knowing:

- `PUT /v1/forms/{id}/slug` is the new endpoint. 409 `SLUG_TAKEN` when another
  form in the account holds the slug (as its current one OR as one it retired),
  409 `SLUG_INVALID` on shape. Any member of the account may call it, the same
  gate as editing the form.
- A `slug` sent to `PUT /v1/forms/{id}` now renames through the same path, so
  the field that predates this feature retires the old value too instead of
  silently discarding it. Its own contract is unchanged: it still slugifies what
  it is given rather than rejecting it, and it now applies before the rest of
  the request so a refused slug leaves the form untouched.
- New form slugs skip values another form retired. Handing one out would let a
  new form quietly inherit somebody else's already-published traffic.
- Member public pages list forms by slug (`profile.formSlugs`). They now match a
  form's retired slugs too, so a rename cannot drop a form off a page that
  listed it, and pages saved before this heal themselves.
- Deleting a form releases the slugs it retired.
