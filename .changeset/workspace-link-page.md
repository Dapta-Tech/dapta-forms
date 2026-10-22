---
'@quill/types': minor
'@quill/db': minor
'@quill/shared': minor
---

Add the workspace link page: one public page per workspace at
`/{accountCode}`, with the workspace's logo, name and bio, an ordered column of
buttons that mixes the forms the team chose with custom links, and a row of
social icons (Instagram, X, YouTube, TikTok, WhatsApp).

`linkPageSchema` is the contract, versioned like the form config. Socials are
normalized on the way in: a handle or a link without its scheme becomes an
`https://` link on that network's own hosts (handles follow each network's
rules, so `@your.brand` works on Instagram and TikTok). A WhatsApp number must
be entered with its country code (`+` or `00`), is stored as digits and opens
as a `wa.me` click-to-chat link; `parseStoredLinkPage` and `linkPageToInput`
read a stored page back. `LINK_PAGE_MAX_BODY_BYTES` is the body ceiling the
save route accepts, above the largest page the schema allows. A form
button points at the form by id, so renaming its link never drops it, and a
deleted form drops out of the page instead of leaving a broken button.
`resolveLinkPage` decides what the page shows, for the public page and the
editor's preview alike. The brand kit styles the page live, on top of the
colours a new form is born with.

Stored as one JSON blob on a new nullable `account.link_page` column (migration
`0025_workspace_link_page`, both dialects). Additive: nothing is published by
the migration, and the page answers 404 until someone in the workspace turns it
on.

The catalog gains the page's public strings (`linkPage`) and its editor
(`admin.linkPage`), in English and Spanish.
