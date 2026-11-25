BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "AdminUser" ADD COLUMN "signInBlockedUntil" TIMESTAMPTZ(3);
CREATE TABLE "AdminSecurityPolicy" (
 id UUID PRIMARY KEY CHECK(id='00000000-0000-4000-8000-000000000101'::uuid),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 policy JSONB NOT NULL,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AdminSecurityPolicy_floor" CHECK (
  jsonb_typeof(policy)='object'
  AND (policy->>'adminLoginMax')::integer BETWEEN 1 AND 5
  AND (policy->>'userLoginMax')::integer BETWEEN 1 AND 3
  AND (policy->>'alertThreshold')::integer BETWEEN 1 AND 100
  AND (policy->>'alertWindowSeconds')::integer BETWEEN 60 AND 3600
  AND policy->>'alertSeverity' IN ('WARNING','CRITICAL')
  AND jsonb_typeof(policy->'alertChannels')='array'
  AND jsonb_array_length(policy->'alertChannels') BETWEEN 1 AND 2
  AND policy->'alertChannels' <@ '["IN_APP","EMAIL"]'::jsonb
  AND policy ?& ARRAY['adminLoginMax','userLoginMax','alertThreshold','alertWindowSeconds','alertSeverity','alertChannels'])
);
INSERT INTO "AdminSecurityPolicy"(id,policy) VALUES
 ('00000000-0000-4000-8000-000000000101','{"adminLoginMax":5,"userLoginMax":3,"alertThreshold":5,"alertWindowSeconds":300,"alertSeverity":"WARNING","alertChannels":["IN_APP"]}');
CREATE TABLE "AdminSecurityApproval" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 action VARCHAR(30) NOT NULL CHECK(action IN ('MFA_RECOVERY','SECURITY_POLICY')),
 state VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','EXECUTED','REJECTED')),
 "requesterAdminId" UUID NOT NULL REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 "approverAdminId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 "targetAdminId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 input JSONB NOT NULL,
 reason VARCHAR(500) NOT NULL,
 "approvalReason" VARCHAR(500),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMPTZ(3),
 CHECK("approverAdminId" IS NULL OR "approverAdminId"<>"requesterAdminId"),
 CHECK("targetAdminId" IS NULL OR ("targetAdminId"<>"requesterAdminId" AND "targetAdminId" IS DISTINCT FROM "approverAdminId")),
 CHECK((action='MFA_RECOVERY' AND "targetAdminId" IS NOT NULL) OR (action='SECURITY_POLICY' AND "targetAdminId" IS NULL)),
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '30 minutes'),
 CHECK((state IN ('APPROVED','EXECUTED') AND "approverAdminId" IS NOT NULL) OR state IN ('PENDING','REJECTED')),
 CHECK((state IN ('EXECUTED','REJECTED') AND "completedAt" IS NOT NULL) OR (state IN ('PENDING','APPROVED') AND "completedAt" IS NULL))
);
CREATE INDEX "AdminSecurityApproval_state_expiresAt_idx" ON "AdminSecurityApproval"(state,"expiresAt");
COMMIT;
