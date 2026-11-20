-- ADR 0069 (owner decision 2026-11-20): unified 7-day recovery. A deleted
-- task's restore deadline is persisted per row so changing the window never
-- shortens an existing deletion: rows already deleted keep their original
-- deadline (deletedAt + 30 days); new deletions store deletedAt + 7 days.
BEGIN;
ALTER TABLE "Task" ADD COLUMN "restoreUntil" timestamptz(3);
UPDATE "Task" SET "restoreUntil" = "deletedAt" + interval '30 days' WHERE "deletedAt" IS NOT NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_restoreUntil_check" CHECK (
  ("deletedAt" IS NULL) = ("restoreUntil" IS NULL)
  AND ("restoreUntil" IS NULL OR "restoreUntil" > "deletedAt")
);
COMMIT;
