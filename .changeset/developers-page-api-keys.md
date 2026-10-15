---
'@quill/shared': minor
---

A "Developers" page in the admin, where each person manages the API keys of their workspace.

- New rail item "Developers" (code icon) between Integrations and Docs, in the open and collapsed rail and in the mobile drawer, active on `/admin/developers`.
- The page lists keys with their name, last four characters, creation date and last use. A member sees their own keys; an owner or admin sees every active key of the workspace and who created each one.
- Creating a key asks for a name (1 to 60 characters) and then shows the full key once, with a copy button and a warning that it cannot be shown again. Closing the dialog drops it.
- Revoking asks for confirmation and takes the key off the list. Reaching ten active keys shows a clear limit message (`KEY_LIMIT`).
- Empty state that explains what a key is, an error state when the list cannot load, and no horizontal scroll at 375 px.
- The page is built against the `/v1/api-keys` contract of the API v1 spec. The docs section is a placeholder (`DeveloperDocs`) until the guide and the agent skill land.
- i18n: `admin.chrome.nav.developers`, `admin.developers.*` and `admin.developerDocs.*` (EN + ES).
