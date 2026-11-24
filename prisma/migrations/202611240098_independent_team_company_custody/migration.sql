BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Owner-approved one-way Team exception, 2026-11-24. No Project/general transfer activation.
ALTER TABLE "Team" DROP CONSTRAINT "Team_check";
ALTER TABLE "Team" ADD CONSTRAINT "Team_identity_scope" CHECK(id="scopeId");
ALTER TABLE "Team" DROP CONSTRAINT "Team_spaceId_key";
CREATE FUNCTION p1_team_move_allowed(source uuid,destination uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "CompanyCustodyTransfer" t WHERE t.id::text=current_setting('planner.team_transfer_id',true)
 AND t.state='APPLYING' AND t."sourceTeamId"=source AND t."sourceProjectId" IS NULL
 AND t."sourceCustodyId"=source AND t."companyId"=destination
 AND t.manifest->>'protocol'='P1_INDEPENDENT_TEAM_V1' AND t."expiresAt">clock_timestamp()
 AND t."startedAt">clock_timestamp()-interval '5 minutes')
$$;
ALTER TABLE "ContextAccess" ALTER CONSTRAINT "ContextAccess_spaceId_actorId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ContextAccess" ALTER CONSTRAINT "ContextAccess_spaceId_scopeId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ContextCapabilityPolicy" ALTER CONSTRAINT "ContextCapabilityPolicy_spaceId_publishedByActorId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ContextCapabilityPolicy" ALTER CONSTRAINT "ContextCapabilityPolicy_spaceId_scopeId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "Team" ALTER CONSTRAINT "Team_spaceId_createdByActorId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "Team" ALTER CONSTRAINT "Team_spaceId_scopeId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "SharedAuditEvent" ALTER CONSTRAINT "SharedAuditEvent_spaceId_actorId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "SharedOutboxEvent" ALTER CONSTRAINT "SharedOutboxEvent_spaceId_actorId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "SharedUsageEntry" ALTER CONSTRAINT "SharedUsageEntry_spaceId_subjectActorId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
CREATE OR REPLACE FUNCTION company_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.kind='ROOT' AND NEW.kind='TEAM' AND NEW.id=OLD.id AND p1_team_move_allowed(OLD."spaceId",NEW."spaceId") AND (to_jsonb(NEW)-ARRAY['spaceId','kind','authorizationVersion','restoreGeneration']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['spaceId','kind','authorizationVersion','restoreGeneration']) AND NEW."restoreGeneration"=OLD."restoreGeneration"+1 AND NEW."authorizationVersion"=OLD."authorizationVersion"+1 THEN RETURN NEW; END IF;

 IF NEW.kind<>'ROOT' AND NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Child context requires Company custody' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW."spaceId",NEW.kind) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD.kind) THEN RAISE EXCEPTION 'Immutable context identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION shared_access_generation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.id=OLD.id AND p1_team_move_allowed(OLD."spaceId",NEW."spaceId") AND NEW."scopeId"=OLD."scopeId" AND NEW."actorId"=OLD."actorId" AND NEW.state='REVOKED' AND NEW."memberRole" IS NULL AND NEW.generation=OLD.generation AND NEW.revision=OLD.revision+1 AND NEW."joinedAt"=OLD."joinedAt" AND NEW."endedAt" IS NOT NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.generation <> 1 THEN RAISE EXCEPTION 'Initial admission generation must be one' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW."spaceId",NEW."scopeId",NEW."actorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."actorId") THEN
    RAISE EXCEPTION 'Admission identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.generation <> OLD.generation THEN
    IF NEW.generation <> OLD.generation+1 OR OLD.state NOT IN ('LEFT','REVOKED','ERASED') OR NEW.state <> 'ACTIVE' OR NEW."joinedAt" < OLD."endedAt" THEN
      RAISE EXCEPTION 'Invalid admission generation transition' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."joinedAt" IS DISTINCT FROM OLD."joinedAt" OR (OLD.state IN ('LEFT','REVOKED','ERASED') AND NEW.state IN ('ACTIVE','SUSPENDED')) THEN
    RAISE EXCEPTION 'Readmission requires a new immutable interval' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION shared_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE role_name text; caps jsonb; cap text; catalog text[];
BEGIN
 IF TG_TABLE_NAME='ContextCapabilityPolicy' AND TG_OP='UPDATE' AND p1_team_move_allowed(OLD."spaceId",NEW."spaceId") AND (to_jsonb(NEW)-'spaceId') IS NOT DISTINCT FROM (to_jsonb(OLD)-'spaceId') THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Published policy is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'SharedRetentionPolicy' THEN RETURN NEW; END IF;
  SELECT CASE WHEN kind='COMPANY' THEN ARRAY['OWNER','ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER'] WHEN kind='TEAM' THEN ARRAY['OWNER','ADMIN','LEAD','MEMBER','VIEWER'] ELSE ARRAY['OWNER','ADMIN','MANAGER','MEMBER','VIEWER'] END INTO catalog FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
  IF catalog IS NULL OR NOT (NEW."roleDefaults" ?& catalog) OR (SELECT count(*) FROM jsonb_object_keys(NEW."roleDefaults")) <> cardinality(catalog) THEN
    RAISE EXCEPTION 'Exact context role catalog required' USING ERRCODE = '23514';
  END IF;
  FOR role_name,caps IN SELECT * FROM jsonb_each(NEW."roleDefaults") LOOP
    IF jsonb_typeof(caps) <> 'array' THEN RAISE EXCEPTION 'Capabilities must be arrays' USING ERRCODE = '23514'; END IF;
    FOR cap IN SELECT jsonb_array_elements_text(caps) LOOP
      IF (catalog @> ARRAY['ORG_ADMIN'] AND cap<>'task.read') OR cap IS NULL OR cap NOT IN ('task.read','task.create','task.update','task.complete','task.delete','assignment.accept','assignment.decline','assignment.assign','workflow.transition','workflow.publish','export.visible','file.read')
        OR (role_name = 'VIEWER' AND cap NOT IN ('task.read','export.visible','file.read'))
        OR (role_name = 'MEMBER' AND cap IN ('task.delete','workflow.publish')) THEN
        RAISE EXCEPTION 'Capability exceeds fixed ordinary-role ceiling' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION shared_space_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' AND OLD.kind='SHARED' AND EXISTS(SELECT 1 FROM "CompanyCustodyTransfer" t WHERE t."sourceCustodyId"=OLD.id AND p1_team_move_allowed(OLD.id,t."companyId")) AND NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=OLD.id) THEN RETURN OLD; END IF;

  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId") THEN
    RAISE EXCEPTION 'Space identity and Personal owner are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.kind = 'SHARED' AND NOT EXISTS (SELECT 1 FROM "SharedLifecycleJob" WHERE "custodyId" = OLD.id AND state = 'DELETED') THEN
    RAISE EXCEPTION 'Shared space deletion requires completed lifecycle' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION shared_domain_root_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_TABLE_NAME='Team' AND NEW.id=NEW."scopeId" AND NEW."spaceId"<>NEW.id THEN
  IF TG_OP='UPDATE' AND NEW.id=OLD.id AND NEW."scopeId"=OLD."scopeId" AND (to_jsonb(NEW)-'spaceId') IS NOT DISTINCT FROM (to_jsonb(OLD)-'spaceId') AND p1_team_move_allowed(OLD."spaceId",NEW."spaceId") THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW."spaceId"=OLD."spaceId" AND (NEW.id,NEW."scopeId",NEW."createdByActorId",NEW."creationKey",NEW."creationFingerprint",NEW."createdAt") IS NOT DISTINCT FROM (OLD.id,OLD."scopeId",OLD."createdByActorId",OLD."creationKey",OLD."creationFingerprint",OLD."createdAt") AND EXISTS(SELECT 1 FROM "DomainScopeCustody" d JOIN "CompanyCustodyTransfer" t ON t.id=d."transferId" WHERE d."teamId"=NEW.id AND d."spaceId"=NEW."spaceId" AND d.kind='TEAM' AND t.state='APPLIED') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Unapproved Team custody transition' USING ERRCODE='23514';
 END IF;

 IF NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind=upper(TG_TABLE_NAME)) THEN
  RAISE EXCEPTION 'Wrong domain custody' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdByActorId",NEW."creationKey",NEW."creationFingerprint",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdByActorId",OLD."creationKey",OLD."creationFingerprint",OLD."createdAt") THEN
  RAISE EXCEPTION 'Immutable domain identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION p1_team_transfer_direction_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.state='PREVIEWED' AND NEW.state='APPLYING' AND (NEW."sourceTeamId" IS NULL OR NEW."sourceProjectId" IS NOT NULL OR NEW.manifest->>'protocol' IS DISTINCT FROM 'P1_INDEPENDENT_TEAM_V1' OR NOT EXISTS(SELECT 1 FROM "Team" t JOIN "SharedCustody" c ON c."spaceId"=t."spaceId" WHERE t.id=NEW."sourceTeamId" AND t.id=t."spaceId" AND c.kind='TEAM' AND c.state='ACTIVE') OR EXISTS(SELECT 1 FROM "DomainScopeCustody" WHERE "scopeId"=NEW."sourceCustodyId")) THEN RAISE EXCEPTION 'Only Independent Team to Company custody is executable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyCustodyTransfer_p1_direction" BEFORE UPDATE ON "CompanyCustodyTransfer" FOR EACH ROW EXECUTE FUNCTION p1_team_transfer_direction_guard();
COMMIT;
