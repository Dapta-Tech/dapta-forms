---
'@quill/web': patch
---

The New workspace dialog now opens on top of everything, Home included.

- Opened from the workspace switcher in the rail, the dialog used to stay inside the rail and could not paint over the page: on Home, the animated Connect your agent demo (its tool chips, the small dForms card and its green button, the agent's name) covered the Name field and the Create button. On a phone, inside the menu drawer, the dialog was squeezed into the drawer instead of centred on the screen. It now renders above the page, centred, at every width, in light and dark.
- Tab stays inside dialogs in Safari too. Safari does not Tab to buttons, so from a dialog's only text field focus used to leave the dialog; it now moves through the dialog's own controls and wraps around in every browser.
- On a phone, Escape in a dialog opened from the menu drawer closes the dialog and leaves the drawer open, instead of closing both.
