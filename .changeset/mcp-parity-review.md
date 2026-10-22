---
'@quill/mcp': patch
'@quill/db': patch
---

MCP review fixes. `get_response` carries the same answer shape (`step_key`, `type`, `step_removed`) and `outcome` as `list_responses`. `list_deliveries` says it reads failed and skipped deliveries by default, as the REST route does, and its summary counts the two apart. `search_answers` steps `next_offset` by the page read, so a page the service trimmed is never read twice. `export_responses_csv` documents that its character cap counts the header and that the first row always comes back. `@quill/db` adds `firstSubmissionsForExport`: the first rows of the CSV export, same filter and order, with the count of the whole export.
