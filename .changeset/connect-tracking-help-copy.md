---
'@quill/shared': patch
---

Connect's tracking help text now says when each event actually fires.

The Meta Pixel field read "Fires a PageView on your Meta pixel to measure
campaigns", which left the obvious question unanswered: is that the initial
page load or the thank-you page? There is nothing to configure, because there
are two events and the sentence named one of them. Since the pixel started
firing a Lead on completion, the sentence was not merely incomplete, it was
wrong.

It now names both: a PageView when the form loads, and a Lead when someone
completes it.

The GTM field had the same gap two centimetres away. It described loading the
container but never mentioned the form_lead event pushed to the dataLayer on
completion, which is the event anyone using GTM instead of the raw pixel would
want to build a trigger on.
