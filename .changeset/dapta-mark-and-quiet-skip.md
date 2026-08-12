---
'@quill/web': patch
---

Sign the attribution badge with Dapta's `d`, and stop the scheduler's skip
shouting over the calendar.

**The badge's mark now matches its own sentence.** The copy became "Powered by
Dapta" in the last release, but the mark beside it stayed the product's `F`, so
the pill named the company and drew the product — the two halves arguing about
where the reader was being sent. `PlatformMark` renders the parent artwork
(`components/brand/dapta-logo.tsx`, the shipped "Dapta D" copied path-for-path),
and it is a separate component from `BrandMark` precisely so a surface signs
itself with the mark that matches the name written next to it. Every other call
site — the app switcher, the admin rail, the error pages — is in-product chrome
that says "Forms", and keeps the `F`.

The bowl draws in `currentColor` so it inherits the pill's foreground and follows
dark/light and any host branding; only the lime tick is literal, which is the
role the official light/dark files split into two assets. The viewBox is cropped
to the ink — the source file pads the same artwork to 279×298, which would have
rendered a 16px mark at about 8px of visible glyph. Both properties are pinned by
`dapta-logo.spec.tsx`, including the crop, which caught a hundredth-of-a-unit
clip on the tick's left edge.

The open-core gate is unchanged: a fork gets its own initial, never Dapta's `d`.

**"Skip for now" is a quiet control, not the loudest thing on the screen.** It
carried `pf__btn`, so an optional scheduler step rendered a full-width, 54px,
accent-filled bar directly under the calendar — the way OUT of the step styled as
the primary action, which left the booking itself looking optional. It is now
`.pf__skip`, in the same no-fill idiom as `.pf__back`.

Its colour is derived from the form's own two colours rather than taken from
`--muted-foreground`. That token is a 62% mix tuned for helper text and lands at
3.97:1 on a cream form, under the 4.5:1 AA floor for a 15px label; 74% measures
5.71:1 there and 8.75:1 on the default dark ground, against body text at 12.81
and 15.70. It is deliberately not scoped under `.pf[data-pf-button=…]` — those
styles describe the primary action, and a form with outlined buttons should not
also outline its escape hatch.

Nothing about when the skip appears changed: still `!step.required` only.
