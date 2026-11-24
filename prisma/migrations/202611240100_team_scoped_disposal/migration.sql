BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- DB-owned time source. No request/configuration/GUC can alter the production clock.
CREATE FUNCTION p1_team_lifecycle_now() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path FROM CURRENT AS $$ SELECT pg_catalog.clock_timestamp() $$;
CREATE OR REPLACE FUNCTION shared_domain_purge_allowed(target uuid, source uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "DomainScopeCustody" d JOIN "SharedCustody" c ON c."spaceId"=d."spaceId" JOIN "SharedLifecycleJob" j ON j."spaceId"=d."spaceId" AND j."scopeId"=d."scopeId" AND j."custodyId"=d."scopeId" AND j.generation=d."closureGeneration"
 WHERE d."spaceId"=target AND d."scopeId"=source AND c.kind='COMPANY' AND d.state='PURGING' AND j.state='PURGING' AND j."retentionPolicyVersion"=d."retentionPolicyVersion"
 AND (c.state IN ('ACTIVE','ARCHIVED') OR shared_purge_allowed(c."spaceId"))
 AND j."recoveryDeadline"<=p1_team_lifecycle_now() AND j."leaseUntil">p1_team_lifecycle_now() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$'
 AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL'
 JOIN "CompanyContextAdmission" b ON b."accessId"=a.id AND b.generation=a.generation JOIN "ContextAccess" r ON r.id=b."rootAccessId" AND r.generation=b."rootGeneration" AND r."actorId"=a."actorId" AND r."spaceId"=target AND r."scopeId"=target
 WHERE a."spaceId"=target AND a."scopeId"=source AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL AND r.state='ACTIVE' AND r."memberRole" IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND (e."closedAt">=a."joinedAt" OR e."closedAt">=r."joinedAt"))))
$$;
-- Only a leased, explicitly closed P1 Team scope can consume retained child history.
CREATE FUNCTION p1_team_disposal_allowed(target uuid, source uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT shared_domain_purge_allowed(target,source) AND EXISTS(
 SELECT 1 FROM "DomainScopeCustody" d JOIN "SharedLifecycleJob" j ON j."spaceId"=d."spaceId" AND j."scopeId"=d."scopeId" AND j.generation=d."closureGeneration"
 LEFT JOIN "CompanyCustodyTransfer" t ON t.id=d."transferId"
 WHERE d."spaceId"=target AND d."scopeId"=source AND d.kind='TEAM'
 AND ((t.state='APPLIED' AND t.manifest->>'protocol'='P1_INDEPENDENT_TEAM_V1' AND t."retirementControlId" IS NOT NULL)
 OR (d."transferId" IS NULL AND j.progress->>'p1DisposalProtocol'='P1_INDEPENDENT_TEAM_V1' AND company_domain_disposal_witness_valid(target,source))))
$$;
CREATE FUNCTION p1_team_disposal_witness_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.progress ? 'p1DisposalProtocol' AND (NEW.progress->'p1DisposalProtocol') IS DISTINCT FROM (OLD.progress->'p1DisposalProtocol') THEN RAISE EXCEPTION 'Immutable P1 disposal protocol' USING ERRCODE='23514'; END IF;
 IF NEW.progress ? 'p1DisposalProtocol' AND (TG_OP='INSERT' OR NOT (OLD.progress ? 'p1DisposalProtocol')) THEN
  IF NEW.progress->>'p1DisposalProtocol' IS DISTINCT FROM 'P1_INDEPENDENT_TEAM_V1' OR NOT p1_team_disposal_allowed(NEW."spaceId",NEW."scopeId") THEN RAISE EXCEPTION 'Applied P1 Team and current scoped purge lease required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "SharedLifecycleJob_p1_disposal" BEFORE INSERT OR UPDATE ON "SharedLifecycleJob" FOR EACH ROW EXECUTE FUNCTION p1_team_disposal_witness_guard();
-- Preserve the existing retained-row guard verbatim except for the explicit child history path.
CREATE OR REPLACE FUNCTION shared_retained_row_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target uuid; source uuid;
BEGIN
 IF TG_TABLE_NAME='ContextAccessInterval' THEN
  SELECT "spaceId","scopeId" INTO target,source FROM "ContextAccess" WHERE id=OLD."accessId";
 ELSE
  target:=(to_jsonb(OLD)->>'spaceId')::uuid;
  source:=(to_jsonb(OLD)->>'scopeId')::uuid;
 END IF;
 IF target IS NOT NULL AND source IS NOT NULL AND p1_team_disposal_allowed(target,source) THEN RETURN OLD; END IF;
 IF target IS NOT NULL AND EXISTS (SELECT 1 FROM "SharedCustody" WHERE "spaceId" = target AND state NOT IN ('PURGING','DELETED')) THEN
  RAISE EXCEPTION 'Retained history requires controlled purge' USING ERRCODE = '23514';
 END IF;
 RETURN OLD;
END; $$;
COMMIT;
