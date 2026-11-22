ALTER TABLE "ConversationInvitation" ADD COLUMN "invitedEmail" VARCHAR(320);
ALTER TABLE "MeetingInvitation" ADD COLUMN "invitedEmail" VARCHAR(320);
CREATE TABLE "ConversationEmailInvitation" (
 id UUID PRIMARY KEY,"spaceId" UUID NOT NULL,"scopeId" UUID NOT NULL,"conversationId" UUID NOT NULL,
 "inviterActorId" UUID NOT NULL,"inviterAccessId" UUID NOT NULL,"inviterGeneration" INTEGER NOT NULL,
 "inviterMemberId" UUID,"inviterMemberGeneration" INTEGER,"restoreGeneration" INTEGER NOT NULL,
 email VARCHAR(320),"proofHash" CHAR(64),"keyHash" CHAR(64) NOT NULL,fingerprint CHAR(64) NOT NULL,
 state VARCHAR(8) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','CLAIMED','REVOKED')),
 "emailDeliveryState" VARCHAR(11) NOT NULL DEFAULT 'NONE' CHECK("emailDeliveryState" IN ('NONE','SENT','FAILED','UNAVAILABLE')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),"expiresAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "ConversationEmailInvitation_target_fk" FOREIGN KEY("spaceId","scopeId","conversationId") REFERENCES "Conversation"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationEmailInvitation_issuer_fk" FOREIGN KEY("spaceId","inviterActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationEmailInvitation_interval_fk" FOREIGN KEY("inviterAccessId","inviterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationEmailInvitation_member_fk" FOREIGN KEY("conversationId","inviterMemberId") REFERENCES "ConversationMember"("conversationId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("conversationId","inviterActorId","keyHash"),
 CHECK((state='PENDING' AND email IS NOT NULL AND "proofHash" IS NOT NULL) OR (state<>'PENDING' AND email IS NULL AND "proofHash" IS NULL))
);
CREATE TABLE "MeetingEmailInvitation" (
 id UUID PRIMARY KEY,"spaceId" UUID NOT NULL,"scopeId" UUID NOT NULL,"meetingId" UUID NOT NULL,
 "inviterActorId" UUID NOT NULL,"inviterAccessId" UUID NOT NULL,"inviterGeneration" INTEGER NOT NULL,
 "inviterMemberId" UUID,"inviterMemberGeneration" INTEGER,"restoreGeneration" INTEGER NOT NULL,
 email VARCHAR(320),"proofHash" CHAR(64),"keyHash" CHAR(64) NOT NULL,fingerprint CHAR(64) NOT NULL,
 state VARCHAR(8) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','CLAIMED','REVOKED')),
 "emailDeliveryState" VARCHAR(11) NOT NULL DEFAULT 'NONE' CHECK("emailDeliveryState" IN ('NONE','SENT','FAILED','UNAVAILABLE')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),"expiresAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "MeetingEmailInvitation_target_fk" FOREIGN KEY("spaceId","scopeId","meetingId") REFERENCES "Meeting"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "MeetingEmailInvitation_issuer_fk" FOREIGN KEY("spaceId","inviterActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "MeetingEmailInvitation_interval_fk" FOREIGN KEY("inviterAccessId","inviterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "MeetingEmailInvitation_member_fk" FOREIGN KEY("meetingId","inviterMemberId") REFERENCES "MeetingMember"("meetingId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("meetingId","inviterActorId","keyHash"),
 CHECK((state='PENDING' AND email IS NOT NULL AND "proofHash" IS NOT NULL) OR (state<>'PENDING' AND email IS NULL AND "proofHash" IS NULL))
);
