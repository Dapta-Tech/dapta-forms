---
'@quill/config': minor
'@quill/db': minor
---

Google Sheets connects through Google's own consent flow, the first provider whose credential is not pasted.

`account_integration` gains the `google-sheets` provider. What it stores is the OAuth refresh token the flow hands back; the client id and secret that redeem it stay in the deployment's environment (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`), so the storage contract is unchanged: one opaque, encrypted secret per account. No migration: `provider` is a text column.

All three variables unset leaves the integration off, exactly as a missing token does for the other providers.
