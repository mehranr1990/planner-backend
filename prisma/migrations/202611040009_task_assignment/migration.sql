BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assignment_source_key" UNIQUE("spaceId","scopeId","projectId","taskId");
CREATE TABLE "TaskAssignment" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "projectId" uuid NOT NULL, "taskId" uuid NOT NULL,
 kind varchar(12) NOT NULL CHECK(kind IN ('PRIMARY','CONTRIBUTOR')),
 "recipientAccessId" uuid NOT NULL, "recipientGeneration" integer NOT NULL,
 "createdByActorId" uuid NOT NULL, "issuerAccessId" uuid NOT NULL, "issuerGeneration" integer NOT NULL,
 decision varchar(10) NOT NULL DEFAULT 'PENDING' CHECK(decision IN ('PENDING','ACCEPTED','DECLINED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), "selectedTaskRevision" integer NOT NULL CHECK("selectedTaskRevision">0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(), "respondedAt" timestamptz(3),
 "declineReason" varchar(2000), "endedAt" timestamptz(3), "endReason" varchar(12),
 "creationKey" char(64) NOT NULL, fingerprint char(64) NOT NULL,
 UNIQUE("spaceId","scopeId",id),
 UNIQUE("issuerAccessId","issuerGeneration","creationKey"),
 CHECK((decision='PENDING' AND "respondedAt" IS NULL AND "declineReason" IS NULL) OR
       (decision='ACCEPTED' AND "respondedAt" IS NOT NULL AND "declineReason" IS NULL) OR
       (decision='DECLINED' AND "respondedAt" IS NOT NULL AND "declineReason" IS NOT NULL AND length(btrim("declineReason"))>0 AND "endedAt" IS NOT NULL AND "endReason"='DECLINED')),
 CHECK(("endedAt" IS NULL AND "endReason" IS NULL) OR ("endedAt" IS NOT NULL AND "endReason" IS NOT NULL AND "endReason" IN ('DECLINED','REVOKED','REASSIGNED'))),
 FOREIGN KEY("spaceId","scopeId","projectId","taskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","recipientAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","issuerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("issuerAccessId","issuerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "TaskAssignment_primary_current" ON "TaskAssignment"("spaceId","scopeId","taskId") WHERE kind='PRIMARY' AND "endedAt" IS NULL;
CREATE UNIQUE INDEX "TaskAssignment_recipient_current" ON "TaskAssignment"("spaceId","scopeId","taskId","recipientAccessId") WHERE "endedAt" IS NULL;
CREATE INDEX "TaskAssignment_source_page" ON "TaskAssignment"("spaceId","scopeId","taskId",id);
CREATE INDEX "TaskAssignment_recipient_page" ON "TaskAssignment"("recipientAccessId","recipientGeneration",decision,"endedAt","taskId",id);
CREATE FUNCTION task_assignment_history() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (NEW.id,NEW."spaceId",NEW."scopeId",NEW."projectId",NEW."taskId",NEW.kind,NEW."recipientAccessId",NEW."recipientGeneration",NEW."createdByActorId",NEW."issuerAccessId",NEW."issuerGeneration",NEW."selectedTaskRevision",NEW."createdAt",NEW."creationKey",NEW.fingerprint)
 IS DISTINCT FROM
 (OLD.id,OLD."spaceId",OLD."scopeId",OLD."projectId",OLD."taskId",OLD.kind,OLD."recipientAccessId",OLD."recipientGeneration",OLD."createdByActorId",OLD."issuerAccessId",OLD."issuerGeneration",OLD."selectedTaskRevision",OLD."createdAt",OLD."creationKey",OLD.fingerprint)
 OR OLD."endedAt" IS NOT NULL OR NEW.revision<>OLD.revision+1 OR
 (OLD.decision<>'PENDING' AND (NEW.decision,NEW."respondedAt",NEW."declineReason") IS DISTINCT FROM (OLD.decision,OLD."respondedAt",OLD."declineReason")) THEN
 RAISE EXCEPTION 'Assignment history is immutable' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "TaskAssignment_history" BEFORE UPDATE ON "TaskAssignment" FOR EACH ROW EXECUTE FUNCTION task_assignment_history();

CREATE TABLE "SharedAssignmentNotification" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "assignmentId" uuid NOT NULL,
 "recipientActorId" uuid NOT NULL, kind varchar(12) NOT NULL CHECK(kind IN ('ASSIGNED','ACCEPTED','DECLINED','REVOKED','REASSIGNED')),
 "assignmentRevision" integer NOT NULL CHECK("assignmentRevision">0), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(), "readAt" timestamptz(3),
 UNIQUE("assignmentId","assignmentRevision","recipientActorId",kind),
 FOREIGN KEY("spaceId","scopeId","assignmentId") REFERENCES "TaskAssignment"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","recipientActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "SharedAssignmentNotification_recipient_page" ON "SharedAssignmentNotification"("spaceId","recipientActorId",id);

CREATE TABLE "TimeBlockSharedTaskLink" (
 "blockId" uuid PRIMARY KEY, "personalSpaceId" uuid NOT NULL, "ownerUserId" uuid NOT NULL,
 "spaceId" uuid NOT NULL, "scopeId" uuid NOT NULL, "taskId" uuid NOT NULL,
 "selectedTaskRevision" integer NOT NULL CHECK("selectedTaskRevision">0), "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY("personalSpaceId","ownerUserId") REFERENCES "Space"(id,"ownerUserId") ON DELETE CASCADE,
 FOREIGN KEY("personalSpaceId","blockId") REFERENCES "TimeBlock"("spaceId",id) ON DELETE CASCADE,
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "TimeBlockSharedTaskLink_owner_page" ON "TimeBlockSharedTaskLink"("personalSpaceId","blockId");
CREATE INDEX "TimeBlockSharedTaskLink_source" ON "TimeBlockSharedTaskLink"("spaceId","scopeId","taskId");
CREATE FUNCTION shared_block_link_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE b "TimeBlock";
BEGIN
 SELECT * INTO b FROM "TimeBlock" WHERE id=NEW."blockId" AND "spaceId"=NEW."personalSpaceId" FOR UPDATE;
 IF b.id IS NULL OR b."createdByUserId"<>NEW."ownerUserId" OR b."taskId" IS NOT NULL OR b."selectedTaskRevision" IS NOT NULL THEN
 RAISE EXCEPTION 'Private block has conflicting source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "TimeBlockSharedTaskLink_shape" BEFORE INSERT OR UPDATE ON "TimeBlockSharedTaskLink" FOR EACH ROW EXECUTE FUNCTION shared_block_link_shape();
CREATE FUNCTION private_block_shared_link_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (NEW."taskId" IS NOT NULL OR NEW."selectedTaskRevision" IS NOT NULL) AND EXISTS(SELECT 1 FROM "TimeBlockSharedTaskLink" WHERE "blockId"=NEW.id) THEN
 RAISE EXCEPTION 'Private block has shared source' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "TimeBlock_shared_source" BEFORE UPDATE ON "TimeBlock" FOR EACH ROW EXECUTE FUNCTION private_block_shared_link_shape();

ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check"
 CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment'));
COMMIT;
