-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "important" BOOLEAN,
ADD COLUMN     "urgent" BOOLEAN;

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" UUID NOT NULL,
    "logicalId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "taskId" UUID,
    "selectedTaskRevision" INTEGER,
    "previousId" UUID,
    "title" VARCHAR(300) NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'IDLE',
    "action" VARCHAR(10) NOT NULL,
    "elapsedMs" BIGINT NOT NULL DEFAULT 0,
    "runningSince" TIMESTAMPTZ(3),
    "clockAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "workMinutes" INTEGER,
    "shortBreakMinutes" INTEGER,
    "longBreakMinutes" INTEGER,
    "longBreakEvery" INTEGER,
    "workIntervals" INTEGER,

    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" UUID NOT NULL,
    "logicalId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "taskId" UUID,
    "selectedTaskRevision" INTEGER,
    "previousId" UUID,
    "kind" VARCHAR(10) NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'RECORDED',
    "sessionId" UUID,
    "segmentOrdinal" INTEGER,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_previousId_key" ON "FocusSession"("previousId");

-- CreateIndex
CREATE INDEX "FocusSession_spaceId_current_createdAt_id_idx" ON "FocusSession"("spaceId", "current", "createdAt", "id");

-- CreateIndex
CREATE INDEX "FocusSession_spaceId_logicalId_revision_idx" ON "FocusSession"("spaceId", "logicalId", "revision");

-- CreateIndex
CREATE INDEX "FocusSession_spaceId_taskId_idx" ON "FocusSession"("spaceId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_spaceId_id_key" ON "FocusSession"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_spaceId_logicalId_id_key" ON "FocusSession"("spaceId", "logicalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_spaceId_logicalId_previousId_key" ON "FocusSession"("spaceId", "logicalId", "previousId");

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_logicalId_revision_key" ON "FocusSession"("logicalId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_previousId_key" ON "TimeEntry"("previousId");

-- CreateIndex
CREATE INDEX "TimeEntry_spaceId_current_createdAt_id_idx" ON "TimeEntry"("spaceId", "current", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TimeEntry_spaceId_current_startAt_endAt_idx" ON "TimeEntry"("spaceId", "current", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "TimeEntry_spaceId_logicalId_revision_idx" ON "TimeEntry"("spaceId", "logicalId", "revision");

-- CreateIndex
CREATE INDEX "TimeEntry_spaceId_taskId_idx" ON "TimeEntry"("spaceId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_spaceId_id_key" ON "TimeEntry"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_spaceId_logicalId_id_key" ON "TimeEntry"("spaceId", "logicalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_spaceId_logicalId_previousId_key" ON "TimeEntry"("spaceId", "logicalId", "previousId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_logicalId_revision_key" ON "TimeEntry"("logicalId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_sessionId_segmentOrdinal_key" ON "TimeEntry"("sessionId", "segmentOrdinal");

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_spaceId_logicalId_fkey" FOREIGN KEY ("spaceId", "logicalId") REFERENCES "FocusSession"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_spaceId_logicalId_previousId_fkey" FOREIGN KEY ("spaceId", "logicalId", "previousId") REFERENCES "FocusSession"("spaceId", "logicalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_spaceId_logicalId_fkey" FOREIGN KEY ("spaceId", "logicalId") REFERENCES "TimeEntry"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_spaceId_logicalId_previousId_fkey" FOREIGN KEY ("spaceId", "logicalId", "previousId") REFERENCES "TimeEntry"("spaceId", "logicalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_spaceId_sessionId_fkey" FOREIGN KEY ("spaceId", "sessionId") REFERENCES "FocusSession"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Current logical identities and the reserved active timer are enforced across processes.
CREATE UNIQUE INDEX "FocusSession_current_logical" ON "FocusSession" ("logicalId") WHERE current;
CREATE UNIQUE INDEX "FocusSession_reserved_timer" ON "FocusSession" ("spaceId", "createdByUserId") WHERE current AND state IN ('RUNNING','PAUSED');
CREATE UNIQUE INDEX "TimeEntry_current_logical" ON "TimeEntry" ("logicalId") WHERE current;
ALTER TABLE "Task" ADD CONSTRAINT "Task_estimated_minutes" CHECK ("estimatedMinutes" IS NULL OR "estimatedMinutes" BETWEEN 0 AND 10080);
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_identity" CHECK (revision BETWEEN 1 AND 1000 AND ((revision=1 AND id="logicalId" AND "previousId" IS NULL AND action='CREATE') OR (revision>1 AND id<>"logicalId" AND "previousId" IS NOT NULL)));
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_state" CHECK (state IN ('IDLE','RUNNING','PAUSED','FINISHED','ABANDONED') AND action IN ('CREATE','EDIT','START','PAUSE','RESUME','FINISH','STOP') AND (state='RUNNING')=("runningSince" IS NOT NULL) AND "elapsedMs">=0 AND "elapsedMs"<=9007199254740991 AND "recordedAt">="createdAt" AND ("runningSince" IS NULL OR "runningSince"<="recordedAt"));
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_config" CHECK ((mode='STOPWATCH' AND "workMinutes" IS NULL AND "shortBreakMinutes" IS NULL AND "longBreakMinutes" IS NULL AND "longBreakEvery" IS NULL AND "workIntervals" IS NULL) OR (mode='POMODORO' AND "workMinutes" IS NOT NULL AND "workMinutes" BETWEEN 1 AND 180 AND "shortBreakMinutes" IS NOT NULL AND "shortBreakMinutes" BETWEEN 1 AND 60 AND "longBreakMinutes" IS NOT NULL AND "longBreakMinutes" BETWEEN 1 AND 120 AND "longBreakEvery" IS NOT NULL AND "longBreakEvery" BETWEEN 1 AND 16 AND "workIntervals" IS NOT NULL AND "workIntervals" BETWEEN 1 AND 16));
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_task_revision" CHECK (("taskId" IS NULL AND "selectedTaskRevision" IS NULL) OR ("taskId" IS NOT NULL AND "selectedTaskRevision" IS NOT NULL AND "selectedTaskRevision">0));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_identity" CHECK (revision>0 AND ((revision=1 AND id="logicalId" AND "previousId" IS NULL) OR (revision>1 AND id<>"logicalId" AND "previousId" IS NOT NULL)));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_values" CHECK (state IN ('RECORDED','VOID') AND "endAt">"startAt" AND "recordedAt">="createdAt" AND ((kind='MANUAL' AND "sessionId" IS NULL AND "segmentOrdinal" IS NULL AND "endAt"-"startAt"<=interval '7 days') OR (kind='TRACKED' AND state='RECORDED' AND "sessionId" IS NOT NULL AND "segmentOrdinal" IS NOT NULL AND "segmentOrdinal">=0 AND revision=1)));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_task_revision" CHECK (("taskId" IS NULL AND "selectedTaskRevision" IS NULL) OR ("taskId" IS NOT NULL AND "selectedTaskRevision" IS NOT NULL AND "selectedTaskRevision">0));
