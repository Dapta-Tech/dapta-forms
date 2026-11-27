---
'@quill/api': patch
'@quill/web': patch
---

Every product analytics event now says which deployment sent it (`environment`: `prd`, `dev` or `local`, from the host of `PUBLIC_APP_URL`), so a development install that shares an analytics project with production no longer mixes into its funnels. Server events also carry `app_host`. The playbook events in the app carry the workspace's first-touch `utm_*` tags.
