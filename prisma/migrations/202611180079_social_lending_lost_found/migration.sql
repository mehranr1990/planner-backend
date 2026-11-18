BEGIN;
-- P6-04 (V3 01/02/03, FR-12, AUD-07): additive Social lending and Lost & Found tables.
-- No existing table, constraint, row or historical migration is changed.
-- Custody is confirmed only with the borrower's acknowledgement (handover CHECK below).
-- Loans, claims, history and evidence are never disposed here: no retention rule is approved.
CREATE TABLE "SocialAsset" (
  "id" uuid NOT NULL,
  "ownerUserId" uuid,
  "audience" varchar(12) NOT NULL,
  "groupId" uuid,
  "title" varchar(200) NOT NULL,
  "description" varchar(2000),
  "state" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "orphanedAt" timestamptz(3),
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialAsset_audience_check" CHECK ("audience" IN ('PRIVATE','CONNECTIONS','GROUP') AND ("groupId" IS NULL OR "audience" = 'GROUP')),
  CONSTRAINT "SocialAsset_state_check" CHECK ("state" IN ('ACTIVE','ARCHIVED') AND "revision" > 0)
);
CREATE TABLE "SocialLoan" (
  "id" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "lenderUserId" uuid,
  "borrowerUserId" uuid,
  "origin" varchar(8) NOT NULL,
  "state" varchar(16) NOT NULL,
  "dueAt" timestamptz(3),
  "note" varchar(2000),
  "lenderHandoverAt" timestamptz(3),
  "borrowerReceiptAt" timestamptz(3),
  "handedOverAt" timestamptz(3),
  "returnRequestedAt" timestamptz(3),
  "returnedAt" timestamptz(3),
  "closedAt" timestamptz(3),
  "pendingOutcome" varchar(8),
  "pendingOutcomeByUserId" uuid,
  "stateBeforeDispute" varchar(16),
  "disputedByUserId" uuid,
  "disputeNote" varchar(2000),
  "orphanedAt" timestamptz(3),
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialLoan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialLoan_origin_check" CHECK ("origin" IN ('REQUEST','OFFER') AND "revision" > 0),
  CONSTRAINT "SocialLoan_parties_check" CHECK ("lenderUserId" IS NULL OR "borrowerUserId" IS NULL OR "lenderUserId" <> "borrowerUserId"),
  CONSTRAINT "SocialLoan_state_check" CHECK ("state" IN ('REQUESTED','OFFERED','ACCEPTED','HANDED_OVER','RETURN_REQUESTED','DISPUTED','RETURNED','LOST','DAMAGED','REJECTED','CANCELED')),
  CONSTRAINT "SocialLoan_custody_check" CHECK (
    ("handedOverAt" IS NULL OR ("lenderHandoverAt" IS NOT NULL AND "borrowerReceiptAt" IS NOT NULL))
    AND ("state" NOT IN ('HANDED_OVER','RETURN_REQUESTED','RETURNED','LOST','DAMAGED') OR "handedOverAt" IS NOT NULL)
    AND (("state" IN ('RETURNED','LOST','DAMAGED','REJECTED','CANCELED')) = ("closedAt" IS NOT NULL))
  ),
  CONSTRAINT "SocialLoan_dispute_check" CHECK (
    (("state" = 'DISPUTED') = ("stateBeforeDispute" IS NOT NULL AND "disputeNote" IS NOT NULL))
    AND ("stateBeforeDispute" IS NULL OR "stateBeforeDispute" IN ('ACCEPTED','HANDED_OVER','RETURN_REQUESTED'))
    AND ("pendingOutcome" IS NULL OR "pendingOutcome" IN ('LOST','DAMAGED'))
  )
);
CREATE TABLE "SocialLostFoundReport" (
  "id" uuid NOT NULL,
  "kind" varchar(5) NOT NULL,
  "reporterUserId" uuid,
  "audience" varchar(12) NOT NULL,
  "groupId" uuid,
  "assetId" uuid,
  "title" varchar(200),
  "description" varchar(2000),
  "occurredOn" date,
  "state" varchar(10) NOT NULL DEFAULT 'OPEN',
  "erasedAt" timestamptz(3),
  "closedAt" timestamptz(3),
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialLostFoundReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialLostFoundReport_shape_check" CHECK ("kind" IN ('LOST','FOUND') AND "audience" IN ('CONNECTIONS','GROUP') AND (("audience" = 'GROUP') = ("groupId" IS NOT NULL)) AND ("assetId" IS NULL OR "kind" = 'LOST') AND "revision" > 0),
  CONSTRAINT "SocialLostFoundReport_state_check" CHECK ("state" IN ('OPEN','RESOLVED','WITHDRAWN','HIDDEN') AND (("state" IN ('RESOLVED','WITHDRAWN')) = ("closedAt" IS NOT NULL))),
  CONSTRAINT "SocialLostFoundReport_erasure_check" CHECK ("title" IS NOT NULL OR "erasedAt" IS NOT NULL)
);
CREATE TABLE "SocialLostFoundClaim" (
  "id" uuid NOT NULL,
  "reportId" uuid NOT NULL,
  "claimantUserId" uuid,
  "linkedReportId" uuid,
  "note" varchar(2000),
  "state" varchar(12) NOT NULL DEFAULT 'PENDING',
  "handoverAt" timestamptz(3),
  "receiptAt" timestamptz(3),
  "resolvedAt" timestamptz(3),
  "stateBeforeDispute" varchar(12),
  "disputedByUserId" uuid,
  "disputeNote" varchar(2000),
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialLostFoundClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialLostFoundClaim_state_check" CHECK ("state" IN ('PENDING','ACKNOWLEDGED','DISPUTED','RESOLVED','REJECTED','WITHDRAWN','SUPERSEDED') AND "revision" > 0),
  CONSTRAINT "SocialLostFoundClaim_resolution_check" CHECK ((("state" = 'RESOLVED') = ("resolvedAt" IS NOT NULL)) AND ("resolvedAt" IS NULL OR ("handoverAt" IS NOT NULL AND "receiptAt" IS NOT NULL))),
  CONSTRAINT "SocialLostFoundClaim_dispute_check" CHECK ((("state" = 'DISPUTED') = ("stateBeforeDispute" IS NOT NULL AND "disputeNote" IS NOT NULL)) AND ("stateBeforeDispute" IS NULL OR "stateBeforeDispute" = 'ACKNOWLEDGED')),
  CONSTRAINT "SocialLostFoundClaim_link_check" CHECK ("linkedReportId" IS NULL OR "linkedReportId" <> "reportId")
);
CREATE TABLE "SocialLendingEvent" (
  "id" uuid NOT NULL,
  "loanId" uuid,
  "reportId" uuid,
  "claimId" uuid,
  "actorUserId" uuid,
  "action" varchar(32) NOT NULL,
  "fromState" varchar(16),
  "toState" varchar(16),
  "note" varchar(2000),
  "occurredAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialLendingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialLendingEvent_context_check" CHECK (num_nonnulls("loanId","reportId") = 1 AND ("claimId" IS NULL OR "reportId" IS NOT NULL))
);
CREATE TABLE "SocialEvidence" (
  "id" uuid NOT NULL,
  "loanId" uuid,
  "reportId" uuid,
  "claimId" uuid,
  "addedByUserId" uuid,
  "kind" varchar(12) NOT NULL,
  "label" varchar(200) NOT NULL,
  "note" varchar(2000),
  "observedAt" timestamptz(3),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialEvidence_context_check" CHECK (num_nonnulls("loanId","reportId","claimId") = 1),
  CONSTRAINT "SocialEvidence_kind_check" CHECK ("kind" IN ('CONDITION','HANDOVER','RETURN','DAMAGE','LOSS','IDENTIFYING','OTHER'))
);
CREATE INDEX "SocialAsset_ownerUserId_id_idx" ON "SocialAsset"("ownerUserId","id");
CREATE INDEX "SocialAsset_groupId_id_idx" ON "SocialAsset"("groupId","id");
CREATE INDEX "SocialLoan_assetId_id_idx" ON "SocialLoan"("assetId","id");
CREATE INDEX "SocialLoan_lenderUserId_id_idx" ON "SocialLoan"("lenderUserId","id");
CREATE INDEX "SocialLoan_borrowerUserId_id_idx" ON "SocialLoan"("borrowerUserId","id");
-- At most one agreed or custody-holding loan per asset.
CREATE UNIQUE INDEX "SocialLoan_open_custody" ON "SocialLoan"("assetId") WHERE "state" IN ('ACCEPTED','HANDED_OVER','RETURN_REQUESTED','DISPUTED');
CREATE INDEX "SocialLostFoundReport_reporterUserId_id_idx" ON "SocialLostFoundReport"("reporterUserId","id");
CREATE INDEX "SocialLostFoundReport_groupId_id_idx" ON "SocialLostFoundReport"("groupId","id");
CREATE INDEX "SocialLostFoundReport_assetId_idx" ON "SocialLostFoundReport"("assetId");
CREATE INDEX "SocialLostFoundClaim_reportId_id_idx" ON "SocialLostFoundClaim"("reportId","id");
CREATE INDEX "SocialLostFoundClaim_claimantUserId_id_idx" ON "SocialLostFoundClaim"("claimantUserId","id");
CREATE INDEX "SocialLostFoundClaim_linkedReportId_idx" ON "SocialLostFoundClaim"("linkedReportId");
-- One acknowledged/disputed/resolved claim per report; one live claim per claimant and report.
CREATE UNIQUE INDEX "SocialLostFoundClaim_agreed" ON "SocialLostFoundClaim"("reportId") WHERE "state" IN ('ACKNOWLEDGED','DISPUTED','RESOLVED');
CREATE UNIQUE INDEX "SocialLostFoundClaim_live" ON "SocialLostFoundClaim"("reportId","claimantUserId") WHERE "state" IN ('PENDING','ACKNOWLEDGED','DISPUTED');
CREATE INDEX "SocialLendingEvent_loanId_id_idx" ON "SocialLendingEvent"("loanId","id");
CREATE INDEX "SocialLendingEvent_reportId_id_idx" ON "SocialLendingEvent"("reportId","id");
CREATE INDEX "SocialEvidence_loanId_id_idx" ON "SocialEvidence"("loanId","id");
CREATE INDEX "SocialEvidence_reportId_id_idx" ON "SocialEvidence"("reportId","id");
CREATE INDEX "SocialEvidence_claimId_id_idx" ON "SocialEvidence"("claimId","id");
-- A purged Social Group detaches personally owned assets; Group Lost & Found posts follow the Group cascade.
ALTER TABLE "SocialAsset" ADD CONSTRAINT "SocialAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialAsset" ADD CONSTRAINT "SocialAsset_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLoan" ADD CONSTRAINT "SocialLoan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SocialAsset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SocialLoan" ADD CONSTRAINT "SocialLoan_lenderUserId_fkey" FOREIGN KEY ("lenderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLoan" ADD CONSTRAINT "SocialLoan_borrowerUserId_fkey" FOREIGN KEY ("borrowerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLoan" ADD CONSTRAINT "SocialLoan_pendingOutcomeByUserId_fkey" FOREIGN KEY ("pendingOutcomeByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLoan" ADD CONSTRAINT "SocialLoan_disputedByUserId_fkey" FOREIGN KEY ("disputedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLostFoundReport" ADD CONSTRAINT "SocialLostFoundReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLostFoundReport" ADD CONSTRAINT "SocialLostFoundReport_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialLostFoundReport" ADD CONSTRAINT "SocialLostFoundReport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SocialAsset"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLostFoundClaim" ADD CONSTRAINT "SocialLostFoundClaim_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SocialLostFoundReport"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialLostFoundClaim" ADD CONSTRAINT "SocialLostFoundClaim_linkedReportId_fkey" FOREIGN KEY ("linkedReportId") REFERENCES "SocialLostFoundReport"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLostFoundClaim" ADD CONSTRAINT "SocialLostFoundClaim_claimantUserId_fkey" FOREIGN KEY ("claimantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLostFoundClaim" ADD CONSTRAINT "SocialLostFoundClaim_disputedByUserId_fkey" FOREIGN KEY ("disputedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialLendingEvent" ADD CONSTRAINT "SocialLendingEvent_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "SocialLoan"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialLendingEvent" ADD CONSTRAINT "SocialLendingEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SocialLostFoundReport"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialLendingEvent" ADD CONSTRAINT "SocialLendingEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "SocialLostFoundClaim"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialLendingEvent" ADD CONSTRAINT "SocialLendingEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialEvidence" ADD CONSTRAINT "SocialEvidence_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "SocialLoan"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialEvidence" ADD CONSTRAINT "SocialEvidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SocialLostFoundReport"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialEvidence" ADD CONSTRAINT "SocialEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "SocialLostFoundClaim"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialEvidence" ADD CONSTRAINT "SocialEvidence_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
COMMIT;
