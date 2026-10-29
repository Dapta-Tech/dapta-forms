---
'@quill/shared': minor
---

The MCP page (API keys) now opens with a three-step guide to connect an agent: download the skill, create a key, give both to the agent.

- Step 1 holds the skill download that used to sit at the bottom of the page. Without a public API address it says the download is not available yet.
- Step 2 opens the same create-key dialog as the button above the list.
- Step 3 has a tab per agent (Claude Code, Codex, Cursor) with the command that installs the skill, the line that sets `DFORMS_API_KEY` and a first prompt to paste, each with a copy button. The commands come from the same source as the skill's `INSTALL.md`, so the page and the zip never disagree.
- Each step shows as done from what the page knows: the download was clicked in this browser, you have a key of your own, one of the listed keys has been used.
- A note says that Claude in the browser and ChatGPT connect through the dForms MCP, not with a key.
- After a key is created, the dialog also shows the `export DFORMS_API_KEY=...` line with that key, ready to copy. It disappears with the dialog, like the key.
