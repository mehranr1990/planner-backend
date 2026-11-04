BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE "TaskWorkflow" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,name varchar(100) NOT NULL CHECK(length(btrim(name))>0),
 "currentVersion" integer NOT NULL DEFAULT 1 CHECK("currentVersion">0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdByActorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 UNIQUE("spaceId","scopeId",id),UNIQUE("spaceId","scopeId","creationKey"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "TaskWorkflow_scope_page" ON "TaskWorkflow"("spaceId","scopeId",id);
CREATE TABLE "TaskWorkflowVersion" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"workflowId" uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 name varchar(100) NOT NULL CHECK(length(btrim(name))>0),"publishedByActorId" uuid NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("spaceId","scopeId","workflowId",version),
 FOREIGN KEY("spaceId","scopeId","workflowId") REFERENCES "TaskWorkflow"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","publishedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
ALTER TABLE "TaskWorkflow" ADD CONSTRAINT "TaskWorkflow_current_version_fk" FOREIGN KEY("spaceId","scopeId",id,"currentVersion") REFERENCES "TaskWorkflowVersion"("spaceId","scopeId","workflowId",version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "TaskWorkflowState" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"workflowId" uuid NOT NULL,version integer NOT NULL,id uuid NOT NULL,
 label varchar(100) NOT NULL CHECK(length(btrim(label))>0),status "TaskStatus" NOT NULL,
 PRIMARY KEY("spaceId","scopeId","workflowId",version,id),
 FOREIGN KEY("spaceId","scopeId","workflowId",version) REFERENCES "TaskWorkflowVersion"("spaceId","scopeId","workflowId",version) ON DELETE NO ACTION
);
CREATE TABLE "TaskWorkflowEdge" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"workflowId" uuid NOT NULL,version integer NOT NULL,id uuid NOT NULL,
 "fromStateId" uuid NOT NULL,"toStateId" uuid NOT NULL,"requiresApproval" boolean NOT NULL,
 PRIMARY KEY("spaceId","scopeId","workflowId",version,id),UNIQUE("spaceId","scopeId","workflowId",version,"fromStateId","toStateId"),CHECK("fromStateId"<>"toStateId"),
 FOREIGN KEY("spaceId","scopeId","workflowId",version,"fromStateId") REFERENCES "TaskWorkflowState"("spaceId","scopeId","workflowId",version,id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","workflowId",version,"toStateId") REFERENCES "TaskWorkflowState"("spaceId","scopeId","workflowId",version,id) ON DELETE NO ACTION
);
CREATE TABLE "TaskWorkflowApprover" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"workflowId" uuid NOT NULL,version integer NOT NULL,"edgeId" uuid NOT NULL,"accessId" uuid NOT NULL,generation integer NOT NULL,
 PRIMARY KEY("spaceId","scopeId","workflowId",version,"edgeId","accessId"),
 FOREIGN KEY("spaceId","scopeId","workflowId",version,"edgeId") REFERENCES "TaskWorkflowEdge"("spaceId","scopeId","workflowId",version,id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION
);
CREATE INDEX "TaskWorkflowApprover_admission" ON "TaskWorkflowApprover"("accessId",generation,"edgeId");
CREATE TABLE "TaskWorkflowBinding" (
 "taskId" uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"workflowId" uuid NOT NULL,version integer NOT NULL,"stateId" uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","workflowId",version,"stateId") REFERENCES "TaskWorkflowState"("spaceId","scopeId","workflowId",version,id) ON DELETE NO ACTION
);
CREATE TABLE "TaskWorkflowApproval" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"taskId" uuid NOT NULL,"workflowId" uuid NOT NULL,version integer NOT NULL,"edgeId" uuid NOT NULL,
 "requesterAccessId" uuid NOT NULL,"requesterGeneration" integer NOT NULL,"requestedByActorId" uuid NOT NULL,"sourceRevision" integer NOT NULL CHECK("sourceRevision">0),
 state varchar(12) NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','APPROVED','REJECTED','EXPIRED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"decidedByActorId" uuid,"decisionAccessId" uuid,"decisionGeneration" integer,
 "createdAt" timestamptz(3) NOT NULL,"expiresAt" timestamptz(3) NOT NULL,"decidedAt" timestamptz(3),
 "creationKey" char(64) NOT NULL,fingerprint char(64) NOT NULL,
 UNIQUE("requesterAccessId","requesterGeneration","creationKey"),
 CHECK("expiresAt"="createdAt"+interval '30 minutes'),
 CHECK((state='REQUESTED' AND num_nonnulls("decidedByActorId","decisionAccessId","decisionGeneration","decidedAt")=0) OR
  (state='EXPIRED' AND "decidedAt" IS NOT NULL AND num_nonnulls("decidedByActorId","decisionAccessId","decisionGeneration")=0) OR
  (state IN ('APPROVED','REJECTED') AND num_nonnulls("decidedByActorId","decisionAccessId","decisionGeneration","decidedAt")=4 AND "decisionAccessId"<>"requesterAccessId")),
 FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","workflowId",version,"edgeId") REFERENCES "TaskWorkflowEdge"("spaceId","scopeId","workflowId",version,id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","requesterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","requestedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","scopeId","decisionAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
 FOREIGN KEY("decisionAccessId","decisionGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","decidedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "TaskWorkflowApproval_pending" ON "TaskWorkflowApproval"("spaceId","scopeId","taskId") WHERE state='REQUESTED';
CREATE INDEX "TaskWorkflowApproval_source_page" ON "TaskWorkflowApproval"("spaceId","scopeId","taskId",id);
CREATE FUNCTION task_workflow_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN RAISE EXCEPTION 'Published workflow content is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER "TaskWorkflowVersion_immutable" BEFORE UPDATE OR DELETE ON "TaskWorkflowVersion" FOR EACH ROW EXECUTE FUNCTION task_workflow_immutable();
CREATE TRIGGER "TaskWorkflowState_immutable" BEFORE UPDATE OR DELETE ON "TaskWorkflowState" FOR EACH ROW EXECUTE FUNCTION task_workflow_immutable();
CREATE TRIGGER "TaskWorkflowEdge_immutable" BEFORE UPDATE OR DELETE ON "TaskWorkflowEdge" FOR EACH ROW EXECUTE FUNCTION task_workflow_immutable();
CREATE TRIGGER "TaskWorkflowApprover_immutable" BEFORE UPDATE OR DELETE ON "TaskWorkflowApprover" FOR EACH ROW EXECUTE FUNCTION task_workflow_immutable();
CREATE FUNCTION task_workflow_approval_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.state<>'REQUESTED' OR NEW.revision<>OLD.revision+1 OR (NEW.id,NEW."spaceId",NEW."scopeId",NEW."taskId",NEW."workflowId",NEW.version,NEW."edgeId",NEW."requesterAccessId",NEW."requesterGeneration",NEW."requestedByActorId",NEW."sourceRevision",NEW."createdAt",NEW."expiresAt",NEW."creationKey",NEW.fingerprint) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."taskId",OLD."workflowId",OLD.version,OLD."edgeId",OLD."requesterAccessId",OLD."requesterGeneration",OLD."requestedByActorId",OLD."sourceRevision",OLD."createdAt",OLD."expiresAt",OLD."creationKey",OLD.fingerprint)) THEN
  RAISE EXCEPTION 'Approval history is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state IN ('APPROVED','REJECTED') AND NOT EXISTS(SELECT 1 FROM "TaskWorkflowApprover" a JOIN "ContextAccess" c ON c.id=a."accessId" WHERE a."spaceId"=NEW."spaceId" AND a."scopeId"=NEW."scopeId" AND a."workflowId"=NEW."workflowId" AND a.version=NEW.version AND a."edgeId"=NEW."edgeId" AND a."accessId"=NEW."decisionAccessId" AND a.generation=NEW."decisionGeneration" AND c."actorId"=NEW."decidedByActorId") THEN
  RAISE EXCEPTION 'Decision needs designated approver' USING ERRCODE='23514';
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "TaskWorkflowApproval_shape" BEFORE INSERT OR UPDATE ON "TaskWorkflowApproval" FOR EACH ROW EXECUTE FUNCTION task_workflow_approval_shape();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version'));
CREATE FUNCTION task_workflow_publication_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "TaskWorkflowVersion" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" AND "workflowId"=NEW."workflowId" AND version=NEW.version AND xmin::text::bigint=(txid_current()%4294967296)) THEN RAISE EXCEPTION 'Published workflow is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END; $$;
CREATE TRIGGER "TaskWorkflowState_publication" BEFORE INSERT ON "TaskWorkflowState" FOR EACH ROW EXECUTE FUNCTION task_workflow_publication_shape();
CREATE TRIGGER "TaskWorkflowEdge_publication" BEFORE INSERT ON "TaskWorkflowEdge" FOR EACH ROW EXECUTE FUNCTION task_workflow_publication_shape();
CREATE TRIGGER "TaskWorkflowApprover_publication" BEFORE INSERT ON "TaskWorkflowApprover" FOR EACH ROW EXECUTE FUNCTION task_workflow_publication_shape();
CREATE TRIGGER "TaskWorkflowApproval_no_delete" BEFORE DELETE ON "TaskWorkflowApproval" FOR EACH ROW EXECUTE FUNCTION task_workflow_immutable();
COMMIT;
