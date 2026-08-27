---
'@quill/db': patch
---

Duplicating a form no longer copies the HubSpot mirror-form pointer (`settings.formGuid` / `formSignature`). The pointer is API-owned state naming the mirror form minted for the ORIGINAL: a copy that inherited it posted its submissions at the original's form (every lead the copy collected showed up attributed to the original), and integration saves on either form renamed the shared mirror back and forth. The copy now sheds the pair, so its first integrations save mints a mirror of its own; everything else in the config still copies verbatim.
