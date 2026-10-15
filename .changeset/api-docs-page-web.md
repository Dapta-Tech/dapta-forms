---
'@quill/web': minor
---

Developers becomes a group in the rail, with an API docs page next to the API keys.

- The rail item Developers opens into API keys (`/admin/developers/keys`) and API docs (`/admin/developers/docs`). It opens on its own on those pages and marks the parent and the page you are on. On the collapsed rail (and in the builder) the icon opens a flyout with both pages; on a phone the drawer has the same accordion. `aria-expanded`, visible focus, and Escape closes the flyout.
- `/admin/developers` redirects to `/admin/developers/keys`, because skill zips already handed out link there.
- API keys keeps only the key management, with a link to the docs.
- API docs: an index on the left (a selector on a phone), getting started (API URL, Bearer auth, the create, edit, publish and revert cycle, the traps and the skill download), errors, limits, a reference of all 44 routes a key can call grouped by area (method, path, what it is for, parameters, a curl example with this environment's URL and a copy button, an example answer, and an anchor per route), what a key cannot do, and a search over paths and descriptions. English and Spanish, light and dark, no horizontal scroll at 375 px.
- The skill zip sends people to `/admin/developers/keys` and mentions the API docs page.
