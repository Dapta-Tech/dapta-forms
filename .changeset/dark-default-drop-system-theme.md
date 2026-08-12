---
'@quill/shared': minor
---

Make dark the theme, and light the opt-in — no more "System".

The colour scheme had three values and the third one served nobody. `System`
followed the OS by stamping no `data-theme` at all, so a viewer on a light-mode
machine got a dashboard neither they nor we had chosen, and the choice they
thought they had made was really a choice not to make one. The product is
authored dark, an unbranded public form is pinned dark regardless of any cookie
(`lib/form-design.ts`), and the one surface that followed the OS was the admin
chrome — the only place the inconsistency could show.

Dark is now the default and light is a deliberate opt-in. The sidebar control
becomes a two-state flip instead of a three-state cycle, and the Settings picker
names both. `admin.chrome.theme.system` is gone from the message catalog in both
locales.

No migration: `isThemePref` no longer recognises `system`, and `getThemePref`
already falls back to `dark` for anything it does not recognise, so a browser
still carrying the old cookie lands on the new default rather than on a scheme
that can no longer be selected.

The token sheet's `@media (prefers-color-scheme: light)` block stays. Dapta Forms
can no longer reach it — the root layout now always stamps `dark` or `light` —
but it is the fallback for a self-host that embeds these tokens without our
layout, which would otherwise be stuck on the dark base with no way to opt out.
