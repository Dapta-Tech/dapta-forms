---
'@quill/web': patch
---

A second registration in the same browser tab is now a response of its own.

The public form kept its session id in the tab's `sessionStorage`, and the
server keeps one response per session: a complete that lands on a response
already completed is treated as a retry and delivers nothing. So when someone
finished the form, reloaded the tab and registered again (a second person at a
shared computer, or anyone testing their form), the second answers overwrote
the first response and no webhook, CRM delivery or email left for them.

Both layouts now release the stored session id once the server confirms a
complete. The page that just submitted keeps its id for the steps that follow
(the `submit` event, a booking after the submit), and the next load of the form
in that tab starts a new response. A complete that was not confirmed keeps the
session, so a retry is still one response.
