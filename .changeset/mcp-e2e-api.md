---
'@quill/api': patch
---

Fixes from end-to-end QA of the MCP:

- The webhook test (`POST /v1/forms/:id/destinations/webhook/ping`, and `ping_webhook`) returns the status the endpoint answered on success too, sends the phase the webhook listens to (`complete` unless it only takes partial saves), answers only the steps that take input (no sample answer for a message or reveal step), and marks the test with `test: true` at the top of the payload. `data.test` stays for receivers that read it, except where a step is keyed `test`.
- Staff searching workspaces over MCP get each one under the identity service's id, before and after first use, with what it matched on. Where the identity service names staff a member that dForms has not projected yet, the call now acts through a staff access grant instead of answering `MEMBERSHIP_NOT_SYNCED`; the next projection turns that row into the membership.
