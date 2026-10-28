-- P1-03 is additive: no existing Task, recurrence, file, auth or migration is rewritten.
ALTER TABLE "UserSettings" ADD COLUMN "planningAvailability" JSONB;

CREATE TABLE "DailyPlan" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "localDate" DATE NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailyPlan_invariants" CHECK (revision > 0 AND length(timezone) > 0 AND "localDate" BETWEEN '1900-01-01'::date AND '9998-12-31'::date)
);
CREATE TABLE "DailyPlanItem" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "localDate" DATE NOT NULL,
  "taskId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "plannedMinutes" INTEGER,
  "selectedTaskRevision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DailyPlanItem_pkey" PRIMARY KEY ("id"),
  -- Positions 100-199 are reserved for atomic reorder; committed API positions are 0-99.
  CONSTRAINT "DailyPlanItem_invariants" CHECK (revision > 0 AND "selectedTaskRevision" > 0 AND position BETWEEN 0 AND 199 AND ("plannedMinutes" IS NULL OR "plannedMinutes" BETWEEN 0 AND 1440))
);
CREATE TABLE "WeeklyPlan" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "weekStartDate" DATE NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "firstDayOfWeek" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WeeklyPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WeeklyPlan_invariants" CHECK (revision > 0 AND length(timezone) > 0 AND "firstDayOfWeek" BETWEEN 0 AND 6 AND extract(dow from "weekStartDate")::int = "firstDayOfWeek" AND "weekStartDate" BETWEEN '1900-01-01'::date AND '9998-12-25'::date)
);
CREATE TABLE "PlanningReview" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "localDate" DATE NOT NULL,
  "kind" VARCHAR(10) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "firstDayOfWeek" INTEGER NOT NULL,
  "reflection" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PlanningReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanningReview_invariants" CHECK (revision > 0 AND length(timezone) > 0 AND "firstDayOfWeek" BETWEEN 0 AND 6 AND length(reflection) <= 10000 AND kind IN ('MORNING','EVENING','WEEKLY') AND (kind <> 'WEEKLY' OR extract(dow from "localDate")::int = "firstDayOfWeek") AND "localDate" BETWEEN '1900-01-01'::date AND '9998-12-31'::date)
);

CREATE UNIQUE INDEX "DailyPlan_spaceId_localDate_key" ON "DailyPlan"("spaceId","localDate");
CREATE UNIQUE INDEX "DailyPlan_spaceId_id_localDate_key" ON "DailyPlan"("spaceId","id","localDate");
CREATE UNIQUE INDEX "DailyPlanItem_spaceId_localDate_taskId_key" ON "DailyPlanItem"("spaceId","localDate","taskId");
CREATE UNIQUE INDEX "DailyPlanItem_spaceId_planId_position_key" ON "DailyPlanItem"("spaceId","planId","position");
CREATE INDEX "DailyPlanItem_spaceId_taskId_idx" ON "DailyPlanItem"("spaceId","taskId");
CREATE UNIQUE INDEX "WeeklyPlan_spaceId_weekStartDate_key" ON "WeeklyPlan"("spaceId","weekStartDate");
CREATE UNIQUE INDEX "PlanningReview_spaceId_localDate_kind_key" ON "PlanningReview"("spaceId","localDate","kind");
CREATE INDEX "PlanningReview_spaceId_createdAt_id_idx" ON "PlanningReview"("spaceId","createdAt","id");

ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId","createdByUserId") REFERENCES "Space"("id","ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPlanItem" ADD CONSTRAINT "DailyPlanItem_spaceId_planId_localDate_fkey" FOREIGN KEY ("spaceId","planId","localDate") REFERENCES "DailyPlan"("spaceId","id","localDate") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyPlanItem" ADD CONSTRAINT "DailyPlanItem_spaceId_taskId_fkey" FOREIGN KEY ("spaceId","taskId") REFERENCES "Task"("spaceId","id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyPlan" ADD CONSTRAINT "WeeklyPlan_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId","createdByUserId") REFERENCES "Space"("id","ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanningReview" ADD CONSTRAINT "PlanningReview_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId","createdByUserId") REFERENCES "Space"("id","ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_planningAvailability_check" CHECK (
 "planningAvailability" IS NULL OR (
  jsonb_typeof("planningAvailability") = 'object' AND "planningAvailability" ?& ARRAY['version','minutesByWeekday'] AND jsonb_typeof("planningAvailability"->'version') = 'number' AND "planningAvailability"->>'version' = '1'
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday') = 'array'
  AND jsonb_array_length("planningAvailability"->'minutesByWeekday') = 7
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday'->0) = 'number' AND ("planningAvailability"->'minutesByWeekday'->>0) ~ '^(0|[1-9][0-9]{0,3})$' AND ("planningAvailability"->'minutesByWeekday'->>0)::int BETWEEN 0 AND 1440
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday'->1) = 'number' AND ("planningAvailability"->'minutesByWeekday'->>1) ~ '^(0|[1-9][0-9]{0,3})$' AND ("planningAvailability"->'minutesByWeekday'->>1)::int BETWEEN 0 AND 1440
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday'->2) = 'number' AND ("planningAvailability"->'minutesByWeekday'->>2) ~ '^(0|[1-9][0-9]{0,3})$' AND ("planningAvailability"->'minutesByWeekday'->>2)::int BETWEEN 0 AND 1440
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday'->3) = 'number' AND ("planningAvailability"->'minutesByWeekday'->>3) ~ '^(0|[1-9][0-9]{0,3})$' AND ("planningAvailability"->'minutesByWeekday'->>3)::int BETWEEN 0 AND 1440
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday'->4) = 'number' AND ("planningAvailability"->'minutesByWeekday'->>4) ~ '^(0|[1-9][0-9]{0,3})$' AND ("planningAvailability"->'minutesByWeekday'->>4)::int BETWEEN 0 AND 1440
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday'->5) = 'number' AND ("planningAvailability"->'minutesByWeekday'->>5) ~ '^(0|[1-9][0-9]{0,3})$' AND ("planningAvailability"->'minutesByWeekday'->>5)::int BETWEEN 0 AND 1440
  AND jsonb_typeof("planningAvailability"->'minutesByWeekday'->6) = 'number' AND ("planningAvailability"->'minutesByWeekday'->>6) ~ '^(0|[1-9][0-9]{0,3})$' AND ("planningAvailability"->'minutesByWeekday'->>6)::int BETWEEN 0 AND 1440
 )
);
