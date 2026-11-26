---
'@quill/shared': minor
---

Playbooks: inline animations and images inside the body.

- A line of its own, `<!-- anim: <slug>/<name> | <alt> -->` (a muted loop) or
  `<!-- img: <slug>/<name> | <alt> -->` (a still), places a figure in the
  text. The alt is required and may hold a `|`; `slug` and `name` are
  `[a-z0-9-]+`. The files live in the web app under
  `/playbooks/inline/<slug>/`: `<name>.webm`, `<name>.mp4` and
  `<name>-poster.webp` for an animation, `<name>.webp` for an image.
- `parsePlaybookMediaMarker`, `playbookMediaMarker`, `playbookMediaIn`,
  `playbookMediaFiles`, `playbookMediaStill`, `stripHtmlComments` and
  `PLAYBOOK_MEDIA_BASE` from the package root; `playbookMedia` from
  `@quill/shared/playbooks`.
- `pnpm --filter @quill/shared playbooks` refuses a marker that does not
  parse, names another playbook, is indented or shares its line with text,
  and any HTML comment that never closes.
- `playbookReadingMinutes` no longer counts HTML comments, the markers
  included, as words. `GET /v1/public/playbooks` keeps the markers in `teaser`
  and `rest` exactly as written, for the landing to draw.
