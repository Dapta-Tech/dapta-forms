-- Staff access grants: additive. See the Postgres twin for the why.
ALTER TABLE member ADD COLUMN access_grant TEXT;
