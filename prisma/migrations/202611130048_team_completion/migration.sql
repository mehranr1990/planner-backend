BEGIN;
CREATE TABLE "TeamSetting" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "planningMode" varchar(10) NOT NULL DEFAULT 'WEEKLY' CHECK("planningMode" IN ('WEEKLY','SPRINTS')),
 "estimateUnit" varchar(10) CHECK("estimateUnit" IN ('HOURS','POINTS')),
 "weekStart" smallint CHECK("weekStart" BETWEEN 0 AND 6),
 "checkinsEnabled" boolean,
 "statusEnabled" boolean,
 color varchar(7) CHECK(color ~ '^#[A-Fa-f0-9]{6}$'),
 "shortName" varchar(32) CHECK(length(btrim("shortName"))>0),
 "defaultInviteRole" varchar(10) CHECK("defaultInviteRole" IN ('ADMIN','LEAD','MEMBER','VIEWER')),
 "checkinCadence" varchar(6) CHECK("checkinCadence" IN ('DAILY','WEEKLY')),
 "checkinOpensDay" smallint CHECK("checkinOpensDay" BETWEEN 0 AND 6),
 "checkinOpensTime" char(5) CHECK("checkinOpensTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 "checkinClosesDay" smallint CHECK("checkinClosesDay" BETWEEN 0 AND 6),
 "checkinClosesTime" char(5) CHECK("checkinClosesTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 "checkinTimezone" varchar(100) CHECK(length("checkinTimezone")>0),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamSetting_schedule_shape" CHECK((num_nonnulls("checkinCadence","checkinOpensDay","checkinOpensTime","checkinClosesDay","checkinClosesTime","checkinTimezone")=0) OR ("checkinCadence"='WEEKLY' AND num_nonnulls("checkinOpensDay","checkinOpensTime","checkinClosesDay","checkinClosesTime","checkinTimezone")=5) OR ("checkinCadence"='DAILY' AND num_nonnulls("checkinOpensDay","checkinClosesDay")=0 AND num_nonnulls("checkinOpensTime","checkinClosesTime","checkinTimezone")=3)),
 CONSTRAINT "TeamSetting_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","scopeId")
);
CREATE TABLE "TeamPresence" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 status varchar(10) CHECK(status IN ('AVAILABLE','BUSY','AWAY','OFFLINE')),
 note varchar(200) NOT NULL DEFAULT '',
 "clearAfter" varchar(5) NOT NULL DEFAULT 'NEVER' CHECK("clearAfter" IN ('HOUR','TODAY','WEEK','NEVER')),
 "until" timestamptz(3),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamPresence_cleared_shape" CHECK(status IS NOT NULL OR (note='' AND "clearAfter"='NEVER')),
 CONSTRAINT "TeamPresence_until_shape" CHECK(("clearAfter"='NEVER')=("until" IS NULL)),
 CONSTRAINT "TeamPresence_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamPresence_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamPresence_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","accessId",generation)
);
CREATE TABLE "TeamCheckinReply" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 period date NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 state varchar(8) NOT NULL CHECK(state IN ('SENT','SKIPPED')),
 did varchar(2000),
 "next" varchar(2000),
 blocked varchar(2000),
 late boolean NOT NULL DEFAULT false,
 "sentAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 CONSTRAINT "TeamCheckinReply_answer_shape" CHECK((state='SKIPPED' AND num_nonnulls(did,"next",blocked)=0) OR (state='SENT' AND num_nonnulls(did,"next",blocked)=3 AND (length(btrim(did))>0 OR length(btrim("next"))>0))),
 CONSTRAINT "TeamCheckinReply_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamCheckinReply_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamCheckinReply_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","scopeId",period,"accessId",generation),
 UNIQUE("spaceId",id)
);
CREATE INDEX "TeamCheckinReply_period" ON "TeamCheckinReply"("spaceId","scopeId",period,id);
CREATE TABLE "TeamCheckinComment" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "replyId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 body varchar(2000) NOT NULL CHECK(length(btrim(body))>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamCheckinComment_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamCheckinComment_reply" FOREIGN KEY("spaceId","replyId") REFERENCES "TeamCheckinReply"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamCheckinComment_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamCheckinComment_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "TeamCheckinComment_reply" ON "TeamCheckinComment"("spaceId","replyId","createdAt",id);
CREATE TABLE "TeamTaskState" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "taskId" uuid NOT NULL,
 state varchar(8) NOT NULL CHECK(state IN ('REVIEW','BLOCKED')),
 "taskStatus" varchar(12) NOT NULL CHECK("taskStatus" IN ('OPEN','IN_PROGRESS')),
 "updatedByActorId" uuid NOT NULL,
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamTaskState_review_shape" CHECK(state<>'REVIEW' OR "taskStatus"='IN_PROGRESS'),
 CONSTRAINT "TeamTaskState_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskState_task" FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskState_actor" FOREIGN KEY("spaceId","updatedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","taskId")
);
CREATE TABLE "TeamThanks" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "authorAccessId" uuid NOT NULL,
 "authorGeneration" integer NOT NULL CHECK("authorGeneration">0),
 body varchar(1000) NOT NULL CHECK(length(btrim(body))>0),
 visibility varchar(8) NOT NULL CHECK(visibility IN ('TEAM','PRIVATE')),
 "linkKind" varchar(5) CHECK("linkKind" IN ('TASK','GOAL')),
 "linkId" uuid,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "removedAt" timestamptz(3),
 "removedByActorId" uuid,
 CONSTRAINT "TeamThanks_link_shape" CHECK(num_nonnulls("linkKind","linkId") IN (0,2)),
 CONSTRAINT "TeamThanks_removed_shape" CHECK(num_nonnulls("removedAt","removedByActorId") IN (0,2)),
 CONSTRAINT "TeamThanks_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamThanks_author" FOREIGN KEY("spaceId","scopeId","authorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamThanks_author_generation" FOREIGN KEY("authorAccessId","authorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamThanks_remover" FOREIGN KEY("spaceId","removedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId",id)
);
CREATE INDEX "TeamThanks_feed" ON "TeamThanks"("spaceId","scopeId","createdAt",id);
CREATE TABLE "TeamThanksRecipient" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "thanksId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 hidden boolean NOT NULL DEFAULT false,
 CONSTRAINT "TeamThanksRecipient_thanks" FOREIGN KEY("spaceId","thanksId") REFERENCES "TeamThanks"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamThanksRecipient_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamThanksRecipient_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("thanksId","accessId",generation)
);
CREATE INDEX "TeamThanksRecipient_member" ON "TeamThanksRecipient"("spaceId","accessId",generation,"thanksId");
CREATE TABLE "TeamFeedbackRequest" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "requesterAccessId" uuid NOT NULL,
 "requesterGeneration" integer NOT NULL CHECK("requesterGeneration">0),
 "askedAccessId" uuid NOT NULL,
 "askedGeneration" integer NOT NULL CHECK("askedGeneration">0),
 about varchar(300) NOT NULL CHECK(length(btrim(about))>0),
 question varchar(2000) NOT NULL CHECK(length(btrim(question))>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "answeredAt" timestamptz(3),
 CONSTRAINT "TeamFeedbackRequest_distinct" CHECK("requesterAccessId"<>"askedAccessId"),
 CONSTRAINT "TeamFeedbackRequest_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackRequest_requester" FOREIGN KEY("spaceId","scopeId","requesterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackRequest_requester_generation" FOREIGN KEY("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackRequest_asked" FOREIGN KEY("spaceId","scopeId","askedAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackRequest_asked_generation" FOREIGN KEY("askedAccessId","askedGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId",id)
);
CREATE TABLE "TeamFeedbackNote" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "authorAccessId" uuid NOT NULL,
 "authorGeneration" integer NOT NULL CHECK("authorGeneration">0),
 "recipientAccessId" uuid NOT NULL,
 "recipientGeneration" integer NOT NULL CHECK("recipientGeneration">0),
 about varchar(300) NOT NULL CHECK(length(btrim(about))>0),
 body varchar(4000) NOT NULL CHECK(length(btrim(body))>0),
 "requestId" uuid,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamFeedbackNote_distinct" CHECK("authorAccessId"<>"recipientAccessId"),
 CONSTRAINT "TeamFeedbackNote_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackNote_author" FOREIGN KEY("spaceId","scopeId","authorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackNote_author_generation" FOREIGN KEY("authorAccessId","authorGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackNote_recipient" FOREIGN KEY("spaceId","scopeId","recipientAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackNote_recipient_generation" FOREIGN KEY("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFeedbackNote_request" FOREIGN KEY("spaceId","requestId") REFERENCES "TeamFeedbackRequest"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("requestId")
);
ALTER TABLE "TeamPlan" ADD COLUMN focus varchar(300)[] NOT NULL DEFAULT '{}';
ALTER TABLE "TeamPlan" ADD COLUMN "focusByActorId" uuid;
ALTER TABLE "TeamPlan" ADD COLUMN "focusAt" timestamptz(3);
ALTER TABLE "TeamPlan" ADD COLUMN goal varchar(300);
ALTER TABLE "TeamPlan" ADD COLUMN "publishedAt" timestamptz(3);
ALTER TABLE "TeamPlan" ADD COLUMN "publishedByActorId" uuid;
ALTER TABLE "TeamPlan" ADD COLUMN "closedAt" timestamptz(3);
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_focus_shape" CHECK(cardinality(focus)<=10 AND (kind='WEEK' OR cardinality(focus)=0) AND num_nonnulls("focusByActorId","focusAt") IN (0,2));
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_goal_shape" CHECK(goal IS NULL OR (kind='SPRINT' AND length(btrim(goal))>0));
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_published_shape" CHECK(num_nonnulls("publishedAt","publishedByActorId") IN (0,2));
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_focus_actor" FOREIGN KEY("spaceId","focusByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_published_actor" FOREIGN KEY("spaceId","publishedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamWorkItem" ADD COLUMN "carriedFromPlanId" uuid;
ALTER TABLE "TeamWorkItem" ADD COLUMN "plannedAt" timestamptz(3);
ALTER TABLE "TeamWorkItem" ADD CONSTRAINT "TeamWorkItem_carried_shape" CHECK("carriedFromPlanId" IS NULL OR "carriedFromPlanId" IS DISTINCT FROM "planId");
ALTER TABLE "TeamWorkItem" ADD CONSTRAINT "TeamWorkItem_carried_plan" FOREIGN KEY("spaceId","scopeId","carriedFromPlanId") REFERENCES "TeamPlan"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;
COMMIT;
