BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE "TeamCapacityDay" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 date date NOT NULL,
 timezone varchar(100) NOT NULL CHECK(length(timezone)>0),
 "availableMinutes" integer CHECK("availableMinutes" BETWEEN 0 AND 1440),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 CONSTRAINT "TeamCapacityDay_root" CHECK("spaceId"="scopeId"),
 CONSTRAINT "TeamCapacityDay_team" FOREIGN KEY("spaceId") REFERENCES "Team"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamCapacityDay_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamCapacityDay_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","accessId",generation,date,timezone)
);
CREATE INDEX "TeamCapacityDay_range" ON "TeamCapacityDay"("spaceId",timezone,date,id);
CREATE FUNCTION team_capacity_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (NEW.id,NEW."spaceId",NEW."scopeId",NEW."accessId",NEW.generation,NEW.date,NEW.timezone) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."accessId",OLD.generation,OLD.date,OLD.timezone) OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Immutable Team capacity identity or invalid revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "TeamCapacityDay_revision" BEFORE UPDATE ON "TeamCapacityDay" FOR EACH ROW EXECUTE FUNCTION team_capacity_revision();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day'));
COMMIT;
