---
'@quill/shared': minor
'@quill/types': minor
'@quill/db': minor
---

The language of the product is a setting you can change.

The admin has been translated into English and Spanish since the first-run
wizard, but the wizard was the only thing that ever chose: it read the browser's
`Accept-Language` once, stored it, and there was no control anywhere to change
it afterwards. Anyone whose browser asked for the wrong one, or who simply
changed their mind, was stuck with it.

Account settings has a fifth entry, Preferences, and the choice lives there. It
is the area's only per-person setting, so unlike its four neighbours it names no
workspace: your language follows you into every workspace you open, and a
teammate reading the same workspace in the other language is not a conflict. It
is not admin-gated either, for the same reason.

The whole admin re-renders immediately, not just the page carrying the control.
The two options are written each in its own language ("English", "Español") and
never translate, because the person most likely to be looking for this control
is the one who cannot currently read the page it is on.

Details worth knowing:

- `PUT /v1/me/locale` is the new endpoint. Scoped to the caller's own
  membership, which is what makes it safe not to gate: there is no parameter
  through which one person could set another's language.
- The choice is stored on the member row, not only in a browser cookie. That is
  what makes it a user setting rather than a per-device one, and `member.locale`
  is also what selects the language of the submission notification emails an
  account sends. That column has been read for those emails all along and never
  written, so until now every one of them went out in English.
- Signing in on a browser that has no cookie yet now picks the stored choice up,
  instead of starting over in English.
- `<html lang>` carries the language actually being rendered. It was hardcoded
  `en`, so a Spanish dashboard had been telling screen readers, translation
  tools and search engines it was English. Public forms declare their own
  language on their own subtree, which is decided by `?lang=` and the visitor's
  browser as before: an author's dashboard preference does not follow a
  respondent.
- A member who has never chosen still renders in English, exactly as today.
