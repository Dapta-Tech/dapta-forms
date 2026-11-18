---
'@quill/api': minor
---

In-app announcements: `GET /v1/me/announcement` returns the one announcement the signed-in person gets now, and `POST /v1/me/announcements/:id` records that it was seen, that its card was closed, or that the person followed it. Both are for a browser session only: an API key or an MCP connection gets a 403. State is kept per person across workspaces, an announcement stops after five sessions in which the person did nothing with it, and announcements that name Dapta never show on a fork.
