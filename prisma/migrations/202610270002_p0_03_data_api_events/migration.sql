-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('ATTEMPTED', 'SUCCEEDED', 'DENIED', 'FAILED');

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SecurityAuditEvent" (
    "id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "actorUserId" UUID,
    "requestId" UUID NOT NULL,
    "correlationId" UUID NOT NULL,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggregateId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" UUID NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "resultId" UUID NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_actorUserId_occurredAt_id_idx" ON "SecurityAuditEvent"("actorUserId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_requestId_idx" ON "SecurityAuditEvent"("requestId");

-- CreateIndex
CREATE INDEX "OutboxEvent_spaceId_occurredAt_id_idx" ON "OutboxEvent"("spaceId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorUserId_spaceId_operation_keyHash_key" ON "IdempotencyRecord"("actorUserId", "spaceId", "operation", "keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Space_id_ownerUserId_key" ON "Space"("id", "ownerUserId");

-- AddForeignKey
ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_spaceId_actorUserId_fkey" FOREIGN KEY ("spaceId", "actorUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Platform invariants not representable by Prisma's schema DSL.
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_version_check" CHECK ("version" >= 1);
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 2048);
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_receipt_check" CHECK ("statusCode" BETWEEN 200 AND 299 AND "expiresAt" > "createdAt" AND "keyHash" ~ '^[0-9a-f]{64}$' AND "fingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_fields_check" CHECK ("changedFields" <@ ARRAY['name','image','locale','timezone','preferredCalendar','firstDayOfWeek']::text[]);
