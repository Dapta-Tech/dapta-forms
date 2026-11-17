---
'@quill/api': patch
---

The `INTEGRATION_NOT_CONNECTED` refusal of `PUT /v1/forms/:id/destinations` and `POST /v1/forms` carries `unavailable`: true when the deployment cannot connect the provider at all, so a client can tell "connect it" from "nothing to connect". The OpenAPI document gains `PUT /v1/forms/{id}/destinations` (body, `warnings`, `sheetHeaders` and the refusal body), the `POST /v1/forms` refusal and `warnings`, the `unavailable`, `dcal` and `googlePicker` fields of `GET /v1/integrations`, and `apiKey` in the `security` of every operation an API key may call, derived from the allowlist the API enforces. The `apiKey` scheme now says keys are created with `POST /v1/api-keys`. `SELF-HOSTING.md` documents the `GOOGLE_OAUTH_*` and Google Picker variables and what happens when each is missing.
