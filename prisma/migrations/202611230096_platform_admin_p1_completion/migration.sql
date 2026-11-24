ALTER TABLE "SharedActor" ADD COLUMN "adminUserId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT;
ALTER TABLE "SharedActor" DROP CONSTRAINT "SharedActor_state_check";
ALTER TABLE "SharedActor" DROP CONSTRAINT "SharedActor_check";
ALTER TABLE "SharedActor" ADD CONSTRAINT "SharedActor_state_check" CHECK(state IN ('ACTIVE','ERASED','HISTORICAL','ADMIN'));
ALTER TABLE "SharedActor" ADD CONSTRAINT "SharedActor_check" CHECK(
 (state='ACTIVE' AND "userId" IS NOT NULL AND "adminUserId" IS NULL AND "erasedAt" IS NULL AND "originCustodyId" IS NULL) OR
 (state='ERASED' AND "userId" IS NULL AND "adminUserId" IS NULL AND "erasedAt" IS NOT NULL AND "originCustodyId" IS NULL) OR
 (state='HISTORICAL' AND "userId" IS NULL AND "adminUserId" IS NULL AND "erasedAt" IS NULL AND "originCustodyId" IS NOT NULL AND "originCustodyId"<>"spaceId") OR
 (state='ADMIN' AND "userId" IS NULL AND "adminUserId" IS NOT NULL AND "erasedAt" IS NULL AND "originCustodyId" IS NULL));
CREATE UNIQUE INDEX "SharedActor_admin_attribution" ON "SharedActor"("spaceId","adminUserId") WHERE "adminUserId" IS NOT NULL;
CREATE FUNCTION admin_actor_no_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "SharedActor" WHERE id=NEW."actorId" AND state='ADMIN') THEN
  RAISE EXCEPTION 'Administrative attribution cannot be a membership' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContextAccess_no_admin_actor" BEFORE INSERT OR UPDATE ON "ContextAccess" FOR EACH ROW EXECUTE FUNCTION admin_actor_no_membership();
ALTER TABLE "AccessScope" ADD COLUMN "adminRevision" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "suspendedAt" TIMESTAMPTZ(3), ADD COLUMN "suspensionExpiresAt" TIMESTAMPTZ(3), ADD COLUMN "suspensionReason" VARCHAR(500),
 ADD CONSTRAINT "AccessScope_admin_shape" CHECK("adminRevision">0 AND ("suspendedAt" IS NOT NULL OR ("suspensionExpiresAt" IS NULL AND "suspensionReason" IS NULL)) AND ("suspensionExpiresAt" IS NULL OR "suspensionExpiresAt">"suspendedAt"));
ALTER TABLE "ContextInvitation" ADD COLUMN "initiatedByAdminId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT;
ALTER TABLE "OwnerHandover" ADD COLUMN "initiatedByAdminId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT;
CREATE TABLE "AdminMutationReceipt" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "actorAdminId" UUID NOT NULL REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 operation VARCHAR(100) NOT NULL, "keyHash" CHAR(64) NOT NULL, fingerprint CHAR(64) NOT NULL, result JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("actorAdminId",operation,"keyHash")
);
CREATE TABLE "AdminDelivery" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "auditId" UUID NOT NULL REFERENCES "AdminAuditEvent"(id) ON DELETE RESTRICT,
 "targetUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, kind VARCHAR(40) NOT NULL, payload JSONB NOT NULL,
 state VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENDING','SENT','FAILED','CANCELED')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), "nextAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("auditId","targetUserId",kind)
);
CREATE INDEX "AdminDelivery_state_nextAt_idx" ON "AdminDelivery"(state,"nextAt");
