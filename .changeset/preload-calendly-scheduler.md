---
'@quill/web': minor
---

Calendly schedulers paint on arrival: the slides renderer boots a form's Calendly widgets hidden while the visitor answers.

A Calendly inline widget needs 4-6 s on a fast link (more on a phone) between
mounting and showing availability: the iframe document, then a serial chain of
API calls ending in the availability lookup. The scheduler step used to start
all of that only when the visitor reached it. Measured on a three-tier form
(P1/P2/P3 schedulers gated by an answer), availability now shows ~25-35 ms
after the step opens (Chromium and WebKit), against 3.8-5.8 s before.

- **What is preloaded**: the Calendly pages (https://calendly.com only) of the
  form's scheduler steps, then its outcome bookings, deduped, at most 3, one at
  a time. The queue starts at the visitor's first interaction, so a bounce
  never loads Calendly, and is skipped when the browser asks to save data.
- **How**: each widget boots on `<body>` inside the viewport at `opacity: 0`,
  behind the page, `inert` and `aria-hidden` (off-screen or
  `visibility: hidden` iframes are frozen by the browser). The `BookingScreen`
  that shows that booking adopts it: the widget is positioned over the screen's
  slot (an iframe cannot be moved without reloading), clipped under the form's
  sticky banner, fades in with the screen, and receives the prefill through
  Calendly's `calendly.prefill` message once rendered. Back and forward reuse it.
- **Claims and holds**: a screen reached before its widget's turn boots it on
  the spot rather than a second cold one. Any screen showing a Calendly widget,
  adopted or cold, pauses the queue and drops widgets still loading; once it
  lets go (Back, Skip), the queue picks up at the visitor's next interaction.
  A widget is only adopted by the session it was booted for (its URL carries
  that session id, which Calendly hands back as the booking's attribution).
- **Keyboard and screen readers**: the slot `aria-owns` the widget, and focus
  guards take Tab into the calendar from the slot and back out to the form.
- **Not preloaded**: HubSpot Meetings, any non-Calendly host, and the one-page
  layout (its sticky header and floating menus share the page with the
  calendar, and a widget positioned from outside the form would paint over
  them). Those embed exactly as before.
- **Side effect**: Calendly records a view of each preloaded event type for
  every visitor who interacts with the form, even one who never reaches it.

Fixes along the way:

- `loadCalendlyScript` could wait forever on a tag whose load had already
  failed (ad blocker, CSP, offline). It now shares one in-flight load, rejects
  on error, a 15 s stall or a script that defines nothing, and forgets a failed
  attempt so the next caller retries.
- The cold Calendly embed re-booted on every re-render of its screen (its
  effect keyed on a prefill object rebuilt each render); it now keys on the
  prefill's content.
- "Prefill: off" now also keeps the contact fields out of the widget's own
  `prefill` option, as it already did for the URL.
- The focusable-control selector used by the modal, the confirm dialog and the
  submissions column filter now lives in one place (`lib/focusable.ts`); the
  column filter's copy gains `textarea`, which it had dropped.
