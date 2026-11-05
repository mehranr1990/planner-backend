BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "ProjectGoal" ADD CONSTRAINT "ProjectGoal_project_goal_key" UNIQUE("spaceId","scopeId","projectId","goalId");
CREATE TABLE "ProjectDocument" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"retiredAt" timestamptz(3),"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"createdByActorId" uuid NOT NULL,
 "creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 UNIQUE("spaceId","scopeId","projectId",id),UNIQUE("spaceId","scopeId","projectId","creationKey"),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectDocument_page" ON "ProjectDocument"("spaceId","scopeId","projectId",id);
CREATE TABLE "ProjectDocumentVersion" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"documentId" uuid NOT NULL,version integer NOT NULL CHECK(version>0),title varchar(300) NOT NULL,body varchar(100000) NOT NULL,"actorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("documentId",version),
 FOREIGN KEY("spaceId","scopeId","projectId","documentId") REFERENCES "ProjectDocument"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE TRIGGER "ProjectDocumentVersion_immutable" BEFORE UPDATE OR DELETE ON "ProjectDocumentVersion" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_current_version_fk" FOREIGN KEY(id,revision) REFERENCES "ProjectDocumentVersion"("documentId",version) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION project_document_publication() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM "ProjectDocument" WHERE id=NEW."documentId" AND revision=NEW.version AND title=NEW.title AND xmin::text::bigint=(txid_current()%4294967296)) THEN RAISE EXCEPTION 'Document version needs current publication' USING ERRCODE='23514';END IF;RETURN NEW;END; $$;
CREATE TRIGGER "ProjectDocumentVersion_publication" BEFORE INSERT ON "ProjectDocumentVersion" FOR EACH ROW EXECUTE FUNCTION project_document_publication();
CREATE TABLE "ProjectComment" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,
 "taskId" uuid,"goalId" uuid,"documentId" uuid,
 body varchar(10000) NOT NULL CHECK(length(btrim(body))>0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"deletedAt" timestamptz(3),"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"createdByActorId" uuid NOT NULL,
 "creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 CHECK(num_nonnulls("taskId","goalId","documentId")<=1),
 UNIQUE("spaceId","scopeId","projectId",id),UNIQUE("spaceId","scopeId","projectId","creationKey"),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","taskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","goalId") REFERENCES "ProjectGoal"("spaceId","scopeId","projectId","goalId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","documentId") REFERENCES "ProjectDocument"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectComment_page" ON "ProjectComment"("spaceId","scopeId","projectId","taskId","goalId","documentId",id);
CREATE TABLE "ProjectCommentVersion" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"commentId" uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),body varchar(10000),"actorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("commentId",revision),FOREIGN KEY("spaceId","scopeId","projectId","commentId") REFERENCES "ProjectComment"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE TRIGGER "ProjectCommentVersion_immutable" BEFORE UPDATE OR DELETE ON "ProjectCommentVersion" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE TABLE "ProjectActivity" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"taskId" uuid,"goalId" uuid,"documentId" uuid,"actorId" uuid NOT NULL,action varchar(80) NOT NULL CHECK(action ~ '^[a-z.]{1,80}$'),"resourceId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls("taskId","goalId","documentId")<=1),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","taskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","goalId") REFERENCES "ProjectGoal"("spaceId","scopeId","projectId","goalId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","documentId") REFERENCES "ProjectDocument"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectActivity_page" ON "ProjectActivity"("spaceId","scopeId","projectId","taskId","goalId","documentId",id);
CREATE TRIGGER "ProjectActivity_immutable" BEFORE UPDATE OR DELETE ON "ProjectActivity" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE FUNCTION project_collaboration_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_TABLE_NAME='ProjectDocument' THEN
  IF OLD."retiredAt" IS NOT NULL OR NEW.revision<>OLD.revision+1 OR (to_jsonb(NEW)-ARRAY['title','revision','retiredAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['title','revision','retiredAt']) THEN RAISE EXCEPTION 'Document identity is immutable' USING ERRCODE='23514';END IF;
 ELSE
  IF OLD."deletedAt" IS NOT NULL OR NEW.revision<>OLD.revision+1 OR (to_jsonb(NEW)-ARRAY['body','revision','deletedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['body','revision','deletedAt']) THEN RAISE EXCEPTION 'Comment identity is immutable' USING ERRCODE='23514';END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectDocument_shape" BEFORE UPDATE ON "ProjectDocument" FOR EACH ROW EXECUTE FUNCTION project_collaboration_shape();
CREATE TRIGGER "ProjectComment_shape" BEFORE UPDATE ON "ProjectComment" FOR EACH ROW EXECUTE FUNCTION project_collaboration_shape();
COMMIT;
