BEGIN;
-- OD-10 channel settings, per-member preferences and conversation-level reports.
CREATE TABLE "ConversationSetting" (
 "conversationId" uuid PRIMARY KEY,
 "linkPreviews" boolean,
 "newcomerHistory" varchar(9) CHECK("newcomerHistory" IN ('FROM_JOIN','FULL')),
 "membersCanPin" boolean,
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedByMemberId" uuid NOT NULL,
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "ConversationSetting_conversation" FOREIGN KEY("conversationId") REFERENCES "Conversation"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationSetting_member" FOREIGN KEY("conversationId","updatedByMemberId") REFERENCES "ConversationMember"("conversationId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE TABLE "ConversationMemberSetting" (
 "memberId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 "conversationId" uuid NOT NULL,
 "linkPreviews" boolean,
 "collapseBlocked" boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("memberId",generation),
 CONSTRAINT "ConversationMemberSetting_member" FOREIGN KEY("conversationId","memberId") REFERENCES "ConversationMember"("conversationId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE TABLE "ConversationReport" (
 id uuid PRIMARY KEY,
 "conversationId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 reason varchar(2000) CHECK(reason IS NULL OR length(btrim(reason))>0),
 state varchar(8) NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','RESOLVED')),
 resolution varchar(2000),
 "reviewerId" uuid,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "resolvedAt" timestamptz(3),
 CONSTRAINT "ConversationReport_resolution" CHECK((state='RESOLVED')=("resolvedAt" IS NOT NULL) AND num_nonnulls("resolvedAt","reviewerId") IN (0,2)),
 CONSTRAINT "ConversationReport_conversation" FOREIGN KEY("conversationId") REFERENCES "Conversation"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationReport_member" FOREIGN KEY("conversationId","memberId") REFERENCES "ConversationMember"("conversationId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationReport_reviewer" FOREIGN KEY("conversationId","reviewerId") REFERENCES "ConversationMember"("conversationId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "ConversationReport_page" ON "ConversationReport"("conversationId",id);
-- OD-12 organizer-controlled busy-only visibility for source members who are not invited.
CREATE TABLE "MeetingBusySetting" (
 "meetingId" uuid PRIMARY KEY,
 visibility varchar(6) NOT NULL CHECK(visibility IN ('NONE','SOURCE')),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "MeetingBusySetting_meeting" FOREIGN KEY("meetingId") REFERENCES "Meeting"(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
-- OD-13 in-app announcement reminders, one per recipient admission and day.
CREATE TABLE "AnnouncementReminder" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "announcementId" uuid NOT NULL,
 "versionId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 day date NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "readAt" timestamptz(3),
 CONSTRAINT "AnnouncementReminder_announcement" FOREIGN KEY("spaceId","scopeId","announcementId") REFERENCES "Announcement"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "AnnouncementReminder_target" FOREIGN KEY("versionId","accessId",generation) REFERENCES "AnnouncementTarget"("versionId","accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("versionId","accessId",generation,day)
);
CREATE INDEX "AnnouncementReminder_inbox" ON "AnnouncementReminder"("accessId",generation,id);
-- OD-2 Company goals over the shared Goal engine, with numeric key results.
CREATE TABLE "CompanyGoal" (
 "goalId" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "parentGoalId" uuid,
 "ownerAccessId" uuid NOT NULL,
 "ownerGeneration" integer NOT NULL CHECK("ownerGeneration">0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyGoal_not_self" CHECK("parentGoalId" IS NULL OR "parentGoalId"<>"goalId"),
 CONSTRAINT "CompanyGoal_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyGoal_goal" FOREIGN KEY("spaceId","scopeId","goalId") REFERENCES "Goal"("spaceId","scopeId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "CompanyGoal_parent" FOREIGN KEY("parentGoalId") REFERENCES "CompanyGoal"("goalId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyGoal_owner" FOREIGN KEY("spaceId","scopeId","ownerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyGoal_owner_generation" FOREIGN KEY("ownerAccessId","ownerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","scopeId","goalId")
);
CREATE TABLE "CompanyKeyResult" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "goalId" uuid NOT NULL,
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),
 unit varchar(30) CHECK(unit IS NULL OR length(btrim(unit))>0),
 "startValue" numeric(20,4) NOT NULL,
 "targetValue" numeric(20,4) NOT NULL,
 "archivedAt" timestamptz(3),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdByActorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyKeyResult_range" CHECK("targetValue"<>"startValue"),
 CONSTRAINT "CompanyKeyResult_goal" FOREIGN KEY("spaceId","scopeId","goalId") REFERENCES "CompanyGoal"("spaceId","scopeId","goalId") ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "CompanyKeyResult_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId",id)
);
CREATE INDEX "CompanyKeyResult_goal_page" ON "CompanyKeyResult"("spaceId","goalId",id);
CREATE TABLE "CompanyKeyResultCheckin" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "keyResultId" uuid NOT NULL,
 value numeric(20,4) NOT NULL,
 note varchar(500) CHECK(note IS NULL OR length(btrim(note))>0),
 "actorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyKeyResultCheckin_result" FOREIGN KEY("spaceId","keyResultId") REFERENCES "CompanyKeyResult"("spaceId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "CompanyKeyResultCheckin_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyKeyResultCheckin_page" ON "CompanyKeyResultCheckin"("spaceId","keyResultId","createdAt",id);
-- OD-3 rooms are existing resources with manager-entered seats/floor (null = unknown).
CREATE TABLE "CompanyRoomProfile" (
 "resourceId" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 seats integer CHECK(seats BETWEEN 1 AND 100000),
 floor varchar(60) CHECK(floor IS NULL OR length(btrim(floor))>0),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyRoomProfile_resource" FOREIGN KEY("spaceId","scopeId","resourceId") REFERENCES "CompanyResource"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
-- OD-6 knowledge rich text (Markdown) versions, acknowledgement policy, acknowledgements and in-app inbox.
CREATE TABLE "CompanyKnowledgeText" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "documentId" uuid NOT NULL,
 number integer NOT NULL CHECK(number>0),
 body text NOT NULL CHECK(length(body)<=100000),
 note varchar(300) CHECK(note IS NULL OR length(btrim(note))>0),
 "authorAccessId" uuid NOT NULL,
 "authorGeneration" integer NOT NULL CHECK("authorGeneration">0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyKnowledgeText_document" FOREIGN KEY("spaceId","scopeId","documentId") REFERENCES "CompanyKnowledgeDocument"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyKnowledgeText_author" FOREIGN KEY("spaceId","scopeId","authorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyKnowledgeText_author_generation" FOREIGN KEY("authorAccessId","authorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("documentId",number)
);
CREATE TABLE "CompanyKnowledgeSetting" (
 "documentId" uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "ackRequired" boolean NOT NULL DEFAULT false,
 "publishedNumber" integer CHECK("publishedNumber">0),
 "remindedNumber" integer CHECK("remindedNumber">0),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyKnowledgeSetting_document" FOREIGN KEY("spaceId","scopeId","documentId") REFERENCES "CompanyKnowledgeDocument"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE TABLE "CompanyKnowledgeAck" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "documentId" uuid NOT NULL,
 number integer NOT NULL CHECK(number>0),
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyKnowledgeAck_text" FOREIGN KEY("documentId",number) REFERENCES "CompanyKnowledgeText"("documentId",number) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyKnowledgeAck_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyKnowledgeAck_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("documentId",number,"accessId",generation)
);
CREATE TABLE "CompanyNotification" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "recipientAccessId" uuid NOT NULL,
 "recipientGeneration" integer NOT NULL CHECK("recipientGeneration">0),
 kind varchar(24) NOT NULL CHECK(kind IN ('KNOWLEDGE_ACK_REMINDER','EMPLOYEE_FILE_REQUEST')),
 "subjectId" uuid NOT NULL,
 "dedupeKey" varchar(120) NOT NULL CHECK(length("dedupeKey")>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "readAt" timestamptz(3),
 CONSTRAINT "CompanyNotification_member" FOREIGN KEY("spaceId","scopeId","recipientAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyNotification_generation" FOREIGN KEY("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","recipientAccessId","recipientGeneration","dedupeKey")
);
CREATE INDEX "CompanyNotification_inbox" ON "CompanyNotification"("recipientAccessId","recipientGeneration",id);
-- OD-7 internal payment runs over existing reimbursements (no money movement).
CREATE TABLE "CompanyPaymentRun" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 label varchar(200) NOT NULL CHECK(length(btrim(label))>0),
 state varchar(9) NOT NULL CHECK(state IN ('OPEN','CONFIRMED','CANCELED')),
 currency varchar(3) NOT NULL,
 total numeric(28,4) NOT NULL CHECK(total>0),
 reference varchar(300) CHECK(reference IS NULL OR length(btrim(reference))>0),
 "createdByActorId" uuid NOT NULL,
 "closedByActorId" uuid,
 "closedAt" timestamptz(3),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyPaymentRun_closed" CHECK((state='OPEN')=("closedAt" IS NULL) AND num_nonnulls("closedAt","closedByActorId") IN (0,2) AND (state<>'CONFIRMED' OR reference IS NOT NULL)),
 CONSTRAINT "CompanyPaymentRun_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyPaymentRun_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyPaymentRun_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyPaymentRun_closer" FOREIGN KEY("spaceId","closedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","scopeId",id)
);
CREATE TABLE "CompanyPaymentRunItem" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "runId" uuid NOT NULL,
 "reimbursementId" uuid NOT NULL,
 amount numeric(28,4) NOT NULL CHECK(amount>0),
 "acknowledgementId" uuid,
 active boolean NOT NULL DEFAULT true,
 CONSTRAINT "CompanyPaymentRunItem_run" FOREIGN KEY("spaceId","scopeId","runId") REFERENCES "CompanyPaymentRun"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyPaymentRunItem_reimbursement" FOREIGN KEY("spaceId","scopeId","reimbursementId") REFERENCES "CompanyReimbursementRequest"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyPaymentRunItem_acknowledgement" FOREIGN KEY("spaceId","scopeId","acknowledgementId") REFERENCES "CompanyPaymentAcknowledgement"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("runId","reimbursementId")
);
CREATE UNIQUE INDEX "CompanyPaymentRunItem_active" ON "CompanyPaymentRunItem"("reimbursementId") WHERE active;
-- OD-8/C9 sealed employee files: explicit expiring grants, private documents, requests and access log.
CREATE TABLE "CompanyEmployeeGrant" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "granteeAccessId" uuid NOT NULL,
 "granteeGeneration" integer NOT NULL CHECK("granteeGeneration">0),
 kind varchar(8) NOT NULL CHECK(kind IN ('HR','FINANCE','SECURITY')),
 "expiresAt" timestamptz(3) NOT NULL,
 "revokedAt" timestamptz(3),
 "issuedByActorId" uuid NOT NULL,
 "revokedByActorId" uuid,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyEmployeeGrant_revoked" CHECK(num_nonnulls("revokedAt","revokedByActorId") IN (0,2) AND "expiresAt">"createdAt"),
 CONSTRAINT "CompanyEmployeeGrant_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeGrant_grantee" FOREIGN KEY("spaceId","spaceId","granteeAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeGrant_grantee_generation" FOREIGN KEY("granteeAccessId","granteeGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeGrant_issuer" FOREIGN KEY("spaceId","issuedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeGrant_revoker" FOREIGN KEY("spaceId","revokedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyEmployeeGrant_active" ON "CompanyEmployeeGrant"("spaceId","granteeAccessId","granteeGeneration",kind);
CREATE TABLE "CompanyEmployeeDocument" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "subjectAccessId" uuid NOT NULL,
 kind varchar(11) NOT NULL CHECK(kind IN ('CONTRACT','ID','CERTIFICATE','REVIEW','OTHER')),
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),
 "addedByActorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "removedAt" timestamptz(3),
 CONSTRAINT "CompanyEmployeeDocument_root" CHECK("scopeId"="spaceId"),
 CONSTRAINT "CompanyEmployeeDocument_subject" FOREIGN KEY("spaceId","scopeId","subjectAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeDocument_file" FOREIGN KEY("spaceId","scopeId",id) REFERENCES "StoredFile"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeDocument_adder" FOREIGN KEY("spaceId","addedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyEmployeeDocument_subject_page" ON "CompanyEmployeeDocument"("spaceId","subjectAccessId",id);
CREATE TABLE "CompanyEmployeeFileRequest" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "subjectAccessId" uuid NOT NULL,
 "requesterAccessId" uuid NOT NULL,
 "requesterGeneration" integer NOT NULL CHECK("requesterGeneration">0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyEmployeeFileRequest_subject" FOREIGN KEY("spaceId","spaceId","subjectAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeFileRequest_requester" FOREIGN KEY("spaceId","spaceId","requesterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeFileRequest_generation" FOREIGN KEY("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","subjectAccessId","requesterAccessId","requesterGeneration")
);
CREATE TABLE "CompanyEmployeeFileLog" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "subjectAccessId" uuid NOT NULL,
 "actorId" uuid NOT NULL,
 action varchar(16) NOT NULL CHECK(action IN ('OPEN','UPLOAD','DOWNLOAD','PACK','REMOVE','GRANT','REVOKE','REQUEST')),
 "targetId" uuid,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyEmployeeFileLog_subject" FOREIGN KEY("spaceId","spaceId","subjectAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyEmployeeFileLog_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyEmployeeFileLog_page" ON "CompanyEmployeeFileLog"("spaceId","subjectAccessId",id);
-- OD-5 department transfer history.
CREATE TABLE "CompanyDepartmentTransfer" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "fromScopeId" uuid NOT NULL,
 "toScopeId" uuid NOT NULL,
 "fromAccessId" uuid NOT NULL,
 "fromGeneration" integer NOT NULL CHECK("fromGeneration">0),
 "toAccessId" uuid NOT NULL,
 "toGeneration" integer NOT NULL CHECK("toGeneration">0),
 role varchar(12) NOT NULL,
 "actorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyDepartmentTransfer_scopes" CHECK("fromScopeId"<>"toScopeId"),
 CONSTRAINT "CompanyDepartmentTransfer_from" FOREIGN KEY("spaceId","fromScopeId","fromAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDepartmentTransfer_from_generation" FOREIGN KEY("fromAccessId","fromGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDepartmentTransfer_to" FOREIGN KEY("spaceId","toScopeId","toAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDepartmentTransfer_to_generation" FOREIGN KEY("toAccessId","toGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDepartmentTransfer_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "CompanyDepartmentTransfer_page" ON "CompanyDepartmentTransfer"("spaceId",id);
-- B3 Brain Dump: one Personal page per day with ordered lines; destinations are loose references.
CREATE TABLE "BrainDumpPage" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 day date NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "savedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "BrainDumpPage_space" FOREIGN KEY("spaceId") REFERENCES "Space"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 UNIQUE("spaceId",day),
 UNIQUE("spaceId",id)
);
CREATE TABLE "BrainDumpLine" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "pageId" uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 999),
 text varchar(2000) NOT NULL,
 "sortedTo" varchar(7) CHECK("sortedTo" IN ('TASK','NOTE','JOURNAL','EVENT','INBOX')),
 "sortedDay" date,
 "targetId" uuid,
 struck boolean NOT NULL DEFAULT false,
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "BrainDumpLine_sort_shape" CHECK(("sortedTo" IS NULL OR NOT struck) AND ("targetId" IS NULL OR "sortedTo" IS NOT NULL)),
 CONSTRAINT "BrainDumpLine_page" FOREIGN KEY("spaceId","pageId") REFERENCES "BrainDumpPage"("spaceId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 UNIQUE("pageId",position)
);
COMMIT;
