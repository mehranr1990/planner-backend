BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE "SharedEvidenceFloor" (id integer PRIMARY KEY CHECK(id=1), "before" timestamptz(3) NOT NULL);
INSERT INTO "SharedEvidenceFloor"(id,"before") VALUES(1,'1970-01-01T00:00:00Z');
ALTER TABLE "AccountDeletionJob" ADD COLUMN "evidenceKeyId" varchar(40) CHECK("evidenceKeyId" ~ '^[A-Za-z0-9_-]{1,40}$');
ALTER TABLE "SharedLifecycleJob" ADD COLUMN "evidenceDisposalAfter" timestamptz(3), ADD COLUMN "disposalApprovalReference" varchar(200);
ALTER TABLE "SharedLifecycleJob" ADD CONSTRAINT "SharedLifecycleJob_disposal_pair" CHECK(("evidenceDisposalAfter" IS NULL AND "disposalApprovalReference" IS NULL) OR ("evidenceDisposalAfter" IS NOT NULL AND length(trim("disposalApprovalReference"))>0));
CREATE FUNCTION shared_evidence_disposal_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS (
  SELECT 1 FROM "SharedLifecycleJob" j JOIN "SharedRetentionPolicy" p ON p.version=j."retentionPolicyVersion" JOIN "SharedEvidenceFloor" f ON f.id=1
  WHERE j.id=target AND j."spaceId" IS NULL AND j.state IN ('DELETED','CANCELED')
  AND NOT EXISTS(SELECT 1 FROM "SharedCustody" c WHERE c."spaceId"=j."custodyId")
  AND j."evidenceDisposalAfter" IS NOT NULL AND j."evidenceDisposalAfter"<=clock_timestamp()
  AND length(trim(j."disposalApprovalReference"))>0
  AND p.configuration->'classRules'->'accessAuditLifecycle'->>'disposalAction'='PURGE'
  AND j."evidenceDisposalAfter">=j."effectiveDepartureAt"+((p.configuration->'classRules'->'accessAuditLifecycle'->>'retainAfterClosureSeconds')::numeric*interval '1 second')
  AND f."before">=j."nextAt" AND f."before">=COALESCE((SELECT max(e."createdAt") FROM "SharedLifecycleEffect" e WHERE e."jobId"=j.id),j."nextAt")
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements((p.configuration->'holds')||(p.configuration->'obligations')) item WHERE item->>'state' IN ('ACTIVE','OUTSTANDING') AND COALESCE(length(trim(j.progress->'releases'->>(item->>'id'))),0)=0)
 );
$$;
CREATE OR REPLACE FUNCTION shared_lifecycle_effect_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' AND shared_evidence_disposal_allowed(OLD."jobId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Minimal lifecycle control evidence is immutable outside authorized terminal disposal' USING ERRCODE='23514';
END;
$$;
CREATE FUNCTION shared_terminal_job_disposal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF OLD.state IN ('DELETED','CANCELED') AND NOT shared_evidence_disposal_allowed(OLD.id) THEN
  RAISE EXCEPTION 'Terminal shared evidence requires policy-bound disposal' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER "SharedLifecycleJob_disposal" BEFORE DELETE ON "SharedLifecycleJob" FOR EACH ROW EXECUTE FUNCTION shared_terminal_job_disposal_guard();
COMMIT;
