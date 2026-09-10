---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
'@quill/config': minor
---

Groundwork for a "file" question type: object storage, presigned uploads, and
server-side verification.

This is the backend half. The type exists in the engine and the API, but no
builder gallery entry and no public input render it yet, so no form can ask for
a file until the renderer lands.

The file never travels through the app. The browser asks the API for permission
(`POST /v1/public/forms/:accountCode/:slug/uploads`, behind the same per-IP rate
limit as the rest of the public surface), gets a presigned PUT that can write one
key for a few minutes with one exact content type, and uploads straight to the
bucket. That is what lets a 10 MB file exist at all: the current path caps the
request body at 1 MB in the server action and 100 kb in the API.

Two prefixes carry the difference between "a stranger wrote this" and "we
checked it":

- `incoming/{accountId}/{formId}/{sessionId}/{uuid}.{ext}` is the only place a
  browser may write. A bucket lifecycle rule expires it, so a visitor who
  uploads and abandons the form costs nothing.
- `uploads/` is written by the API alone, after verification, and is the only
  prefix a stored submission ever points at.

On submit, every file answer is checked before anything is persisted or scored:
the object exists, its REAL size is within the limit (the size the client
claimed is not evidence), its key is under this session's own staging prefix, and
its first bytes match the extension it arrived under. A format with no signature
to check, such as .txt or .csv, is accepted only under an extension that is
genuinely signature-free. Executables and active documents (html, svg) are
refused whatever the form owner configured. Verification is idempotent, so a
partial save followed by a complete submit promotes the file once.

Nothing in the bucket is public. Downloads are minted per click as short-lived
signed URLs and always as an attachment, so an uploaded page cannot execute on
an origin of ours. Deletion removes every VERSION of an object, because a
versioned bucket turns an ordinary delete into a recoverable delete marker.

Configuration is one variable in the normal case. `STORAGE_BUCKET` turns the
feature on and the AWS SDK finds the pod's own role, so there is no key to
configure; `STORAGE_PROVIDER=none` is an explicit off switch for a deployment
that has a bucket but does not want the feature. Unset, which is the default and
every bare fork, means the question type does not exist and the deployment boots
and runs exactly as before. `UPLOAD_MAX_FILE_MB` (10 by default) is a ceiling a
form owner can lower but never raise, and `STORAGE_REGION`, `STORAGE_ENDPOINT`
and `STORAGE_FORCE_PATH_STYLE` cover S3-compatible storage.

An answer rides in the existing answers JSON as `{ key, name, size, mime }`, so
there is no migration and no new column. `parseFileAnswer` is the only reader of
that shape; answer summaries print the respondent's own filename and never the
object key, which keeps it out of notification emails and CSV exports.
