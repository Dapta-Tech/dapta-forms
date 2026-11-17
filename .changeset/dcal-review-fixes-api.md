---
"@quill/config": patch
---

dCal counts as configured only when BOTH `DCAL_API_BASE_URL` and `DCAL_APP_URL`
are set. With just the API host every booking URL the picker built was relative,
so the picker offered event types whose save then failed validation.
