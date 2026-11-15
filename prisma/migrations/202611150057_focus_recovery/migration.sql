ALTER TABLE "FocusSession" ADD COLUMN "recovery" JSONB;
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_recovery_object" CHECK ("recovery" IS NULL OR jsonb_typeof("recovery") = 'object');
