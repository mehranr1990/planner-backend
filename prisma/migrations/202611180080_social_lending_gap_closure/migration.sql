BEGIN;
-- P6-04 gap closure (ADR 0064 decisions B and D). Additive columns, foreign keys and indexes,
-- plus two reviewed CHECK replacements on "SocialNotice" (exactly one typed context; new kinds).
-- No existing row becomes invalid: every new column is nullable, and every existing notice keeps
-- exactly one of activityId/groupId and an already-permitted kind.
ALTER TABLE "SocialLoan" ADD COLUMN "proposedDueAt" timestamptz(3);
ALTER TABLE "SocialLoan" ADD COLUMN "dueProposedByUserId" uuid;
ALTER TABLE "SocialLoan" ADD COLUMN "dueProposedAt" timestamptz(3);
ALTER TABLE "SocialLoan" ADD CONSTRAINT "SocialLoan_due_proposal_check" CHECK ((("proposedDueAt" IS NULL) = ("dueProposedAt" IS NULL)) AND ("dueProposedByUserId" IS NULL OR "proposedDueAt" IS NOT NULL));
ALTER TABLE "SocialLoan" ADD CONSTRAINT "SocialLoan_dueProposedByUserId_fkey" FOREIGN KEY ("dueProposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialNotice" ADD COLUMN "loanId" uuid;
ALTER TABLE "SocialNotice" ADD COLUMN "lostFoundReportId" uuid;
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "SocialLoan"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_lostFoundReportId_fkey" FOREIGN KEY ("lostFoundReportId") REFERENCES "SocialLostFoundReport"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX "SocialNotice_loanId_idx" ON "SocialNotice"("loanId");
CREATE INDEX "SocialNotice_lostFoundReportId_idx" ON "SocialNotice"("lostFoundReportId");
ALTER TABLE "SocialNotice" DROP CONSTRAINT "SocialNotice_context_check";
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_context_check" CHECK (num_nonnulls("activityId","groupId","loanId","lostFoundReportId") = 1);
ALTER TABLE "SocialNotice" DROP CONSTRAINT "SocialNotice_kind_check";
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_kind_check" CHECK ("kind" IN ('ACTIVITY_INVITED','ACTIVITY_UPDATED','ACTIVITY_CANCELED','ACTIVITY_REMOVED','SEAT_OFFERED','ACTIVITY_REMINDER','EXPENSE_PROPOSED','EXPENSE_DECIDED','SETTLEMENT_RECORDED','SETTLEMENT_DECIDED','ORGANIZER_NOMINATED','ACTIVITY_DELETED','LOAN_REQUESTED','LOAN_OFFERED','LOAN_DECIDED','LOAN_HANDOVER','LOAN_RECEIVED','LOAN_RETURN_REQUESTED','LOAN_RETURNED','LOAN_DISPUTED','LOAN_OUTCOME_PROPOSED','LOAN_OUTCOME_CONFIRMED','LOAN_DUE_PROPOSED','LOAN_DUE_DECIDED','CLAIM_SUBMITTED','CLAIM_DECIDED','CLAIM_HANDOVER','CLAIM_RESOLVED','CLAIM_DISPUTED') AND ((("loanId" IS NOT NULL) = ("kind" LIKE 'LOAN\_%')) AND (("lostFoundReportId" IS NOT NULL) = ("kind" LIKE 'CLAIM\_%'))));
COMMIT;
