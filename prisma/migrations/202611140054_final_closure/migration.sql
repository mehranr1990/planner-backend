BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- B4 estimates: explicit, user-set Personal Task category (nullable; existing rows stay NULL).
-- Shared (Project/Team) Task rows never carry it.
ALTER TABLE "Task" ADD COLUMN "category" varchar(16);
ALTER TABLE "Task" ADD CONSTRAINT "Task_category_check" CHECK(category IS NULL OR (category IN ('design','admin','writing','errands') AND "scopeId" IS NULL));
-- The productivity audit may also name the category field (superset of the previous rule).
ALTER TABLE "SecurityAuditEvent" DROP CONSTRAINT "SecurityAuditEvent_productivity_fields";
ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_productivity_fields" CHECK ("productivityFields" <@ ARRAY['estimatedMinutes','important','urgent','category']::text[] AND cardinality("productivityFields")<=4) NOT VALID;
ALTER TABLE "SecurityAuditEvent" VALIDATE CONSTRAINT "SecurityAuditEvent_productivity_fields";
-- OD-5 context move: a unit moves to another department of the same Company. Each move is
-- recorded first; the unit's departmentId may change only to match that record.
CREATE TABLE "CompanyContextMove" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "fromDepartmentId" uuid NOT NULL,
 "toDepartmentId" uuid NOT NULL,
 "unitRevision" integer NOT NULL CHECK("unitRevision">1),
 "accessChanges" integer NOT NULL CHECK("accessChanges">=0),
 "actorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyContextMove_departments" CHECK("fromDepartmentId"<>"toDepartmentId"),
 CONSTRAINT "CompanyContextMove_revision" UNIQUE("scopeId","unitRevision"),
 CONSTRAINT "CompanyContextMove_unit" FOREIGN KEY("spaceId","scopeId") REFERENCES "CompanyUnit"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyContextMove_from" FOREIGN KEY("spaceId","fromDepartmentId") REFERENCES "CompanyDepartment"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyContextMove_to" FOREIGN KEY("spaceId","toDepartmentId") REFERENCES "CompanyDepartment"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyContextMove_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyContextMove_page" ON "CompanyContextMove"("spaceId",id);
CREATE FUNCTION company_context_move_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 RAISE EXCEPTION 'Immutable Company context move' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "CompanyContextMove_immutable" BEFORE UPDATE ON "CompanyContextMove" FOR EACH ROW EXECUTE FUNCTION company_context_move_guard();
-- Room booking title (optional): set by the booker only; private unless the booker shares it.
CREATE TABLE "CompanyRoomBookingTitle" (
 "allocationId" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 title varchar(120),
 shared boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyRoomBookingTitle_allocation" FOREIGN KEY("spaceId","scopeId","allocationId") REFERENCES "CompanyResourceAllocation"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
-- Same rules as 202611060028 except: a unit's departmentId may change only to the recorded move.
CREATE OR REPLACE FUNCTION company_domain_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE expected text;
BEGIN
 expected:=CASE TG_TABLE_NAME WHEN 'Company' THEN 'ROOT' WHEN 'CompanyDepartment' THEN 'DEPARTMENT' ELSE 'UNIT' END;
 IF NOT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "AccessScope" s ON s."spaceId"=c."spaceId" WHERE c."spaceId"=NEW."spaceId" AND c.kind='COMPANY' AND s.id=NEW."scopeId" AND s.kind=expected) THEN RAISE EXCEPTION 'Wrong Company context' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdByActorId",NEW."creationKey",NEW."creationFingerprint",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdByActorId",OLD."creationKey",OLD."creationFingerprint",OLD."createdAt") OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Company identity or stale revision' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='CompanyUnit' AND to_jsonb(NEW)->'departmentId' IS DISTINCT FROM to_jsonb(OLD)->'departmentId' AND NOT EXISTS(SELECT 1 FROM "CompanyContextMove" m WHERE m."spaceId"=NEW."spaceId" AND m."scopeId"=NEW.id AND m."fromDepartmentId"=(to_jsonb(OLD)->>'departmentId')::uuid AND m."toDepartmentId"=(to_jsonb(NEW)->>'departmentId')::uuid AND m."unitRevision"=NEW.revision) THEN RAISE EXCEPTION 'Unit reparenting requires a recorded move' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
COMMIT;
