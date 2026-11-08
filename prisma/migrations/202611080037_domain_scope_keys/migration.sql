BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "TeamPlan" ADD COLUMN "scopeId" uuid DEFAULT NULL::uuid;
ALTER TABLE "TeamWorkItem" ADD COLUMN "scopeId" uuid DEFAULT NULL::uuid;
ALTER TABLE "TeamCaseEntry" ADD COLUMN "scopeId" uuid DEFAULT NULL::uuid;
ALTER TABLE "TeamDisclosure" ADD COLUMN "scopeId" uuid DEFAULT NULL::uuid;
ALTER TABLE "TeamMeeting" ADD COLUMN "scopeId" uuid DEFAULT NULL::uuid;
ALTER TABLE "TeamWorkItem" ADD COLUMN "sourceScopeId" uuid DEFAULT NULL::uuid;
ALTER TABLE "SharedAuditEvent" ADD COLUMN "scopeId" uuid;
ALTER TABLE "SharedAuditEvent" ADD COLUMN "originCustodyId" uuid;
UPDATE "SharedAuditEvent" e SET "scopeId"=e."spaceId" FROM "SharedCustody" c WHERE c."spaceId"=e."spaceId" AND c.kind IN ('PROJECT','TEAM');
ALTER TABLE "SharedOutboxEvent" ADD COLUMN "scopeId" uuid;
ALTER TABLE "SharedOutboxEvent" ADD COLUMN "originCustodyId" uuid;
UPDATE "SharedOutboxEvent" e SET "scopeId"=e."spaceId" FROM "SharedCustody" c WHERE c."spaceId"=e."spaceId" AND c.kind IN ('PROJECT','TEAM');
ALTER TABLE "SharedUsageEntry" ADD COLUMN "scopeId" uuid;
ALTER TABLE "SharedUsageEntry" ADD COLUMN "originCustodyId" uuid;
UPDATE "SharedUsageEntry" e SET "scopeId"=e."spaceId" FROM "SharedCustody" c WHERE c."spaceId"=e."spaceId" AND c.kind IN ('PROJECT','TEAM');
CREATE OR REPLACE FUNCTION team_plan_shape()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'scopeId') IS NULL AND (to_jsonb(NEW)->>'scopeId')=(to_jsonb(OLD)->>'spaceId') AND (to_jsonb(NEW)-ARRAY['scopeId','sourceScopeId']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['scopeId','sourceScopeId']) AND ((to_jsonb(NEW)->>'sourceScopeId') IS NULL OR (to_jsonb(NEW)->>'sourceScopeId')=(to_jsonb(OLD)->>'sourceSpaceId')) THEN RETURN NEW; END IF;

 IF (NEW.id,NEW."spaceId",NEW.kind,NEW."startDate",NEW."endDate",NEW.timezone,NEW."createdByActorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD.kind,OLD."startDate",OLD."endDate",OLD.timezone,OLD."createdByActorId") OR NEW.revision<>OLD.revision+1 OR (NEW.state<>OLD.state AND NOT ((OLD.state='DRAFT' AND NEW.state='ACTIVE') OR (OLD.state='ACTIVE' AND NEW.state='CLOSED'))) THEN RAISE EXCEPTION 'Invalid Team plan transition' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $function$;
CREATE OR REPLACE FUNCTION team_item_shape()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'scopeId') IS NULL AND (to_jsonb(NEW)->>'scopeId')=(to_jsonb(OLD)->>'spaceId') AND (to_jsonb(NEW)-ARRAY['scopeId','sourceScopeId']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['scopeId','sourceScopeId']) AND ((to_jsonb(NEW)->>'sourceScopeId') IS NULL OR (to_jsonb(NEW)->>'sourceScopeId')=(to_jsonb(OLD)->>'sourceSpaceId')) THEN RETURN NEW; END IF;

 IF NOT EXISTS(SELECT 1 FROM "Team" WHERE "spaceId"=NEW."sourceSpaceId" AND "spaceId"=NEW."spaceId" UNION ALL SELECT 1 FROM "TeamProjectReference" r JOIN "Project" p ON p.id=r."projectId" WHERE r."teamId"=NEW."spaceId" AND r."spaceId"=NEW."sourceSpaceId" AND r.active) THEN RAISE EXCEPTION 'Work reference requires its Team or an explicitly referenced Project' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW."spaceId",NEW."sourceSpaceId",NEW."taskId",NEW."goalId",NEW."createdByActorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."sourceSpaceId",OLD."taskId",OLD."goalId",OLD."createdByActorId") OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable Team work reference' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $function$;
CREATE OR REPLACE FUNCTION team_interaction_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
DECLARE mutable text[];
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'scopeId') IS NULL AND (to_jsonb(NEW)->>'scopeId')=(to_jsonb(OLD)->>'spaceId') AND (to_jsonb(NEW)-ARRAY['scopeId','sourceScopeId']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['scopeId','sourceScopeId']) AND ((to_jsonb(NEW)->>'sourceScopeId') IS NULL OR (to_jsonb(NEW)->>'sourceScopeId')=(to_jsonb(OLD)->>'sourceSpaceId')) THEN RETURN NEW; END IF;

 IF TG_TABLE_NAME IN ('TeamCaseEntry','TeamDisclosureRecipient') THEN RAISE EXCEPTION 'Immutable Team history' USING ERRCODE='23514'; END IF;
 mutable:=CASE TG_TABLE_NAME WHEN 'TeamCase' THEN ARRAY['revision','state'] WHEN 'TeamMeeting' THEN ARRAY['revision','agenda'] WHEN 'TeamDisclosure' THEN ARRAY['revision','state','reviewNote','reviewedAt','subjectConsentedAt'] ELSE ARRAY['revision','state'] END;
 IF (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Team record or invalid revision' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='TeamDisclosure' THEN
  IF (OLD.state IN ('REJECTED','REVOKED') AND NEW.state<>'REVOKED') OR (OLD.state='APPROVED' AND NEW.state NOT IN ('APPROVED','REVOKED')) THEN RAISE EXCEPTION 'Terminal disclosure decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='TeamMeetingInvitation' THEN
  IF OLD.state<>'PENDING' AND NEW.state<>'REVOKED' THEN RAISE EXCEPTION 'Terminal invitation decision' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END; $function$;
UPDATE "TeamPlan" SET "scopeId"="spaceId";
ALTER TABLE "TeamPlan" ALTER COLUMN "scopeId" SET NOT NULL;
UPDATE "TeamWorkItem" SET "scopeId"="spaceId","sourceScopeId"="sourceSpaceId";
ALTER TABLE "TeamWorkItem" ALTER COLUMN "scopeId" SET NOT NULL;
UPDATE "TeamCaseEntry" SET "scopeId"="spaceId";
ALTER TABLE "TeamCaseEntry" ALTER COLUMN "scopeId" SET NOT NULL;
UPDATE "TeamDisclosure" SET "scopeId"="spaceId";
ALTER TABLE "TeamDisclosure" ALTER COLUMN "scopeId" SET NOT NULL;
UPDATE "TeamMeeting" SET "scopeId"="spaceId";
ALTER TABLE "TeamMeeting" ALTER COLUMN "scopeId" SET NOT NULL;
ALTER TABLE "TeamWorkItem" ALTER COLUMN "sourceScopeId" SET NOT NULL;
CREATE OR REPLACE FUNCTION team_plan_shape()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)->'scopeId') IS DISTINCT FROM (to_jsonb(OLD)->'scopeId') OR (to_jsonb(NEW)->'sourceScopeId') IS DISTINCT FROM (to_jsonb(OLD)->'sourceScopeId')) THEN RAISE EXCEPTION 'Immutable source scope identity' USING ERRCODE='23514'; END IF;

 IF (NEW.id,NEW."spaceId",NEW.kind,NEW."startDate",NEW."endDate",NEW.timezone,NEW."createdByActorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD.kind,OLD."startDate",OLD."endDate",OLD.timezone,OLD."createdByActorId") OR NEW.revision<>OLD.revision+1 OR (NEW.state<>OLD.state AND NOT ((OLD.state='DRAFT' AND NEW.state='ACTIVE') OR (OLD.state='ACTIVE' AND NEW.state='CLOSED'))) THEN RAISE EXCEPTION 'Invalid Team plan transition' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $function$;
CREATE OR REPLACE FUNCTION team_item_shape()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)->'scopeId') IS DISTINCT FROM (to_jsonb(OLD)->'scopeId') OR (to_jsonb(NEW)->'sourceScopeId') IS DISTINCT FROM (to_jsonb(OLD)->'sourceScopeId')) THEN RAISE EXCEPTION 'Immutable source scope identity' USING ERRCODE='23514'; END IF;

 IF NOT EXISTS(SELECT 1 FROM "Team" WHERE "spaceId"=NEW."sourceSpaceId" AND "spaceId"=NEW."spaceId" UNION ALL SELECT 1 FROM "TeamProjectReference" r JOIN "Project" p ON p.id=r."projectId" WHERE r."teamId"=NEW."spaceId" AND r."spaceId"=NEW."sourceSpaceId" AND r.active) THEN RAISE EXCEPTION 'Work reference requires its Team or an explicitly referenced Project' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW."spaceId",NEW."sourceSpaceId",NEW."taskId",NEW."goalId",NEW."createdByActorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."sourceSpaceId",OLD."taskId",OLD."goalId",OLD."createdByActorId") OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable Team work reference' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $function$;
CREATE OR REPLACE FUNCTION team_interaction_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
DECLARE mutable text[];
BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)->'scopeId') IS DISTINCT FROM (to_jsonb(OLD)->'scopeId') OR (to_jsonb(NEW)->'sourceScopeId') IS DISTINCT FROM (to_jsonb(OLD)->'sourceScopeId')) THEN RAISE EXCEPTION 'Immutable source scope identity' USING ERRCODE='23514'; END IF;

 IF TG_TABLE_NAME IN ('TeamCaseEntry','TeamDisclosureRecipient') THEN RAISE EXCEPTION 'Immutable Team history' USING ERRCODE='23514'; END IF;
 mutable:=CASE TG_TABLE_NAME WHEN 'TeamCase' THEN ARRAY['revision','state'] WHEN 'TeamMeeting' THEN ARRAY['revision','agenda'] WHEN 'TeamDisclosure' THEN ARRAY['revision','state','reviewNote','reviewedAt','subjectConsentedAt'] ELSE ARRAY['revision','state'] END;
 IF (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Team record or invalid revision' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='TeamDisclosure' THEN
  IF (OLD.state IN ('REJECTED','REVOKED') AND NEW.state<>'REVOKED') OR (OLD.state='APPROVED' AND NEW.state NOT IN ('APPROVED','REVOKED')) THEN RAISE EXCEPTION 'Terminal disclosure decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='TeamMeetingInvitation' THEN
  IF OLD.state<>'PENDING' AND NEW.state<>'REVOKED' THEN RAISE EXCEPTION 'Terminal invitation decision' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END; $function$;
CREATE FUNCTION domain_scope_insert_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE expected uuid;
BEGIN
 IF NEW."scopeId" IS NULL THEN
  IF TG_TABLE_NAME IN ('TeamCaseEntry','TeamDisclosure') THEN SELECT "scopeId" INTO expected FROM "TeamCase" WHERE id=NEW."caseId" AND "spaceId"=NEW."spaceId";
  ELSIF TG_TABLE_NAME='TeamMeeting' THEN SELECT "scopeId" INTO expected FROM "CalendarEvent" WHERE id=NEW."eventId" AND "spaceId"=NEW."spaceId";
  ELSE SELECT "scopeId" INTO expected FROM "Team" WHERE id=NEW."spaceId" AND "spaceId"=NEW."spaceId"; END IF;
  NEW."scopeId":=expected;
 END IF;
 IF TG_TABLE_NAME='TeamWorkItem' THEN
 IF NEW."sourceScopeId" IS NULL THEN
  IF NEW."taskId" IS NOT NULL THEN SELECT "scopeId" INTO expected FROM "Task" WHERE id=NEW."taskId" AND "spaceId"=NEW."sourceSpaceId";
  ELSE SELECT "scopeId" INTO expected FROM "Goal" WHERE id=NEW."goalId" AND "spaceId"=NEW."sourceSpaceId"; END IF;
  NEW."sourceScopeId":=expected;
 END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "A_TeamPlan_scope_defaults" BEFORE INSERT ON "TeamPlan" FOR EACH ROW EXECUTE FUNCTION domain_scope_insert_defaults();
CREATE TRIGGER "A_TeamWorkItem_scope_defaults" BEFORE INSERT ON "TeamWorkItem" FOR EACH ROW EXECUTE FUNCTION domain_scope_insert_defaults();
CREATE TRIGGER "A_TeamCaseEntry_scope_defaults" BEFORE INSERT ON "TeamCaseEntry" FOR EACH ROW EXECUTE FUNCTION domain_scope_insert_defaults();
CREATE TRIGGER "A_TeamDisclosure_scope_defaults" BEFORE INSERT ON "TeamDisclosure" FOR EACH ROW EXECUTE FUNCTION domain_scope_insert_defaults();
CREATE TRIGGER "A_TeamMeeting_scope_defaults" BEFORE INSERT ON "TeamMeeting" FOR EACH ROW EXECUTE FUNCTION domain_scope_insert_defaults();
ALTER TABLE "Team" ADD CONSTRAINT "Team_domain_scope_key" UNIQUE ("spaceId","scopeId");
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_domain_scope_key" UNIQUE ("spaceId","scopeId","id");
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_domain_scope_key" UNIQUE ("spaceId","scopeId","id");
ALTER TABLE "TeamDisclosure" ADD CONSTRAINT "TeamDisclosure_domain_scope_key" UNIQUE ("spaceId","scopeId","id");
ALTER TABLE "TeamMeeting" ADD CONSTRAINT "TeamMeeting_domain_scope_key" UNIQUE ("spaceId","scopeId","id");
ALTER TABLE "TeamCapacityDay" DROP CONSTRAINT "TeamCapacityDay_team";
ALTER TABLE "TeamCapacityDay" ADD CONSTRAINT "TeamCapacityDay_team" FOREIGN KEY ("spaceId","scopeId") REFERENCES "Team" ("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCase" DROP CONSTRAINT "TeamCase_Team";
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_Team" FOREIGN KEY ("spaceId","scopeId") REFERENCES "Team" ("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeeting" DROP CONSTRAINT "TeamMeeting_Team";
ALTER TABLE "TeamMeeting" ADD CONSTRAINT "TeamMeeting_Team" FOREIGN KEY ("spaceId","scopeId") REFERENCES "Team" ("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamPlan" DROP CONSTRAINT "TeamPlan_spaceId_fkey";
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_spaceId_fkey" FOREIGN KEY ("spaceId","scopeId") REFERENCES "Team" ("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamWorkItem" DROP CONSTRAINT "TeamWorkItem_spaceId_fkey";
ALTER TABLE "TeamWorkItem" ADD CONSTRAINT "TeamWorkItem_spaceId_fkey" FOREIGN KEY ("spaceId","scopeId") REFERENCES "Team" ("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamWorkItem" DROP CONSTRAINT "TeamWorkItem_spaceId_planId_fkey";
ALTER TABLE "TeamWorkItem" ADD CONSTRAINT "TeamWorkItem_spaceId_planId_fkey" FOREIGN KEY ("spaceId","scopeId","planId") REFERENCES "TeamPlan" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamWorkItem" DROP CONSTRAINT "TeamWorkItem_sourceSpaceId_taskId_fkey";
ALTER TABLE "TeamWorkItem" ADD CONSTRAINT "TeamWorkItem_sourceSpaceId_taskId_fkey" FOREIGN KEY ("sourceSpaceId","sourceScopeId","taskId") REFERENCES "Task" ("spaceId","scopeId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "TeamWorkItem" DROP CONSTRAINT "TeamWorkItem_sourceSpaceId_goalId_fkey";
ALTER TABLE "TeamWorkItem" ADD CONSTRAINT "TeamWorkItem_sourceSpaceId_goalId_fkey" FOREIGN KEY ("sourceSpaceId","sourceScopeId","goalId") REFERENCES "Goal" ("spaceId","scopeId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "TeamCaseEntry" DROP CONSTRAINT "TeamCaseEntry_Case";
ALTER TABLE "TeamCaseEntry" ADD CONSTRAINT "TeamCaseEntry_Case" FOREIGN KEY ("spaceId","scopeId","caseId") REFERENCES "TeamCase" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamDisclosure" DROP CONSTRAINT "TeamDisclosure_Case";
ALTER TABLE "TeamDisclosure" ADD CONSTRAINT "TeamDisclosure_Case" FOREIGN KEY ("spaceId","scopeId","caseId") REFERENCES "TeamCase" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamDisclosureRecipient" DROP CONSTRAINT "TeamDisclosureRecipient_Disclosure";
ALTER TABLE "TeamDisclosureRecipient" ADD CONSTRAINT "TeamDisclosureRecipient_Disclosure" FOREIGN KEY ("spaceId","scopeId","disclosureId") REFERENCES "TeamDisclosure" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeeting" DROP CONSTRAINT "TeamMeeting_Event";
ALTER TABLE "TeamMeeting" ADD CONSTRAINT "TeamMeeting_Event" FOREIGN KEY ("spaceId","scopeId","eventId") REFERENCES "CalendarEvent" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeetingInvitation" DROP CONSTRAINT "TeamMeetingInvitation_Meeting";
ALTER TABLE "TeamMeetingInvitation" ADD CONSTRAINT "TeamMeetingInvitation_Meeting" FOREIGN KEY ("spaceId","scopeId","meetingId") REFERENCES "TeamMeeting" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE FUNCTION company_custody_require_consent(plan "CompanyCustodyTransfer") RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source "SharedCustody"; company "SharedCustody"; source_owner "ContextAccess"; company_owner "ContextAccess"; participant "SharedActor";
BEGIN
 SELECT * INTO source FROM "SharedCustody" WHERE "spaceId"=plan."sourceCustodyId";
 SELECT * INTO company FROM "SharedCustody" WHERE "spaceId"=plan."companyId";
 SELECT * INTO source_owner FROM "ContextAccess" WHERE id=source."primaryOwnerAccessId";
 SELECT * INTO company_owner FROM "ContextAccess" WHERE id=company."primaryOwnerAccessId";
 IF source.state IS DISTINCT FROM 'ACTIVE' OR company.state IS DISTINCT FROM 'ACTIVE' OR company.kind IS DISTINCT FROM 'COMPANY' OR source.kind IS DISTINCT FROM (CASE WHEN plan."sourceProjectId" IS NOT NULL THEN 'PROJECT' ELSE 'TEAM' END)
 OR source."authorizationVersion"<>plan."sourceVersion" OR company."authorizationVersion"<plan."companyVersion" OR source."retentionPolicyVersion"<>plan."retentionPolicyVersion"
 OR (source_owner.id,source_owner.generation) IS DISTINCT FROM (plan."sourceOwnerAccessId",plan."sourceOwnerGeneration") OR source_owner.state IS DISTINCT FROM 'ACTIVE'
 OR (company_owner.id,company_owner.generation) IS DISTINCT FROM (plan."companyOwnerAccessId",plan."companyOwnerGeneration") OR company_owner.state IS DISTINCT FROM 'ACTIVE'
 OR plan."expiresAt"<=clock_timestamp() OR jsonb_typeof(plan.manifest) IS DISTINCT FROM 'object'
 OR encode(sha256(convert_to(plan.manifest::text,'UTF8')),'hex')<>plan."manifestHash"
 OR NOT EXISTS(SELECT 1 FROM "AccessScope" WHERE "spaceId"=plan."companyId" AND id=plan."parentScopeId" AND kind IN ('DEPARTMENT','UNIT') AND state='ACTIVE') THEN
 RAISE EXCEPTION 'Current reviewed custody preview required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "SharedActor" a WHERE a."spaceId"=plan."sourceCustodyId" AND (a.state<>'ACTIVE' OR a."userId" IS NULL)) THEN RAISE EXCEPTION 'Required participant consent unavailable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "CompanyCustodyConsent" WHERE "transferId"=plan.id AND purpose='SOURCE_OWNER' AND "sourceActorId"=source_owner."actorId" AND decision='ACCEPTED' AND "manifestHash"=plan."manifestHash" AND "reauthenticatedAt">clock_timestamp()-interval '5 minutes')
 OR NOT EXISTS(SELECT 1 FROM "CompanyCustodyConsent" WHERE "transferId"=plan.id AND purpose='COMPANY_OWNER' AND "sourceActorId"=company_owner."actorId" AND decision='ACCEPTED' AND "manifestHash"=plan."manifestHash" AND "reauthenticatedAt">clock_timestamp()-interval '5 minutes') THEN
 RAISE EXCEPTION 'Both current owners must approve custody' USING ERRCODE='23514'; END IF;
 FOR participant IN SELECT * FROM "SharedActor" WHERE "spaceId"=plan."sourceCustodyId" LOOP
  IF NOT EXISTS(SELECT 1 FROM "CompanyCustodyConsent" WHERE "transferId"=plan.id AND "sourceActorId"=participant.id AND purpose='PARTICIPANT' AND decision='ACCEPTED' AND "manifestHash"=plan."manifestHash" AND "reauthenticatedAt">clock_timestamp()-interval '5 minutes') THEN RAISE EXCEPTION 'Every affected participant must consent to custody' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM "CompanyCustodyConsent" p JOIN "SharedActor" a ON a.id=p."sourceActorId" LEFT JOIN "ContextAccess" old ON old.id=p."sourceAccessId" LEFT JOIN "ContextAccess" root ON root.id=p."destinationRootAccessId" AND root.generation=p."destinationRootGeneration" LEFT JOIN "SharedActor" destination ON destination.id=root."actorId" WHERE p."transferId"=plan.id AND p.purpose='PARTICIPANT' AND p."sourceAccessId" IS NOT NULL AND (old."spaceId" IS DISTINCT FROM plan."sourceCustodyId" OR old."scopeId" IS DISTINCT FROM plan."sourceCustodyId" OR old."actorId" IS DISTINCT FROM a.id OR old.generation IS DISTINCT FROM p."sourceGeneration" OR old.state NOT IN ('ACTIVE','SUSPENDED') OR old."memberRole" IS DISTINCT FROM p."destinationRole" OR root."spaceId" IS DISTINCT FROM plan."companyId" OR root."scopeId" IS DISTINCT FROM plan."companyId" OR root.state IS DISTINCT FROM 'ACTIVE' OR root."memberRole" IS NULL OR destination."userId" IS DISTINCT FROM a."userId")) THEN RAISE EXCEPTION 'Explicit current destination admissions and role mappings required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "ContextAccess" a WHERE a."spaceId"=plan."sourceCustodyId" AND a.state IN ('ACTIVE','SUSPENDED') AND NOT EXISTS(SELECT 1 FROM "CompanyCustodyConsent" p WHERE p."transferId"=plan.id AND p.purpose='PARTICIPANT' AND p."sourceActorId"=a."actorId" AND p."sourceAccessId"=a.id AND p."sourceGeneration"=a.generation)) THEN RAISE EXCEPTION 'Active source admission requires explicit admission consent' USING ERRCODE='23514'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION company_custody_protocol_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE plan "CompanyCustodyTransfer";
BEGIN
 IF TG_TABLE_NAME='CompanyCustodyTransfer' THEN
  IF TG_OP='UPDATE' AND OLD.state='PREVIEWED' AND NEW.state='APPLYING' THEN PERFORM company_custody_require_consent(NEW); END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Custody evidence requires retention disposal' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.state<>'PREVIEWED' THEN RAISE EXCEPTION 'Preview required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['state','revision','appliedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','appliedAt']) THEN RAISE EXCEPTION 'Immutable custody manifest' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.revision<>OLD.revision+1 OR OLD.state IN ('APPLIED','REVOKED') OR NOT ((OLD.state='PREVIEWED' AND NEW.state IN ('PREVIEWED','APPLYING','REVOKED')) OR (OLD.state='APPLYING' AND NEW.state='APPLIED'))) THEN RAISE EXCEPTION 'Invalid custody plan transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Custody evidence requires retention disposal' USING ERRCODE='23514'; END IF;
 SELECT * INTO plan FROM "CompanyCustodyTransfer" WHERE id=NEW."transferId";
 IF NOT FOUND THEN RAISE EXCEPTION 'Custody manifest required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyCustodyConsent' THEN
  IF plan.state<>'PREVIEWED' OR plan."expiresAt"<=clock_timestamp() OR NEW."manifestHash"<>plan."manifestHash" THEN RAISE EXCEPTION 'Current custody preview required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['decision','revision','decidedAt','reauthenticatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['decision','revision','decidedAt','reauthenticatedAt']) OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable custody consent identity' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' AND plan.state<>'APPLYING' THEN RAISE EXCEPTION 'Applying custody manifest required' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME<>'DomainScopeCustody' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Immutable custody provenance' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='DomainScopeCustody' AND TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','revision','authorizationVersion','primaryOwnerAccessId','closureGeneration']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','authorizationVersion','primaryOwnerAccessId','closureGeneration']) OR NEW.revision<>OLD.revision+1 OR NEW."authorizationVersion"<OLD."authorizationVersion" OR NEW."closureGeneration"<OLD."closureGeneration") THEN RAISE EXCEPTION 'Immutable scoped custody identity' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION company_custody_receipt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE plan "CompanyCustodyTransfer";
BEGIN
 SELECT * INTO plan FROM "CompanyCustodyTransfer" WHERE id=NEW.id;
 IF plan.state='APPLYING' OR (plan.state='APPLIED' AND (EXISTS(SELECT 1 FROM "Space" WHERE id=plan."sourceCustodyId") OR NOT EXISTS(SELECT 1 FROM "DomainScopeCustody" d WHERE d."transferId"=plan.id AND d."spaceId"=plan."companyId" AND d."scopeId"=plan."sourceCustodyId" AND d."retentionPolicyVersion"=plan."retentionPolicyVersion"))) THEN RAISE EXCEPTION 'Custody receipt requires complete atomic graph migration' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "CompanyCustodyTransfer_applied" AFTER INSERT OR UPDATE ON "CompanyCustodyTransfer" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION company_custody_receipt_guard();

COMMIT;
