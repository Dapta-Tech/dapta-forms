---
'@quill/api': minor
---

In-app announcements: `GET /v1/me/announcement` returns the one announcement the signed-in person gets now, with whether its pop-up, its rail mark and its Home banner show, and `POST /v1/me/announcements/:id` records that the pop-up was seen, that it was closed, or that the person reached its page. Both are for a browser session only: an API key or an MCP connection gets a 403. State is kept per person across workspaces, and announcements that name Dapta never show on a fork.
