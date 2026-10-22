---
'@quill/mcp': patch
---

`normalizeWorkspaceSearch` folds accents, so a staff search for `jose` finds `José` and `JOSÉ`. New exports: `foldSearchText`, and the fold table `SEARCH_FOLD_FROM` / `SEARCH_FOLD_TO` a host applies to names in SQL with `translate(lower(name), FROM, TO)`, which works under collation `C` and needs no extension.
