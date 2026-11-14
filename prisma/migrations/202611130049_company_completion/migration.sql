BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- C-M1 (OD-9/F1): one fixed Company currency. Nullable for existing Companies; never derived.
ALTER TABLE "Company" ADD COLUMN "currency" varchar(3), ADD COLUMN "scale" integer;
ALTER TABLE "Company" ADD CONSTRAINT "Company_currency_shape" CHECK((currency IS NULL)=(scale IS NULL) AND (currency IS NULL OR (currency ~ '^[A-Z]{3}$' AND scale BETWEEN 0 AND 4)));
-- Counted financial records: every CompanyBudget and every CompanyExpenseVersion (any state).
-- Commitments, adjustments, allocations, reimbursement buckets and acknowledgements all derive from them.
CREATE FUNCTION company_currency_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE fixed text; fixed_scale integer;
BEGIN
 SELECT currency,scale INTO fixed,fixed_scale FROM "Company" WHERE "spaceId"=NEW."spaceId" FOR SHARE;
 IF fixed IS NULL OR fixed<>NEW.currency OR fixed_scale<>NEW.scale THEN RAISE EXCEPTION 'Company currency required or mismatched' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyBudget_currency" BEFORE INSERT OR UPDATE OF currency,scale ON "CompanyBudget" FOR EACH ROW EXECUTE FUNCTION company_currency_record_guard();
CREATE TRIGGER "CompanyExpenseVersion_currency" BEFORE INSERT OR UPDATE OF currency,scale ON "CompanyExpenseVersion" FOR EACH ROW EXECUTE FUNCTION company_currency_record_guard();
CREATE FUNCTION company_currency_lock_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (NEW.currency,NEW.scale) IS NOT DISTINCT FROM (OLD.currency,OLD.scale) THEN RETURN NEW; END IF;
 IF NEW.currency IS NULL THEN RAISE EXCEPTION 'Company currency cannot be cleared' USING ERRCODE='23514'; END IF;
 IF OLD.currency IS NOT NULL AND (EXISTS(SELECT 1 FROM "CompanyBudget" WHERE "spaceId"=NEW."spaceId") OR EXISTS(SELECT 1 FROM "CompanyExpenseVersion" WHERE "spaceId"=NEW."spaceId")) THEN RAISE EXCEPTION 'Company currency locked' USING ERRCODE='23514'; END IF;
 -- Legacy configuration only confirms the single currency already used; it never converts amounts.
 IF EXISTS(SELECT 1 FROM "CompanyBudget" WHERE "spaceId"=NEW."spaceId" AND (currency<>NEW.currency OR scale<>NEW.scale)) OR EXISTS(SELECT 1 FROM "CompanyExpenseVersion" WHERE "spaceId"=NEW."spaceId" AND (currency<>NEW.currency OR scale<>NEW.scale)) THEN RAISE EXCEPTION 'Company currency conflicts with existing records' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "Company_currency_lock" BEFORE UPDATE OF currency,scale ON "Company" FOR EACH ROW EXECUTE FUNCTION company_currency_lock_guard();
-- C-M3: owner-approved work contact fields (no private/home data). Redaction clears them.
ALTER TABLE "CompanyStaffProfile" ADD COLUMN "workPhone" varchar(40), ADD COLUMN "workLocation" varchar(200), ADD COLUMN "workHours" varchar(200);
ALTER TABLE "CompanyStaffProfile" ADD CONSTRAINT "CompanyStaffProfile_work_details_redaction" CHECK("redactedAt" IS NULL OR ("workPhone" IS NULL AND "workLocation" IS NULL AND "workHours" IS NULL));
-- C-M4: manager-defined resource types and versioned role-based approval workflows.
CREATE TABLE "CompanyResourceType" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "createdByActorId" uuid NOT NULL,
 "title" varchar(300) NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK(length(btrim(title))>0),
 CONSTRAINT "CompanyResourceType_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceType_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceType_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
ALTER TABLE "CompanyResource" ADD COLUMN "typeId" uuid;
ALTER TABLE "CompanyResource" ADD CONSTRAINT "CompanyResource_type" FOREIGN KEY("spaceId","scopeId","typeId") REFERENCES "CompanyResourceType"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE TABLE "CompanyResourceWorkflowVersion" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "typeId" uuid NOT NULL,
 "createdByActorId" uuid NOT NULL,
 "state" varchar(9) NOT NULL,
 "steps" jsonb NOT NULL,
 "publishedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK(state IN ('DRAFT','PUBLISHED','ARCHIVED')),
 CHECK(jsonb_typeof(steps)='array' AND jsonb_array_length(steps) BETWEEN 1 AND 10),
 CHECK((state='DRAFT')=("publishedAt" IS NULL) OR (state='ARCHIVED')),
 CONSTRAINT "CompanyResourceWorkflowVersion_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceWorkflowVersion_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceWorkflowVersion_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceWorkflowVersion_type" FOREIGN KEY("spaceId","scopeId","typeId") REFERENCES "CompanyResourceType"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "CompanyResourceWorkflowVersion_published" ON "CompanyResourceWorkflowVersion"("spaceId","scopeId","typeId") WHERE state='PUBLISHED';
CREATE TABLE "CompanyResourceRequest" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "resourceId" uuid NOT NULL,
 "workflowVersionId" uuid NOT NULL,
 "requesterAccessId" uuid NOT NULL,
 "requesterGeneration" integer NOT NULL CHECK("requesterGeneration">0),
 "requesterActorId" uuid NOT NULL,
 "startAt" timestamptz(3) NOT NULL,
 "endAt" timestamptz(3) NOT NULL,
 "reason" varchar(2000),
 "state" varchar(9) NOT NULL,
 "step" integer NOT NULL,
 "allocationId" uuid,
 "decidedAt" timestamptz(3),
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(revision>0),
 CHECK("startAt"<"endAt"),
 CHECK(step BETWEEN 0 AND 9),
 CHECK(state IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
 CHECK((state='APPROVED')=("allocationId" IS NOT NULL)),
 CHECK((state='PENDING')=("decidedAt" IS NULL)),
 CHECK("redactedAt" IS NULL OR reason IS NULL),
 CONSTRAINT "CompanyResourceRequest_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequest_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequest_resource" FOREIGN KEY("spaceId","scopeId","resourceId") REFERENCES "CompanyResource"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequest_workflow" FOREIGN KEY("spaceId","scopeId","workflowVersionId") REFERENCES "CompanyResourceWorkflowVersion"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequest_requesterMember" FOREIGN KEY("spaceId","scopeId","requesterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequest_requesterInterval" FOREIGN KEY("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequest_requesterActor" FOREIGN KEY("spaceId","requesterActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequest_allocation" FOREIGN KEY("spaceId","scopeId","allocationId") REFERENCES "CompanyResourceAllocation"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyResourceRequest_page" ON "CompanyResourceRequest"("spaceId","scopeId",id);
CREATE UNIQUE INDEX "CompanyResourceRequest_allocation_once" ON "CompanyResourceRequest"("allocationId");
CREATE TABLE "CompanyResourceRequestEvent" (
 "id" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "requestId" uuid NOT NULL,
 "actorId" uuid NOT NULL,
 "kind" varchar(8) NOT NULL,
 "step" integer,
 "reason" varchar(2000),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","scopeId",id),
 CHECK(kind IN ('SUBMIT','APPROVE','REJECT','WITHDRAW')),
 CHECK((kind IN ('APPROVE','REJECT'))=(step IS NOT NULL)),
 CONSTRAINT "CompanyResourceRequestEvent_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequestEvent_request" FOREIGN KEY("spaceId","scopeId","requestId") REFERENCES "CompanyResourceRequest"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyResourceRequestEvent_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyResourceRequestEvent_history" ON "CompanyResourceRequestEvent"("spaceId","requestId","createdAt",id);
CREATE FUNCTION company_resource_approval_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Company" WHERE "spaceId"=NEW."spaceId") THEN RAISE EXCEPTION 'Company records require Company custody' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyResourceRequestEvent' THEN
  -- Append-only history; only erasure may clear a reason.
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'reason' IS DISTINCT FROM to_jsonb(OLD)-'reason' OR NEW.reason IS NOT NULL) THEN RAISE EXCEPTION 'Append only resource request history' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdAt") OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable Company identity or stale revision' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyResourceWorkflowVersion' AND TG_OP='UPDATE' THEN
  IF (NEW."typeId",NEW."createdByActorId") IS DISTINCT FROM (OLD."typeId",OLD."createdByActorId") OR (OLD.state<>'DRAFT' AND NEW.steps IS DISTINCT FROM OLD.steps) OR (OLD.state='PUBLISHED' AND NEW.state NOT IN ('PUBLISHED','ARCHIVED')) OR (OLD.state='ARCHIVED' AND NEW.state<>'ARCHIVED') OR (OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt") THEN RAISE EXCEPTION 'Immutable published workflow version' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='CompanyResourceRequest' THEN
  IF TG_OP='INSERT' AND (NEW.state<>'PENDING' OR NEW.step<>0 OR NOT EXISTS(SELECT 1 FROM "CompanyResourceWorkflowVersion" w JOIN "CompanyResource" r ON r."spaceId"=w."spaceId" AND r."scopeId"=w."scopeId" AND r."typeId"=w."typeId" WHERE w.id=NEW."workflowVersionId" AND w.state='PUBLISHED' AND r.id=NEW."resourceId" AND r.state='ACTIVE')) THEN RAISE EXCEPTION 'Request needs an active typed resource and its published workflow' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
   IF (NEW."resourceId",NEW."workflowVersionId",NEW."requesterAccessId",NEW."requesterGeneration",NEW."requesterActorId",NEW."startAt",NEW."endAt") IS DISTINCT FROM (OLD."resourceId",OLD."workflowVersionId",OLD."requesterAccessId",OLD."requesterGeneration",OLD."requesterActorId",OLD."startAt",OLD."endAt") OR (OLD.state<>'PENDING' AND to_jsonb(NEW)-'reason'-'redactedAt'-'revision'-'updatedAt' IS DISTINCT FROM to_jsonb(OLD)-'reason'-'redactedAt'-'revision'-'updatedAt') OR (OLD."redactedAt" IS NULL AND NEW.reason IS DISTINCT FROM OLD.reason AND NEW."redactedAt" IS NULL) OR NEW.step<OLD.step OR (OLD."redactedAt" IS NOT NULL AND NEW."redactedAt" IS NULL) THEN RAISE EXCEPTION 'Immutable or terminal resource request' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyResourceType_guard" BEFORE INSERT OR UPDATE ON "CompanyResourceType" FOR EACH ROW EXECUTE FUNCTION company_resource_approval_guard();
CREATE TRIGGER "CompanyResourceWorkflowVersion_guard" BEFORE INSERT OR UPDATE ON "CompanyResourceWorkflowVersion" FOR EACH ROW EXECUTE FUNCTION company_resource_approval_guard();
CREATE TRIGGER "CompanyResourceRequest_guard" BEFORE INSERT OR UPDATE ON "CompanyResourceRequest" FOR EACH ROW EXECUTE FUNCTION company_resource_approval_guard();
CREATE TRIGGER "CompanyResourceRequestEvent_guard" BEFORE INSERT OR UPDATE ON "CompanyResourceRequestEvent" FOR EACH ROW EXECUTE FUNCTION company_resource_approval_guard();
COMMIT;
