---
'@quill/api': minor
'@quill/web': minor
---

Several link pages per workspace.

- `@quill/api`: `GET/POST /v1/link-pages`, `GET/PUT/DELETE /v1/link-pages/:id` and `POST /v1/link-pages/:id/duplicate`, open to API keys and to any member. `GET/PUT /v1/link-page` keep working on the default page. The public API serves `GET /v1/public/pages/:code/:slug` and `POST /v1/public/pages/:code/:slug/events`, and every link page capture now carries `page_slug` and `page_id`.
- `@quill/web`: Account settings, Public page, is now the list of the workspace's pages (published or not, buttons, last edit, edit, duplicate, copy link, QR, make main page, delete, and a new page form), and each page opens the editor it always had, plus its internal name, its address and its own colours. Extra pages render at `/{accountCode}/p/{slug}` with their own share card; a renamed slug and the default page's slug redirect to the right address.
