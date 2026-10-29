BEGIN;
-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "accessClosedAt" TIMESTAMPTZ(3),
ADD COLUMN     "syncEpoch" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "syncRetainedSequence" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "syncSequence" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UserExportJob" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "nextAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectKey" UUID NOT NULL,
    "attemptKey" UUID NOT NULL,
    "artifactSize" INTEGER,
    "artifactHash" CHAR(64),
    "manifest" JSONB,
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "UserExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionJob" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID,
    "spaceId" UUID,
    "identityDigest" CHAR(64) NOT NULL,
    "spaceDigest" CHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "confirmationHash" CHAR(64),
    "recoveryHash" CHAR(64),
    "confirmationExpiresAt" TIMESTAMPTZ(3),
    "recoveryExpiresAt" TIMESTAMPTZ(3),
    "policyVersion" VARCHAR(80) NOT NULL,
    "retentionAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "nextAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progress" JSONB,
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "eraseAfter" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "evidenceExpiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "AccountDeletionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncChange" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "entity" VARCHAR(20) NOT NULL,
    "resourceId" UUID NOT NULL,
    "parentId" UUID,
    "revision" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncMutationReceipt" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "clientMutationId" UUID NOT NULL,
    "clientEntryId" UUID,
    "fingerprint" CHAR(64) NOT NULL,
    "disposition" VARCHAR(12) NOT NULL,
    "resourceId" UUID,
    "result" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bodyExpiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SyncMutationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserExportJob_ownerUserId_createdAt_id_idx" ON "UserExportJob"("ownerUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "UserExportJob_state_nextAt_id_idx" ON "UserExportJob"("state", "nextAt", "id");

-- CreateIndex
CREATE INDEX "AccountDeletionJob_ownerUserId_createdAt_id_idx" ON "AccountDeletionJob"("ownerUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AccountDeletionJob_state_nextAt_id_idx" ON "AccountDeletionJob"("state", "nextAt", "id");

-- CreateIndex
CREATE INDEX "SyncChange_spaceId_createdAt_sequence_idx" ON "SyncChange"("spaceId", "createdAt", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SyncChange_spaceId_sequence_key" ON "SyncChange"("spaceId", "sequence");

-- CreateIndex
CREATE INDEX "SyncMutationReceipt_spaceId_bodyExpiresAt_id_idx" ON "SyncMutationReceipt"("spaceId", "bodyExpiresAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SyncMutationReceipt_spaceId_clientMutationId_key" ON "SyncMutationReceipt"("spaceId", "clientMutationId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncMutationReceipt_spaceId_clientEntryId_key" ON "SyncMutationReceipt"("spaceId", "clientEntryId");

-- AddForeignKey
ALTER TABLE "UserExportJob" ADD CONSTRAINT "UserExportJob_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SyncChange" ADD CONSTRAINT "SyncChange_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncMutationReceipt" ADD CONSTRAINT "SyncMutationReceipt_spaceId_actorUserId_fkey" FOREIGN KEY ("spaceId", "actorUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- P1-12 review: four approved entities; additive Space fence/cursor fields only.
ALTER TABLE "Space" ADD CONSTRAINT "Space_sync_bounds" CHECK ("syncRetainedSequence">=0 AND "syncSequence">="syncRetainedSequence");
ALTER TABLE "SyncChange" ADD CONSTRAINT "SyncChange_valid" CHECK ("sequence">0 AND "revision">0 AND "entity" IN ('TASK','CHECKLIST','LABEL','DAILY_PLAN','HABIT_ENTRY','NOTE','CAPTURE'));
ALTER TABLE "SyncMutationReceipt" ADD CONSTRAINT "SyncMutationReceipt_valid" CHECK ("disposition" IN ('APPLIED','CONFLICT','REJECTED') AND "fingerprint" ~ '^[a-f0-9]{64}$' AND "bodyExpiresAt">"createdAt");
ALTER TABLE "UserExportJob" ADD CONSTRAINT "UserExportJob_valid" CHECK ("revision">0 AND "attempts">=0 AND "attempts"<=5 AND "state" IN ('QUEUED','RUNNING','READY','FAILED','EXPIRED','CANCELED') AND ("artifactSize" IS NULL OR "artifactSize" BETWEEN 1 AND 52428800) AND ("state"<>'READY' OR ("artifactSize" IS NOT NULL AND "artifactHash" IS NOT NULL AND "manifest" IS NOT NULL AND "completedAt" IS NOT NULL AND "expiresAt">"completedAt")));
CREATE UNIQUE INDEX "UserExportJob_one_active" ON "UserExportJob" ("ownerUserId") WHERE "state" IN ('QUEUED','RUNNING');
ALTER TABLE "AccountDeletionJob" ADD CONSTRAINT "AccountDeletionJob_valid" CHECK ("revision">0 AND "attempts">=0 AND "attempts"<=5 AND "state" IN ('PENDING','WAITING','ERASING','CANCELED','EXPIRED','FAILED','BLOCKED_POLICY','ERASED') AND ("state"<>'ERASED' OR ("ownerUserId" IS NULL AND "spaceId" IS NULL AND "confirmationHash" IS NULL AND "recoveryHash" IS NULL AND "completedAt" IS NOT NULL AND "evidenceExpiresAt" IS NOT NULL)));
CREATE UNIQUE INDEX "AccountDeletionJob_one_active" ON "AccountDeletionJob" ("ownerUserId") WHERE "state" IN ('PENDING','WAITING','ERASING','BLOCKED_POLICY');

COMMIT;
