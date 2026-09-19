---
'@quill/web': patch
---

Forms with a Meta Pixel configured now fire a Lead conversion event when a submission completes, not only a PageView on load.

A PageView tells Meta who looked at the form, so a campaign optimizing on it
optimizes for visits. The conversion signal was missing because the thank-you
screen is not a page load: the public form is one document changing phase, so
no pixel notices it on its own.

- **When**: on the successful submit, after the server confirms it. Abandoning
  part-way through reports nothing, and a submit that failed and will be retried
  is not a conversion either.
- **Once per session**: the mark lives in `sessionStorage` beside the form's
  session id, so a double click and a re-submit after a reload both stay at one
  event.
- **Before a redirect**: an ending that redirects with no delay used to be able
  to cancel the pixel's request as the page left. The event now goes out ahead
  of the submit event the renderer already waits for, so it leaves in time with
  no delay added to the redirect.
- **Google Tag Manager**: the same conversion is pushed to `dataLayer` as
  `form_lead`, for forms tracked through a container instead of a bare pixel.
  The push is skipped when no container is configured.
- Both public layouts, one question per screen and the single-page form, behave
  identically. A form with neither a pixel nor a container makes no request at
  all, exactly as before.
