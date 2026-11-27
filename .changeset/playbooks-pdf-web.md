---
'@quill/web': minor
---

Playbooks can be downloaded as a PDF, in Spanish and in English, by someone signed in.

- The reader has a "Download PDF" button for the language being read. The files carry the whole text and the stills of the animations.
- `GET /api/playbooks/<slug>/pdf?lang=es|en` is the only way to a file: it asks for a session and a published playbook, answers an attachment that is neither cached nor indexed, and sends someone signed out to sign in and back.
- `pnpm --filter @quill/web playbook-pdfs` prints them; a check fails when one is missing, out of date, over 1.5 MB or embeds a font that is not in the repository.
- Opening a playbook with `?pdf=1` starts the download once, takes the parameter out of the address and leaves a notice with a large button for the browsers that block it.
- The return path (`?next=`) also accepts `?pdf=1`, `?lang=es&pdf=1` and `?lang=en&pdf=1`, on one playbook page only. Every other query is still refused as a whole. The value of `next` must be percent-encoded.
- A playbook link opened with an expired or missing session comes back to the playbook after the sign-in. Every other dashboard page lands where it did.
- A new event, `forms_playbook_pdf_downloaded`, says which playbook and language, and whether the button or the address started it.
