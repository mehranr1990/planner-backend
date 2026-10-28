-- CreateTable
CREATE TABLE "NoteFolder" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "parentId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "state" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NoteFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "logicalId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "previousId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "content" TEXT NOT NULL,
    "contentFormat" VARCHAR(10) NOT NULL DEFAULT 'MARKDOWN',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "state" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    "folderId" UUID,
    "taskId" UUID,
    "goalId" UUID,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "logicalId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "previousId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "title" VARCHAR(300),
    "content" TEXT NOT NULL,
    "contentFormat" VARCHAR(10) NOT NULL DEFAULT 'MARKDOWN',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "kind" VARCHAR(10) NOT NULL,
    "localDate" DATE NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodEntry" (
    "id" UUID NOT NULL,
    "logicalId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "previousId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "mood" INTEGER NOT NULL,
    "energy" INTEGER,
    "note" TEXT,
    "localDate" DATE NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "state" VARCHAR(10) NOT NULL DEFAULT 'RECORDED',
    "journalEntryId" UUID,

    CONSTRAINT "MoodEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureItem" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "text" TEXT NOT NULL,
    "voiceFileId" UUID,
    "state" VARCHAR(10) NOT NULL DEFAULT 'INBOX',
    "targetTaskId" UUID,
    "targetNoteId" UUID,
    "targetJournalId" UUID,
    "targetHabitId" UUID,
    "targetHabitEntryId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CaptureItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteFolder_spaceId_createdAt_id_idx" ON "NoteFolder"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "NoteFolder_spaceId_parentId_idx" ON "NoteFolder"("spaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "NoteFolder_spaceId_id_key" ON "NoteFolder"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Note_previousId_key" ON "Note"("previousId");

-- CreateIndex
CREATE INDEX "Note_spaceId_current_createdAt_logicalId_idx" ON "Note"("spaceId", "current", "createdAt", "logicalId");

-- CreateIndex
CREATE INDEX "Note_spaceId_logicalId_revision_idx" ON "Note"("spaceId", "logicalId", "revision");

-- CreateIndex
CREATE INDEX "Note_spaceId_folderId_current_idx" ON "Note"("spaceId", "folderId", "current");

-- CreateIndex
CREATE INDEX "Note_spaceId_taskId_idx" ON "Note"("spaceId", "taskId");

-- CreateIndex
CREATE INDEX "Note_spaceId_goalId_idx" ON "Note"("spaceId", "goalId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_spaceId_id_key" ON "Note"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Note_spaceId_logicalId_id_key" ON "Note"("spaceId", "logicalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Note_spaceId_logicalId_previousId_key" ON "Note"("spaceId", "logicalId", "previousId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_logicalId_revision_key" ON "Note"("logicalId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_previousId_key" ON "JournalEntry"("previousId");

-- CreateIndex
CREATE INDEX "JournalEntry_spaceId_current_createdAt_logicalId_idx" ON "JournalEntry"("spaceId", "current", "createdAt", "logicalId");

-- CreateIndex
CREATE INDEX "JournalEntry_spaceId_logicalId_revision_idx" ON "JournalEntry"("spaceId", "logicalId", "revision");

-- CreateIndex
CREATE INDEX "JournalEntry_spaceId_current_localDate_idx" ON "JournalEntry"("spaceId", "current", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_spaceId_id_key" ON "JournalEntry"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_spaceId_logicalId_id_key" ON "JournalEntry"("spaceId", "logicalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_spaceId_logicalId_previousId_key" ON "JournalEntry"("spaceId", "logicalId", "previousId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_logicalId_revision_key" ON "JournalEntry"("logicalId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "MoodEntry_previousId_key" ON "MoodEntry"("previousId");

-- CreateIndex
CREATE INDEX "MoodEntry_spaceId_current_createdAt_logicalId_idx" ON "MoodEntry"("spaceId", "current", "createdAt", "logicalId");

-- CreateIndex
CREATE INDEX "MoodEntry_spaceId_logicalId_revision_idx" ON "MoodEntry"("spaceId", "logicalId", "revision");

-- CreateIndex
CREATE INDEX "MoodEntry_spaceId_current_localDate_idx" ON "MoodEntry"("spaceId", "current", "localDate");

-- CreateIndex
CREATE INDEX "MoodEntry_spaceId_journalEntryId_idx" ON "MoodEntry"("spaceId", "journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "MoodEntry_spaceId_id_key" ON "MoodEntry"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MoodEntry_spaceId_logicalId_id_key" ON "MoodEntry"("spaceId", "logicalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MoodEntry_spaceId_logicalId_previousId_key" ON "MoodEntry"("spaceId", "logicalId", "previousId");

-- CreateIndex
CREATE UNIQUE INDEX "MoodEntry_logicalId_revision_key" ON "MoodEntry"("logicalId", "revision");

-- CreateIndex
CREATE INDEX "CaptureItem_spaceId_state_createdAt_id_idx" ON "CaptureItem"("spaceId", "state", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_spaceId_id_key" ON "CaptureItem"("spaceId", "id");

-- AddForeignKey
ALTER TABLE "NoteFolder" ADD CONSTRAINT "NoteFolder_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteFolder" ADD CONSTRAINT "NoteFolder_spaceId_parentId_fkey" FOREIGN KEY ("spaceId", "parentId") REFERENCES "NoteFolder"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_spaceId_folderId_fkey" FOREIGN KEY ("spaceId", "folderId") REFERENCES "NoteFolder"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_spaceId_goalId_fkey" FOREIGN KEY ("spaceId", "goalId") REFERENCES "Goal"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_spaceId_logicalId_fkey" FOREIGN KEY ("spaceId", "logicalId") REFERENCES "Note"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_spaceId_logicalId_previousId_fkey" FOREIGN KEY ("spaceId", "logicalId", "previousId") REFERENCES "Note"("spaceId", "logicalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_spaceId_logicalId_fkey" FOREIGN KEY ("spaceId", "logicalId") REFERENCES "JournalEntry"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_spaceId_logicalId_previousId_fkey" FOREIGN KEY ("spaceId", "logicalId", "previousId") REFERENCES "JournalEntry"("spaceId", "logicalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MoodEntry" ADD CONSTRAINT "MoodEntry_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodEntry" ADD CONSTRAINT "MoodEntry_spaceId_journalEntryId_fkey" FOREIGN KEY ("spaceId", "journalEntryId") REFERENCES "JournalEntry"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MoodEntry" ADD CONSTRAINT "MoodEntry_spaceId_logicalId_fkey" FOREIGN KEY ("spaceId", "logicalId") REFERENCES "MoodEntry"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MoodEntry" ADD CONSTRAINT "MoodEntry_spaceId_logicalId_previousId_fkey" FOREIGN KEY ("spaceId", "logicalId", "previousId") REFERENCES "MoodEntry"("spaceId", "logicalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_createdByUserId_fkey" FOREIGN KEY ("spaceId", "createdByUserId") REFERENCES "Space"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_voiceFileId_fkey" FOREIGN KEY ("spaceId", "voiceFileId") REFERENCES "StoredFile"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_targetTaskId_fkey" FOREIGN KEY ("spaceId", "targetTaskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_targetNoteId_fkey" FOREIGN KEY ("spaceId", "targetNoteId") REFERENCES "Note"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_targetJournalId_fkey" FOREIGN KEY ("spaceId", "targetJournalId") REFERENCES "JournalEntry"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_targetHabitId_fkey" FOREIGN KEY ("spaceId", "targetHabitId") REFERENCES "Habit"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_spaceId_targetHabitId_targetHabitEntryId_fkey" FOREIGN KEY ("spaceId", "targetHabitId", "targetHabitEntryId") REFERENCES "HabitEntry"("spaceId", "habitId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "Note_current_logical" ON "Note" ("logicalId") WHERE current;
ALTER TABLE "Note" ADD CONSTRAINT "Note_identity" CHECK (revision>0 AND ((revision=1 AND id="logicalId" AND "previousId" IS NULL) OR (revision>1 AND id<>"logicalId" AND "previousId" IS NOT NULL)) AND "recordedAt">="createdAt");

CREATE UNIQUE INDEX "JournalEntry_current_logical" ON "JournalEntry" ("logicalId") WHERE current;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_identity" CHECK (revision>0 AND ((revision=1 AND id="logicalId" AND "previousId" IS NULL) OR (revision>1 AND id<>"logicalId" AND "previousId" IS NOT NULL)) AND "recordedAt">="createdAt");

CREATE UNIQUE INDEX "MoodEntry_current_logical" ON "MoodEntry" ("logicalId") WHERE current;
ALTER TABLE "MoodEntry" ADD CONSTRAINT "MoodEntry_identity" CHECK (revision>0 AND ((revision=1 AND id="logicalId" AND "previousId" IS NULL) OR (revision>1 AND id<>"logicalId" AND "previousId" IS NOT NULL)) AND "recordedAt">="createdAt");

CREATE UNIQUE INDEX "JournalEntry_daily_checkin" ON "JournalEntry" ("spaceId","localDate") WHERE current AND NOT deleted AND kind='CHECK_IN';
CREATE UNIQUE INDEX "MoodEntry_journal_current" ON "MoodEntry" ("spaceId","journalEntryId") WHERE current AND state='RECORDED' AND "journalEntryId" IS NOT NULL;
ALTER TABLE "NoteFolder" ADD CONSTRAINT "NoteFolder_values" CHECK (revision>0 AND position BETWEEN 0 AND 9999 AND state IN ('ACTIVE','ARCHIVED') AND "parentId" IS DISTINCT FROM id);
ALTER TABLE "Note" ADD CONSTRAINT "Note_content_values" CHECK (state IN ('ACTIVE','ARCHIVED','DELETED') AND "contentFormat"='MARKDOWN' AND "contentVersion"=1 AND char_length(content)<=50000 AND octet_length(content)<=100000);
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_content_values" CHECK (kind IN ('FREEFORM','CHECK_IN') AND "contentFormat"='MARKDOWN' AND "contentVersion"=1 AND char_length(content)<=50000 AND octet_length(content)<=100000);
ALTER TABLE "MoodEntry" ADD CONSTRAINT "MoodEntry_values" CHECK (mood BETWEEN 1 AND 5 AND (energy IS NULL OR energy BETWEEN 1 AND 5) AND state IN ('RECORDED','VOID') AND (note IS NULL OR (char_length(note)<=50000 AND octet_length(note)<=100000)));
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_values" CHECK (revision>0 AND type IN ('TASK','NOTE','EXPENSE','HABIT_LOG','JOURNAL','VOICE_MEMO','DRAFT') AND state IN ('INBOX','TRIAGED','ARCHIVED') AND char_length(text)<=50000 AND octet_length(text)<=100000 AND ((type='VOICE_MEMO' AND "voiceFileId" IS NOT NULL) OR (type<>'VOICE_MEMO' AND char_length(btrim(text))>0)));
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_target_values" CHECK ((state='TRIAGED' AND num_nonnulls("targetTaskId","targetNoteId","targetJournalId","targetHabitEntryId")=1) OR (state IN ('INBOX','ARCHIVED') AND num_nonnulls("targetTaskId","targetNoteId","targetJournalId","targetHabitEntryId")=0));
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_habit_target" CHECK (("targetHabitId" IS NULL)=("targetHabitEntryId" IS NULL));
