BEGIN;
-- M031: ADR0036. Additive Company finance, independent Project links, private receipts.
CREATE TABLE "CompanyExpenseCategory" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "title" VARCHAR(300) NOT NULL,
 "archived" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyExpenseCategory_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyFinanceProjectReference" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyFinanceProjectReference_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyProjectFinanceLink" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "companySpaceId" UUID NOT NULL,
 "companyScopeId" UUID NOT NULL,
 "referenceId" UUID NOT NULL,
 "projectId" UUID NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyProjectFinanceLink_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyProjectFinanceLink_u1" UNIQUE ("companySpaceId","companyScopeId","referenceId")
);
CREATE TABLE "CompanyBudget" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "title" VARCHAR(300) NOT NULL,
 "currency" VARCHAR(3) NOT NULL,
 "scale" INTEGER NOT NULL,
 "limit" DECIMAL(28,4) NOT NULL,
 "startDate" DATE NOT NULL,
 "endDate" DATE NOT NULL,
 "timezone" VARCHAR(100) NOT NULL,
 "projectReferenceId" UUID,
 "archived" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyBudget_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyBudget_u1" UNIQUE ("spaceId","id")
);
CREATE TABLE "CompanyBudgetAdjustment" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "budgetId" UUID NOT NULL,
 "amount" DECIMAL(28,4) NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyBudgetAdjustment_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyCommitment" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "budgetId" UUID NOT NULL,
 "amount" DECIMAL(28,4) NOT NULL,
 "state" VARCHAR(8) NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyCommitment_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyCommitment_u1" UNIQUE ("spaceId","budgetId","id")
);
CREATE TABLE "CompanyExpense" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "effectiveVersionId" UUID,
 "state" VARCHAR(8) NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyExpense_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyExpenseVersion" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "expenseId" UUID NOT NULL,
 "number" INTEGER NOT NULL,
 "kind" VARCHAR(10) NOT NULL,
 "state" VARCHAR(10) NOT NULL,
 "requesterAccessId" UUID NOT NULL,
 "requesterGeneration" INTEGER NOT NULL,
 "reviewerAccessId" UUID,
 "reviewerGeneration" INTEGER,
 "payerAccessId" UUID,
 "payerGeneration" INTEGER,
 "currency" VARCHAR(3) NOT NULL,
 "scale" INTEGER NOT NULL,
 "amount" DECIMAL(28,4) NOT NULL,
 "categoryId" UUID NOT NULL,
 "occurredDate" DATE NOT NULL,
 "timezone" VARCHAR(100) NOT NULL,
 "vendor" VARCHAR(300),
 "projectReferenceId" UUID,
 "submittedAt" TIMESTAMPTZ(3),
 "decidedAt" TIMESTAMPTZ(3),
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyExpenseVersion_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyExpenseVersion_u1" UNIQUE ("spaceId","scopeId","expenseId","number")
);
CREATE TABLE "CompanyExpenseAllocation" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "versionId" UUID NOT NULL,
 "budgetId" UUID NOT NULL,
 "commitmentId" UUID,
 "amount" DECIMAL(28,4) NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyExpenseAllocation_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyBudgetEffect" (
 "reversalOfId" UUID,
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "budgetId" UUID NOT NULL,
 "commitmentId" UUID,
 "versionId" UUID,
 "spent" DECIMAL(28,4) NOT NULL,
 "reserved" DECIMAL(28,4) NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyBudgetEffect_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyExpenseReviewEvent" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "versionId" UUID NOT NULL,
 "reviewerAccessId" UUID,
 "reviewerGeneration" INTEGER,
 "action" VARCHAR(12) NOT NULL,
 "createdByActorId" UUID NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyExpenseReviewEvent_u0" UNIQUE ("spaceId","scopeId","id")
);
CREATE TABLE "CompanyExpenseReceipt" (
 "id" UUID PRIMARY KEY NOT NULL,
 "spaceId" UUID NOT NULL,
 "scopeId" UUID NOT NULL,
 "versionId" UUID NOT NULL,
 "fileId" UUID NOT NULL,
 "pinnedRevision" INTEGER,
 "pinnedHash" VARCHAR(64),
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyExpenseReceipt_u0" UNIQUE ("spaceId","scopeId","id"),
 CONSTRAINT "CompanyExpenseReceipt_u1" UNIQUE ("spaceId","scopeId","fileId")
);
ALTER TABLE "CompanyExpenseCategory" ADD CONSTRAINT "CompanyExpenseCategory_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseCategory" ADD CONSTRAINT "CompanyExpenseCategory_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyFinanceProjectReference" ADD CONSTRAINT "CompanyFinanceProjectReference_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyFinanceProjectReference" ADD CONSTRAINT "CompanyFinanceProjectReference_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyFinanceProjectReference" ADD CONSTRAINT "CompanyFinanceProjectReference_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyProjectFinanceLink" ADD CONSTRAINT "CompanyProjectFinanceLink_source" FOREIGN KEY ("spaceId","scopeId","projectId") REFERENCES "Project" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyProjectFinanceLink" ADD CONSTRAINT "CompanyProjectFinanceLink_anchor" FOREIGN KEY ("companySpaceId","companyScopeId","referenceId") REFERENCES "CompanyFinanceProjectReference" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyProjectFinanceLink" ADD CONSTRAINT "CompanyProjectFinanceLink_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudget" ADD CONSTRAINT "CompanyBudget_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudget" ADD CONSTRAINT "CompanyBudget_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetAdjustment" ADD CONSTRAINT "CompanyBudgetAdjustment_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetAdjustment" ADD CONSTRAINT "CompanyBudgetAdjustment_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetAdjustment" ADD CONSTRAINT "CompanyBudgetAdjustment_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyCommitment" ADD CONSTRAINT "CompanyCommitment_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyCommitment" ADD CONSTRAINT "CompanyCommitment_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyCommitment" ADD CONSTRAINT "CompanyCommitment_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpense" ADD CONSTRAINT "CompanyExpense_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpense" ADD CONSTRAINT "CompanyExpense_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_requester" FOREIGN KEY ("spaceId","scopeId","requesterAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_requesterInterval" FOREIGN KEY ("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_reviewer" FOREIGN KEY ("spaceId","scopeId","reviewerAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_reviewerInterval" FOREIGN KEY ("reviewerAccessId","reviewerGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_payer" FOREIGN KEY ("spaceId","scopeId","payerAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_payerInterval" FOREIGN KEY ("payerAccessId","payerGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseAllocation" ADD CONSTRAINT "CompanyExpenseAllocation_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseAllocation" ADD CONSTRAINT "CompanyExpenseAllocation_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReviewEvent" ADD CONSTRAINT "CompanyExpenseReviewEvent_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReviewEvent" ADD CONSTRAINT "CompanyExpenseReviewEvent_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReviewEvent" ADD CONSTRAINT "CompanyExpenseReviewEvent_creator" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReviewEvent" ADD CONSTRAINT "CompanyExpenseReviewEvent_reviewer" FOREIGN KEY ("spaceId","scopeId","reviewerAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReviewEvent" ADD CONSTRAINT "CompanyExpenseReviewEvent_reviewerInterval" FOREIGN KEY ("reviewerAccessId","reviewerGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReceipt" ADD CONSTRAINT "CompanyExpenseReceipt_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReceipt" ADD CONSTRAINT "CompanyExpenseReceipt_context" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_expense" FOREIGN KEY ("spaceId","scopeId","expenseId") REFERENCES "CompanyExpense" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpense" ADD CONSTRAINT "CompanyExpense_effective" FOREIGN KEY ("spaceId","scopeId","effectiveVersionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudget" ADD CONSTRAINT "CompanyBudget_project" FOREIGN KEY ("spaceId","scopeId","projectReferenceId") REFERENCES "CompanyFinanceProjectReference" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_project" FOREIGN KEY ("spaceId","scopeId","projectReferenceId") REFERENCES "CompanyFinanceProjectReference" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_category" FOREIGN KEY ("spaceId","scopeId","categoryId") REFERENCES "CompanyExpenseCategory" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetAdjustment" ADD CONSTRAINT "CompanyBudgetAdjustment_budget" FOREIGN KEY ("spaceId","budgetId") REFERENCES "CompanyBudget" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyCommitment" ADD CONSTRAINT "CompanyCommitment_budget" FOREIGN KEY ("spaceId","budgetId") REFERENCES "CompanyBudget" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseAllocation" ADD CONSTRAINT "CompanyExpenseAllocation_budget" FOREIGN KEY ("spaceId","budgetId") REFERENCES "CompanyBudget" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_budget" FOREIGN KEY ("spaceId","budgetId") REFERENCES "CompanyBudget" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseAllocation" ADD CONSTRAINT "CompanyExpenseAllocation_commitment" FOREIGN KEY ("spaceId","budgetId","commitmentId") REFERENCES "CompanyCommitment" ("spaceId","budgetId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_commitment" FOREIGN KEY ("spaceId","budgetId","commitmentId") REFERENCES "CompanyCommitment" ("spaceId","budgetId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseAllocation" ADD CONSTRAINT "CompanyExpenseAllocation_version" FOREIGN KEY ("spaceId","scopeId","versionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_version" FOREIGN KEY ("spaceId","scopeId","versionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReviewEvent" ADD CONSTRAINT "CompanyExpenseReviewEvent_version" FOREIGN KEY ("spaceId","scopeId","versionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReceipt" ADD CONSTRAINT "CompanyExpenseReceipt_version" FOREIGN KEY ("spaceId","scopeId","versionId") REFERENCES "CompanyExpenseVersion" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyExpenseReceipt" ADD CONSTRAINT "CompanyExpenseReceipt_file" FOREIGN KEY ("spaceId","scopeId","fileId") REFERENCES "StoredFile" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_reversal" FOREIGN KEY ("spaceId","scopeId","reversalOfId") REFERENCES "CompanyBudgetEffect"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "CompanyExpenseCategory" ADD CONSTRAINT "CompanyExpenseCategory_facts" CHECK (revision>0);
ALTER TABLE "CompanyFinanceProjectReference" ADD CONSTRAINT "CompanyFinanceProjectReference_facts" CHECK (revision>0);
ALTER TABLE "CompanyProjectFinanceLink" ADD CONSTRAINT "CompanyProjectFinanceLink_facts" CHECK (revision>0);
ALTER TABLE "CompanyBudget" ADD CONSTRAINT "CompanyBudget_facts" CHECK (revision>0);
ALTER TABLE "CompanyBudgetAdjustment" ADD CONSTRAINT "CompanyBudgetAdjustment_facts" CHECK (revision>0);
ALTER TABLE "CompanyCommitment" ADD CONSTRAINT "CompanyCommitment_facts" CHECK (revision>0);
ALTER TABLE "CompanyExpense" ADD CONSTRAINT "CompanyExpense_facts" CHECK (revision>0);
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_facts" CHECK (revision>0);
ALTER TABLE "CompanyExpenseAllocation" ADD CONSTRAINT "CompanyExpenseAllocation_facts" CHECK (revision>0);
ALTER TABLE "CompanyBudgetEffect" ADD CONSTRAINT "CompanyBudgetEffect_facts" CHECK (revision>0);
ALTER TABLE "CompanyExpenseReviewEvent" ADD CONSTRAINT "CompanyExpenseReviewEvent_facts" CHECK (revision>0);
ALTER TABLE "CompanyExpenseReceipt" ADD CONSTRAINT "CompanyExpenseReceipt_facts" CHECK (revision>0);
ALTER TABLE "CompanyBudget" ADD CONSTRAINT "CompanyBudget_period" CHECK ("startDate"<"endDate" AND "limit">0 AND "limit"<1000000000000000000 AND scale BETWEEN 0 AND 4 AND "limit"=trunc("limit",scale));
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_shape" CHECK (number>0 AND kind IN ('ORIGINAL','CORRECTION','REVERSAL') AND state IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELED') AND amount>0 AND amount<1000000000000000000 AND scale BETWEEN 0 AND 4 AND amount=trunc(amount,scale) AND ("payerAccessId" IS NULL)=("payerGeneration" IS NULL) AND ("reviewerAccessId" IS NULL)=("reviewerGeneration" IS NULL) AND ("reviewerAccessId" IS NULL OR ("reviewerAccessId"<>"requesterAccessId" AND "reviewerAccessId" IS DISTINCT FROM "payerAccessId")) AND (state IN ('DRAFT','CANCELED') OR ("submittedAt" IS NOT NULL AND "reviewerAccessId" IS NOT NULL)));
ALTER TABLE "CompanyExpense" ADD CONSTRAINT "CompanyExpense_state" CHECK (state IN ('PENDING','APPROVED','REVERSED') AND (state='PENDING')=("effectiveVersionId" IS NULL));
ALTER TABLE "CompanyCommitment" ADD CONSTRAINT "CompanyCommitment_shape" CHECK (amount>0 AND amount<1000000000000000000 AND state IN ('ACTIVE','RELEASED'));
ALTER TABLE "CompanyExpenseAllocation" ADD CONSTRAINT "CompanyExpenseAllocation_positive" CHECK (amount>0 AND amount<1000000000000000000);
ALTER TABLE "CompanyExpenseReceipt" ADD CONSTRAINT "CompanyExpenseReceipt_pin" CHECK (("pinnedRevision" IS NULL)=("pinnedHash" IS NULL) AND ("pinnedHash" IS NULL OR "pinnedHash" ~ '^[a-f0-9]{64}$'));
CREATE UNIQUE INDEX "CompanyExpense_one_pending" ON "CompanyExpenseVersion"("spaceId","scopeId","expenseId") WHERE state IN ('DRAFT','SUBMITTED');
CREATE UNIQUE INDEX "CompanyBudgetEffect_one_reversal" ON "CompanyBudgetEffect"("reversalOfId") WHERE "reversalOfId" IS NOT NULL;
CREATE FUNCTION company_finance_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable finance history' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyExpenseVersion' THEN
  IF OLD.state IN ('APPROVED','REJECTED','CANCELED') OR (OLD.state='SUBMITTED' AND (to_jsonb(NEW)-ARRAY['state','revision','updatedAt','reviewerAccessId','reviewerGeneration','decidedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','updatedAt','reviewerAccessId','reviewerGeneration','decidedAt'])) THEN RAISE EXCEPTION 'immutable expense facts' USING ERRCODE='23514'; END IF;
  IF OLD.state='SUBMITTED' AND NEW.state NOT IN ('SUBMITTED','APPROVED','REJECTED','CANCELED') THEN RAISE EXCEPTION 'invalid expense transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='CompanyCommitment' THEN
  IF (to_jsonb(NEW)-ARRAY['state','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','updatedAt']) OR OLD.state='RELEASED' THEN RAISE EXCEPTION 'immutable commitment' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'immutable financial ledger' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyExpenseVersion_immutable" BEFORE UPDATE OR DELETE ON "CompanyExpenseVersion" FOR EACH ROW EXECUTE FUNCTION company_finance_immutable();
CREATE TRIGGER "CompanyCommitment_immutable" BEFORE UPDATE OR DELETE ON "CompanyCommitment" FOR EACH ROW EXECUTE FUNCTION company_finance_immutable();
CREATE TRIGGER "CompanyBudgetAdjustment_immutable" BEFORE UPDATE OR DELETE ON "CompanyBudgetAdjustment" FOR EACH ROW EXECUTE FUNCTION company_finance_immutable();
CREATE TRIGGER "CompanyBudgetEffect_immutable" BEFORE UPDATE OR DELETE ON "CompanyBudgetEffect" FOR EACH ROW EXECUTE FUNCTION company_finance_immutable();
CREATE TRIGGER "CompanyExpenseReviewEvent_immutable" BEFORE UPDATE OR DELETE ON "CompanyExpenseReviewEvent" FOR EACH ROW EXECUTE FUNCTION company_finance_immutable();
CREATE FUNCTION company_finance_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE parent "CompanyExpenseVersion"; binding uuid;
BEGIN
 IF TG_OP='DELETE' THEN SELECT * INTO parent FROM "CompanyExpenseVersion" WHERE id=OLD."versionId"; ELSE SELECT * INTO parent FROM "CompanyExpenseVersion" WHERE id=NEW."versionId"; END IF;
 IF parent.state<>'DRAFT' THEN RAISE EXCEPTION 'submitted expense evidence is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyExpenseReceipt' AND TG_OP='UPDATE' THEN IF OLD."pinnedRevision" IS NOT NULL THEN RAISE EXCEPTION 'pinned receipt' USING ERRCODE='23514'; END IF; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyExpenseAllocation_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyExpenseAllocation" FOR EACH ROW EXECUTE FUNCTION company_finance_evidence();
CREATE TRIGGER "CompanyExpenseReceipt_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyExpenseReceipt" FOR EACH ROW EXECUTE FUNCTION company_finance_evidence();
CREATE FUNCTION company_finance_balance() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE b "CompanyBudget"; lim numeric; spent numeric; reserved numeric; balance numeric;
BEGIN
 SELECT * INTO b FROM "CompanyBudget" WHERE id=NEW."budgetId" FOR UPDATE;
 IF TG_TABLE_NAME='CompanyBudgetAdjustment' THEN IF NEW.amount<>trunc(NEW.amount,b.scale) THEN RAISE EXCEPTION 'invalid money precision' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME='CompanyBudgetEffect' THEN IF NEW.spent<>trunc(NEW.spent,b.scale) OR NEW.reserved<>trunc(NEW.reserved,b.scale) THEN RAISE EXCEPTION 'invalid money precision' USING ERRCODE='23514'; END IF; END IF;
 SELECT b."limit"+COALESCE(sum(amount),0) INTO lim FROM "CompanyBudgetAdjustment" WHERE "budgetId"=b.id;
 SELECT COALESCE(sum(e.spent),0),COALESCE(sum(e.reserved),0) INTO spent,reserved FROM "CompanyBudgetEffect" e WHERE "budgetId"=b.id;
 IF lim<spent+reserved OR lim<0 OR lim>=1000000000000000000 OR spent<0 OR reserved<0 THEN RAISE EXCEPTION 'budget ceiling' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyBudgetEffect' THEN IF NEW."commitmentId" IS NOT NULL THEN
  SELECT COALESCE(sum(e.reserved),0) INTO balance FROM "CompanyBudgetEffect" e WHERE "commitmentId"=NEW."commitmentId";
  IF balance<0 OR balance>(SELECT amount FROM "CompanyCommitment" WHERE id=NEW."commitmentId") THEN RAISE EXCEPTION 'commitment balance' USING ERRCODE='23514'; END IF;
 END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyBudgetEffect_balance" AFTER INSERT ON "CompanyBudgetEffect" FOR EACH ROW EXECUTE FUNCTION company_finance_balance();
CREATE TRIGGER "CompanyBudgetAdjustment_balance" AFTER INSERT ON "CompanyBudgetAdjustment" FOR EACH ROW EXECUTE FUNCTION company_finance_balance();
CREATE FUNCTION company_finance_budget_identity() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
 IF ROW(NEW."spaceId",NEW."scopeId",NEW.currency,NEW.scale,NEW."limit",NEW."startDate",NEW."endDate",NEW.timezone,NEW."projectReferenceId") IS DISTINCT FROM ROW(OLD."spaceId",OLD."scopeId",OLD.currency,OLD.scale,OLD."limit",OLD."startDate",OLD."endDate",OLD.timezone,OLD."projectReferenceId") THEN RAISE EXCEPTION 'immutable budget definition' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER "CompanyBudget_immutable" BEFORE UPDATE ON "CompanyBudget" FOR EACH ROW EXECUTE FUNCTION company_finance_budget_identity();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.expense','company.budget','company.commitment','company.finance-category','company.finance-reference','company.expense-version','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry'));
ALTER TABLE "CompanyBudget" ADD CONSTRAINT "CompanyBudget_currency_scale" CHECK (scale=(CASE currency WHEN 'AED' THEN 2 WHEN 'AFN' THEN 2 WHEN 'ALL' THEN 2 WHEN 'AMD' THEN 2 WHEN 'AOA' THEN 2 WHEN 'ARS' THEN 2 WHEN 'AUD' THEN 2 WHEN 'AWG' THEN 2 WHEN 'AZN' THEN 2 WHEN 'BAM' THEN 2 WHEN 'BBD' THEN 2 WHEN 'BDT' THEN 2 WHEN 'BHD' THEN 3 WHEN 'BIF' THEN 0 WHEN 'BMD' THEN 2 WHEN 'BND' THEN 2 WHEN 'BOB' THEN 2 WHEN 'BOV' THEN 2 WHEN 'BRL' THEN 2 WHEN 'BSD' THEN 2 WHEN 'BTN' THEN 2 WHEN 'BWP' THEN 2 WHEN 'BYN' THEN 2 WHEN 'BZD' THEN 2 WHEN 'CAD' THEN 2 WHEN 'CDF' THEN 2 WHEN 'CHE' THEN 2 WHEN 'CHF' THEN 2 WHEN 'CHW' THEN 2 WHEN 'CLF' THEN 4 WHEN 'CLP' THEN 0 WHEN 'CNY' THEN 2 WHEN 'COP' THEN 2 WHEN 'COU' THEN 2 WHEN 'CRC' THEN 2 WHEN 'CUP' THEN 2 WHEN 'CVE' THEN 2 WHEN 'CZK' THEN 2 WHEN 'DJF' THEN 0 WHEN 'DKK' THEN 2 WHEN 'DOP' THEN 2 WHEN 'DZD' THEN 2 WHEN 'EGP' THEN 2 WHEN 'ERN' THEN 2 WHEN 'ETB' THEN 2 WHEN 'EUR' THEN 2 WHEN 'FJD' THEN 2 WHEN 'FKP' THEN 2 WHEN 'GBP' THEN 2 WHEN 'GEL' THEN 2 WHEN 'GHS' THEN 2 WHEN 'GIP' THEN 2 WHEN 'GMD' THEN 2 WHEN 'GNF' THEN 0 WHEN 'GTQ' THEN 2 WHEN 'GYD' THEN 2 WHEN 'HKD' THEN 2 WHEN 'HNL' THEN 2 WHEN 'HTG' THEN 2 WHEN 'HUF' THEN 2 WHEN 'IDR' THEN 2 WHEN 'ILS' THEN 2 WHEN 'INR' THEN 2 WHEN 'IQD' THEN 3 WHEN 'IRR' THEN 2 WHEN 'ISK' THEN 0 WHEN 'JMD' THEN 2 WHEN 'JOD' THEN 3 WHEN 'JPY' THEN 0 WHEN 'KES' THEN 2 WHEN 'KGS' THEN 2 WHEN 'KHR' THEN 2 WHEN 'KMF' THEN 0 WHEN 'KPW' THEN 2 WHEN 'KRW' THEN 0 WHEN 'KWD' THEN 3 WHEN 'KYD' THEN 2 WHEN 'KZT' THEN 2 WHEN 'LAK' THEN 2 WHEN 'LBP' THEN 2 WHEN 'LKR' THEN 2 WHEN 'LRD' THEN 2 WHEN 'LSL' THEN 2 WHEN 'LYD' THEN 3 WHEN 'MAD' THEN 2 WHEN 'MDL' THEN 2 WHEN 'MGA' THEN 2 WHEN 'MKD' THEN 2 WHEN 'MMK' THEN 2 WHEN 'MNT' THEN 2 WHEN 'MOP' THEN 2 WHEN 'MRU' THEN 2 WHEN 'MUR' THEN 2 WHEN 'MVR' THEN 2 WHEN 'MWK' THEN 2 WHEN 'MXN' THEN 2 WHEN 'MXV' THEN 2 WHEN 'MYR' THEN 2 WHEN 'MZN' THEN 2 WHEN 'NAD' THEN 2 WHEN 'NGN' THEN 2 WHEN 'NIO' THEN 2 WHEN 'NOK' THEN 2 WHEN 'NPR' THEN 2 WHEN 'NZD' THEN 2 WHEN 'OMR' THEN 3 WHEN 'PAB' THEN 2 WHEN 'PEN' THEN 2 WHEN 'PGK' THEN 2 WHEN 'PHP' THEN 2 WHEN 'PKR' THEN 2 WHEN 'PLN' THEN 2 WHEN 'PYG' THEN 0 WHEN 'QAR' THEN 2 WHEN 'RON' THEN 2 WHEN 'RSD' THEN 2 WHEN 'RUB' THEN 2 WHEN 'RWF' THEN 0 WHEN 'SAR' THEN 2 WHEN 'SBD' THEN 2 WHEN 'SCR' THEN 2 WHEN 'SDG' THEN 2 WHEN 'SEK' THEN 2 WHEN 'SGD' THEN 2 WHEN 'SHP' THEN 2 WHEN 'SLE' THEN 2 WHEN 'SOS' THEN 2 WHEN 'SRD' THEN 2 WHEN 'SSP' THEN 2 WHEN 'STN' THEN 2 WHEN 'SVC' THEN 2 WHEN 'SYP' THEN 2 WHEN 'SZL' THEN 2 WHEN 'THB' THEN 2 WHEN 'TJS' THEN 2 WHEN 'TMT' THEN 2 WHEN 'TND' THEN 3 WHEN 'TOP' THEN 2 WHEN 'TRY' THEN 2 WHEN 'TTD' THEN 2 WHEN 'TWD' THEN 2 WHEN 'TZS' THEN 2 WHEN 'UAH' THEN 2 WHEN 'UGX' THEN 0 WHEN 'USD' THEN 2 WHEN 'USN' THEN 2 WHEN 'UYI' THEN 0 WHEN 'UYU' THEN 2 WHEN 'UYW' THEN 4 WHEN 'UZS' THEN 2 WHEN 'VED' THEN 2 WHEN 'VES' THEN 2 WHEN 'VND' THEN 0 WHEN 'VUV' THEN 0 WHEN 'WST' THEN 2 WHEN 'XAD' THEN 2 WHEN 'XAF' THEN 0 WHEN 'XCD' THEN 2 WHEN 'XCG' THEN 2 WHEN 'XOF' THEN 0 WHEN 'XPF' THEN 0 WHEN 'YER' THEN 2 WHEN 'ZAR' THEN 2 WHEN 'ZMW' THEN 2 WHEN 'ZWG' THEN 2 ELSE -1 END));
ALTER TABLE "CompanyExpenseVersion" ADD CONSTRAINT "CompanyExpenseVersion_currency_scale" CHECK (scale=(CASE currency WHEN 'AED' THEN 2 WHEN 'AFN' THEN 2 WHEN 'ALL' THEN 2 WHEN 'AMD' THEN 2 WHEN 'AOA' THEN 2 WHEN 'ARS' THEN 2 WHEN 'AUD' THEN 2 WHEN 'AWG' THEN 2 WHEN 'AZN' THEN 2 WHEN 'BAM' THEN 2 WHEN 'BBD' THEN 2 WHEN 'BDT' THEN 2 WHEN 'BHD' THEN 3 WHEN 'BIF' THEN 0 WHEN 'BMD' THEN 2 WHEN 'BND' THEN 2 WHEN 'BOB' THEN 2 WHEN 'BOV' THEN 2 WHEN 'BRL' THEN 2 WHEN 'BSD' THEN 2 WHEN 'BTN' THEN 2 WHEN 'BWP' THEN 2 WHEN 'BYN' THEN 2 WHEN 'BZD' THEN 2 WHEN 'CAD' THEN 2 WHEN 'CDF' THEN 2 WHEN 'CHE' THEN 2 WHEN 'CHF' THEN 2 WHEN 'CHW' THEN 2 WHEN 'CLF' THEN 4 WHEN 'CLP' THEN 0 WHEN 'CNY' THEN 2 WHEN 'COP' THEN 2 WHEN 'COU' THEN 2 WHEN 'CRC' THEN 2 WHEN 'CUP' THEN 2 WHEN 'CVE' THEN 2 WHEN 'CZK' THEN 2 WHEN 'DJF' THEN 0 WHEN 'DKK' THEN 2 WHEN 'DOP' THEN 2 WHEN 'DZD' THEN 2 WHEN 'EGP' THEN 2 WHEN 'ERN' THEN 2 WHEN 'ETB' THEN 2 WHEN 'EUR' THEN 2 WHEN 'FJD' THEN 2 WHEN 'FKP' THEN 2 WHEN 'GBP' THEN 2 WHEN 'GEL' THEN 2 WHEN 'GHS' THEN 2 WHEN 'GIP' THEN 2 WHEN 'GMD' THEN 2 WHEN 'GNF' THEN 0 WHEN 'GTQ' THEN 2 WHEN 'GYD' THEN 2 WHEN 'HKD' THEN 2 WHEN 'HNL' THEN 2 WHEN 'HTG' THEN 2 WHEN 'HUF' THEN 2 WHEN 'IDR' THEN 2 WHEN 'ILS' THEN 2 WHEN 'INR' THEN 2 WHEN 'IQD' THEN 3 WHEN 'IRR' THEN 2 WHEN 'ISK' THEN 0 WHEN 'JMD' THEN 2 WHEN 'JOD' THEN 3 WHEN 'JPY' THEN 0 WHEN 'KES' THEN 2 WHEN 'KGS' THEN 2 WHEN 'KHR' THEN 2 WHEN 'KMF' THEN 0 WHEN 'KPW' THEN 2 WHEN 'KRW' THEN 0 WHEN 'KWD' THEN 3 WHEN 'KYD' THEN 2 WHEN 'KZT' THEN 2 WHEN 'LAK' THEN 2 WHEN 'LBP' THEN 2 WHEN 'LKR' THEN 2 WHEN 'LRD' THEN 2 WHEN 'LSL' THEN 2 WHEN 'LYD' THEN 3 WHEN 'MAD' THEN 2 WHEN 'MDL' THEN 2 WHEN 'MGA' THEN 2 WHEN 'MKD' THEN 2 WHEN 'MMK' THEN 2 WHEN 'MNT' THEN 2 WHEN 'MOP' THEN 2 WHEN 'MRU' THEN 2 WHEN 'MUR' THEN 2 WHEN 'MVR' THEN 2 WHEN 'MWK' THEN 2 WHEN 'MXN' THEN 2 WHEN 'MXV' THEN 2 WHEN 'MYR' THEN 2 WHEN 'MZN' THEN 2 WHEN 'NAD' THEN 2 WHEN 'NGN' THEN 2 WHEN 'NIO' THEN 2 WHEN 'NOK' THEN 2 WHEN 'NPR' THEN 2 WHEN 'NZD' THEN 2 WHEN 'OMR' THEN 3 WHEN 'PAB' THEN 2 WHEN 'PEN' THEN 2 WHEN 'PGK' THEN 2 WHEN 'PHP' THEN 2 WHEN 'PKR' THEN 2 WHEN 'PLN' THEN 2 WHEN 'PYG' THEN 0 WHEN 'QAR' THEN 2 WHEN 'RON' THEN 2 WHEN 'RSD' THEN 2 WHEN 'RUB' THEN 2 WHEN 'RWF' THEN 0 WHEN 'SAR' THEN 2 WHEN 'SBD' THEN 2 WHEN 'SCR' THEN 2 WHEN 'SDG' THEN 2 WHEN 'SEK' THEN 2 WHEN 'SGD' THEN 2 WHEN 'SHP' THEN 2 WHEN 'SLE' THEN 2 WHEN 'SOS' THEN 2 WHEN 'SRD' THEN 2 WHEN 'SSP' THEN 2 WHEN 'STN' THEN 2 WHEN 'SVC' THEN 2 WHEN 'SYP' THEN 2 WHEN 'SZL' THEN 2 WHEN 'THB' THEN 2 WHEN 'TJS' THEN 2 WHEN 'TMT' THEN 2 WHEN 'TND' THEN 3 WHEN 'TOP' THEN 2 WHEN 'TRY' THEN 2 WHEN 'TTD' THEN 2 WHEN 'TWD' THEN 2 WHEN 'TZS' THEN 2 WHEN 'UAH' THEN 2 WHEN 'UGX' THEN 0 WHEN 'USD' THEN 2 WHEN 'USN' THEN 2 WHEN 'UYI' THEN 0 WHEN 'UYU' THEN 2 WHEN 'UYW' THEN 4 WHEN 'UZS' THEN 2 WHEN 'VED' THEN 2 WHEN 'VES' THEN 2 WHEN 'VND' THEN 0 WHEN 'VUV' THEN 0 WHEN 'WST' THEN 2 WHEN 'XAD' THEN 2 WHEN 'XAF' THEN 0 WHEN 'XCD' THEN 2 WHEN 'XCG' THEN 2 WHEN 'XOF' THEN 0 WHEN 'XPF' THEN 0 WHEN 'YER' THEN 2 WHEN 'ZAR' THEN 2 WHEN 'ZMW' THEN 2 WHEN 'ZWG' THEN 2 ELSE -1 END));
CREATE FUNCTION company_finance_identity() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF ROW(NEW.id,NEW."spaceId",NEW."scopeId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."spaceId",OLD."scopeId",OLD."createdAt") OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable finance identity or stale revision' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyExpenseVersion' THEN
  IF ROW(NEW."expenseId",NEW.number,NEW.kind,NEW."requesterAccessId",NEW."requesterGeneration") IS DISTINCT FROM ROW(OLD."expenseId",OLD.number,OLD.kind,OLD."requesterAccessId",OLD."requesterGeneration") THEN RAISE EXCEPTION 'immutable requester or revision identity' USING ERRCODE='23514'; END IF;
  IF OLD.state='DRAFT' AND NEW.state NOT IN ('DRAFT','SUBMITTED','CANCELED') THEN RAISE EXCEPTION 'submission required' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='CompanyExpense' THEN IF NEW."effectiveVersionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CompanyExpenseVersion" v WHERE v.id=NEW."effectiveVersionId" AND v."expenseId"=NEW.id AND v.state='APPROVED') THEN RAISE EXCEPTION 'invalid effective revision' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyExpenseCategory_identity" BEFORE UPDATE ON "CompanyExpenseCategory" FOR EACH ROW EXECUTE FUNCTION company_finance_identity();
CREATE TRIGGER "CompanyBudget_identity" BEFORE UPDATE ON "CompanyBudget" FOR EACH ROW EXECUTE FUNCTION company_finance_identity();
CREATE TRIGGER "CompanyCommitment_identity" BEFORE UPDATE ON "CompanyCommitment" FOR EACH ROW EXECUTE FUNCTION company_finance_identity();
CREATE TRIGGER "CompanyExpense_identity" BEFORE UPDATE ON "CompanyExpense" FOR EACH ROW EXECUTE FUNCTION company_finance_identity();
CREATE TRIGGER "CompanyExpenseVersion_identity" BEFORE UPDATE ON "CompanyExpenseVersion" FOR EACH ROW EXECUTE FUNCTION company_finance_identity();
CREATE TRIGGER "CompanyExpenseReceipt_identity" BEFORE UPDATE ON "CompanyExpenseReceipt" FOR EACH ROW EXECUTE FUNCTION company_finance_identity();
CREATE FUNCTION company_finance_allocation_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v "CompanyExpenseVersion"; b "CompanyBudget";
BEGIN
 SELECT * INTO v FROM "CompanyExpenseVersion" WHERE id=NEW."versionId";
 SELECT * INTO b FROM "CompanyBudget" WHERE id=NEW."budgetId";
 IF v.currency<>b.currency OR v.scale<>b.scale OR NEW.amount<>trunc(NEW.amount,v.scale) OR v."occurredDate"<b."startDate" OR v."occurredDate">=b."endDate" OR v.timezone<>b.timezone THEN RAISE EXCEPTION 'invalid allocation currency precision or period' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyExpenseAllocation_shape" BEFORE INSERT OR UPDATE ON "CompanyExpenseAllocation" FOR EACH ROW EXECUTE FUNCTION company_finance_allocation_shape();
CREATE INDEX "CompanyBudgetAdjustment_budgetId_lookup" ON "CompanyBudgetAdjustment"("budgetId",id);
CREATE INDEX "CompanyCommitment_budgetId_lookup" ON "CompanyCommitment"("budgetId",id);
CREATE INDEX "CompanyExpenseAllocation_versionId_lookup" ON "CompanyExpenseAllocation"("versionId",id);
CREATE INDEX "CompanyBudgetEffect_budgetId_lookup" ON "CompanyBudgetEffect"("budgetId",id);
CREATE INDEX "CompanyBudgetEffect_commitmentId_lookup" ON "CompanyBudgetEffect"("commitmentId",id);
CREATE INDEX "CompanyBudgetEffect_versionId_lookup" ON "CompanyBudgetEffect"("versionId",id);
CREATE INDEX "CompanyExpenseReceipt_versionId_lookup" ON "CompanyExpenseReceipt"("versionId",id);
COMMIT;
