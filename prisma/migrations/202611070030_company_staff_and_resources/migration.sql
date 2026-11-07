BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE "CompanyStaffProfile" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "memberAccessId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL CHECK("memberGeneration">0),
 "position" varchar(300),
 "supervisorAccessId" uuid,
 "supervisorGeneration" integer,
 "workStatus" varchar(8) NOT NULL,
 "workEmail" varchar(320),
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK("workStatus" IN ('ACTIVE','INACTIVE')),
 CHECK(("supervisorAccessId" IS NULL)=("supervisorGeneration" IS NULL)),
 CHECK("redactedAt" IS NULL OR (position IS NULL AND "supervisorAccessId" IS NULL AND "workEmail" IS NULL AND "workStatus"='INACTIVE')),
 UNIQUE("spaceId","scopeId","memberAccessId","memberGeneration"),
 CONSTRAINT "CompanyStaffProfile_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyStaffProfile_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyStaffProfile_memberMember" FOREIGN KEY("spaceId","scopeId","memberAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyStaffProfile_memberInterval" FOREIGN KEY("memberAccessId","memberGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyStaffProfile_supervisor" FOREIGN KEY("spaceId","supervisorAccessId") REFERENCES "ContextAccess"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyStaffProfile_supervisorInterval" FOREIGN KEY("supervisorAccessId","supervisorGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyStaffProfile_page" ON "CompanyStaffProfile"("spaceId","scopeId",id);
CREATE TABLE "CompanyAvailabilityDay" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "memberAccessId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL CHECK("memberGeneration">0),
 "date" date NOT NULL,
 "timezone" varchar(100) NOT NULL,
 "availableMinutes" integer,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK("availableMinutes" IS NULL OR "availableMinutes" BETWEEN 0 AND 1440),
 UNIQUE("spaceId","scopeId","memberAccessId","memberGeneration","date","timezone"),
 CONSTRAINT "CompanyAvailabilityDay_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyAvailabilityDay_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyAvailabilityDay_memberMember" FOREIGN KEY("spaceId","scopeId","memberAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyAvailabilityDay_memberInterval" FOREIGN KEY("memberAccessId","memberGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyAvailabilityDay_page" ON "CompanyAvailabilityDay"("spaceId","scopeId",id);
CREATE TABLE "CompanyResource" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "createdByActorId" uuid NOT NULL,
 "title" varchar(300) NOT NULL,
 "description" varchar(10000),
 "state" varchar(8) NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK(state IN ('ACTIVE','RETIRED')),
 CONSTRAINT "CompanyResource_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResource_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResource_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyResource_page" ON "CompanyResource"("spaceId","scopeId",id);
CREATE TABLE "CompanyResourceAllocation" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "resourceId" uuid NOT NULL,
 "memberAccessId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL CHECK("memberGeneration">0),
 "createdByActorId" uuid NOT NULL,
 "startAt" timestamptz(3) NOT NULL,
 "endAt" timestamptz(3) NOT NULL,
 "state" varchar(9) NOT NULL,
 "endedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK("startAt"<"endAt"),
 CHECK(state IN ('ALLOCATED','CANCELED','RETURNED')),
 CHECK((state='ALLOCATED')=("endedAt" IS NULL)),
 CONSTRAINT "CompanyResourceAllocation_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceAllocation_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceAllocation_memberMember" FOREIGN KEY("spaceId","scopeId","memberAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceAllocation_memberInterval" FOREIGN KEY("memberAccessId","memberGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceAllocation_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceAllocation_resource" FOREIGN KEY("spaceId","scopeId","resourceId") REFERENCES "CompanyResource"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyResourceAllocation_page" ON "CompanyResourceAllocation"("spaceId","scopeId",id);
CREATE TABLE "CompanyEmployeeCase" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "authorAccessId" uuid NOT NULL,
 "authorGeneration" integer NOT NULL CHECK("authorGeneration">0),
 "subjectAccessId" uuid NOT NULL,
 "subjectGeneration" integer NOT NULL CHECK("subjectGeneration">0),
 "reviewerAccessId" uuid NOT NULL,
 "reviewerGeneration" integer NOT NULL CHECK("reviewerGeneration">0),
 "reason" varchar(10000),
 "evidence" varchar(10000),
 "state" varchar(8) NOT NULL,
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK("authorAccessId"<>"subjectAccessId" AND "authorAccessId"<>"reviewerAccessId" AND "subjectAccessId"<>"reviewerAccessId"),
 CHECK(state IN ('OPEN','RESOLVED')),
 CHECK(("redactedAt" IS NULL AND reason IS NOT NULL AND evidence IS NOT NULL) OR ("redactedAt" IS NOT NULL AND reason IS NULL AND evidence IS NULL)),
 CONSTRAINT "CompanyEmployeeCase_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCase_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCase_authorMember" FOREIGN KEY("spaceId","scopeId","authorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCase_authorInterval" FOREIGN KEY("authorAccessId","authorGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCase_subjectMember" FOREIGN KEY("spaceId","scopeId","subjectAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCase_subjectInterval" FOREIGN KEY("subjectAccessId","subjectGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCase_reviewerMember" FOREIGN KEY("spaceId","scopeId","reviewerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCase_reviewerInterval" FOREIGN KEY("reviewerAccessId","reviewerGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyEmployeeCase_page" ON "CompanyEmployeeCase"("spaceId","scopeId",id);
CREATE TABLE "CompanyEmployeeCaseEntry" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "caseId" uuid NOT NULL,
 "createdByActorId" uuid NOT NULL,
 "kind" varchar(10) NOT NULL,
 "body" varchar(10000),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK(kind IN ('CORRECTION','RESPONSE','APPEAL','REVIEW')),
 CONSTRAINT "CompanyEmployeeCaseEntry_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCaseEntry_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCaseEntry_case" FOREIGN KEY("spaceId","scopeId","caseId") REFERENCES "CompanyEmployeeCase"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeCaseEntry_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyEmployeeCaseEntry_page" ON "CompanyEmployeeCaseEntry"("spaceId","scopeId",id);
CREATE INDEX "CompanyResourceAllocation_overlap" ON "CompanyResourceAllocation"("spaceId","resourceId","startAt","endAt") WHERE state='ALLOCATED';
CREATE INDEX "CompanyEmployeeCase_participants" ON "CompanyEmployeeCase"("spaceId","scopeId","subjectAccessId","subjectGeneration",id);
CREATE INDEX "CompanyEmployeeCaseEntry_case_page" ON "CompanyEmployeeCaseEntry"("spaceId","scopeId","caseId",id);
CREATE FUNCTION company_staff_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE resource_state text; case_redacted timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Company" WHERE "spaceId"=NEW."spaceId") THEN RAISE EXCEPTION 'Company records require Company custody' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdAt") OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Company identity or stale revision' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME IN ('CompanyStaffProfile','CompanyAvailabilityDay','CompanyResourceAllocation') AND (to_jsonb(NEW)->'memberAccessId',to_jsonb(NEW)->'memberGeneration') IS DISTINCT FROM (to_jsonb(OLD)->'memberAccessId',to_jsonb(OLD)->'memberGeneration') THEN RAISE EXCEPTION 'Immutable admission generation' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='CompanyAvailabilityDay' THEN IF (NEW.date,NEW.timezone) IS DISTINCT FROM (OLD.date,OLD.timezone) THEN RAISE EXCEPTION 'Immutable capacity identity' USING ERRCODE='23514'; END IF; END IF;
  IF TG_TABLE_NAME='CompanyStaffProfile' THEN IF OLD."redactedAt" IS NOT NULL AND to_jsonb(NEW)-'revision'-'updatedAt' IS DISTINCT FROM to_jsonb(OLD)-'revision'-'updatedAt' THEN RAISE EXCEPTION 'Redaction is irreversible' USING ERRCODE='23514'; END IF; END IF;
  IF TG_TABLE_NAME='CompanyResource' THEN IF (NEW."createdByActorId"<>OLD."createdByActorId" OR (OLD.state='RETIRED' AND NEW.state<>'RETIRED')) THEN RAISE EXCEPTION 'Immutable resource history' USING ERRCODE='23514'; END IF; END IF;
  IF TG_TABLE_NAME='CompanyResourceAllocation' THEN IF (to_jsonb(NEW)-'state'-'endedAt'-'revision'-'updatedAt' IS DISTINCT FROM to_jsonb(OLD)-'state'-'endedAt'-'revision'-'updatedAt' OR OLD.state<>'ALLOCATED' OR NEW.state='ALLOCATED') THEN RAISE EXCEPTION 'Immutable or terminal allocation' USING ERRCODE='23514'; END IF; END IF;
  IF TG_TABLE_NAME='CompanyEmployeeCase' THEN
   IF to_jsonb(NEW)-'reason'-'evidence'-'state'-'redactedAt'-'revision'-'updatedAt' IS DISTINCT FROM to_jsonb(OLD)-'reason'-'evidence'-'state'-'redactedAt'-'revision'-'updatedAt' OR (OLD."redactedAt" IS NOT NULL AND to_jsonb(NEW)-'revision'-'updatedAt' IS DISTINCT FROM to_jsonb(OLD)-'revision'-'updatedAt') OR (NEW."redactedAt" IS NULL AND (NEW.reason,NEW.evidence) IS DISTINCT FROM (OLD.reason,OLD.evidence)) THEN RAISE EXCEPTION 'Immutable case binding or evidence' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='CompanyEmployeeCaseEntry' THEN IF (to_jsonb(NEW)-'body'-'revision'-'updatedAt' IS DISTINCT FROM to_jsonb(OLD)-'body'-'revision'-'updatedAt' OR NEW.body IS NOT NULL OR OLD.body IS NULL) THEN RAISE EXCEPTION 'Append only case history' USING ERRCODE='23514'; END IF; END IF;
 END IF;
 IF TG_TABLE_NAME='CompanyResourceAllocation' THEN
  SELECT state INTO resource_state FROM "CompanyResource" WHERE id=NEW."resourceId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" FOR UPDATE;
  IF NEW.state='ALLOCATED' AND (resource_state<>'ACTIVE' OR EXISTS(SELECT 1 FROM "CompanyResourceAllocation" a WHERE a."resourceId"=NEW."resourceId" AND a.id<>NEW.id AND a.state='ALLOCATED' AND a."startAt"<NEW."endAt" AND NEW."startAt"<a."endAt")) THEN RAISE EXCEPTION 'Resource unavailable or overlapping allocation' USING ERRCODE='23P01'; END IF;
 END IF;
 IF TG_TABLE_NAME='CompanyResource' THEN IF NEW.state='RETIRED' AND EXISTS(SELECT 1 FROM "CompanyResourceAllocation" WHERE "resourceId"=NEW.id AND state='ALLOCATED') THEN RAISE EXCEPTION 'Outstanding allocation' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME='CompanyEmployeeCaseEntry' THEN
  SELECT "redactedAt" INTO case_redacted FROM "CompanyEmployeeCase" WHERE id=NEW."caseId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId";
  IF (TG_OP='INSERT' AND (case_redacted IS NOT NULL OR NEW.body IS NULL)) OR (TG_OP='UPDATE' AND case_redacted IS NULL) THEN RAISE EXCEPTION 'Case entry privacy shape' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyStaffProfile_guard" BEFORE INSERT OR UPDATE ON "CompanyStaffProfile" FOR EACH ROW EXECUTE FUNCTION company_staff_guard();
CREATE TRIGGER "CompanyAvailabilityDay_guard" BEFORE INSERT OR UPDATE ON "CompanyAvailabilityDay" FOR EACH ROW EXECUTE FUNCTION company_staff_guard();
CREATE TRIGGER "CompanyResource_guard" BEFORE INSERT OR UPDATE ON "CompanyResource" FOR EACH ROW EXECUTE FUNCTION company_staff_guard();
CREATE TRIGGER "CompanyResourceAllocation_guard" BEFORE INSERT OR UPDATE ON "CompanyResourceAllocation" FOR EACH ROW EXECUTE FUNCTION company_staff_guard();
CREATE TRIGGER "CompanyEmployeeCase_guard" BEFORE INSERT OR UPDATE ON "CompanyEmployeeCase" FOR EACH ROW EXECUTE FUNCTION company_staff_guard();
CREATE TRIGGER "CompanyEmployeeCaseEntry_guard" BEFORE INSERT OR UPDATE ON "CompanyEmployeeCaseEntry" FOR EACH ROW EXECUTE FUNCTION company_staff_guard();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry'));
COMMIT;
