-- Additive P1-02: preserve every Task and all existing migration history.
ALTER TABLE "IdempotencyRecord" ADD COLUMN "result" JSONB;

CREATE TABLE "TaskTemplate" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "values" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskTemplate_invariants" CHECK (revision > 0 AND length(btrim(name)) > 0 AND jsonb_typeof("values") = 'object' AND "values"->>'version' = '1')
);
CREATE TABLE "SavedTaskFilter" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "query" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SavedTaskFilter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedTaskFilter_invariants" CHECK (revision > 0 AND length(btrim(name)) > 0 AND jsonb_typeof("query") = 'object' AND "query"->>'version' = '1')
);
CREATE TABLE "TaskRecurrence" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "masterTaskId" UUID NOT NULL,
  "previousSeriesId" UUID,
  "definition" JSONB NOT NULL,
  "identityTime" VARCHAR(5) NOT NULL,
  "splitBefore" DATE,
  "gapPolicy" VARCHAR(30) NOT NULL DEFAULT 'SKIP_WITH_REASON',
  "foldPolicy" VARCHAR(20) NOT NULL DEFAULT 'EARLIER',
  "shortMonthPolicy" VARCHAR(20) NOT NULL DEFAULT 'SKIP',
  "leapDayPolicy" VARCHAR(20) NOT NULL DEFAULT 'SKIP',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "scannedThrough" DATE,
  "retiredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "TaskRecurrence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskRecurrence_invariants" CHECK (
    revision > 0 AND "gapPolicy" = 'SKIP_WITH_REASON' AND "foldPolicy" = 'EARLIER'
    AND "shortMonthPolicy" = 'SKIP' AND "leapDayPolicy" = 'SKIP'
    AND "identityTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND ("previousSeriesId" IS NULL OR "previousSeriesId" <> id)
    AND jsonb_typeof(definition) = 'object'
    AND ("splitBefore" IS NULL OR "retiredAt" IS NOT NULL)
  )
);
CREATE TABLE "TaskOccurrence" (
  "id" UUID NOT NULL,
  "spaceId" UUID NOT NULL,
  "seriesId" UUID NOT NULL,
  "taskId" UUID,
  "recurrenceKey" VARCHAR(19) NOT NULL,
  "localDate" DATE NOT NULL,
  "localTime" VARCHAR(5) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3),
  "state" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(30),
  "exception" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "TaskOccurrence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskOccurrence_invariants" CHECK (
    revision > 0 AND state IN ('PENDING','DONE','SKIPPED','CANCELED')
    AND "recurrenceKey" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:00$'
    AND "localTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND length(timezone) > 0
    AND ((state IN ('PENDING','DONE')) = (reason IS NULL))
    AND (reason IS NULL OR reason IN ('DST_GAP','USER_SKIP','USER_CANCEL','SERIES_EDIT','SERIES_SPLIT','SERIES_CANCELED','TASK_DELETED'))
    AND ((state IN ('PENDING','DONE') AND reason IS NULL AND "taskId" IS NOT NULL AND "scheduledAt" IS NOT NULL)
      OR (state = 'SKIPPED' AND reason IN ('DST_GAP','USER_SKIP'))
      OR (state = 'CANCELED' AND reason IN ('USER_CANCEL','SERIES_EDIT','SERIES_SPLIT','SERIES_CANCELED','TASK_DELETED')))
    AND ("taskId" IS NOT NULL OR (state = 'SKIPPED' AND reason = 'DST_GAP'))
  )
);

CREATE UNIQUE INDEX "TaskTemplate_spaceId_id_key" ON "TaskTemplate"("spaceId", "id");
CREATE INDEX "TaskTemplate_spaceId_createdAt_id_idx" ON "TaskTemplate"("spaceId", "createdAt", "id");
CREATE UNIQUE INDEX "SavedTaskFilter_spaceId_id_key" ON "SavedTaskFilter"("spaceId", "id");
CREATE INDEX "SavedTaskFilter_spaceId_createdAt_id_idx" ON "SavedTaskFilter"("spaceId", "createdAt", "id");
CREATE UNIQUE INDEX "TaskRecurrence_masterTaskId_key" ON "TaskRecurrence"("masterTaskId");
CREATE UNIQUE INDEX "TaskRecurrence_previousSeriesId_key" ON "TaskRecurrence"("previousSeriesId");
CREATE UNIQUE INDEX "TaskRecurrence_spaceId_id_key" ON "TaskRecurrence"("spaceId", "id");
CREATE UNIQUE INDEX "TaskRecurrence_spaceId_masterTaskId_key" ON "TaskRecurrence"("spaceId", "masterTaskId");
CREATE UNIQUE INDEX "TaskRecurrence_spaceId_previousSeriesId_key" ON "TaskRecurrence"("spaceId", "previousSeriesId");
CREATE INDEX "TaskRecurrence_spaceId_createdAt_id_idx" ON "TaskRecurrence"("spaceId", "createdAt", "id");
CREATE UNIQUE INDEX "TaskOccurrence_taskId_key" ON "TaskOccurrence"("taskId");
CREATE UNIQUE INDEX "TaskOccurrence_spaceId_id_key" ON "TaskOccurrence"("spaceId", "id");
CREATE UNIQUE INDEX "TaskOccurrence_spaceId_taskId_key" ON "TaskOccurrence"("spaceId", "taskId");
CREATE UNIQUE INDEX "TaskOccurrence_seriesId_recurrenceKey_key" ON "TaskOccurrence"("seriesId", "recurrenceKey");
CREATE INDEX "TaskOccurrence_spaceId_seriesId_createdAt_id_idx" ON "TaskOccurrence"("spaceId", "seriesId", "createdAt", "id");
CREATE INDEX "TaskOccurrence_spaceId_state_localDate_id_idx" ON "TaskOccurrence"("spaceId", "state", "localDate", "id");

ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedTaskFilter" ADD CONSTRAINT "SavedTaskFilter_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_spaceId_masterTaskId_fkey" FOREIGN KEY ("spaceId", "masterTaskId") REFERENCES "Task"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_spaceId_previousSeriesId_fkey" FOREIGN KEY ("spaceId", "previousSeriesId") REFERENCES "TaskRecurrence"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_spaceId_seriesId_fkey" FOREIGN KEY ("spaceId", "seriesId") REFERENCES "TaskRecurrence"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
