---
'@quill/types': patch
'@quill/shared': patch
---

Build and maintain the HubSpot mirror form when the integration is saved.

`hubspotDestinationSchema.settings` gains two more optional fields beside
`formGuid`: `formActivity`, the author's switch, and `formSignature`, what the
mirror was last built from.

They are separate on purpose. Turning the switch off STOPS posting; it does not
delete the form, whose past submissions are activities on real contacts —
deleting it to represent "off" would erase history nobody asked to lose, and
turning it back on reuses the same form rather than orphaning them. The
signature exists because the Connect tab autosaves: without it, every keystroke
would rebuild a form in the customer's portal. It covers the mapped properties
AND the form's name, since the name is what labels the activity, and a renamed
form whose mirror still carries the old title is the confusion this feature
exists to remove.

Adds `admin.integrations.formActivity*` to the message catalog in both locales,
including the line shown when HubSpot refuses — a missing scope has to say so
where the author turned the switch on, not in a log.
