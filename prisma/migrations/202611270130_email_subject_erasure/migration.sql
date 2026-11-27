BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Intended provider subject is evidence, never an admission or lookup capability.
-- Credential callbacks may precede the provider User commit, so this reference
-- cannot be an immediate FK. Visible committed users retain the existing FK too.
ALTER TABLE "SystemEmailObservation" ADD COLUMN "subjectUserId" uuid;
CREATE INDEX "SystemEmailObservation_subjectUserId_createdAt_idx" ON "SystemEmailObservation"("subjectUserId","createdAt");
UPDATE "SystemEmailObservation" SET "subjectUserId"="userId" WHERE "userId" IS NOT NULL;
CREATE OR REPLACE FUNCTION diagnostics_email_user_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM "SystemEmailObservation" WHERE "subjectUserId"=OLD.id OR recipient=lower(OLD.email);
 RETURN OLD;
END $$;
COMMIT;
