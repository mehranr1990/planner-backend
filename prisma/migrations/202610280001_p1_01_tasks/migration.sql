-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "descriptionContent" TEXT,
    "descriptionFormat" VARCHAR(20) NOT NULL DEFAULT 'MARKDOWN',
    "descriptionVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "parentTaskId" UUID,
    "plannedStartAt" TIMESTAMPTZ(3),
    "dueAt" TIMESTAMPTZ(3),
    "scheduledDate" DATE,
    "completedAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "deletionBatchId" UUID,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskChecklistItem" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskLabel" (
    "spaceId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "labelId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLabel_pkey" PRIMARY KEY ("spaceId","taskId","labelId")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "spaceId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("spaceId","taskId","fileId")
);

-- CreateTable
CREATE TABLE "TaskChange" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "fields" TEXT[] NOT NULL,
    "previousRevision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "beforeStatus" "TaskStatus",
    "afterStatus" "TaskStatus" NOT NULL,
    "beforePriority" "TaskPriority",
    "afterPriority" "TaskPriority" NOT NULL,
    "relatedId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_spaceId_deletedAt_createdAt_id_idx" ON "Task"("spaceId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Task_spaceId_parentTaskId_deletedAt_createdAt_id_idx" ON "Task"("spaceId", "parentTaskId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Task_spaceId_status_deletedAt_createdAt_id_idx" ON "Task"("spaceId", "status", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Task_spaceId_dueAt_idx" ON "Task"("spaceId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_spaceId_id_key" ON "Task"("spaceId", "id");

-- CreateIndex
CREATE INDEX "TaskChecklistItem_spaceId_taskId_position_id_idx" ON "TaskChecklistItem"("spaceId", "taskId", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaskChecklistItem_spaceId_id_key" ON "TaskChecklistItem"("spaceId", "id");

-- CreateIndex
CREATE INDEX "Label_spaceId_createdAt_id_idx" ON "Label"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Label_spaceId_id_key" ON "Label"("spaceId", "id");

-- CreateIndex
CREATE INDEX "TaskLabel_spaceId_labelId_taskId_idx" ON "TaskLabel"("spaceId", "labelId", "taskId");

-- CreateIndex
CREATE INDEX "TaskAttachment_spaceId_taskId_createdAt_fileId_idx" ON "TaskAttachment"("spaceId", "taskId", "createdAt", "fileId");

-- CreateIndex
CREATE INDEX "TaskChange_spaceId_taskId_revision_id_idx" ON "TaskChange"("spaceId", "taskId", "revision", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaskChange_spaceId_taskId_revision_key" ON "TaskChange"("spaceId", "taskId", "revision");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_spaceId_parentTaskId_fkey" FOREIGN KEY ("spaceId", "parentTaskId") REFERENCES "Task"("spaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_spaceId_labelId_fkey" FOREIGN KEY ("spaceId", "labelId") REFERENCES "Label"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_spaceId_fileId_fkey" FOREIGN KEY ("spaceId", "fileId") REFERENCES "StoredFile"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChange" ADD CONSTRAINT "TaskChange_spaceId_taskId_fkey" FOREIGN KEY ("spaceId", "taskId") REFERENCES "Task"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChange" ADD CONSTRAINT "TaskChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Domain invariants and case-insensitive names cannot all be expressed by Prisma.
ALTER TABLE "Task" ADD CONSTRAINT "Task_invariants" CHECK (
  revision > 0 AND length(btrim(title)) > 0 AND "descriptionFormat" = 'MARKDOWN' AND "descriptionVersion" = 1
  AND ("descriptionContent" IS NULL OR length("descriptionContent") <= 20000)
  AND ((status = 'DONE') = ("completedAt" IS NOT NULL))
  AND (("deletedAt" IS NULL) = ("deletionBatchId" IS NULL))
  AND ("parentTaskId" IS NULL OR "parentTaskId" <> id)
);
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_invariants" CHECK (length(btrim(title)) > 0 AND position BETWEEN 0 AND 2147483000);
ALTER TABLE "Label" ADD CONSTRAINT "Label_invariants" CHECK (length(btrim(name)) > 0 AND revision > 0);
CREATE UNIQUE INDEX "Label_spaceId_name_ci_key" ON "Label" ("spaceId", lower(name));
ALTER TABLE "TaskChange" ADD CONSTRAINT "TaskChange_invariants" CHECK (
  "previousRevision" >= 0 AND revision = "previousRevision" + 1
  AND (("previousRevision" = 0) = ("beforeStatus" IS NULL))
  AND (("previousRevision" = 0) = ("beforePriority" IS NULL))
  AND kind IN ('CREATED','UPDATED','COMPLETED','REOPENED','DELETED','RESTORED','CHECKLIST_CREATED','CHECKLIST_UPDATED','CHECKLIST_DELETED','LABEL_ADDED','LABEL_REMOVED','ATTACHMENT_BOUND','ATTACHMENT_UNBOUND')
  AND cardinality(fields) BETWEEN 1 AND 13
  AND fields <@ ARRAY['title','description','status','priority','parentTaskId','plannedStartAt','dueAt','scheduledDate','completedAt','deletedAt','checklistItems','labels','attachments']::text[]
);
