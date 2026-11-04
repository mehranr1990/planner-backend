BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Extend only the authoritative feature-key register; keep prior keys and all rows.
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check"
 CHECK (feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant'));
COMMIT;
