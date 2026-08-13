---
'@quill/types': patch
'@quill/engine': patch
---

Let an outcome carry the range it covers, instead of implying it.

An outcome stored only where it STARTED. Its end was read off whichever
neighbour started next, so a range was never something an author typed — it was
something they inferred, from a badge on the far side of the row they were
editing, showing a number derived from a different row. Widening a range meant
changing someone else's threshold, and two ranges could quietly claim the same
score, leaving one of them dead with nothing on screen saying so.

`formOutcomeSchema` gains an optional integer `maxScore`: the inclusive upper
bound. Absent means the range runs open-ended upwards, which is exactly how
every stored range behaved before the field existed. `resolveOutcome` reads the
STORED bound and never a derived one, so a config carrying no `maxScore` at all
resolves to the same outcome it always did — pinned by a test, because that is
the whole back-compat claim. The top range is meant to stay unbounded: something
has to catch a score above every ceiling.

Adds three pure helpers to `@quill/engine`, so the several screens that draw a
range stop each deriving it for themselves:

- `outcomeRanges` — the span each outcome covers, filling in the implicit end
  for configs written before `maxScore`. Order-independent: the implicit end is
  the smallest start above this one, not "the next array element".
- `overlappingOutcomes` — indexes whose span collides with an earlier one. Never
  a legitimate state: only one outcome can win a score, so the other is dead.
  Ranges with no explicit bounds tile by construction, so no already-stored form
  starts reporting one.
- `outcomeGaps` — scores between the ranges that match nothing. A real choice
  (those respondents see the form's own ending), so it is reported and not
  refused. It invents no floor below the lowest range; scores go negative and the
  bottom of the scale is not this function's to guess.
