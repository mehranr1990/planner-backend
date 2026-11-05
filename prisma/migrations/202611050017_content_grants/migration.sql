BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "ResourceGrantOffer" DROP CONSTRAINT "ResourceGrantOffer_capabilities_check";
ALTER TABLE "ResourceGrantOffer" ADD CONSTRAINT "ResourceGrantOffer_capabilities_check" CHECK(cardinality(capabilities) BETWEEN 1 AND 5 AND capabilities <@ ARRAY['read','comment','update','complete','file.read']::text[] AND 'read'=ANY(capabilities));
ALTER TABLE "ResourceGrantOffer" DROP CONSTRAINT "ResourceGrantOffer_check5";
ALTER TABLE "ResourceGrantOffer" ADD CONSTRAINT "ResourceGrantOffer_check5" CHECK(("projectId" IS NULL OR capabilities <@ ARRAY['read','comment','file.read']::text[]) AND ("goalId" IS NULL OR capabilities <@ ARRAY['read','comment','update','file.read']::text[]));
CREATE OR REPLACE FUNCTION project_grant_target() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE gid uuid; n integer;
BEGIN
 IF TG_TABLE_NAME='ResourceGrant' THEN gid=COALESCE(NEW.id,OLD.id); ELSE gid=COALESCE(NEW."grantId",OLD."grantId"); END IF;
 IF EXISTS(SELECT 1 FROM "ResourceGrant" WHERE id=gid) THEN
 SELECT (SELECT count(*) FROM "ProjectGrant" WHERE "grantId"=gid)+(SELECT count(*) FROM "TaskGrant" WHERE "grantId"=gid)+(SELECT count(*) FROM "GoalGrant" WHERE "grantId"=gid) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'Grant requires exactly one typed target' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "ResourceGrant" g WHERE g.id=gid AND 'read'=ANY(g.capabilities) AND
   ((EXISTS(SELECT 1 FROM "ProjectGrant" WHERE "grantId"=gid) AND g.capabilities <@ ARRAY['read','comment','file.read']::text[]) OR
    (EXISTS(SELECT 1 FROM "TaskGrant" WHERE "grantId"=gid) AND g.capabilities <@ ARRAY['read','comment','update','complete','file.read']::text[]) OR
    (EXISTS(SELECT 1 FROM "GoalGrant" WHERE "grantId"=gid) AND g.capabilities <@ ARRAY['read','comment','update','file.read']::text[]))) THEN
 RAISE EXCEPTION 'Grant capabilities exceed its concrete target' USING ERRCODE='23514'; END IF;
 END IF; RETURN NULL;
END; $$;
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared'));
COMMIT;
