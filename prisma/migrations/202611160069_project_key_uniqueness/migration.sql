BEGIN;
-- Owner-approved: independent Projects share their current owner's account
-- namespace; explicitly Team-associated Projects use the selected Team namespace.
-- Preserve original key spelling and every existing URL/ID.
ALTER TABLE "Project" ADD COLUMN "keyOwnerUserId" UUID,
 ADD COLUMN "keyOwnerTeamId" UUID,
 ADD COLUMN "normalizedKey" VARCHAR(32) GENERATED ALWAYS AS (lower(btrim(key))) STORED;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Project" p WHERE p.key IS NOT NULL AND
   (SELECT count(*) FROM "TeamProjectReference" r WHERE r."projectId"=p.id AND r.active)>1)
 THEN RAISE EXCEPTION 'PROJECT_KEY_NAMESPACE_AMBIGUOUS'; END IF;
END $$;
UPDATE "Project" p SET "keyOwnerTeamId"=(SELECT r."teamId" FROM "TeamProjectReference" r WHERE r."projectId"=p.id AND r.active LIMIT 1);
UPDATE "Project" p SET "keyOwnerUserId"=a."userId" FROM "ContextAccess" x JOIN "SharedActor" a ON a.id=x."actorId"
WHERE p."keyOwnerTeamId" IS NULL AND x.id=coalesce(
 (SELECT d."primaryOwnerAccessId" FROM "DomainScopeCustody" d WHERE d."scopeId"=p."scopeId"),
 (SELECT c."primaryOwnerAccessId" FROM "SharedCustody" c WHERE c."spaceId"=p."spaceId"));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "Project" WHERE key IS NOT NULL AND "keyOwnerUserId" IS NULL AND "keyOwnerTeamId" IS NULL)
 THEN RAISE EXCEPTION 'PROJECT_KEY_OWNER_UNRESOLVED'; END IF;
 IF EXISTS(SELECT 1 FROM "Project" WHERE key IS NOT NULL GROUP BY "keyOwnerUserId","keyOwnerTeamId","normalizedKey" HAVING count(*)>1)
 THEN RAISE EXCEPTION 'PROJECT_KEY_DUPLICATES_REQUIRE_OWNER_REVIEW'; END IF;
END $$;
ALTER TABLE "Project" ADD CONSTRAINT "Project_key_owner_user_fk" FOREIGN KEY ("keyOwnerUserId") REFERENCES "User"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 ADD CONSTRAINT "Project_key_owner_team_fk" FOREIGN KEY ("keyOwnerTeamId") REFERENCES "Team"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 ADD CONSTRAINT "Project_key_namespace_check" CHECK(num_nonnulls("keyOwnerUserId","keyOwnerTeamId")<=1 AND (key IS NULL OR num_nonnulls("keyOwnerUserId","keyOwnerTeamId")=1)),
 ADD CONSTRAINT "Project_key_owner_user_unique" UNIQUE("keyOwnerUserId","normalizedKey"),
 ADD CONSTRAINT "Project_key_owner_team_unique" UNIQUE("keyOwnerTeamId","normalizedKey");
CREATE FUNCTION project_key_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."keyOwnerTeamId" IS NOT NULL THEN NEW."keyOwnerUserId":=NULL;
 ELSE
  SELECT a."userId" INTO NEW."keyOwnerUserId" FROM "ContextAccess" x JOIN "SharedActor" a ON a.id=x."actorId"
  WHERE x.id=coalesce((SELECT d."primaryOwnerAccessId" FROM "DomainScopeCustody" d WHERE d."scopeId"=NEW."scopeId"),(SELECT c."primaryOwnerAccessId" FROM "SharedCustody" c WHERE c."spaceId"=NEW."spaceId"));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Project_key_owner" BEFORE INSERT OR UPDATE OF key,"keyOwnerUserId","keyOwnerTeamId","scopeId","spaceId" ON "Project" FOR EACH ROW EXECUTE FUNCTION project_key_owner();
-- Handover stays atomic: a destination collision rejects the handover transaction.
CREATE FUNCTION project_key_custody_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."primaryOwnerAccessId" IS DISTINCT FROM OLD."primaryOwnerAccessId" AND NEW."primaryOwnerAccessId" IS NOT NULL THEN
  IF TG_TABLE_NAME='SharedCustody' THEN UPDATE "Project" SET "keyOwnerUserId"=NULL WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."spaceId" AND "keyOwnerTeamId" IS NULL;
  ELSE UPDATE "Project" SET "keyOwnerUserId"=NULL WHERE "scopeId"=NEW."scopeId" AND "keyOwnerTeamId" IS NULL; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Project_key_root_handover" AFTER UPDATE OF "primaryOwnerAccessId" ON "SharedCustody" FOR EACH ROW EXECUTE FUNCTION project_key_custody_changed();
CREATE TRIGGER "Project_key_domain_handover" AFTER UPDATE OF "primaryOwnerAccessId" ON "DomainScopeCustody" FOR EACH ROW EXECUTE FUNCTION project_key_custody_changed();
-- Removing a Team never deletes its independently admitted Projects. Rehome the
-- namespace to the current Project owner; fail closed on a real key collision.
CREATE FUNCTION project_key_team_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE "Project" SET "keyOwnerTeamId"=NULL WHERE "keyOwnerTeamId"=OLD.id; RETURN OLD; END $$;
CREATE TRIGGER "Project_key_team_deleted" BEFORE DELETE ON "Team" FOR EACH ROW EXECUTE FUNCTION project_key_team_deleted();
COMMIT;
