---
'@quill/config': minor
'@quill/mcp': minor
---

The API can keep answering on an old host while telling callers to move, and
show which API keys still use it.

A deployment that moves its API to a new domain cannot redirect the old host
while keys still call it: a redirect drops `Authorization: Bearer dforms_...`.
`API_DEPRECATED_HOSTS` (optional, comma-separated hostnames) names the hosts
that keep serving but are on their way out. Unset, nothing changes. Set, every
response on a listed host, errors included, carries `Deprecation` (RFC 9745,
from `API_DEPRECATION_DATE`), a `Link` to the same path on `API_SUCCESSOR_URL`
with `rel="successor-version"` and, when `API_SUNSET_DATE` is set, `Sunset`.
Each call made there with an API key, on the REST routes or on `/mcp`, is
logged once as a JSON line with the key's id, its workspace, the method, the
route pattern, the status and the host; never the key and never the query. A
call without a key gets the headers and no line.

The host is the `Host` header, compared case-insensitively without the port;
`X-Forwarded-Host` is not read. Health checks and in-cluster calls use names
nobody lists, so they are never affected. The successor URL and the
deprecation date are required with the list, and a malformed entry, a
successor that is not a plain https origin or lists itself, a bad date, or a
sunset before the deprecation refuses to boot.

- `@quill/config`: `API_DEPRECATED_HOSTS`, `API_SUCCESSOR_URL`,
  `API_DEPRECATION_DATE`, `API_SUNSET_DATE`, and `apiDeprecation`, the
  resolved settings (null when off).
- `@quill/mcp`: `McpDoorOptions.onAuthenticated`, an optional hook called with
  the request and the caller once a credential resolves, before its rate
  limit.
