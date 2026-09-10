---
'@quill/shared': minor
'@quill/types': minor
---

Open an uploaded file in the dashboard instead of only downloading it.

Every signed URL was an attachment, so the filename in the submissions table
put a copy on disk and nothing else. An owner reading fifty applications ended
up with fifty files in a downloads folder to read fifty documents. The filename
now opens a dialog that shows the file, with the download inside it.

Images, PDFs and plain text are drawn by the browser from the URL itself. Word
documents are converted in the dashboard and shown in a frame that can run
nothing, which is what makes it safe to render a stranger's document without
picking through its markup first. The conversion is readable rather than exact,
it loses columns and page furniture, and the dialog says so instead of implying
the layout survived. Anything else, a spreadsheet or an archive or a Word file
older than 2007, downloads on the first click as before: a dialog whose only
content is a download button is a click of ceremony in front of the thing the
person already asked for.

What may be shown, and as what, is decided by the API from the file's
EXTENSION, and the URL that renders it carries a Content-Type derived from the
same place. The type recorded on the answer is not used for this and never
could be: it is the string the browser typed when it asked to upload, nothing
on the way in checked it, and it is also what the bucket stored. A real image
whose answer claims to be a page would otherwise have been served as one. The
extension is the single claim about an upload that was verified, against the
file's own leading bytes, before it was accepted.

Both URLs are still minted per click and live minutes, so nothing durable is
rendered into a table of fifty rows. The download control re-mints rather than
reusing the URL the dialog opened with, because a dialog can sit open longer
than a signature lives and the download is the one action that must not fail
after someone has decided to keep the file. A preview that expires offers a
reload rather than a broken frame.

The two upload routes are described in the OpenAPI document for the first time.
