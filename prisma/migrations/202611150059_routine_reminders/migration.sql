ALTER TABLE "Reminder" ADD COLUMN "routineId" UUID;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_routine_fkey" FOREIGN KEY ("spaceId","routineId") REFERENCES "Routine"("spaceId","id") ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX "Reminder_spaceId_routineId_idx" ON "Reminder" ("spaceId","routineId");
