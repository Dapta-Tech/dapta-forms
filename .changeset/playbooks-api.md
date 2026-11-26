---
'@quill/shared': minor
'@quill/db': minor
---

Playbooks: a catalog of free resources for the in-app gallery and the landing's resource hub, with per-person reading state.

- `@quill/shared/playbooks` (a new subpath, kept out of the package root so the
  bodies never reach a client bundle): `PLAYBOOKS`, `PLAYBOOK_CATEGORIES`
  (`ventas`, `marketing`, `ads`, `agentes`), `publishedPlaybooks`,
  `findPlaybook`, `playbookBody`, `isPlaybookNew`, `isPlaybookPromised`. Each
  playbook is a markdown file in `content/playbooks/` with its front matter
  (`slug`, `category`, `title`, `summary`, `publishedAt`, `promisedBy`,
  `template`, optional `thumbnailVideo`, `thumbnailPoster`, `thumbnailMotif`)
  and a `<!-- muro -->` line between the public preview and the rest.
  `pnpm --filter @quill/shared playbooks` turns them into
  `src/playbooks.generated.ts`; a spec fails when the two disagree.
- `@quill/db`: migration 0035 adds `playbook_state` (person key, slug, first
  and last open), with `listPlaybookStates`, `recordPlaybookSeen` and the
  reserved `PLAYBOOK_GALLERY_SLUG` for the gallery visit. Keyed by the person,
  like the announcements (ADR 0006).
- The API serves `GET /v1/me/playbooks` (with `?category=`),
  `GET /v1/me/playbooks/:slug`, `POST /v1/me/playbooks/:slug/seen` and
  `POST /v1/me/playbooks/seen` to signed-in people only, and
  `GET /v1/public/playbooks` (previews, and the whole body of a promised
  playbook) without auth. Opening a playbook captures `forms_playbook_viewed`.
