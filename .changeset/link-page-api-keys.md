---
'@quill/api': minor
---

`GET /v1/link-page` and `PUT /v1/link-page` are open to API keys, and `GET` also answers the page's `publicUrl` and whether it is `live`. The MCP endpoint reads bodies up to the link page's ceiling plus its envelope, so `update_link_page` takes the largest page the REST route takes.
