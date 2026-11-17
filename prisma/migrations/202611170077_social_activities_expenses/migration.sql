BEGIN;
-- P6-02/P6-03 (ADR 0051, ADR 0060): additive Social Activity and recordkeeping-only expense tables.
-- No existing table, row or historical migration is changed. No money movement is represented.
CREATE TABLE "SocialActivity" (
  "id" uuid NOT NULL,
  "groupId" uuid,
  "template" varchar(12) NOT NULL,
  "title" varchar(200) NOT NULL,
  "description" varchar(4000),
  "location" varchar(500),
  "timezone" varchar(100) NOT NULL,
  "startsAt" timestamptz(3) NOT NULL,
  "endsAt" timestamptz(3) NOT NULL,
  "capacity" integer,
  "state" varchar(10) NOT NULL DEFAULT 'PLANNED',
  "conversationId" uuid,
  "createdByUserId" uuid,
  "creationKeyHash" char(64) NOT NULL,
  "creationFingerprint" char(64) NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialActivity_template_check" CHECK ("template" IN ('GENERAL','TRAVEL','SPORT','FAMILY','GATHERING')),
  CONSTRAINT "SocialActivity_state_check" CHECK ("state" IN ('PLANNED','CANCELED','CLOSED')),
  CONSTRAINT "SocialActivity_schedule_check" CHECK ("endsAt" > "startsAt" AND "endsAt" - "startsAt" <= interval '90 days'),
  CONSTRAINT "SocialActivity_capacity_check" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 1000),
  CONSTRAINT "SocialActivity_revision_check" CHECK ("revision" > 0)
);
CREATE TABLE "SocialActivityParticipant" (
  "id" uuid NOT NULL,
  "activityId" uuid NOT NULL,
  "userId" uuid,
  "role" varchar(12) NOT NULL DEFAULT 'PARTICIPANT',
  "state" varchar(10) NOT NULL,
  "rsvp" varchar(10) NOT NULL DEFAULT 'PENDING',
  "seat" varchar(10) NOT NULL DEFAULT 'NONE',
  "guest" boolean NOT NULL DEFAULT false,
  "waitlistedAt" timestamptz(3),
  "offerExpiresAt" timestamptz(3),
  "reminderMinutes" integer,
  "generation" integer NOT NULL DEFAULT 1,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialActivityParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialActivityParticipant_role_check" CHECK ("role" IN ('ORGANIZER','PARTICIPANT')),
  CONSTRAINT "SocialActivityParticipant_state_check" CHECK ("state" IN ('INVITED','ACTIVE','DECLINED','LEFT','REMOVED')),
  CONSTRAINT "SocialActivityParticipant_rsvp_check" CHECK ("rsvp" IN ('PENDING','GOING','MAYBE','DECLINED')),
  CONSTRAINT "SocialActivityParticipant_seat_check" CHECK ("seat" IN ('NONE','HELD','WAITLISTED','OFFERED')),
  CONSTRAINT "SocialActivityParticipant_seat_shape" CHECK (
    ("seat" = 'NONE' OR "state" = 'ACTIVE')
    AND (("seat" = 'HELD') = ("rsvp" = 'GOING'))
    AND (("seat" = 'OFFERED') = ("offerExpiresAt" IS NOT NULL))
    AND (("seat" IN ('WAITLISTED','OFFERED')) = ("waitlistedAt" IS NOT NULL))
  ),
  CONSTRAINT "SocialActivityParticipant_reminder_check" CHECK ("reminderMinutes" IS NULL OR "reminderMinutes" BETWEEN 5 AND 10080),
  CONSTRAINT "SocialActivityParticipant_counter_check" CHECK ("generation" > 0 AND "revision" > 0)
);
CREATE TABLE "SocialActivityItem" (
  "id" uuid NOT NULL,
  "activityId" uuid NOT NULL,
  "kind" varchar(10) NOT NULL,
  "title" varchar(300) NOT NULL,
  "notes" varchar(2000),
  "location" varchar(500),
  "startsAt" timestamptz(3),
  "endsAt" timestamptz(3),
  "position" integer NOT NULL,
  "done" boolean NOT NULL DEFAULT false,
  "assigneeParticipantId" uuid,
  "createdByParticipantId" uuid NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialActivityItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialActivityItem_kind_check" CHECK ("kind" IN ('ITINERARY','AGENDA','CHECKLIST')),
  CONSTRAINT "SocialActivityItem_shape_check" CHECK (
    ("kind" <> 'ITINERARY' OR "startsAt" IS NOT NULL)
    AND ("endsAt" IS NULL OR ("startsAt" IS NOT NULL AND "endsAt" >= "startsAt"))
    AND ("kind" = 'CHECKLIST' OR ("done" = false AND "assigneeParticipantId" IS NULL))
    AND "position" > 0 AND "revision" > 0
  )
);
CREATE TABLE "SocialActivityTaskLink" (
  "itemId" uuid NOT NULL,
  "activityId" uuid NOT NULL,
  "participantId" uuid NOT NULL,
  "taskSpaceId" uuid NOT NULL,
  "taskId" uuid NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialActivityTaskLink_pkey" PRIMARY KEY ("itemId","participantId")
);
CREATE TABLE "SocialActivityPoll" (
  "id" uuid NOT NULL,
  "activityId" uuid NOT NULL,
  "kind" varchar(10) NOT NULL,
  "question" varchar(300) NOT NULL,
  "multiple" boolean NOT NULL DEFAULT false,
  "state" varchar(8) NOT NULL DEFAULT 'OPEN',
  "chosenOptionId" uuid,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "closedAt" timestamptz(3),
  CONSTRAINT "SocialActivityPoll_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialActivityPoll_kind_check" CHECK ("kind" IN ('GENERAL','SCHEDULE')),
  CONSTRAINT "SocialActivityPoll_state_check" CHECK (("state" = 'OPEN' AND "closedAt" IS NULL AND "chosenOptionId" IS NULL) OR ("state" = 'CLOSED' AND "closedAt" IS NOT NULL))
);
CREATE TABLE "SocialActivityPollOption" (
  "id" uuid NOT NULL,
  "pollId" uuid NOT NULL,
  "position" integer NOT NULL,
  "label" varchar(200) NOT NULL,
  "startsAt" timestamptz(3),
  "endsAt" timestamptz(3),
  CONSTRAINT "SocialActivityPollOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialActivityPollOption_shape_check" CHECK ("position" BETWEEN 1 AND 20 AND ("startsAt" IS NULL) = ("endsAt" IS NULL) AND ("endsAt" IS NULL OR "endsAt" > "startsAt"))
);
CREATE TABLE "SocialActivityPollVote" (
  "activityId" uuid NOT NULL,
  "pollId" uuid NOT NULL,
  "optionId" uuid NOT NULL,
  "participantId" uuid NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialActivityPollVote_pkey" PRIMARY KEY ("optionId","participantId")
);
CREATE TABLE "SocialActivityBusy" (
  "participantId" uuid NOT NULL,
  "activityId" uuid NOT NULL,
  "intervals" jsonb NOT NULL,
  "capturedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialActivityBusy_pkey" PRIMARY KEY ("participantId"),
  CONSTRAINT "SocialActivityBusy_intervals_check" CHECK (jsonb_typeof("intervals") = 'array' AND jsonb_array_length("intervals") <= 1000)
);
CREATE TABLE "SocialNotice" (
  "id" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "activityId" uuid,
  "groupId" uuid,
  "kind" varchar(24) NOT NULL,
  "resourceId" uuid NOT NULL,
  "dedupeKey" varchar(160) NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "readAt" timestamptz(3),
  CONSTRAINT "SocialNotice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialNotice_context_check" CHECK (num_nonnulls("activityId","groupId") = 1),
  CONSTRAINT "SocialNotice_kind_check" CHECK ("kind" IN ('ACTIVITY_INVITED','ACTIVITY_UPDATED','ACTIVITY_CANCELED','ACTIVITY_REMOVED','SEAT_OFFERED','ACTIVITY_REMINDER','EXPENSE_PROPOSED','EXPENSE_DECIDED','SETTLEMENT_RECORDED','SETTLEMENT_DECIDED'))
);
CREATE TABLE "SocialExpense" (
  "id" uuid NOT NULL,
  "groupId" uuid,
  "activityId" uuid,
  "state" varchar(10) NOT NULL DEFAULT 'PENDING',
  "effectiveRevisionId" uuid,
  "proposedByUserId" uuid,
  "creationKeyHash" char(64) NOT NULL,
  "creationFingerprint" char(64) NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialExpense_context_check" CHECK (num_nonnulls("groupId","activityId") = 1),
  CONSTRAINT "SocialExpense_state_check" CHECK ("state" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN') AND (("state" = 'APPROVED') = ("effectiveRevisionId" IS NOT NULL)) AND "revision" > 0)
);
CREATE TABLE "SocialExpenseRevision" (
  "id" uuid NOT NULL,
  "expenseId" uuid NOT NULL,
  "number" integer NOT NULL,
  "state" varchar(10) NOT NULL DEFAULT 'PENDING',
  "title" varchar(200) NOT NULL,
  "note" varchar(2000),
  "currency" char(3) NOT NULL,
  "scale" integer NOT NULL,
  "amountMinor" bigint NOT NULL,
  "payerUserId" uuid,
  "method" varchar(10) NOT NULL,
  "incurredOn" date NOT NULL,
  "proposedByUserId" uuid,
  "decidedByUserId" uuid,
  "decidedAt" timestamptz(3),
  "decisionNote" varchar(2000),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialExpenseRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialExpenseRevision_state_check" CHECK ("state" IN ('PENDING','APPROVED','REJECTED','SUPERSEDED','WITHDRAWN') AND (("state" IN ('PENDING','WITHDRAWN')) = ("decidedAt" IS NULL))),
  CONSTRAINT "SocialExpenseRevision_money_check" CHECK ("amountMinor" > 0 AND "amountMinor" <= 900000000000000000 AND "currency" ~ '^[A-Z]{3}$' AND "scale" BETWEEN 0 AND 4 AND "number" > 0),
  CONSTRAINT "SocialExpenseRevision_method_check" CHECK ("method" IN ('EQUAL','PERCENT','FIXED','WEIGHTED'))
);
CREATE TABLE "SocialExpenseShare" (
  "revisionId" uuid NOT NULL,
  "position" integer NOT NULL,
  "userId" uuid,
  "input" bigint,
  "shareMinor" bigint NOT NULL,
  CONSTRAINT "SocialExpenseShare_pkey" PRIMARY KEY ("revisionId","position"),
  CONSTRAINT "SocialExpenseShare_amount_check" CHECK ("shareMinor" >= 0 AND "position" BETWEEN 1 AND 200 AND ("input" IS NULL OR "input" >= 0))
);
CREATE TABLE "SocialSettlement" (
  "id" uuid NOT NULL,
  "groupId" uuid,
  "activityId" uuid,
  "payerUserId" uuid,
  "payeeUserId" uuid,
  "currency" char(3) NOT NULL,
  "scale" integer NOT NULL,
  "amountMinor" bigint NOT NULL,
  "state" varchar(10) NOT NULL DEFAULT 'RECORDED',
  "note" varchar(2000),
  "disputeNote" varchar(2000),
  "creationKeyHash" char(64) NOT NULL,
  "creationFingerprint" char(64) NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "decidedAt" timestamptz(3),
  CONSTRAINT "SocialSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialSettlement_context_check" CHECK (num_nonnulls("groupId","activityId") = 1),
  CONSTRAINT "SocialSettlement_shape_check" CHECK ("amountMinor" > 0 AND "amountMinor" <= 900000000000000000 AND "currency" ~ '^[A-Z]{3}$' AND "scale" BETWEEN 0 AND 4 AND "payerUserId" IS DISTINCT FROM "payeeUserId" AND "revision" > 0),
  CONSTRAINT "SocialSettlement_state_check" CHECK ("state" IN ('RECORDED','CONFIRMED','DISPUTED','CANCELED') AND ("state" <> 'DISPUTED' OR "disputeNote" IS NOT NULL))
);
CREATE TABLE "SocialAuditEvent" (
  "id" uuid NOT NULL,
  "groupId" uuid,
  "activityId" uuid,
  "actorUserId" uuid,
  "action" varchar(40) NOT NULL,
  "resourceId" uuid NOT NULL,
  "occurredAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialAuditEvent_context_check" CHECK (num_nonnulls("groupId","activityId") = 1)
);
CREATE INDEX "SocialActivity_groupId_id_idx" ON "SocialActivity"("groupId","id");
CREATE UNIQUE INDEX "SocialActivityParticipant_activityId_userId_key" ON "SocialActivityParticipant"("activityId","userId");
CREATE UNIQUE INDEX "SocialActivityParticipant_activityId_id_key" ON "SocialActivityParticipant"("activityId","id");
CREATE INDEX "SocialActivityParticipant_userId_state_id_idx" ON "SocialActivityParticipant"("userId","state","id");
CREATE UNIQUE INDEX "SocialActivityItem_activityId_id_key" ON "SocialActivityItem"("activityId","id");
CREATE UNIQUE INDEX "SocialActivityPoll_activityId_id_key" ON "SocialActivityPoll"("activityId","id");
CREATE UNIQUE INDEX "SocialActivityPollOption_pollId_id_key" ON "SocialActivityPollOption"("pollId","id");
CREATE UNIQUE INDEX "SocialActivityPollOption_pollId_position_key" ON "SocialActivityPollOption"("pollId","position");
CREATE INDEX "SocialActivityPollVote_pollId_participantId_idx" ON "SocialActivityPollVote"("pollId","participantId");
CREATE UNIQUE INDEX "SocialActivityBusy_activityId_participantId_key" ON "SocialActivityBusy"("activityId","participantId");
CREATE UNIQUE INDEX "SocialNotice_userId_dedupeKey_key" ON "SocialNotice"("userId","dedupeKey");
CREATE INDEX "SocialNotice_userId_id_idx" ON "SocialNotice"("userId","id");
CREATE UNIQUE INDEX "SocialExpense_effectiveRevisionId_key" ON "SocialExpense"("effectiveRevisionId");
CREATE UNIQUE INDEX "SocialExpense_id_effectiveRevisionId_key" ON "SocialExpense"("id","effectiveRevisionId");
CREATE INDEX "SocialExpense_groupId_id_idx" ON "SocialExpense"("groupId","id");
CREATE INDEX "SocialExpense_activityId_id_idx" ON "SocialExpense"("activityId","id");
CREATE UNIQUE INDEX "SocialExpenseRevision_expenseId_number_key" ON "SocialExpenseRevision"("expenseId","number");
CREATE UNIQUE INDEX "SocialExpenseRevision_expenseId_id_key" ON "SocialExpenseRevision"("expenseId","id");
-- At most one pending proposal or correction per expense; the approved revision stays effective meanwhile.
CREATE UNIQUE INDEX "SocialExpenseRevision_one_pending" ON "SocialExpenseRevision"("expenseId") WHERE "state" = 'PENDING';
CREATE UNIQUE INDEX "SocialExpenseShare_revisionId_userId_key" ON "SocialExpenseShare"("revisionId","userId");
CREATE INDEX "SocialExpenseShare_userId_idx" ON "SocialExpenseShare"("userId");
CREATE INDEX "SocialSettlement_groupId_id_idx" ON "SocialSettlement"("groupId","id");
CREATE INDEX "SocialSettlement_activityId_id_idx" ON "SocialSettlement"("activityId","id");
CREATE INDEX "SocialAuditEvent_activityId_id_idx" ON "SocialAuditEvent"("activityId","id");
CREATE INDEX "SocialAuditEvent_groupId_id_idx" ON "SocialAuditEvent"("groupId","id");
ALTER TABLE "SocialActivity" ADD CONSTRAINT "SocialActivity_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivity" ADD CONSTRAINT "SocialActivity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityParticipant" ADD CONSTRAINT "SocialActivityParticipant_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityParticipant" ADD CONSTRAINT "SocialActivityParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityItem" ADD CONSTRAINT "SocialActivityItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityItem" ADD CONSTRAINT "SocialActivityItem_activityId_assigneeParticipantId_fkey" FOREIGN KEY ("activityId","assigneeParticipantId") REFERENCES "SocialActivityParticipant"("activityId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityItem" ADD CONSTRAINT "SocialActivityItem_activityId_createdByParticipantId_fkey" FOREIGN KEY ("activityId","createdByParticipantId") REFERENCES "SocialActivityParticipant"("activityId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityTaskLink" ADD CONSTRAINT "SocialActivityTaskLink_activityId_itemId_fkey" FOREIGN KEY ("activityId","itemId") REFERENCES "SocialActivityItem"("activityId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityTaskLink" ADD CONSTRAINT "SocialActivityTaskLink_activityId_participantId_fkey" FOREIGN KEY ("activityId","participantId") REFERENCES "SocialActivityParticipant"("activityId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityPoll" ADD CONSTRAINT "SocialActivityPoll_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityPoll" ADD CONSTRAINT "SocialActivityPoll_id_chosenOptionId_fkey" FOREIGN KEY ("id","chosenOptionId") REFERENCES "SocialActivityPollOption"("pollId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "SocialActivityPollOption" ADD CONSTRAINT "SocialActivityPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SocialActivityPoll"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityPollVote" ADD CONSTRAINT "SocialActivityPollVote_activityId_pollId_fkey" FOREIGN KEY ("activityId","pollId") REFERENCES "SocialActivityPoll"("activityId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityPollVote" ADD CONSTRAINT "SocialActivityPollVote_pollId_optionId_fkey" FOREIGN KEY ("pollId","optionId") REFERENCES "SocialActivityPollOption"("pollId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityPollVote" ADD CONSTRAINT "SocialActivityPollVote_activityId_participantId_fkey" FOREIGN KEY ("activityId","participantId") REFERENCES "SocialActivityParticipant"("activityId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialActivityBusy" ADD CONSTRAINT "SocialActivityBusy_activityId_participantId_fkey" FOREIGN KEY ("activityId","participantId") REFERENCES "SocialActivityParticipant"("activityId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialNotice" ADD CONSTRAINT "SocialNotice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialExpense" ADD CONSTRAINT "SocialExpense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialExpense" ADD CONSTRAINT "SocialExpense_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialExpense" ADD CONSTRAINT "SocialExpense_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialExpense" ADD CONSTRAINT "SocialExpense_id_effectiveRevisionId_fkey" FOREIGN KEY ("id","effectiveRevisionId") REFERENCES "SocialExpenseRevision"("expenseId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "SocialExpenseRevision" ADD CONSTRAINT "SocialExpenseRevision_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "SocialExpense"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialExpenseRevision" ADD CONSTRAINT "SocialExpenseRevision_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialExpenseRevision" ADD CONSTRAINT "SocialExpenseRevision_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialExpenseRevision" ADD CONSTRAINT "SocialExpenseRevision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialExpenseShare" ADD CONSTRAINT "SocialExpenseShare_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SocialExpenseRevision"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialExpenseShare" ADD CONSTRAINT "SocialExpenseShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialSettlement" ADD CONSTRAINT "SocialSettlement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialSettlement" ADD CONSTRAINT "SocialSettlement_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialSettlement" ADD CONSTRAINT "SocialSettlement_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialSettlement" ADD CONSTRAINT "SocialSettlement_payeeUserId_fkey" FOREIGN KEY ("payeeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialAuditEvent" ADD CONSTRAINT "SocialAuditEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialAuditEvent" ADD CONSTRAINT "SocialAuditEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialAuditEvent" ADD CONSTRAINT "SocialAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
COMMIT;
