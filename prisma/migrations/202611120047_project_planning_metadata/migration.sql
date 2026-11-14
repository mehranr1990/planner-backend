BEGIN;
ALTER TABLE "Project" ADD COLUMN "startDate" date, ADD COLUMN "endDate" date, ADD COLUMN "statusNote" varchar(2000);
ALTER TABLE "Project" ADD CONSTRAINT "Project_planned_date_range" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate");
COMMIT;
