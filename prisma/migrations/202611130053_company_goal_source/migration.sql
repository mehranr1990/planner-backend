BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- OD-2: shared Goal rows may also belong to an existing Company context (AccessScope in a
-- COMPANY-custody space). Tasks remain Project/Team only; all other branch rules are unchanged.
CREATE OR REPLACE FUNCTION project_source_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE personal boolean;
BEGIN
 SELECT kind='PERSONAL' INTO personal FROM "Space" WHERE id=NEW."spaceId";
 IF personal IS NULL OR (personal AND (NEW."createdByUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL)) OR (NOT personal AND (NEW."createdByUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL OR NOT EXISTS(SELECT 1 FROM "Project" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" UNION ALL SELECT 1 FROM "Team" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" UNION ALL SELECT 1 FROM "AccessScope" a JOIN "SharedCustody" k ON k."spaceId"=a."spaceId" AND k.kind='COMPANY' WHERE TG_TABLE_NAME='Goal' AND a."spaceId"=NEW."spaceId" AND a.id=NEW."scopeId"))) THEN RAISE EXCEPTION 'Invalid Personal/shared source branch' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((NEW."spaceId",NEW."scopeId",NEW."createdByActorId") IS DISTINCT FROM (OLD."spaceId",OLD."scopeId",OLD."createdByActorId") OR (NOT personal AND NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId")) THEN
  IF NOT (OLD."scopeId" IS NULL AND OLD."createdByUserId" IS NOT NULL AND NOT personal AND project_transfer_permitted(OLD."spaceId",NEW."spaceId",NEW.id,upper(TG_TABLE_NAME))) THEN RAISE EXCEPTION 'Custody transfer requires exact accepted manifest' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;
COMMIT;
