BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE "Project" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL UNIQUE, "scopeId" uuid NOT NULL,
 "createdByActorId" uuid NOT NULL, title varchar(300) NOT NULL CHECK(length(btrim(title)) > 0),
 description varchar(10000), revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 "creationKey" char(64) NOT NULL, "creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK("scopeId" = "spaceId"), UNIQUE("spaceId","scopeId",id),
 FOREIGN KEY("spaceId") REFERENCES "SharedCustody"("spaceId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "Project_created" ON "Project"("createdAt",id);
CREATE TABLE "ProjectPhase" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL,
 title varchar(300) NOT NULL CHECK(length(btrim(title)) > 0), position integer NOT NULL DEFAULT 0 CHECK(position >= 0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId","projectId",id),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION
);
CREATE TABLE "ProjectSection" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL, "phaseId" uuid,
 title varchar(300) NOT NULL CHECK(length(btrim(title)) > 0), position integer NOT NULL DEFAULT 0 CHECK(position >= 0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId","projectId",id),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","phaseId") REFERENCES "ProjectPhase"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION
);
CREATE TABLE "ProjectMilestone" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL, "phaseId" uuid,
 title varchar(300) NOT NULL CHECK(length(btrim(title)) > 0), position integer NOT NULL DEFAULT 0 CHECK(position >= 0),
 "targetDate" date, completed boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId","projectId",id),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","phaseId") REFERENCES "ProjectPhase"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION
);

ALTER TABLE "Task" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "Task" ADD COLUMN "scopeId" uuid, ADD COLUMN "createdByActorId" uuid;
ALTER TABLE "Task" ADD CONSTRAINT "Task_scope_id_key" UNIQUE("spaceId","scopeId",id),
 ADD CONSTRAINT "Task_scope_fk" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "Task_shared_actor_fk" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "Task_parent_scope_fk" FOREIGN KEY("spaceId","scopeId","parentTaskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION;
ALTER TABLE "TaskChange" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE "TaskChange" ADD COLUMN "scopeId" uuid, ADD COLUMN "actorId" uuid,
 ADD CONSTRAINT "TaskChange_scope_fk" FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE CASCADE,
 ADD CONSTRAINT "TaskChange_actor_fk" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION;
ALTER TABLE "Goal" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "Goal" ADD COLUMN "scopeId" uuid, ADD COLUMN "createdByActorId" uuid,
 ADD CONSTRAINT "Goal_scope_id_key" UNIQUE("spaceId","scopeId",id),
 ADD CONSTRAINT "Goal_direct_space_fk" FOREIGN KEY("spaceId") REFERENCES "Space"(id) ON DELETE CASCADE,
 ADD CONSTRAINT "Goal_scope_fk" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "Goal_shared_actor_fk" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "Goal_parent_scope_fk" FOREIGN KEY("spaceId","scopeId","parentGoalId") REFERENCES "Goal"("spaceId","scopeId",id) ON DELETE NO ACTION;

DROP TRIGGER "Task_personal_until_extension" ON "Task";
CREATE FUNCTION project_source_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE personal boolean;
BEGIN
 SELECT kind = 'PERSONAL' INTO personal FROM "Space" WHERE id=NEW."spaceId";
 IF personal IS NULL OR
   (personal AND (NEW."createdByUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL)) OR
   (NOT personal AND (NEW."createdByUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL OR
     NOT EXISTS(SELECT 1 FROM "Project" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId"))) THEN
   RAISE EXCEPTION 'Invalid Personal/shared source branch' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW."spaceId",NEW."scopeId",NEW."createdByUserId",NEW."createdByActorId") IS DISTINCT FROM
   (OLD."spaceId",OLD."scopeId",OLD."createdByUserId",OLD."createdByActorId") THEN
   RAISE EXCEPTION 'Custody/attribution transfer requires its reviewed slice' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "Task_source_shape" BEFORE INSERT OR UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION project_source_shape();
CREATE TRIGGER "Goal_source_shape" BEFORE INSERT OR UPDATE ON "Goal" FOR EACH ROW EXECUTE FUNCTION project_source_shape();
CREATE FUNCTION project_change_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Task" t WHERE t.id=NEW."taskId" AND t."spaceId"=NEW."spaceId" AND
  ((t."scopeId" IS NULL AND NEW."scopeId" IS NULL AND NEW."actorUserId" IS NOT NULL AND NEW."actorId" IS NULL) OR
   (t."scopeId"=NEW."scopeId" AND NEW."actorUserId" IS NULL AND NEW."actorId" IS NOT NULL))) THEN
  RAISE EXCEPTION 'Invalid Task history branch' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "TaskChange_source_shape" BEFORE INSERT OR UPDATE ON "TaskChange" FOR EACH ROW EXECUTE FUNCTION project_change_shape();

CREATE TABLE "ProjectTask" (
 "taskId" uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL,
 "sectionId" uuid, "milestoneId" uuid, revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","sectionId") REFERENCES "ProjectSection"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","milestoneId") REFERENCES "ProjectMilestone"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectTask_page" ON "ProjectTask"("spaceId","scopeId","projectId","taskId");
CREATE TABLE "ProjectGoal" (
 "goalId" uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL,
 "milestoneId" uuid, revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","goalId") REFERENCES "Goal"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","milestoneId") REFERENCES "ProjectMilestone"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectGoal_page" ON "ProjectGoal"("spaceId","scopeId","projectId","goalId");
CREATE TABLE "ProjectMemberAssignment" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL,
 "accessId" uuid NOT NULL, generation integer NOT NULL, "phaseId" uuid, "sectionId" uuid, "milestoneId" uuid,
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), "revokedAt" timestamptz(3),
 CHECK(num_nonnulls("phaseId","sectionId","milestoneId") = 1),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","phaseId") REFERENCES "ProjectPhase"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","sectionId") REFERENCES "ProjectSection"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","milestoneId") REFERENCES "ProjectMilestone"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectMemberAssignment_page" ON "ProjectMemberAssignment"("spaceId","projectId",id);

ALTER TABLE "ResourceGrant" ADD CONSTRAINT "ResourceGrant_scope_key" UNIQUE("spaceId","scopeId",id),
 ADD CONSTRAINT "ResourceGrant_grantee_scope_fk" FOREIGN KEY("spaceId","scopeId","granteeAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "ResourceGrant_issuer_scope_fk" FOREIGN KEY("spaceId","scopeId","issuerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "ResourceGrant_grantee_interval_fk" FOREIGN KEY("granteeAccessId","granteeGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 ADD CONSTRAINT "ResourceGrant_issuer_interval_fk" FOREIGN KEY("issuerAccessId","issuerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION;
CREATE TABLE "ProjectGrant" (
 "grantId" uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL,
 FOREIGN KEY("spaceId","scopeId","grantId") REFERENCES "ResourceGrant"("spaceId","scopeId",id) ON DELETE CASCADE,
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION
);
CREATE TABLE "TaskGrant" (
 "grantId" uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "taskId" uuid NOT NULL,
 FOREIGN KEY("spaceId","scopeId","grantId") REFERENCES "ResourceGrant"("spaceId","scopeId",id) ON DELETE CASCADE,
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION
);
CREATE TABLE "GoalGrant" (
 "grantId" uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "goalId" uuid NOT NULL,
 FOREIGN KEY("spaceId","scopeId","grantId") REFERENCES "ResourceGrant"("spaceId","scopeId",id) ON DELETE CASCADE,
 FOREIGN KEY("spaceId","scopeId","goalId") REFERENCES "Goal"("spaceId","scopeId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectGrant_target" ON "ProjectGrant"("projectId","grantId");
CREATE INDEX "TaskGrant_target" ON "TaskGrant"("taskId","grantId");
CREATE INDEX "GoalGrant_target" ON "GoalGrant"("goalId","grantId");
DROP TRIGGER "ResourceGrant_target_required" ON "ResourceGrant";
CREATE FUNCTION project_grant_target() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE gid uuid; n integer;
BEGIN
 IF TG_TABLE_NAME='ResourceGrant' THEN gid=COALESCE(NEW.id,OLD.id); ELSE gid=COALESCE(NEW."grantId",OLD."grantId"); END IF;
 IF EXISTS(SELECT 1 FROM "ResourceGrant" WHERE id=gid) THEN
 SELECT (SELECT count(*) FROM "ProjectGrant" WHERE "grantId"=gid)+(SELECT count(*) FROM "TaskGrant" WHERE "grantId"=gid)+(SELECT count(*) FROM "GoalGrant" WHERE "grantId"=gid) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'Grant requires exactly one typed target' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "ResourceGrant" g WHERE g.id=gid AND 'read'=ANY(g.capabilities) AND
   ((EXISTS(SELECT 1 FROM "ProjectGrant" WHERE "grantId"=gid) AND g.capabilities <@ ARRAY['read']::text[]) OR
    (EXISTS(SELECT 1 FROM "TaskGrant" WHERE "grantId"=gid) AND g.capabilities <@ ARRAY['read','update','complete']::text[]) OR
    (EXISTS(SELECT 1 FROM "GoalGrant" WHERE "grantId"=gid) AND g.capabilities <@ ARRAY['read','update']::text[]))) THEN
 RAISE EXCEPTION 'Grant capabilities exceed its concrete target' USING ERRCODE='23514'; END IF;
 END IF; RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "ResourceGrant_target_exact" AFTER INSERT OR UPDATE OR DELETE ON "ResourceGrant" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_grant_target();
CREATE CONSTRAINT TRIGGER "ProjectGrant_target_exact" AFTER INSERT OR UPDATE OR DELETE ON "ProjectGrant" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_grant_target();
CREATE CONSTRAINT TRIGGER "TaskGrant_target_exact" AFTER INSERT OR UPDATE OR DELETE ON "TaskGrant" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_grant_target();
CREATE CONSTRAINT TRIGGER "GoalGrant_target_exact" AFTER INSERT OR UPDATE OR DELETE ON "GoalGrant" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_grant_target();
CREATE TABLE "ResourceGrantOffer" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL,
 "issuerAccessId" uuid NOT NULL, "issuerGeneration" integer NOT NULL,
 "recipientActorId" uuid NOT NULL, "recipientAccessId" uuid, "recipientGeneration" integer, "recipientRevision" integer,
 "projectId" uuid, "taskId" uuid, "goalId" uuid,
 capabilities text[] NOT NULL CHECK(cardinality(capabilities) BETWEEN 1 AND 3 AND capabilities <@ ARRAY['read','update','complete']::text[] AND 'read'=ANY(capabilities)),
 "proofHash" char(64) UNIQUE, "keyHash" char(64) NOT NULL, fingerprint char(64) NOT NULL,
 state varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','DECLINED','REVOKED','EXPIRED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), "createdAt" timestamptz(3) NOT NULL,
 "expiresAt" timestamptz(3) NOT NULL, "grantExpiresAt" timestamptz(3) NOT NULL, "endedAt" timestamptz(3), "grantId" uuid UNIQUE,
 CHECK(num_nonnulls("projectId","taskId","goalId")=1),
 CHECK(num_nonnulls("recipientAccessId","recipientGeneration","recipientRevision") IN (0,3)),
 CHECK("expiresAt"="createdAt"+interval '7 days'), CHECK("grantExpiresAt">"createdAt"),
 CHECK((state='PENDING' AND "proofHash" IS NOT NULL AND "grantId" IS NULL AND "endedAt" IS NULL) OR
       (state='ACCEPTED' AND "proofHash" IS NOT NULL AND "grantId" IS NOT NULL AND "endedAt" IS NOT NULL) OR
       (state IN ('DECLINED','REVOKED','EXPIRED') AND "proofHash" IS NULL AND "grantId" IS NULL AND "endedAt" IS NOT NULL)),
 CHECK(("projectId" IS NULL OR capabilities <@ ARRAY['read']::text[]) AND ("goalId" IS NULL OR capabilities <@ ARRAY['read','update']::text[])),
 UNIQUE("spaceId","issuerAccessId","issuerGeneration","keyHash"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","issuerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("issuerAccessId","issuerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","recipientActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","recipientAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","goalId") REFERENCES "Goal"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","grantId") REFERENCES "ResourceGrant"("spaceId","scopeId",id) ON DELETE NO ACTION
);
CREATE INDEX "ResourceGrantOffer_expiry" ON "ResourceGrantOffer"(state,"expiresAt",id);
CREATE INDEX "ResourceGrantOffer_recipient" ON "ResourceGrantOffer"("recipientActorId",state,id);
CREATE FUNCTION project_typed_target_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Typed grant targets are immutable; revoke and reissue' USING ERRCODE='23514'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectGrant_immutable" BEFORE UPDATE ON "ProjectGrant" FOR EACH ROW EXECUTE FUNCTION project_typed_target_immutable();
CREATE TRIGGER "TaskGrant_immutable" BEFORE UPDATE ON "TaskGrant" FOR EACH ROW EXECUTE FUNCTION project_typed_target_immutable();
CREATE TRIGGER "GoalGrant_immutable" BEFORE UPDATE ON "GoalGrant" FOR EACH ROW EXECUTE FUNCTION project_typed_target_immutable();
CREATE FUNCTION project_offer_accepted_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.state='ACCEPTED' AND NOT EXISTS(
 SELECT 1 FROM "ResourceGrant" g JOIN "ContextAccess" a ON a.id=g."granteeAccessId"
 WHERE g.id=NEW."grantId" AND a."actorId"=NEW."recipientActorId"
 AND g."issuerAccessId"=NEW."issuerAccessId" AND g."issuerGeneration"=NEW."issuerGeneration"
 AND g."expiresAt"=NEW."grantExpiresAt" AND g.capabilities=NEW.capabilities
 AND ((NEW."projectId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ProjectGrant" t WHERE t."grantId"=g.id AND t."projectId"=NEW."projectId"))
 OR (NEW."taskId" IS NOT NULL AND EXISTS(SELECT 1 FROM "TaskGrant" t WHERE t."grantId"=g.id AND t."taskId"=NEW."taskId"))
 OR (NEW."goalId" IS NOT NULL AND EXISTS(SELECT 1 FROM "GoalGrant" t WHERE t."grantId"=g.id AND t."goalId"=NEW."goalId")))) THEN
 RAISE EXCEPTION 'Accepted offer must match its exact typed grant and recipient' USING ERRCODE='23514'; END IF; RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "ResourceGrantOffer_accepted_shape" AFTER INSERT OR UPDATE ON "ResourceGrantOffer" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION project_offer_accepted_shape();
COMMIT;
