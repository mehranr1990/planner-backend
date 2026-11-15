ALTER TABLE "Routine" ADD COLUMN "schedule" JSONB;
CREATE TABLE "RoutineExecution" (
  "id" UUID PRIMARY KEY,
  "spaceId" UUID NOT NULL,
  "routineId" UUID NOT NULL,
  "localDate" DATE NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "state" VARCHAR(10) NOT NULL CHECK ("state" IN ('RUNNING','COMPLETED','SKIPPED')),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
  "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "RoutineExecution_routine_fkey" FOREIGN KEY ("spaceId","routineId") REFERENCES "Routine"("spaceId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RoutineExecution_spaceId_routineId_localDate_key" ON "RoutineExecution" ("spaceId","routineId","localDate");
