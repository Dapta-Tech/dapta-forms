---
'@quill/shared': minor
---

Connections tells the truth about a server-supplied token, and the Trends chart
stops distorting itself.

**The chart was stretched, not styled that way.** It drew a fixed 720-unit
viewBox with `preserveAspectRatio="none"` into a container roughly twice that
wide, so every mark was scaled ~2x horizontally and not at all vertically. The
tell was the isolated-day marker: a `<circle>` rendered as an ellipse, and
horizontal strokes came out twice as thick as vertical ones. The viewBox now
tracks the measured container width, so one unit is one pixel and nothing is
scaled. Date ticks follow that width too — a fixed three-tick rule left a wide
chart with two labels and a gap between them.

**The metric picker was the last native `<select>` in the admin**, so the
operating system drew its chevron hard against the control's border and its
popup ignored the theme. It uses the shared `Select` now, like every other
control.

**"Not connected" was wrong whenever the deployment supplied the token.** A
provider can be fully working through its env fallback while
`account_integration` is empty — the page reported the empty table and said
nothing about the working integration, which reads as broken. `GET
/v1/integrations` now also returns which providers the server supplies, and the
page has a third state for it that explains connecting your own replaces it for
that account. Env knowledge stays in the API; `@quill/db` still never reads the
environment.

Also: the Connect buttons line up. The action row had no `mt-auto`, so HubSpot's
two-line description pushed its button a line below Calendly's. And the two
providers get real brand marks instead of a generic sync/calendar glyph —
inline SVG, because a fork has to render with no CDN reachable.

New `admin.connections` strings in EN and ES: `serverProvided`,
`serverProvidedTitle`, `serverProvidedBody`.
