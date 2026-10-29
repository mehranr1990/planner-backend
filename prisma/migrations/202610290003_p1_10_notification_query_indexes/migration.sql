BEGIN;
-- Bound active-count checks and current inbox/snooze/typed-history lookups.
CREATE INDEX "Reminder_spaceId_state_idx" ON "Reminder" ("spaceId",state);
CREATE INDEX "NotificationDelivery_spaceId_notificationId_idx" ON "NotificationDelivery" ("spaceId","notificationId");
CREATE INDEX "NotificationDelivery_spaceId_sourceNotificationId_idx" ON "NotificationDelivery" ("spaceId","sourceNotificationId");
CREATE INDEX "NotificationDelivery_spaceId_sourceDeliveryId_idx" ON "NotificationDelivery" ("spaceId","sourceDeliveryId");
-- Other consumers' retained events must not dominate notification dispatch scans.
CREATE INDEX "OutboxEvent_notification_type_pending" ON "OutboxEvent" (type,"occurredAt",id) WHERE "notificationHandledAt" IS NULL AND "notificationAttempts"<5;
COMMIT;
