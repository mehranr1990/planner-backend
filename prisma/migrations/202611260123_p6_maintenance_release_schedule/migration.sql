BEGIN;
-- ADR 0078: an approved release schedule is distinct from the advisory countdown.
CREATE TABLE "PlatformMaintenanceSchedule" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "versionId" uuid NOT NULL UNIQUE REFERENCES "PlatformConfigVersion"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 "approvalId" uuid NOT NULL UNIQUE REFERENCES "AdminSecurityApproval"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 "requesterAdminId" uuid NOT NULL,
 "expectedRevision" integer NOT NULL CHECK ("expectedRevision">0),
 "notBefore" timestamptz(3) NOT NULL,
 "nextAttemptAt" timestamptz(3) NOT NULL,
 state varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','WAITING','RELEASED','REVIEW','CANCELED')),
 reason varchar(500) NOT NULL,
 "lastAttemptAt" timestamptz(3),
 "failureCode" varchar(50),
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" timestamptz(3),
 CHECK ("notBefore">="createdAt" AND "nextAttemptAt">="notBefore"),
 CHECK ((state IN ('RELEASED','REVIEW','CANCELED'))=("completedAt" IS NOT NULL))
);
CREATE INDEX "PlatformMaintenanceSchedule_state_nextAttemptAt_idx" ON "PlatformMaintenanceSchedule"(state,"nextAttemptAt");
CREATE FUNCTION platform_maintenance_schedule_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['state','nextAttemptAt','lastAttemptAt','failureCode','completedAt'])=(to_jsonb(OLD)-ARRAY['state','nextAttemptAt','lastAttemptAt','failureCode','completedAt']) AND OLD.state IN ('PENDING','WAITING') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Immutable maintenance release request'; END $$;
CREATE TRIGGER "PlatformMaintenanceSchedule_guard" BEFORE UPDATE OR DELETE ON "PlatformMaintenanceSchedule" FOR EACH ROW EXECUTE FUNCTION platform_maintenance_schedule_guard();
COMMIT;
