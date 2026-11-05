BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "StoredFile" ALTER COLUMN "ownerUserId" DROP NOT NULL;
ALTER TABLE "StoredFile" ADD COLUMN "scopeId" uuid, ADD COLUMN "createdByActorId" uuid;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_direct_space_fk" FOREIGN KEY("spaceId") REFERENCES "Space"(id) ON DELETE CASCADE;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_scope_fk" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_shared_actor_fk" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_scope_id_key" UNIQUE("spaceId","scopeId",id);
CREATE FUNCTION shared_file_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE k "SpaceKind";
BEGIN
 SELECT kind INTO k FROM "Space" WHERE id=NEW."spaceId";
 IF k='PERSONAL' AND (NEW."ownerUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL) OR k='SHARED' AND (NEW."ownerUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL) THEN RAISE EXCEPTION 'File custody branch is invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "StoredFile_branch" BEFORE INSERT OR UPDATE ON "StoredFile" FOR EACH ROW EXECUTE FUNCTION shared_file_shape();
CREATE TABLE "ProjectFile" (
 "fileId" uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"taskId" uuid,"goalId" uuid,"documentId" uuid,"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 CHECK(num_nonnulls("taskId","goalId","documentId")<=1),UNIQUE("spaceId","scopeId","projectId","fileId"),UNIQUE("spaceId","scopeId","projectId","creationKey"),
 FOREIGN KEY("spaceId","scopeId","fileId") REFERENCES "StoredFile"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","taskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","goalId") REFERENCES "ProjectGoal"("spaceId","scopeId","projectId","goalId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","documentId") REFERENCES "ProjectDocument"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectFile_page" ON "ProjectFile"("spaceId","scopeId","projectId","taskId","goalId","documentId","fileId");
COMMIT;
