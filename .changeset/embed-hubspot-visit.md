---
'@quill/types': minor
'@quill/db': minor
'@quill/destinations': minor
'@quill/shared': minor
---

Record the page a form is answered on, and pass the landing's HubSpot visit along with it.

An embedded form used to reach HubSpot without the visitor's tracking cookie
(`hubspotutk`) and without the page it sat on, so the contact lost its original
source and its earlier page views; it even lost the landing's UTM parameters,
since the iframe only reads its own fixed `src`. The host page's `embed.js` can
read all of that, and now answers when the form asks for it: at mount, and again
right before each partial and complete submit, so the cookie is the one current
at that moment. A bare iframe, or an old cached script, costs the submit at most
150 ms and saves with the referrer as the page; a page that sets
`data-dapta-forms-context="off"` on the iframe passes nothing. The script reads
cookies and never writes one, leaves the cookie out when the visitor opted out of
HubSpot tracking, and answers only our frames, at the origin of their `src`.

On a direct link the page is the form's own URL without its prefill parameters,
and the form's own `hubspotutk` goes along when the form loads its own HubSpot
tracking ID.

- `@quill/types`: `submissionSchema.visit`, a tolerant `submissionVisitSchema`
  (every field is checked on its own and dropped when it fails; a malformed visit
  never refuses a submission), `parseSubmissionVisit`, and the dashboard's safe
  view, `submissionVisitViewSchema` / `toSubmissionVisitView`, which carries a
  "HubSpot visitor linked" flag and never the cookie. `submissionViewSchema`
  gains `visit`.
- `@quill/db`: migration 0023 adds the nullable `submission.visit` column in both
  dialects. `upsertSubmission` stores it with COALESCE, so a later save without a
  visit keeps the one already stored, and returns the merged row. The dashboard
  read side maps it to the safe view.
- `@quill/destinations`: `DestinationContext.visit`, and `formTitle`, the public
  title that names a page which reported none. The HubSpot mirror submission
  sends `hutk`, `pageUri`, `pageName` and `pageId` as its context, leaves out any
  empty key, and after a 400 retries once with the context it always sent; the
  Note names the page, the delivery detail says `+visit`, the cookie never
  reaches a log, and a cookie from another portal is reported. The webhook
  envelope gains a top-level `visit` (`pageUri`, `pageName`, `embedded`, and
  `hutk` when there is one), covered by the signature; the delivery history shows
  that body with the cookie hidden. Without a visit, both send exactly what they
  sent before.
- `@quill/shared`: the Page row, the HubSpot chip and the CSV's Page URL column,
  and the embed, HubSpot and tracking ID help, in English and Spanish.
