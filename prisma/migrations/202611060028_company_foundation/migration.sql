BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "SharedCustody" DROP CONSTRAINT "SharedCustody_kind_check";
ALTER TABLE "SharedCustody" ADD CONSTRAINT "SharedCustody_kind_check" CHECK(kind IN ('PROJECT','TEAM','COMPANY'));
ALTER TABLE "ContextAccess" ALTER COLUMN "memberRole" TYPE varchar(12);
ALTER TABLE "ContextInvitation" ALTER COLUMN "memberRole" TYPE varchar(12);
ALTER TABLE "ContextAccess" DROP CONSTRAINT "ContextAccess_memberRole_check";
ALTER TABLE "ContextAccess" ADD CONSTRAINT "ContextAccess_memberRole_check" CHECK("memberRole" IN ('ADMIN','MANAGER','LEAD','MEMBER','VIEWER','ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD'));
ALTER TABLE "ContextInvitation" DROP CONSTRAINT "ContextInvitation_memberRole_check";
ALTER TABLE "ContextInvitation" ADD CONSTRAINT "ContextInvitation_memberRole_check" CHECK("memberRole" IN ('ADMIN','MANAGER','LEAD','MEMBER','VIEWER','ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD'));
ALTER TABLE "AccessScope" DROP CONSTRAINT "AccessScope_kind_check";
ALTER TABLE "AccessScope" ADD CONSTRAINT "AccessScope_kind_check" CHECK(kind IN ('ROOT','DEPARTMENT','UNIT'));
ALTER TABLE "AccessScope" DROP CONSTRAINT "AccessScope_check";
ALTER TABLE "AccessScope" ADD CONSTRAINT "AccessScope_check" CHECK((kind='ROOT' AND id="spaceId") OR (kind IN ('DEPARTMENT','UNIT') AND id<>"spaceId"));
CREATE FUNCTION company_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.kind<>'ROOT' AND NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Child context requires Company custody' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW."spaceId",NEW.kind) IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD.kind) THEN RAISE EXCEPTION 'Immutable context identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "AccessScope_company_context" BEFORE INSERT OR UPDATE ON "AccessScope" FOR EACH ROW EXECUTE FUNCTION company_scope_guard();
CREATE OR REPLACE FUNCTION shared_context_role_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE context_kind text;
BEGIN
 SELECT kind INTO context_kind FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
 IF NEW."memberRole" IS NOT NULL AND ((context_kind='PROJECT' AND NEW."memberRole" NOT IN ('ADMIN','MANAGER','MEMBER','VIEWER')) OR (context_kind='TEAM' AND NEW."memberRole" NOT IN ('ADMIN','LEAD','MEMBER','VIEWER')) OR (context_kind='COMPANY' AND NEW."memberRole" NOT IN ('ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER'))) THEN
  RAISE EXCEPTION 'Role belongs to another context catalog' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION shared_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE role_name text; caps jsonb; cap text; catalog text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Published policy is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'SharedRetentionPolicy' THEN RETURN NEW; END IF;
  SELECT CASE WHEN kind='COMPANY' THEN ARRAY['OWNER','ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER'] WHEN kind='TEAM' THEN ARRAY['OWNER','ADMIN','LEAD','MEMBER','VIEWER'] ELSE ARRAY['OWNER','ADMIN','MANAGER','MEMBER','VIEWER'] END INTO catalog FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
  IF catalog IS NULL OR NOT (NEW."roleDefaults" ?& catalog) OR (SELECT count(*) FROM jsonb_object_keys(NEW."roleDefaults")) <> cardinality(catalog) THEN
    RAISE EXCEPTION 'Exact context role catalog required' USING ERRCODE = '23514';
  END IF;
  FOR role_name,caps IN SELECT * FROM jsonb_each(NEW."roleDefaults") LOOP
    IF jsonb_typeof(caps) <> 'array' THEN RAISE EXCEPTION 'Capabilities must be arrays' USING ERRCODE = '23514'; END IF;
    FOR cap IN SELECT jsonb_array_elements_text(caps) LOOP
      IF (catalog @> ARRAY['ORG_ADMIN'] AND cap<>'task.read') OR cap IS NULL OR cap NOT IN ('task.read','task.create','task.update','task.complete','task.delete','assignment.accept','assignment.decline','assignment.assign','workflow.transition','workflow.publish','export.visible','file.read')
        OR (role_name = 'VIEWER' AND cap NOT IN ('task.read','export.visible','file.read'))
        OR (role_name = 'MEMBER' AND cap IN ('task.delete','workflow.publish')) THEN
        RAISE EXCEPTION 'Capability exceeds fixed ordinary-role ceiling' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TABLE "Company" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL UNIQUE,"scopeId" uuid NOT NULL,"createdByActorId" uuid NOT NULL,
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),description varchar(10000),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "creationKey" char(64) NOT NULL,"creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 
 UNIQUE("spaceId",id),CHECK(id="scopeId" AND id="spaceId"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId") REFERENCES "SharedCustody"("spaceId") ON DELETE NO ACTION
);
CREATE TABLE "CompanyDepartment" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"createdByActorId" uuid NOT NULL,
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),description varchar(10000),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "creationKey" char(64) NOT NULL,"creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId","creationKey"),
 UNIQUE("spaceId",id),CHECK(id="scopeId" AND id<>"spaceId"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION
);
CREATE TABLE "CompanyUnit" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"createdByActorId" uuid NOT NULL,
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),description varchar(10000),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "creationKey" char(64) NOT NULL,"creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "departmentId" uuid NOT NULL,UNIQUE("spaceId","creationKey"),
 UNIQUE("spaceId",id),CHECK(id="scopeId" AND id<>"spaceId"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION,FOREIGN KEY("spaceId","departmentId") REFERENCES "CompanyDepartment"("spaceId",id) ON DELETE NO ACTION
);
CREATE TABLE "CompanyScopePolicy" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,version integer NOT NULL CHECK(version>0),rules jsonb NOT NULL,
 "createdByActorId" uuid NOT NULL,"auditId" uuid NOT NULL UNIQUE,"publishedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("spaceId","scopeId",version),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
 CHECK(jsonb_typeof(rules)='array' AND jsonb_array_length(rules)<=2)
);
CREATE TABLE "CompanyContextAdmission" (
 "spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"accessId" uuid NOT NULL,generation integer NOT NULL,"actorId" uuid NOT NULL,
 "rootScopeId" uuid NOT NULL,"rootAccessId" uuid NOT NULL,"rootGeneration" integer NOT NULL,
 PRIMARY KEY("accessId",generation),CHECK("rootScopeId"="spaceId" AND "scopeId"<>"spaceId"),
 FOREIGN KEY("spaceId","scopeId","accessId","actorId") REFERENCES "ContextAccess"("spaceId","scopeId",id,"actorId") ON DELETE NO ACTION,
 FOREIGN KEY("spaceId","rootScopeId","rootAccessId","actorId") REFERENCES "ContextAccess"("spaceId","scopeId",id,"actorId") ON DELETE NO ACTION,
 FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 FOREIGN KEY("rootAccessId","rootGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION
);
ALTER TABLE "ContextInvitation" ADD COLUMN "companyIssuerAccessId" uuid,ADD COLUMN "companyIssuerGeneration" integer,ADD COLUMN "companyRecipientRootAccessId" uuid,ADD COLUMN "companyRecipientRootGeneration" integer,ADD COLUMN "companyRestoreGeneration" integer,
 ADD FOREIGN KEY("companyIssuerAccessId") REFERENCES "ContextAccess"(id) ON DELETE NO ACTION,
 ADD FOREIGN KEY("companyRecipientRootAccessId") REFERENCES "ContextAccess"(id) ON DELETE NO ACTION,
 ADD FOREIGN KEY("companyIssuerAccessId","companyIssuerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 ADD FOREIGN KEY("companyRecipientRootAccessId","companyRecipientRootGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION;
CREATE FUNCTION company_domain_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE expected text;
BEGIN
 expected:=CASE TG_TABLE_NAME WHEN 'Company' THEN 'ROOT' WHEN 'CompanyDepartment' THEN 'DEPARTMENT' ELSE 'UNIT' END;
 IF NOT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "AccessScope" s ON s."spaceId"=c."spaceId" WHERE c."spaceId"=NEW."spaceId" AND c.kind='COMPANY' AND s.id=NEW."scopeId" AND s.kind=expected) THEN RAISE EXCEPTION 'Wrong Company context' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdByActorId",NEW."creationKey",NEW."creationFingerprint",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdByActorId",OLD."creationKey",OLD."creationFingerprint",OLD."createdAt") OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Company identity or stale revision' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='CompanyUnit' AND to_jsonb(NEW)->'departmentId' IS DISTINCT FROM to_jsonb(OLD)->'departmentId' THEN RAISE EXCEPTION 'Unit reparenting is not implemented' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "Company_identity" BEFORE INSERT OR UPDATE ON "Company" FOR EACH ROW EXECUTE FUNCTION company_domain_guard();
CREATE TRIGGER "CompanyDepartment_identity" BEFORE INSERT OR UPDATE ON "CompanyDepartment" FOR EACH ROW EXECUTE FUNCTION company_domain_guard();
CREATE TRIGGER "CompanyUnit_identity" BEFORE INSERT OR UPDATE ON "CompanyUnit" FOR EACH ROW EXECUTE FUNCTION company_domain_guard();
CREATE FUNCTION company_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r jsonb; role_name text; seen text[]:=ARRAY[]::text[];
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable Company policy history' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Company policy requires Company custody' USING ERRCODE='23514'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(NEW.rules) LOOP
  IF jsonb_typeof(r)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>4 OR NOT(r ?& ARRAY['key','mode','roles','overrideDefault']) OR jsonb_typeof(r->'key')<>'string' OR jsonb_typeof(r->'mode')<>'string' OR r->>'key' NOT IN ('structure.read','directory.read') OR r->>'key'=ANY(seen) OR r->>'mode' NOT IN ('MANDATORY','DEFAULT','OPTIONAL') OR jsonb_typeof(r->'roles')<>'array' OR jsonb_typeof(r->'overrideDefault')<>'boolean' OR ((r->>'overrideDefault')::boolean AND r->>'mode'<>'DEFAULT') THEN RAISE EXCEPTION 'Invalid bounded Company policy' USING ERRCODE='23514'; END IF;
  seen:=array_append(seen,r->>'key');
  FOR role_name IN SELECT jsonb_array_elements_text(r->'roles') LOOP IF role_name IS NULL OR role_name NOT IN ('OWNER','ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER') THEN RAISE EXCEPTION 'Unknown Company role' USING ERRCODE='23514'; END IF; END LOOP;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyScopePolicy_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyScopePolicy" FOR EACH ROW EXECUTE FUNCTION company_policy_guard();
CREATE FUNCTION company_admission_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Immutable Company admission binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyContextAdmission_immutable" BEFORE INSERT OR UPDATE ON "CompanyContextAdmission" FOR EACH ROW EXECUTE FUNCTION company_admission_guard();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership')); 
ALTER TABLE "ContextInvitation" ADD COLUMN "companyScopeId" uuid,ADD COLUMN "companyAcceptedAccessId" uuid,
 ADD FOREIGN KEY("spaceId","companyScopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
 ADD FOREIGN KEY("companyAcceptedAccessId") REFERENCES "ContextAccess"(id) ON DELETE NO ACTION;
CREATE FUNCTION company_invitation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE k text; issuer record; recipient record;
BEGIN
 SELECT kind INTO k FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
 IF k<>'COMPANY' THEN
  IF num_nonnulls(NEW."companyScopeId",NEW."companyIssuerAccessId",NEW."companyIssuerGeneration",NEW."companyRecipientRootAccessId",NEW."companyRecipientRootGeneration",NEW."companyRestoreGeneration",NEW."companyAcceptedAccessId")<>0 THEN RAISE EXCEPTION 'Corporate invitation bindings require Company custody' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."scopeId"<>NEW."spaceId" OR NEW."companyScopeId" IS NULL OR NEW."companyIssuerAccessId" IS NULL OR NEW."companyIssuerGeneration" IS NULL OR NEW."companyRestoreGeneration" IS NULL THEN RAISE EXCEPTION 'Company offer bindings required' USING ERRCODE='23514'; END IF;
 SELECT * INTO issuer FROM "ContextAccess" WHERE id=NEW."companyIssuerAccessId" AND "spaceId"=NEW."spaceId" AND "actorId"=(SELECT "actorId" FROM "ContextAccess" WHERE id=NEW."inviterAccessId") AND "scopeId" IN (NEW."spaceId",NEW."companyScopeId");
 IF NOT FOUND THEN RAISE EXCEPTION 'Foreign issuer context' USING ERRCODE='23514'; END IF;
 IF NEW."companyScopeId"<>NEW."spaceId" AND (NEW."companyRecipientRootAccessId" IS NULL OR NEW."companyRecipientRootGeneration" IS NULL) THEN RAISE EXCEPTION 'Child offer needs current root admission binding' USING ERRCODE='23514'; END IF;
 IF NEW."companyRecipientRootAccessId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ContextAccess" WHERE id=NEW."companyRecipientRootAccessId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."spaceId") THEN RAISE EXCEPTION 'Foreign recipient root' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."companyScopeId",NEW."companyIssuerAccessId",NEW."companyIssuerGeneration",NEW."companyRecipientRootAccessId",NEW."companyRecipientRootGeneration",NEW."companyRestoreGeneration") IS DISTINCT FROM (OLD."companyScopeId",OLD."companyIssuerAccessId",OLD."companyIssuerGeneration",OLD."companyRecipientRootAccessId",OLD."companyRecipientRootGeneration",OLD."companyRestoreGeneration") THEN RAISE EXCEPTION 'Immutable Company offer bindings' USING ERRCODE='23514'; END IF;
 IF NEW.state='ACCEPTED' AND NOT EXISTS(SELECT 1 FROM "ContextAccess" WHERE id=NEW."companyAcceptedAccessId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."companyScopeId" AND "actorId"=NEW."acceptedActorId") THEN RAISE EXCEPTION 'Wrong accepted Company context' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ContextInvitation_company" BEFORE INSERT OR UPDATE ON "ContextInvitation" FOR EACH ROW EXECUTE FUNCTION company_invitation_guard();
CREATE FUNCTION company_admission_commit() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target uuid;
BEGIN
 target:=NEW."spaceId";
 IF EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=target AND kind='COMPANY') AND EXISTS(SELECT 1 FROM "ContextAccess" a WHERE a."spaceId"=target AND a."scopeId"<>target AND a.state IN ('ACTIVE','SUSPENDED') AND NOT EXISTS(SELECT 1 FROM "CompanyContextAdmission" b WHERE b."accessId"=a.id AND b.generation=a.generation)) THEN RAISE EXCEPTION 'Child admission requires root generation binding' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "ContextAccess_company_binding" AFTER INSERT OR UPDATE ON "ContextAccess" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION company_admission_commit();
COMMIT;
