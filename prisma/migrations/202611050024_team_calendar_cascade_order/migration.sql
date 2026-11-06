BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Preserve the existing Personal composite-FK cascade before checking the new direct boundary.
-- Shared Space deletion remains governed by its existing custody/lifecycle guards.
ALTER TABLE "CalendarEvent" ALTER CONSTRAINT "CalendarEvent_boundary" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "EventRecurrence" ALTER CONSTRAINT "EventRecurrence_boundary" DEFERRABLE INITIALLY DEFERRED;
COMMIT;
