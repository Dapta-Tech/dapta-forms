---
'@quill/db': minor
---

API keys for the admin API: create them on the Developers page, send them as `Authorization: Bearer dforms_...`.

- `GET`, `POST` and `DELETE /v1/api-keys`, with a session only. A member lists and revokes their own keys; an owner or admin, every active key of the workspace and who created it. The key in clear comes back once, in the `POST` response (`{ id, name, last4, createdAt, key }`); only its SHA-256 is stored. The 11th active key of one person in one workspace answers 409 `KEY_LIMIT`.
- A key acts as the member who created it, in that workspace, with their current role (`via: 'api_key'` on the principal). A revoked key, or one whose member is no longer active there, answers 401 `INVALID_API_KEY` on the next call; an `x-quill-workspace` header naming another workspace answers 403 `WORKSPACE_FORBIDDEN`.
- A key may call the routes that build and run forms (forms, folders, destinations, responses, CSV, analytics, brand kit, notifications, `GET /v1/me`, reading integrations). Every other admin route answers 403 `KEY_NOT_ALLOWED`, and a route added later is refused to keys until it is allowlisted.
- 120 calls a minute per key (the public limiter's token bucket, in memory per pod): past that, 429 `{ error: 'RATE_LIMITED', retryAfterSec }` with a `Retry-After` header. `last_used_at_ms` moves at most once a minute.
- Forms record how they were born: `form.created_via` is `api` with a key and `web` from the dashboard and the onboarding, on create and on duplicate. `form_created` and `form_published` carry the same `via`, and a new `forms_api_key_created` event fires when a key is made.
- `/openapi.json` documents the bearer scheme and the key routes.
- `@quill/db`: `insertApiKey` (the count and the insert in one statement), `listApiKeys`, `getApiKeyById`, `revokeApiKey`, `findApiKeyPrincipal`, `touchApiKeyLastUsed`, `API_KEY_LIMIT_PER_MEMBER`, and a `createdVia` input on `createForm` and `duplicateForm`.
