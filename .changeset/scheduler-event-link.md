---
'@quill/shared': patch
---

Scheduler step: pick from the list, or paste the event's link.

The event-type picker lists what the connected Calendly user owns or hosts,
and nothing else. A team round robin that user is not a host of never
appeared, and a workspace with no connection had no list at all. Two changes:

- The picker's last option is "Other event: paste its link". It takes the
  event page link, that link with Calendly's own query on it, or the whole
  inline-embed snippet; all three store the same url the picker would have.
  A link to an event the list already has picks that event instead. Without a
  connection the panel keeps its connect prompt and adds "Or paste the event
  link instead". Autofill stays at name and email for a linked event, and the
  hint says why.
- The picker now says whose list it is ("Showing the event types {email}
  owns or hosts"), and the Calendly card in Integrations says the same.
  Connecting or disconnecting a token drops the cached list at once, so a
  re-connect as another user shows that user's events immediately instead of
  after five minutes. Same for HubSpot's property list.

i18n: `admin.editor.settings.schedulerScopedTo`, `schedulerOtherEvent`,
`schedulerLink*`, `schedulerMapLinkHint`; `admin.integrations.calendlyScopeNote`
(EN + ES).
