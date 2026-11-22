-- Independent manual status: all predecessor Projects deterministically start PLANNED.
-- No lifecycle, task completion, revision or progress data is changed.
ALTER TABLE "Project" ADD COLUMN "manualStatus" VARCHAR(9) NOT NULL DEFAULT 'PLANNED';
ALTER TABLE "Project" ADD CONSTRAINT "Project_manual_status_check"
  CHECK ("manualStatus" IN ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'));
CREATE INDEX "Project_manual_status_id" ON "Project" ("manualStatus", "id");
