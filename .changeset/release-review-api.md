---
"@quill/api": patch
---

Salesforce's token cache is bound to the stored connection: a reconnect to
another org, or a disconnect, handled by a different API pod is honored on the
next delivery instead of after ten minutes. dCal's picker asks all of an
author's teams at once, so a slow dCal costs one timeout, not one per team.
