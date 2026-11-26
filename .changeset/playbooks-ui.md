---
'@quill/shared': minor
---

Playbooks in the app: the copy of the gallery and its reader, and the thumbnails of the catalog.

- `admin.playbooks` in both locales (title, tabs, card states, reader) and
  `admin.chrome.nav.playbooks` for the new rail item.
- `AnnouncementRailItem` now also takes `playbooks`, so the rail's "New" badge
  can mark the gallery while a person has playbooks they have not seen.
- The nine playbooks point `thumbnailVideo` and `thumbnailPoster` at their
  loops under `/playbooks/` in the web app.
