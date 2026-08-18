---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
---

A `url` question type: a single-line input that only accepts a web address.

It sits in the builder's Text group ("Website"), between long text and the
slider. It is not a contact field: `LEAD_CAPTURE_TYPES` and `isContactType` are
unchanged, it lands in the qualification flow group, and it does not score.

Validation is a pure regex, no `new URL`, so the engine stays free of platform
APIs and both apps agree on the verdict. `acme.com`, `www.acme.com/x?y=1`,
`https://acme.com:8443/p` and `http://x.io` pass; `acme`, `ftp://acme.com`,
`javascript:alert(1)`, `https://` and `acme .com` are rejected with the new
`url` validation code (`renderer.errors.url` in the catalog, en + es). Empty is
still the required check's job, as for every other type.

The stored value always carries a scheme. `normalizeUrl(raw)` trims and prepends
`https://` when no `http(s)://` prefix is present (idempotent), and
`canonicalizeAnswer(step, value)` applies it to `url` answers that pass the
validator (a typo like `acme` stays as typed, so the error is about what was
written) and is the identity for everything else. The public renderers call it at their commit
points, right before `validateAnswerCode`, so the Enter path and the button path
hand the same shape to the engine, the partial save and the CRM, and a HubSpot
`website` property receives a full URL. `createEmptyStep('url')` seeds the
placeholder `https://` to hint at that shape.
