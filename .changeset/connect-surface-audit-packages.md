---
'@quill/mcp': minor
'@quill/shared': patch
---

`set_destinations` reports what the save did to the spreadsheet's header row.

- The MCP tool `set_destinations` returns `sheet_header_row`, the same outcome the REST route returns as `sheetHeaders`: `written`, `unchanged`, `stale`, `foreign` (row 1 holds something dForms did not write and was left untouched, with what it holds under `sheet_supplied`) or `failed` with its reason. An agent that changes a Google Sheets destination's columns can now tell that row 1 was left alone. The tool description and the agent guide say so, and describe the Google Sheets destination.
- New catalog strings, in English and Spanish, for what a member is told where an action is for owners and admins, and for a connect attempt that failed with no specific reason.
