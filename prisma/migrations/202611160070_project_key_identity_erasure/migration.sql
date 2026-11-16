BEGIN;
-- Retained shared records must never retain or block deletion of Personal identity.
ALTER TABLE "Project" ADD COLUMN "keyOwnerErased" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" DROP CONSTRAINT "Project_key_owner_user_fk",
 DROP CONSTRAINT "Project_key_namespace_check";
ALTER TABLE "Project" ADD CONSTRAINT "Project_key_owner_user_fk" FOREIGN KEY ("keyOwnerUserId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE NO ACTION,
 ADD CONSTRAINT "Project_key_namespace_check" CHECK(num_nonnulls("keyOwnerUserId","keyOwnerTeamId")<=1 AND
 (NOT "keyOwnerErased" OR num_nonnulls("keyOwnerUserId","keyOwnerTeamId")=0) AND
 (key IS NULL OR num_nonnulls("keyOwnerUserId","keyOwnerTeamId")=1 OR "keyOwnerErased"));
CREATE OR REPLACE FUNCTION project_key_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_state text;
BEGIN
 NEW."keyOwnerErased":=false;
 IF NEW."keyOwnerTeamId" IS NOT NULL THEN NEW."keyOwnerUserId":=NULL;
 ELSE
  SELECT a."userId",a.state INTO NEW."keyOwnerUserId",owner_state FROM "ContextAccess" x JOIN "SharedActor" a ON a.id=x."actorId"
  WHERE x.id=coalesce((SELECT d."primaryOwnerAccessId" FROM "DomainScopeCustody" d WHERE d."scopeId"=NEW."scopeId"),(SELECT c."primaryOwnerAccessId" FROM "SharedCustody" c WHERE c."spaceId"=NEW."spaceId"));
  NEW."keyOwnerErased":=coalesce(owner_state='ERASED' AND NEW."keyOwnerUserId" IS NULL,false);
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION project_key_actor_erased() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='ERASED' AND NEW."userId" IS NULL THEN
  UPDATE "Project" p SET "keyOwnerUserId"=NULL WHERE p."keyOwnerTeamId" IS NULL AND
   EXISTS(SELECT 1 FROM "ContextAccess" x WHERE x."actorId"=NEW.id AND x.id=coalesce(
    (SELECT d."primaryOwnerAccessId" FROM "DomainScopeCustody" d WHERE d."scopeId"=p."scopeId"),
    (SELECT c."primaryOwnerAccessId" FROM "SharedCustody" c WHERE c."spaceId"=p."spaceId")));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Project_key_actor_erased" AFTER UPDATE OF "userId",state ON "SharedActor" FOR EACH ROW EXECUTE FUNCTION project_key_actor_erased();
-- Repair only new namespace metadata, without rewriting key/revision/history.
UPDATE "Project" p SET "keyOwnerUserId"=NULL WHERE p."keyOwnerTeamId" IS NULL AND
 EXISTS(SELECT 1 FROM "ContextAccess" x JOIN "SharedActor" a ON a.id=x."actorId" WHERE a.state='ERASED' AND a."userId" IS NULL AND x.id=coalesce(
 (SELECT d."primaryOwnerAccessId" FROM "DomainScopeCustody" d WHERE d."scopeId"=p."scopeId"),
 (SELECT c."primaryOwnerAccessId" FROM "SharedCustody" c WHERE c."spaceId"=p."spaceId")));
COMMIT;
