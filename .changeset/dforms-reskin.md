---
'@quill/db': minor
'@quill/shared': minor
'@quill/engine': minor
---

The dForms look: the admin, the editor and the forms list wear the new brand, and the forms list reports each form's publish state.

- **Tokens** (`@quill/shared`): `tokens.css` is rewritten around paper, ink and
  Signal Green (`--signal`), with `--score` for points, `--warning` for work
  that is not live yet, and `--panel` / `--sidebar` as work surfaces. Light and
  dark are both defined. `DEFAULT_ACCENT` is now `#3ddc84`, and the default
  canvas a form renders on when its author chose none is white with ink text.
- **Theme presets** (`@quill/engine`): a `dforms` preset leads the list. The
  `control-room` preset keeps its id, so a form that stored it still shows its
  card as selected.
- **Forms list** (`@quill/db`): `listForms` returns `hasDraft`, true while a
  form holds unpublished changes. It is computed in SQL from
  `draft_config IS NOT NULL`, so the draft itself is never read. `GET /v1/forms`
  documents the field, and the list shows it as a Published or Unpublished
  changes chip beside each form's submissions and completion figures.
- **Editor**: one top bar with Build, Logic, Design and Connect as tabs, the
  unpublished chip beside the name, compact question rows with their points, a
  flat settings panel, a narrow Design panel beside a larger preview, and
  Connect in two columns. No control was removed.
- **Submissions and Analytics**: one header for a form's screens ("Forms / the
  form's name" with its publish state, then Edit, Submissions, Analytics and
  Integrations as tabs), with each screen's own controls on its right: the
  workspace timezone and the CSV export on Submissions, the date range on
  Analytics. The table draws a sheet's grid and keeps its checkboxes away
  until Select is pressed, its selection bar floats over the foot of the page, a
  response reads as a flat list of questions and details, the Summary lays its
  cards out in two columns, and Analytics shows its figures as one band above
  Trends and then the drop-off list, both drawn in Signal Green. No control
  was removed.
- **Search in the submissions table** (`@quill/db`): `SubmissionFilter` takes
  `search`, a case-insensitive substring looked for in the form's written
  answers (text, contact and URL questions; a name by its first and last name
  together). It is one more filter, so the table, the CSV export, the Summary
  and its answer search all follow it. The API reads it as `?search=` on those
  routes; the page keeps it in its own URL, shows it as a chip, and offers it
  as a box in the header of the Submissions screen and in the bar of the
  full-screen sheet. Accents are not folded.
- **Summary**: every text card opens with its latest answers and "Show more",
  the contact questions (name, email, phone) included; they used to show a
  search box and nothing else. The panel a card opens has the Delete button
  the table's panel has, and deleting there refreshes the cards.
- **Icons**: the admin draws its icons from a generated `icons.css` (built from
  `lucide-static` by `pnpm --filter @quill/web icons`) instead of `primeicons`.
  Class names are unchanged.
- **QR codes**: on the Dapta brand the code carries the dForms mark in its
  centre, at error correction level H so it still scans.
- The fallback wordmark on a public form no longer appends a period to the
  form's name.
- The attribution pill under a public form reads "Made with dForms", and the
  sign-up line on the thank-you screen "Get dForms, free".
- i18n: `admin.forms.col*`, `admin.forms.status*`, `admin.forms.noCompletion`,
  `admin.submissions.selectMode`, `admin.submissions.selectModeDone`,
  `admin.submissions.filters.searchResponses*`, `admin.submissions.filters.searchChip`
  (EN + ES).
