BEGIN;
-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notificationFailureCode" VARCHAR(80),
ADD COLUMN     "notificationHandledAt" TIMESTAMPTZ(3),
ADD COLUMN     "notificationRetryAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" VARCHAR(2000),
    "taskId" UUID,
    "selectedTaskRevision" INTEGER,
    "rule" JSONB NOT NULL,
    "timezoneMode" VARCHAR(10) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "channels" TEXT[],
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "state" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "reason" VARCHAR(80),
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "cursorDate" DATE,
    "nextAt" TIMESTAMPTZ(3),
    "sourceStamp" CHAR(64),
    "pausedAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "exhausted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "reminderId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "occurrenceKey" VARCHAR(100) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "localDate" DATE NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" VARCHAR(2000),
    "inbox" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ(3),
    "acknowledgedAt" TIMESTAMPTZ(3),
    "dismissedAt" TIMESTAMPTZ(3),
    "snoozedAt" TIMESTAMPTZ(3),
    "firstDeliveredAt" TIMESTAMPTZ(3),
    "sourceNotificationId" UUID,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "reminderId" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'CHANNEL',
    "notificationId" UUID,
    "parentId" UUID,
    "subscriptionId" UUID,
    "subscriptionRevision" INTEGER,
    "sourceNotificationId" UUID,
    "sourceDeliveryId" UUID,
    "channel" VARCHAR(10) NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3),
    "notBefore" TIMESTAMPTZ(3),
    "occurrenceKey" VARCHAR(100) NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "localDate" DATE NOT NULL,
    "localTime" VARCHAR(5) NOT NULL,
    "state" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(80),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMPTZ(3),
    "networkStartedAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "reactivatedAt" TIMESTAMPTZ(3),
    "cancelRequestedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(80),
    "jobId" UUID,
    "queuedAt" TIMESTAMPTZ(3),
    "retryAt" TIMESTAMPTZ(3),

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "webPush" BOOLEAN NOT NULL DEFAULT false,
    "reactivateOnReopen" BOOLEAN NOT NULL DEFAULT false,
    "quietStart" VARCHAR(5),
    "quietEnd" VARCHAR(5),

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "label" VARCHAR(100),
    "endpointHash" CHAR(64) NOT NULL,
    "endpointHost" VARCHAR(253) NOT NULL,
    "endpoint" VARCHAR(4096),
    "auth" VARCHAR(50),
    "p256dh" VARCHAR(100),
    "state" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_spaceId_createdAt_id_idx" ON "Reminder"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Reminder_spaceId_taskId_state_idx" ON "Reminder"("spaceId", "taskId", "state");

-- CreateIndex
CREATE INDEX "Reminder_state_id_idx" ON "Reminder"("state", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_spaceId_id_key" ON "Reminder"("spaceId", "id");

-- CreateIndex
CREATE INDEX "Notification_spaceId_inbox_createdAt_id_idx" ON "Notification"("spaceId", "inbox", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_spaceId_id_key" ON "Notification"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_reminderId_scheduledAt_key" ON "Notification"("reminderId", "scheduledAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_spaceId_reminderId_createdAt_id_idx" ON "NotificationDelivery"("spaceId", "reminderId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "NotificationDelivery_state_notBefore_id_idx" ON "NotificationDelivery"("state", "notBefore", "id");

-- CreateIndex
CREATE INDEX "NotificationDelivery_state_leaseUntil_id_idx" ON "NotificationDelivery"("state", "leaseUntil", "id");

-- CreateIndex
CREATE INDEX "NotificationDelivery_spaceId_occurrenceKey_channel_state_idx" ON "NotificationDelivery"("spaceId", "occurrenceKey", "channel", "state");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_spaceId_id_key" ON "NotificationDelivery"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_parentId_subscriptionId_key" ON "NotificationDelivery"("parentId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_spaceId_key" ON "NotificationPreference"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_spaceId_id_key" ON "NotificationPreference"("spaceId", "id");

-- CreateIndex
CREATE INDEX "PushSubscription_spaceId_state_createdAt_id_idx" ON "PushSubscription"("spaceId", "state", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_spaceId_id_key" ON "PushSubscription"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_spaceId_endpointHash_key" ON "PushSubscription"("spaceId", "endpointHash");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_spaceId_reminderId_fkey" FOREIGN KEY ("spaceId", "reminderId") REFERENCES "Reminder"("spaceId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_spaceId_sourceNotificationId_fkey" FOREIGN KEY ("spaceId", "sourceNotificationId") REFERENCES "Notification"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_spaceId_reminderId_fkey" FOREIGN KEY ("spaceId", "reminderId") REFERENCES "Reminder"("spaceId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_spaceId_notificationId_fkey" FOREIGN KEY ("spaceId", "notificationId") REFERENCES "Notification"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_spaceId_parentId_fkey" FOREIGN KEY ("spaceId", "parentId") REFERENCES "NotificationDelivery"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_spaceId_subscriptionId_fkey" FOREIGN KEY ("spaceId", "subscriptionId") REFERENCES "PushSubscription"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_spaceId_sourceNotificationId_fkey" FOREIGN KEY ("spaceId", "sourceNotificationId") REFERENCES "Notification"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_spaceId_sourceDeliveryId_fkey" FOREIGN KEY ("spaceId", "sourceDeliveryId") REFERENCES "NotificationDelivery"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Application-owned invariants; vendor queue DDL is installed separately (ADR 0019).
CREATE UNIQUE INDEX "NotificationDelivery_channel_fingerprint" ON "NotificationDelivery" ("reminderId","scheduledAt",channel) WHERE kind='CHANNEL' AND "scheduledAt" IS NOT NULL;
CREATE UNIQUE INDEX "NotificationDelivery_gap_fingerprint" ON "NotificationDelivery" ("reminderId","ruleVersion","occurrenceKey",channel) WHERE kind='CHANNEL' AND "scheduledAt" IS NULL;
CREATE INDEX "OutboxEvent_notification_pending" ON "OutboxEvent" ("occurredAt",id) WHERE "notificationHandledAt" IS NULL;
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_notification_attempts" CHECK ("notificationAttempts">=0);
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_shape" CHECK (
 revision BETWEEN 1 AND 2147483646 AND "ruleVersion" BETWEEN 1 AND 2147483646
 AND state IN ('ACTIVE','PAUSED','CANCELED') AND "timezoneMode" IN ('FIXED','ACCOUNT')
 AND length(trim(title))>0 AND length(timezone)>0 AND jsonb_typeof(rule)='object' AND rule->>'version'='1' AND rule->>'kind' IN ('ABSOLUTE','LOCAL','TASK')
 AND ("taskId" IS NULL AND "selectedTaskRevision" IS NULL OR "taskId" IS NOT NULL AND "selectedTaskRevision">0)
 AND (rule->>'kind'<>'TASK' OR "taskId" IS NOT NULL)
 AND channels IS NOT NULL AND cardinality(channels) BETWEEN 1 AND 3 AND channels <@ ARRAY['IN_APP','EMAIL','WEB_PUSH']::text[]
 AND array_position(channels,NULL) IS NULL
 AND cardinality(array_positions(channels,'IN_APP'))<=1 AND cardinality(array_positions(channels,'EMAIL'))<=1 AND cardinality(array_positions(channels,'WEB_PUSH'))<=1
);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shape" CHECK (revision BETWEEN 1 AND 2147483646 AND length(trim(title))>0 AND length(timezone)>0 AND "sourceNotificationId" IS DISTINCT FROM id);
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_shape" CHECK (
 revision BETWEEN 1 AND 2147483646 AND "ruleVersion" BETWEEN 1 AND 2147483646 AND attempts BETWEEN 0 AND 5
 AND channel IN ('IN_APP','EMAIL','WEB_PUSH') AND state IN ('PENDING','PROCESSING','RETRY','DELIVERED','SKIPPED','CANCELED','EXPIRED','FAILED','AMBIGUOUS')
 AND "localTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND length(timezone)>0
 AND (kind='CHANNEL' AND "parentId" IS NULL AND "subscriptionId" IS NULL AND "subscriptionRevision" IS NULL OR kind='ENDPOINT' AND channel='WEB_PUSH' AND "parentId" IS NOT NULL AND "subscriptionId" IS NOT NULL AND "subscriptionRevision">0)
 AND ("scheduledAt" IS NOT NULL OR state='SKIPPED' AND reason='DST_GAP' AND kind='CHANNEL')
 AND (state<>'PROCESSING' OR "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
 AND (state<>'DELIVERED' OR "sentAt" IS NOT NULL AND "notificationId" IS NOT NULL)
 AND "parentId" IS DISTINCT FROM id AND "sourceDeliveryId" IS DISTINCT FROM id
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_shape" CHECK (
 revision BETWEEN 1 AND 2147483646
 AND ("quietStart" IS NULL AND "quietEnd" IS NULL OR "quietStart" IS NOT NULL AND "quietEnd" IS NOT NULL AND "quietStart"<>"quietEnd" AND "quietStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "quietEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_shape" CHECK (
 revision BETWEEN 1 AND 2147483646 AND "endpointHash" ~ '^[a-f0-9]{64}$' AND length("endpointHost")>0
 AND (state='ACTIVE' AND endpoint IS NOT NULL AND endpoint LIKE 'https://%' AND auth ~ '^[A-Za-z0-9_-]{22}$' AND p256dh ~ '^[A-Za-z0-9_-]{87}$' AND "revokedAt" IS NULL OR state='REVOKED' AND endpoint IS NULL AND auth IS NULL AND p256dh IS NULL AND "revokedAt" IS NOT NULL)
);
COMMIT;
