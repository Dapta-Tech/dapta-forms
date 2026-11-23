---
'@quill/web': patch
---

The referral banner shows in the form builder too. The builder now fills the room the admin shell
leaves it instead of the whole viewport: on that route the shell is one screen tall and `<main>` a
column, so the 48px strip sits on top and the builder's bottom edge (inspector, "Add question",
question list) stays on screen. Closing the banner gives the builder its full height back at once.
Below 768px the builder also stops sliding under the mobile top bar.
