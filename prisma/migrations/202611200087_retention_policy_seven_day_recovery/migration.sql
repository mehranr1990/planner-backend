-- ADR 0069: SharedRetentionPolicy versions may declare the unified 7-day
-- recovery (604800 s). Historical 30-day versions remain valid; existing rows
-- and all stored lifecycle deadlines are unchanged.
BEGIN;
ALTER TABLE "SharedRetentionPolicy" DROP CONSTRAINT "SharedRetentionPolicy_configuration_check";
ALTER TABLE "SharedRetentionPolicy" ADD CONSTRAINT "SharedRetentionPolicy_configuration_check" CHECK (
  jsonb_typeof(configuration) = 'object'
  AND (
    configuration @> '{"sharedRecoverySeconds": 604800}'::jsonb
    OR configuration @> '{"sharedRecoverySeconds": 2592000}'::jsonb
  )
);
COMMIT;
