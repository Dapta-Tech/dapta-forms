---
'@quill/engine': minor
'@quill/shared': minor
---

An option's stored value follows its label, and every pointer follows the value.

A choice option carries two strings: the label a respondent reads, and the value
stored in the answer. The builder has always written the value for you, but only
in the settings panel. The canvas, which is where people actually type, changed
the label and left the value on the `option_1` / `option_2` it was created with.
The result was a form that read properly on screen and stored answers nobody
could read, and authors reasonably concluded the value was a box they had failed
to fill in.

Both surfaces now go through one place, so they cannot disagree again. Rewording
a label rewrites the value with it, until you write a value yourself, after which
it is yours and stays exactly as you left it.

Renaming a value is not a field edit, because a value is named by string from
seven other places, none of which complains when it stops matching: a branch
simply never fires again. The rename now carries all of them, so a reworded label
cannot silently break a form:

- `showWhen` / `hideWhen` values on any step whose condition reads this one;
- `goto` jump values on the step that owns the options;
- the keys of `questionVariants` and `sliderLabelVariants`, including the
  comma-joined composite keys a multi-select variant uses;
- outcome override values;
- the step's `defaultValue`, which seeds the answer and simply stops seeding.

Two options can legitimately hold the same value, because both Add buttons mint
one from the list length and a delete-then-add repeats a sibling's. The rename
therefore moves the option by position and only repoints when the token is
actually leaving the step, so a row nobody touched is never dragged along. Add
now dedupes, so the duplicate stops being minted in the first place.

Values already out in the world do not move. Anything the live config serves,
plus anything a HubSpot value map points at, stays put while its label is
reworded freely: answers already collected carry those tokens, and the CRM
mapping is keyed by them. Options added afterwards are not in the live config, so
theirs still follow, and a form still being built has nothing locked at all.

The stored values now sit behind a "Stored values" disclosure rather than in a
column beside every label. It opens on its own when a value has stopped tracking
its label, so a value chosen deliberately, to match a CRM enum say, is never
hidden from the person who chose it. Editing one by hand commits on blur and
refuses a value another option on the question already stores, rather than
silently merging two answers onto one token.

Forms whose values are stuck on `option_1` heal on the next label edit: the
created placeholder counts as unwritten, not as a value somebody chose.
