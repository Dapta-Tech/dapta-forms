---
'@quill/shared': minor
---

Playbooks in Spanish and English.

- The catalog is written once per language, in `content/playbooks/es/` and
  `content/playbooks/en/`, with the same slugs. `@quill/shared/playbooks` adds
  `PLAYBOOK_LOCALES` (`es`, `en`), `PLAYBOOK_BASE_LOCALE` (`es`),
  `isPlaybookLocale`, `PLAYBOOK_CATALOG` (each language's playbooks) and
  `localizedPlaybook`, which gives a playbook in the language asked for, or
  the Spanish one with `fallback: true`. Each playbook carries its `locale`.
  `PLAYBOOKS` stays the Spanish list.
- `pnpm --filter @quill/shared playbooks` now refuses a playbook missing in
  one language or present only in a translation, a translation whose
  `category`, `publishedAt` or `promisedBy` differ from the Spanish file, inline
  media markers that do not name the same assets in the same order, a
  thumbnail in one language only, and a root-relative thumbnail outside its
  language's folder (`/playbooks/<locale>/<slug>...`).
- `playbookMediaFiles` and `playbookMediaStill` take the language: the files
  of a marker live in `/playbooks/inline/<locale>/<slug>/`.
- New `admin.playbooks.contentLanguage` and `admin.playbooks.fallback` copy, in
  both catalogs, for the ES / EN toggle of the gallery and the reader.
