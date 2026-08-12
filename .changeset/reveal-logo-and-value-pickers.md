---
'@quill/shared': minor
---

Put the brand on the reveal screen, and stop making people retype HubSpot values
by hand.

**The reveal screen shows the form's logo.** It was the last of three blockers
named for migrating the live forms over (the top banner and the cover logo landed
already). The logo comes from `branding.logo` — the FORM's logo, not the cover's;
the reveal is a phase inside the form, not its front door. Both renderers show it,
and so does the `submitting` screen they draw inline, so it does not blink out at
the moment of submission. The builder canvas draws its own reveal, so it shows the
logo too — a preview that disagrees with the published form is the bug, not a
follow-up.

`FormLogo` gained `fallback="none"` for this. Its text fallback prints the FORM
NAME, which is the author's internal name; a respondent must never be shown
"Q3 paid-ads lead gen v2" because an image 404'd. A form with no logo renders
byte-identically to before.

**The HubSpot property picker now carries each property's allowed values**, and
two places that made you type an internal value exactly — static properties, and
the right-hand side of a value map — became dropdowns.

- Values ride along only for enumeration properties; the key is omitted, not
  empty, so the response doesn't gain ~400 empty arrays. Options HubSpot marks
  `hidden` are dropped: it hides them from its own pickers, so offering one lets
  you configure a write HubSpot then rejects.
- Their order is HubSpot's own and is never re-sorted — a picklist's order carries
  meaning (stages, seniority, sizes). Properties themselves stay sorted by label.
- A value map is keyed by QUESTION, and a question can be mapped to several
  properties. The offered values are the **intersection** of those properties',
  not the union: the adapter writes one translated value to all of them, so a
  value only one accepts is a guaranteed half-written contact. A hint under the
  header names the targets, so a text box on a fanned-out question reads as a
  reason rather than a broken picker.
- A stored value the list doesn't contain opens in text mode showing that value.
  In a dropdown it would render as an empty box — still configured, still saved,
  and looking unset.
- Nothing constrains the value (no mapping, a text property, a portal without the
  picker configured)? The same free-text input as before. No config shape changed.

**Value-map groups collapse**, showing the question and how many translations are
inside. A fifty-value industry map turned this panel into a scroll with no
landmarks. A group with nothing filled in yet stays open — there is nothing to
summarise, and collapsing the rows out from under someone who just picked a
question would be worse than the scroll.

The growth badge now reads **"Powered by Dapta"** ("Con tecnología de Dapta"),
naming the platform rather than this one product.
