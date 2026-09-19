-- Notification recipients: additive. See the Postgres twin for the why.
ALTER TABLE notification_setting ADD COLUMN recipients TEXT;
