---
'@quill/web': minor
---

In-app announcements: product news in the dashboard, shown to everyone in a workspace.

- A pop-up over the dashboard on the first page load of a session where it is due: the announcement's looping animation (it follows the light or dark theme), a title, one line and a button to its page. Closing it with the X, Escape, a click outside or the button ends it for good, in every browser. It never opens in the form builder, on its own page, or over another dialog, and the page behind it does not move. On a phone it is a sheet from the bottom. Under reduced motion it shows a still image and no entrance animation.
- A "New" mark on the rail item the announcement points at, until the person opens that page: a pill after the label in the open rail and the mobile drawer, a dot on the icon when the rail is collapsed. A screen reader hears "Integrations, new".
- A banner beside the "Control your forms, logic and design from your AI agent" banner at the top of Home, for as long as the announcement runs: the two sit side by side on a wide screen and stack on a narrow one, each with a title, a line, a sliding row of logos and a button. When no announcement is running, the agents banner is full width as before.
- Product analytics records seen, closed and followed with the announcement id.
- The shared `Modal` gains opt-in props for a dialog that draws its own layout and holds the page's scroll still.
- The first announcement, from November 19 through December 19: sending responses to HighLevel, Salesforce and Google Sheets, and booking with dCal.
