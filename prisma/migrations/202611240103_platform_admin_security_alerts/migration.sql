BEGIN;
CREATE TABLE "AdminSecurityAlert" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 rule VARCHAR(30) NOT NULL CHECK(rule='LOGIN_FAILURES'),
 "bucketStart" TIMESTAMPTZ(3) NOT NULL,
 "policyRevision" INTEGER NOT NULL CHECK("policyRevision">0),
 severity VARCHAR(10) NOT NULL CHECK(severity IN ('WARNING','CRITICAL')),
 observed INTEGER NOT NULL CHECK(observed>0),
 threshold INTEGER NOT NULL CHECK(threshold>0 AND observed>=threshold),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(rule,"bucketStart","policyRevision")
);
CREATE TABLE "AdminSecurityAlertDelivery" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "alertId" UUID NOT NULL REFERENCES "AdminSecurityAlert"(id) ON DELETE CASCADE,
 "adminUserId" UUID NOT NULL REFERENCES "AdminUser"(id) ON DELETE CASCADE,
 state VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENDING','SENT','FAILED','CANCELED')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 "nextAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMPTZ(3),
 UNIQUE("alertId","adminUserId")
);
CREATE INDEX "AdminSecurityAlertDelivery_state_nextAt_idx" ON "AdminSecurityAlertDelivery"(state,"nextAt");
COMMIT;
