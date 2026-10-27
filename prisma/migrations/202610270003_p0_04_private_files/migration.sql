-- CreateEnum
CREATE TYPE "StoredFileStatus" AS ENUM ('INITIATED', 'READY', 'REJECTED', 'DELETED');

-- AlterTable
ALTER TABLE "SecurityAuditEvent" ADD COLUMN     "resourceId" UUID;

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "objectKey" UUID NOT NULL,
    "filename" VARCHAR(180) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "expectedSha256" CHAR(64),
    "actualSize" INTEGER,
    "sha256" CHAR(64),
    "status" "StoredFileStatus" NOT NULL DEFAULT 'INITIATED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "uploadAttemptId" UUID,
    "uploadStartedAt" TIMESTAMPTZ(3),
    "uploadExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_objectKey_key" ON "StoredFile"("objectKey");

-- CreateIndex
CREATE INDEX "StoredFile_spaceId_status_createdAt_id_idx" ON "StoredFile"("spaceId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_spaceId_id_key" ON "StoredFile"("spaceId", "id");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Private file invariants (existing provider-owned scalars remain unchanged).
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_limits_check" CHECK ("expectedSize" BETWEEN 1 AND 104857600 AND "revision" >= 1 AND "uploadExpiresAt" > "createdAt");
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_mime_check" CHECK ("mimeType" IN ('text/plain','application/pdf','image/png','image/jpeg'));
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_hash_check" CHECK (("expectedSha256" IS NULL OR "expectedSha256" ~ '^[0-9a-f]{64}$') AND ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'));
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_attempt_check" CHECK (("uploadAttemptId" IS NULL) = ("uploadStartedAt" IS NULL));
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_deleted_check" CHECK (("status" = 'DELETED') = ("deletedAt" IS NOT NULL));
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_purged_check" CHECK ("purgedAt" IS NULL OR "status" IN ('REJECTED','DELETED'));
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ready_check" CHECK ("status" <> 'READY' OR ("actualSize" IS NOT NULL AND "actualSize" = "expectedSize" AND "sha256" IS NOT NULL AND ("expectedSha256" IS NULL OR "expectedSha256" = "sha256") AND "completedAt" IS NOT NULL AND "uploadAttemptId" IS NULL AND "purgedAt" IS NULL));
