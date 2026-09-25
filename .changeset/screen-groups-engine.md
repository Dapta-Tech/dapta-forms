---
'@quill/types': minor
'@quill/engine': minor
---

Screens: several questions on one slides screen.

An optional `screenGroup` on each step puts consecutive steps that share it on
one screen of the slides layout, with one button. Absent, which every stored
config is, means a screen of its own, so every form saved before this renders
and walks exactly as it did. Logic keys, scoring, CSV, the Summary tab, emails,
webhook and CRM mapping and the analytics API keep working per question.

- `@quill/types`: `formStepSchema.screenGroup` (additive, 1 to 64 characters).
  The API must know it before or together with the web: a schema without it
  strips the field on save and the author silently loses their screens.
- `@quill/engine`: one definition of a screen, shared by the renderer, the
  builder and the server score. `authoredScreens` and `screenIds` (a run of two
  or more consecutive steps with the same id; `reveal`, `scheduler` and `file`
  always stand alone, hidden steps are transparent, a run of one means nothing,
  the same id in two separate runs makes two screens, and the one-page layout
  ignores every id), `runtimeScreens`, `screensActive`, `canShareScreen`,
  `SOLO_SCREEN_TYPES` and `MAX_SCREEN_SIZE` (10, the builder's cap; the engine
  does not cap). A jump from a question on a screen now runs when the
  respondent leaves the screen, so the first matching rule from the top wins
  and the rest of the screen is still shown and scored; a target inside a
  screen lands on its first visible question. `normalizeScreenGroups` (also run
  by `normalizeConfig`) keeps ids only where they make a screen and returns the
  same array when nothing changes, and `setScreenBoundary` joins or splits the
  boundary above a question. A legacy reveal after a question on a screen
  becomes a step after the whole screen.
