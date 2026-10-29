BEGIN;
-- Retain at most five abandoned export keys for restart-safe, owner-scoped cleanup.
ALTER TABLE "UserExportJob" ADD COLUMN "artifactKeys" UUID[] DEFAULT ARRAY[]::UUID[];
CREATE INDEX "SyncChange_createdAt_spaceId_sequence_idx" ON "SyncChange"("createdAt", "spaceId", "sequence");
CREATE INDEX "SyncMutationReceipt_bodyExpiresAt_id_idx" ON "SyncMutationReceipt"("bodyExpiresAt", "id");
COMMIT;
