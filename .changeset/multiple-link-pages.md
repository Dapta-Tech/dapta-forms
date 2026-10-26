---
'@quill/types': minor
'@quill/db': minor
'@quill/shared': minor
'@quill/mcp': minor
---

A workspace can keep several link pages, up to 20 (one per trade fair, one for the Instagram bio, one per country). The default page keeps answering at `/{accountCode}`; every other page answers at `/{accountCode}/p/{slug}`.

- `@quill/db`: a new `link_page` table and a `link_page_alias` ledger (migration `0027_link_pages`, both dialects, additive). The migration copies every existing `account.link_page` into a default page with the slug `main` and the exact same content, so every existing page keeps its address and what it shows. `account.link_page` stays readable as a fallback for one release and is kept in step with the default page. Exactly one default page per workspace (a partial unique index), slugs unique per workspace, at most 20 pages, the default page cannot be deleted, and a renamed slug keeps redirecting to the new one.
- `@quill/types`: `linkPageSlugSchema` (the vanity slug rules and reserved words), the create, update and duplicate bodies, `LinkPageSummary`, `LINK_PAGE_MAX_PAGES`, and an optional `colors` field on a page (its own primary, background and text colours over the brand kit; absent keeps the kit's). `PublicLinkPage` gains `pageSlug` and `isDefault`.
- `@quill/shared`: `linkPageUrl()` takes the page, the API reference documents `/v1/link-pages`, and the catalog gains the page list and the editor's name, address and colour fields, in English and Spanish.
- `@quill/mcp`: `list_link_pages`, `create_link_page`, `duplicate_link_page` and `delete_link_page`; `get_link_page` and `update_link_page` take an optional `page_id` (the default page when absent, as before) and `update_link_page` can rename a page, change its slug or make it the default.
