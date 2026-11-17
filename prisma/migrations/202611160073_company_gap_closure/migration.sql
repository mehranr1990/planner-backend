BEGIN;
ALTER TABLE "CompanyResource" ADD COLUMN "assetTag" varchar(100);
CREATE UNIQUE INDEX "CompanyResource_assetTag_unique" ON "CompanyResource"("spaceId","assetTag") WHERE "assetTag" IS NOT NULL;
CREATE TABLE "CompanyAssetCustody" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "resourceId" uuid NOT NULL,
 "memberAccessId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL,
 "issuedByActorId" uuid NOT NULL,
 "assignedAt" timestamptz(3) NOT NULL,
 "expectedReturnAt" timestamptz(3),
 "returnedAt" timestamptz(3),
 "returnedByActorId" uuid,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyAssetCustody_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyAssetCustody_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyAssetCustody_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK ("expectedReturnAt" IS NULL OR "expectedReturnAt">"assignedAt"),
 CHECK (num_nonnulls("returnedAt","returnedByActorId") IN (0,2)),
 FOREIGN KEY ("spaceId","scopeId","memberAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("memberAccessId","memberGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","issuedByActorId") REFERENCES "SharedActor"("spaceId",id),
 FOREIGN KEY ("spaceId","returnedByActorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyAssetCustody_page" ON "CompanyAssetCustody"("spaceId","scopeId",id);
CREATE TABLE "CompanyAssetMaintenance" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "resourceId" uuid NOT NULL,
 "kind" varchar(100) NOT NULL,
 "reason" varchar(2000),
 "state" varchar(12) NOT NULL DEFAULT 'SCHEDULED',
 "scheduledAt" timestamptz(3) NOT NULL,
 "completedAt" timestamptz(3),
 "responsibleAccessId" uuid NOT NULL,
 "responsibleGeneration" integer NOT NULL,
 "createdByActorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyAssetMaintenance_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyAssetMaintenance_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyAssetMaintenance_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK (state IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELED')),
 FOREIGN KEY ("spaceId","scopeId","responsibleAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("responsibleAccessId","responsibleGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyAssetMaintenance_page" ON "CompanyAssetMaintenance"("spaceId","scopeId",id);
CREATE TABLE "CompanyKpiObservation" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "metric" varchar(100) NOT NULL,
 "source" varchar(300) NOT NULL,
 "unit" varchar(80) NOT NULL,
 "value" decimal(28,4) NOT NULL,
 "periodStart" timestamptz(3) NOT NULL,
 "periodEnd" timestamptz(3) NOT NULL,
 "recordedByActorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyKpiObservation_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyKpiObservation_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyKpiObservation_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK ("periodStart"<"periodEnd"),
 FOREIGN KEY ("spaceId","recordedByActorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyKpiObservation_page" ON "CompanyKpiObservation"("spaceId","scopeId",id);
CREATE TABLE "CompanyReviewCycle" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "title" varchar(300) NOT NULL,
 "periodStart" timestamptz(3) NOT NULL,
 "periodEnd" timestamptz(3) NOT NULL,
 "state" varchar(10) NOT NULL DEFAULT 'DRAFT',
 "createdByActorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyReviewCycle_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyReviewCycle_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyReviewCycle_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK ("periodStart"<"periodEnd"),
 CHECK (state IN ('DRAFT','OPEN','CLOSED')),
 FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyReviewCycle_page" ON "CompanyReviewCycle"("spaceId","scopeId",id);
CREATE TABLE "CompanyPerformanceReview" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "cycleId" uuid NOT NULL,
 "subjectAccessId" uuid NOT NULL,
 "subjectGeneration" integer NOT NULL,
 "reviewerAccessId" uuid NOT NULL,
 "reviewerGeneration" integer NOT NULL,
 "state" varchar(10) NOT NULL DEFAULT 'DRAFT',
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyPerformanceReview_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyPerformanceReview_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyPerformanceReview_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK ("subjectAccessId"<>"reviewerAccessId"),
 CHECK (state IN ('DRAFT','SUBMITTED','COMPLETED')),
 FOREIGN KEY ("spaceId","scopeId","subjectAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("subjectAccessId","subjectGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","scopeId","reviewerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("reviewerAccessId","reviewerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation)
);
CREATE INDEX "CompanyPerformanceReview_page" ON "CompanyPerformanceReview"("spaceId","scopeId",id);
CREATE TABLE "CompanyReviewRevision" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "reviewId" uuid NOT NULL,
 "body" varchar(10000),
 "state" varchar(10) NOT NULL,
 "actorId" uuid NOT NULL,
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyReviewRevision_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyReviewRevision_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyReviewRevision_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyReviewRevision_page" ON "CompanyReviewRevision"("spaceId","scopeId",id);
CREATE TABLE "CompanyOneOnOne" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "managerAccessId" uuid NOT NULL,
 "managerGeneration" integer NOT NULL,
 "employeeAccessId" uuid NOT NULL,
 "employeeGeneration" integer NOT NULL,
 "meetingAt" timestamptz(3) NOT NULL,
 "notes" varchar(10000),
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyOneOnOne_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyOneOnOne_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyOneOnOne_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK ("managerAccessId"<>"employeeAccessId"),
 FOREIGN KEY ("spaceId","scopeId","managerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("managerAccessId","managerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","scopeId","employeeAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("employeeAccessId","employeeGeneration") REFERENCES "ContextAccessInterval"("accessId",generation)
);
CREATE INDEX "CompanyOneOnOne_page" ON "CompanyOneOnOne"("spaceId","scopeId",id);
CREATE TABLE "CompanyOneOnOneRevision" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "recordId" uuid NOT NULL,
 "meetingAt" timestamptz(3) NOT NULL,
 "notes" varchar(10000),
 "actorId" uuid NOT NULL,
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyOneOnOneRevision_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyOneOnOneRevision_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyOneOnOneRevision_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyOneOnOneRevision_page" ON "CompanyOneOnOneRevision"("spaceId","scopeId",id);
CREATE TABLE "CompanyOneOnOneAction" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "recordId" uuid NOT NULL,
 "body" varchar(2000),
 "state" varchar(10) NOT NULL DEFAULT 'OPEN',
 "actorId" uuid NOT NULL,
 "redactedAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyOneOnOneAction_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyOneOnOneAction_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyOneOnOneAction_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK (state IN ('OPEN','DONE','CANCELED')),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyOneOnOneAction_page" ON "CompanyOneOnOneAction"("spaceId","scopeId",id);
CREATE TABLE "CompanyApprovalDelegation" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "delegatorAccessId" uuid NOT NULL,
 "delegatorGeneration" integer NOT NULL,
 "delegateAccessId" uuid NOT NULL,
 "delegateGeneration" integer NOT NULL,
 "workflowVersionId" uuid NOT NULL,
 "validFrom" timestamptz(3) NOT NULL,
 "expiresAt" timestamptz(3) NOT NULL,
 "revokedAt" timestamptz(3),
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyApprovalDelegation_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyApprovalDelegation_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyApprovalDelegation_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK ("validFrom"<"expiresAt"),
 CHECK ("delegatorAccessId"<>"delegateAccessId"),
 FOREIGN KEY ("spaceId","scopeId","delegatorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("delegatorAccessId","delegatorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","scopeId","delegateAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("delegateAccessId","delegateGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyApprovalDelegation_page" ON "CompanyApprovalDelegation"("spaceId","scopeId",id);
CREATE TABLE "CompanyCustomRole" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "title" varchar(100) NOT NULL,
 "capabilities" varchar(40)[] NOT NULL,
 "archivedAt" timestamptz(3),
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyCustomRole_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyCustomRole_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyCustomRole_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyCustomRole_page" ON "CompanyCustomRole"("spaceId","scopeId",id);
CREATE TABLE "CompanyRoleAssignment" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "roleId" uuid NOT NULL,
 "memberAccessId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL,
 "revokedAt" timestamptz(3),
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyRoleAssignment_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyRoleAssignment_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyRoleAssignment_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 FOREIGN KEY ("spaceId","scopeId","memberAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("memberAccessId","memberGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyRoleAssignment_page" ON "CompanyRoleAssignment"("spaceId","scopeId",id);
CREATE TABLE "CompanyTemporaryGrant" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "memberAccessId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL,
 "capabilities" varchar(40)[] NOT NULL,
 "validFrom" timestamptz(3) NOT NULL,
 "expiresAt" timestamptz(3) NOT NULL,
 "revokedAt" timestamptz(3),
 "actorId" uuid NOT NULL,
 "reason" varchar(2000),
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyTemporaryGrant_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyTemporaryGrant_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyTemporaryGrant_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK ("validFrom"<"expiresAt"),
 FOREIGN KEY ("spaceId","scopeId","memberAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("memberAccessId","memberGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyTemporaryGrant_page" ON "CompanyTemporaryGrant"("spaceId","scopeId",id);
CREATE TABLE "CompanyAccessReview" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "memberAccessId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL,
 "decision" varchar(10) NOT NULL,
 "reason" varchar(2000),
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyAccessReview_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyAccessReview_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyAccessReview_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK (decision IN ('RETAIN','REVOKE')),
 FOREIGN KEY ("spaceId","scopeId","memberAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("memberAccessId","memberGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyAccessReview_page" ON "CompanyAccessReview"("spaceId","scopeId",id);
CREATE TABLE "CompanyApprovalPolicyVersion" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "kind" varchar(20) NOT NULL,
 "state" varchar(10) NOT NULL DEFAULT 'DRAFT',
 "rules" jsonb NOT NULL,
 "effectiveFrom" timestamptz(3) NOT NULL,
 "effectiveUntil" timestamptz(3),
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyApprovalPolicyVersion_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyApprovalPolicyVersion_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyApprovalPolicyVersion_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK (kind IN ('EXPENSE','REIMBURSEMENT','BUDGET_CHANGE')),
 CHECK (state IN ('DRAFT','PUBLISHED','ARCHIVED')),
 CHECK ("effectiveUntil" IS NULL OR "effectiveFrom"<"effectiveUntil"),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyApprovalPolicyVersion_page" ON "CompanyApprovalPolicyVersion"("spaceId","scopeId",id);
CREATE TABLE "CompanyBudgetAlertRule" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "budgetId" uuid NOT NULL,
 "threshold" decimal(28,4) NOT NULL,
 "basis" varchar(12) NOT NULL,
 "revokedAt" timestamptz(3),
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyBudgetAlertRule_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyBudgetAlertRule_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyBudgetAlertRule_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK (threshold>0),
 CHECK (basis IN ('SPENT','COMMITTED')),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyBudgetAlertRule_page" ON "CompanyBudgetAlertRule"("spaceId","scopeId",id);
CREATE TABLE "CompanyBudgetAlertOccurrence" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "ruleId" uuid NOT NULL,
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyBudgetAlertOccurrence_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyBudgetAlertOccurrence_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyBudgetAlertOccurrence_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyBudgetAlertOccurrence_page" ON "CompanyBudgetAlertOccurrence"("spaceId","scopeId",id);
CREATE TABLE "CompanyRecoveryCase" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "requesterAccessId" uuid NOT NULL,
 "requesterGeneration" integer NOT NULL,
 "policyVersion" varchar(80),
 "state" varchar(20) NOT NULL DEFAULT 'POLICY_GATED',
 "evidenceReference" varchar(200),
 "actorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyRecoveryCase_scope" UNIQUE ("spaceId","scopeId",id),
 CONSTRAINT "CompanyRecoveryCase_company" FOREIGN KEY ("spaceId") REFERENCES "Company"("spaceId"),
 CONSTRAINT "CompanyRecoveryCase_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),
 CHECK (state IN ('POLICY_GATED','CANCELED')),
 FOREIGN KEY ("spaceId","scopeId","requesterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id),
 FOREIGN KEY ("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation),
 FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyRecoveryCase_page" ON "CompanyRecoveryCase"("spaceId","scopeId",id);
ALTER TABLE "CompanyAssetCustody" ADD CONSTRAINT "CompanyAssetCustody_resourceId_fk" FOREIGN KEY ("spaceId","scopeId","resourceId") REFERENCES "CompanyResource"("spaceId","scopeId","id");
ALTER TABLE "CompanyAssetMaintenance" ADD CONSTRAINT "CompanyAssetMaintenance_resourceId_fk" FOREIGN KEY ("spaceId","scopeId","resourceId") REFERENCES "CompanyResource"("spaceId","scopeId","id");
ALTER TABLE "CompanyPerformanceReview" ADD CONSTRAINT "CompanyPerformanceReview_cycleId_fk" FOREIGN KEY ("spaceId","scopeId","cycleId") REFERENCES "CompanyReviewCycle"("spaceId","scopeId","id");
ALTER TABLE "CompanyReviewRevision" ADD CONSTRAINT "CompanyReviewRevision_reviewId_fk" FOREIGN KEY ("spaceId","scopeId","reviewId") REFERENCES "CompanyPerformanceReview"("spaceId","scopeId","id");
ALTER TABLE "CompanyOneOnOneRevision" ADD CONSTRAINT "CompanyOneOnOneRevision_recordId_fk" FOREIGN KEY ("spaceId","scopeId","recordId") REFERENCES "CompanyOneOnOne"("spaceId","scopeId","id");
ALTER TABLE "CompanyOneOnOneAction" ADD CONSTRAINT "CompanyOneOnOneAction_recordId_fk" FOREIGN KEY ("spaceId","scopeId","recordId") REFERENCES "CompanyOneOnOne"("spaceId","scopeId","id");
ALTER TABLE "CompanyApprovalDelegation" ADD CONSTRAINT "CompanyApprovalDelegation_workflowVersionId_fk" FOREIGN KEY ("spaceId","scopeId","workflowVersionId") REFERENCES "CompanyFinancialWorkflowVersion"("spaceId","scopeId","id");
ALTER TABLE "CompanyRoleAssignment" ADD CONSTRAINT "CompanyRoleAssignment_roleId_fk" FOREIGN KEY ("spaceId","scopeId","roleId") REFERENCES "CompanyCustomRole"("spaceId","scopeId","id");
ALTER TABLE "CompanyBudgetAlertRule" ADD CONSTRAINT "CompanyBudgetAlertRule_budgetId_fk" FOREIGN KEY ("spaceId","scopeId","budgetId") REFERENCES "CompanyBudget"("spaceId","scopeId","id");
ALTER TABLE "CompanyBudgetAlertOccurrence" ADD CONSTRAINT "CompanyBudgetAlertOccurrence_ruleId_fk" FOREIGN KEY ("spaceId","scopeId","ruleId") REFERENCES "CompanyBudgetAlertRule"("spaceId","scopeId","id");
CREATE UNIQUE INDEX "CompanyAssetCustody_active" ON "CompanyAssetCustody"("resourceId") WHERE "returnedAt" IS NULL;
CREATE UNIQUE INDEX "CompanyPerformanceReview_participant" ON "CompanyPerformanceReview"("cycleId","subjectAccessId","subjectGeneration","reviewerAccessId","reviewerGeneration");
CREATE UNIQUE INDEX "CompanyBudgetAlertOccurrence_once" ON "CompanyBudgetAlertOccurrence"("ruleId");
CREATE UNIQUE INDEX "CompanyCustomRole_title" ON "CompanyCustomRole"("spaceId","scopeId",lower(title)) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "CompanyRoleAssignment_active" ON "CompanyRoleAssignment"("roleId","memberAccessId","memberGeneration") WHERE "revokedAt" IS NULL;
CREATE FUNCTION company_asset_availability_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM 1 FROM "CompanyResource" WHERE id=NEW."resourceId" FOR UPDATE;
 IF TG_TABLE_NAME='CompanyResourceAllocation' THEN IF NEW.state<>'ALLOCATED' THEN RETURN NEW; END IF; END IF;
 IF TG_TABLE_NAME='CompanyAssetCustody' THEN IF NEW."returnedAt" IS NOT NULL THEN RETURN NEW; END IF; END IF;
 IF TG_TABLE_NAME='CompanyAssetMaintenance' THEN IF NEW.state NOT IN ('SCHEDULED','IN_PROGRESS') THEN RETURN NEW; END IF; END IF;
 IF EXISTS(SELECT 1 FROM "CompanyAssetCustody" c WHERE c."resourceId"=NEW."resourceId" AND c."returnedAt" IS NULL AND c.id<>NEW.id)
 OR EXISTS(SELECT 1 FROM "CompanyAssetMaintenance" m WHERE m."resourceId"=NEW."resourceId" AND m.state IN ('SCHEDULED','IN_PROGRESS') AND m.id<>NEW.id)
 OR (TG_TABLE_NAME<>'CompanyResourceAllocation' AND EXISTS(SELECT 1 FROM "CompanyResourceAllocation" a WHERE a."resourceId"=NEW."resourceId" AND a.state='ALLOCATED' AND a."endAt">clock_timestamp()))
 THEN RAISE EXCEPTION 'RESOURCE_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyAssetCustody_availability" BEFORE INSERT OR UPDATE ON "CompanyAssetCustody" FOR EACH ROW EXECUTE FUNCTION company_asset_availability_guard();
CREATE TRIGGER "CompanyAssetMaintenance_availability" BEFORE INSERT OR UPDATE ON "CompanyAssetMaintenance" FOR EACH ROW EXECUTE FUNCTION company_asset_availability_guard();
CREATE TRIGGER "CompanyResourceAllocation_availability" BEFORE INSERT OR UPDATE ON "CompanyResourceAllocation" FOR EACH ROW EXECUTE FUNCTION company_asset_availability_guard();
CREATE FUNCTION company_gap_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['body','notes','redactedAt','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['body','notes','redactedAt','revision','updatedAt']) OR NEW."redactedAt" IS NULL OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Company history' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)->>'body') IS NOT NULL OR (to_jsonb(NEW)->>'notes') IS NOT NULL THEN RAISE EXCEPTION 'Redaction must clear content' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyReviewRevision_immutable" BEFORE UPDATE ON "CompanyReviewRevision" FOR EACH ROW EXECUTE FUNCTION company_gap_history_guard();
CREATE TRIGGER "CompanyOneOnOneRevision_immutable" BEFORE UPDATE ON "CompanyOneOnOneRevision" FOR EACH ROW EXECUTE FUNCTION company_gap_history_guard();

ALTER TABLE "CompanyDepartmentTransfer" ADD COLUMN "fromDepartmentId" uuid, ADD COLUMN "toDepartmentId" uuid, ADD COLUMN "fromUnitId" uuid, ADD COLUMN "toUnitId" uuid;
ALTER TABLE "CompanyFinancialApproval" ADD COLUMN "policyVersionId" uuid, ADD COLUMN "escalateAfterSeconds" integer CHECK("escalateAfterSeconds">0), ADD COLUMN "stepStartedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(), ADD COLUMN "budgetChangeRequestId" uuid;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_policy" FOREIGN KEY("spaceId","scopeId","policyVersionId") REFERENCES "CompanyApprovalPolicyVersion"("spaceId","scopeId",id);
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_budget_change" FOREIGN KEY("spaceId","scopeId","budgetChangeRequestId") REFERENCES "CompanyBudgetChangeRequest"("spaceId","scopeId",id);
CREATE UNIQUE INDEX "CompanyFinancialApproval_budget_active" ON "CompanyFinancialApproval"("budgetChangeRequestId") WHERE "budgetChangeRequestId" IS NOT NULL AND state='ACTIVE';
ALTER TABLE "CompanyFinancialWorkflow" DROP CONSTRAINT "CompanyFinancialWorkflow_kind";
ALTER TABLE "CompanyFinancialWorkflow" ADD CONSTRAINT "CompanyFinancialWorkflow_kind" CHECK(kind IN ('EXPENSE','REIMBURSEMENT','BUDGET_CHANGE'));
ALTER TABLE "CompanyFinancialApproval" DROP CONSTRAINT "CompanyFinancialApproval_shape";
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_shape" CHECK(num_nonnulls("expenseVersionId","reimbursementId","budgetChangeRequestId")=1 AND attempt>0 AND "sourceRevision">0 AND "stepIndex" BETWEEN 0 AND 4 AND state IN ('ACTIVE','APPROVED','REJECTED','CANCELED') AND fingerprint ~ '^[a-f0-9]{64}$' AND ("beneficiaryAccessId" IS NULL)=("beneficiaryGeneration" IS NULL));
ALTER TABLE "CompanyFinancialApprovalEvent" ADD COLUMN "delegationId" uuid, ADD COLUMN "previousStatus" varchar(10), ADD COLUMN "resultingStatus" varchar(10);
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_delegation" FOREIGN KEY("spaceId","scopeId","delegationId") REFERENCES "CompanyApprovalDelegation"("spaceId","scopeId",id);
ALTER TABLE "CompanyNotification" DROP CONSTRAINT "CompanyNotification_kind_check";
ALTER TABLE "CompanyNotification" ADD CONSTRAINT "CompanyNotification_kind_check" CHECK(kind IN ('KNOWLEDGE_ACK_REMINDER','EMPLOYEE_FILE_REQUEST','BUDGET_THRESHOLD','APPROVAL_ESCALATED'));
CREATE TABLE "CompanyRecoveryPolicyDraft" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,version varchar(80) NOT NULL,configuration jsonb NOT NULL,"actorId" uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("spaceId",version),CHECK("scopeId"="spaceId"),FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId"),FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id),FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id)
);
CREATE INDEX "CompanyRecoveryPolicyDraft_spaceId_id_idx" ON "CompanyRecoveryPolicyDraft"("spaceId",id);
CREATE OR REPLACE FUNCTION company_financial_instance_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE number_steps int; number_approved int; expected_kind text; source_revision int;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.state<>'ACTIVE' OR to_jsonb(NEW)-ARRAY['state','stepIndex','escalated','sourceRevision','revision','updatedAt','stepStartedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','stepIndex','escalated','sourceRevision','revision','updatedAt','stepStartedAt'] OR NEW."stepIndex" NOT IN (OLD."stepIndex",OLD."stepIndex"+1) THEN RAISE EXCEPTION 'immutable approval snapshot or terminal instance' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM "CompanyFinancialWorkflowVersion" WHERE id=NEW."workflowVersionId" AND state='PUBLISHED') THEN RAISE EXCEPTION 'published workflow required' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT w.kind INTO expected_kind FROM "CompanyFinancialWorkflowVersion" v JOIN "CompanyFinancialWorkflow" w ON w.id=v."workflowId" WHERE v.id=NEW."workflowVersionId";
 IF (expected_kind='EXPENSE')<>(NEW."expenseVersionId" IS NOT NULL) OR (expected_kind='REIMBURSEMENT')<>(NEW."reimbursementId" IS NOT NULL) OR (expected_kind='BUDGET_CHANGE')<>(NEW."budgetChangeRequestId" IS NOT NULL) THEN RAISE EXCEPTION 'wrong workflow source kind' USING ERRCODE='23514'; END IF;
 IF NEW."expenseVersionId" IS NOT NULL THEN SELECT e.revision INTO source_revision FROM "CompanyExpenseVersion" v JOIN "CompanyExpense" e ON e.id=v."expenseId" WHERE v.id=NEW."expenseVersionId"; ELSIF NEW."budgetChangeRequestId" IS NOT NULL THEN SELECT revision INTO source_revision FROM "CompanyBudgetChangeRequest" WHERE id=NEW."budgetChangeRequestId"; ELSE SELECT revision INTO source_revision FROM "CompanyReimbursementRequest" WHERE id=NEW."reimbursementId"; END IF;
 IF NEW.state<>'CANCELED' AND source_revision<>NEW."sourceRevision" THEN RAISE EXCEPTION 'stale financial source' USING ERRCODE='23514'; END IF;
 IF NEW.state='APPROVED' THEN SELECT count(*) INTO number_steps FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW."workflowVersionId"; SELECT count(*) INTO number_approved FROM "CompanyFinancialApprovalEvent" WHERE "approvalId"=NEW.id AND action='APPROVE'; IF number_steps<>number_approved THEN RAISE EXCEPTION 'all steps must approve' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW; END $$;

CREATE FUNCTION company_gap_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
 IF ROW(NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdAt") OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Company identity or stale revision' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE FUNCTION company_gap_facts_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE mutable text[];
BEGIN
 mutable:=CASE TG_TABLE_NAME
 WHEN 'CompanyAssetCustody' THEN ARRAY['returnedAt','returnedByActorId','revision','updatedAt']
 WHEN 'CompanyAssetMaintenance' THEN ARRAY['state','completedAt','reason','revision','updatedAt']
 WHEN 'CompanyReviewCycle' THEN ARRAY['state','revision','updatedAt']
 WHEN 'CompanyPerformanceReview' THEN ARRAY['state','redactedAt','revision','updatedAt']
 WHEN 'CompanyOneOnOne' THEN ARRAY['notes','meetingAt','redactedAt','revision','updatedAt']
 WHEN 'CompanyOneOnOneAction' THEN ARRAY['state','body','redactedAt','revision','updatedAt']
 WHEN 'CompanyCustomRole' THEN ARRAY['title','capabilities','archivedAt','revision','updatedAt']
 WHEN 'CompanyTemporaryGrant' THEN ARRAY['revokedAt','reason','revision','updatedAt']
 WHEN 'CompanyAccessReview' THEN ARRAY['reason','revision','updatedAt']
 WHEN 'CompanyApprovalPolicyVersion' THEN ARRAY['state','revision','updatedAt']
 WHEN 'CompanyRecoveryCase' THEN ARRAY['evidenceReference','state','revision','updatedAt']
 ELSE ARRAY['revokedAt','revision','updatedAt'] END;
 IF TG_TABLE_NAME IN ('CompanyKpiObservation','CompanyBudgetAlertOccurrence','CompanyRecoveryPolicyDraft') OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable THEN RAISE EXCEPTION 'Immutable Company facts' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyApprovalPolicyVersion' THEN IF NOT ((OLD.state='DRAFT' AND NEW.state='PUBLISHED') OR (OLD.state='PUBLISHED' AND NEW.state='ARCHIVED')) THEN RAISE EXCEPTION 'Invalid policy transition' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME='CompanyAssetCustody' THEN IF OLD."returnedAt" IS NOT NULL OR NEW."returnedAt" IS NULL OR NEW."returnedAt"<OLD."assignedAt" THEN RAISE EXCEPTION 'Invalid custody return' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW;
END $$;
ALTER TABLE "CompanyAssetCustody" ADD CONSTRAINT "CompanyAssetCustody_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyAssetCustody_identity" BEFORE UPDATE ON "CompanyAssetCustody" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyAssetCustody_facts" BEFORE UPDATE ON "CompanyAssetCustody" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyAssetMaintenance" ADD CONSTRAINT "CompanyAssetMaintenance_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyAssetMaintenance_identity" BEFORE UPDATE ON "CompanyAssetMaintenance" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyAssetMaintenance_facts" BEFORE UPDATE ON "CompanyAssetMaintenance" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyKpiObservation" ADD CONSTRAINT "CompanyKpiObservation_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyKpiObservation_identity" BEFORE UPDATE ON "CompanyKpiObservation" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyKpiObservation_facts" BEFORE UPDATE ON "CompanyKpiObservation" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyReviewCycle" ADD CONSTRAINT "CompanyReviewCycle_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyReviewCycle_identity" BEFORE UPDATE ON "CompanyReviewCycle" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyReviewCycle_facts" BEFORE UPDATE ON "CompanyReviewCycle" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyPerformanceReview" ADD CONSTRAINT "CompanyPerformanceReview_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyPerformanceReview_identity" BEFORE UPDATE ON "CompanyPerformanceReview" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyPerformanceReview_facts" BEFORE UPDATE ON "CompanyPerformanceReview" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyReviewRevision" ADD CONSTRAINT "CompanyReviewRevision_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyReviewRevision_identity" BEFORE UPDATE ON "CompanyReviewRevision" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
ALTER TABLE "CompanyOneOnOne" ADD CONSTRAINT "CompanyOneOnOne_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyOneOnOne_identity" BEFORE UPDATE ON "CompanyOneOnOne" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyOneOnOne_facts" BEFORE UPDATE ON "CompanyOneOnOne" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyOneOnOneRevision" ADD CONSTRAINT "CompanyOneOnOneRevision_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyOneOnOneRevision_identity" BEFORE UPDATE ON "CompanyOneOnOneRevision" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
ALTER TABLE "CompanyOneOnOneAction" ADD CONSTRAINT "CompanyOneOnOneAction_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyOneOnOneAction_identity" BEFORE UPDATE ON "CompanyOneOnOneAction" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyOneOnOneAction_facts" BEFORE UPDATE ON "CompanyOneOnOneAction" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyApprovalDelegation" ADD CONSTRAINT "CompanyApprovalDelegation_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyApprovalDelegation_identity" BEFORE UPDATE ON "CompanyApprovalDelegation" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyApprovalDelegation_facts" BEFORE UPDATE ON "CompanyApprovalDelegation" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyCustomRole" ADD CONSTRAINT "CompanyCustomRole_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyCustomRole_identity" BEFORE UPDATE ON "CompanyCustomRole" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyCustomRole_facts" BEFORE UPDATE ON "CompanyCustomRole" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyRoleAssignment" ADD CONSTRAINT "CompanyRoleAssignment_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyRoleAssignment_identity" BEFORE UPDATE ON "CompanyRoleAssignment" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyRoleAssignment_facts" BEFORE UPDATE ON "CompanyRoleAssignment" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyTemporaryGrant" ADD CONSTRAINT "CompanyTemporaryGrant_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyTemporaryGrant_identity" BEFORE UPDATE ON "CompanyTemporaryGrant" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyTemporaryGrant_facts" BEFORE UPDATE ON "CompanyTemporaryGrant" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyAccessReview" ADD CONSTRAINT "CompanyAccessReview_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyAccessReview_identity" BEFORE UPDATE ON "CompanyAccessReview" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyAccessReview_facts" BEFORE UPDATE ON "CompanyAccessReview" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyApprovalPolicyVersion" ADD CONSTRAINT "CompanyApprovalPolicyVersion_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyApprovalPolicyVersion_identity" BEFORE UPDATE ON "CompanyApprovalPolicyVersion" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyApprovalPolicyVersion_facts" BEFORE UPDATE ON "CompanyApprovalPolicyVersion" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyBudgetAlertRule" ADD CONSTRAINT "CompanyBudgetAlertRule_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyBudgetAlertRule_identity" BEFORE UPDATE ON "CompanyBudgetAlertRule" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyBudgetAlertRule_facts" BEFORE UPDATE ON "CompanyBudgetAlertRule" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyBudgetAlertOccurrence" ADD CONSTRAINT "CompanyBudgetAlertOccurrence_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyBudgetAlertOccurrence_identity" BEFORE UPDATE ON "CompanyBudgetAlertOccurrence" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyBudgetAlertOccurrence_facts" BEFORE UPDATE ON "CompanyBudgetAlertOccurrence" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyRecoveryCase" ADD CONSTRAINT "CompanyRecoveryCase_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyRecoveryCase_identity" BEFORE UPDATE ON "CompanyRecoveryCase" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyRecoveryCase_facts" BEFORE UPDATE ON "CompanyRecoveryCase" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyRecoveryPolicyDraft" ADD CONSTRAINT "CompanyRecoveryPolicyDraft_revision_positive" CHECK(revision>0);
CREATE TRIGGER "CompanyRecoveryPolicyDraft_identity" BEFORE UPDATE ON "CompanyRecoveryPolicyDraft" FOR EACH ROW EXECUTE FUNCTION company_gap_identity_guard();
CREATE TRIGGER "CompanyRecoveryPolicyDraft_facts" BEFORE UPDATE ON "CompanyRecoveryPolicyDraft" FOR EACH ROW EXECUTE FUNCTION company_gap_facts_guard();
ALTER TABLE "CompanyCustomRole" ADD CONSTRAINT "CompanyCustomRole_capabilities" CHECK(cardinality(capabilities) BETWEEN 1 AND 2 AND capabilities <@ ARRAY['structure.read','directory.read']::varchar[]);
ALTER TABLE "CompanyTemporaryGrant" ADD CONSTRAINT "CompanyTemporaryGrant_capabilities" CHECK(cardinality(capabilities) BETWEEN 1 AND 2 AND capabilities <@ ARRAY['structure.read','directory.read']::varchar[]);
ALTER TABLE "CompanyDepartmentTransfer" ADD CONSTRAINT "CompanyDepartmentTransfer_fromDepartmentId" FOREIGN KEY("spaceId","fromDepartmentId") REFERENCES "CompanyDepartment"("spaceId",id);
ALTER TABLE "CompanyDepartmentTransfer" ADD CONSTRAINT "CompanyDepartmentTransfer_toDepartmentId" FOREIGN KEY("spaceId","toDepartmentId") REFERENCES "CompanyDepartment"("spaceId",id);
ALTER TABLE "CompanyDepartmentTransfer" ADD CONSTRAINT "CompanyDepartmentTransfer_fromUnitId" FOREIGN KEY("spaceId","fromUnitId") REFERENCES "CompanyUnit"("spaceId",id);
ALTER TABLE "CompanyDepartmentTransfer" ADD CONSTRAINT "CompanyDepartmentTransfer_toUnitId" FOREIGN KEY("spaceId","toUnitId") REFERENCES "CompanyUnit"("spaceId",id);
CREATE FUNCTION company_budget_controlled_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE a "CompanyFinancialApproval";
BEGIN
 SELECT * INTO a FROM "CompanyFinancialApproval" WHERE "budgetChangeRequestId"=NEW.id ORDER BY attempt DESC LIMIT 1;
 IF a.id IS NOT NULL AND NEW.state IN ('APPROVED','REJECTED','WITHDRAWN') AND ((NEW.state='WITHDRAWN' AND a.state<>'CANCELED') OR (NEW.state<>'WITHDRAWN' AND a.state<>NEW.state)) THEN RAISE EXCEPTION 'Controlled budget approval required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyBudgetChangeRequest_controlled" BEFORE UPDATE ON "CompanyBudgetChangeRequest" FOR EACH ROW EXECUTE FUNCTION company_budget_controlled_guard();
COMMIT;
