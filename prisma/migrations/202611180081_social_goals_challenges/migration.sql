BEGIN;
-- P6-05 (ADR 0065 D1-D5): additive Social Goals and Challenges tables.
-- No existing table, constraint, row or historical migration is changed.
-- Each goal has exactly one Group or Activity context; same-goal composite keys keep
-- participants, entries and history inside one goal. Nothing here is disposed: no
-- Social retention rule is approved (P6-06).
CREATE TABLE "SocialGoal" (
  "id" uuid NOT NULL,
  "kind" varchar(10) NOT NULL,
  "groupId" uuid,
  "activityId" uuid,
  "title" varchar(200) NOT NULL,
  "description" varchar(2000),
  "unit" varchar(40) NOT NULL,
  "target" integer NOT NULL,
  "startsOn" date NOT NULL,
  "endsOn" date NOT NULL,
  "timezone" varchar(100) NOT NULL,
  "reviewRequired" boolean NOT NULL DEFAULT false,
  "state" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "completedAt" timestamptz(3),
  "closedAt" timestamptz(3),
  "createdByUserId" uuid,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialGoal_context_check" CHECK (num_nonnulls("groupId","activityId") = 1),
  CONSTRAINT "SocialGoal_shape_check" CHECK ("kind" IN ('GOAL','CHALLENGE') AND "target" > 0 AND "endsOn" >= "startsOn" AND "revision" > 0 AND ("completedAt" IS NULL OR "kind" = 'GOAL')),
  CONSTRAINT "SocialGoal_state_check" CHECK ("state" IN ('ACTIVE','CLOSED','CANCELED') AND (("state" = 'ACTIVE') = ("closedAt" IS NULL)))
);
CREATE TABLE "SocialGoalParticipant" (
  "id" uuid NOT NULL,
  "goalId" uuid NOT NULL,
  "userId" uuid,
  "state" varchar(10) NOT NULL DEFAULT 'ACTIVE',
  "joinedAt" timestamptz(3) NOT NULL,
  "withdrawnAt" timestamptz(3),
  "completedAt" timestamptz(3),
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialGoalParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialGoalParticipant_state_check" CHECK ("state" IN ('ACTIVE','WITHDRAWN') AND (("state" = 'WITHDRAWN') = ("withdrawnAt" IS NOT NULL)) AND "revision" > 0)
);
CREATE TABLE "SocialGoalEntry" (
  "id" uuid NOT NULL,
  "goalId" uuid NOT NULL,
  "participantId" uuid NOT NULL,
  "kind" varchar(10) NOT NULL,
  "amount" integer NOT NULL,
  "occurredOn" date,
  "note" varchar(1000),
  "state" varchar(10) NOT NULL,
  "submittedByUserId" uuid,
  "submittedAt" timestamptz(3) NOT NULL,
  "reviewedByUserId" uuid,
  "reviewedAt" timestamptz(3),
  "reviewNote" varchar(1000),
  "correctsEntryId" uuid,
  "revision" integer NOT NULL DEFAULT 1,
  "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialGoalEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocialGoalEntry_state_check" CHECK ("state" IN ('PENDING','APPROVED','REJECTED','RETRACTED') AND "revision" > 0 AND ("state" <> 'REJECTED' OR "reviewedAt" IS NOT NULL)),
  -- Submissions are positive, dated self-reports; corrections are signed, explicit and immediately effective.
  CONSTRAINT "SocialGoalEntry_kind_check" CHECK (("kind" = 'SUBMISSION' AND "amount" > 0 AND "occurredOn" IS NOT NULL AND "correctsEntryId" IS NULL) OR ("kind" = 'CORRECTION' AND "amount" <> 0 AND "occurredOn" IS NULL AND "state" = 'APPROVED' AND "reviewedAt" IS NULL)),
  CONSTRAINT "SocialGoalEntry_self_check" CHECK ("correctsEntryId" IS NULL OR "correctsEntryId" <> "id")
);
CREATE TABLE "SocialGoalEvent" (
  "id" uuid NOT NULL,
  "goalId" uuid NOT NULL,
  "participantId" uuid,
  "entryId" uuid,
  "actorUserId" uuid,
  "action" varchar(40) NOT NULL,
  "fromState" varchar(10),
  "toState" varchar(10),
  "amount" integer,
  "occurredAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "SocialGoalEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SocialGoal_groupId_id_idx" ON "SocialGoal"("groupId","id");
CREATE INDEX "SocialGoal_activityId_id_idx" ON "SocialGoal"("activityId","id");
CREATE UNIQUE INDEX "SocialGoalParticipant_goalId_userId_key" ON "SocialGoalParticipant"("goalId","userId");
CREATE UNIQUE INDEX "SocialGoalParticipant_goalId_id_key" ON "SocialGoalParticipant"("goalId","id");
CREATE INDEX "SocialGoalParticipant_userId_id_idx" ON "SocialGoalParticipant"("userId","id");
CREATE UNIQUE INDEX "SocialGoalEntry_goalId_id_key" ON "SocialGoalEntry"("goalId","id");
CREATE INDEX "SocialGoalEntry_goalId_participantId_id_idx" ON "SocialGoalEntry"("goalId","participantId","id");
CREATE INDEX "SocialGoalEntry_goalId_state_id_idx" ON "SocialGoalEntry"("goalId","state","id");
CREATE INDEX "SocialGoalEvent_goalId_occurredAt_id_idx" ON "SocialGoalEvent"("goalId","occurredAt","id");
-- Goals follow their Group or Activity cascade; user edges are SET NULL and never block Personal erasure.
ALTER TABLE "SocialGoal" ADD CONSTRAINT "SocialGoal_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoal" ADD CONSTRAINT "SocialGoal_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "SocialActivity"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoal" ADD CONSTRAINT "SocialGoal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalParticipant" ADD CONSTRAINT "SocialGoalParticipant_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SocialGoal"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalParticipant" ADD CONSTRAINT "SocialGoalParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEntry" ADD CONSTRAINT "SocialGoalEntry_goalId_participantId_fkey" FOREIGN KEY ("goalId","participantId") REFERENCES "SocialGoalParticipant"("goalId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEntry" ADD CONSTRAINT "SocialGoalEntry_goalId_correctsEntryId_fkey" FOREIGN KEY ("goalId","correctsEntryId") REFERENCES "SocialGoalEntry"("goalId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEntry" ADD CONSTRAINT "SocialGoalEntry_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEntry" ADD CONSTRAINT "SocialGoalEntry_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEvent" ADD CONSTRAINT "SocialGoalEvent_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SocialGoal"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEvent" ADD CONSTRAINT "SocialGoalEvent_goalId_participantId_fkey" FOREIGN KEY ("goalId","participantId") REFERENCES "SocialGoalParticipant"("goalId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEvent" ADD CONSTRAINT "SocialGoalEvent_goalId_entryId_fkey" FOREIGN KEY ("goalId","entryId") REFERENCES "SocialGoalEntry"("goalId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SocialGoalEvent" ADD CONSTRAINT "SocialGoalEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
COMMIT;
