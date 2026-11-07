BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- M032: owner-approved ADR0037; additive Company reimbursements and controlled approvals.
CREATE TABLE "CompanyFinancialWorkflow" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "kind" VARCHAR(13) NOT NULL,
 "title" VARCHAR(300) NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyFinancialWorkflow_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyFinancialWorkflowVersion" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "workflowId" UUID NOT NULL,
 "number" INTEGER NOT NULL,
 "title" VARCHAR(300) NOT NULL,
 "state" VARCHAR(9) NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyFinancialWorkflowVersion_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyFinancialWorkflowVersion_u1" UNIQUE ("spaceId","scopeId","workflowId","number")
);
CREATE TABLE "CompanyFinancialWorkflowStep" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "versionId" UUID NOT NULL,
 "position" INTEGER NOT NULL,
 "label" VARCHAR(100) NOT NULL,
 "primaryAccessId" UUID NOT NULL,
 "primaryGeneration" INTEGER NOT NULL,
 "alternateAccessId" UUID,
 "alternateGeneration" INTEGER,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyFinancialWorkflowStep_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyFinancialWorkflowStep_u1" UNIQUE ("spaceId","scopeId","versionId","position")
);
CREATE TABLE "CompanyFinancialApproval" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "workflowVersionId" UUID NOT NULL,
 "expenseVersionId" UUID,
 "reimbursementId" UUID,
 "requesterAccessId" UUID NOT NULL,
 "requesterGeneration" INTEGER NOT NULL,
 "beneficiaryAccessId" UUID,
 "beneficiaryGeneration" INTEGER,
 "attempt" INTEGER NOT NULL,
 "fingerprint" VARCHAR(64) NOT NULL,
 "state" VARCHAR(9) NOT NULL,
 "stepIndex" INTEGER NOT NULL DEFAULT 0,
 "escalated" BOOLEAN NOT NULL DEFAULT false,
 "sourceRevision" INTEGER NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyFinancialApproval_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyFinancialApprovalEvent" (
 "reviewerAccessId" UUID,
 "reviewerGeneration" INTEGER,
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "approvalId" UUID NOT NULL,
 "stepId" UUID,
 "action" VARCHAR(12) NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyFinancialApprovalEvent_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyReimbursementBucket" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "expenseId" UUID NOT NULL,
 "initialVersionId" UUID NOT NULL,
 "beneficiaryActorId" UUID NOT NULL,
 "currency" VARCHAR(3) NOT NULL,
 "scale" INTEGER NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyReimbursementBucket_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyReimbursementBucket_u1" UNIQUE ("spaceId","scopeId","expenseId","beneficiaryActorId","currency")
);
CREATE TABLE "CompanyReimbursementRequest" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "bucketId" UUID NOT NULL,
 "expenseVersionId" UUID NOT NULL,
 "beneficiaryAccessId" UUID NOT NULL,
 "beneficiaryGeneration" INTEGER NOT NULL,
 "amount" DECIMAL(28,4) NOT NULL,
 "state" VARCHAR(11) NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyReimbursementRequest_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyPaymentAcknowledgement" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "requestId" UUID NOT NULL,
 "bucketId" UUID NOT NULL,
 "authorAccessId" UUID NOT NULL,
 "authorGeneration" INTEGER NOT NULL,
 "amount" DECIMAL(28,4) NOT NULL,
 "reference" VARCHAR(300),
 "state" VARCHAR(12) NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyPaymentAcknowledgement_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyAcknowledgementCorrection" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "paymentId" UUID NOT NULL,
 "requestId" UUID NOT NULL,
 "bucketId" UUID NOT NULL,
 "authorAccessId" UUID NOT NULL,
 "authorGeneration" INTEGER NOT NULL,
 "amount" DECIMAL(28,4) NOT NULL,
 "reason" VARCHAR(1000) NOT NULL,
 "state" VARCHAR(12) NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyAcknowledgementCorrection_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyReimbursementEffect" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "bucketId" UUID NOT NULL,
 "requestId" UUID,
 "paymentId" UUID,
 "correctionId" UUID,
 "sourceVersionId" UUID,
 "kind" VARCHAR(12) NOT NULL,
 "entitlement" DECIMAL(28,4) NOT NULL,
 "reserved" DECIMAL(28,4) NOT NULL,
 "acknowledged" DECIMAL(28,4) NOT NULL,
 "pending" DECIMAL(28,4) NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyReimbursementEffect_u0" UNIQUE ("spaceId","scopeId","id")
);
ALTER TABLE "CompanyFinancialWorkflow" ADD CONSTRAINT "CompanyFinancialWorkflow_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflow" ADD CONSTRAINT "CompanyFinancialWorkflow_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowVersion" ADD CONSTRAINT "CompanyFinancialWorkflowVersion_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowVersion" ADD CONSTRAINT "CompanyFinancialWorkflowVersion_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowVersion" ADD CONSTRAINT "CompanyFinancialWorkflowVersion_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_primary" FOREIGN KEY ("spaceId","scopeId","primaryAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_primaryInterval" FOREIGN KEY ("primaryAccessId","primaryGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_alternate" FOREIGN KEY ("spaceId","scopeId","alternateAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_alternateInterval" FOREIGN KEY ("alternateAccessId","alternateGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_requester" FOREIGN KEY ("spaceId","scopeId","requesterAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_requesterInterval" FOREIGN KEY ("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_beneficiary" FOREIGN KEY ("spaceId","scopeId","beneficiaryAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_beneficiaryInterval" FOREIGN KEY ("beneficiaryAccessId","beneficiaryGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementBucket" ADD CONSTRAINT "CompanyReimbursementBucket_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementBucket" ADD CONSTRAINT "CompanyReimbursementBucket_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_beneficiary" FOREIGN KEY ("spaceId","scopeId","beneficiaryAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_beneficiaryInterval" FOREIGN KEY ("beneficiaryAccessId","beneficiaryGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_author" FOREIGN KEY ("spaceId","scopeId","authorAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_authorInterval" FOREIGN KEY ("authorAccessId","authorGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_author" FOREIGN KEY ("spaceId","scopeId","authorAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_authorInterval" FOREIGN KEY ("authorAccessId","authorGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowVersion" ADD CONSTRAINT "CompanyFinancialWorkflowVersion_workflow" FOREIGN KEY ("spaceId","scopeId","workflowId") REFERENCES "CompanyFinancialWorkflow" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_version" FOREIGN KEY ("spaceId","scopeId","versionId") REFERENCES "CompanyFinancialWorkflowVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_workflowVersion" FOREIGN KEY ("spaceId","scopeId","workflowVersionId") REFERENCES "CompanyFinancialWorkflowVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_expense" FOREIGN KEY ("spaceId","scopeId","expenseVersionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_request" FOREIGN KEY ("spaceId","scopeId","reimbursementId") REFERENCES "CompanyReimbursementRequest" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_approval" FOREIGN KEY ("spaceId","scopeId","approvalId") REFERENCES "CompanyFinancialApproval" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_step" FOREIGN KEY ("spaceId","scopeId","stepId") REFERENCES "CompanyFinancialWorkflowStep" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementBucket" ADD CONSTRAINT "CompanyReimbursementBucket_expense" FOREIGN KEY ("spaceId","scopeId","expenseId") REFERENCES "CompanyExpense" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementBucket" ADD CONSTRAINT "CompanyReimbursementBucket_initialVersion" FOREIGN KEY ("spaceId","scopeId","initialVersionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementBucket" ADD CONSTRAINT "CompanyReimbursementBucket_beneficiary" FOREIGN KEY ("spaceId","beneficiaryActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_expense" FOREIGN KEY ("spaceId","scopeId","expenseVersionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_bucket" FOREIGN KEY ("spaceId","scopeId","bucketId") REFERENCES "CompanyReimbursementBucket" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_bucket" FOREIGN KEY ("spaceId","scopeId","bucketId") REFERENCES "CompanyReimbursementBucket" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_bucket" FOREIGN KEY ("spaceId","scopeId","bucketId") REFERENCES "CompanyReimbursementBucket" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_bucket" FOREIGN KEY ("spaceId","scopeId","bucketId") REFERENCES "CompanyReimbursementBucket" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_request" FOREIGN KEY ("spaceId","scopeId","requestId") REFERENCES "CompanyReimbursementRequest" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_request" FOREIGN KEY ("spaceId","scopeId","requestId") REFERENCES "CompanyReimbursementRequest" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_request" FOREIGN KEY ("spaceId","scopeId","requestId") REFERENCES "CompanyReimbursementRequest" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_payment" FOREIGN KEY ("spaceId","scopeId","paymentId") REFERENCES "CompanyPaymentAcknowledgement" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_payment" FOREIGN KEY ("spaceId","scopeId","paymentId") REFERENCES "CompanyPaymentAcknowledgement" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_correction" FOREIGN KEY ("spaceId","scopeId","correctionId") REFERENCES "CompanyAcknowledgementCorrection" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_source" FOREIGN KEY ("spaceId","scopeId","sourceVersionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "CompanyFinancialWorkflowVersion_workflowId_lookup" ON "CompanyFinancialWorkflowVersion"("workflowId",id);
CREATE INDEX "CompanyFinancialWorkflowStep_versionId_lookup" ON "CompanyFinancialWorkflowStep"("versionId",id);
CREATE INDEX "CompanyFinancialApproval_expenseVersionId_lookup" ON "CompanyFinancialApproval"("expenseVersionId",id);
CREATE INDEX "CompanyFinancialApproval_reimbursementId_lookup" ON "CompanyFinancialApproval"("reimbursementId",id);
CREATE INDEX "CompanyFinancialApprovalEvent_approvalId_lookup" ON "CompanyFinancialApprovalEvent"("approvalId",id);
CREATE INDEX "CompanyReimbursementBucket_expenseId_lookup" ON "CompanyReimbursementBucket"("expenseId",id);
CREATE INDEX "CompanyReimbursementRequest_bucketId_lookup" ON "CompanyReimbursementRequest"("bucketId",id);
CREATE INDEX "CompanyReimbursementRequest_expenseVersionId_lookup" ON "CompanyReimbursementRequest"("expenseVersionId",id);
CREATE INDEX "CompanyPaymentAcknowledgement_requestId_lookup" ON "CompanyPaymentAcknowledgement"("requestId",id);
CREATE INDEX "CompanyAcknowledgementCorrection_paymentId_lookup" ON "CompanyAcknowledgementCorrection"("paymentId",id);
CREATE INDEX "CompanyReimbursementEffect_bucketId_lookup" ON "CompanyReimbursementEffect"("bucketId",id);
CREATE INDEX "CompanyReimbursementEffect_requestId_lookup" ON "CompanyReimbursementEffect"("requestId",id);
CREATE INDEX "CompanyReimbursementEffect_paymentId_lookup" ON "CompanyReimbursementEffect"("paymentId",id);
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_reviewer" FOREIGN KEY ("spaceId","scopeId","reviewerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_reviewerInterval" FOREIGN KEY ("reviewerAccessId","reviewerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyFinancialWorkflow" ADD CONSTRAINT "CompanyFinancialWorkflow_revision" CHECK (revision>0);
ALTER TABLE "CompanyFinancialWorkflowVersion" ADD CONSTRAINT "CompanyFinancialWorkflowVersion_revision" CHECK (revision>0);
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_revision" CHECK (revision>0);
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_revision" CHECK (revision>0);
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_revision" CHECK (revision>0);
ALTER TABLE "CompanyReimbursementBucket" ADD CONSTRAINT "CompanyReimbursementBucket_revision" CHECK (revision>0);
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_revision" CHECK (revision>0);
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_revision" CHECK (revision>0);
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_revision" CHECK (revision>0);
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_revision" CHECK (revision>0);
ALTER TABLE "CompanyFinancialWorkflow" ADD CONSTRAINT "CompanyFinancialWorkflow_kind" CHECK (kind IN ('EXPENSE','REIMBURSEMENT'));
ALTER TABLE "CompanyFinancialWorkflowVersion" ADD CONSTRAINT "CompanyFinancialWorkflowVersion_shape" CHECK (number>0 AND state IN ('DRAFT','PUBLISHED','ARCHIVED'));
ALTER TABLE "CompanyFinancialWorkflowStep" ADD CONSTRAINT "CompanyFinancialWorkflowStep_shape" CHECK (position BETWEEN 0 AND 4 AND ("alternateAccessId" IS NULL)=("alternateGeneration" IS NULL) AND "primaryAccessId" IS DISTINCT FROM "alternateAccessId");
ALTER TABLE "CompanyFinancialApproval" ADD CONSTRAINT "CompanyFinancialApproval_shape" CHECK (("expenseVersionId" IS NULL)<>("reimbursementId" IS NULL) AND attempt>0 AND "sourceRevision">0 AND "stepIndex" BETWEEN 0 AND 4 AND state IN ('ACTIVE','APPROVED','REJECTED','CANCELED') AND fingerprint ~ '^[a-f0-9]{64}$' AND ("beneficiaryAccessId" IS NULL)=("beneficiaryGeneration" IS NULL));
ALTER TABLE "CompanyFinancialApprovalEvent" ADD CONSTRAINT "CompanyFinancialApprovalEvent_shape" CHECK (action IN ('SUBMIT','APPROVE','REJECT','ESCALATE','RESTART','CANCEL') AND ("reviewerAccessId" IS NULL)=("reviewerGeneration" IS NULL) AND (action NOT IN ('APPROVE','REJECT','ESCALATE') OR ("stepId" IS NOT NULL AND "reviewerAccessId" IS NOT NULL)));
ALTER TABLE "CompanyReimbursementRequest" ADD CONSTRAINT "CompanyReimbursementRequest_shape" CHECK (amount>0 AND amount<1000000000000000000 AND state IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELED','CLOSED','INVALIDATED'));
ALTER TABLE "CompanyPaymentAcknowledgement" ADD CONSTRAINT "CompanyPaymentAcknowledgement_shape" CHECK (amount>0 AND amount<1000000000000000000 AND state IN ('PROPOSED','ACKNOWLEDGED','DISPUTED','CANCELED','INVALIDATED'));
ALTER TABLE "CompanyAcknowledgementCorrection" ADD CONSTRAINT "CompanyAcknowledgementCorrection_shape" CHECK (amount>0 AND amount<1000000000000000000 AND state IN ('PROPOSED','ACKNOWLEDGED','DECLINED','CANCELED'));
ALTER TABLE "CompanyReimbursementEffect" ADD CONSTRAINT "CompanyReimbursementEffect_kind" CHECK (kind IN ('INITIAL','APPROVAL','PROPOSE','ACKNOWLEDGE','DISPUTE','CANCEL','CLOSE','CORRECTION','SUPERSEDE'));
ALTER TABLE "CompanyReimbursementBucket" ADD CONSTRAINT "CompanyReimbursementBucket_currency" CHECK (scale=(CASE currency WHEN 'AED' THEN 2 WHEN 'AFN' THEN 2 WHEN 'ALL' THEN 2 WHEN 'AMD' THEN 2 WHEN 'AOA' THEN 2 WHEN 'ARS' THEN 2 WHEN 'AUD' THEN 2 WHEN 'AWG' THEN 2 WHEN 'AZN' THEN 2 WHEN 'BAM' THEN 2 WHEN 'BBD' THEN 2 WHEN 'BDT' THEN 2 WHEN 'BHD' THEN 3 WHEN 'BIF' THEN 0 WHEN 'BMD' THEN 2 WHEN 'BND' THEN 2 WHEN 'BOB' THEN 2 WHEN 'BOV' THEN 2 WHEN 'BRL' THEN 2 WHEN 'BSD' THEN 2 WHEN 'BTN' THEN 2 WHEN 'BWP' THEN 2 WHEN 'BYN' THEN 2 WHEN 'BZD' THEN 2 WHEN 'CAD' THEN 2 WHEN 'CDF' THEN 2 WHEN 'CHE' THEN 2 WHEN 'CHF' THEN 2 WHEN 'CHW' THEN 2 WHEN 'CLF' THEN 4 WHEN 'CLP' THEN 0 WHEN 'CNY' THEN 2 WHEN 'COP' THEN 2 WHEN 'COU' THEN 2 WHEN 'CRC' THEN 2 WHEN 'CUP' THEN 2 WHEN 'CVE' THEN 2 WHEN 'CZK' THEN 2 WHEN 'DJF' THEN 0 WHEN 'DKK' THEN 2 WHEN 'DOP' THEN 2 WHEN 'DZD' THEN 2 WHEN 'EGP' THEN 2 WHEN 'ERN' THEN 2 WHEN 'ETB' THEN 2 WHEN 'EUR' THEN 2 WHEN 'FJD' THEN 2 WHEN 'FKP' THEN 2 WHEN 'GBP' THEN 2 WHEN 'GEL' THEN 2 WHEN 'GHS' THEN 2 WHEN 'GIP' THEN 2 WHEN 'GMD' THEN 2 WHEN 'GNF' THEN 0 WHEN 'GTQ' THEN 2 WHEN 'GYD' THEN 2 WHEN 'HKD' THEN 2 WHEN 'HNL' THEN 2 WHEN 'HTG' THEN 2 WHEN 'HUF' THEN 2 WHEN 'IDR' THEN 2 WHEN 'ILS' THEN 2 WHEN 'INR' THEN 2 WHEN 'IQD' THEN 3 WHEN 'IRR' THEN 2 WHEN 'ISK' THEN 0 WHEN 'JMD' THEN 2 WHEN 'JOD' THEN 3 WHEN 'JPY' THEN 0 WHEN 'KES' THEN 2 WHEN 'KGS' THEN 2 WHEN 'KHR' THEN 2 WHEN 'KMF' THEN 0 WHEN 'KPW' THEN 2 WHEN 'KRW' THEN 0 WHEN 'KWD' THEN 3 WHEN 'KYD' THEN 2 WHEN 'KZT' THEN 2 WHEN 'LAK' THEN 2 WHEN 'LBP' THEN 2 WHEN 'LKR' THEN 2 WHEN 'LRD' THEN 2 WHEN 'LSL' THEN 2 WHEN 'LYD' THEN 3 WHEN 'MAD' THEN 2 WHEN 'MDL' THEN 2 WHEN 'MGA' THEN 2 WHEN 'MKD' THEN 2 WHEN 'MMK' THEN 2 WHEN 'MNT' THEN 2 WHEN 'MOP' THEN 2 WHEN 'MRU' THEN 2 WHEN 'MUR' THEN 2 WHEN 'MVR' THEN 2 WHEN 'MWK' THEN 2 WHEN 'MXN' THEN 2 WHEN 'MXV' THEN 2 WHEN 'MYR' THEN 2 WHEN 'MZN' THEN 2 WHEN 'NAD' THEN 2 WHEN 'NGN' THEN 2 WHEN 'NIO' THEN 2 WHEN 'NOK' THEN 2 WHEN 'NPR' THEN 2 WHEN 'NZD' THEN 2 WHEN 'OMR' THEN 3 WHEN 'PAB' THEN 2 WHEN 'PEN' THEN 2 WHEN 'PGK' THEN 2 WHEN 'PHP' THEN 2 WHEN 'PKR' THEN 2 WHEN 'PLN' THEN 2 WHEN 'PYG' THEN 0 WHEN 'QAR' THEN 2 WHEN 'RON' THEN 2 WHEN 'RSD' THEN 2 WHEN 'RUB' THEN 2 WHEN 'RWF' THEN 0 WHEN 'SAR' THEN 2 WHEN 'SBD' THEN 2 WHEN 'SCR' THEN 2 WHEN 'SDG' THEN 2 WHEN 'SEK' THEN 2 WHEN 'SGD' THEN 2 WHEN 'SHP' THEN 2 WHEN 'SLE' THEN 2 WHEN 'SOS' THEN 2 WHEN 'SRD' THEN 2 WHEN 'SSP' THEN 2 WHEN 'STN' THEN 2 WHEN 'SVC' THEN 2 WHEN 'SYP' THEN 2 WHEN 'SZL' THEN 2 WHEN 'THB' THEN 2 WHEN 'TJS' THEN 2 WHEN 'TMT' THEN 2 WHEN 'TND' THEN 3 WHEN 'TOP' THEN 2 WHEN 'TRY' THEN 2 WHEN 'TTD' THEN 2 WHEN 'TWD' THEN 2 WHEN 'TZS' THEN 2 WHEN 'UAH' THEN 2 WHEN 'UGX' THEN 0 WHEN 'USD' THEN 2 WHEN 'USN' THEN 2 WHEN 'UYI' THEN 0 WHEN 'UYU' THEN 2 WHEN 'UYW' THEN 4 WHEN 'UZS' THEN 2 WHEN 'VED' THEN 2 WHEN 'VES' THEN 2 WHEN 'VND' THEN 0 WHEN 'VUV' THEN 0 WHEN 'WST' THEN 2 WHEN 'XAD' THEN 2 WHEN 'XAF' THEN 0 WHEN 'XCD' THEN 2 WHEN 'XCG' THEN 2 WHEN 'XOF' THEN 0 WHEN 'XPF' THEN 0 WHEN 'YER' THEN 2 WHEN 'ZAR' THEN 2 WHEN 'ZMW' THEN 2 WHEN 'ZWG' THEN 2 ELSE -1 END));
CREATE UNIQUE INDEX "CompanyFinancialApproval_expense_active" ON "CompanyFinancialApproval"("expenseVersionId") WHERE "expenseVersionId" IS NOT NULL AND state='ACTIVE';
CREATE UNIQUE INDEX "CompanyFinancialApproval_request_active" ON "CompanyFinancialApproval"("reimbursementId") WHERE "reimbursementId" IS NOT NULL AND state='ACTIVE';
CREATE UNIQUE INDEX "CompanyFinancialApproval_expense_attempt" ON "CompanyFinancialApproval"("expenseVersionId",attempt) WHERE "expenseVersionId" IS NOT NULL;
CREATE UNIQUE INDEX "CompanyFinancialApproval_request_attempt" ON "CompanyFinancialApproval"("reimbursementId",attempt) WHERE "reimbursementId" IS NOT NULL;
CREATE UNIQUE INDEX "CompanyFinancialApprovalEvent_decision" ON "CompanyFinancialApprovalEvent"("approvalId","stepId") WHERE action IN ('APPROVE','REJECT');
CREATE UNIQUE INDEX "CompanyReimbursementEffect_initial" ON "CompanyReimbursementEffect"("bucketId") WHERE kind='INITIAL';
CREATE UNIQUE INDEX "CompanyReimbursementEffect_approval" ON "CompanyReimbursementEffect"("requestId") WHERE kind='APPROVAL';
CREATE UNIQUE INDEX "CompanyReimbursementEffect_payment" ON "CompanyReimbursementEffect"("paymentId",kind) WHERE kind IN ('PROPOSE','ACKNOWLEDGE','DISPUTE','CANCEL');
CREATE UNIQUE INDEX "CompanyReimbursementEffect_correction" ON "CompanyReimbursementEffect"("correctionId") WHERE kind='CORRECTION';
CREATE FUNCTION company_settlement_identity() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
 IF ROW(NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdAt") OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable settlement identity or stale revision' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE FUNCTION company_settlement_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
 RAISE EXCEPTION 'append only financial evidence' USING ERRCODE='23514'; END $$;
CREATE FUNCTION company_financial_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE count_steps int; count_people int; distinct_people int;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'immutable published financial version' USING ERRCODE='23514'; END IF; RETURN OLD; END IF;
 IF ROW(NEW."workflowId",NEW.number,NEW."createdByActorId") IS DISTINCT FROM ROW(OLD."workflowId",OLD.number,OLD."createdByActorId") OR OLD.state='ARCHIVED' THEN RAISE EXCEPTION 'immutable financial version' USING ERRCODE='23514'; END IF;
 IF OLD.state='PUBLISHED' THEN IF NEW.state<>'ARCHIVED' OR to_jsonb(NEW)-ARRAY['state','revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','revision','updatedAt'] THEN RAISE EXCEPTION 'immutable published financial version' USING ERRCODE='23514'; END IF; END IF;
 IF OLD.state='DRAFT' THEN IF NEW.state NOT IN ('DRAFT','PUBLISHED') THEN RAISE EXCEPTION 'invalid publication transition' USING ERRCODE='23514'; END IF; END IF;
 IF NEW.state='PUBLISHED' THEN SELECT count(*) INTO count_steps FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id; IF count_steps<1 OR count_steps>5 OR NOT EXISTS(SELECT 1 FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id AND position=count_steps-1) THEN RAISE EXCEPTION 'invalid approval steps' USING ERRCODE='23514'; END IF;
 SELECT count(*),count(DISTINCT person) INTO count_people,distinct_people FROM (SELECT "primaryAccessId" person FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id UNION ALL SELECT "alternateAccessId" FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW.id AND "alternateAccessId" IS NOT NULL) people; IF count_people<>distinct_people THEN RAISE EXCEPTION 'distinct reviewers required' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW; END $$;
CREATE FUNCTION company_financial_step_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE version_state text;
BEGIN
 IF TG_OP='DELETE' THEN SELECT state INTO version_state FROM "CompanyFinancialWorkflowVersion" WHERE id=OLD."versionId"; ELSE SELECT state INTO version_state FROM "CompanyFinancialWorkflowVersion" WHERE id=NEW."versionId"; END IF;
 IF version_state<>'DRAFT' THEN RAISE EXCEPTION 'immutable published approval steps' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE FUNCTION company_financial_instance_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE number_steps int; number_approved int; expected_kind text; source_revision int;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.state<>'ACTIVE' OR to_jsonb(NEW)-ARRAY['state','stepIndex','escalated','sourceRevision','revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','stepIndex','escalated','sourceRevision','revision','updatedAt'] OR NEW."stepIndex" NOT IN (OLD."stepIndex",OLD."stepIndex"+1) THEN RAISE EXCEPTION 'immutable approval snapshot or terminal instance' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM "CompanyFinancialWorkflowVersion" WHERE id=NEW."workflowVersionId" AND state='PUBLISHED') THEN RAISE EXCEPTION 'published workflow required' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT w.kind INTO expected_kind FROM "CompanyFinancialWorkflowVersion" v JOIN "CompanyFinancialWorkflow" w ON w.id=v."workflowId" WHERE v.id=NEW."workflowVersionId";
 IF (expected_kind='EXPENSE')<>(NEW."expenseVersionId" IS NOT NULL) THEN RAISE EXCEPTION 'wrong workflow source kind' USING ERRCODE='23514'; END IF;
 IF NEW."expenseVersionId" IS NOT NULL THEN SELECT e.revision INTO source_revision FROM "CompanyExpenseVersion" v JOIN "CompanyExpense" e ON e.id=v."expenseId" WHERE v.id=NEW."expenseVersionId"; ELSE SELECT revision INTO source_revision FROM "CompanyReimbursementRequest" WHERE id=NEW."reimbursementId"; END IF;
 IF NEW.state<>'CANCELED' AND source_revision<>NEW."sourceRevision" THEN RAISE EXCEPTION 'stale financial source' USING ERRCODE='23514'; END IF;
 IF NEW.state='APPROVED' THEN SELECT count(*) INTO number_steps FROM "CompanyFinancialWorkflowStep" WHERE "versionId"=NEW."workflowVersionId"; SELECT count(*) INTO number_approved FROM "CompanyFinancialApprovalEvent" WHERE "approvalId"=NEW.id AND action='APPROVE'; IF number_steps<>number_approved THEN RAISE EXCEPTION 'all steps must approve' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW; END $$;
CREATE FUNCTION company_financial_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE a "CompanyFinancialApproval"; st "CompanyFinancialWorkflowStep";
BEGIN
 SELECT * INTO a FROM "CompanyFinancialApproval" WHERE id=NEW."approvalId";
 IF a.state<>'ACTIVE' THEN RAISE EXCEPTION 'terminal approval history' USING ERRCODE='23514'; END IF;
 IF NEW."stepId" IS NOT NULL THEN SELECT * INTO st FROM "CompanyFinancialWorkflowStep" WHERE id=NEW."stepId"; IF st."versionId"<>a."workflowVersionId" OR st.position<>a."stepIndex" THEN RAISE EXCEPTION 'wrong financial approval step' USING ERRCODE='23514'; END IF; END IF;
 IF NEW.action IN ('APPROVE','REJECT') THEN IF NEW."reviewerAccessId"=a."requesterAccessId" OR NEW."reviewerAccessId"=a."beneficiaryAccessId" THEN RAISE EXCEPTION 'self approval denied' USING ERRCODE='23514'; END IF; IF (NEW."reviewerAccessId",NEW."reviewerGeneration") IS DISTINCT FROM (CASE WHEN a.escalated THEN st."alternateAccessId" ELSE st."primaryAccessId" END,CASE WHEN a.escalated THEN st."alternateGeneration" ELSE st."primaryGeneration" END) THEN RAISE EXCEPTION 'wrong reviewer designation' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW; END $$;
CREATE FUNCTION company_reimbursement_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE b "CompanyReimbursementBucket"; r "CompanyReimbursementRequest"; payment "CompanyPaymentAcknowledgement";
BEGIN
 SELECT * INTO b FROM "CompanyReimbursementBucket" WHERE id=NEW."bucketId";
 IF NEW.amount<>trunc(NEW.amount,b.scale) THEN RAISE EXCEPTION 'invalid reimbursement precision' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyReimbursementRequest' THEN
  IF NOT EXISTS(SELECT 1 FROM "CompanyExpenseVersion" v JOIN "ContextAccess" a ON a.id=v."payerAccessId" WHERE v.id=NEW."expenseVersionId" AND v."expenseId"=b."expenseId" AND v.currency=b.currency AND v.scale=b.scale AND a."actorId"=b."beneficiaryActorId" AND v."payerAccessId"=NEW."beneficiaryAccessId" AND v."payerGeneration"=NEW."beneficiaryGeneration") THEN RAISE EXCEPTION 'wrong reimbursement expense or beneficiary' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO r FROM "CompanyReimbursementRequest" WHERE id=NEW."requestId";
  IF r."bucketId"<>NEW."bucketId" OR NEW."authorAccessId"=r."beneficiaryAccessId" THEN RAISE EXCEPTION 'wrong settlement party or bucket' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='CompanyAcknowledgementCorrection' THEN SELECT * INTO payment FROM "CompanyPaymentAcknowledgement" WHERE id=NEW."paymentId" FOR UPDATE; IF payment."requestId"<>NEW."requestId" OR payment."bucketId"<>NEW."bucketId" OR payment.state<>'ACKNOWLEDGED' THEN RAISE EXCEPTION 'wrong original acknowledgement' USING ERRCODE='23514'; END IF;
   IF TG_OP='INSERT' THEN IF NEW.amount+(SELECT COALESCE(sum(amount),0) FROM "CompanyAcknowledgementCorrection" WHERE "paymentId"=NEW."paymentId" AND state IN ('PROPOSED','ACKNOWLEDGED'))>payment.amount THEN RAISE EXCEPTION 'acknowledgement correction exceeds remaining amount' USING ERRCODE='23514'; END IF; END IF;
  END IF;
 END IF; RETURN NEW; END $$;
CREATE FUNCTION company_reimbursement_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'retained financial evidence' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyReimbursementRequest' THEN
  IF to_jsonb(NEW)-ARRAY['amount','state','revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['amount','state','revision','updatedAt'] OR (OLD.state<>'DRAFT' AND NEW.amount<>OLD.amount) OR OLD.state IN ('REJECTED','CANCELED','CLOSED','INVALIDATED') THEN RAISE EXCEPTION 'immutable reimbursement facts' USING ERRCODE='23514'; END IF;
  IF OLD.state='DRAFT' THEN IF NEW.state NOT IN ('DRAFT','SUBMITTED','CANCELED','INVALIDATED') THEN RAISE EXCEPTION 'submission required' USING ERRCODE='23514'; END IF; END IF;
  IF OLD.state='SUBMITTED' THEN IF NEW.state NOT IN ('SUBMITTED','APPROVED','REJECTED','CANCELED','INVALIDATED') THEN RAISE EXCEPTION 'invalid reimbursement decision' USING ERRCODE='23514'; END IF; END IF;
  IF OLD.state='APPROVED' THEN IF NEW.state NOT IN ('CLOSED','INVALIDATED') THEN RAISE EXCEPTION 'immutable reimbursement approval' USING ERRCODE='23514'; END IF; END IF;
 ELSE
  IF OLD.state<>'PROPOSED' OR NEW.state='PROPOSED' OR to_jsonb(NEW)-ARRAY['state','revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','revision','updatedAt'] THEN RAISE EXCEPTION 'immutable acknowledgement facts' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW; END $$;
CREATE FUNCTION company_reimbursement_balance_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE b "CompanyReimbursementBucket"; ent numeric; res numeric; ack numeric; pend numeric; r "CompanyReimbursementRequest"; r_res numeric; r_ack numeric; r_pend numeric;
BEGIN
 SELECT * INTO b FROM "CompanyReimbursementBucket" WHERE id=NEW."bucketId" FOR UPDATE;
 IF NEW.entitlement<>trunc(NEW.entitlement,b.scale) OR NEW.reserved<>trunc(NEW.reserved,b.scale) OR NEW.acknowledged<>trunc(NEW.acknowledged,b.scale) OR NEW.pending<>trunc(NEW.pending,b.scale) THEN RAISE EXCEPTION 'invalid reimbursement effect precision' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(entitlement),0),COALESCE(sum(reserved),0),COALESCE(sum(acknowledged),0),COALESCE(sum(pending),0) INTO ent,res,ack,pend FROM "CompanyReimbursementEffect" WHERE "bucketId"=b.id;
 IF ent<0 OR ent>=1000000000000000000 OR res<0 OR ack<0 OR pend<0 OR pend>res OR res>greatest(ent-ack,0) THEN RAISE EXCEPTION 'reimbursement balance conflict' USING ERRCODE='23514'; END IF;
 IF NEW."requestId" IS NOT NULL THEN
 SELECT * INTO r FROM "CompanyReimbursementRequest" WHERE id=NEW."requestId";
 IF r."bucketId"<>b.id THEN RAISE EXCEPTION 'foreign reimbursement request' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(reserved),0),COALESCE(sum(acknowledged),0),COALESCE(sum(pending),0) INTO r_res,r_ack,r_pend FROM "CompanyReimbursementEffect" WHERE "requestId"=r.id;
 IF r_res<0 OR r_ack<0 OR r_pend<0 OR r_res+r_ack>r.amount OR r_pend>r_res THEN RAISE EXCEPTION 'request balance conflict' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."paymentId" IS NOT NULL THEN IF NOT EXISTS(SELECT 1 FROM "CompanyPaymentAcknowledgement" WHERE id=NEW."paymentId" AND "requestId"=NEW."requestId" AND "bucketId"=b.id) THEN RAISE EXCEPTION 'foreign payment effect' USING ERRCODE='23514'; END IF; END IF;
 IF NEW."correctionId" IS NOT NULL THEN IF NOT EXISTS(SELECT 1 FROM "CompanyAcknowledgementCorrection" WHERE id=NEW."correctionId" AND "paymentId"=NEW."paymentId" AND "requestId"=NEW."requestId" AND "bucketId"=b.id) THEN RAISE EXCEPTION 'foreign correction effect' USING ERRCODE='23514'; END IF; END IF;
 IF NEW."sourceVersionId" IS NOT NULL THEN IF NOT EXISTS(SELECT 1 FROM "CompanyExpenseVersion" WHERE id=NEW."sourceVersionId" AND "expenseId"=b."expenseId") THEN RAISE EXCEPTION 'foreign entitlement effect' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW; END $$;
CREATE FUNCTION company_financial_source_decision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE approval "CompanyFinancialApproval";
BEGIN
 IF NEW.state IN ('APPROVED','REJECTED') AND OLD.state='SUBMITTED' THEN
  IF TG_TABLE_NAME='CompanyExpenseVersion' THEN SELECT * INTO approval FROM "CompanyFinancialApproval" WHERE "expenseVersionId"=NEW.id ORDER BY attempt DESC LIMIT 1; ELSE SELECT * INTO approval FROM "CompanyFinancialApproval" WHERE "reimbursementId"=NEW.id ORDER BY attempt DESC LIMIT 1; END IF;
  IF TG_TABLE_NAME='CompanyReimbursementRequest' OR approval.id IS NOT NULL THEN IF approval.id IS NULL OR approval.state<>NEW.state THEN RAISE EXCEPTION 'controlled financial approval required' USING ERRCODE='23514'; END IF; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER "CompanyFinancialWorkflow_identity" BEFORE UPDATE ON "CompanyFinancialWorkflow" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyFinancialWorkflowVersion_identity" BEFORE UPDATE ON "CompanyFinancialWorkflowVersion" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyFinancialWorkflowStep_identity" BEFORE UPDATE ON "CompanyFinancialWorkflowStep" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyFinancialApproval_identity" BEFORE UPDATE ON "CompanyFinancialApproval" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyReimbursementBucket_identity" BEFORE UPDATE ON "CompanyReimbursementBucket" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyReimbursementRequest_identity" BEFORE UPDATE ON "CompanyReimbursementRequest" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyPaymentAcknowledgement_identity" BEFORE UPDATE ON "CompanyPaymentAcknowledgement" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyAcknowledgementCorrection_identity" BEFORE UPDATE ON "CompanyAcknowledgementCorrection" FOR EACH ROW EXECUTE FUNCTION company_settlement_identity();
CREATE TRIGGER "CompanyFinancialApprovalEvent_immutable" BEFORE UPDATE OR DELETE ON "CompanyFinancialApprovalEvent" FOR EACH ROW EXECUTE FUNCTION company_settlement_immutable();
CREATE TRIGGER "CompanyReimbursementEffect_immutable" BEFORE UPDATE OR DELETE ON "CompanyReimbursementEffect" FOR EACH ROW EXECUTE FUNCTION company_settlement_immutable();
CREATE TRIGGER "CompanyReimbursementBucket_immutable" BEFORE UPDATE OR DELETE ON "CompanyReimbursementBucket" FOR EACH ROW EXECUTE FUNCTION company_settlement_immutable();
CREATE TRIGGER "CompanyFinancialWorkflow_immutable" BEFORE UPDATE OR DELETE ON "CompanyFinancialWorkflow" FOR EACH ROW EXECUTE FUNCTION company_settlement_immutable();
CREATE TRIGGER "CompanyFinancialWorkflowVersion_guard" BEFORE UPDATE OR DELETE ON "CompanyFinancialWorkflowVersion" FOR EACH ROW EXECUTE FUNCTION company_financial_version_guard();
CREATE TRIGGER "CompanyFinancialWorkflowStep_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyFinancialWorkflowStep" FOR EACH ROW EXECUTE FUNCTION company_financial_step_guard();
CREATE TRIGGER "CompanyFinancialApproval_guard" BEFORE INSERT OR UPDATE ON "CompanyFinancialApproval" FOR EACH ROW EXECUTE FUNCTION company_financial_instance_guard();
CREATE TRIGGER "CompanyFinancialApprovalEvent_guard" BEFORE INSERT ON "CompanyFinancialApprovalEvent" FOR EACH ROW EXECUTE FUNCTION company_financial_event_guard();
CREATE TRIGGER "CompanyReimbursementEffect_balance" AFTER INSERT ON "CompanyReimbursementEffect" FOR EACH ROW EXECUTE FUNCTION company_reimbursement_balance_guard();
CREATE TRIGGER "CompanyExpenseVersion_controlled" BEFORE UPDATE ON "CompanyExpenseVersion" FOR EACH ROW EXECUTE FUNCTION company_financial_source_decision_guard();
CREATE TRIGGER "CompanyReimbursementRequest_controlled" BEFORE UPDATE ON "CompanyReimbursementRequest" FOR EACH ROW EXECUTE FUNCTION company_financial_source_decision_guard();
CREATE TRIGGER "CompanyReimbursementRequest_source" BEFORE INSERT OR UPDATE ON "CompanyReimbursementRequest" FOR EACH ROW EXECUTE FUNCTION company_reimbursement_source_guard();
CREATE TRIGGER "CompanyReimbursementRequest_history" BEFORE UPDATE OR DELETE ON "CompanyReimbursementRequest" FOR EACH ROW EXECUTE FUNCTION company_reimbursement_record_guard();
CREATE TRIGGER "CompanyPaymentAcknowledgement_source" BEFORE INSERT OR UPDATE ON "CompanyPaymentAcknowledgement" FOR EACH ROW EXECUTE FUNCTION company_reimbursement_source_guard();
CREATE TRIGGER "CompanyPaymentAcknowledgement_history" BEFORE UPDATE OR DELETE ON "CompanyPaymentAcknowledgement" FOR EACH ROW EXECUTE FUNCTION company_reimbursement_record_guard();
CREATE TRIGGER "CompanyAcknowledgementCorrection_source" BEFORE INSERT OR UPDATE ON "CompanyAcknowledgementCorrection" FOR EACH ROW EXECUTE FUNCTION company_reimbursement_source_guard();
CREATE TRIGGER "CompanyAcknowledgementCorrection_history" BEFORE UPDATE OR DELETE ON "CompanyAcknowledgementCorrection" FOR EACH ROW EXECUTE FUNCTION company_reimbursement_record_guard();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.financial-workflow','company.financial-workflow-version','company.financial-approval','company.reimbursement-request','company.payment-acknowledgement','company.acknowledgement-correction','company.expense','company.budget','company.commitment','company.finance-category','company.finance-reference','company.expense-version','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry'));
COMMIT;
