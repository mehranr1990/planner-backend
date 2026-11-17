BEGIN;
-- ADR 0060-0062 gap closure. Additive columns/tables, plus two reviewed CHECK
-- replacements on tables created by 0077 (state DELETED and two notice kinds).
-- No existing row becomes invalid: new columns are nullable or defaulted.
ALTER TABLE "SocialActivity" ADD COLUMN "conversationManaged" boolean NOT NULL DEFAULT false;
ALTER TABLE "SocialActivity" ADD COLUMN "successorParticipantId" uuid;
ALTER TABLE "SocialActivity" ADD COLUMN "orphanedAt" timestamptz(3);
ALTER TABLE "SocialActivity" ADD COLUMN "stateBeforeDelete" varchar(10);
ALTER TABLE "SocialActivity" ADD COLUMN "deletedAt" timestamptz(3);
ALTER TABLE "SocialActivity" ADD COLUMN "recoverUntil" timestamptz(3);
ALTER TABLE "SocialActivity" ADD COLUMN "contentDisposedAt" timestamptz(3);
ALTER TABLE "SocialActivity" DROP CONSTRAINT "SocialActivity_state_check";
ALTER TABLE "SocialActivity" ADD CONSTRAINT "SocialActivity_state_check" CHECK ("state" IN ('PLANNED','CANCELED','CLOSED','DELETED') AND (("state" = 'DELETED') = ("deletedAt" IS NOT NULL AND "recoverUntil" IS NOT NULL AND "stateBeforeDelete" IN ('PLANNED','CANCELED','CLOSED'))));
ALTER TABLE "SocialActivity" ADD CONSTRAINT "SocialActivity_id_successorParticipantId_fkey" FOREIGN KEY ("id","successorParticipantId") REFERENCES "SocialActivityParticipant"("activityId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "SocialActivityItem" ADD COLUMN "deletedAt" timestamptz(3);
ALTER TABLE "SocialActivityItem" ADD COLUMN "recoverUntil" timestamptz(3);
ALTER TABLE "SocialActivityItem" ADD CONSTRAINT "SocialActivityItem_recovery_check" CHECK (("deletedAt" IS NULL) = ("recoverUntil" IS NULL));
ALTER TABLE "SocialNotice" DROP CONSTRAINT "SocialNotice_kind_check";
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_kind_check" CHECK ("kind" IN ('ACTIVITY_INVITED','ACTIVITY_UPDATED','ACTIVITY_CANCELED','ACTIVITY_REMOVED','SEAT_OFFERED','ACTIVITY_REMINDER','EXPENSE_PROPOSED','EXPENSE_DECIDED','SETTLEMENT_RECORDED','SETTLEMENT_DECIDED','ORGANIZER_NOMINATED','ACTIVITY_DELETED'));
-- ADR 0062: Messaging-owned typed source binding; existing conversations keep NULL sources.
ALTER TABLE "Conversation" ADD COLUMN "sourceKind" varchar(20);
ALTER TABLE "Conversation" ADD COLUMN "sourceId" uuid;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_source_check" CHECK (("sourceKind" IS NULL) = ("sourceId" IS NULL) AND ("sourceKind" IS NULL OR ("sourceKind" = 'SOCIAL_ACTIVITY' AND "kind" = 'PRIVATE_GROUP')));
CREATE UNIQUE INDEX "Conversation_sourceKind_sourceId_key" ON "Conversation"("sourceKind","sourceId");
-- ADR 0061: Finance-owned link proving one explicit posting per external source.
CREATE TABLE "FinanceExternalPosting" (
  "spaceId" uuid NOT NULL,
  "sourceKind" varchar(32) NOT NULL,
  "sourceRef" varchar(128) NOT NULL,
  "sourceRevisionRef" varchar(128),
  "transactionId" uuid NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "FinanceExternalPosting_pkey" PRIMARY KEY ("spaceId","sourceKind","sourceRef"),
  CONSTRAINT "FinanceExternalPosting_kind_check" CHECK ("sourceKind" IN ('SOCIAL_EXPENSE_SHARE'))
);
CREATE UNIQUE INDEX "FinanceExternalPosting_spaceId_transactionId_key" ON "FinanceExternalPosting"("spaceId","transactionId");
ALTER TABLE "FinanceExternalPosting" ADD CONSTRAINT "FinanceExternalPosting_spaceId_transactionId_fkey" FOREIGN KEY ("spaceId","transactionId") REFERENCES "Transaction"("spaceId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
COMMIT;
