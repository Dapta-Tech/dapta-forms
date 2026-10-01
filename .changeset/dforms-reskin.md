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
- **Icons**: the admin draws its icons from a generated `icons.css` (built from
  `lucide-static` by `pnpm --filter @quill/web icons`) instead of `primeicons`.
  Class names are unchanged.
- **QR codes**: on the Dapta brand the code carries the dForms mark in its
  centre, at error correction level H so it still scans.
- The fallback wordmark on a public form no longer appends a period to the
  form's name.
- i18n: `admin.forms.col*`, `admin.forms.status*`, `admin.forms.noCompletion`
  (EN + ES).
