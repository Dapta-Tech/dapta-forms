---
"@quill/db": patch
---

Apply each migration script and its tracking marker in one dialect-native transaction, so a failed migration leaves no partial schema and concurrent migrators apply it exactly once.
