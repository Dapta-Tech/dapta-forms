---
'@quill/api': patch
'@quill/mcp': patch
---

An MCP sign-in that reaches no workspace yet connects instead of being refused at `initialize`. Chat apps showed that refusal as their own error ("Automatic client registration isn't supported"), never our words. Now the connection acts nowhere, every tool says to open dForms once with that account, and the first call after that visit works with no new login or reconnect. A tool that names a `workspace_id` gets the same step when the person has no workspace at all. A `sub` two people carry is still refused.
