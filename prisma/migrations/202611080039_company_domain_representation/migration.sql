BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "SharedActor" ADD COLUMN "originCustodyId" uuid;
ALTER TABLE "SharedActor" DROP CONSTRAINT "SharedActor_state_check";
ALTER TABLE "SharedActor" DROP CONSTRAINT "SharedActor_check";
ALTER TABLE "SharedActor" ADD CONSTRAINT "SharedActor_state_check" CHECK(state IN ('ACTIVE','ERASED','HISTORICAL'));
ALTER TABLE "SharedActor" ADD CONSTRAINT "SharedActor_check" CHECK(
 (state='ACTIVE' AND "userId" IS NOT NULL AND "erasedAt" IS NULL AND "originCustodyId" IS NULL) OR
 (state='ERASED' AND "userId" IS NULL AND "erasedAt" IS NOT NULL AND "originCustodyId" IS NULL) OR
 (state='HISTORICAL' AND "userId" IS NULL AND "erasedAt" IS NULL AND "originCustodyId" IS NOT NULL AND "originCustodyId"<>"spaceId")
);
ALTER TABLE "AccessScope" DROP CONSTRAINT "AccessScope_kind_check";
ALTER TABLE "AccessScope" DROP CONSTRAINT "AccessScope_check";
ALTER TABLE "AccessScope" ADD CONSTRAINT "AccessScope_kind_check" CHECK(kind IN ('ROOT','DEPARTMENT','UNIT','PROJECT','TEAM'));
ALTER TABLE "AccessScope" ADD CONSTRAINT "AccessScope_check" CHECK((kind='ROOT' AND id="spaceId") OR (kind IN ('DEPARTMENT','UNIT','PROJECT','TEAM') AND id<>"spaceId"));
ALTER TABLE "DomainScopeCustody" ADD COLUMN kind varchar(7);
ALTER TABLE "DomainScopeCustody" ALTER COLUMN "primaryOwnerAccessId" DROP NOT NULL;
ALTER TABLE "DomainScopeCustody" ALTER COLUMN "transferId" DROP NOT NULL;
ALTER TABLE "DomainScopeCustody" ADD CONSTRAINT "DomainScopeCustody_kind_check" CHECK(kind IN ('PROJECT','TEAM'));
ALTER TABLE "DomainScopeCustody" ADD CONSTRAINT "DomainScopeCustody_kind_shape" CHECK((kind='PROJECT' AND "projectId"="scopeId" AND "teamId" IS NULL) OR (kind='TEAM' AND "teamId"="scopeId" AND "projectId" IS NULL));
ALTER TABLE "DomainScopeCustody" ADD CONSTRAINT "DomainScopeCustody_live_provenance" CHECK(("primaryOwnerAccessId" IS NOT NULL AND "transferId" IS NOT NULL) OR state IN ('CLEANUP_PENDING','WAITING_OBLIGATIONS','BLOCKED_POLICY','PURGING','FAILED','CLOSED'));
ALTER TABLE "CompanyCustodyTransfer" ADD COLUMN "startedAt" timestamptz(3);
ALTER TABLE "CompanyCustodyTransfer" ADD COLUMN "companyRetentionPolicyVersion" varchar(80) DEFAULT NULL::character varying;
ALTER TABLE "SharedLifecycleEffect" ADD COLUMN "spaceId" uuid;
ALTER TABLE "SharedLifecycleEffect" ADD COLUMN "originCustodyId" uuid;
CREATE OR REPLACE FUNCTION company_custody_protocol_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
DECLARE plan "CompanyCustodyTransfer";
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='CompanyCustodyTransfer' AND (to_jsonb(OLD)->>'companyRetentionPolicyVersion') IS NULL AND (to_jsonb(NEW)-'companyRetentionPolicyVersion') IS NOT DISTINCT FROM (to_jsonb(OLD)-'companyRetentionPolicyVersion') AND (to_jsonb(NEW)->>'companyRetentionPolicyVersion')=(SELECT "retentionPolicyVersion" FROM "SharedCustody" WHERE "spaceId"=(to_jsonb(OLD)->>'companyId')::uuid) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='DomainScopeCustody' AND (to_jsonb(OLD)->>'kind') IS NULL AND (to_jsonb(NEW)-'kind') IS NOT DISTINCT FROM (to_jsonb(OLD)-'kind') AND (to_jsonb(NEW)->>'kind')=(CASE WHEN (to_jsonb(OLD)->>'projectId') IS NOT NULL THEN 'PROJECT' ELSE 'TEAM' END) THEN RETURN NEW; END IF;

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
END; $function$;
CREATE OR REPLACE FUNCTION shared_lifecycle_effect_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND OLD."spaceId" IS NULL AND NEW."spaceId"=OLD."custodyId" AND NEW."originCustodyId" IS NULL AND (to_jsonb(NEW)-'spaceId') IS NOT DISTINCT FROM (to_jsonb(OLD)-'spaceId') THEN RETURN NEW; END IF;

 IF TG_OP='DELETE' AND shared_evidence_disposal_allowed(OLD."jobId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Minimal lifecycle control evidence is immutable outside authorized terminal disposal' USING ERRCODE='23514';
END;
$function$;
UPDATE "CompanyCustodyTransfer" t SET "companyRetentionPolicyVersion"=c."retentionPolicyVersion" FROM "SharedCustody" c WHERE c."spaceId"=t."companyId";
UPDATE "DomainScopeCustody" SET kind=CASE WHEN "projectId" IS NOT NULL THEN 'PROJECT' ELSE 'TEAM' END;
UPDATE "SharedLifecycleEffect" e SET "spaceId"=e."custodyId" WHERE EXISTS(SELECT 1 FROM "SharedCustody" c WHERE c."spaceId"=e."custodyId");
ALTER TABLE "CompanyCustodyTransfer" ALTER COLUMN "companyRetentionPolicyVersion" SET NOT NULL;
ALTER TABLE "CompanyCustodyTransfer" ADD CONSTRAINT "CompanyCustodyTransfer_companyRetention" FOREIGN KEY("companyRetentionPolicyVersion") REFERENCES "SharedRetentionPolicy"(version) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "DomainScopeCustody" ALTER COLUMN kind SET NOT NULL;
CREATE OR REPLACE FUNCTION shared_lifecycle_effect_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
BEGIN
 IF TG_OP='DELETE' AND shared_evidence_disposal_allowed(OLD."jobId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Minimal lifecycle control evidence is immutable outside authorized terminal disposal' USING ERRCODE='23514';
END;
$function$;
CREATE OR REPLACE FUNCTION shared_context_role_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE context_kind text; scope_kind text;
BEGIN
 SELECT kind INTO context_kind FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
 SELECT kind INTO scope_kind FROM "AccessScope" WHERE id=NEW."scopeId" AND "spaceId"=NEW."spaceId";
 IF scope_kind IN ('PROJECT','TEAM') THEN context_kind:=scope_kind; END IF;
 IF NEW."memberRole" IS NOT NULL AND ((context_kind='PROJECT' AND NEW."memberRole" NOT IN ('ADMIN','MANAGER','MEMBER','VIEWER')) OR (context_kind='TEAM' AND NEW."memberRole" NOT IN ('ADMIN','LEAD','MEMBER','VIEWER')) OR (context_kind='COMPANY' AND NEW."memberRole" NOT IN ('ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER'))) THEN RAISE EXCEPTION 'Role belongs to another context catalog' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION company_custody_disposal_allowed(plan "CompanyCustodyTransfer") RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT plan.state<>'APPLYING' AND (shared_purge_allowed(plan."companyId") OR shared_purge_allowed(plan."sourceCustodyId") OR EXISTS(SELECT 1 FROM "DomainScopeCustody" d WHERE d."scopeId"=plan."sourceCustodyId" AND shared_domain_purge_allowed(d."spaceId",d."scopeId")))
$$;
CREATE FUNCTION company_domain_disposal_witness_valid(target uuid,source uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "DomainScopeCustody" d JOIN "SharedLifecycleJob" j ON j."spaceId"=d."spaceId" AND j."scopeId"=d."scopeId" AND j."custodyId"=d."scopeId" AND j.generation=d."closureGeneration"
 WHERE d."spaceId"=target AND d."scopeId"=source AND d.state IN ('CLEANUP_PENDING','WAITING_OBLIGATIONS','BLOCKED_POLICY','PURGING','FAILED','CLOSED') AND j.state IN ('CLEANUP_PENDING','WAITING_OBLIGATIONS','BLOCKED_POLICY','PURGING','FAILED','DELETED')
 AND j."retentionPolicyVersion"=d."retentionPolicyVersion" AND j.progress ? 'custodyWitness' AND j.progress->'custodyWitness'->>'companyId'=target::text AND j.progress->'custodyWitness'->>'sourceKind'=d.kind AND j.progress->'custodyWitness'->>'retentionPolicyVersion'=d."retentionPolicyVersion"
 AND j.progress->'custodyWitness'->>'manifestHash' ~ '^[a-f0-9]{64}$' AND j.progress->'custodyWitness'->>'sourceVersion' ~ '^[1-9][0-9]*$')
$$;
CREATE OR REPLACE FUNCTION company_custody_protocol_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE plan "CompanyCustodyTransfer";
BEGIN
 IF TG_TABLE_NAME='CompanyCustodyTransfer' THEN
  IF TG_OP='DELETE' THEN IF company_custody_disposal_allowed(OLD) THEN RETURN OLD; END IF; RAISE EXCEPTION 'Custody evidence requires retention disposal' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF NEW."companyRetentionPolicyVersion" IS NULL THEN SELECT "retentionPolicyVersion" INTO NEW."companyRetentionPolicyVersion" FROM "SharedCustody" WHERE "spaceId"=NEW."companyId"; END IF;
   IF NEW.state<>'PREVIEWED' OR NEW."startedAt" IS NOT NULL THEN RAISE EXCEPTION 'Preview required' USING ERRCODE='23514'; END IF;
  ELSE
   IF OLD.state='PREVIEWED' AND NEW.state='APPLYING' THEN
    PERFORM company_custody_require_consent(NEW);
    IF NEW."companyRetentionPolicyVersion" IS DISTINCT FROM (SELECT "retentionPolicyVersion" FROM "SharedCustody" WHERE "spaceId"=NEW."companyId") THEN RAISE EXCEPTION 'Company custody retention changed' USING ERRCODE='23514'; END IF;
    IF NEW."startedAt" IS NULL OR NEW."startedAt"<NEW."createdAt" OR NEW."startedAt">clock_timestamp() OR NEW."startedAt"<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Current custody execution timestamp required' USING ERRCODE='23514'; END IF;
   ELSIF NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN RAISE EXCEPTION 'Immutable custody execution timestamp' USING ERRCODE='23514'; END IF;
   IF (to_jsonb(NEW)-ARRAY['state','revision','appliedAt','startedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','appliedAt','startedAt']) THEN RAISE EXCEPTION 'Immutable custody manifest' USING ERRCODE='23514'; END IF;
   IF NEW.revision<>OLD.revision+1 OR OLD.state IN ('APPLIED','REVOKED') OR NOT ((OLD.state='PREVIEWED' AND NEW.state IN ('PREVIEWED','APPLYING','REVOKED')) OR (OLD.state='APPLYING' AND NEW.state='APPLIED')) THEN RAISE EXCEPTION 'Invalid custody plan transition' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='DomainScopeCustody' THEN
   IF shared_purge_allowed(OLD."spaceId") OR shared_domain_purge_allowed(OLD."spaceId",OLD."scopeId") THEN RETURN OLD; END IF;
  END IF;
  SELECT * INTO plan FROM "CompanyCustodyTransfer" WHERE id=OLD."transferId";
  IF FOUND AND company_custody_disposal_allowed(plan) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Custody evidence requires retention disposal' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='DomainScopeCustody' AND TG_OP='UPDATE' THEN
  IF OLD."transferId" IS NULL AND company_domain_disposal_witness_valid(OLD."spaceId",OLD."scopeId") AND NEW."transferId" IS NULL AND NEW."primaryOwnerAccessId" IS NULL AND NEW.state IN ('CLEANUP_PENDING','WAITING_OBLIGATIONS','BLOCKED_POLICY','PURGING','FAILED','CLOSED') AND (to_jsonb(NEW)-ARRAY['state','revision','authorizationVersion']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','authorizationVersion']) AND NEW.revision=OLD.revision+1 AND NEW."authorizationVersion">=OLD."authorizationVersion" THEN RETURN NEW; END IF;
  IF shared_domain_purge_allowed(OLD."spaceId",OLD."scopeId") AND (to_jsonb(NEW)-ARRAY['primaryOwnerAccessId','transferId','revision']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['primaryOwnerAccessId','transferId','revision']) AND NEW.revision=OLD.revision+1 AND (NEW."primaryOwnerAccessId" IS NULL OR NEW."primaryOwnerAccessId"=OLD."primaryOwnerAccessId") AND (NEW."transferId" IS NULL OR NEW."transferId"=OLD."transferId") THEN
  IF NEW."transferId" IS NULL AND NEW."primaryOwnerAccessId" IS NOT NULL THEN RAISE EXCEPTION 'Disposal cannot retain live domain administration' USING ERRCODE='23514'; END IF;
  IF NEW."transferId" IS NULL AND NOT EXISTS(SELECT 1 FROM "SharedLifecycleJob" j WHERE j."scopeId"=OLD."scopeId" AND j."spaceId"=OLD."spaceId" AND j.generation=OLD."closureGeneration" AND j.state='PURGING' AND j.progress ? 'custodyWitness') THEN RAISE EXCEPTION 'Minimal custody disposal witness required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
  END IF;
 END IF;
 SELECT * INTO plan FROM "CompanyCustodyTransfer" WHERE id=NEW."transferId";
 IF NOT FOUND THEN RAISE EXCEPTION 'Custody manifest required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyCustodyConsent' THEN
  IF plan.state<>'PREVIEWED' OR plan."expiresAt"<=clock_timestamp() OR NEW."manifestHash"<>plan."manifestHash" THEN RAISE EXCEPTION 'Current custody preview required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['decision','revision','decidedAt','reauthenticatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['decision','revision','decidedAt','reauthenticatedAt']) OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable custody consent identity' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' AND plan.state<>'APPLYING' THEN RAISE EXCEPTION 'Applying custody manifest required' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME<>'DomainScopeCustody' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Immutable custody provenance' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='DomainScopeCustody' THEN
   IF TG_OP='INSERT' AND NEW.kind<>(CASE WHEN plan."sourceProjectId" IS NOT NULL THEN 'PROJECT' ELSE 'TEAM' END) THEN RAISE EXCEPTION 'Typed domain custody required' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','revision','authorizationVersion','primaryOwnerAccessId','closureGeneration']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','authorizationVersion','primaryOwnerAccessId','closureGeneration']) OR NEW.revision<>OLD.revision+1 OR NEW."authorizationVersion"<OLD."authorizationVersion" OR NEW."closureGeneration"<OLD."closureGeneration") THEN RAISE EXCEPTION 'Immutable scoped custody identity' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION company_custody_witness(plan "CompanyCustodyTransfer") RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
 SELECT jsonb_build_object('transferId',plan.id,'companyId',plan."companyId",'manifestHash',plan."manifestHash",'sourceKind',CASE WHEN plan."sourceProjectId" IS NOT NULL THEN 'PROJECT' ELSE 'TEAM' END,'sourceVersion',plan."sourceVersion"::text,'retentionPolicyVersion',plan."retentionPolicyVersion",'companyRetentionPolicyVersion',plan."companyRetentionPolicyVersion")
$$;
CREATE OR REPLACE FUNCTION shared_domain_job_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE plan "CompanyCustodyTransfer";
BEGIN
 IF TG_OP='UPDATE' AND NEW."scopeId" IS DISTINCT FROM OLD."scopeId" THEN RAISE EXCEPTION 'Immutable lifecycle scope identity' USING ERRCODE='23514'; END IF;
 IF NEW."scopeId" IS NOT NULL THEN
  IF TG_OP='INSERT' AND NEW."spaceId" IS NULL THEN RAISE EXCEPTION 'Live domain custody required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW."custodyId",NEW.generation,NEW."retentionPolicyVersion",NEW."effectiveDepartureAt",NEW."recoveryDeadline") IS DISTINCT FROM (OLD."custodyId",OLD.generation,OLD."retentionPolicyVersion",OLD."effectiveDepartureAt",OLD."recoveryDeadline") THEN RAISE EXCEPTION 'Immutable domain lifecycle evidence' USING ERRCODE='23514'; END IF;
  IF NEW."spaceId" IS NULL AND NEW.state NOT IN ('DELETED','CANCELED') THEN RAISE EXCEPTION 'Live domain job cannot detach' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.progress ? 'custodyWitness' AND (NEW.progress->'custodyWitness') IS DISTINCT FROM (OLD.progress->'custodyWitness') THEN RAISE EXCEPTION 'Immutable custody disposal witness' USING ERRCODE='23514'; END IF;
  IF NEW.progress ? 'custodyWitness' AND (TG_OP='INSERT' OR NOT (OLD.progress ? 'custodyWitness')) THEN
   SELECT t.* INTO plan FROM "CompanyCustodyTransfer" t JOIN "DomainScopeCustody" d ON d."transferId"=t.id WHERE d."scopeId"=NEW."scopeId" AND d."spaceId"=NEW."spaceId" AND d."closureGeneration"=NEW.generation;
   IF NOT FOUND OR plan.state<>'APPLIED' OR NEW.state<>'PURGING' OR NOT shared_domain_purge_allowed(NEW."spaceId",NEW."scopeId") OR (NEW.progress->'custodyWitness') IS DISTINCT FROM company_custody_witness(plan) THEN RAISE EXCEPTION 'Reviewed applied custody witness required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION shared_domain_job_reference_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE job "SharedLifecycleJob"; domain "DomainScopeCustody"; witness jsonb;
BEGIN
 SELECT * INTO job FROM "SharedLifecycleJob" WHERE id=NEW.id;
 IF NOT FOUND OR job."scopeId" IS NULL OR job."spaceId" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO domain FROM "DomainScopeCustody" WHERE "spaceId"=job."spaceId" AND "scopeId"=job."scopeId";
 IF NOT FOUND OR job."custodyId"<>domain."scopeId" OR job.generation>domain."closureGeneration" OR job."retentionPolicyVersion"<>domain."retentionPolicyVersion" OR NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=job."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Domain lifecycle requires its applied custody and captured policy' USING ERRCODE='23514'; END IF;
 IF domain."transferId" IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM "CompanyCustodyTransfer" WHERE id=domain."transferId" AND state='APPLIED') THEN RAISE EXCEPTION 'Domain lifecycle requires its applied custody and captured policy' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT company_domain_disposal_witness_valid(domain."spaceId",domain."scopeId") THEN RAISE EXCEPTION 'Retained custody disposal witness required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION company_domain_integrity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target uuid; domain "DomainScopeCustody"; context "AccessScope";
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='AccessScope' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'scopeId')::uuid END;
 SELECT * INTO context FROM "AccessScope" WHERE id=target;
 IF NOT FOUND OR context.kind NOT IN ('PROJECT','TEAM') THEN RETURN NEW; END IF;
 SELECT * INTO domain FROM "DomainScopeCustody" WHERE "scopeId"=target AND "spaceId"=context."spaceId";
 IF NOT FOUND OR domain.kind<>context.kind OR domain."scopeId"<>domain."originCustodyId" OR NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=domain."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Typed Company domain custody required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "ContextAccess" a WHERE a."spaceId"=domain."spaceId" AND a."scopeId"=domain."scopeId" AND a."memberRole" IS NOT NULL AND ((domain.kind='PROJECT' AND a."memberRole" NOT IN ('ADMIN','MANAGER','MEMBER','VIEWER')) OR (domain.kind='TEAM' AND a."memberRole" NOT IN ('ADMIN','LEAD','MEMBER','VIEWER')))) THEN RAISE EXCEPTION 'Role belongs to another context catalog' USING ERRCODE='23514'; END IF;
 IF domain.state IN ('ACTIVE','ARCHIVED') AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" AND u."spaceId"=a."spaceId" WHERE a.id=domain."primaryOwnerAccessId" AND a."spaceId"=domain."spaceId" AND a."scopeId"=domain."scopeId" AND a.state='ACTIVE' AND a."memberRole" IS NOT NULL AND u.state='ACTIVE' AND u."userId" IS NOT NULL) THEN RAISE EXCEPTION 'Active domain custody requires scoped administration' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "DomainScopeCustody_integrity" AFTER INSERT OR UPDATE ON "DomainScopeCustody" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION company_domain_integrity_guard();
CREATE CONSTRAINT TRIGGER "AccessScope_domain_integrity" AFTER INSERT OR UPDATE ON "AccessScope" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION company_domain_integrity_guard();
CREATE CONSTRAINT TRIGGER "ContextAccess_domain_integrity" AFTER INSERT OR UPDATE ON "ContextAccess" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION company_domain_integrity_guard();
CREATE FUNCTION shared_historical_actor_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE actor "SharedActor";
BEGIN
 SELECT * INTO actor FROM "SharedActor" WHERE id=NEW.id;
 IF NOT FOUND OR actor.state<>'HISTORICAL' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM "DomainScopeActorAlias" a JOIN "CompanyCustodyTransfer" t ON t.id=a."transferId" WHERE a."historicalActorId"=actor.id AND a."spaceId"=actor."spaceId" AND a."scopeId"=actor."originCustodyId" AND t.state='APPLIED') AND NOT company_domain_disposal_witness_valid(actor."spaceId",actor."originCustodyId") AND NOT shared_purge_allowed(actor."spaceId") THEN RAISE EXCEPTION 'Historical attribution requires typed non-authorizing provenance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "SharedActor_historical_provenance" AFTER INSERT OR UPDATE ON "SharedActor" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_historical_actor_guard();
COMMIT;
