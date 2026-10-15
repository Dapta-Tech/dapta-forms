---
'@quill/engine': minor
'@quill/shared': minor
---

An option without an icon no longer falls back to its label's initials.

- `@quill/engine`: `resolveOptionIcon` returns `{ kind: 'none' }` for an option with no icon (absent, empty or blank) on both layouts, instead of a glyph with the label's initials. An image on a list still degrades to the initials, and emoji, letters and images on cards are unchanged. `ResolvedOptionIcon` gains the `none` variant.
- `@quill/shared`: the rail item `admin.chrome.nav.developers` reads MCP in English and Spanish, and `admin.developers.title` is MCP too. New `admin.developers.skill` (`title`, `body`) for the skill download on the API keys page. The Letters hint of the icon picker says an empty value shows no icon.
