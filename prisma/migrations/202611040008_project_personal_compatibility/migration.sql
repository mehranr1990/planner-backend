BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Creator attribution is not Personal ownership. Preserve the existing Personal
-- creator-edit contract while keeping custody and shared attribution immutable.
CREATE OR REPLACE FUNCTION project_source_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE personal boolean;
BEGIN
 SELECT kind = 'PERSONAL' INTO personal FROM "Space" WHERE id=NEW."spaceId";
 IF personal IS NULL OR
   (personal AND (NEW."createdByUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL)) OR
   (NOT personal AND (NEW."createdByUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL OR
     NOT EXISTS(SELECT 1 FROM "Project" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId"))) THEN
   RAISE EXCEPTION 'Invalid Personal/shared source branch' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (
   (NEW."spaceId",NEW."scopeId",NEW."createdByActorId") IS DISTINCT FROM
   (OLD."spaceId",OLD."scopeId",OLD."createdByActorId") OR
   (NOT personal AND NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId")) THEN
   RAISE EXCEPTION 'Custody/attribution transfer requires its reviewed slice' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

COMMIT;
