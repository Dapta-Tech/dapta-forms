---
'@quill/types': patch
---

Remove the last two em dashes a user could see, and make the check that finds
them usable in CI.

Two were still on screen. The webhook health cell rendered a bare em dash as its
empty state; the rows already carry borders, so an empty cell reads as empty,
which is what the submissions table settled on. And
`ONE_HUBSPOT_DESTINATION_MESSAGE` is returned as an API error `message` that
`question-hubspot-actions.ts` hands to the editor verbatim, so it is copy rather
than an internal string.

`scripts/dash-check.sh` could not go into CI before this. It reported 586
failures of which 260 held no dash at all: CI runs with `LANG` unset, and in the
C locale grep degrades a bracket class of multi-byte characters into the set of
their bytes, so the class of em dash and horizontal bar became `{E2,80,94,95}`
and matched every General Punctuation character, all of which begin with byte
`E2`. Arrows, typographic apostrophes, ellipses and bullets were all reported as
em dashes. Matching each full sequence as an alternation is correct in either
locale.

The check now separates the two things it looks at. User-visible copy is at zero
and blocks on the whole tree. Docs and changesets carry roughly 320 older
occurrences, most in changesets that already shipped and cannot be revised, so
those block only on the lines a PR adds. Comment lines and spec titles are
skipped in the copy paths, which removes the last structural false positives:
a prose comment with a code span on either side of a dash satisfied "a dash
between two backticks" while holding no string at all.
