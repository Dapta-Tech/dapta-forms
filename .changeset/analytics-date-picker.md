---
'@quill/shared': minor
---

Branded date picker for the analytics custom range.

The From and To fields behind the "Custom" chip on a form's Analytics page were
OS-native date inputs, so their popup came from the browser: unthemed, off-brand,
and different on every platform. They are now a token-styled trigger plus a mini
calendar popover that follows the light and dark theme like every other admin
control, with the accent used for the selected day and a rim on today.

The calendar opens on the current value (or today), pages by month, starts the
week on Monday for Spanish and Sunday for English, and is fully keyboard
operable: arrows move by day and week, Home and End jump to the week's ends,
PageUp and PageDown page months (Shift pages years), Enter picks, Escape closes
and returns focus to the field. A clear button empties the field. Bounds are
unchanged (From cannot pass To, To cannot pass today, all in UTC like the server),
and Apply still swaps a reversed range before it reaches the URL.

New catalog keys under `admin.datePicker` (placeholder, dialog label, previous
and next month, clear) in both locales.
