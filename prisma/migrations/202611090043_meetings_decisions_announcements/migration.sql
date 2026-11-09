-- M043 / approved ADR 0048: meetings, exact-version approvals and scoped announcements.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "SharedCustody" DROP CONSTRAINT "SharedCustody_kind_check";
ALTER TABLE "SharedCustody" ADD CONSTRAINT "SharedCustody_kind_check" CHECK(kind IN ('PROJECT','TEAM','COMPANY','CONVERSATION','MEETING'));
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('messaging.conversation','messaging.participant','messaging.message','company.association','company.knowledge-folder','company.knowledge-document','company.knowledge-version','shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.financial-workflow','company.financial-workflow-version','company.financial-approval','company.reimbursement-request','company.payment-acknowledgement','company.acknowledgement-correction','company.expense','company.budget','company.commitment','company.finance-category','company.finance-reference','company.expense-version','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry','meeting.resource','meeting.participant','meeting.invitation','meeting.agenda-entry','meeting.version','announcement.resource','announcement.version'));
CREATE TABLE "Meeting" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "kind" varchar(12) NOT NULL,
 "projectId" uuid,
 "teamId" uuid,
 "companyId" uuid,
 "legacyTeamMeetingId" uuid UNIQUE,
 "eventId" uuid NOT NULL UNIQUE,
 "createdByActorId" uuid NOT NULL,
 "externalUrl" varchar(2048),
 "state" varchar(10) NOT NULL DEFAULT 'ACTIVE',
 "revision" integer NOT NULL DEFAULT 1,
 "creationKeyHash" char(64) NOT NULL,
 "creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("spaceId","scopeId","id"),
 UNIQUE ("id","eventId"),
 UNIQUE ("spaceId","scopeId","createdByActorId","creationKeyHash"));
CREATE TABLE "MeetingMember" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "meetingId" uuid NOT NULL,
 "actorId" uuid NOT NULL,
 "role" varchar(12) NOT NULL,
 "state" varchar(10) NOT NULL,
 "rsvp" varchar(10) NOT NULL,
 "generation" integer NOT NULL DEFAULT 1,
 "revision" integer NOT NULL DEFAULT 1,
 "sourceAccessId" uuid NOT NULL,
 "sourceGeneration" integer NOT NULL,
 "restoreGeneration" integer NOT NULL,
 "joinedAt" timestamptz(3) NOT NULL,
 UNIQUE ("meetingId","actorId"),
 UNIQUE ("meetingId","id"));
CREATE TABLE "MeetingAdmission" (
 "meetingId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "joinedAt" timestamptz(3) NOT NULL,
 "endedAt" timestamptz(3),
 PRIMARY KEY ("memberId","generation"),
 UNIQUE ("meetingId","memberId","generation"));
CREATE TABLE "MeetingInvitation" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "meetingId" uuid NOT NULL,
 "recipientActorId" uuid NOT NULL,
 "inviterMemberId" uuid NOT NULL,
 "inviterMemberGeneration" integer NOT NULL,
 "inviterAccessId" uuid NOT NULL,
 "inviterGeneration" integer NOT NULL,
 "recipientAccessId" uuid,
 "recipientGeneration" integer,
 "restoreGeneration" integer NOT NULL,
 "acceptedMemberId" uuid,
 "acceptedMemberGeneration" integer,
 "state" varchar(10) NOT NULL DEFAULT 'PENDING',
 "keyHash" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 "decisionKeyHash" char(64),
 "decisionFingerprint" char(64),
 "revision" integer NOT NULL DEFAULT 1,
 "expiresAt" timestamptz(3) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("meetingId","inviterMemberId","keyHash"),
 UNIQUE ("meetingId","id"));
CREATE TABLE "MeetingAgendaEntry" (
 "id" uuid NOT NULL PRIMARY KEY,
 "meetingId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "text" text NOT NULL,
 "state" varchar(10) NOT NULL DEFAULT 'PROPOSED',
 "revision" integer NOT NULL DEFAULT 1,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("meetingId","id"));
CREATE TABLE "MeetingVersion" (
 "id" uuid NOT NULL PRIMARY KEY,
 "meetingId" uuid NOT NULL,
 "number" integer NOT NULL,
 "parentId" uuid,
 "authorMemberId" uuid NOT NULL,
 "authorGeneration" integer NOT NULL,
 "reviewerMemberId" uuid,
 "reviewerGeneration" integer,
 "minutes" text NOT NULL,
 "agenda" jsonb NOT NULL CHECK (jsonb_typeof("agenda")='array' AND jsonb_array_length("agenda")<=1000),
 "state" varchar(10) NOT NULL DEFAULT 'DRAFT',
 "revision" integer NOT NULL DEFAULT 1,
 "approvedReviewId" uuid,
 "selfFinalized" boolean NOT NULL DEFAULT false,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "finalizedAt" timestamptz(3),
 UNIQUE ("meetingId","id"),
 UNIQUE ("meetingId","number"));
CREATE TABLE "MeetingDraftContributor" (
 "meetingId" uuid NOT NULL,
 "versionId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 PRIMARY KEY ("versionId","memberId"));
CREATE TABLE "MeetingDecision" (
 "id" uuid NOT NULL PRIMARY KEY,
 "meetingId" uuid NOT NULL,
 "versionId" uuid NOT NULL,
 "position" integer NOT NULL,
 "text" text NOT NULL,
 UNIQUE ("versionId","id"),
 UNIQUE ("versionId","position"));
CREATE TABLE "MeetingAction" (
 "id" uuid NOT NULL PRIMARY KEY,
 "meetingId" uuid NOT NULL,
 "versionId" uuid NOT NULL,
 "position" integer NOT NULL,
 "title" varchar(300) NOT NULL,
 "description" text,
 UNIQUE ("meetingId","id"),
 UNIQUE ("versionId","id"),
 UNIQUE ("versionId","position"));
CREATE TABLE "MeetingReview" (
 "id" uuid NOT NULL PRIMARY KEY,
 "meetingId" uuid NOT NULL,
 "versionId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "decision" varchar(8) NOT NULL,
 "reason" varchar(2000) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("versionId","id"));
CREATE TABLE "MeetingActionRelease" (
 "id" uuid NOT NULL PRIMARY KEY,
 "meetingId" uuid NOT NULL,
 "actionId" uuid NOT NULL UNIQUE,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "active" boolean NOT NULL DEFAULT true,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp());
CREATE TABLE "MeetingTaskLink" (
 "id" uuid NOT NULL PRIMARY KEY,
 "meetingId" uuid NOT NULL,
 "actionId" uuid NOT NULL,
 "memberId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "personal" boolean NOT NULL,
 "taskId" uuid,
 "taskSpaceId" uuid,
 "taskScopeId" uuid,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("actionId","memberId","personal"));
CREATE TABLE "MeetingMutation" (
 "meetingId" uuid NOT NULL,
 "actorId" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "keyHash" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 "resourceId" uuid NOT NULL,
 "action" varchar(40) NOT NULL,
 PRIMARY KEY ("meetingId","actorId","generation","keyHash"));
CREATE TABLE "MeetingAttachment" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "meetingId" uuid,
 "announcementId" uuid,
 "uploaderActorId" uuid NOT NULL,
 "sourceAccessId" uuid NOT NULL,
 "sourceGeneration" integer NOT NULL,
 "restoreGeneration" integer NOT NULL,
 "memberId" uuid,
 "memberGeneration" integer,
 "sharedAt" timestamptz(3),
 "retiredAt" timestamptz(3),
 "revision" integer NOT NULL DEFAULT 1,
 "keyHash" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("meetingId","id"),
 UNIQUE ("announcementId","id"));
CREATE TABLE "MeetingVersionAttachment" (
 "meetingId" uuid NOT NULL,
 "versionId" uuid NOT NULL,
 "attachmentId" uuid NOT NULL,
 PRIMARY KEY ("versionId","attachmentId"));
CREATE TABLE "Announcement" (
 "id" uuid NOT NULL PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "kind" varchar(7) NOT NULL,
 "projectId" uuid,
 "teamId" uuid,
 "companyId" uuid,
 "createdByActorId" uuid NOT NULL,
 "revision" integer NOT NULL DEFAULT 1,
 "creationKeyHash" char(64) NOT NULL,
 "creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("spaceId","scopeId","id"),
 UNIQUE ("spaceId","scopeId","createdByActorId","creationKeyHash"));
CREATE TABLE "AnnouncementVersion" (
 "id" uuid NOT NULL PRIMARY KEY,
 "announcementId" uuid NOT NULL,
 "number" integer NOT NULL,
 "title" varchar(300) NOT NULL,
 "text" text NOT NULL,
 "acknowledgement" boolean NOT NULL DEFAULT false,
 "state" varchar(10) NOT NULL DEFAULT 'DRAFT',
 "pinned" boolean NOT NULL DEFAULT false,
 "revision" integer NOT NULL DEFAULT 1,
 "publisherActorId" uuid NOT NULL,
 "publisherSpaceId" uuid NOT NULL,
 "publishedAt" timestamptz(3),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("announcementId","id"),
 UNIQUE ("announcementId","number"));
CREATE TABLE "AnnouncementTarget" (
 "versionId" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "restoreGeneration" integer NOT NULL,
 PRIMARY KEY ("versionId","accessId"),
 UNIQUE ("versionId","accessId","generation"));
CREATE TABLE "AnnouncementVersionAttachment" (
 "announcementId" uuid NOT NULL,
 "versionId" uuid NOT NULL,
 "attachmentId" uuid NOT NULL,
 PRIMARY KEY ("versionId","attachmentId"));
CREATE TABLE "AnnouncementAcknowledgement" (
 "versionId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "actorId" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY ("versionId","accessId"));
CREATE TABLE "AnnouncementMutation" (
 "announcementId" uuid NOT NULL,
 "actorId" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 "generation" integer NOT NULL,
 "keyHash" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 "resourceId" uuid NOT NULL,
 "action" varchar(40) NOT NULL,
 PRIMARY KEY ("announcementId","actorId","generation","keyHash"));
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_scope_fk" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_creator_fk" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fk" FOREIGN KEY ("spaceId","projectId") REFERENCES "Project" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_teamId_fk" FOREIGN KEY ("spaceId","teamId") REFERENCES "Team" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_companyId_fk" FOREIGN KEY ("spaceId","companyId") REFERENCES "Company" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_scope_fk" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_creator_fk" FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_projectId_fk" FOREIGN KEY ("spaceId","projectId") REFERENCES "Project" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_teamId_fk" FOREIGN KEY ("spaceId","teamId") REFERENCES "Team" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_companyId_fk" FOREIGN KEY ("spaceId","companyId") REFERENCES "Company" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_event_fk" FOREIGN KEY ("spaceId","scopeId","eventId") REFERENCES "CalendarEvent" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_legacy_fk" FOREIGN KEY ("legacyTeamMeetingId") REFERENCES "TeamMeeting" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingMember" ADD CONSTRAINT "MeetingMember_meeting_fk" FOREIGN KEY ("spaceId","scopeId","meetingId") REFERENCES "Meeting" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingMember" ADD CONSTRAINT "MeetingMember_actor_fk" FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingMember" ADD CONSTRAINT "MeetingMember_source_fk" FOREIGN KEY ("spaceId","scopeId","sourceAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingMember" ADD CONSTRAINT "MeetingMember_interval_fk" FOREIGN KEY ("sourceAccessId","sourceGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAdmission" ADD CONSTRAINT "MeetingAdmission_member_fk" FOREIGN KEY ("meetingId","memberId") REFERENCES "MeetingMember" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_meeting_fk" FOREIGN KEY ("spaceId","scopeId","meetingId") REFERENCES "Meeting" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_recipient_fk" FOREIGN KEY ("spaceId","recipientActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_issuer_fk" FOREIGN KEY ("meetingId","inviterMemberId","inviterMemberGeneration") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_issuerInterval_fk" FOREIGN KEY ("inviterAccessId","inviterGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_recipientInterval_fk" FOREIGN KEY ("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingInvitation" ADD CONSTRAINT "MeetingInvitation_accepted_fk" FOREIGN KEY ("meetingId","acceptedMemberId","acceptedMemberGeneration") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAgendaEntry" ADD CONSTRAINT "MeetingAgendaEntry_memberId_fk" FOREIGN KEY ("meetingId","memberId","generation") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingVersion" ADD CONSTRAINT "MeetingVersion_authorMemberId_fk" FOREIGN KEY ("meetingId","authorMemberId","authorGeneration") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingVersion" ADD CONSTRAINT "MeetingVersion_reviewerMemberId_fk" FOREIGN KEY ("meetingId","reviewerMemberId","reviewerGeneration") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingDraftContributor" ADD CONSTRAINT "MeetingDraftContributor_memberId_fk" FOREIGN KEY ("meetingId","memberId","generation") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingReview" ADD CONSTRAINT "MeetingReview_memberId_fk" FOREIGN KEY ("meetingId","memberId","generation") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingActionRelease" ADD CONSTRAINT "MeetingActionRelease_memberId_fk" FOREIGN KEY ("meetingId","memberId","generation") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingTaskLink" ADD CONSTRAINT "MeetingTaskLink_memberId_fk" FOREIGN KEY ("meetingId","memberId","generation") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_memberId_fk" FOREIGN KEY ("meetingId","memberId","memberGeneration") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingVersion" ADD CONSTRAINT "MeetingVersion_meeting_fk" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingVersion" ADD CONSTRAINT "MeetingVersion_parent_fk" FOREIGN KEY ("meetingId","parentId") REFERENCES "MeetingVersion" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingVersion" ADD CONSTRAINT "MeetingVersion_approval_fk" FOREIGN KEY ("id","approvedReviewId") REFERENCES "MeetingReview" ("versionId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingDraftContributor" ADD CONSTRAINT "MeetingDraftContributor_version_fk" FOREIGN KEY ("meetingId","versionId") REFERENCES "MeetingVersion" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_version_fk" FOREIGN KEY ("meetingId","versionId") REFERENCES "MeetingVersion" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAction" ADD CONSTRAINT "MeetingAction_version_fk" FOREIGN KEY ("meetingId","versionId") REFERENCES "MeetingVersion" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingReview" ADD CONSTRAINT "MeetingReview_version_fk" FOREIGN KEY ("meetingId","versionId") REFERENCES "MeetingVersion" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingVersionAttachment" ADD CONSTRAINT "MeetingVersionAttachment_version_fk" FOREIGN KEY ("meetingId","versionId") REFERENCES "MeetingVersion" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingActionRelease" ADD CONSTRAINT "MeetingActionRelease_action_fk" FOREIGN KEY ("meetingId","actionId") REFERENCES "MeetingAction" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingTaskLink" ADD CONSTRAINT "MeetingTaskLink_action_fk" FOREIGN KEY ("meetingId","actionId") REFERENCES "MeetingAction" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingTaskLink" ADD CONSTRAINT "MeetingTaskLink_task_fk" FOREIGN KEY ("taskSpaceId","taskId") REFERENCES "Task" ("spaceId","id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "MeetingMutation" ADD CONSTRAINT "MeetingMutation_meeting_fk" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingMutation" ADD CONSTRAINT "MeetingMutation_actor_fk" FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_meeting_fk" FOREIGN KEY ("spaceId","scopeId","meetingId") REFERENCES "Meeting" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_announcement_fk" FOREIGN KEY ("spaceId","scopeId","announcementId") REFERENCES "Announcement" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_file_fk" FOREIGN KEY ("spaceId","scopeId","id") REFERENCES "StoredFile" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_uploader_fk" FOREIGN KEY ("spaceId","uploaderActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAttachment" ADD CONSTRAINT "MeetingAttachment_interval_fk" FOREIGN KEY ("sourceAccessId","sourceGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingVersionAttachment" ADD CONSTRAINT "MeetingVersionAttachment_attachment_fk" FOREIGN KEY ("meetingId","attachmentId") REFERENCES "MeetingAttachment" ("meetingId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementVersion" ADD CONSTRAINT "AnnouncementVersion_announcement_fk" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementVersion" ADD CONSTRAINT "AnnouncementVersion_publisher_fk" FOREIGN KEY ("publisherSpaceId","publisherActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_version_fk" FOREIGN KEY ("versionId") REFERENCES "AnnouncementVersion" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_source_fk" FOREIGN KEY ("spaceId","scopeId","accessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementTarget" ADD CONSTRAINT "AnnouncementTarget_interval_fk" FOREIGN KEY ("accessId","generation") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementVersionAttachment" ADD CONSTRAINT "AnnouncementVersionAttachment_version_fk" FOREIGN KEY ("announcementId","versionId") REFERENCES "AnnouncementVersion" ("announcementId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementVersionAttachment" ADD CONSTRAINT "AnnouncementVersionAttachment_attachment_fk" FOREIGN KEY ("announcementId","attachmentId") REFERENCES "MeetingAttachment" ("announcementId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementAcknowledgement" ADD CONSTRAINT "AnnouncementAcknowledgement_target_fk" FOREIGN KEY ("versionId","accessId","generation") REFERENCES "AnnouncementTarget" ("versionId","accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementAcknowledgement" ADD CONSTRAINT "AnnouncementAcknowledgement_actor_fk" FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementMutation" ADD CONSTRAINT "AnnouncementMutation_announcement_fk" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementMutation" ADD CONSTRAINT "AnnouncementMutation_actor_fk" FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "AnnouncementMutation" ADD CONSTRAINT "AnnouncementMutation_interval_fk" FOREIGN KEY ("accessId","generation") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Meeting" ADD CHECK ("revision">0);
ALTER TABLE "MeetingMember" ADD CHECK ("revision">0);
ALTER TABLE "MeetingInvitation" ADD CHECK ("revision">0);
ALTER TABLE "MeetingAgendaEntry" ADD CHECK ("revision">0);
ALTER TABLE "MeetingVersion" ADD CHECK ("revision">0);
ALTER TABLE "MeetingActionRelease" ADD CHECK ("revision">0);
ALTER TABLE "MeetingAttachment" ADD CHECK ("revision">0);
ALTER TABLE "Announcement" ADD CHECK ("revision">0);
ALTER TABLE "AnnouncementVersion" ADD CHECK ("revision">0);
ALTER TABLE "Announcement" ADD CHECK (((kind='PROJECT' AND "projectId"="scopeId" AND "projectId" IS NOT NULL AND "teamId" IS NULL AND "companyId" IS NULL) OR (kind='TEAM' AND "teamId"="scopeId" AND "teamId" IS NOT NULL AND "projectId" IS NULL AND "companyId" IS NULL) OR (kind='COMPANY' AND "companyId"="spaceId" AND "scopeId"="spaceId" AND "companyId" IS NOT NULL AND "projectId" IS NULL AND "teamId" IS NULL)));
ALTER TABLE "Meeting" ADD CHECK ((kind='INDEPENDENT' AND id="spaceId" AND "scopeId"="spaceId" AND "projectId" IS NULL AND "teamId" IS NULL AND "companyId" IS NULL) OR ((kind='PROJECT' AND "projectId"="scopeId" AND "projectId" IS NOT NULL AND "teamId" IS NULL AND "companyId" IS NULL) OR (kind='TEAM' AND "teamId"="scopeId" AND "teamId" IS NOT NULL AND "projectId" IS NULL AND "companyId" IS NULL) OR (kind='COMPANY' AND "companyId"="spaceId" AND "scopeId"="spaceId" AND "companyId" IS NOT NULL AND "projectId" IS NULL AND "teamId" IS NULL)));
ALTER TABLE "Meeting" ADD CHECK (state IN ('ACTIVE','CANCELED') AND ("externalUrl" IS NULL OR length("externalUrl") BETWEEN 1 AND 2048));
ALTER TABLE "MeetingMember" ADD CHECK (role IN ('ORGANIZER','PARTICIPANT') AND state IN ('ACTIVE','LEFT','REVOKED') AND rsvp IN ('ACCEPTED','TENTATIVE','DECLINED') AND generation>0 AND "sourceGeneration">0 AND "restoreGeneration">=0);
ALTER TABLE "MeetingAdmission" ADD CHECK (generation>0 AND ("endedAt" IS NULL OR "endedAt">="joinedAt"));
ALTER TABLE "MeetingInvitation" ADD CHECK (state IN ('PENDING','ACCEPTED','TENTATIVE','DECLINED','REVOKED') AND "expiresAt">"createdAt" AND ("recipientAccessId" IS NULL)=("recipientGeneration" IS NULL) AND ("acceptedMemberId" IS NULL)=("acceptedMemberGeneration" IS NULL) AND ("decisionKeyHash" IS NULL)=("decisionFingerprint" IS NULL));
ALTER TABLE "MeetingAgendaEntry" ADD CHECK (state IN ('PROPOSED','ACCEPTED','REJECTED') AND length(btrim(text)) BETWEEN 1 AND 10000);
ALTER TABLE "MeetingVersion" ADD CHECK (number>0 AND length(minutes)<=50000 AND state IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','FINAL') AND ("reviewerMemberId" IS NULL)=("reviewerGeneration" IS NULL) AND ("reviewerMemberId" IS NULL OR "reviewerMemberId"<>"authorMemberId") AND (state NOT IN ('APPROVED','FINAL') OR "approvedReviewId" IS NOT NULL OR (state='FINAL' AND "selfFinalized")) AND (state='FINAL')=("finalizedAt" IS NOT NULL));
ALTER TABLE "MeetingDecision" ADD CHECK (position>=0 AND length(btrim(text)) BETWEEN 1 AND 10000);
ALTER TABLE "MeetingAction" ADD CHECK (position>=0 AND length(btrim(title)) BETWEEN 1 AND 300 AND ("description" IS NULL OR length("description")<=10000));
ALTER TABLE "MeetingReview" ADD CHECK (decision IN ('APPROVE','REJECT') AND length(btrim(reason)) BETWEEN 1 AND 2000);
ALTER TABLE "MeetingAttachment" ADD CHECK (("meetingId" IS NULL)<>("announcementId" IS NULL) AND ("memberId" IS NULL)=("memberGeneration" IS NULL));
ALTER TABLE "MeetingMutation" ADD CHECK (generation>=0);
ALTER TABLE "AnnouncementVersion" ADD CHECK (number>0 AND state IN ('DRAFT','PUBLISHED','WITHDRAWN') AND length(btrim(title)) BETWEEN 1 AND 300 AND length(btrim(text)) BETWEEN 1 AND 50000 AND (state='DRAFT')=("publishedAt" IS NULL));
CREATE UNIQUE INDEX "MeetingAdmission_open" ON "MeetingAdmission"("memberId") WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "MeetingInvitation_pending" ON "MeetingInvitation"("meetingId","recipientActorId") WHERE state='PENDING';
CREATE UNIQUE INDEX "MeetingTaskLink_work_once" ON "MeetingTaskLink"("actionId") WHERE NOT personal;
CREATE UNIQUE INDEX "AnnouncementVersion_published" ON "AnnouncementVersion"("announcementId") WHERE state='PUBLISHED';
CREATE INDEX "Meeting_page" ON "Meeting" ("spaceId","scopeId","id");
CREATE INDEX "MeetingMember_page" ON "MeetingMember" ("actorId","state","meetingId");
CREATE INDEX "MeetingInvitation_page" ON "MeetingInvitation" ("recipientActorId","state","id");
CREATE INDEX "MeetingAgendaEntry_page" ON "MeetingAgendaEntry" ("meetingId","id");
CREATE INDEX "MeetingVersion_page" ON "MeetingVersion" ("meetingId","number");
CREATE INDEX "MeetingAttachment_page" ON "MeetingAttachment" ("retiredAt","createdAt","id");
CREATE INDEX "Announcement_page" ON "Announcement" ("spaceId","scopeId","id");
CREATE INDEX "AnnouncementTarget_page" ON "AnnouncementTarget" ("accessId","generation","versionId");
-- Preserve both prior Personal and Team Calendar branches, adding typed meeting sources.
CREATE OR REPLACE FUNCTION team_calendar_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
 DECLARE personal boolean;
 BEGIN
 SELECT kind='PERSONAL' INTO personal FROM "Space" WHERE id=NEW."spaceId";
 IF personal IS NULL OR (personal AND (NEW."createdByUserId" IS NULL OR NEW."scopeId" IS NOT NULL OR NEW."createdByActorId" IS NOT NULL)) OR
 (NOT personal AND (NEW."createdByUserId" IS NOT NULL OR NEW."scopeId" IS NULL OR NEW."createdByActorId" IS NULL OR NOT (
 EXISTS(SELECT 1 FROM "Team" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId") OR
 EXISTS(SELECT 1 FROM "Project" WHERE "spaceId"=NEW."spaceId" AND "scopeId"=NEW."scopeId") OR
 EXISTS(SELECT 1 FROM "Company" WHERE "spaceId"=NEW."spaceId" AND id=NEW."scopeId") OR
 EXISTS(SELECT 1 FROM "Meeting" WHERE kind='INDEPENDENT' AND id=NEW."spaceId" AND "scopeId"=NEW."scopeId"))))
 THEN RAISE EXCEPTION 'Invalid Personal/meeting Calendar branch' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."spaceId",NEW."scopeId",NEW."createdByUserId",NEW."createdByActorId") IS DISTINCT FROM
 (OLD."spaceId",OLD."scopeId",OLD."createdByUserId",OLD."createdByActorId") THEN
 RAISE EXCEPTION 'Calendar custody and attribution immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
 END; $$;

ALTER TABLE "MeetingTaskLink" ADD CHECK (("taskId" IS NULL)=("taskSpaceId" IS NULL) AND (personal OR "taskId" IS NULL OR "taskScopeId" IS NOT NULL));
CREATE FUNCTION meeting_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Immutable meeting/publication content' USING ERRCODE='23514'; END $$;
CREATE FUNCTION meeting_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW."meetingId",NEW.number,NEW."parentId",NEW."authorMemberId",NEW."authorGeneration",NEW.minutes,NEW.agenda,NEW."createdAt")
 IS DISTINCT FROM (OLD.id,OLD."meetingId",OLD.number,OLD."parentId",OLD."authorMemberId",OLD."authorGeneration",OLD.minutes,OLD.agenda,OLD."createdAt")
 OR (OLD.state<>'DRAFT' AND (NEW."reviewerMemberId",NEW."reviewerGeneration") IS DISTINCT FROM (OLD."reviewerMemberId",OLD."reviewerGeneration"))
 OR (OLD.state='FINAL' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Immutable meeting version' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "MeetingVersion_immutable" BEFORE UPDATE OR DELETE ON "MeetingVersion" FOR EACH ROW EXECUTE FUNCTION meeting_version_immutable();
CREATE FUNCTION announcement_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW."announcementId",NEW.number,NEW.title,NEW.text,NEW.acknowledgement,NEW."publisherActorId",NEW."publisherSpaceId",NEW."createdAt")
 IS DISTINCT FROM (OLD.id,OLD."announcementId",OLD.number,OLD.title,OLD.text,OLD.acknowledgement,OLD."publisherActorId",OLD."publisherSpaceId",OLD."createdAt")
 OR (OLD.state<>'DRAFT' AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt")
 OR (OLD.state='WITHDRAWN' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Immutable announcement version' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER "AnnouncementVersion_immutable" BEFORE UPDATE OR DELETE ON "AnnouncementVersion" FOR EACH ROW EXECUTE FUNCTION announcement_version_immutable();
CREATE TRIGGER "MeetingDraftContributor_immutable" BEFORE UPDATE OR DELETE ON "MeetingDraftContributor" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "MeetingDecision_immutable" BEFORE UPDATE OR DELETE ON "MeetingDecision" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "MeetingAction_immutable" BEFORE UPDATE OR DELETE ON "MeetingAction" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "MeetingReview_immutable" BEFORE UPDATE OR DELETE ON "MeetingReview" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "MeetingMutation_immutable" BEFORE UPDATE OR DELETE ON "MeetingMutation" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "MeetingVersionAttachment_immutable" BEFORE UPDATE OR DELETE ON "MeetingVersionAttachment" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "AnnouncementTarget_immutable" BEFORE UPDATE OR DELETE ON "AnnouncementTarget" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "AnnouncementVersionAttachment_immutable" BEFORE UPDATE OR DELETE ON "AnnouncementVersionAttachment" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();
CREATE TRIGGER "AnnouncementMutation_immutable" BEFORE UPDATE OR DELETE ON "AnnouncementMutation" FOR EACH ROW EXECUTE FUNCTION meeting_content_immutable();

COMMIT;
