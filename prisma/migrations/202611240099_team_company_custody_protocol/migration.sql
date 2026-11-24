BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Forward-only completion of M098, whose first isolated-test deployment is preserved byte-for-byte.
ALTER TABLE "CompanyCustodyTransfer" ADD COLUMN "retirementControlId" uuid UNIQUE;
CREATE OR REPLACE FUNCTION p1_team_move_allowed(source uuid,destination uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "CompanyCustodyTransfer" t WHERE t.id::text=current_setting('planner.team_transfer_id',true)
 AND t.state='APPLYING' AND t."sourceTeamId"=source AND t."sourceProjectId" IS NULL
 AND t."sourceCustodyId"=source AND t."companyId"=destination
 AND t.manifest->>'protocol'='P1_INDEPENDENT_TEAM_V1' AND t."retirementControlId" IS NOT NULL AND t."expiresAt">clock_timestamp()
 AND t."startedAt">clock_timestamp()-interval '5 minutes')
$$;
CREATE OR REPLACE FUNCTION shared_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE role_name text; caps jsonb; cap text; catalog text[];
BEGIN
 IF TG_TABLE_NAME='ContextCapabilityPolicy' THEN IF TG_OP='UPDATE' AND p1_team_move_allowed(OLD."spaceId",NEW."spaceId") AND (to_jsonb(NEW)-'spaceId') IS NOT DISTINCT FROM (to_jsonb(OLD)-'spaceId') THEN RETURN NEW; END IF; END IF;

  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Published policy is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'SharedRetentionPolicy' THEN RETURN NEW; END IF;
  SELECT CASE WHEN kind='COMPANY' AND NOT EXISTS(SELECT 1 FROM "AccessScope" s WHERE s.id=NEW."scopeId" AND s."spaceId"=NEW."spaceId" AND s.kind='TEAM') THEN ARRAY['OWNER','ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER'] WHEN kind='TEAM' OR EXISTS(SELECT 1 FROM "AccessScope" s WHERE s.id=NEW."scopeId" AND s."spaceId"=NEW."spaceId" AND s.kind='TEAM') THEN ARRAY['OWNER','ADMIN','LEAD','MEMBER','VIEWER'] ELSE ARRAY['OWNER','ADMIN','MANAGER','MEMBER','VIEWER'] END INTO catalog FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
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
CREATE OR REPLACE FUNCTION company_invitation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE k text; issuer record; recipient record;
BEGIN
 IF NEW."scopeId"<>NEW."spaceId" AND EXISTS(SELECT 1 FROM "DomainScopeCustody" d JOIN "CompanyCustodyTransfer" t ON t.id=d."transferId" WHERE d."scopeId"=NEW."scopeId" AND d."spaceId"=NEW."spaceId" AND d.kind='TEAM' AND t.state='APPLIED') THEN
  IF num_nonnulls(NEW."companyScopeId",NEW."companyIssuerAccessId",NEW."companyIssuerGeneration",NEW."companyAcceptedAccessId")<>0 OR NEW."companyRecipientRootAccessId" IS NULL OR NEW."companyRecipientRootGeneration" IS NULL OR NEW."companyRestoreGeneration" IS NULL THEN RAISE EXCEPTION 'Domain Team offer requires explicit Company-root snapshot' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "ContextAccess" r JOIN "SharedActor" a ON a.id=r."actorId" WHERE r.id=NEW."companyRecipientRootAccessId" AND r."spaceId"=NEW."spaceId" AND r."scopeId"=NEW."spaceId" AND (a."userId"=NEW."recipientUserId" OR NEW.state IN ('ACCEPTED','DECLINED','REVOKED','EXPIRED') OR NEW."recipientEmail" IS NOT NULL)) THEN RAISE EXCEPTION 'Foreign Team recipient root' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW."companyRecipientRootAccessId",NEW."companyRecipientRootGeneration",NEW."companyRestoreGeneration") IS DISTINCT FROM (OLD."companyRecipientRootAccessId",OLD."companyRecipientRootGeneration",OLD."companyRestoreGeneration") THEN RAISE EXCEPTION 'Immutable Team recipient root snapshot' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;

 SELECT kind INTO k FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
 IF k<>'COMPANY' THEN
  IF num_nonnulls(NEW."companyScopeId",NEW."companyIssuerAccessId",NEW."companyIssuerGeneration",NEW."companyRecipientRootAccessId",NEW."companyRecipientRootGeneration",NEW."companyRestoreGeneration",NEW."companyAcceptedAccessId")<>0 THEN RAISE EXCEPTION 'Corporate invitation bindings require Company custody' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."scopeId"<>NEW."spaceId" OR NEW."companyScopeId" IS NULL OR NEW."companyIssuerAccessId" IS NULL OR NEW."companyIssuerGeneration" IS NULL OR NEW."companyRestoreGeneration" IS NULL THEN RAISE EXCEPTION 'Company offer bindings required' USING ERRCODE='23514'; END IF;
 SELECT * INTO issuer FROM "ContextAccess" WHERE id=NEW."companyIssuerAccessId" AND "spaceId"=NEW."spaceId" AND "actorId"=(SELECT "actorId" FROM "ContextAccess" WHERE id=NEW."inviterAccessId") AND "scopeId" IN (NEW."spaceId",NEW."companyScopeId");
 IF NOT FOUND THEN RAISE EXCEPTION 'Foreign issuer context' USING ERRCODE='23514'; END IF;
 IF NEW."companyScopeId"<>NEW."spaceId" AND (NEW."companyRecipientRootAccessId" IS NULL OR NEW."companyRecipientRootGeneration" IS NULL) THEN RAISE EXCEPTION 'Child offer needs current root admission binding' USING ERRCODE='23514'; END IF;
 IF NEW."companyRecipientRootAccessId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ContextAccess" WHERE id=NEW."companyRecipientRootAccessId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."spaceId") THEN RAISE EXCEPTION 'Foreign recipient root' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."companyScopeId",NEW."companyIssuerAccessId",NEW."companyIssuerGeneration",NEW."companyRecipientRootAccessId",NEW."companyRecipientRootGeneration",NEW."companyRestoreGeneration") IS DISTINCT FROM (OLD."companyScopeId",OLD."companyIssuerAccessId",OLD."companyIssuerGeneration",OLD."companyRecipientRootAccessId",OLD."companyRecipientRootGeneration",OLD."companyRestoreGeneration") THEN RAISE EXCEPTION 'Immutable Company offer bindings' USING ERRCODE='23514'; END IF;
 IF NEW.state='ACCEPTED' AND NOT EXISTS(SELECT 1 FROM "ContextAccess" WHERE id=NEW."companyAcceptedAccessId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."companyScopeId" AND "actorId"=NEW."acceptedActorId") THEN RAISE EXCEPTION 'Wrong accepted Company context' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION company_custody_protocol_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE plan "CompanyCustodyTransfer";
BEGIN
 IF TG_TABLE_NAME='CompanyCustodyTransfer' THEN IF TG_OP='UPDATE' AND NEW."retirementControlId" IS DISTINCT FROM OLD."retirementControlId" AND NOT (OLD.state='PREVIEWED' AND NEW.state='APPLYING' AND NEW."retirementControlId" IS NOT NULL AND NEW.manifest->>'protocol'='P1_INDEPENDENT_TEAM_V1') THEN RAISE EXCEPTION 'Immutable retirement control identity' USING ERRCODE='23514'; END IF; END IF;

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
   IF (to_jsonb(NEW)-ARRAY['state','revision','appliedAt','startedAt','retirementControlId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','appliedAt','startedAt','retirementControlId']) THEN RAISE EXCEPTION 'Immutable custody manifest' USING ERRCODE='23514'; END IF;
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
COMMIT;
