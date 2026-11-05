BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "SharedCustody" DROP CONSTRAINT "SharedCustody_kind_check";
ALTER TABLE "SharedCustody" ADD CONSTRAINT "SharedCustody_kind_check" CHECK(kind IN ('PROJECT','TEAM'));
ALTER TABLE "ContextAccess" DROP CONSTRAINT "ContextAccess_memberRole_check";
ALTER TABLE "ContextAccess" ADD CONSTRAINT "ContextAccess_memberRole_check" CHECK("memberRole" IN ('ADMIN','MANAGER','LEAD','MEMBER','VIEWER'));
ALTER TABLE "ContextInvitation" DROP CONSTRAINT "ContextInvitation_memberRole_check";
ALTER TABLE "ContextInvitation" ADD CONSTRAINT "ContextInvitation_memberRole_check" CHECK("memberRole" IN ('ADMIN','MANAGER','LEAD','MEMBER','VIEWER'));
CREATE FUNCTION shared_context_role_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE context_kind text;
BEGIN
 SELECT kind INTO context_kind FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
 IF (context_kind='PROJECT' AND NEW."memberRole"='LEAD') OR (context_kind='TEAM' AND NEW."memberRole"='MANAGER') THEN
  RAISE EXCEPTION 'Role belongs to another context catalog' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "ContextAccess_role_catalog" BEFORE INSERT OR UPDATE ON "ContextAccess" FOR EACH ROW EXECUTE FUNCTION shared_context_role_guard();
CREATE TRIGGER "ContextInvitation_role_catalog" BEFORE INSERT OR UPDATE ON "ContextInvitation" FOR EACH ROW EXECUTE FUNCTION shared_context_role_guard();
CREATE OR REPLACE FUNCTION shared_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE role_name text; caps jsonb; cap text; catalog text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Published policy is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'SharedRetentionPolicy' THEN RETURN NEW; END IF;
  SELECT CASE WHEN kind='TEAM' THEN ARRAY['OWNER','ADMIN','LEAD','MEMBER','VIEWER'] ELSE ARRAY['OWNER','ADMIN','MANAGER','MEMBER','VIEWER'] END INTO catalog FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
  IF catalog IS NULL OR NOT (NEW."roleDefaults" ?& catalog) OR (SELECT count(*) FROM jsonb_object_keys(NEW."roleDefaults")) <> 5 THEN
    RAISE EXCEPTION 'Exact context role catalog required' USING ERRCODE = '23514';
  END IF;
  FOR role_name,caps IN SELECT * FROM jsonb_each(NEW."roleDefaults") LOOP
    IF jsonb_typeof(caps) <> 'array' THEN RAISE EXCEPTION 'Capabilities must be arrays' USING ERRCODE = '23514'; END IF;
    FOR cap IN SELECT jsonb_array_elements_text(caps) LOOP
      IF cap IS NULL OR cap NOT IN ('task.read','task.create','task.update','task.complete','task.delete','assignment.accept','assignment.decline','assignment.assign','workflow.transition','workflow.publish','export.visible','file.read')
        OR (role_name = 'VIEWER' AND cap NOT IN ('task.read','export.visible','file.read'))
        OR (role_name = 'MEMBER' AND cap IN ('task.delete','workflow.publish')) THEN
        RAISE EXCEPTION 'Capability exceeds fixed ordinary-role ceiling' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TABLE "Team" (
 id uuid PRIMARY KEY, "spaceId" uuid NOT NULL UNIQUE, "scopeId" uuid NOT NULL,
 "createdByActorId" uuid NOT NULL, title varchar(300) NOT NULL CHECK(length(btrim(title))>0),
 description varchar(10000), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "creationKey" char(64) NOT NULL, "creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK(id="spaceId" AND "scopeId"="spaceId"),
 FOREIGN KEY("spaceId") REFERENCES "SharedCustody"("spaceId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE FUNCTION shared_domain_root_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind=upper(TG_TABLE_NAME)) THEN
  RAISE EXCEPTION 'Wrong domain custody' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdByActorId",NEW."creationKey",NEW."creationFingerprint",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdByActorId",OLD."creationKey",OLD."creationFingerprint",OLD."createdAt") THEN
  RAISE EXCEPTION 'Immutable domain identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "Team_custody" BEFORE INSERT OR UPDATE ON "Team" FOR EACH ROW EXECUTE FUNCTION shared_domain_root_guard();
CREATE TRIGGER "Project_custody_kind" BEFORE INSERT OR UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION shared_domain_root_guard();
ALTER TABLE "Project" ADD CONSTRAINT "Project_space_id_pair" UNIQUE("spaceId",id);
CREATE TABLE "TeamProjectReference" (
 "teamId" uuid NOT NULL REFERENCES "Team"(id) ON DELETE NO ACTION,
 "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE NO ACTION,
 "spaceId" uuid NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY("teamId","projectId"),
 FOREIGN KEY("spaceId","projectId") REFERENCES "Project"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "TeamProjectReference_project" ON "TeamProjectReference"("projectId","teamId");
COMMIT;
