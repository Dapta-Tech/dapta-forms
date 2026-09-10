---
'@quill/shared': minor
'@quill/types': minor
'@quill/db': minor
---

The file question, end to end: build it, answer it, download it.

The storage groundwork shipped separately; this is the half a person can see.
A form owner adds a "File upload" question from the builder gallery, a visitor
picks a file and watches it upload, and the owner opens it from the submissions
table.

**Builder.** The gallery gets a File upload tile in the Text group. Its settings
are four preset groups (documents, images, spreadsheets, archives) over a plain
extension field, because "pdf, doc, docx, odt, rtf" is not a decision a form
author wants to make and a bare text box is how a question nobody can answer
gets published. Ticking a preset writes its extensions into the same list the
field edits, so the two never disagree. The size field caps at the deployment's
own ceiling, which the API reports rather than the dashboard assuming. An empty
type list is called out, since it is almost never what the author meant.

The canvas preview draws the real drop zone rather than a text placeholder: the
canvas is the only place an author checks their work before publishing, and a
question that previewed as an empty input would be lying about what it is.

**Public form.** The upload starts the moment a file is chosen, not on Continue,
so a visitor with a 9 MB document is watching a progress bar instead of a frozen
button. It uses XMLHttpRequest because fetch still cannot report upload
progress, and a progress bar is the whole difference between this feeling broken
and feeling normal on a slow connection. Size and extension are checked in the
browser first as a courtesy, and again on the server as the actual rule. Both
layouts carry it, slides and vertical.

The bytes go straight from the browser to the bucket. The presign request goes
through a server action so the visitor's own address still reaches the API's
rate limiter, and so no embed origin ever needs adding to an allowlist.

**Submissions table.** A file answer renders as its filename with a download
control instead of `[object Object]`, which is what the generic cell formatter
produced. The signed URL is fetched on click rather than rendered into the page:
a table of fifty rows would otherwise carry fifty short-lived credentials in its
HTML, most of them expired before anyone clicked one. The endpoint behind it
resolves the submission through a join on the caller's own account, so a guessed
id from another workspace returns nothing rather than a working link.

**Deployments with no bucket.** The tile is offered but disabled, with the
reason on it, and the public input renders nothing at all. A bare fork sees a
question type it cannot use rather than one that fails on the first click.

Copy is EN and ES throughout. HubSpot auto-mapping suggests no property for a
file question and no longer lets the words in "upload your company logo" map a
PDF into a text property; the webhook test body carries the real answer shape.
