BEGIN;
CREATE TABLE "P4Policy" (
"section" varchar(20) NOT NULL PRIMARY KEY,
"revision" integer NOT NULL DEFAULT 1,
"value" jsonb NOT NULL,
"updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AdminCommunicationTemplate" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"name" varchar(100) NOT NULL,
"version" integer NOT NULL,
"fallbackLocale" varchar(30) NOT NULL,
"translations" jsonb NOT NULL,
"state" varchar(12) NOT NULL DEFAULT 'DRAFT',
"createdByAdminId" uuid NOT NULL,
"approvedByAdminId" uuid,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("name","version")
);

CREATE TABLE "AdminCommunication" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"templateId" uuid NOT NULL,
"kind" varchar(12) NOT NULL,
"audience" jsonb NOT NULL,
"variables" jsonb NOT NULL,
"channels" jsonb NOT NULL,
"createdByAdminId" uuid NOT NULL,
"approvedByAdminId" uuid,
"state" varchar(16) NOT NULL DEFAULT 'PREVIEW',
"revision" integer NOT NULL DEFAULT 1,
"expiresAt" timestamptz(3) NOT NULL,
"scheduledAt" timestamptz(3) NOT NULL,
"testedAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminCommunication_state_scheduledAt_idx" ON "AdminCommunication" ("state","scheduledAt");
CREATE TABLE "AdminCommunicationRecipient" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"communicationId" uuid NOT NULL,
"userId" uuid NOT NULL,
"channel" varchar(10) NOT NULL,
"subscriptionId" uuid,
"subscriptionRevision" integer,
"intent" varchar(150) NOT NULL UNIQUE,
"state" varchar(16) NOT NULL DEFAULT 'PENDING',
"attempts" integer NOT NULL DEFAULT 0,
"nextAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"leaseToken" uuid,
"leaseUntil" timestamptz(3),
"networkStartedAt" timestamptz(3),
"lastCode" varchar(80),
"readAt" timestamptz(3),
"locale" varchar(30),
"subject" varchar(200),
"body" varchar(10000),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminCommunicationRecipient_state_nextAt_idx" ON "AdminCommunicationRecipient" ("state","nextAt");
CREATE TABLE "SupportQueue" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"name" varchar(100) NOT NULL UNIQUE,
"active" boolean NOT NULL DEFAULT true,
"slaMinutes" integer NOT NULL DEFAULT 1440,
"revision" integer NOT NULL DEFAULT 1,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SupportTicket" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"ownerUserId" uuid NOT NULL,
"spaceId" uuid,
"scopeId" uuid,
"queueId" uuid NOT NULL,
"assigneeAdminId" uuid,
"subject" varchar(200) NOT NULL,
"category" varchar(80) NOT NULL,
"priority" varchar(10) NOT NULL DEFAULT 'NORMAL',
"state" varchar(24) NOT NULL DEFAULT 'NEW',
"revision" integer NOT NULL DEFAULT 1,
"slaDueAt" timestamptz(3) NOT NULL,
"slaAlertedAt" timestamptz(3),
"resolvedAt" timestamptz(3),
"archivedAt" timestamptz(3),
"feedback" integer,
"feedbackText" varchar(2000),
"correlationHash" char(64) UNIQUE,
"correlationEmailHash" char(64),
"correlationExpiresAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportTicket_ownerUserId_id_idx" ON "SupportTicket" ("ownerUserId","id");
CREATE INDEX "SupportTicket_state_slaDueAt_idx" ON "SupportTicket" ("state","slaDueAt");
CREATE TABLE "SupportReply" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"ticketId" uuid NOT NULL,
"authorUserId" uuid,
"authorAdminId" uuid,
"internal" boolean NOT NULL DEFAULT false,
"body" varchar(20000) NOT NULL,
"source" varchar(12) NOT NULL DEFAULT 'IN_APP',
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportReply_ticketId_id_idx" ON "SupportReply" ("ticketId","id");
CREATE TABLE "ModerationCase" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"reporterUserId" uuid,
"reporterAdminId" uuid,
"targetUserId" uuid,
"targetSpaceId" uuid,
"taskId" uuid,
"noteId" uuid,
"messageId" uuid,
"sourceKind" varchar(12) NOT NULL,
"category" varchar(80) NOT NULL,
"description" varchar(20000) NOT NULL,
"priority" varchar(10) NOT NULL DEFAULT 'NORMAL',
"state" varchar(20) NOT NULL DEFAULT 'NEW',
"revision" integer NOT NULL DEFAULT 1,
"dedupHash" char(64) NOT NULL UNIQUE,
"publicOutcome" varchar(2000),
"internalOutcome" varchar(10000),
"decisionAdminId" uuid,
"appealReviewerAdminId" uuid,
"decidedAt" timestamptz(3),
"appealedAt" timestamptz(3),
"appealText" varchar(10000),
"restrictionUntil" timestamptz(3),
"restrictionKind" varchar(20),
"retentionAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ModerationCase_state_id_idx" ON "ModerationCase" ("state","id");
CREATE INDEX "ModerationCase_targetUserId_restrictionUntil_idx" ON "ModerationCase" ("targetUserId","restrictionUntil");
CREATE TABLE "P4CaseEvent" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"ticketId" uuid,
"caseId" uuid,
"actorAdminId" uuid,
"actorUserId" uuid,
"kind" varchar(50) NOT NULL,
"public" boolean NOT NULL DEFAULT false,
"text" varchar(10000),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "P4CaseEvent_ticketId_id_idx" ON "P4CaseEvent" ("ticketId","id");
CREATE INDEX "P4CaseEvent_caseId_id_idx" ON "P4CaseEvent" ("caseId","id");
CREATE TABLE "P4Evidence" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"ownerUserId" uuid,
"ticketId" uuid,
"caseId" uuid,
"replyId" uuid,
"objectKey" varchar(100) NOT NULL UNIQUE,
"attemptId" uuid NOT NULL,
"filename" varchar(200) NOT NULL,
"mediaType" varchar(100) NOT NULL,
"size" integer NOT NULL,
"sha256" char(64) NOT NULL,
"scanEngine" varchar(100) NOT NULL,
"state" varchar(12) NOT NULL DEFAULT 'STAGED',
"stagingGroup" uuid NOT NULL,
"expiresAt" timestamptz(3) NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "P4Evidence_state_expiresAt_idx" ON "P4Evidence" ("state","expiresAt");
CREATE TABLE "SupportInboundReceipt" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"transportId" varchar(80) NOT NULL,
"providerMessageHash" char(64) NOT NULL,
"messageHash" char(64) NOT NULL UNIQUE,
"fingerprint" char(64) NOT NULL,
"ticketId" uuid,
"result" jsonb NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE ("transportId","providerMessageHash")
);

CREATE TABLE "P4RateBucket" (
"key" varchar(160) NOT NULL,
"windowMs" integer NOT NULL,
"startAt" timestamptz(3) NOT NULL,
"count" integer NOT NULL,
PRIMARY KEY ("key","windowMs")
);

CREATE TABLE "P4UserReceipt" (
"userId" uuid NOT NULL,
"operation" varchar(80) NOT NULL,
"keyHash" char(64) NOT NULL,
"fingerprint" char(64) NOT NULL,
"result" jsonb NOT NULL,
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY ("userId","operation","keyHash")
);

CREATE TABLE "P4Notice" (
"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
"userId" uuid,
"adminId" uuid,
"ticketId" uuid,
"caseId" uuid,
"kind" varchar(30) NOT NULL,
"intent" varchar(150) NOT NULL UNIQUE,
"readAt" timestamptz(3),
"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "AdminCommunicationTemplate" ADD CONSTRAINT "AdminCommunicationTemplate_createdByAdminId_fk" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunicationTemplate" ADD CONSTRAINT "AdminCommunicationTemplate_approvedByAdminId_fk" FOREIGN KEY ("approvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunication" ADD CONSTRAINT "AdminCommunication_templateId_fk" FOREIGN KEY ("templateId") REFERENCES "AdminCommunicationTemplate"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunication" ADD CONSTRAINT "AdminCommunication_createdByAdminId_fk" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunication" ADD CONSTRAINT "AdminCommunication_approvedByAdminId_fk" FOREIGN KEY ("approvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunicationRecipient" ADD CONSTRAINT "AdminCommunicationRecipient_communicationId_fk" FOREIGN KEY ("communicationId") REFERENCES "AdminCommunication"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunicationRecipient" ADD CONSTRAINT "AdminCommunicationRecipient_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunicationRecipient" ADD CONSTRAINT "AdminCommunicationRecipient_subscriptionId_fk" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_ownerUserId_fk" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_spaceId_fk" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_scopeId_fk" FOREIGN KEY ("scopeId") REFERENCES "AccessScope"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_queueId_fk" FOREIGN KEY ("queueId") REFERENCES "SupportQueue"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assigneeAdminId_fk" FOREIGN KEY ("assigneeAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_ticketId_fk" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_authorUserId_fk" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_authorAdminId_fk" FOREIGN KEY ("authorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_reporterUserId_fk" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_reporterAdminId_fk" FOREIGN KEY ("reporterAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_targetUserId_fk" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_targetSpaceId_fk" FOREIGN KEY ("targetSpaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_noteId_fk" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_messageId_fk" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_decisionAdminId_fk" FOREIGN KEY ("decisionAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_appealReviewerAdminId_fk" FOREIGN KEY ("appealReviewerAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "P4CaseEvent" ADD CONSTRAINT "P4CaseEvent_ticketId_fk" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "P4CaseEvent" ADD CONSTRAINT "P4CaseEvent_caseId_fk" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "P4CaseEvent" ADD CONSTRAINT "P4CaseEvent_actorAdminId_fk" FOREIGN KEY ("actorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "P4CaseEvent" ADD CONSTRAINT "P4CaseEvent_actorUserId_fk" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "P4Evidence" ADD CONSTRAINT "P4Evidence_ownerUserId_fk" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "P4Evidence" ADD CONSTRAINT "P4Evidence_ticketId_fk" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "P4Evidence" ADD CONSTRAINT "P4Evidence_caseId_fk" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "P4Evidence" ADD CONSTRAINT "P4Evidence_replyId_fk" FOREIGN KEY ("replyId") REFERENCES "SupportReply"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "SupportInboundReceipt" ADD CONSTRAINT "SupportInboundReceipt_ticketId_fk" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "P4UserReceipt" ADD CONSTRAINT "P4UserReceipt_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "P4Notice" ADD CONSTRAINT "P4Notice_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "P4Notice" ADD CONSTRAINT "P4Notice_adminId_fk" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "P4Notice" ADD CONSTRAINT "P4Notice_ticketId_fk" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "P4Notice" ADD CONSTRAINT "P4Notice_caseId_fk" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AdminCommunicationTemplate" ADD CONSTRAINT "AdminCommunicationTemplate_check" CHECK (state IN ('DRAFT','APPROVED','ARCHIVED') AND version>0);
ALTER TABLE "AdminCommunication" ADD CONSTRAINT "AdminCommunication_check" CHECK (kind IN ('SYSTEM','DIRECT','GROUP','GLOBAL','SECURITY') AND state IN ('PREVIEW','SCHEDULED','CANCELED','COMPLETE') AND revision>0 AND jsonb_array_length(channels)>0);
ALTER TABLE "AdminCommunicationRecipient" ADD CONSTRAINT "AdminCommunicationRecipient_check" CHECK (channel IN ('IN_APP','EMAIL','WEB_PUSH') AND state IN ('PENDING','SENDING','SENT','FAILED','AMBIGUOUS','SUPPRESSED','CANCELED') AND attempts BETWEEN 0 AND 10 AND (channel='WEB_PUSH')=("subscriptionId" IS NOT NULL));
ALTER TABLE "SupportQueue" ADD CONSTRAINT "SupportQueue_check" CHECK ("slaMinutes" BETWEEN 15 AND 43200 AND revision>0);
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_check" CHECK (state IN ('NEW','OPEN','WAITING_FOR_USER','WAITING_FOR_SUPPORT','RESOLVED','CLOSED','REOPENED') AND priority IN ('LOW','NORMAL','HIGH','URGENT') AND revision>0 AND (feedback IS NULL OR feedback BETWEEN 1 AND 5));
ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_check" CHECK ((NOT internal OR "authorUserId" IS NULL) AND source IN ('IN_APP','EMAIL'));
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_check" CHECK (state IN ('NEW','TRIAGED','INVESTIGATING','ACTION_TAKEN','DISMISSED','APPEALED','CLOSED') AND "sourceKind" IN ('ACCOUNT','WORKSPACE','BEHAVIOR','TASK','NOTE','MESSAGE') AND priority IN ('LOW','NORMAL','HIGH','URGENT') AND revision>0 AND ("appealReviewerAdminId" IS NULL OR "appealReviewerAdminId" IS DISTINCT FROM "decisionAdminId"));
ALTER TABLE "P4CaseEvent" ADD CONSTRAINT "P4CaseEvent_check" CHECK (num_nonnulls("ticketId","caseId")=1);
ALTER TABLE "P4Evidence" ADD CONSTRAINT "P4Evidence_check" CHECK (size>0 AND size<=5242880 AND num_nonnulls("ticketId","caseId")<=1 AND state IN ('STAGED','ATTACHED','DELETING'));
ALTER TABLE "P4RateBucket" ADD CONSTRAINT "P4RateBucket_check" CHECK (count>=0 AND "windowMs">0);
ALTER TABLE "P4Notice" ADD CONSTRAINT "P4Notice_check" CHECK (num_nonnulls("userId","adminId")=1);
INSERT INTO "P4Policy"(section,value) VALUES ('SUPPORT','{"reopenDays":7,"archiveDays":90,"retentionDays":365,"inboundTokenDays":30}'::jsonb);
INSERT INTO "P4Policy"(section,value) VALUES ('MODERATION','{"appealDays":14,"dismissedRetentionDays":90,"actionRetentionDays":365}'::jsonb);
INSERT INTO "P4Policy"(section,value) VALUES ('COMMUNICATIONS','{"maxAttempts":5,"retentionDays":90}'::jsonb);
INSERT INTO "SupportQueue"(id,name) VALUES ('00000000-0000-4000-8000-000000000116','General');
COMMIT;
