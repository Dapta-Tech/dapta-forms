---
'@quill/db': minor
'@quill/types': minor
'@quill/shared': minor
---

Folders and keyboard search on the forms list.

A workspace with more than a screenful of forms had one flat list and no
way to find or group anything. The forms page is now one list grouped by
folder, searchable from the keyboard.

- **Folders** (`form_folder`, migration 0021): flat, one level, named only,
  unique per workspace without regard to case, alphabetical. A form is filed
  in at most one (`form.folder_id`, null = unfiled, which every existing form
  is). Deleting a folder unfiles its forms and never deletes them. Any active
  member may organise forms, the same rule as creating them.
- **API**: `GET/POST /v1/folders`, `PATCH/DELETE /v1/folders/:id` (409
  `NAME_TAKEN`, idempotent delete), `PATCH /v1/forms/:id/folder` (`{ folderId
  | null }`), `POST /v1/forms` accepts `folderId`, duplicating keeps the
  folder, `GET /v1/forms` returns `folderId`. Moving never touches
  `updated_at`.
- **List**: "Unfiled" first, then each folder as a collapsible section (the
  fold is remembered per browser) with its count, a "New form" that creates
  straight into it, and Rename / Delete behind a kebab. Rows drag onto a
  section by their grip; the row kebab's "Move to folder" is the keyboard
  route to the same move. Without folders the list looks exactly as before,
  and every row keeps its test ids.
- **Search**: a search box over the loaded list, focused with Ctrl/Cmd+K or
  `/` (outside inputs), matching name or link without case or accents,
  highlighting the hit, hiding sections without one, Escape clears, arrows
  walk the rows and Enter opens the editor.
- `@quill/types`: `folderInputSchema`, `folderViewSchema`,
  `formFolderPatchSchema`, `formCreateInputSchema`, `formViewSchema.folderId`.
  `@quill/db`: `NAME_TAKEN` on `CrudResult`, `folders.ts`.
- i18n: `admin.forms.search*`, `admin.forms.*folder*`, `dialog.deleteFolderTitle` (EN + ES).
