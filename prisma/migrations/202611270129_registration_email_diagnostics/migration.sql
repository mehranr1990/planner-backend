BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "UserSettings"
 ADD COLUMN "firstRecordedLoginAt" timestamptz(3),
 ADD COLUMN "lastRecordedLoginAt" timestamptz(3),
 ADD COLUMN "signInHistoryComplete" boolean NOT NULL DEFAULT false,
 ADD COLUMN "signInEvidence" varchar(24) NOT NULL DEFAULT 'UNKNOWN',
 ADD COLUMN "emailVerifiedAt" timestamptz(3),
 ADD CONSTRAINT "UserSettings_login_evidence" CHECK (
   ("firstRecordedLoginAt" IS NULL)=("lastRecordedLoginAt" IS NULL)
   AND ("firstRecordedLoginAt" IS NULL OR "firstRecordedLoginAt"<="lastRecordedLoginAt")
   AND "signInEvidence" IN ('UNKNOWN','RETAINED_AUDIT','OBSERVED_AUTH'));
UPDATE "UserSettings" s SET "firstRecordedLoginAt"=a.first_at,
 "lastRecordedLoginAt"=a.last_at,"signInEvidence"='RETAINED_AUDIT'
 FROM (SELECT "actorUserId",min("occurredAt") first_at,max("occurredAt") last_at
 FROM "SecurityAuditEvent" WHERE action='AUTH_SIGN_IN' AND outcome='SUCCEEDED'
 AND "actorUserId" IS NOT NULL GROUP BY "actorUserId") a WHERE s."userId"=a."actorUserId";
CREATE INDEX "UserSettings_login_filter" ON "UserSettings"("lastRecordedLoginAt","userId");
CREATE FUNCTION diagnostics_sign_in_observed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action='AUTH_SIGN_IN' AND NEW.outcome='SUCCEEDED' AND NEW."actorUserId" IS NOT NULL
 AND (TG_OP='INSERT' OR OLD.outcome IS DISTINCT FROM NEW.outcome OR OLD."actorUserId" IS DISTINCT FROM NEW."actorUserId") THEN
  UPDATE "UserSettings" SET
   "firstRecordedLoginAt"=COALESCE("firstRecordedLoginAt",clock_timestamp()),
   "lastRecordedLoginAt"=clock_timestamp(),"signInEvidence"='OBSERVED_AUTH'
   WHERE "userId"=NEW."actorUserId";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SecurityAuditEvent_login_diagnostics" AFTER INSERT OR UPDATE OF outcome,"actorUserId"
 ON "SecurityAuditEvent" FOR EACH ROW EXECUTE FUNCTION diagnostics_sign_in_observed();
CREATE FUNCTION diagnostics_verification_observed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW."emailVerified" THEN
  UPDATE "UserSettings" SET "emailVerifiedAt"=NULL WHERE "userId"=NEW.id;
 ELSIF NOT OLD."emailVerified" OR NEW.email IS DISTINCT FROM OLD.email THEN
  UPDATE "UserSettings" SET "emailVerifiedAt"=clock_timestamp() WHERE "userId"=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "User_verification_diagnostics" AFTER UPDATE OF email,"emailVerified"
 ON "User" FOR EACH ROW EXECUTE FUNCTION diagnostics_verification_observed();
-- Historical creation times are unknown. The default applies only to new rows.
ALTER TABLE "ConversationEmailInvitation" ADD COLUMN "createdAt" timestamptz(3);
ALTER TABLE "ConversationEmailInvitation" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp();
ALTER TABLE "MeetingEmailInvitation" ADD COLUMN "createdAt" timestamptz(3);
ALTER TABLE "MeetingEmailInvitation" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp();
ALTER TABLE "AdminSecurityAlertDelivery" ADD COLUMN "createdAt" timestamptz(3);
ALTER TABLE "AdminSecurityAlertDelivery" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp();
ALTER TABLE "AdminOperationalDelivery" ADD COLUMN "createdAt" timestamptz(3);
ALTER TABLE "AdminOperationalDelivery" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp();
CREATE TABLE "SystemEmailObservation" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "sourceKind" varchar(32) NOT NULL CHECK ("sourceKind" IN ('DIRECT','CONTEXT_INVITATION','CONVERSATION_INVITATION','MEETING_INVITATION','ADMIN_DELIVERY','SECURITY_ALERT','OPERATIONAL_ALERT','COMMUNICATION','NOTICE','NOTIFICATION')),
 "sourceId" uuid NOT NULL,
 category varchar(40) NOT NULL CHECK(category IN ('REGISTRATION_VERIFICATION','PASSWORD_RECOVERY','EMAIL_CHANGE_VERIFICATION','PROJECT_INVITATION','TEAM_INVITATION','COMPANY_INVITATION','CONVERSATION_INVITATION','MEETING_INVITATION','SOCIAL_GROUP_INVITATION','SUPPORT','SECURITY_NOTICE','COMMUNICATIONS','SYSTEM_NOTICE','REMINDER')),
 recipient varchar(320),
 "userId" uuid REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 "adminUserId" uuid REFERENCES "AdminUser"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 state varchar(20) NOT NULL CHECK(state IN ('PROCESSING','SMTP_ACCEPTED','SINK_ACCEPTED','FAILED','UNKNOWN','BOUNCED')),
 code varchar(60),"providerReference" varchar(254),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "completedAt" timestamptz(3),
 CHECK(recipient IS NULL OR (recipient=lower(recipient) AND position(chr(10) in recipient)=0 AND position(chr(13) in recipient)=0)),
 CHECK(code IS NULL OR code IN ('SMTP_ACCEPTED','SINK_ACCEPTED','SMTP_REJECTED','SMTP_TEMPORARY','SMTP_ACCEPTANCE_UNKNOWN','MAIL_TRANSPORT_FAILED','WORKER_ACCEPTANCE_UNKNOWN')),
 CHECK("providerReference" IS NULL OR "providerReference" ~ '^[A-Za-z0-9@._<>+:/=-]{1,254}$')
);
CREATE INDEX "SystemEmailObservation_sourceKind_sourceId_createdAt_idx" ON "SystemEmailObservation"("sourceKind","sourceId","createdAt");
CREATE INDEX "SystemEmailObservation_userId_createdAt_idx" ON "SystemEmailObservation"("userId","createdAt");
CREATE INDEX "SystemEmailObservation_createdAt_id_idx" ON "SystemEmailObservation"("createdAt",id);
-- These references are detached operational evidence, never resource authority.
-- Source deletion and identity deletion remove metadata instead of orphaning PII.
CREATE FUNCTION diagnostics_email_source_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM "SystemEmailObservation" WHERE "sourceKind"=TG_ARGV[0] AND "sourceId"=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER "ContextInvitation_email_diagnostics_delete" AFTER DELETE ON "ContextInvitation" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('CONTEXT_INVITATION');
CREATE TRIGGER "ConversationEmailInvitation_email_diagnostics_delete" AFTER DELETE ON "ConversationEmailInvitation" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('CONVERSATION_INVITATION');
CREATE TRIGGER "MeetingEmailInvitation_email_diagnostics_delete" AFTER DELETE ON "MeetingEmailInvitation" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('MEETING_INVITATION');
CREATE TRIGGER "AdminDelivery_email_diagnostics_delete" AFTER DELETE ON "AdminDelivery" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('ADMIN_DELIVERY');
CREATE TRIGGER "AdminSecurityAlertDelivery_email_diagnostics_delete" AFTER DELETE ON "AdminSecurityAlertDelivery" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('SECURITY_ALERT');
CREATE TRIGGER "AdminOperationalDelivery_email_diagnostics_delete" AFTER DELETE ON "AdminOperationalDelivery" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('OPERATIONAL_ALERT');
CREATE TRIGGER "AdminCommunicationRecipient_email_diagnostics_delete" AFTER DELETE ON "AdminCommunicationRecipient" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('COMMUNICATION');
CREATE TRIGGER "P4Notice_email_diagnostics_delete" AFTER DELETE ON "P4Notice" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('NOTICE');
CREATE TRIGGER "NotificationDelivery_email_diagnostics_delete" AFTER DELETE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_source_deleted('NOTIFICATION');
CREATE FUNCTION diagnostics_email_user_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM "SystemEmailObservation" WHERE recipient=lower(OLD.email);
 RETURN OLD;
END $$;
CREATE TRIGGER "User_email_diagnostics_delete" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION diagnostics_email_user_deleted();
COMMIT;
