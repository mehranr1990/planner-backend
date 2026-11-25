BEGIN;
CREATE TABLE "AdminPrivacyDeletionRequest" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind VARCHAR(10) NOT NULL CHECK(kind IN ('ACCOUNT','TEAM','COMPANY')),
 "targetId" UUID NOT NULL,
 "targetUserId" UUID REFERENCES "User"(id) ON DELETE SET NULL,
 "targetTeamId" UUID REFERENCES "Team"(id) ON DELETE SET NULL,
 "targetCompanyId" UUID REFERENCES "Company"(id) ON DELETE SET NULL,
 "expectedRevision" INTEGER NOT NULL CHECK("expectedRevision">0),
 "recoveryDays" INTEGER NOT NULL CHECK("recoveryDays" BETWEEN 7 AND 30),
 "impactFingerprint" CHAR(64) NOT NULL,
 state VARCHAR(10) NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','APPROVED','APPLIED','RECOVERED')),
 "requesterAdminId" UUID NOT NULL REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 "approverAdminId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 reason VARCHAR(500) NOT NULL,"approvalReason" VARCHAR(500),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resultJobId" UUID,
 CHECK("approverAdminId" IS NULL OR "approverAdminId"<>"requesterAdminId"),
 CHECK((state='REQUESTED' AND "approverAdminId" IS NULL) OR (state IN ('APPROVED','APPLIED','RECOVERED') AND "approverAdminId" IS NOT NULL)),
 CHECK((state IN ('APPLIED','RECOVERED') AND "resultJobId" IS NOT NULL) OR (state NOT IN ('APPLIED','RECOVERED') AND "resultJobId" IS NULL)),
 CHECK(("targetUserId" IS NULL OR (kind='ACCOUNT' AND "targetUserId"="targetId")) AND ("targetTeamId" IS NULL OR (kind='TEAM' AND "targetTeamId"="targetId")) AND ("targetCompanyId" IS NULL OR (kind='COMPANY' AND "targetCompanyId"="targetId"))),
 CHECK(kind='ACCOUNT' OR "recoveryDays" IN (7,30)),
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '30 minutes')
);
CREATE TABLE "AdminPrivacyDeletionHistory" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "requestId" UUID NOT NULL REFERENCES "AdminPrivacyDeletionRequest"(id) ON DELETE RESTRICT,
 "actorAdminId" UUID NOT NULL REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 state VARCHAR(10) NOT NULL CHECK(state IN ('REQUESTED','APPROVED','APPLIED','RECOVERED')),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminPrivacyDeletionHistory_requestId_createdAt_idx" ON "AdminPrivacyDeletionHistory"("requestId","createdAt");
ALTER TABLE "AccountDeletionJob" ADD COLUMN "initiatedByAdminId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 ADD COLUMN "originAdminRequestId" UUID REFERENCES "AdminPrivacyDeletionRequest"(id) ON DELETE RESTRICT;
COMMIT;
