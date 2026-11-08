BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "SharedLifecycleJob" ADD COLUMN "scopeId" uuid;
ALTER TABLE "SharedLifecycleJob" DROP CONSTRAINT "SharedLifecycleJob_check";
ALTER TABLE "SharedLifecycleJob" ADD CONSTRAINT "SharedLifecycleJob_location_shape" CHECK (
 ("scopeId" IS NULL AND ("spaceId" IS NULL OR "spaceId"="custodyId")) OR
 ("scopeId" IS NOT NULL AND "custodyId"="scopeId" AND ("spaceId" IS NULL OR "scopeId"<>"spaceId"))
);
ALTER TABLE "DomainScopeCustody" DROP CONSTRAINT "DomainScopeCustody_state_check";
ALTER TABLE "DomainScopeCustody" ADD CONSTRAINT "DomainScopeCustody_state_check" CHECK (state IN (
 'ACTIVE','ARCHIVED','OWNER_EXIT_FROZEN','CLOSING_GRACE','CLEANUP_PENDING','WAITING_OBLIGATIONS','BLOCKED_POLICY','PURGING','FAILED','CLOSED'
));
CREATE FUNCTION shared_domain_job_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."scopeId" IS DISTINCT FROM OLD."scopeId" THEN
  RAISE EXCEPTION 'Immutable lifecycle scope identity' USING ERRCODE='23514';
 END IF;
 IF NEW."scopeId" IS NOT NULL THEN
  IF TG_OP='INSERT' AND NEW."spaceId" IS NULL THEN RAISE EXCEPTION 'Live domain custody required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW."custodyId",NEW.generation,NEW."retentionPolicyVersion",NEW."effectiveDepartureAt",NEW."recoveryDeadline") IS DISTINCT FROM (OLD."custodyId",OLD.generation,OLD."retentionPolicyVersion",OLD."effectiveDepartureAt",OLD."recoveryDeadline") THEN
   RAISE EXCEPTION 'Immutable domain lifecycle evidence' USING ERRCODE='23514';
  END IF;
  IF NEW."spaceId" IS NULL AND NEW.state NOT IN ('DELETED','CANCELED') THEN RAISE EXCEPTION 'Live domain job cannot detach' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "SharedLifecycleJob_domain_identity" BEFORE INSERT OR UPDATE ON "SharedLifecycleJob" FOR EACH ROW EXECUTE FUNCTION shared_domain_job_identity_guard();
CREATE FUNCTION shared_domain_job_reference_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE job "SharedLifecycleJob";
BEGIN
 SELECT * INTO job FROM "SharedLifecycleJob" WHERE id=NEW.id;
 IF NOT FOUND OR job."scopeId" IS NULL OR job."spaceId" IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM "DomainScopeCustody" d JOIN "SharedCustody" c ON c."spaceId"=d."spaceId" JOIN "CompanyCustodyTransfer" t ON t.id=d."transferId"
  WHERE d."spaceId"=job."spaceId" AND d."scopeId"=job."scopeId" AND job."custodyId"=d."scopeId" AND c.kind='COMPANY' AND t.state='APPLIED'
  AND job.generation<=d."closureGeneration" AND job."retentionPolicyVersion"=d."retentionPolicyVersion") THEN
  RAISE EXCEPTION 'Domain lifecycle requires its applied custody and captured policy' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "SharedLifecycleJob_domain_reference" AFTER INSERT OR UPDATE ON "SharedLifecycleJob" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_domain_job_reference_guard();
CREATE OR REPLACE FUNCTION shared_purge_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "SharedLifecycleJob" j ON j."spaceId"=c."spaceId" AND j.generation=c."closureGeneration"
 WHERE c."spaceId"=target AND j."scopeId" IS NULL AND j."custodyId"=c."spaceId" AND c.kind IN ('PROJECT','TEAM','COMPANY') AND c.state='PURGING' AND j.state='PURGING'
 AND j."recoveryDeadline"<=clock_timestamp() AND j."leaseUntil">clock_timestamp() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$'
 AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL'
 WHERE a."spaceId"=target AND (c.kind<>'COMPANY' OR a."scopeId"=target) AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL
 AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND e."closedAt">=a."joinedAt")))
$$;
CREATE FUNCTION shared_domain_purge_allowed(target uuid, source uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "DomainScopeCustody" d JOIN "SharedCustody" c ON c."spaceId"=d."spaceId" JOIN "SharedLifecycleJob" j ON j."spaceId"=d."spaceId" AND j."scopeId"=d."scopeId" AND j."custodyId"=d."scopeId" AND j.generation=d."closureGeneration"
 WHERE d."spaceId"=target AND d."scopeId"=source AND c.kind='COMPANY' AND d.state='PURGING' AND j.state='PURGING' AND j."retentionPolicyVersion"=d."retentionPolicyVersion"
 AND (c.state IN ('ACTIVE','ARCHIVED') OR shared_purge_allowed(c."spaceId"))
 AND j."recoveryDeadline"<=clock_timestamp() AND j."leaseUntil">clock_timestamp() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$'
 AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL'
 JOIN "CompanyContextAdmission" b ON b."accessId"=a.id AND b.generation=a.generation JOIN "ContextAccess" r ON r.id=b."rootAccessId" AND r.generation=b."rootGeneration" AND r."actorId"=a."actorId" AND r."spaceId"=target AND r."scopeId"=target
 WHERE a."spaceId"=target AND a."scopeId"=source AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL AND r.state='ACTIVE' AND r."memberRole" IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND (e."closedAt">=a."joinedAt" OR e."closedAt">=r."joinedAt"))))
$$;
CREATE OR REPLACE FUNCTION project_execution_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF TG_OP='DELETE' AND (shared_purge_allowed(OLD."spaceId") OR shared_domain_purge_allowed(OLD."spaceId",OLD."scopeId")) THEN RETURN OLD;END IF;RAISE EXCEPTION 'Published project execution history is immutable' USING ERRCODE='23514';END; $$;
CREATE OR REPLACE FUNCTION task_field_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF TG_OP='DELETE' AND (shared_purge_allowed(OLD."spaceId") OR shared_domain_purge_allowed(OLD."spaceId",OLD."scopeId")) THEN RETURN OLD;END IF;RAISE EXCEPTION 'Published field versions/options are immutable' USING ERRCODE='23514';END; $$;
CREATE OR REPLACE FUNCTION task_workflow_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF TG_OP='DELETE' AND (shared_purge_allowed(OLD."spaceId") OR shared_domain_purge_allowed(OLD."spaceId",OLD."scopeId")) THEN RETURN OLD;END IF;RAISE EXCEPTION 'Published workflow history is immutable' USING ERRCODE='23514';END; $$;
COMMIT;
