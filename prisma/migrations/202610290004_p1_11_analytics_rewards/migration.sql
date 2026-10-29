BEGIN;
-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "rewardsDisplayAchievements" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rewardsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rewardsEnabledSince" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "rewardAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rewardFailureCode" VARCHAR(80),
ADD COLUMN     "rewardHandledAt" TIMESTAMPTZ(3),
ADD COLUMN     "rewardRetryAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AchievementDefinition" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "kind" VARCHAR(20) NOT NULL,
    "required" INTEGER NOT NULL,

    CONSTRAINT "AchievementDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementUnlock" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "unlockedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievementUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpLedger" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "sourceEventId" UUID NOT NULL,
    "rewardKey" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "points" INTEGER NOT NULL,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "earnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AchievementDefinition_code_key" ON "AchievementDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementUnlock_spaceId_definitionId_key" ON "AchievementUnlock"("spaceId", "definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "XpLedger_sourceEventId_key" ON "XpLedger"("sourceEventId");

-- CreateIndex
CREATE INDEX "XpLedger_spaceId_earnedAt_id_idx" ON "XpLedger"("spaceId", "earnedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "XpLedger_spaceId_rewardKey_key" ON "XpLedger"("spaceId", "rewardKey");

-- CreateIndex
CREATE UNIQUE INDEX "XpLedger_spaceId_sourceEventId_key" ON "XpLedger"("spaceId", "sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_spaceId_id_key" ON "OutboxEvent"("spaceId", "id");

-- AddForeignKey
ALTER TABLE "AchievementUnlock" ADD CONSTRAINT "AchievementUnlock_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementUnlock" ADD CONSTRAINT "AchievementUnlock_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "AchievementDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpLedger" ADD CONSTRAINT "XpLedger_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpLedger" ADD CONSTRAINT "XpLedger_spaceId_sourceEventId_fkey" FOREIGN KEY ("spaceId", "sourceEventId") REFERENCES "OutboxEvent"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_rewards_context" CHECK (NOT "rewardsEnabled" OR "rewardsEnabledSince" IS NOT NULL);
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_reward_attempts" CHECK ("rewardAttempts" BETWEEN 0 AND 5);
ALTER TABLE "XpLedger" ADD CONSTRAINT "XpLedger_rules" CHECK ("ruleVersion"=1 AND ((kind='TASK' AND points=10 AND "rewardKey" ~ '^task:[0-9a-f-]{36}$') OR (kind='HABIT_DAY' AND points=5 AND "rewardKey" ~ '^habit:[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}$')));
ALTER TABLE "AchievementUnlock" ADD CONSTRAINT "AchievementUnlock_rule_version" CHECK ("ruleVersion"=1);
ALTER TABLE "AchievementDefinition" ADD CONSTRAINT "AchievementDefinition_rules" CHECK ("ruleVersion"=1 AND ((code='FIRST_TASK' AND kind='TASK' AND required=1) OR (code='TEN_TASKS' AND kind='TASK' AND required=10) OR (code='SEVEN_HABIT_DAYS' AND kind='HABIT_DAY' AND required=7)));
CREATE INDEX "OutboxEvent_reward_pending" ON "OutboxEvent" ("occurredAt",id) WHERE "rewardHandledAt" IS NULL AND "rewardAttempts"<5 AND type IN ('task.completed','habit.entry_recorded','habit.entry_corrected');
CREATE INDEX "XpLedger_spaceId_kind" ON "XpLedger" ("spaceId",kind);
CREATE INDEX "TaskChange_completion_insights" ON "TaskChange" ("spaceId","createdAt","taskId") WHERE kind='COMPLETED';
CREATE INDEX "DailyPlanItem_insights_date" ON "DailyPlanItem" ("spaceId","localDate");
CREATE INDEX "GoalReview_insights_period" ON "GoalReview" ("spaceId","createdAt",id);
INSERT INTO "AchievementDefinition" (id,code,"ruleVersion",kind,required) VALUES
('11000000-0000-4000-8000-000000000001','FIRST_TASK',1,'TASK',1),
('11000000-0000-4000-8000-000000000002','TEN_TASKS',1,'TASK',10),
('11000000-0000-4000-8000-000000000003','SEVEN_HABIT_DAYS',1,'HABIT_DAY',7);

COMMIT;
