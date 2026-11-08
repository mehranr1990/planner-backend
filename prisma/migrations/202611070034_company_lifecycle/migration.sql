BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION shared_purge_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "SharedLifecycleJob" j ON j."spaceId"=c."spaceId" AND j.generation=c."closureGeneration" WHERE c."spaceId"=target AND c.kind IN ('PROJECT','TEAM','COMPANY') AND c.state='PURGING' AND j.state='PURGING' AND j."recoveryDeadline"<=clock_timestamp() AND j."leaseUntil">clock_timestamp() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$' AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL' WHERE a."spaceId"=target AND (c.kind<>'COMPANY' OR a."scopeId"=target) AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND e."closedAt">=a."joinedAt")))
$$;
CREATE OR REPLACE FUNCTION company_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r jsonb; role_name text; seen text[]:=ARRAY[]::text[];
BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable Company policy history' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Company policy requires Company custody' USING ERRCODE='23514'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(NEW.rules) LOOP
  IF jsonb_typeof(r)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>4 OR NOT(r ?& ARRAY['key','mode','roles','overrideDefault']) OR jsonb_typeof(r->'key')<>'string' OR jsonb_typeof(r->'mode')<>'string' OR r->>'key' NOT IN ('structure.read','directory.read') OR r->>'key'=ANY(seen) OR r->>'mode' NOT IN ('MANDATORY','DEFAULT','OPTIONAL') OR jsonb_typeof(r->'roles')<>'array' OR jsonb_typeof(r->'overrideDefault')<>'boolean' OR ((r->>'overrideDefault')::boolean AND r->>'mode'<>'DEFAULT') THEN RAISE EXCEPTION 'Invalid bounded Company policy' USING ERRCODE='23514'; END IF;
  seen:=array_append(seen,r->>'key');
  FOR role_name IN SELECT jsonb_array_elements_text(r->'roles') LOOP IF role_name IS NULL OR role_name NOT IN ('OWNER','ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER') THEN RAISE EXCEPTION 'Unknown Company role' USING ERRCODE='23514'; END IF; END LOOP;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION company_admission_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind='COMPANY') THEN RAISE EXCEPTION 'Immutable Company admission binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION company_finance_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable finance history' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyExpenseVersion' THEN
  IF OLD.state IN ('APPROVED','REJECTED','CANCELED') OR (OLD.state='SUBMITTED' AND (to_jsonb(NEW)-ARRAY['state','revision','updatedAt','reviewerAccessId','reviewerGeneration','decidedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','updatedAt','reviewerAccessId','reviewerGeneration','decidedAt'])) THEN RAISE EXCEPTION 'immutable expense facts' USING ERRCODE='23514'; END IF;
  IF OLD.state='SUBMITTED' AND NEW.state NOT IN ('SUBMITTED','APPROVED','REJECTED','CANCELED') THEN RAISE EXCEPTION 'invalid expense transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='CompanyCommitment' THEN
  IF (to_jsonb(NEW)-ARRAY['state','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','updatedAt']) OR OLD.state='RELEASED' THEN RAISE EXCEPTION 'immutable commitment' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'immutable financial ledger' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION company_finance_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE parent "CompanyExpenseVersion"; binding uuid;
BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN SELECT * INTO parent FROM "CompanyExpenseVersion" WHERE id=OLD."versionId"; ELSE SELECT * INTO parent FROM "CompanyExpenseVersion" WHERE id=NEW."versionId"; END IF;
 IF parent.state<>'DRAFT' THEN RAISE EXCEPTION 'submitted expense evidence is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyExpenseReceipt' AND TG_OP='UPDATE' THEN IF OLD."pinnedRevision" IS NOT NULL THEN RAISE EXCEPTION 'pinned receipt' USING ERRCODE='23514'; END IF; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION company_settlement_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'append only financial evidence' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION company_financial_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE count_steps int; count_people int; distinct_people int;
BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'immutable published financial version' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
 IF ROW(NEW."workflowId",NEW.number,NEW."createdByActorId") IS DISTINCT FROM ROW(OLD."workflowId",OLD.number,OLD."createdByActorId") OR OLD.state='ARCHIVED' THEN RAISE EXCEPTION 'immutable financial version' USING ERRCODE='23514'; END IF;
 IF OLD.state='PUBLISHED' THEN IF NEW.state<>'ARCHIVED' OR to_jsonb(NEW)-ARRAY['state','revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','revision','updatedAt'] THEN RAISE EXCEPTION 'immutable published financial version' USING ERRCODE='23514'; END IF; END IF;
 IF OLD.state='DRAFT' THEN IF NEW.state NOT IN ('DRAFT','PUBLISHED') THEN RAISE EXCEPTION 'invalid publication transition' USING ERRCODE='23514'; END IF; END IF;
 IF NEW.state='PUBLISHED' THEN SELECT count(*) INTO count_steps FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id; IF count_steps<1 OR count_steps>5 OR NOT EXISTS(SELECT 1 FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id AND position=count_steps-1) THEN RAISE EXCEPTION 'invalid approval steps' USING ERRCODE='23514'; END IF;
 SELECT count(*),count(DISTINCT person) INTO count_people,distinct_people FROM (SELECT "primaryAccessId" person FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id UNION ALL SELECT "alternateAccessId" FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id AND "alternateAccessId" IS NOT NULL) people; IF count_people<>distinct_people THEN RAISE EXCEPTION 'distinct reviewers required' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION company_financial_step_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE version_state text;
BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN SELECT state INTO version_state FROM "CompanyFinancialWorkflowVersion" WHERE id=OLD."versionId"; ELSE SELECT state INTO version_state FROM "CompanyFinancialWorkflowVersion" WHERE id=NEW."versionId"; END IF;
 IF version_state<>'DRAFT' THEN RAISE EXCEPTION 'immutable published approval steps' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION company_reimbursement_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'retained financial evidence' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyReimbursementRequest' THEN
  IF to_jsonb(NEW)-ARRAY['amount','state','revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['amount','state','revision','updatedAt'] OR (OLD.state<>'DRAFT' AND NEW.amount<>OLD.amount) OR OLD.state IN ('REJECTED','CANCELED','CLOSED','INVALIDATED') THEN RAISE EXCEPTION 'immutable reimbursement facts' USING ERRCODE='23514'; END IF;
  IF OLD.state='DRAFT' THEN IF NEW.state NOT IN ('DRAFT','SUBMITTED','CANCELED','INVALIDATED') THEN RAISE EXCEPTION 'submission required' USING ERRCODE='23514'; END IF; END IF;
  IF OLD.state='SUBMITTED' THEN IF NEW.state NOT IN ('SUBMITTED','APPROVED','REJECTED','CANCELED','INVALIDATED') THEN RAISE EXCEPTION 'invalid reimbursement decision' USING ERRCODE='23514'; END IF; END IF;
  IF OLD.state='APPROVED' THEN IF NEW.state NOT IN ('CLOSED','INVALIDATED') THEN RAISE EXCEPTION 'immutable reimbursement approval' USING ERRCODE='23514'; END IF; END IF;
 ELSE
  IF OLD.state<>'PROPOSED' OR NEW.state='PROPOSED' OR to_jsonb(NEW)-ARRAY['state','revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','revision','updatedAt'] THEN RAISE EXCEPTION 'immutable acknowledgement facts' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION company_knowledge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "StoredFile"; p uuid; depth integer:=0;
BEGIN
 IF TG_OP='DELETE' AND shared_purge_allowed(OLD."spaceId") THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN IF OLD."publishedAt" IS NOT NULL THEN RAISE EXCEPTION 'published knowledge immutable' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdAt") THEN RAISE EXCEPTION 'knowledge identity immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyKnowledgeVersion' THEN
  IF TG_OP='UPDATE' AND (OLD."publishedAt" IS NOT NULL OR (NEW."documentId",NEW."fileId",NEW."uploaderAccessId",NEW."uploaderGeneration",NEW.title,NEW.description) IS DISTINCT FROM (OLD."documentId",OLD."fileId",OLD."uploaderAccessId",OLD."uploaderGeneration",OLD.title,OLD.description)) THEN RAISE EXCEPTION 'knowledge version immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO f FROM "StoredFile" WHERE id=NEW."fileId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId" FOR UPDATE;
  IF NOT FOUND OR NEW.id<>NEW."fileId" OR f."ownerUserId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM "ContextAccess" a WHERE a.id=NEW."uploaderAccessId" AND a."actorId"=f."createdByActorId") OR EXISTS(SELECT 1 FROM "CompanyExpenseReceipt" r WHERE r."fileId"=NEW."fileId") OR (NEW."publishedAt" IS NOT NULL AND (f.status<>'READY' OR f.revision<>NEW."pinnedRevision" OR f.sha256 IS DISTINCT FROM NEW."pinnedHash")) THEN RAISE EXCEPTION 'knowledge file evidence invalid' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='CompanyKnowledgeDocument' THEN
  IF NEW."publishedVersionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CompanyKnowledgeVersion" WHERE id=NEW."publishedVersionId" AND "documentId"=NEW.id AND "publishedAt" IS NOT NULL) THEN RAISE EXCEPTION 'unpublished knowledge pointer' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" FOR UPDATE;
  p:=NEW."parentId";
  WHILE p IS NOT NULL LOOP
   depth:=depth+1;
   IF p=NEW.id OR depth>8 THEN RAISE EXCEPTION 'knowledge folder cycle/depth' USING ERRCODE='23514'; END IF;
   SELECT "parentId" INTO p FROM "CompanyKnowledgeFolder" WHERE id=p AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId";
  END LOOP;
  IF TG_OP='UPDATE' AND NEW."parentId" IS DISTINCT FROM OLD."parentId" THEN RAISE EXCEPTION 'knowledge folder parent immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION company_knowledge_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF shared_purge_allowed(OLD."spaceId") THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM "CompanyKnowledgeVersion" v WHERE v."fileId"=OLD.id AND v."publishedAt" IS NOT NULL) AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'published knowledge file immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
COMMIT;
