-- M042 / owner-approved ADR 0047: private media, personal receipts and safe notices.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "NotificationPreference" ADD COLUMN "messagingWebPush" boolean NOT NULL DEFAULT false,
 ADD COLUMN "messagingEnabledAt" timestamptz(3),ADD CONSTRAINT "NotificationPreference_messaging_consent" CHECK (NOT "messagingWebPush" OR "messagingEnabledAt" IS NOT NULL);
ALTER TABLE "ConversationInvitation" ADD CONSTRAINT "ConversationInvitation_identity_key" UNIQUE ("conversationId",id);
CREATE TABLE "MessageAttachment" (
 "retiredAt" timestamptz(3),
 "id" uuid NOT NULL PRIMARY KEY,
 "fileId" uuid NOT NULL UNIQUE,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "conversationId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "messageId" uuid,
 "kind" varchar(5) NOT NULL,
 "durationMs" integer,
 "keyHash" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("conversationId","memberId","generation","keyHash"),
 UNIQUE ("conversationId","id"));
CREATE TABLE "MessageMedia" (
 "messageId" uuid NOT NULL PRIMARY KEY,
 "caption" text);
CREATE TABLE "MessageMediaRevision" (
 "messageId" uuid NOT NULL,
 "revision" integer NOT NULL,
 "caption" text,
 "editedAt" timestamptz(3) NOT NULL,
 PRIMARY KEY ("messageId","revision"));
CREATE TABLE "MessageProgress" (
 "conversationId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "deliveredThrough" bigint NOT NULL,
 "readThrough" bigint NOT NULL,
 "shareReceipts" boolean NOT NULL DEFAULT false,
 "revision" integer NOT NULL DEFAULT 1,
 PRIMARY KEY ("memberId","generation"));
CREATE TABLE "MessageNoticePreference" (
 "conversationId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "mode" varchar(13) NOT NULL DEFAULT 'ALL',
 "quietStart" varchar(5),
 "quietEnd" varchar(5),
 "mentionQuiet" boolean NOT NULL DEFAULT false,
 "effectiveAt" timestamptz(3) NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 PRIMARY KEY ("memberId","generation"));
CREATE TABLE "MessagePersonalMutation" (
 "conversationId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "keyHash" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 PRIMARY KEY ("memberId","generation","keyHash"));
CREATE TABLE "MessageActivity" (
 "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 "conversationId" uuid NOT NULL,
 "messageId" uuid,
 "invitationId" uuid,
 "kind" varchar(10) NOT NULL,
 "afterMemberId" uuid,
 "processed" boolean NOT NULL DEFAULT false,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("conversationId","id"));
CREATE TABLE "MessageNotice" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "conversationId" uuid NOT NULL,
 "activityId" uuid NOT NULL,
 "actorId" uuid NOT NULL,
 "memberId" uuid,
 "generation" integer,
 "inApp" boolean NOT NULL DEFAULT false,
 "read" boolean NOT NULL DEFAULT false,
 "state" varchar(10) NOT NULL DEFAULT 'PENDING',
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("activityId","actorId"));
CREATE TABLE "MessageNoticeAttempt" (
 "id" uuid NOT NULL PRIMARY KEY,
 "noticeId" uuid NOT NULL,
 "subscriptionId" uuid,
 "subscriptionRevision" integer NOT NULL,
 "state" varchar(10) NOT NULL DEFAULT 'PENDING',
 "attempts" integer NOT NULL DEFAULT 0,
 "token" uuid,
 "leaseUntil" timestamptz(3),
 "notBefore" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "networkAt" timestamptz(3),
 "canceledAt" timestamptz(3),
 "code" varchar(80),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("noticeId","subscriptionId"));
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_conversation_fk" FOREIGN KEY ("spaceId","scopeId","conversationId") REFERENCES "Conversation" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_file_fk" FOREIGN KEY ("spaceId","scopeId","fileId") REFERENCES "StoredFile" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_uploader_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_message_fk" FOREIGN KEY ("messageId") REFERENCES "MessageEntry" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageMediaRevision" ADD CONSTRAINT "MessageMediaRevision_message_fk" FOREIGN KEY ("messageId") REFERENCES "MessageMedia" ("messageId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageProgress" ADD CONSTRAINT "MessageProgress_admission_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageNoticePreference" ADD CONSTRAINT "MessageNoticePreference_admission_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessagePersonalMutation" ADD CONSTRAINT "MessagePersonalMutation_admission_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageActivity" ADD CONSTRAINT "MessageActivity_conversation_fk" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageActivity" ADD CONSTRAINT "MessageActivity_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageActivity" ADD CONSTRAINT "MessageActivity_invitation_fk" FOREIGN KEY ("conversationId","invitationId") REFERENCES "ConversationInvitation" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageNotice" ADD CONSTRAINT "MessageNotice_activity_fk" FOREIGN KEY ("conversationId","activityId") REFERENCES "MessageActivity" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageNotice" ADD CONSTRAINT "MessageNotice_actor_fk" FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageNotice" ADD CONSTRAINT "MessageNotice_admission_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageNoticeAttempt" ADD CONSTRAINT "MessageNoticeAttempt_notice_fk" FOREIGN KEY ("noticeId") REFERENCES "MessageNotice" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageNoticeAttempt" ADD CONSTRAINT "MessageNoticeAttempt_subscription_fk" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX "MessageActivity_processed_createdAt_id_idx" ON "MessageActivity" ("processed","createdAt","id");
CREATE INDEX "MessageNotice_actorId_id_idx" ON "MessageNotice" ("actorId","id");
CREATE INDEX "MessageNoticeAttempt_state_notBefore_id_idx" ON "MessageNoticeAttempt" ("state","notBefore","id");
-- Preserve every old shape branch; add the actually implemented MEDIA subtype.
ALTER TABLE "MessageEntry" DROP CONSTRAINT "MessageEntry_shape";
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_shape" CHECK (
 "sequence">0 AND "revision">0 AND "memberGeneration">0 AND
 (("kind"='TEXT' AND "textId" IS NOT NULL AND "textId"="id" AND "sourceId" IS NULL AND "sourceConversationId" IS NULL) OR
 ("kind"='MEDIA' AND "textId" IS NULL AND "sourceId" IS NULL AND "sourceConversationId" IS NULL) OR
 ("kind"='FORWARD' AND "textId" IS NULL AND "sourceId" IS NOT NULL AND "sourceId"<>"id" AND "sourceConversationId" IS NOT NULL)) AND
 (("deletedAt" IS NULL AND "removalKind" IS NULL) OR ("deletedAt" IS NOT NULL AND "removalKind" IN ('AUTHOR','MODERATOR'))) AND
 (("replyToId" IS NULL AND "threadId" IS NULL) OR ("replyToId" IS NOT NULL AND "threadId" IS NOT NULL AND "replyToId"<>"id" AND "threadId"<>"id")));
ALTER TABLE "MessageAttachment" ADD CHECK (id="fileId" AND generation>0 AND revision>0 AND kind IN ('FILE','IMAGE','VOICE') AND ("durationMs" IS NULL OR (kind='VOICE' AND "durationMs">0 AND "durationMs"<=120000)));
ALTER TABLE "MessageMedia" ADD CHECK (caption IS NULL OR length(caption) BETWEEN 1 AND 8000);
ALTER TABLE "MessageMediaRevision" ADD CHECK (revision>0 AND (caption IS NULL OR length(caption) BETWEEN 1 AND 8000));
ALTER TABLE "MessageProgress" ADD CHECK (generation>0 AND revision>0 AND "readThrough">=0 AND "deliveredThrough">="readThrough");
ALTER TABLE "MessageNoticePreference" ADD CHECK (generation>0 AND revision>0 AND mode IN ('ALL','MENTIONS_ONLY','MUTED') AND (("quietStart" IS NULL AND "quietEnd" IS NULL) OR ("quietStart" IS NOT NULL AND "quietEnd" IS NOT NULL AND "quietStart"~'^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "quietEnd"~'^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "quietStart"<>"quietEnd")));
ALTER TABLE "MessageActivity" ADD CHECK ((kind='MESSAGE' AND "messageId" IS NOT NULL AND "invitationId" IS NULL) OR (kind='INVITATION' AND "messageId" IS NULL AND "invitationId" IS NOT NULL));
ALTER TABLE "MessageNotice" ADD CHECK (revision>0 AND state IN ('PENDING','PUBLISHED','CANCELED') AND (("memberId" IS NULL AND generation IS NULL) OR ("memberId" IS NOT NULL AND generation IS NOT NULL AND generation>0)));
ALTER TABLE "MessageNoticeAttempt" ADD CHECK ("subscriptionRevision">0 AND attempts BETWEEN 0 AND 5 AND state IN ('PENDING','PROCESSING','NETWORK','RETRY','DELIVERED','CANCELED','EXPIRED','FAILED','AMBIGUOUS'));
CREATE TRIGGER "MessageMediaRevision_immutable" BEFORE UPDATE OR DELETE ON "MessageMediaRevision" FOR EACH ROW EXECUTE FUNCTION "message_history_immutable"();
-- No historical notification backfill: opt-in never replays old message history.
CREATE FUNCTION "message_activity_created"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO "MessageActivity" ("conversationId","messageId",kind) VALUES(NEW."conversationId",NEW.id,'MESSAGE');RETURN NEW;END $$;
CREATE TRIGGER "message_activity_created" AFTER INSERT ON "MessageEntry" FOR EACH ROW EXECUTE FUNCTION "message_activity_created"();
CREATE FUNCTION "message_invitation_created"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO "MessageActivity" ("conversationId","invitationId",kind) VALUES(NEW."conversationId",NEW.id,'INVITATION');RETURN NEW;END $$;
CREATE TRIGGER "message_invitation_created" AFTER INSERT ON "ConversationInvitation" FOR EACH ROW EXECUTE FUNCTION "message_invitation_created"();
COMMIT;
