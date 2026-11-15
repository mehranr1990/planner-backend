ALTER TABLE "UserSettings" ADD COLUMN "workingHours" JSONB;
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_workingHours_object" CHECK ("workingHours" IS NULL OR jsonb_typeof("workingHours") = 'object');
