-- Forward-only strengthening after the first isolated calendar migration test.
-- PostgreSQL CHECK accepts UNKNOWN, so require the linked revision explicitly.
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_link_revision_required" CHECK ("taskId" IS NULL OR ("selectedTaskRevision" IS NOT NULL AND "selectedTaskRevision" BETWEEN 1 AND 2147483646));
ALTER TABLE "EventRecurrence" ADD CONSTRAINT "EventRecurrence_version_required" CHECK (definition ? 'version' AND definition->>'version'='1');
