---
'@quill/db': patch
'@quill/notifications': patch
---

Security update of production dependencies.

- `@quill/db`: drizzle-orm 0.45.4 (SQL injection through improperly escaped
  identifiers in earlier releases). A failed Postgres query still throws the
  driver's own error, with its SQLSTATE `code` and without the bound parameter
  values that drizzle-orm 0.44 and later add to the error message.
- `@quill/notifications`: nodemailer 10.6.0 (address parser DoS, a raw message
  option that skipped the file and URL access guards, TLS validation in the
  OAuth2 token fetch). nodemailer now ships its own types, so
  `@types/nodemailer` is gone. The SMTP adapter's options and behavior are
  unchanged.
