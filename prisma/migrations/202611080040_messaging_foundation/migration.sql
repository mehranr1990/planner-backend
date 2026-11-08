BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Additive discriminator expansion; every previously accepted kind remains valid.
ALTER TABLE "SharedCustody" DROP CONSTRAINT "SharedCustody_kind_check";
ALTER TABLE "SharedCustody" ADD CONSTRAINT "SharedCustody_kind_check" CHECK(kind IN ('PROJECT','TEAM','COMPANY','CONVERSATION'));

ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('messaging.conversation','messaging.participant','messaging.message','company.association','company.knowledge-folder','company.knowledge-document','company.knowledge-version','shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.financial-workflow','company.financial-workflow-version','company.financial-approval','company.reimbursement-request','company.payment-acknowledgement','company.acknowledgement-correction','company.expense','company.budget','company.commitment','company.finance-category','company.finance-reference','company.expense-version','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry'));

CREATE TABLE "Conversation" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,
 kind varchar(20) NOT NULL CHECK(kind IN ('DM','PRIVATE_GROUP','PROJECT','TEAM','COMPANY')),
 "projectId" uuid,"teamId" uuid,"companyId" uuid,"createdByActorId" uuid NOT NULL,
 title varchar(200),"creationKeyHash" char(64) NOT NULL,"creationFingerprint" char(64) NOT NULL,
 "lastSequence" bigint NOT NULL DEFAULT 0 CHECK("lastSequence">=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "Conversation_scope_key" UNIQUE("spaceId","scopeId",id),
 CONSTRAINT "Conversation_creation_key" UNIQUE("spaceId","scopeId","createdByActorId","creationKeyHash"),
 CONSTRAINT "Conversation_source_shape" CHECK(
  (kind IN ('DM','PRIVATE_GROUP') AND id="spaceId" AND "scopeId"="spaceId" AND "projectId" IS NULL AND "teamId" IS NULL AND "companyId" IS NULL) OR
  (kind='PROJECT' AND "projectId"="scopeId" AND "projectId" IS NOT NULL AND "teamId" IS NULL AND "companyId" IS NULL) OR
  (kind='TEAM' AND "teamId"="scopeId" AND "teamId" IS NOT NULL AND "projectId" IS NULL AND "companyId" IS NULL) OR
  (kind='COMPANY' AND "companyId"="spaceId" AND "scopeId"="spaceId" AND "companyId" IS NOT NULL AND "projectId" IS NULL AND "teamId" IS NULL)),
 CHECK((kind='DM' AND title IS NULL) OR (kind<>'DM' AND title IS NOT NULL AND length(btrim(title))>0)),
 CONSTRAINT "Conversation_scope_fk" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "Conversation_creator_fk" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "Conversation_project_fk" FOREIGN KEY("spaceId","projectId") REFERENCES "Project"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "Conversation_team_fk" FOREIGN KEY("spaceId","teamId") REFERENCES "Team"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "Conversation_company_fk" FOREIGN KEY("spaceId","companyId") REFERENCES "Company"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "Conversation_scope_list" ON "Conversation"("spaceId","scopeId",id);
CREATE TABLE "ConversationMember" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"conversationId" uuid NOT NULL,"actorId" uuid NOT NULL,
 role varchar(6) NOT NULL CHECK(role IN ('ADMIN','MEMBER')),state varchar(7) NOT NULL CHECK(state IN ('ACTIVE','LEFT','REVOKED')),
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "sourceAccessId" uuid NOT NULL,"sourceGeneration" integer NOT NULL CHECK("sourceGeneration">0),
 "restoreGeneration" integer NOT NULL CHECK("restoreGeneration">=0),
 "historyAfter" bigint NOT NULL CHECK("historyAfter">=0),"joinedAt" timestamptz(3) NOT NULL,
 CONSTRAINT "ConversationMember_actor_key" UNIQUE("conversationId","actorId"),
 CONSTRAINT "ConversationMember_scope_key" UNIQUE("conversationId",id),
 CONSTRAINT "ConversationMember_conversation_fk" FOREIGN KEY("spaceId","scopeId","conversationId") REFERENCES "Conversation"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationMember_actor_fk" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationMember_source_fk" FOREIGN KEY("spaceId","scopeId","sourceAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationMember_interval_fk" FOREIGN KEY("sourceAccessId","sourceGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "ConversationMember_list" ON "ConversationMember"("actorId",state,"conversationId");
CREATE TABLE "ConversationAdmission" (
 "conversationId" uuid NOT NULL,"memberId" uuid NOT NULL,generation integer NOT NULL CHECK(generation>0),
 "historyAfter" bigint NOT NULL CHECK("historyAfter">=0),"joinedAt" timestamptz(3) NOT NULL,"endedAt" timestamptz(3),
 PRIMARY KEY("memberId",generation),CONSTRAINT "ConversationAdmission_scope_key" UNIQUE("conversationId","memberId",generation),
 CHECK("endedAt" IS NULL OR "endedAt">="joinedAt"),
 CONSTRAINT "ConversationAdmission_member_fk" FOREIGN KEY("conversationId","memberId") REFERENCES "ConversationMember"("conversationId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "ConversationAdmission_open" ON "ConversationAdmission"("memberId") WHERE "endedAt" IS NULL;
CREATE TABLE "ConversationInvitation" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"conversationId" uuid NOT NULL,
 "recipientActorId" uuid NOT NULL,"inviterActorId" uuid NOT NULL,"inviterAccessId" uuid NOT NULL,"inviterGeneration" integer NOT NULL,
 "inviterMemberId" uuid,"inviterMemberGeneration" integer,
 "recipientAccessId" uuid,"recipientGeneration" integer,"restoreGeneration" integer NOT NULL,
 state varchar(8) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
 "keyHash" char(64) NOT NULL,fingerprint char(64) NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "expiresAt" timestamptz(3) NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK("expiresAt">"createdAt"),CHECK("recipientActorId"<>"inviterActorId"),
 CHECK(("recipientAccessId" IS NULL)=("recipientGeneration" IS NULL)),
 CHECK(("inviterMemberId" IS NULL)=("inviterMemberGeneration" IS NULL)),
 CONSTRAINT "ConversationInvitation_key" UNIQUE("conversationId","inviterActorId","keyHash"),
 CONSTRAINT "ConversationInvitation_conversation_fk" FOREIGN KEY("spaceId","scopeId","conversationId") REFERENCES "Conversation"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationInvitation_recipient_fk" FOREIGN KEY("spaceId","recipientActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationInvitation_inviter_fk" FOREIGN KEY("spaceId","inviterActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationInvitation_issuer_interval_fk" FOREIGN KEY("inviterAccessId","inviterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationInvitation_recipient_interval_fk" FOREIGN KEY("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationInvitation_issuer_admission_fk" FOREIGN KEY("conversationId","inviterMemberId","inviterMemberGeneration") REFERENCES "ConversationAdmission"("conversationId","memberId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "ConversationInvitation_pending" ON "ConversationInvitation"("conversationId","recipientActorId") WHERE state='PENDING';
CREATE INDEX "ConversationInvitation_recipient_list" ON "ConversationInvitation"("recipientActorId",state,id);
CREATE TABLE "ConversationMessage" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"scopeId" uuid NOT NULL,"conversationId" uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),"memberId" uuid NOT NULL,"memberGeneration" integer NOT NULL,
 text text NOT NULL CHECK(length(btrim(text))>0 AND length(text)<=8000 AND octet_length(text)<=32000),
 "keyHash" char(64) NOT NULL,fingerprint char(64) NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "ConversationMessage_order_key" UNIQUE("conversationId",sequence),
 CONSTRAINT "ConversationMessage_send_key" UNIQUE("conversationId","memberId","keyHash"),
 CONSTRAINT "ConversationMessage_conversation_fk" FOREIGN KEY("spaceId","scopeId","conversationId") REFERENCES "Conversation"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ConversationMessage_author_fk" FOREIGN KEY("conversationId","memberId","memberGeneration") REFERENCES "ConversationAdmission"("conversationId","memberId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION
);
COMMIT;
