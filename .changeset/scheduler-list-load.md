---
'@quill/shared': patch
---

Scheduler step: the event-type list loads on the first try, and looks like it is loading.

A scheduler step added from the question gallery sat on "Loading event
types…" until the author left the step and came back, or reloaded. The list
was fetched through a server action from the panel's mount effect, and on
that one path the call never left the browser. The list now comes over a
same-origin GET (`/admin/integrations/calendly/event-types`), which also
keeps a read from queueing behind autosaves. A request that fails or hangs
shows "Could not load your event types" with Try again, and the paste-a-link
option stays reachable.

While it loads, the panel shows a skeleton in the picker's own shape instead
of a line of text, with the loading text kept for screen readers.

i18n: `admin.editor.settings.schedulerListError`, `schedulerRetry` (EN + ES).
