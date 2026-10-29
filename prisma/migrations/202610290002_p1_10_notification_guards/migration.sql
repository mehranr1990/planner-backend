BEGIN;
-- SQL CHECK accepts UNKNOWN: explicitly require active endpoint secrets.
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_active_keys" CHECK (state <> 'ACTIVE' OR auth IS NOT NULL AND p256dh IS NOT NULL);
COMMIT;
