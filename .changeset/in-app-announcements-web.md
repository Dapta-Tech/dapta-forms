---
'@quill/web': minor
---

In-app announcements: product news on the Home page and in the rail, once per person.

- A card at the top of Home, above the "Connect your agent" banner: a looping animation that follows the light or dark theme, a title, one line, a button to the announcement's page and a close button. It is rendered with the page, so nothing below it moves when it appears. On a phone it stacks. Under reduced motion it shows a still image and no entrance animation.
- A "New" mark on the rail item the announcement points at: a pill after the label in the open rail and the mobile drawer, a dot on the icon when the rail is collapsed. A screen reader hears "Integrations, new". The builder shows neither.
- Closing the card hides it for good; the rail mark stays until the person opens the page. Opening the page, from the button, the rail or on one's own, ends both. Product analytics records seen, closed and followed with the announcement id.
- The first announcement, from November 19 through December 19: sending responses to HighLevel, Salesforce and Google Sheets, and booking with dCal.
