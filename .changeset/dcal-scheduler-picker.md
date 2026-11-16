---
"@quill/web": minor
---

Pick a dCal event type in the builder, without connecting anything. The author's
own session is the credential, so the panel lists the event types they can
already see in dCal, in any workspace they can act in, with a switcher when they
have more than one.

An author with no event type yet is not misconfigured, so the empty state offers
the two things they might do about it: switch workspace, shown only when they
actually have another one, and create one in dCal, which opens in a new tab so a
half-built form is not navigated away from. The refresh beside it asks the server
to drop its cached list, because five minutes is exactly the window someone who
just created an event would be pressing it in.

Switching provider clears the picked event and its field mapping: the URL, the
event id and the mapping keys all belong to the provider that was chosen before,
and keeping any of them would point one provider's render at the other's page.
The embed's "show event details" switch is not offered for dCal, which has no
such parameter.
