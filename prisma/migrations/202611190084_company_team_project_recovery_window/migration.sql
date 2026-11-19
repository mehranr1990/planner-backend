-- ADR 0029 amendment (owner-approved 2026-11-19): Company/Team/Project closures
-- recover for 7 days; Social Group, Conversation and Meeting keep 30. The row has
-- no custody kind, so the database accepts exactly either window and the kernel
-- (recoveryWindowMs) selects it per kind. Existing rows already satisfy 720 hours;
-- no data is changed.
BEGIN;
ALTER TABLE "SharedLifecycleJob" DROP CONSTRAINT "SharedLifecycleJob_check1";
ALTER TABLE "SharedLifecycleJob" ADD CONSTRAINT "SharedLifecycleJob_recovery_window" CHECK (
  "recoveryDeadline" - "effectiveDepartureAt" IN (interval '168 hours', interval '720 hours')
);
COMMIT;
