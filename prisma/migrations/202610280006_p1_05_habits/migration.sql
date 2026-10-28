-- CreateTable
CREATE TABLE "Habit" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "purpose" VARCHAR(10) NOT NULL DEFAULT 'GENERIC',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Habit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitSchedule" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "habitId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "target" DECIMAL(12,3) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitEntry" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "habitId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "logicalId" UUID NOT NULL,
    "previousId" UUID,
    "actorUserId" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'RECORDED',
    "localDate" DATE NOT NULL,
    "value" DECIMAL(12,3),
    "timezone" VARCHAR(100) NOT NULL,
    "recordedTimezone" VARCHAR(100) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Routine" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineHabit" (
    "spaceId" UUID NOT NULL,
    "routineId" UUID NOT NULL,
    "habitId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RoutineHabit_pkey" PRIMARY KEY ("spaceId","routineId","habitId")
);

-- CreateIndex
CREATE INDEX "Habit_spaceId_createdAt_id_idx" ON "Habit"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Habit_spaceId_purpose_createdAt_id_idx" ON "Habit"("spaceId", "purpose", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Habit_spaceId_id_key" ON "Habit"("spaceId", "id");

-- CreateIndex
CREATE INDEX "HabitSchedule_spaceId_habitId_effectiveFrom_revision_idx" ON "HabitSchedule"("spaceId", "habitId", "effectiveFrom", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "HabitSchedule_spaceId_habitId_id_key" ON "HabitSchedule"("spaceId", "habitId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HabitSchedule_habitId_revision_key" ON "HabitSchedule"("habitId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "HabitEntry_previousId_key" ON "HabitEntry"("previousId");

-- CreateIndex
CREATE INDEX "HabitEntry_spaceId_habitId_localDate_current_idx" ON "HabitEntry"("spaceId", "habitId", "localDate", "current");

-- CreateIndex
CREATE INDEX "HabitEntry_spaceId_habitId_logicalId_createdAt_id_idx" ON "HabitEntry"("spaceId", "habitId", "logicalId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "HabitEntry_spaceId_habitId_current_createdAt_id_idx" ON "HabitEntry"("spaceId", "habitId", "current", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HabitEntry_spaceId_habitId_id_key" ON "HabitEntry"("spaceId", "habitId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "HabitEntry_spaceId_habitId_previousId_key" ON "HabitEntry"("spaceId", "habitId", "previousId");

-- CreateIndex
CREATE INDEX "Routine_spaceId_createdAt_id_idx" ON "Routine"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Routine_spaceId_id_key" ON "Routine"("spaceId", "id");

-- CreateIndex
CREATE INDEX "RoutineHabit_spaceId_habitId_idx" ON "RoutineHabit"("spaceId", "habitId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineHabit_spaceId_routineId_position_key" ON "RoutineHabit"("spaceId", "routineId", "position");

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "HabitSchedule_spaceId_habitId_fkey" FOREIGN KEY ("spaceId", "habitId") REFERENCES "Habit"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_spaceId_habitId_fkey" FOREIGN KEY ("spaceId", "habitId") REFERENCES "Habit"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_spaceId_habitId_scheduleId_fkey" FOREIGN KEY ("spaceId", "habitId", "scheduleId") REFERENCES "HabitSchedule"("spaceId", "habitId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_spaceId_habitId_logicalId_fkey" FOREIGN KEY ("spaceId", "habitId", "logicalId") REFERENCES "HabitEntry"("spaceId", "habitId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_spaceId_habitId_previousId_fkey" FOREIGN KEY ("spaceId", "habitId", "previousId") REFERENCES "HabitEntry"("spaceId", "habitId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_spaceId_actorUserId_fkey" FOREIGN KEY ("spaceId", "actorUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineHabit" ADD CONSTRAINT "RoutineHabit_spaceId_routineId_fkey" FOREIGN KEY ("spaceId", "routineId") REFERENCES "Routine"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineHabit" ADD CONSTRAINT "RoutineHabit_spaceId_habitId_fkey" FOREIGN KEY ("spaceId", "habitId") REFERENCES "Habit"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Reviewed owner, date/configuration and exact-measure invariants.
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_measure_check" CHECK (type IN ('CHECKBOX','QUANTITY','DURATION') AND purpose IN ('GENERIC','WATER') AND unit ~ '^[A-Z][A-Z0-9_]{0,29}$' AND (type<>'CHECKBOX' OR unit='COUNT') AND (type<>'DURATION' OR unit='SECOND') AND (purpose<>'WATER' OR (type='QUANTITY' AND unit='ML')) AND length(btrim(title))>0 AND revision BETWEEN 1 AND 2147483646);
ALTER TABLE "HabitSchedule" ADD CONSTRAINT "HabitSchedule_valid_check" CHECK (target>0 AND status IN ('ACTIVE','PAUSED','ARCHIVED') AND revision BETWEEN 1 AND 2147483646 AND length(timezone)>0 AND jsonb_typeof(definition)='object' AND definition ? 'version' AND definition->>'version'='1');
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_value_check" CHECK (kind IN ('CHECKBOX','QUANTITY','DURATION','SKIP') AND state IN ('RECORDED','VOID') AND ((kind='SKIP' AND value IS NULL) OR (kind<>'SKIP' AND value IS NOT NULL AND value>=0)) AND (kind<>'CHECKBOX' OR value IN (0,1)) AND (kind<>'DURATION' OR value=trunc(value)) AND length(timezone)>0 AND length("recordedTimezone")>0);
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_revision_check" CHECK (revision BETWEEN 1 AND 2147483646 AND (("previousId" IS NULL AND revision=1 AND id="logicalId") OR ("previousId" IS NOT NULL AND revision>1 AND id<>"logicalId" AND id<>"previousId")));
CREATE UNIQUE INDEX "HabitEntry_current_logical" ON "HabitEntry" ("logicalId") WHERE "current";
CREATE UNIQUE INDEX "HabitEntry_current_checkbox" ON "HabitEntry" ("habitId","localDate") WHERE "current" AND state='RECORDED' AND kind='CHECKBOX';
CREATE UNIQUE INDEX "HabitEntry_current_skip" ON "HabitEntry" ("habitId","localDate") WHERE "current" AND state='RECORDED' AND kind='SKIP';
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_valid_check" CHECK (status IN ('ACTIVE','ARCHIVED') AND revision BETWEEN 1 AND 2147483646 AND length(btrim(title))>0);
ALTER TABLE "RoutineHabit" ADD CONSTRAINT "RoutineHabit_order_check" CHECK (position BETWEEN 0 AND 99);
