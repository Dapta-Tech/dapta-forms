---
'@quill/web': minor
'@quill/api': patch
---

The rail's Developers item is now MCP, with the Claude, ChatGPT and Cursor logos as its icon, and the API keys page offers the skill download.

- The item reads MCP in English and Spanish, in the wide rail, in the collapsed rail's flyout and in the phone drawer. The pages under it keep their names (API keys, API docs) and their addresses (`/admin/developers/keys`, `/admin/developers/docs`), which skill zips already link to.
- Its icon is the Claude, ChatGPT and Cursor logos taking turns every 2.6 seconds with a crossfade. Claude keeps its brand orange in every state and theme; the monochrome ChatGPT and Cursor marks take the row's text color, so they follow the theme and the idle, hover and current states. It holds still under the pointer and does not move at all with reduced motion. Screen readers hear "MCP"; the logos are hidden from them.
- The API keys page is titled MCP and gains a "Skill for your agent" card after the keys, with one line on what the skill is for and the same download as the API docs page. Without a public API address it says the download is not available yet instead of offering a button that would fail.
- The skill tells the agent to have the person create a key in dForms under MCP, then API keys, and `/openapi.json` names the same place.
- Card options without an icon show their text alone, centred, on the public form, the embedded form, the builder canvas and the live preview. They no longer draw the label's initials in a grey circle. Cards with an icon are unchanged, and a row mixing both keeps one height. The option's icon picker shows an empty slot instead of the initials when there is no icon.
