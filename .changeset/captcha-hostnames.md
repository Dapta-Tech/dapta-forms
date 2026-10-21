---
'@quill/config': minor
---

Spam protection can accept challenge tokens from more than one host.

`CAPTCHA_HOSTNAMES` (optional, comma-separated hostnames) lists the hosts a
deployment serves its public forms on when it has more than one, for example
while it moves to a new domain with both hosts live. Unset, nothing changes: a
token must come from the host of `PUBLIC_APP_URL`, and the host is not checked
when that is empty. Set, a token must come from one of the listed hosts or from
the host of `PUBLIC_APP_URL`, which is always included. Entries are trimmed and
lowercased and blanks are dropped (an empty value reads as unset); an entry
written as an origin is reduced to its hostname, and a wildcard or a
`host:port` refuses to boot while the check is on. The action and session
checks are unchanged.

- `@quill/config`: `CAPTCHA_HOSTNAMES` and `captchaHostnames`, the resolved
  list (null when the host is not checked).
