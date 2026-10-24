---
'@quill/config': minor
---

MCP sign-ins no longer need a visit to the web app first. A sign-in the web login link does not reach yet is named through the optional read-only person directory (`IAM_DB_*`), and the person connects at the first try in every workspace where they are an active member. Missing or incomplete `IAM_DB_*` turns the directory off with one warning, never a refused boot; the link alone then works as before.
