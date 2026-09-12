---
'@quill/engine': patch
---

Normalize explicitly inverted slider bounds before answer validation. Missing
bounds remain open-ended, so existing form config v1 behavior stays unchanged.
