BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "SharedLifecycleJob" ADD CONSTRAINT "SharedLifecycleJob_effect_identity_key" UNIQUE(id,"custodyId",generation);
CREATE TABLE "SharedLifecycleEffect" (
 id uuid PRIMARY KEY,"jobId" uuid NOT NULL,"custodyId" uuid NOT NULL,generation integer NOT NULL,action varchar(80) NOT NULL CHECK(action ~ '^lifecycle\.[a-z.]{1,70}$'),"authorizationVersion" bigint NOT NULL CHECK("authorizationVersion">0),"operatorReference" varchar(200) NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY("jobId","custodyId",generation) REFERENCES "SharedLifecycleJob"(id,"custodyId",generation) ON DELETE RESTRICT
);
CREATE INDEX "SharedLifecycleEffect_job" ON "SharedLifecycleEffect"("jobId","createdAt",id);
CREATE FUNCTION shared_lifecycle_effect_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN RAISE EXCEPTION 'Minimal lifecycle control evidence is immutable' USING ERRCODE='23514';END; $$;
CREATE TRIGGER "SharedLifecycleEffect_immutable" BEFORE UPDATE OR DELETE ON "SharedLifecycleEffect" FOR EACH ROW EXECUTE FUNCTION shared_lifecycle_effect_immutable();
CREATE FUNCTION shared_purge_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "SharedLifecycleJob" j ON j."spaceId"=c."spaceId" AND j.generation=c."closureGeneration" WHERE c."spaceId"=target AND c.kind='PROJECT' AND c.state='PURGING' AND j.state='PURGING' AND j."recoveryDeadline"<=clock_timestamp() AND j."leaseUntil">clock_timestamp() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$' AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL' WHERE a."spaceId"=target AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND e."closedAt">=a."joinedAt")))
$$;
CREATE OR REPLACE FUNCTION project_execution_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD;END IF;RAISE EXCEPTION 'Published project execution history is immutable' USING ERRCODE='23514';END; $$;
CREATE OR REPLACE FUNCTION task_field_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD;END IF;RAISE EXCEPTION 'Published field versions/options are immutable' USING ERRCODE='23514';END; $$;
CREATE OR REPLACE FUNCTION task_workflow_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD;END IF;RAISE EXCEPTION 'Published workflow history is immutable' USING ERRCODE='23514';END; $$;
COMMIT;
