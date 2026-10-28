-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "kind" VARCHAR(10) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "localStart" VARCHAR(16),
    "localEnd" VARCHAR(16),
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "seriesId" UUID,
    "recurrenceKey" VARCHAR(16),
    "previousSeriesId" UUID,
    "splitBefore" VARCHAR(16),

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRecurrence" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "kind" VARCHAR(10) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "localStart" VARCHAR(16),
    "localEnd" VARCHAR(16),
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "eventId" UUID NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "identityTime" VARCHAR(5) NOT NULL,
    "fromKey" VARCHAR(16) NOT NULL,
    "untilKey" VARCHAR(16),

    CONSTRAINT "EventRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeBlock" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "kind" VARCHAR(10) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "localStart" VARCHAR(16),
    "localEnd" VARCHAR(16),
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "taskId" UUID,
    "selectedTaskRevision" INTEGER,

    CONSTRAINT "TimeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_spaceId_seriesId_deletedAt_createdAt_id_idx" ON "CalendarEvent"("spaceId", "seriesId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CalendarEvent_spaceId_startAt_endAt_idx" ON "CalendarEvent"("spaceId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_spaceId_startDate_endDate_idx" ON "CalendarEvent"("spaceId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_spaceId_id_key" ON "CalendarEvent"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_seriesId_recurrenceKey_key" ON "CalendarEvent"("seriesId", "recurrenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_spaceId_previousSeriesId_key" ON "CalendarEvent"("spaceId", "previousSeriesId");

-- CreateIndex
CREATE INDEX "EventRecurrence_spaceId_eventId_fromKey_untilKey_idx" ON "EventRecurrence"("spaceId", "eventId", "fromKey", "untilKey");

-- CreateIndex
CREATE UNIQUE INDEX "EventRecurrence_spaceId_id_key" ON "EventRecurrence"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EventRecurrence_eventId_revision_key" ON "EventRecurrence"("eventId", "revision");

-- CreateIndex
CREATE INDEX "TimeBlock_spaceId_deletedAt_createdAt_id_idx" ON "TimeBlock"("spaceId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TimeBlock_spaceId_startAt_endAt_idx" ON "TimeBlock"("spaceId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "TimeBlock_spaceId_taskId_idx" ON "TimeBlock"("spaceId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeBlock_spaceId_id_key" ON "TimeBlock"("spaceId", "id");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_spaceId_seriesId_fkey" FOREIGN KEY ("spaceId", "seriesId") REFERENCES "CalendarEvent"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_spaceId_previousSeriesId_fkey" FOREIGN KEY ("spaceId", "previousSeriesId") REFERENCES "CalendarEvent"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EventRecurrence" ADD CONSTRAINT "EventRecurrence_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRecurrence" ADD CONSTRAINT "EventRecurrence_spaceId_eventId_fkey" FOREIGN KEY ("spaceId", "eventId") REFERENCES "CalendarEvent"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Reviewed invariants: separate civil dates from instants and reject invalid intervals.
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_revision_status_check" CHECK ("revision" BETWEEN 1 AND 2147483646 AND status IN ('ACTIVE','CANCELED') AND length(btrim(title)) > 0 AND length(timezone) > 0);
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_schedule_check" CHECK (
 (kind='ALL_DAY' AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate">"startDate" AND "endDate"-"startDate"<=366 AND "localStart" IS NULL AND "localEnd" IS NULL AND "startAt" IS NULL AND "endAt" IS NULL)
 OR (kind='TIMED' AND "startDate" IS NULL AND "endDate" IS NULL AND "localStart" IS NOT NULL AND "localEnd" IS NOT NULL AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "endAt">"startAt" AND "endAt"-"startAt"<=interval '366 days' AND "localStart" ~ '^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d$' AND "localEnd" ~ '^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d$')
);

-- Reviewed invariants: separate civil dates from instants and reject invalid intervals.
ALTER TABLE "EventRecurrence" ADD CONSTRAINT "EventRecurrence_revision_status_check" CHECK ("revision" BETWEEN 1 AND 2147483646 AND status IN ('ACTIVE','CANCELED') AND length(btrim(title)) > 0 AND length(timezone) > 0);
ALTER TABLE "EventRecurrence" ADD CONSTRAINT "EventRecurrence_schedule_check" CHECK (
 (kind='ALL_DAY' AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate">"startDate" AND "endDate"-"startDate"<=366 AND "localStart" IS NULL AND "localEnd" IS NULL AND "startAt" IS NULL AND "endAt" IS NULL)
 OR (kind='TIMED' AND "startDate" IS NULL AND "endDate" IS NULL AND "localStart" IS NOT NULL AND "localEnd" IS NOT NULL AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "endAt">"startAt" AND "endAt"-"startAt"<=interval '366 days' AND "localStart" ~ '^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d$' AND "localEnd" ~ '^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d$')
);

-- Reviewed invariants: separate civil dates from instants and reject invalid intervals.
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_revision_status_check" CHECK ("revision" BETWEEN 1 AND 2147483646 AND status IN ('ACTIVE','CANCELED') AND length(btrim(title)) > 0 AND length(timezone) > 0);
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_schedule_check" CHECK (
 (kind='ALL_DAY' AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate">"startDate" AND "endDate"-"startDate"<=366 AND "localStart" IS NULL AND "localEnd" IS NULL AND "startAt" IS NULL AND "endAt" IS NULL)
 OR (kind='TIMED' AND "startDate" IS NULL AND "endDate" IS NULL AND "localStart" IS NOT NULL AND "localEnd" IS NOT NULL AND "startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "endAt">"startAt" AND "endAt"-"startAt"<=interval '366 days' AND "localStart" ~ '^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d$' AND "localEnd" ~ '^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d$')
);
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_exception_check" CHECK (("seriesId" IS NULL)=("recurrenceKey" IS NULL) AND ("seriesId" IS NULL OR ("seriesId"<>id AND "previousSeriesId" IS NULL AND "splitBefore" IS NULL)) AND ("previousSeriesId" IS NULL OR "previousSeriesId"<>id));
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_task_check" CHECK (kind='TIMED' AND (("taskId" IS NULL AND "selectedTaskRevision" IS NULL) OR ("taskId" IS NOT NULL AND "selectedTaskRevision">0)));
ALTER TABLE "EventRecurrence" ADD CONSTRAINT "EventRecurrence_definition_check" CHECK (jsonb_typeof(definition)='object' AND definition->>'version'='1' AND "identityTime" ~ '^([01]\d|2[0-3]):[0-5]\d$' AND ("untilKey" IS NULL OR "untilKey">="fromKey"));
CREATE UNIQUE INDEX "EventRecurrence_one_current" ON "EventRecurrence" ("eventId") WHERE "untilKey" IS NULL;
