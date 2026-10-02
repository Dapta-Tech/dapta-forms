---
'@quill/db': minor
'@quill/shared': minor
'@quill/engine': minor
'@quill/notifications': patch
'@quill/destinations': patch
---

The dForms look: the admin, the editor and the forms list wear the new brand, and the forms list reports each form's publish state.

- **Tokens** (`@quill/shared`): `tokens.css` is rewritten around paper, ink and
  Signal Green (`--signal`), with `--score` for points, `--warning` for work
  that is not live yet, and `--panel` / `--sidebar` as work surfaces. Light and
  dark are both defined. This is the look of the admin; a public form does not
  read it for its base colours (see "Existing forms" below).
- **Existing forms do not change.** A form published before the rebrand stored
  no colours, and an absent colour keeps meaning what it always meant: the dark
  ground, Signal White text and Program Lime accent, with Figtree. `DEFAULT_ACCENT`
  and `DEFAULT_CANVAS` in `@quill/shared` keep their old values, an unbranded
  public form is still pinned dark, and `public-form.css` owns the dark palette
  a form's own colours are drawn over instead of following the app's new tokens.
  The `legacy-markup` snapshots confirm it: the only differences in the rendered
  markup are the attribution text and the full stop below.
- **New forms are born with the dForms look** (`@quill/engine`):
  `withNewFormBranding` writes a white ground, ink text and Signal Green into the
  config of a form created from nothing (the dashboard and `POST /v1/forms`, and
  the onboarding wizard), filling only what the caller left out. A copy of a form
  keeps its original's look. The editor shows the dForms preset card as selected.
- The first-run wizard is a `.pf` surface that is the product's own screen, not
  a customer's form, so it wears the dForms colours (white, ink, Signal Green)
  written inline on its root instead of the dark ground a public form now owns.
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
- The fallback wordmark on a public form (a form with no logo) no longer appends
  a full stop to the form's name, for every form: on someone else's form it read
  as a typo in their title.
- **No monospaced face**: the admin no longer loads a monospaced font or uses
  `font-mono`; URLs, keys, hex values and code samples are set in the sans.
- **Name**: the product reads dForms everywhere a person sees it: invitation
  emails, the webhook note, the onboarding logo, the HubSpot mirror form's
  suffix ("<form> (dForms)", renamed in place the next time a form's mirror
  syncs) and the page title. A build is Dapta's own when
  `NEXT_PUBLIC_PRODUCT_NAME` is `dForms` or the old `Dapta Forms`, and shows
  `dForms` either way.
- **Home**: the shortcuts no longer float in a column beside the list. The two
  that repeated the rail (Integrations, Analytics) are gone, and the two that
  lead somewhere the rail does not (Brand kit, Public page) form one band under
  the list, the width of the figures above it.
- **Account settings**: a two-line statement header like Home's, and every
  screen without nested cards. A workspace opens with its tile, name, a Current
  chip and its id, then its name and timezone side by side, its tabs with Add
  member on the same row, and flat tables. Brand kit lays its settings out as
  rows (what it is on the left, the control on the right) with the three
  colours as swatches, the preview in a grey well and "Apply to existing forms"
  beside them; the preview shows how a NEW form would look (white, ink and
  Signal Green for what the kit leaves out). Notifications keeps both emails on
  the page and puts the live preview beside the fields from `xl`. Public page
  and Preferences use the same rows. No control, `data-testid` or heading the
  e2e specs read was removed. The Members and Invitations tables no longer make
  the page scroll sideways on a narrow screen.
- **Email preview as an inbox**: the email preview, on Account settings and on a
  form's Connect tab, has an expand button that opens a mock of an inbox: the
  subject under its label, the sender, and the message on the grey page an HTML
  email draws itself on, with the answers as the two-column table the real email
  carries. It follows what you type. It draws no third-party logo and says it is
  a mock.
- **Icons**: the admin draws its icons from a generated `icons.css` (built from
  `lucide-static` by `pnpm --filter @quill/web icons`) instead of `primeicons`.
  Class names are unchanged.
- **QR codes**: on the Dapta brand the code carries the dForms mark in its
  centre, at error correction level H so it still scans.
- The attribution pill under a public form reads "Made with dForms", and the
  sign-up line on the thank-you screen "Get dForms, free".
- i18n: `admin.forms.col*`, `admin.forms.status*`, `admin.forms.noCompletion`,
  `admin.submissions.selectMode`, `admin.submissions.selectModeDone`,
  `admin.submissions.filters.searchResponses*`, `admin.submissions.filters.searchChip`,
  `admin.brandKit.notSetShort`, `admin.notifications.previewExpand`,
  `admin.notifications.previewMock.*` (EN + ES). `admin.home.integrations*` and
  `admin.home.analytics*` are removed; `admin.account.subtitle` and
  `admin.brandKit.subtitle` are shorter.
