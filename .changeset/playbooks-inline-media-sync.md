---
'@quill/shared': patch
---

Playbooks: the nine playbooks now place their animations and images inline
(41 `anim` and `img` markers), and the catalog build reads comments more
strictly.

- `pnpm --filter @quill/shared playbooks` reads what follows the close of a
  multi-line HTML comment with the same rules as a whole line (a marker there
  must be valid, a comment opened there must close), and refuses a comment
  that wraps the `<!-- muro -->` line.
- `playbookOutline` leaves out the `## ` headings inside an HTML comment, on
  one line or several, as the reader does.
