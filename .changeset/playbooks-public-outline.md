---
'@quill/shared': minor
---

Playbooks: `playbookOutline` (the `## ` headings of the rest, skipping code blocks), `playbookReadingMinutes` (the whole body at `PLAYBOOK_WORDS_PER_MINUTE`, 200, rounded up) and `playbookPublishedDate` (the publication day in Bogota, `YYYY-MM-DD`).

`GET /v1/public/playbooks` now answers in the shape the landing's resource hub reads: `teaser` (was `preview`), `publishedAt` as `YYYY-MM-DD`, plus `outline` and `readingMinutes` for every playbook. `rest`, `thumbnailVideo` and `thumbnailPoster` are left out when absent instead of sent as null, so the rest of a playbook no guide promises never travels, not even as a key.
