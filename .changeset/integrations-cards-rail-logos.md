---
'@quill/web': patch
---

Integrations: opening a card no longer stretches the card beside it, and the rail item rotates the logos of the services dForms connects to.

- On the Integrations page, each card is two rows of a subgrid. Headers in a row share a height, so the Connect and How it works buttons still start on the same line at rest; each card's body keeps its own height, so opening a connect form grows that card alone. Before, the neighbour stretched to the open form's height and its button slid to the bottom of a mostly empty card. The form now fades in (no motion with reduced motion).
- The rail's Integrations icon is a carousel like the one in Connect your agent: HubSpot, Salesforce, HighLevel, Google Sheets, Calendly, dCal and Dapta (Dapta only on a Dapta build). Same timing, half a beat behind the agent logos, still on hover and under reduced motion (HubSpot is then the icon). The row stays plain, without the green tint, and its name is still Integrations (Integraciones).
