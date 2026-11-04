BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE "TaskField" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,name varchar(100) NOT NULL CHECK(length(btrim(name))>0),
 kind varchar(16) NOT NULL CHECK(kind IN ('TEXT','NUMBER','DATE','BOOLEAN','SINGLE_SELECT','MULTI_SELECT','PERSON','CURRENCY')),
 "currentVersion" integer NOT NULL DEFAULT 1 CHECK("currentVersion">0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "deprecatedAt" timestamptz(3),"createdByActorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 UNIQUE("spaceId","scopeId",id),UNIQUE("spaceId","scopeId",id,kind),UNIQUE("spaceId","scopeId","creationKey"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "TaskField_scope_page" ON "TaskField"("spaceId","scopeId","deprecatedAt",id);
CREATE TABLE "TaskFieldVersion" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"fieldId" uuid NOT NULL,version integer NOT NULL CHECK(version>0),kind varchar(16) NOT NULL,
 name varchar(100) NOT NULL CHECK(length(btrim(name))>0),limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(limits)='object'),
 "publishedByActorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("spaceId","scopeId","fieldId",version),UNIQUE("spaceId","scopeId","fieldId",version,kind),
 FOREIGN KEY("spaceId","scopeId","fieldId",kind) REFERENCES "TaskField"("spaceId","scopeId",id,kind) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","publishedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
ALTER TABLE "TaskField" ADD CONSTRAINT "TaskField_current_version_fk" FOREIGN KEY("spaceId","scopeId",id,"currentVersion") REFERENCES "TaskFieldVersion"("spaceId","scopeId","fieldId",version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "TaskFieldOption" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"fieldId" uuid NOT NULL,version integer NOT NULL,id uuid NOT NULL,
 label varchar(100) NOT NULL CHECK(length(btrim(label))>0),position integer NOT NULL CHECK(position>=0),
 PRIMARY KEY("spaceId","scopeId","fieldId",version,id),
 FOREIGN KEY("spaceId","scopeId","fieldId",version) REFERENCES "TaskFieldVersion"("spaceId","scopeId","fieldId",version) ON DELETE NO ACTION
);
CREATE TABLE "TaskFieldValue" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"taskId" uuid,"fieldId" uuid NOT NULL,"fieldVersion" integer NOT NULL,kind varchar(16) NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"textValue" varchar(2000),"numberValue" numeric(30,6),"dateValue" date,"booleanValue" boolean,
 currency char(3),"personAccessId" uuid,"personGeneration" integer,
 UNIQUE("spaceId","scopeId",id,"fieldId","fieldVersion"),
 FOREIGN KEY("spaceId","scopeId","fieldId","fieldVersion",kind) REFERENCES "TaskFieldVersion"("spaceId","scopeId","fieldId",version,kind) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","personAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("personAccessId","personGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 CHECK((kind='TEXT' AND "textValue" IS NOT NULL AND num_nonnulls("numberValue","dateValue","booleanValue",currency,"personAccessId","personGeneration")=0) OR
 (kind='NUMBER' AND "numberValue" IS NOT NULL AND num_nonnulls("textValue","dateValue","booleanValue",currency,"personAccessId","personGeneration")=0) OR
 (kind='DATE' AND "dateValue" IS NOT NULL AND num_nonnulls("textValue","numberValue","booleanValue",currency,"personAccessId","personGeneration")=0) OR
 (kind='BOOLEAN' AND "booleanValue" IS NOT NULL AND num_nonnulls("textValue","numberValue","dateValue",currency,"personAccessId","personGeneration")=0) OR
 (kind='CURRENCY' AND "numberValue" IS NOT NULL AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$' AND num_nonnulls("textValue","dateValue","booleanValue","personAccessId","personGeneration")=0) OR
 (kind='PERSON' AND "personAccessId" IS NOT NULL AND "personGeneration" IS NOT NULL AND "personGeneration">0 AND num_nonnulls("textValue","numberValue","dateValue","booleanValue",currency)=0) OR
 (kind IN ('SINGLE_SELECT','MULTI_SELECT') AND num_nonnulls("textValue","numberValue","dateValue","booleanValue",currency,"personAccessId","personGeneration")=0))
);
CREATE UNIQUE INDEX "TaskFieldValue_task_unique" ON "TaskFieldValue"("spaceId","scopeId","taskId","fieldId") WHERE "taskId" IS NOT NULL;
CREATE UNIQUE INDEX "TaskFieldValue_default_unique" ON "TaskFieldValue"("spaceId","scopeId","fieldId","fieldVersion") WHERE "taskId" IS NULL;
CREATE INDEX "TaskFieldValue_text_search" ON "TaskFieldValue"("spaceId","scopeId","fieldId","fieldVersion","textValue","taskId");
CREATE INDEX "TaskFieldValue_number_search" ON "TaskFieldValue"("spaceId","scopeId","fieldId","fieldVersion","numberValue","taskId");
CREATE INDEX "TaskFieldValue_date_search" ON "TaskFieldValue"("spaceId","scopeId","fieldId","fieldVersion","dateValue","taskId");
CREATE INDEX "TaskFieldValue_person_search" ON "TaskFieldValue"("spaceId","scopeId","fieldId","fieldVersion","personAccessId","personGeneration","taskId");
CREATE TABLE "TaskFieldSelection" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"valueId" uuid NOT NULL,"fieldId" uuid NOT NULL,"fieldVersion" integer NOT NULL,"optionId" uuid NOT NULL,
 PRIMARY KEY("valueId","optionId"),
 FOREIGN KEY("spaceId","scopeId","valueId","fieldId","fieldVersion") REFERENCES "TaskFieldValue"("spaceId","scopeId",id,"fieldId","fieldVersion") ON DELETE CASCADE,
 FOREIGN KEY("spaceId","scopeId","fieldId","fieldVersion","optionId") REFERENCES "TaskFieldOption"("spaceId","scopeId","fieldId",version,id) ON DELETE NO ACTION
);
CREATE INDEX "TaskFieldSelection_option_search" ON "TaskFieldSelection"("spaceId","scopeId","fieldId","fieldVersion","optionId","valueId");
CREATE FUNCTION task_field_selection_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE vid uuid; k text; n integer;
BEGIN
 IF TG_TABLE_NAME='TaskFieldValue' THEN vid=COALESCE(NEW.id,OLD.id); ELSE vid=COALESCE(NEW."valueId",OLD."valueId"); END IF;
 SELECT kind INTO k FROM "TaskFieldValue" WHERE id=vid;
 IF k IS NOT NULL THEN
  SELECT count(*) INTO n FROM "TaskFieldSelection" WHERE "valueId"=vid;
  IF (k='SINGLE_SELECT' AND n<>1) OR (k='MULTI_SELECT' AND n>20) OR (k NOT IN ('SINGLE_SELECT','MULTI_SELECT') AND n<>0) THEN
   RAISE EXCEPTION 'Invalid typed field selections' USING ERRCODE='23514';
  END IF;
 END IF;RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "TaskFieldValue_selection_shape" AFTER INSERT OR UPDATE OR DELETE ON "TaskFieldValue" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_field_selection_shape();
CREATE CONSTRAINT TRIGGER "TaskFieldSelection_shape" AFTER INSERT OR UPDATE OR DELETE ON "TaskFieldSelection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_field_selection_shape();
CREATE FUNCTION task_field_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN RAISE EXCEPTION 'Published field versions/options are immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER "TaskFieldVersion_immutable" BEFORE UPDATE OR DELETE ON "TaskFieldVersion" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
CREATE TRIGGER "TaskFieldOption_immutable" BEFORE UPDATE OR DELETE ON "TaskFieldOption" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
CREATE TABLE "TaskMetadataEvent" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"taskId" uuid NOT NULL,"actorId" uuid NOT NULL,
 action varchar(40) NOT NULL,"sourceRevision" integer NOT NULL CHECK("sourceRevision">0),"beforeValue" jsonb,"afterValue" jsonb,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "TaskMetadataEvent_history_page" ON "TaskMetadataEvent"("spaceId","scopeId","taskId",id);
CREATE TRIGGER "TaskMetadataEvent_immutable" BEFORE UPDATE OR DELETE ON "TaskMetadataEvent" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
CREATE TABLE "TaskDependencyGraph" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY("spaceId","scopeId"),FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION
);
CREATE TABLE "TaskDependency" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"predecessorId" uuid NOT NULL,"successorId" uuid NOT NULL,
 kind varchar(2) NOT NULL CHECK(kind IN ('FS','SS','FF','SF')),"lagMinutes" integer NOT NULL CHECK("lagMinutes" BETWEEN -525600 AND 525600),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"retiredAt" timestamptz(3),"createdByActorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK("predecessorId"<>"successorId"),
 FOREIGN KEY("spaceId","scopeId","predecessorId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","successorId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "TaskDependency_active_pair" ON "TaskDependency"("spaceId","scopeId","predecessorId","successorId",kind) WHERE "retiredAt" IS NULL;
CREATE INDEX "TaskDependency_outgoing" ON "TaskDependency"("spaceId","scopeId","predecessorId",id) WHERE "retiredAt" IS NULL;
CREATE INDEX "TaskDependency_incoming" ON "TaskDependency"("spaceId","scopeId","successorId",id) WHERE "retiredAt" IS NULL;
CREATE FUNCTION task_dependency_graph_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" FOR UPDATE;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW."spaceId",NEW."scopeId",NEW."predecessorId",NEW."successorId",NEW.kind,NEW."createdByActorId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."predecessorId",OLD."successorId",OLD.kind,OLD."createdByActorId",OLD."createdAt") OR OLD."retiredAt" IS NOT NULL OR NEW.revision<>OLD.revision+1) THEN
  RAISE EXCEPTION 'Invalid dependency history' USING ERRCODE='23514';
 END IF;
 IF NEW."retiredAt" IS NULL THEN
  IF (SELECT count(*) FROM "TaskDependency" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" AND "retiredAt" IS NULL AND id<>NEW.id)>=5000 THEN RAISE EXCEPTION 'Dependency graph safety bound' USING ERRCODE='23514'; END IF;
  IF EXISTS(WITH RECURSIVE reach(id) AS (SELECT NEW."successorId" UNION SELECT d."successorId" FROM "TaskDependency" d JOIN reach r ON r.id=d."predecessorId" WHERE d."spaceId"=NEW."spaceId" AND d."scopeId"=NEW."scopeId" AND d."retiredAt" IS NULL AND d.id<>NEW.id) SELECT 1 FROM reach WHERE id=NEW."predecessorId") THEN
   RAISE EXCEPTION 'Dependency cycle' USING ERRCODE='23514';
  END IF;
 END IF;
 INSERT INTO "TaskDependencyGraph" ("spaceId","scopeId",revision) VALUES (NEW."spaceId",NEW."scopeId",1) ON CONFLICT("spaceId","scopeId") DO UPDATE SET revision="TaskDependencyGraph".revision+1;
 RETURN NEW;
END; $$;
CREATE TRIGGER "TaskDependency_graph_shape" BEFORE INSERT OR UPDATE ON "TaskDependency" FOR EACH ROW EXECUTE FUNCTION task_dependency_graph_shape();
CREATE TRIGGER "TaskDependency_no_delete" BEFORE DELETE ON "TaskDependency" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
CREATE TABLE "TaskReschedulePreview" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"createdByActorId" uuid NOT NULL,"creatorAccessId" uuid NOT NULL,"creatorGeneration" integer NOT NULL,
 "graphRevision" integer NOT NULL CHECK("graphRevision">=0),"authorizationVersion" bigint NOT NULL CHECK("authorizationVersion">0),
 "manifestHash" char(64) NOT NULL,"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),state varchar(12) NOT NULL DEFAULT 'PREVIEWED' CHECK(state IN ('PREVIEWED','APPLIED')),
 "createdAt" timestamptz(3) NOT NULL,"expiresAt" timestamptz(3) NOT NULL,"appliedAt" timestamptz(3),
 CHECK("expiresAt"="createdAt"+interval '30 minutes'),CHECK((state='PREVIEWED' AND "appliedAt" IS NULL) OR (state='APPLIED' AND "appliedAt" IS NOT NULL)),
 UNIQUE("spaceId","scopeId",id),UNIQUE("creatorAccessId","creatorGeneration","creationKey"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","creatorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("creatorAccessId","creatorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION
);
CREATE INDEX "TaskReschedulePreview_expiry" ON "TaskReschedulePreview"(state,"expiresAt",id);
CREATE TABLE "TaskRescheduleItem" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"previewId" uuid NOT NULL,"taskId" uuid NOT NULL,"sourceRevision" integer NOT NULL CHECK("sourceRevision">0),
 changed boolean NOT NULL,"plannedStartAt" timestamptz(3),"dueAt" timestamptz(3),"scheduledDate" date,
 PRIMARY KEY("previewId","taskId"),CHECK("plannedStartAt" IS NULL OR "dueAt" IS NULL OR "plannedStartAt"<="dueAt"),
 FOREIGN KEY("spaceId","scopeId","previewId") REFERENCES "TaskReschedulePreview"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION
);
CREATE TRIGGER "TaskRescheduleItem_immutable" BEFORE UPDATE OR DELETE ON "TaskRescheduleItem" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview'));
ALTER TABLE "TaskFieldVersion" ADD COLUMN "hasDefault" boolean NOT NULL DEFAULT false;
CREATE INDEX "TaskFieldValue_boolean_search" ON "TaskFieldValue"("spaceId","scopeId","fieldId","fieldVersion","booleanValue","taskId");
CREATE INDEX "TaskFieldValue_currency_search" ON "TaskFieldValue"("spaceId","scopeId","fieldId","fieldVersion",currency,"numberValue","taskId");
CREATE FUNCTION task_field_publication_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE fid uuid; ver integer; tid uuid; created_here boolean;
BEGIN
 IF TG_TABLE_NAME='TaskFieldOption' THEN fid=NEW."fieldId";ver=NEW.version;
 ELSIF TG_TABLE_NAME='TaskFieldValue' THEN
  IF TG_OP='DELETE' THEN fid=OLD."fieldId";ver=OLD."fieldVersion";tid=OLD."taskId";ELSE fid=NEW."fieldId";ver=NEW."fieldVersion";tid=NEW."taskId";END IF;
  IF tid IS NOT NULL THEN RETURN COALESCE(NEW,OLD);END IF;
 ELSE
  IF TG_OP='DELETE' THEN SELECT "fieldId","fieldVersion","taskId" INTO fid,ver,tid FROM "TaskFieldValue" WHERE id=OLD."valueId";
  ELSE SELECT "fieldId","fieldVersion","taskId" INTO fid,ver,tid FROM "TaskFieldValue" WHERE id=NEW."valueId";END IF;
  IF tid IS NOT NULL OR fid IS NULL THEN RETURN COALESCE(NEW,OLD);END IF;
 END IF;
 SELECT xmin::text::bigint=(txid_current()%4294967296) INTO created_here FROM "TaskFieldVersion" WHERE "spaceId"=COALESCE(NEW."spaceId",OLD."spaceId") AND "scopeId"=COALESCE(NEW."scopeId",OLD."scopeId") AND "fieldId"=fid AND version=ver;
 IF NOT COALESCE(created_here,false) THEN RAISE EXCEPTION 'Published field content is immutable' USING ERRCODE='23514';END IF;RETURN COALESCE(NEW,OLD);
END; $$;
CREATE TRIGGER "TaskFieldOption_publication" BEFORE INSERT ON "TaskFieldOption" FOR EACH ROW EXECUTE FUNCTION task_field_publication_shape();
CREATE TRIGGER "TaskFieldValue_publication" BEFORE INSERT OR UPDATE OR DELETE ON "TaskFieldValue" FOR EACH ROW EXECUTE FUNCTION task_field_publication_shape();
CREATE TRIGGER "TaskFieldSelection_publication" BEFORE INSERT OR UPDATE OR DELETE ON "TaskFieldSelection" FOR EACH ROW EXECUTE FUNCTION task_field_publication_shape();
CREATE FUNCTION task_reschedule_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF OLD.state<>'PREVIEWED' OR NEW.state<>'APPLIED' OR NEW.revision<>OLD.revision+1 OR
 (NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdByActorId",NEW."creatorAccessId",NEW."creatorGeneration",NEW."graphRevision",NEW."authorizationVersion",NEW."manifestHash",NEW."creationKey",NEW.fingerprint,NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM
 (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdByActorId",OLD."creatorAccessId",OLD."creatorGeneration",OLD."graphRevision",OLD."authorizationVersion",OLD."manifestHash",OLD."creationKey",OLD.fingerprint,OLD."createdAt",OLD."expiresAt") THEN RAISE EXCEPTION 'Reschedule manifest is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "TaskReschedulePreview_shape" BEFORE UPDATE ON "TaskReschedulePreview" FOR EACH ROW EXECUTE FUNCTION task_reschedule_shape();
CREATE TRIGGER "TaskReschedulePreview_no_delete" BEFORE DELETE ON "TaskReschedulePreview" FOR EACH ROW EXECUTE FUNCTION task_field_immutable();
CREATE FUNCTION task_reschedule_item_publication() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "TaskReschedulePreview" WHERE id=NEW."previewId" AND state='PREVIEWED' AND xmin::text::bigint=(txid_current()%4294967296)) THEN RAISE EXCEPTION 'Reschedule manifest is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "TaskRescheduleItem_publication" BEFORE INSERT ON "TaskRescheduleItem" FOR EACH ROW EXECUTE FUNCTION task_reschedule_item_publication();
COMMIT;
