BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE "ProjectTransfer" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,
 "sourceCustodyId" uuid NOT NULL,"sourceSpaceId" uuid REFERENCES "Space"(id) ON DELETE SET NULL,
 "creatorAccessId" uuid NOT NULL,"creatorGeneration" integer NOT NULL,"createdByActorId" uuid NOT NULL,"authorizationVersion" bigint NOT NULL CHECK("authorizationVersion">0),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),"manifestHash" char(64) NOT NULL,
 state varchar(10) NOT NULL DEFAULT 'PREVIEWED' CHECK(state IN ('PREVIEWED','ACCEPTED','APPLYING','APPLIED','EXPIRED','CANCELED','FAILED')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL,"expiresAt" timestamptz(3) NOT NULL,"acceptedAt" timestamptz(3),"appliedAt" timestamptz(3),"reauthenticatedAt" timestamptz(3),"applyKeyHash" char(64),"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 CHECK("sourceSpaceId" IS NULL OR "sourceSpaceId"="sourceCustodyId"),CHECK("sourceCustodyId"<>"spaceId"),CHECK("expiresAt"="createdAt"+interval '30 minutes'),
 CHECK(state NOT IN ('ACCEPTED','APPLYING','APPLIED') OR "acceptedAt" IS NOT NULL),CHECK((state='APPLIED')=("appliedAt" IS NOT NULL)),
 UNIQUE("creatorAccessId","creatorGeneration","creationKey"),UNIQUE("spaceId","scopeId","projectId",id),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","creatorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("creatorAccessId","creatorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectTransfer_expiry" ON "ProjectTransfer"("spaceId",state,"expiresAt",id);
CREATE FUNCTION project_transfer_permitted(source_id uuid,destination_id uuid,resource_id uuid,kind text) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "ProjectTransfer" p WHERE p."sourceSpaceId"=source_id AND p."spaceId"=destination_id AND p.state='APPLYING' AND p.xmin::text::bigint=(txid_current()%4294967296) AND p."reauthenticatedAt">clock_timestamp()-interval '5 minutes' AND p."expiresAt">clock_timestamp() AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.manifest->'candidates') c WHERE c->>'id'=resource_id::text AND c->>'kind'=kind AND c->'blockers'='[]'::jsonb))
$$;
CREATE OR REPLACE FUNCTION project_source_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE personal boolean;
BEGIN
 SELECT kind='PERSONAL' INTO personal FROM "Space" WHERE id=NEW."spaceId";
 IF personal IS NULL OR (personal AND (NEW."createdByUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL)) OR (NOT personal AND (NEW."createdByUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL OR NOT EXISTS(SELECT 1 FROM "Project" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId"))) THEN RAISE EXCEPTION 'Invalid Personal/shared source branch' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((NEW."spaceId",NEW."scopeId",NEW."createdByActorId") IS DISTINCT FROM (OLD."spaceId",OLD."scopeId",OLD."createdByActorId") OR (NOT personal AND NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId")) THEN
  IF NOT (OLD."scopeId" IS NULL AND OLD."createdByUserId" IS NOT NULL AND NOT personal AND project_transfer_permitted(OLD."spaceId",NEW."spaceId",NEW.id,upper(TG_TABLE_NAME))) THEN RAISE EXCEPTION 'Custody transfer requires exact accepted manifest' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION project_change_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Task" t WHERE t.id=NEW."taskId" AND t."spaceId"=NEW."spaceId" AND ((t."scopeId" IS NULL AND NEW."scopeId" IS NULL AND NEW."actorUserId" IS NOT NULL AND NEW."actorId" IS NULL) OR (t."scopeId"=NEW."scopeId" AND NEW."actorUserId" IS NULL AND NEW."actorId" IS NOT NULL))) THEN
  IF NOT (TG_OP='UPDATE' AND project_transfer_permitted(OLD."spaceId",NEW."spaceId",NEW."taskId",'TASK')) THEN RAISE EXCEPTION 'Invalid Task history branch' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;
CREATE FUNCTION project_change_commit_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM "TaskChange" WHERE id=NEW.id;IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM "Task" t WHERE t.id=r."taskId" AND t."spaceId"=r."spaceId" AND ((t."scopeId" IS NULL AND r."scopeId" IS NULL AND r."actorUserId" IS NOT NULL AND r."actorId" IS NULL) OR (t."scopeId"=r."scopeId" AND r."actorUserId" IS NULL AND r."actorId" IS NOT NULL))) THEN RAISE EXCEPTION 'Task history must finish in its source custody' USING ERRCODE='23514';END IF;RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "TaskChange_transfer_commit" AFTER INSERT OR UPDATE ON "TaskChange" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_change_commit_shape();
ALTER TABLE "TaskChange" ALTER CONSTRAINT "TaskChange_spaceId_taskId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "TaskChange" ALTER CONSTRAINT "TaskChange_scope_fk" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "Goal" ALTER CONSTRAINT "Goal_spaceId_id_metricId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
CREATE FUNCTION project_transfer_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW."sourceSpaceId" IS NULL AND OLD."sourceSpaceId" IS NOT NULL AND (to_jsonb(NEW)-'sourceSpaceId')=(to_jsonb(OLD)-'sourceSpaceId') THEN RETURN NEW;END IF;
 IF (to_jsonb(NEW)-ARRAY['state','revision','authorizationVersion','acceptedAt','appliedAt','reauthenticatedAt','applyKeyHash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','authorizationVersion','acceptedAt','appliedAt','reauthenticatedAt','applyKeyHash']) OR NEW.revision<>OLD.revision+1 OR NOT ((OLD.state='PREVIEWED' AND NEW.state IN ('ACCEPTED','EXPIRED','CANCELED')) OR (OLD.state='ACCEPTED' AND NEW.state IN ('APPLYING','EXPIRED','CANCELED')) OR (OLD.state='APPLYING' AND NEW.state IN ('APPLIED','FAILED'))) THEN RAISE EXCEPTION 'Invalid transfer transition' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectTransfer_shape" BEFORE UPDATE ON "ProjectTransfer" FOR EACH ROW EXECUTE FUNCTION project_transfer_shape();
CREATE TRIGGER "ProjectTransfer_retained" BEFORE DELETE ON "ProjectTransfer" FOR EACH ROW EXECUTE FUNCTION shared_retained_row_guard();
CREATE FUNCTION project_transfer_source_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.state<>'PREVIEWED' OR NEW."sourceSpaceId" IS NULL OR NOT EXISTS(SELECT 1 FROM "Space" s JOIN "SharedActor" a ON a."userId"=s."ownerUserId" WHERE s.id=NEW."sourceSpaceId" AND s.kind='PERSONAL' AND a.id=NEW."createdByActorId" AND a."spaceId"=NEW."spaceId" AND a.state='ACTIVE') THEN RAISE EXCEPTION 'Transfer source requires its current Personal custodian' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectTransfer_source" BEFORE INSERT ON "ProjectTransfer" FOR EACH ROW EXECUTE FUNCTION project_transfer_source_shape();
COMMIT;
