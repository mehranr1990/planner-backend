BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION project_execution_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN RAISE EXCEPTION 'Published project execution history is immutable' USING ERRCODE='23514';END; $$;
CREATE TABLE "ProjectRiskIssue" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,
 kind varchar(5) NOT NULL CHECK(kind IN ('RISK','ISSUE')),title varchar(300) NOT NULL CHECK(length(btrim(title))>0),description varchar(10000) NOT NULL,severity varchar(8) NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 probability integer,mitigation varchar(10000) NOT NULL,status varchar(10) NOT NULL CHECK(status IN ('OPEN','MITIGATING','RESOLVED','CLOSED')),
 "ownerAccessId" uuid,"ownerGeneration" integer,"createdByActorId" uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"retiredAt" timestamptz(3),
 "creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 CHECK((kind='RISK' AND probability BETWEEN 0 AND 100 AND probability IS NOT NULL) OR (kind='ISSUE' AND probability IS NULL)),CHECK(num_nonnulls("ownerAccessId","ownerGeneration") IN (0,2)),
 UNIQUE("spaceId","scopeId","projectId",id),UNIQUE("spaceId","scopeId","projectId","creationKey"),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","ownerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("ownerAccessId","ownerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectRiskIssue_page" ON "ProjectRiskIssue"("spaceId","scopeId","projectId",kind,status,id);
CREATE TABLE "ProjectRiskIssueEvent" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"itemId" uuid NOT NULL,"actorId" uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),"before" jsonb,"after" jsonb NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("itemId",revision),FOREIGN KEY("spaceId","scopeId","projectId","itemId") REFERENCES "ProjectRiskIssue"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectRiskIssueEvent_page" ON "ProjectRiskIssueEvent"("spaceId","scopeId","projectId","itemId",id);
CREATE TRIGGER "ProjectRiskIssueEvent_immutable" BEFORE UPDATE OR DELETE ON "ProjectRiskIssueEvent" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE TABLE "ProjectTemplate" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,name varchar(300) NOT NULL CHECK(length(btrim(name))>0),"currentVersion" integer NOT NULL DEFAULT 1 CHECK("currentVersion">0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"deprecatedAt" timestamptz(3),"createdByActorId" uuid NOT NULL,"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 UNIQUE("spaceId","scopeId","projectId",id),UNIQUE("spaceId","scopeId","projectId","creationKey"),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectTemplate_page" ON "ProjectTemplate"("spaceId","scopeId","projectId",id);
CREATE TABLE "ProjectTemplateVersion" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"templateId" uuid NOT NULL,version integer NOT NULL CHECK(version>0),name varchar(300) NOT NULL,definition jsonb NOT NULL,"publishedByActorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 PRIMARY KEY("spaceId","scopeId","projectId","templateId",version),UNIQUE("spaceId","scopeId","projectId","templateId","creationKey"),
 CHECK(jsonb_typeof(definition)='object' AND definition ?& ARRAY['schemaVersion','phases','sections','milestones','tasks','dependencies'] AND definition->>'schemaVersion'='1' AND jsonb_typeof(definition->'tasks')='array' AND jsonb_array_length(definition->'tasks') BETWEEN 1 AND 100),
 FOREIGN KEY("spaceId","scopeId","projectId","templateId") REFERENCES "ProjectTemplate"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","publishedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
ALTER TABLE "ProjectTemplate" ADD CONSTRAINT "ProjectTemplate_current_version_fk" FOREIGN KEY("spaceId","scopeId","projectId",id,"currentVersion") REFERENCES "ProjectTemplateVersion"("spaceId","scopeId","projectId","templateId",version) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER "ProjectTemplateVersion_immutable" BEFORE UPDATE OR DELETE ON "ProjectTemplateVersion" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE TABLE "ProjectChangePlan" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,kind varchar(8) NOT NULL CHECK(kind IN ('BULK','CSV','TEMPLATE')),state varchar(10) NOT NULL DEFAULT 'PREVIEWED' CHECK(state IN ('PREVIEWED','APPLIED')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 operations jsonb NOT NULL CHECK(jsonb_typeof(operations)='array' AND jsonb_array_length(operations) BETWEEN 1 AND 200),"templateId" uuid,"templateVersion" integer,
 "creatorAccessId" uuid NOT NULL,"creatorGeneration" integer NOT NULL,"createdByActorId" uuid NOT NULL,"authorizationVersion" bigint NOT NULL CHECK("authorizationVersion">0),"manifestHash" char(64) NOT NULL,"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,"createdAt" timestamptz(3) NOT NULL,"expiresAt" timestamptz(3) NOT NULL,"appliedAt" timestamptz(3),
 CHECK((kind='TEMPLATE' AND num_nonnulls("templateId","templateVersion")=2) OR (kind<>'TEMPLATE' AND num_nonnulls("templateId","templateVersion")=0)),CHECK("expiresAt"="createdAt"+interval '30 minutes'),CHECK((state='PREVIEWED' AND "appliedAt" IS NULL) OR (state='APPLIED' AND "appliedAt" IS NOT NULL)),
 UNIQUE("spaceId","scopeId","projectId",id),UNIQUE("creatorAccessId","creatorGeneration","creationKey"),
 FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","projectId","templateId","templateVersion") REFERENCES "ProjectTemplateVersion"("spaceId","scopeId","projectId","templateId",version) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","creatorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("creatorAccessId","creatorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ProjectChangePlan_expiry" ON "ProjectChangePlan"("spaceId","scopeId","projectId",state,"expiresAt",id);
CREATE TABLE "ProjectChangeSource" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"planId" uuid NOT NULL,"taskId" uuid NOT NULL,"sourceRevision" integer NOT NULL CHECK("sourceRevision">0),kind varchar(8) NOT NULL CHECK(kind IN ('EXISTING','CREATED')),
 PRIMARY KEY("planId","taskId"),FOREIGN KEY("spaceId","scopeId","projectId","planId") REFERENCES "ProjectChangePlan"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","scopeId","projectId","taskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION
);
CREATE TRIGGER "ProjectChangeSource_immutable" BEFORE UPDATE OR DELETE ON "ProjectChangeSource" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE FUNCTION project_change_plan_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF OLD.state<>'PREVIEWED' OR NEW.state<>'APPLIED' OR NEW.revision<>OLD.revision+1 OR (NEW.id,NEW."spaceId",NEW."scopeId",NEW."projectId",NEW.kind,NEW.operations,NEW."templateId",NEW."templateVersion",NEW."creatorAccessId",NEW."creatorGeneration",NEW."createdByActorId",NEW."authorizationVersion",NEW."manifestHash",NEW."creationKey",NEW.fingerprint,NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."projectId",OLD.kind,OLD.operations,OLD."templateId",OLD."templateVersion",OLD."creatorAccessId",OLD."creatorGeneration",OLD."createdByActorId",OLD."authorizationVersion",OLD."manifestHash",OLD."creationKey",OLD.fingerprint,OLD."createdAt",OLD."expiresAt") THEN RAISE EXCEPTION 'Change plan is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectChangePlan_shape" BEFORE UPDATE ON "ProjectChangePlan" FOR EACH ROW EXECUTE FUNCTION project_change_plan_shape();
CREATE TRIGGER "ProjectChangePlan_no_delete" BEFORE DELETE ON "ProjectChangePlan" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE FUNCTION project_change_source_publication() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "ProjectChangePlan" WHERE id=NEW."planId" AND xmin::text::bigint=(txid_current()%4294967296) AND state=CASE WHEN NEW.kind='EXISTING' THEN 'PREVIEWED' ELSE 'APPLIED' END) THEN RAISE EXCEPTION 'Change source snapshot is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectChangeSource_publication" BEFORE INSERT ON "ProjectChangeSource" FOR EACH ROW EXECUTE FUNCTION project_change_source_publication();
CREATE TABLE "ProjectCapacityDay" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"accessId" uuid NOT NULL,generation integer NOT NULL,date date NOT NULL,timezone varchar(100) NOT NULL,"availableMinutes" integer CHECK("availableMinutes" BETWEEN 0 AND 1440),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE("spaceId","scopeId","projectId","accessId",generation,date,timezone),FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION
);
CREATE INDEX "ProjectCapacityDay_range" ON "ProjectCapacityDay"("spaceId","scopeId","projectId",timezone,date,id);
CREATE TABLE "ProjectWorkAllocation" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"taskId" uuid NOT NULL,"assignmentId" uuid NOT NULL,"accessId" uuid NOT NULL,generation integer NOT NULL,date date NOT NULL,timezone varchar(100) NOT NULL,"plannedMinutes" integer NOT NULL CHECK("plannedMinutes" BETWEEN 0 AND 1440),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE("assignmentId",date,timezone),FOREIGN KEY("spaceId","scopeId","projectId","taskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION,FOREIGN KEY("spaceId","scopeId","assignmentId") REFERENCES "TaskAssignment"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION
);
CREATE INDEX "ProjectWorkAllocation_range" ON "ProjectWorkAllocation"("spaceId","scopeId","projectId",timezone,date,id);
CREATE FUNCTION project_allocation_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "TaskAssignment" WHERE id=NEW."assignmentId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" AND "projectId"=NEW."projectId" AND "taskId"=NEW."taskId" AND "recipientAccessId"=NEW."accessId" AND "recipientGeneration"=NEW.generation) THEN RAISE EXCEPTION 'Allocation needs exact assignment source' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (NEW.revision<>OLD.revision+1 OR (NEW.id,NEW."spaceId",NEW."scopeId",NEW."projectId",NEW."taskId",NEW."assignmentId",NEW."accessId",NEW.generation,NEW.date,NEW.timezone) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."projectId",OLD."taskId",OLD."assignmentId",OLD."accessId",OLD.generation,OLD.date,OLD.timezone)) THEN RAISE EXCEPTION 'Allocation identity is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "ProjectWorkAllocation_shape" BEFORE INSERT OR UPDATE ON "ProjectWorkAllocation" FOR EACH ROW EXECUTE FUNCTION project_allocation_shape();
CREATE TABLE "ProjectReportSnapshot" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"createdByActorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),report jsonb NOT NULL CHECK(jsonb_typeof(report)='object'),"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 UNIQUE("spaceId","scopeId","projectId",id),UNIQUE("spaceId","scopeId","projectId","creationKey"),FOREIGN KEY("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE TRIGGER "ProjectReportSnapshot_immutable" BEFORE UPDATE OR DELETE ON "ProjectReportSnapshot" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE TABLE "ProjectReportSource" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"projectId" uuid NOT NULL,"snapshotId" uuid NOT NULL,"taskId" uuid NOT NULL,"sourceRevision" integer NOT NULL CHECK("sourceRevision">0),
 PRIMARY KEY("snapshotId","taskId"),FOREIGN KEY("spaceId","scopeId","projectId","snapshotId") REFERENCES "ProjectReportSnapshot"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId","scopeId","projectId","taskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION
);
CREATE TRIGGER "ProjectReportSource_immutable" BEFORE UPDATE OR DELETE ON "ProjectReportSource" FOR EACH ROW EXECUTE FUNCTION project_execution_immutable();
CREATE FUNCTION project_report_source_publication() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM "ProjectReportSnapshot" WHERE id=NEW."snapshotId" AND xmin::text::bigint=(txid_current()%4294967296)) THEN RAISE EXCEPTION 'Report source snapshot is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END; $$;
CREATE TRIGGER "ProjectReportSource_publication" BEFORE INSERT ON "ProjectReportSource" FOR EACH ROW EXECUTE FUNCTION project_report_source_publication();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot'));
CREATE FUNCTION project_register_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF OLD."retiredAt" IS NOT NULL OR NEW.revision<>OLD.revision+1 OR (NEW.id,NEW."spaceId",NEW."scopeId",NEW."projectId",NEW.kind,NEW."createdByActorId",NEW."createdAt",NEW."creationKey",NEW.fingerprint) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."projectId",OLD.kind,OLD."createdByActorId",OLD."createdAt",OLD."creationKey",OLD.fingerprint) THEN RAISE EXCEPTION 'Register identity/history is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END; $$;
CREATE TRIGGER "ProjectRiskIssue_shape" BEFORE UPDATE ON "ProjectRiskIssue" FOR EACH ROW EXECUTE FUNCTION project_register_shape();
CREATE FUNCTION project_capacity_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF NEW.revision<>OLD.revision+1 OR (NEW.id,NEW."spaceId",NEW."scopeId",NEW."projectId",NEW."accessId",NEW.generation,NEW.date,NEW.timezone) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."projectId",OLD."accessId",OLD.generation,OLD.date,OLD.timezone) THEN RAISE EXCEPTION 'Capacity identity is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END; $$;
CREATE TRIGGER "ProjectCapacityDay_shape" BEFORE UPDATE ON "ProjectCapacityDay" FOR EACH ROW EXECUTE FUNCTION project_capacity_shape();
COMMIT;
