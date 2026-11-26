BEGIN;
-- ADR 0078. Additive versioned operational configuration, no customer-data mutation.
CREATE TABLE "PlatformConfigDefinition" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"key" varchar(100) NOT NULL UNIQUE,
"category" varchar(10) NOT NULL,
"binding" jsonb,
"revision" integer NOT NULL DEFAULT 1,
"killed" boolean NOT NULL DEFAULT false,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PlatformConfigDraft" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"definitionId" uuid NOT NULL,
"expectedRevision" integer NOT NULL,
"payload" jsonb NOT NULL,
"sourceVersionId" uuid,
"state" varchar(12) NOT NULL DEFAULT 'DRAFT',
"requesterAdminId" uuid NOT NULL,
"fingerprint" char(64),
"previewExpiresAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PlatformConfigVersion" (
"approvalId" uuid,
UNIQUE (id,"definitionId"),
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"definitionId" uuid NOT NULL,
"version" integer NOT NULL,
"payload" jsonb NOT NULL,
"actorAdminId" uuid NOT NULL,
"reason" varchar(500) NOT NULL,
"sourceVersionId" uuid,
"startsAt" timestamptz(3) NOT NULL,
"expiresAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("definitionId","version")
);
CREATE INDEX "PlatformConfigVersion_startsAt_expiresAt_idx" ON "PlatformConfigVersion" ("startsAt","expiresAt");
CREATE TABLE "PlatformConfigTarget" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"versionId" uuid NOT NULL,
"position" integer NOT NULL,
"kind" varchar(12) NOT NULL,
"scopeType" varchar(10),
"spaceId" uuid,
"scopeId" uuid,
"userId" uuid,
"groupId" uuid,
"value" jsonb NOT NULL,
"priority" integer NOT NULL,
"basisPoints" integer NOT NULL,
"steps" jsonb NOT NULL,
UNIQUE ("versionId","position")
);

CREATE TABLE "PlatformConfigEvent" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"definitionId" uuid NOT NULL,
"versionId" uuid,
"kind" varchar(24) NOT NULL,
"actorAdminId" uuid,
"reason" varchar(500) NOT NULL,
"metadata" jsonb NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PlatformConfigEvent_definitionId_id_idx" ON "PlatformConfigEvent" ("definitionId","id");
CREATE TABLE "PlatformMaintenanceRelease" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"versionId" uuid NOT NULL UNIQUE,
"actorAdminId" uuid NOT NULL,
"reason" varchar(500) NOT NULL,
"readiness" jsonb NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PlatformConfigEpoch" (
"id" varchar(10) NOT NULL PRIMARY KEY,
"generation" bigint NOT NULL DEFAULT 1,
"observedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "PlatformConfigDraft" ADD CONSTRAINT "PlatformConfigDraft_definitionId_fk" FOREIGN KEY ("definitionId") REFERENCES "PlatformConfigDefinition"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigVersion" ADD CONSTRAINT "PlatformConfigVersion_definitionId_fk" FOREIGN KEY ("definitionId") REFERENCES "PlatformConfigDefinition"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigTarget" ADD CONSTRAINT "PlatformConfigTarget_versionId_fk" FOREIGN KEY ("versionId") REFERENCES "PlatformConfigVersion"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigTarget" ADD CONSTRAINT "PlatformConfigTarget_spaceId_fk" FOREIGN KEY ("spaceId") REFERENCES "Space"(id) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigTarget" ADD CONSTRAINT "PlatformConfigTarget_scopeId_fk" FOREIGN KEY ("scopeId") REFERENCES "AccessScope"(id) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigTarget" ADD CONSTRAINT "PlatformConfigTarget_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigTarget" ADD CONSTRAINT "PlatformConfigTarget_groupId_fk" FOREIGN KEY ("groupId") REFERENCES "AccessScope"(id) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigEvent" ADD CONSTRAINT "PlatformConfigEvent_definitionId_fk" FOREIGN KEY ("definitionId") REFERENCES "PlatformConfigDefinition"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigEvent" ADD CONSTRAINT "PlatformConfigEvent_versionId_fk" FOREIGN KEY ("versionId","definitionId") REFERENCES "PlatformConfigVersion"(id,"definitionId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformMaintenanceRelease" ADD CONSTRAINT "PlatformMaintenanceRelease_versionId_fk" FOREIGN KEY ("versionId") REFERENCES "PlatformConfigVersion"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigDefinition" ADD CHECK (category IN ('FLAG','PRODUCT','SETTING') AND revision>0 AND (NOT killed OR category='FLAG'));
ALTER TABLE "PlatformConfigDraft" ADD CHECK (state IN ('DRAFT','PREVIEW','PUBLISHED') AND "expectedRevision">0 AND (state<>'PREVIEW' OR (fingerprint IS NOT NULL AND "previewExpiresAt" IS NOT NULL)));
ALTER TABLE "PlatformConfigVersion" ADD CHECK (version>0 AND ("expiresAt" IS NULL OR "expiresAt">"startsAt"));
ALTER TABLE "PlatformConfigTarget" ADD CHECK (position>=0 AND priority BETWEEN 0 AND 1000 AND "basisPoints" BETWEEN 0 AND 10000 AND jsonb_typeof(steps)='array' AND
 ((kind='GLOBAL' AND num_nonnulls("scopeType","spaceId","scopeId","userId","groupId")=0) OR
 (kind='SCOPE_TYPE' AND "scopeType" IN ('PERSONAL','TEAM','COMPANY') AND num_nonnulls("spaceId","scopeId","userId","groupId")=0) OR
 (kind='WORKSPACE' AND num_nonnulls("spaceId","scopeId")<=1 AND num_nonnulls("scopeType","userId","groupId")=0) OR
 (kind='USER' AND num_nonnulls("scopeType","spaceId","scopeId","groupId")=0) OR
 (kind='GROUP' AND num_nonnulls("scopeType","spaceId","scopeId","userId")=0)));
CREATE FUNCTION platform_config_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable configuration evidence'; END $$;
CREATE TRIGGER "PlatformConfigVersion_immutable" BEFORE UPDATE OR DELETE ON "PlatformConfigVersion" FOR EACH ROW EXECUTE FUNCTION platform_config_immutable();
CREATE TRIGGER "PlatformConfigEvent_immutable" BEFORE UPDATE OR DELETE ON "PlatformConfigEvent" FOR EACH ROW EXECUTE FUNCTION platform_config_immutable();
CREATE TRIGGER "PlatformMaintenanceRelease_immutable" BEFORE UPDATE OR DELETE ON "PlatformMaintenanceRelease" FOR EACH ROW EXECUTE FUNCTION platform_config_immutable();
CREATE FUNCTION platform_config_target_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['spaceId','scopeId','userId','groupId'])=(to_jsonb(OLD)-ARRAY['spaceId','scopeId','userId','groupId'])
 AND (NEW."spaceId" IS NULL OR NEW."spaceId" IS NOT DISTINCT FROM OLD."spaceId")
 AND (NEW."scopeId" IS NULL OR NEW."scopeId" IS NOT DISTINCT FROM OLD."scopeId")
 AND (NEW."userId" IS NULL OR NEW."userId" IS NOT DISTINCT FROM OLD."userId")
 AND (NEW."groupId" IS NULL OR NEW."groupId" IS NOT DISTINCT FROM OLD."groupId") AND pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Immutable configuration target'; END $$;
CREATE TRIGGER "PlatformConfigTarget_immutable" BEFORE UPDATE OR DELETE ON "PlatformConfigTarget" FOR EACH ROW EXECUTE FUNCTION platform_config_target_immutable();
INSERT INTO "PlatformConfigEpoch"(id) VALUES ('GLOBAL');
ALTER TABLE "AdminSecurityApproval" DROP CONSTRAINT "AdminSecurityApproval_action_check";
ALTER TABLE "AdminSecurityApproval" ADD CONSTRAINT "AdminSecurityApproval_action_check" CHECK(action IN ('MFA_RECOVERY','SECURITY_POLICY','CONFIG_PUBLICATION','CONFIG_KILL_RELEASE','MAINTENANCE_REOPEN'));
ALTER TABLE "AdminSecurityApproval" DROP CONSTRAINT "AdminSecurityApproval_check2";
ALTER TABLE "AdminSecurityApproval" ADD CONSTRAINT "AdminSecurityApproval_check2" CHECK((action='MFA_RECOVERY' AND "targetAdminId" IS NOT NULL) OR (action IN ('SECURITY_POLICY','CONFIG_PUBLICATION','CONFIG_KILL_RELEASE','MAINTENANCE_REOPEN') AND "targetAdminId" IS NULL));
ALTER TABLE "PlatformConfigVersion" ADD CONSTRAINT "PlatformConfigVersion_approvalId_fk" FOREIGN KEY ("approvalId") REFERENCES "AdminSecurityApproval"(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigVersion" ADD CONSTRAINT "PlatformConfigVersion_source_fk" FOREIGN KEY ("sourceVersionId","definitionId") REFERENCES "PlatformConfigVersion"(id,"definitionId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "PlatformConfigDraft" ADD CONSTRAINT "PlatformConfigDraft_source_fk" FOREIGN KEY ("sourceVersionId","definitionId") REFERENCES "PlatformConfigVersion"(id,"definitionId") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "PlatformConfigEvent_transition_key" ON "PlatformConfigEvent"("versionId",kind) WHERE kind IN ('ACTIVATED','ACTIVATION_DENIED','EXPIRED','REOPENED');
COMMIT;
