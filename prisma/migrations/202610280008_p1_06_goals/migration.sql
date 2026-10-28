-- Reviewed additive P1-06 schema with scoped relations and domain integrity checks.
-- CreateTable
CREATE TABLE "LifeArea" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "LifeArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT,
    "horizon" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PLANNED',
    "lifeAreaId" UUID,
    "parentGoalId" UUID,
    "startDate" DATE,
    "targetDate" DATE,
    "timezone" VARCHAR(100) NOT NULL,
    "progressMode" VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    "manualProgress" DECIMAL(15,6) NOT NULL DEFAULT 0,
    "metricId" UUID,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalMilestone" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "targetDate" DATE,
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMPTZ(3),
    "contributes" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(13,6) NOT NULL DEFAULT 1,

    CONSTRAINT "GoalMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalMetric" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "baseline" DECIMAL(15,6) NOT NULL,
    "target" DECIMAL(15,6) NOT NULL,
    "current" DECIMAL(15,6) NOT NULL,
    "contributes" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(13,6) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GoalMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalTaskLink" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "taskId" UUID NOT NULL,
    "selectedSourceRevision" INTEGER NOT NULL,
    "contributes" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(13,6) NOT NULL DEFAULT 1,

    CONSTRAINT "GoalTaskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalHabitLink" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "habitId" UUID NOT NULL,
    "selectedSourceRevision" INTEGER NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "contributes" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(13,6) NOT NULL DEFAULT 1,

    CONSTRAINT "GoalHabitLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalReview" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "reflection" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LifeArea_spaceId_createdAt_id_idx" ON "LifeArea"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LifeArea_spaceId_id_key" ON "LifeArea"("spaceId", "id");

-- CreateIndex
CREATE INDEX "Goal_spaceId_createdAt_id_idx" ON "Goal"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Goal_spaceId_status_createdAt_id_idx" ON "Goal"("spaceId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Goal_spaceId_lifeAreaId_idx" ON "Goal"("spaceId", "lifeAreaId");

-- CreateIndex
CREATE INDEX "Goal_spaceId_parentGoalId_idx" ON "Goal"("spaceId", "parentGoalId");

-- CreateIndex
CREATE UNIQUE INDEX "Goal_spaceId_id_key" ON "Goal"("spaceId", "id");

-- CreateIndex
CREATE INDEX "GoalMilestone_spaceId_goalId_position_id_idx" ON "GoalMilestone"("spaceId", "goalId", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GoalMilestone_spaceId_goalId_id_key" ON "GoalMilestone"("spaceId", "goalId", "id");

-- CreateIndex
CREATE INDEX "GoalMetric_spaceId_goalId_createdAt_id_idx" ON "GoalMetric"("spaceId", "goalId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GoalMetric_spaceId_goalId_id_key" ON "GoalMetric"("spaceId", "goalId", "id");

-- CreateIndex
CREATE INDEX "GoalTaskLink_spaceId_goalId_createdAt_id_idx" ON "GoalTaskLink"("spaceId", "goalId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "GoalTaskLink_spaceId_taskId_idx" ON "GoalTaskLink"("spaceId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalTaskLink_goalId_taskId_key" ON "GoalTaskLink"("goalId", "taskId");

-- CreateIndex
CREATE INDEX "GoalHabitLink_spaceId_goalId_createdAt_id_idx" ON "GoalHabitLink"("spaceId", "goalId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "GoalHabitLink_spaceId_habitId_idx" ON "GoalHabitLink"("spaceId", "habitId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalHabitLink_goalId_habitId_key" ON "GoalHabitLink"("goalId", "habitId");

-- CreateIndex
CREATE INDEX "GoalReview_spaceId_goalId_createdAt_id_idx" ON "GoalReview"("spaceId", "goalId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "LifeArea" ADD CONSTRAINT "LifeArea_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_spaceId_lifeAreaId_fkey" FOREIGN KEY ("spaceId", "lifeAreaId") REFERENCES "LifeArea"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_spaceId_parentGoalId_fkey" FOREIGN KEY ("spaceId", "parentGoalId") REFERENCES "Goal"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_spaceId_id_metricId_fkey" FOREIGN KEY ("spaceId", "id", "metricId") REFERENCES "GoalMetric"("spaceId", "goalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GoalMilestone" ADD CONSTRAINT "GoalMilestone_spaceId_goalId_fkey" FOREIGN KEY ("spaceId", "goalId") REFERENCES "Goal"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalMetric" ADD CONSTRAINT "GoalMetric_spaceId_goalId_fkey" FOREIGN KEY ("spaceId", "goalId") REFERENCES "Goal"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalTaskLink" ADD CONSTRAINT "GoalTaskLink_spaceId_goalId_fkey" FOREIGN KEY ("spaceId", "goalId") REFERENCES "Goal"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalTaskLink" ADD CONSTRAINT "GoalTaskLink_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GoalHabitLink" ADD CONSTRAINT "GoalHabitLink_spaceId_goalId_fkey" FOREIGN KEY ("spaceId", "goalId") REFERENCES "Goal"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalHabitLink" ADD CONSTRAINT "GoalHabitLink_spaceId_habitId_fkey" FOREIGN KEY ("spaceId", "habitId") REFERENCES "Habit"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GoalReview" ADD CONSTRAINT "GoalReview_spaceId_goalId_fkey" FOREIGN KEY ("spaceId", "goalId") REFERENCES "Goal"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LifeArea" ADD CONSTRAINT "LifeArea_integrity_1" CHECK ("position" BETWEEN 0 AND 9999);
ALTER TABLE "LifeArea" ADD CONSTRAINT "LifeArea_integrity_2" CHECK ("status" IN ('ACTIVE','ARCHIVED'));
ALTER TABLE "LifeArea" ADD CONSTRAINT "LifeArea_integrity_3" CHECK ("revision">0);
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_integrity_1" CHECK ("horizon" IN ('SHORT_TERM','LONG_TERM'));
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_integrity_2" CHECK ("status" IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','ABANDONED'));
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_integrity_3" CHECK ("progressMode" IN ('MANUAL','METRIC','WEIGHTED'));
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_integrity_4" CHECK ("revision">0);
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_integrity_5" CHECK ("parentGoalId" IS DISTINCT FROM "id");
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_integrity_6" CHECK ("startDate" IS NULL OR "targetDate" IS NULL OR "startDate"<="targetDate");
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_integrity_7" CHECK (("progressMode"='METRIC') = ("metricId" IS NOT NULL));
ALTER TABLE "GoalMilestone" ADD CONSTRAINT "GoalMilestone_integrity_1" CHECK ("position" BETWEEN 0 AND 9999);
ALTER TABLE "GoalMilestone" ADD CONSTRAINT "GoalMilestone_integrity_2" CHECK ("weight">0 AND "weight"<=1000000);
ALTER TABLE "GoalMilestone" ADD CONSTRAINT "GoalMilestone_integrity_3" CHECK (("status"='COMPLETED' AND "completedAt" IS NOT NULL) OR ("status"='OPEN' AND "completedAt" IS NULL));
ALTER TABLE "GoalMetric" ADD CONSTRAINT "GoalMetric_integrity_1" CHECK ("weight">0 AND "weight"<=1000000);
ALTER TABLE "GoalMetric" ADD CONSTRAINT "GoalMetric_integrity_2" CHECK ("baseline"<>"target");
ALTER TABLE "GoalTaskLink" ADD CONSTRAINT "GoalTaskLink_integrity_1" CHECK ("selectedSourceRevision">0);
ALTER TABLE "GoalTaskLink" ADD CONSTRAINT "GoalTaskLink_integrity_2" CHECK ("weight">0 AND "weight"<=1000000);
ALTER TABLE "GoalHabitLink" ADD CONSTRAINT "GoalHabitLink_integrity_1" CHECK ("selectedSourceRevision">0);
ALTER TABLE "GoalHabitLink" ADD CONSTRAINT "GoalHabitLink_integrity_2" CHECK ("weight">0 AND "weight"<=1000000);
ALTER TABLE "GoalHabitLink" ADD CONSTRAINT "GoalHabitLink_integrity_3" CHECK ("to">"from" AND "to"-"from"<=366);
ALTER TABLE "GoalReview" ADD CONSTRAINT "GoalReview_integrity_1" CHECK ("kind" IN ('SNAPSHOT','REVIEW'));
ALTER TABLE "GoalReview" ADD CONSTRAINT "GoalReview_integrity_2" CHECK (("kind"='REVIEW' AND "reflection" IS NOT NULL) OR ("kind"='SNAPSHOT' AND "reflection" IS NULL));
ALTER TABLE "GoalReview" ADD CONSTRAINT "GoalReview_integrity_3" CHECK (jsonb_typeof("snapshot")='object' AND "snapshot" @> '{"ruleVersion":1}'::jsonb);
