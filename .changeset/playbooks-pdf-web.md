---
'@quill/web': minor
---

Playbooks can be downloaded as a PDF, in Spanish and in English.

- The reader has a "Download PDF" button for the language being read. Every playbook ships its PDF with the app (`/playbooks/pdf/<locale>/<slug>.pdf`), with the whole text and the stills of its animations.
- `pnpm --filter @quill/web playbook-pdfs` prints them; a check fails when one is missing, out of date or over 1.5 MB.
- Opening a playbook with `?pdf=1` starts the download once, takes the parameter out of the address and leaves a notice with a large button for the browsers that block it.
- The return path (`?next=`) also accepts `?pdf=1`, `?lang=es&pdf=1` and `?lang=en&pdf=1`, on one playbook page only. Every other query is still refused as a whole. The value of `next` must be percent-encoded.
- A new event, `forms_playbook_pdf_downloaded`, says which playbook and language, and whether the button or the address started it.
