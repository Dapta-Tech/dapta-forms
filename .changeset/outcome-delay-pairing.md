---
'@quill/engine': patch
---

`resolveEnding`: the redirect delay now inherits from the form-level ending only
when the redirect URL itself was inherited. An outcome that brings its own URL
with no delay of its own resolves to 0 (redirect immediately) — which is what
the outcomes dialog has always displayed for an untouched field. Previously the
form-level delay leaked under an outcome-level URL, so the public form held the
thank-you screen that the editor said it would skip; a delay orphaned by a
cleared form-level URL leaked the same way.
