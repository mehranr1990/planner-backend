ALTER TABLE "UserSettings"
 ADD COLUMN "adminRevision" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "suspendedAt" TIMESTAMPTZ(3),
 ADD COLUMN "suspensionExpiresAt" TIMESTAMPTZ(3),
 ADD COLUMN "suspensionReason" VARCHAR(500),
 ADD CONSTRAINT "UserSettings_admin_revision" CHECK ("adminRevision">0),
 ADD CONSTRAINT "UserSettings_suspension_shape" CHECK (("suspendedAt" IS NOT NULL OR ("suspensionExpiresAt" IS NULL AND "suspensionReason" IS NULL)) AND ("suspensionExpiresAt" IS NULL OR "suspensionExpiresAt">"suspendedAt"));
ALTER TABLE "Space"
 ADD COLUMN "adminRevision" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "suspendedAt" TIMESTAMPTZ(3),
 ADD COLUMN "suspensionExpiresAt" TIMESTAMPTZ(3),
 ADD COLUMN "suspensionReason" VARCHAR(500),
 ADD CONSTRAINT "Space_admin_revision" CHECK ("adminRevision">0),
 ADD CONSTRAINT "Space_suspension_shape" CHECK (("suspendedAt" IS NOT NULL OR ("suspensionExpiresAt" IS NULL AND "suspensionReason" IS NULL)) AND ("suspensionExpiresAt" IS NULL OR "suspensionExpiresAt">"suspendedAt"));
ALTER TABLE "AdminAuditEvent"
 ADD COLUMN "targetUserId" UUID,
 ADD COLUMN "targetSpaceId" UUID,
 ADD COLUMN reason VARCHAR(500),
 ADD COLUMN "internalNote" VARCHAR(2000),
 ADD COLUMN permission VARCHAR(100),
 ADD COLUMN metadata JSONB;
CREATE INDEX "AdminAuditEvent_target_user" ON "AdminAuditEvent"("targetUserId","createdAt");
CREATE INDEX "AdminAuditEvent_target_space" ON "AdminAuditEvent"("targetSpaceId","createdAt");
CREATE TABLE "AdminBulkOperation" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "actorAdminId" UUID NOT NULL,
 input JSONB NOT NULL,
 targets JSONB NOT NULL,
 results JSONB NOT NULL DEFAULT '{}',
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
