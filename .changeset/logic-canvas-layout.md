---
'@quill/engine': minor
'@quill/types': minor
---

Add `config.logicLayout` — builder-only node positions for the Logic canvas,
keyed by step key.

Additive and optional, so every existing config keeps parsing and every
published form renders identically. The engine and both renderers ignore it
entirely: nothing about how a form RUNS may depend on where its author dragged a
box. An absent entry is the normal case — the canvas lays itself out from step
order, and a stored position is only ever an override of that.

Because the key is a step key it is a POINTER, and both places that move
pointers now move it too: `renameStepKey` carries a position across a rename,
and `normalizeConfig` remaps it through the same rename map as `goto[].target`
and prunes entries whose step is gone. Without that a rename or a delete would
leave a node pinned to coordinates its step no longer occupies — the exact kind
of stale lie the canvas exists to remove. Coordinates are validated `.finite()`
so a NaN can never reach the config and fail the whole form's autosave.
