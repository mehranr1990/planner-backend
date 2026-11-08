-- M041 / ADR 0046. Additive advanced-message storage; no purge or retention defaults.
BEGIN;
ALTER TABLE "Conversation" ADD COLUMN "lastChangeSequence" bigint NOT NULL DEFAULT 0,
 ADD COLUMN "messagePolicyRevision" integer NOT NULL DEFAULT 1,
 ADD CONSTRAINT "Conversation_advanced_counters" CHECK ("lastChangeSequence">=0 AND "messagePolicyRevision">0);
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_identity_key" UNIQUE ("conversationId","id");
CREATE TABLE "MessageEntry" (
 "id" uuid NOT NULL PRIMARY KEY,
 "conversationId" uuid NOT NULL,
 "sequence" bigint NOT NULL,
 "memberId" uuid NOT NULL,
 "memberGeneration" integer NOT NULL,
 "kind" varchar(7) NOT NULL,
 "textId" uuid UNIQUE,
 "sourceId" uuid,
 "sourceConversationId" uuid,
 "replyToId" uuid,
 "threadId" uuid,
 "revision" integer NOT NULL DEFAULT 1,
 "deletedAt" timestamptz(3),
 "removalKind" varchar(10),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("conversationId","id"),
 UNIQUE ("conversationId","sequence"));
CREATE TABLE "MessageRevision" (
 "messageId" uuid NOT NULL,
 "revision" integer NOT NULL,
 "text" text NOT NULL,
 "editedAt" timestamptz(3) NOT NULL,
 PRIMARY KEY ("messageId","revision"));
CREATE TABLE "MessageHidden" (
 "conversationId" uuid NOT NULL,
 "messageId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY ("messageId","memberId"));
CREATE TABLE "MessageReaction" (
 "conversationId" uuid NOT NULL,
 "messageId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "emoji" varchar(64) NOT NULL,
 "active" boolean NOT NULL,
 "updatedAt" timestamptz(3) NOT NULL,
 PRIMARY KEY ("messageId","memberId","emoji"));
CREATE TABLE "MessageMention" (
 "conversationId" uuid NOT NULL,
 "messageId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 PRIMARY KEY ("messageId","memberId"));
CREATE TABLE "MessagePin" (
 "conversationId" uuid NOT NULL,
 "messageId" uuid NOT NULL PRIMARY KEY,
 "memberId" uuid NOT NULL,
 "active" boolean NOT NULL,
 "updatedAt" timestamptz(3) NOT NULL);
CREATE TABLE "MessageReport" (
 "id" uuid NOT NULL PRIMARY KEY,
 "conversationId" uuid NOT NULL,
 "messageId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "reason" varchar(2000) NOT NULL,
 "state" varchar(8) NOT NULL DEFAULT 'OPEN',
 "resolution" varchar(2000),
 "reviewerId" uuid,
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "resolvedAt" timestamptz(3));
CREATE TABLE "MessagePolicy" (
 "conversationId" uuid NOT NULL,
 "revision" integer NOT NULL,
 "memberId" uuid NOT NULL,
 "authorDelete" boolean NOT NULL,
 "reason" varchar(2000) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY ("conversationId","revision"));
CREATE TABLE "MessageMutation" (
 "conversationId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "keyHash" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 "resourceId" uuid NOT NULL,
 "action" varchar(32) NOT NULL,
 PRIMARY KEY ("conversationId","memberId","generation","keyHash"));
CREATE TABLE "MessageChange" (
 "conversationId" uuid NOT NULL,
 "sequence" bigint NOT NULL,
 "messageId" uuid NOT NULL,
 "audienceId" uuid,
 "kind" varchar(24) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY ("conversationId","sequence"));
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_conversation_fk" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_author_fk" FOREIGN KEY ("conversationId","memberId","memberGeneration") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_text_fk" FOREIGN KEY ("conversationId","textId") REFERENCES "ConversationMessage" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_source_fk" FOREIGN KEY ("sourceConversationId","sourceId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_reply_fk" FOREIGN KEY ("conversationId","replyToId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_thread_fk" FOREIGN KEY ("conversationId","threadId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageRevision" ADD CONSTRAINT "MessageRevision_message_fk" FOREIGN KEY ("messageId") REFERENCES "MessageEntry" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageHidden" ADD CONSTRAINT "MessageHidden_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageHidden" ADD CONSTRAINT "MessageHidden_member_fk" FOREIGN KEY ("conversationId","memberId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_member_fk" FOREIGN KEY ("conversationId","memberId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_member_fk" FOREIGN KEY ("conversationId","memberId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_member_fk" FOREIGN KEY ("conversationId","memberId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_member_fk" FOREIGN KEY ("conversationId","memberId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageChange" ADD CONSTRAINT "MessageChange_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_admission_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_admission_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_reviewer_fk" FOREIGN KEY ("conversationId","reviewerId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessagePolicy" ADD CONSTRAINT "MessagePolicy_member_fk" FOREIGN KEY ("conversationId","memberId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageMutation" ADD CONSTRAINT "MessageMutation_admission_fk" FOREIGN KEY ("conversationId","memberId","generation") REFERENCES "ConversationAdmission" ("conversationId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageChange" ADD CONSTRAINT "MessageChange_audience_fk" FOREIGN KEY ("conversationId","audienceId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MessageEntry" ADD CONSTRAINT "MessageEntry_shape" CHECK (
 "sequence">0 AND "revision">0 AND "memberGeneration">0 AND
 (("kind"='TEXT' AND "textId" IS NOT NULL AND "textId"="id" AND "sourceId" IS NULL AND "sourceConversationId" IS NULL) OR
 ("kind"='FORWARD' AND "textId" IS NULL AND "sourceId" IS NOT NULL AND "sourceId"<>"id" AND "sourceConversationId" IS NOT NULL)) AND
 (("deletedAt" IS NULL AND "removalKind" IS NULL) OR ("deletedAt" IS NOT NULL AND "removalKind" IN ('AUTHOR','MODERATOR'))) AND
 (("replyToId" IS NULL AND "threadId" IS NULL) OR ("replyToId" IS NOT NULL AND "threadId" IS NOT NULL AND "replyToId"<>"id" AND "threadId"<>"id")));
ALTER TABLE "MessageRevision" ADD CHECK ("revision">0 AND length("text") BETWEEN 1 AND 8000);
ALTER TABLE "MessageReaction" ADD CHECK (length("emoji") BETWEEN 1 AND 64);
ALTER TABLE "MessageReport" ADD CHECK (length(btrim("reason")) BETWEEN 1 AND 2000 AND "revision">0 AND (("state"='OPEN' AND "resolution" IS NULL AND "reviewerId" IS NULL AND "resolvedAt" IS NULL) OR ("state"='RESOLVED' AND "resolution" IS NOT NULL AND length(btrim("resolution")) BETWEEN 1 AND 2000 AND "reviewerId" IS NOT NULL AND "resolvedAt" IS NOT NULL)));
ALTER TABLE "MessagePolicy" ADD CHECK ("revision">1 AND length(btrim("reason")) BETWEEN 1 AND 2000);
ALTER TABLE "MessageChange" ADD CHECK ("sequence">0 AND "kind" IN ('CREATE','EDIT','DELETE','HIDE','REACTION','PIN','MENTION'));
CREATE INDEX "MessageEntry_history" ON "MessageEntry" ("conversationId","sequence");
CREATE INDEX "MessageEntry_sources" ON "MessageEntry" ("conversationId","sourceConversationId") WHERE "kind"='FORWARD';
CREATE INDEX "MessageEntry_thread" ON "MessageEntry" ("conversationId","threadId","sequence");
INSERT INTO "MessageEntry" ("id","conversationId","sequence","memberId","memberGeneration","kind","textId","createdAt")
 SELECT "id","conversationId","sequence","memberId","memberGeneration",'TEXT',"id","createdAt" FROM "ConversationMessage";
INSERT INTO "MessageChange" ("conversationId","sequence","messageId","kind","createdAt")
 SELECT "conversationId","sequence","id",'CREATE',"createdAt" FROM "ConversationMessage";
UPDATE "Conversation" SET "lastChangeSequence"="lastSequence";
-- All old/compiled writers receive a header and durable CREATE event atomically.
CREATE FUNCTION "message_text_header"() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE n bigint;
 BEGIN
 INSERT INTO "MessageEntry" ("id","conversationId","sequence","memberId","memberGeneration","kind","textId","createdAt")
 VALUES (NEW."id",NEW."conversationId",NEW."sequence",NEW."memberId",NEW."memberGeneration",'TEXT',NEW."id",NEW."createdAt");
 UPDATE "Conversation" SET "lastChangeSequence"="lastChangeSequence"+1 WHERE "id"=NEW."conversationId" RETURNING "lastChangeSequence" INTO n;
 INSERT INTO "MessageChange" ("conversationId","sequence","messageId","kind") VALUES (NEW."conversationId",n,NEW."id",'CREATE');
 RETURN NEW;
 END $$;
CREATE TRIGGER "message_text_header" AFTER INSERT ON "ConversationMessage" FOR EACH ROW EXECUTE FUNCTION "message_text_header"();
CREATE TABLE "MessageModeration" (
 "id" uuid PRIMARY KEY, "conversationId" uuid NOT NULL, "messageId" uuid NOT NULL,
 "memberId" uuid NOT NULL,"reason" varchar(2000) NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 2000),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "MessageModeration_message_fk" FOREIGN KEY ("conversationId","messageId") REFERENCES "MessageEntry" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "MessageModeration_member_fk" FOREIGN KEY ("conversationId","memberId") REFERENCES "ConversationMember" ("conversationId","id") ON DELETE NO ACTION ON UPDATE NO ACTION);
CREATE FUNCTION "message_history_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable message history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "MessageRevision_immutable" BEFORE UPDATE OR DELETE ON "MessageRevision" FOR EACH ROW EXECUTE FUNCTION "message_history_immutable"();
CREATE TRIGGER "MessagePolicy_immutable" BEFORE UPDATE OR DELETE ON "MessagePolicy" FOR EACH ROW EXECUTE FUNCTION "message_history_immutable"();
CREATE TRIGGER "MessageMutation_immutable" BEFORE UPDATE OR DELETE ON "MessageMutation" FOR EACH ROW EXECUTE FUNCTION "message_history_immutable"();
CREATE TRIGGER "MessageModeration_immutable" BEFORE UPDATE OR DELETE ON "MessageModeration" FOR EACH ROW EXECUTE FUNCTION "message_history_immutable"();
CREATE TRIGGER "MessageChange_immutable" BEFORE UPDATE OR DELETE ON "MessageChange" FOR EACH ROW EXECUTE FUNCTION "message_history_immutable"();
COMMIT;
