BEGIN;
ALTER TABLE "ProjectTask" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_position_check" CHECK ("position" BETWEEN 0 AND 1000000);
CREATE INDEX "ProjectTask_section_order" ON "ProjectTask" ("spaceId","scopeId","projectId","sectionId","position","taskId");
ALTER TABLE "ProjectPhase" ADD COLUMN "startDate" DATE, ADD COLUMN "endDate" DATE;
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_date_order" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate");
COMMIT;
