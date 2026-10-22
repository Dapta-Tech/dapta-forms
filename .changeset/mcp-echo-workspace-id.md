---
'@quill/mcp': patch
---

Every tool result's `workspace.id`, `whoami` included, is now the `workspace_id` the agent sent, trimmed and in lower case. A staff search can return the identity service's id for a workspace, which differs from the dForms id, and an agent that compared the two thought its call had landed in another workspace. Workspace ids are also compared without regard to case, so an API key sent with its own id in capitals is no longer refused as "another workspace".
