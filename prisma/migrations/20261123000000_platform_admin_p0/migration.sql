CREATE TABLE "AdminUser" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT true,
  "image" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'SUPPORT',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  "mfaEnrolledAt" TIMESTAMP(3),
  CONSTRAINT "AdminUser_role_check" CHECK (role IN ('SUPER_ADMIN', 'SUPPORT', 'BILLING_MANAGER', 'SECURITY_REVIEWER'))
);
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser" ("email");
CREATE TABLE "AdminSession" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" UUID NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminSession_token_key" ON "AdminSession" ("token");
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession" ("userId");
CREATE TABLE "AdminAccount" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenExpiresAt" TIMESTAMP(3),
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AdminAccount_userId_idx" ON "AdminAccount" ("userId");
CREATE TABLE "AdminVerification" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AdminVerification_identifier_idx" ON "AdminVerification" ("identifier");
CREATE TABLE "AdminTwoFactor" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminTwoFactor_userId_key" ON "AdminTwoFactor" ("userId");
CREATE INDEX "AdminTwoFactor_secret_idx" ON "AdminTwoFactor" ("secret");
CREATE TABLE "AdminAuditEvent" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorAdminId" UUID,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AdminAuditEvent_actorAdminId_createdAt_idx" ON "AdminAuditEvent" ("actorAdminId", "createdAt");
