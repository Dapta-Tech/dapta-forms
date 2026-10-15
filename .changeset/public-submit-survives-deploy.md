---
'@quill/web': patch
---

A form opened before a deploy can now be finished after it, and a reload mid-form keeps the answers.

The public form used to reach its server through Server Actions, which the browser calls by an id compiled into each build. A deploy ships new ids, so a person who opened the form before it could not submit: the request in flight hit the old pod (504) and every "Try again" hit the new one with an id it did not know (404). The answers never landed.

- Submit (partial and complete), funnel events, the booking record and the upload authorization now go to one same-origin route whose address is the same in every build: `POST /api/public/forms/:accountCode/:slug/:op`, with `op` one of `submissions`, `events`, `booking`, `uploads`. It relays to the public API exactly as the actions did, the visitor's `X-Forwarded-For` included, and answers every verdict with a 200; a gateway error or an unreachable API is never mistaken for one.
- Unchanged guarantees: the submit retries only on a transport failure and stays one response per session (the API's unique index); the booking record still goes in a single attempt, because it is not idempotent.
- Both layouts (slides and one page) and embeds use it; the builder preview's network fence blocks it like any other same-origin write.
- The answers in progress are kept in the tab's `sessionStorage` next to the session id. A reload brings them back (slides also return to the question the person was on) and finishes as the same response; the copy is dropped once the server confirms the complete. The builder preview neither keeps nor restores one.
- The lint rule that forces `callAction` around server actions now covers these calls too, and a test fails if anything the public renderers import is a Server Action module.
