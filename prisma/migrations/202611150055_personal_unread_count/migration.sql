-- Exact personal inbox counts; preserves all delivery and snooze history.
CREATE INDEX "Notification_unread_inbox_idx" ON "Notification" ("spaceId", "reminderId")
WHERE "inbox" = true AND "readAt" IS NULL AND "dismissedAt" IS NULL;
