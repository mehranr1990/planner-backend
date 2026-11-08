BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION company_association_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','revision','expiresAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','expiresAt','updatedAt']) OR NEW.revision<>OLD.revision+1 OR OLD.state='REVOKED' THEN RAISE EXCEPTION 'immutable Company association consent' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
ALTER TABLE "Team" ADD CONSTRAINT "Team_space_id_pair" UNIQUE("spaceId",id);
CREATE TABLE "ProjectCompanyAssociation" (
 "id" UUID PRIMARY KEY,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "sourceId" UUID NOT NULL,
 "companySpaceId" UUID NOT NULL,
 "companyScopeId" UUID NOT NULL,
 "sourceAccessId" UUID NOT NULL,
 "sourceGeneration" INTEGER NOT NULL,
 "companyAccessId" UUID NOT NULL,
 "companyGeneration" INTEGER NOT NULL,
 "sourceCompanyAccessId" UUID NOT NULL,
 "sourceCompanyGeneration" INTEGER NOT NULL,
 "destinationAccessId" UUID NOT NULL,
 "destinationGeneration" INTEGER NOT NULL,
 "sourceEpoch" INTEGER NOT NULL,
 "companyEpoch" INTEGER NOT NULL,
 "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "expiresAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_source" FOREIGN KEY("spaceId","sourceId") REFERENCES "Project"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_scope" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_company" FOREIGN KEY("companySpaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_context" FOREIGN KEY("companySpaceId","companyScopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_sourceOwner" FOREIGN KEY("spaceId","scopeId","sourceAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_companyOwner" FOREIGN KEY("companySpaceId","companyAccessId") REFERENCES "ContextAccess"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_sourceAdmission" FOREIGN KEY("companySpaceId","companyScopeId","sourceCompanyAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_destinationAdmission" FOREIGN KEY("companySpaceId","companyScopeId","destinationAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_sourceInterval" FOREIGN KEY("sourceAccessId","sourceGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_companyInterval" FOREIGN KEY("companyAccessId","companyGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_sourceAdmissionInterval" FOREIGN KEY("sourceCompanyAccessId","sourceCompanyGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_destinationInterval" FOREIGN KEY("destinationAccessId","destinationGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectCompanyAssociation" ADD CONSTRAINT "ProjectCompanyAssociation_valid" CHECK("sourceId"="scopeId" AND "scopeId"="spaceId" AND "spaceId"<>"companySpaceId" AND "companyScopeId"<>"companySpaceId" AND revision>0 AND "sourceGeneration">0 AND "companyGeneration">0 AND "sourceCompanyGeneration">0 AND "destinationGeneration">0 AND "sourceEpoch">=0 AND "companyEpoch">=0 AND state IN ('PENDING','ASSOCIATED','ATTACH_PENDING','ATTACHED','REVOKED'));
CREATE UNIQUE INDEX "ProjectCompanyAssociation_active" ON "ProjectCompanyAssociation"("sourceId") WHERE state<>'REVOKED';
CREATE INDEX "ProjectCompanyAssociation_company_page" ON "ProjectCompanyAssociation"("companySpaceId","companyScopeId",id);
CREATE TRIGGER "ProjectCompanyAssociation_identity" BEFORE UPDATE ON "ProjectCompanyAssociation" FOR EACH ROW EXECUTE FUNCTION company_association_identity();
CREATE TABLE "TeamCompanyAssociation" (
 "id" UUID PRIMARY KEY,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "sourceId" UUID NOT NULL,
 "companySpaceId" UUID NOT NULL,
 "companyScopeId" UUID NOT NULL,
 "sourceAccessId" UUID NOT NULL,
 "sourceGeneration" INTEGER NOT NULL,
 "companyAccessId" UUID NOT NULL,
 "companyGeneration" INTEGER NOT NULL,
 "sourceCompanyAccessId" UUID NOT NULL,
 "sourceCompanyGeneration" INTEGER NOT NULL,
 "destinationAccessId" UUID NOT NULL,
 "destinationGeneration" INTEGER NOT NULL,
 "sourceEpoch" INTEGER NOT NULL,
 "companyEpoch" INTEGER NOT NULL,
 "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "expiresAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_source" FOREIGN KEY("spaceId","sourceId") REFERENCES "Team"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_scope" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_company" FOREIGN KEY("companySpaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_context" FOREIGN KEY("companySpaceId","companyScopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_sourceOwner" FOREIGN KEY("spaceId","scopeId","sourceAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_companyOwner" FOREIGN KEY("companySpaceId","companyAccessId") REFERENCES "ContextAccess"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_sourceAdmission" FOREIGN KEY("companySpaceId","companyScopeId","sourceCompanyAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_destinationAdmission" FOREIGN KEY("companySpaceId","companyScopeId","destinationAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_sourceInterval" FOREIGN KEY("sourceAccessId","sourceGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_companyInterval" FOREIGN KEY("companyAccessId","companyGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_sourceAdmissionInterval" FOREIGN KEY("sourceCompanyAccessId","sourceCompanyGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_destinationInterval" FOREIGN KEY("destinationAccessId","destinationGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCompanyAssociation" ADD CONSTRAINT "TeamCompanyAssociation_valid" CHECK("sourceId"="scopeId" AND "scopeId"="spaceId" AND "spaceId"<>"companySpaceId" AND "companyScopeId"<>"companySpaceId" AND revision>0 AND "sourceGeneration">0 AND "companyGeneration">0 AND "sourceCompanyGeneration">0 AND "destinationGeneration">0 AND "sourceEpoch">=0 AND "companyEpoch">=0 AND state IN ('PENDING','ASSOCIATED','ATTACH_PENDING','ATTACHED','REVOKED'));
CREATE UNIQUE INDEX "TeamCompanyAssociation_active" ON "TeamCompanyAssociation"("sourceId") WHERE state<>'REVOKED';
CREATE INDEX "TeamCompanyAssociation_company_page" ON "TeamCompanyAssociation"("companySpaceId","companyScopeId",id);
CREATE TRIGGER "TeamCompanyAssociation_identity" BEFORE UPDATE ON "TeamCompanyAssociation" FOR EACH ROW EXECUTE FUNCTION company_association_identity();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('company.association','company.knowledge-folder','company.knowledge-document','company.knowledge-version','shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.financial-workflow','company.financial-workflow-version','company.financial-approval','company.reimbursement-request','company.payment-acknowledgement','company.acknowledgement-correction','company.expense','company.budget','company.commitment','company.finance-category','company.finance-reference','company.expense-version','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry'));
COMMIT;
