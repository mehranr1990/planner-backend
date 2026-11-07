BEGIN;
CREATE TABLE "CompanyKnowledgeFolder" (
 "id" UUID NOT NULL PRIMARY KEY,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "parentId" UUID,
 "title" VARCHAR(300) NOT NULL,
 "archived" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "CompanyKnowledgeDocument" (
 "id" UUID NOT NULL PRIMARY KEY,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "folderId" UUID NOT NULL,
 "title" VARCHAR(300) NOT NULL,
 "description" VARCHAR(10000),
 "archived" BOOLEAN NOT NULL DEFAULT false,
 "publishedVersionId" UUID,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "CompanyKnowledgeVersion" (
 "id" UUID NOT NULL PRIMARY KEY,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "documentId" UUID NOT NULL,
 "fileId" UUID NOT NULL,
 "uploaderAccessId" UUID NOT NULL,
 "uploaderGeneration" INTEGER NOT NULL,
 "title" VARCHAR(300) NOT NULL,
 "description" VARCHAR(10000),
 "publishedAt" TIMESTAMPTZ(3),
 "pinnedRevision" INTEGER,
 "pinnedHash" VARCHAR(64),
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE "CompanyKnowledgeFolder" ADD CONSTRAINT "CompanyKnowledgeFolder_scope" UNIQUE("spaceId","scopeId",id);
CREATE INDEX "CompanyKnowledgeFolder_page" ON "CompanyKnowledgeFolder"("spaceId","scopeId",id);
ALTER TABLE "CompanyKnowledgeDocument" ADD CONSTRAINT "CompanyKnowledgeDocument_scope" UNIQUE("spaceId","scopeId",id);
CREATE INDEX "CompanyKnowledgeDocument_page" ON "CompanyKnowledgeDocument"("spaceId","scopeId",id);
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_scope" UNIQUE("spaceId","scopeId",id);
CREATE INDEX "CompanyKnowledgeVersion_page" ON "CompanyKnowledgeVersion"("spaceId","scopeId",id);
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_document_key" UNIQUE("spaceId","scopeId","documentId",id), ADD CONSTRAINT "CompanyKnowledgeVersion_file_key" UNIQUE("spaceId","scopeId","fileId");
ALTER TABLE "CompanyKnowledgeFolder" ADD CONSTRAINT "CompanyKnowledgeFolder_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeFolder" ADD CONSTRAINT "CompanyKnowledgeFolder_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeFolder" ADD CONSTRAINT "CompanyKnowledgeFolder_parent" FOREIGN KEY("spaceId","scopeId","parentId") REFERENCES "CompanyKnowledgeFolder"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeDocument" ADD CONSTRAINT "CompanyKnowledgeDocument_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeDocument" ADD CONSTRAINT "CompanyKnowledgeDocument_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeDocument" ADD CONSTRAINT "CompanyKnowledgeDocument_folder" FOREIGN KEY("spaceId","scopeId","folderId") REFERENCES "CompanyKnowledgeFolder"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeDocument" ADD CONSTRAINT "CompanyKnowledgeDocument_published" FOREIGN KEY("spaceId","scopeId","id","publishedVersionId") REFERENCES "CompanyKnowledgeVersion"("spaceId","scopeId","documentId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_document" FOREIGN KEY("spaceId","scopeId","documentId") REFERENCES "CompanyKnowledgeDocument"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_file" FOREIGN KEY("spaceId","scopeId","fileId") REFERENCES "StoredFile"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_uploader" FOREIGN KEY("spaceId","scopeId","uploaderAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_interval" FOREIGN KEY("uploaderAccessId","uploaderGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyKnowledgeFolder" ADD CONSTRAINT "CompanyKnowledgeFolder_valid" CHECK(revision>0 AND length(trim(title))>0 AND ("parentId" IS NULL OR "parentId"<>id));
ALTER TABLE "CompanyKnowledgeDocument" ADD CONSTRAINT "CompanyKnowledgeDocument_valid" CHECK(revision>0 AND length(trim(title))>0);
ALTER TABLE "CompanyKnowledgeVersion" ADD CONSTRAINT "CompanyKnowledgeVersion_valid" CHECK(revision>0 AND "uploaderGeneration">0 AND length(trim(title))>0 AND (("publishedAt" IS NULL AND "pinnedRevision" IS NULL AND "pinnedHash" IS NULL) OR ("publishedAt" IS NOT NULL AND "pinnedRevision">0 AND "pinnedHash" ~ '^[a-f0-9]{64}$')));
CREATE FUNCTION company_knowledge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "StoredFile"; p uuid; depth integer:=0;
BEGIN
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
CREATE FUNCTION company_knowledge_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "CompanyKnowledgeVersion" v WHERE v."fileId"=OLD.id AND v."publishedAt" IS NOT NULL) AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'published knowledge file immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyKnowledgeFolder_guard" BEFORE INSERT OR UPDATE ON "CompanyKnowledgeFolder" FOR EACH ROW EXECUTE FUNCTION company_knowledge_guard();
CREATE TRIGGER "CompanyKnowledgeDocument_guard" BEFORE INSERT OR UPDATE ON "CompanyKnowledgeDocument" FOR EACH ROW EXECUTE FUNCTION company_knowledge_guard();
CREATE TRIGGER "CompanyKnowledgeVersion_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyKnowledgeVersion" FOR EACH ROW EXECUTE FUNCTION company_knowledge_guard();
CREATE TRIGGER "CompanyKnowledgeFile_guard" BEFORE UPDATE ON "StoredFile" FOR EACH ROW EXECUTE FUNCTION company_knowledge_file_guard();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('company.knowledge-folder','company.knowledge-document','company.knowledge-version','shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.financial-workflow','company.financial-workflow-version','company.financial-approval','company.reimbursement-request','company.payment-acknowledgement','company.acknowledgement-correction','company.expense','company.budget','company.commitment','company.finance-category','company.finance-reference','company.expense-version','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry'));
COMMIT;
