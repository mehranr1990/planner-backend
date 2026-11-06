BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION project_source_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE personal boolean;
BEGIN
 SELECT kind='PERSONAL' INTO personal FROM "Space" WHERE id=NEW."spaceId";
 IF personal IS NULL OR (personal AND (NEW."createdByUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL)) OR (NOT personal AND (NEW."createdByUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL OR NOT EXISTS(SELECT 1 FROM "Project" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" UNION ALL SELECT 1 FROM "Team" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId"))) THEN RAISE EXCEPTION 'Invalid Personal/shared source branch' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((NEW."spaceId",NEW."scopeId",NEW."createdByActorId") IS DISTINCT FROM (OLD."spaceId",OLD."scopeId",OLD."createdByActorId") OR (NOT personal AND NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId")) THEN
  IF NOT (OLD."scopeId" IS NULL AND OLD."createdByUserId" IS NOT NULL AND NOT personal AND project_transfer_permitted(OLD."spaceId",NEW."spaceId",NEW.id,upper(TG_TABLE_NAME))) THEN RAISE EXCEPTION 'Custody transfer requires exact accepted manifest' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;

ALTER TABLE "CalendarEvent" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "CalendarEvent" ADD COLUMN "scopeId" uuid, ADD COLUMN "createdByActorId" uuid,
 ADD CONSTRAINT "CalendarEvent_boundary" FOREIGN KEY("spaceId") REFERENCES "Space"(id) ON DELETE NO ACTION,
 ADD CONSTRAINT "CalendarEvent_scope" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "CalendarEvent_actor" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION;
ALTER TABLE "EventRecurrence" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "EventRecurrence" ADD COLUMN "scopeId" uuid, ADD COLUMN "createdByActorId" uuid,
 ADD CONSTRAINT "EventRecurrence_boundary" FOREIGN KEY("spaceId") REFERENCES "Space"(id) ON DELETE NO ACTION,
 ADD CONSTRAINT "EventRecurrence_scope" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 ADD CONSTRAINT "EventRecurrence_actor" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_scope_key" UNIQUE("spaceId","scopeId",id);
ALTER TABLE "EventRecurrence" ADD CONSTRAINT "EventRecurrence_parent_scope" FOREIGN KEY("spaceId","scopeId","eventId") REFERENCES "CalendarEvent"("spaceId","scopeId",id) ON DELETE CASCADE;
CREATE FUNCTION team_calendar_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE personal boolean;
BEGIN
 SELECT kind='PERSONAL' INTO personal FROM "Space" WHERE id=NEW."spaceId";
 IF personal IS NULL OR (personal AND (NEW."createdByUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL)) OR (NOT personal AND (NEW."createdByUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL OR NOT EXISTS(SELECT 1 FROM "Team" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId"))) THEN RAISE EXCEPTION 'Invalid Personal/Team Calendar branch' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (NEW."spaceId",NEW."scopeId",NEW."createdByUserId",NEW."createdByActorId") IS DISTINCT FROM (OLD."spaceId",OLD."scopeId",OLD."createdByUserId",OLD."createdByActorId") THEN RAISE EXCEPTION 'Calendar custody and attribution immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CalendarEvent_team_branch" BEFORE INSERT OR UPDATE ON "CalendarEvent" FOR EACH ROW EXECUTE FUNCTION team_calendar_shape();
CREATE TRIGGER "EventRecurrence_team_branch" BEFORE INSERT OR UPDATE ON "EventRecurrence" FOR EACH ROW EXECUTE FUNCTION team_calendar_shape();
CREATE TABLE "TeamPlan" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL REFERENCES "Team"("spaceId") ON DELETE NO ACTION,
 kind varchar(10) NOT NULL CHECK(kind IN ('WEEK','SPRINT')),title varchar(300) NOT NULL CHECK(length(btrim(title))>0),
 "startDate" date NOT NULL,"endDate" date NOT NULL,timezone varchar(100) NOT NULL,
 state varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdByActorId" uuid NOT NULL,
 "reviewSummary" varchar(10000),"reviewedByActorId" uuid,"reviewedAt" timestamptz(3),
 CHECK("endDate">"startDate" AND "endDate"-"startDate"<=93),CHECK(kind<>'WEEK' OR "endDate"-"startDate"=7),
 CHECK(num_nonnulls("reviewSummary","reviewedByActorId","reviewedAt") IN (0,3)),CHECK(kind='WEEK' OR "reviewSummary" IS NULL),
 UNIQUE("spaceId",id),
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","reviewedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE FUNCTION team_plan_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (NEW.id,NEW."spaceId",NEW.kind,NEW."startDate",NEW."endDate",NEW.timezone,NEW."createdByActorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD.kind,OLD."startDate",OLD."endDate",OLD.timezone,OLD."createdByActorId") OR NEW.revision<>OLD.revision+1 OR (NEW.state<>OLD.state AND NOT ((OLD.state='DRAFT' AND NEW.state='ACTIVE') OR (OLD.state='ACTIVE' AND NEW.state='CLOSED'))) THEN RAISE EXCEPTION 'Invalid Team plan transition' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "TeamPlan_transition" BEFORE UPDATE ON "TeamPlan" FOR EACH ROW EXECUTE FUNCTION team_plan_shape();
CREATE TABLE "TeamWorkItem" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL REFERENCES "Team"("spaceId") ON DELETE NO ACTION,"planId" uuid,
 "sourceSpaceId" uuid NOT NULL REFERENCES "SharedCustody"("spaceId") ON DELETE NO ACTION,
 "taskId" uuid,"goalId" uuid,"sourceRevision" integer NOT NULL CHECK("sourceRevision">0),
 position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 1000000),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdByActorId" uuid NOT NULL,
 CHECK(num_nonnulls("taskId","goalId")=1),UNIQUE("spaceId",id),
 FOREIGN KEY("spaceId","planId") REFERENCES "TeamPlan"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("sourceSpaceId","taskId") REFERENCES "Task"("spaceId",id) ON DELETE CASCADE,
 FOREIGN KEY("sourceSpaceId","goalId") REFERENCES "Goal"("spaceId",id) ON DELETE CASCADE,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "TeamWorkItem_task_unique" ON "TeamWorkItem"("spaceId","taskId") WHERE "taskId" IS NOT NULL;
CREATE UNIQUE INDEX "TeamWorkItem_goal_unique" ON "TeamWorkItem"("spaceId","goalId") WHERE "goalId" IS NOT NULL;
CREATE INDEX "TeamWorkItem_page" ON "TeamWorkItem"("spaceId","planId",id);
CREATE FUNCTION team_item_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Team" WHERE "spaceId"=NEW."sourceSpaceId" AND "spaceId"=NEW."spaceId" UNION ALL SELECT 1 FROM "TeamProjectReference" r JOIN "Project" p ON p.id=r."projectId" WHERE r."teamId"=NEW."spaceId" AND r."spaceId"=NEW."sourceSpaceId" AND r.active) THEN RAISE EXCEPTION 'Work reference requires its Team or an explicitly referenced Project' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW."spaceId",NEW."sourceSpaceId",NEW."taskId",NEW."goalId",NEW."createdByActorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."sourceSpaceId",OLD."taskId",OLD."goalId",OLD."createdByActorId") OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable Team work reference' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "TeamWorkItem_shape" BEFORE INSERT OR UPDATE ON "TeamWorkItem" FOR EACH ROW EXECUTE FUNCTION team_item_shape();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event'));
COMMIT;
