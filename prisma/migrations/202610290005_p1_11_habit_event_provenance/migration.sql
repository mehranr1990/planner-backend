BEGIN;

ALTER TABLE "HabitEntry" ADD COLUMN "sourceEventId" UUID;
CREATE UNIQUE INDEX "HabitEntry_sourceEventId_key" ON "HabitEntry"("sourceEventId");
CREATE UNIQUE INDEX "HabitEntry_spaceId_sourceEventId_key" ON "HabitEntry"("spaceId","sourceEventId");
ALTER TABLE "HabitEntry" ADD CONSTRAINT "HabitEntry_spaceId_sourceEventId_fkey" FOREIGN KEY ("spaceId","sourceEventId") REFERENCES "OutboxEvent"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT;
