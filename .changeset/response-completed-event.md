---
'@quill/types': minor
---

`submissionSchema` accepts an optional `analyticsId`: a random id the public renderer mints per response, used as the product-analytics distinct id of the new `forms_response_completed` server event. Anything that is not a UUID is dropped, never refused, so a malformed value cannot fail a submit.
