BEGIN;
-- Team assignments (TA): explicit, versioned consent records over shared Team Tasks.
CREATE TABLE "TeamTaskAssignment" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "taskId" uuid NOT NULL,
 "assigneeAccessId" uuid NOT NULL,
 "assigneeGeneration" integer NOT NULL CHECK("assigneeGeneration">0),
 "issuerAccessId" uuid NOT NULL,
 "issuerGeneration" integer NOT NULL CHECK("issuerGeneration">0),
 state varchar(8) NOT NULL CHECK(state IN ('PENDING','ACCEPTED','DECLINED','REMOVED')),
 "declineReason" varchar(1000) CHECK("declineReason" IS NULL OR length(btrim("declineReason"))>0),
 "endReason" varchar(10) CHECK("endReason" IN ('REMOVED','REASSIGNED')),
 "endedByActorId" uuid,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "respondedAt" timestamptz(3),
 "endedAt" timestamptz(3),
 CONSTRAINT "TeamTaskAssignment_end_shape" CHECK(num_nonnulls("endedAt","endReason","endedByActorId") IN (0,3) AND (state='REMOVED')=("endedAt" IS NOT NULL)),
 CONSTRAINT "TeamTaskAssignment_decline_shape" CHECK(("declineReason" IS NULL OR state='DECLINED') AND (state NOT IN ('ACCEPTED','DECLINED') OR "respondedAt" IS NOT NULL)),
 CONSTRAINT "TeamTaskAssignment_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignment_task" FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignment_assignee" FOREIGN KEY("spaceId","scopeId","assigneeAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignment_assignee_generation" FOREIGN KEY("assigneeAccessId","assigneeGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignment_issuer" FOREIGN KEY("spaceId","scopeId","issuerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignment_issuer_generation" FOREIGN KEY("issuerAccessId","issuerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignment_ender" FOREIGN KEY("spaceId","endedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId",id)
);
CREATE UNIQUE INDEX "TeamTaskAssignment_open" ON "TeamTaskAssignment"("spaceId","taskId","assigneeAccessId") WHERE state IN ('PENDING','ACCEPTED');
CREATE INDEX "TeamTaskAssignment_task_page" ON "TeamTaskAssignment"("spaceId","scopeId","taskId",id);
CREATE INDEX "TeamTaskAssignment_assignee_page" ON "TeamTaskAssignment"("assigneeAccessId","assigneeGeneration",state,id);
CREATE TABLE "TeamTaskAssignmentEvent" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "assignmentId" uuid NOT NULL,
 action varchar(10) NOT NULL CHECK(action IN ('ASSIGNED','ACCEPTED','DECLINED','REMOVED','REASSIGNED','REMINDED')),
 "actorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamTaskAssignmentEvent_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignmentEvent_assignment" FOREIGN KEY("spaceId","assignmentId") REFERENCES "TeamTaskAssignment"("spaceId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskAssignmentEvent_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "TeamTaskAssignmentEvent_page" ON "TeamTaskAssignmentEvent"("spaceId","assignmentId","createdAt",id);
-- Story points (SP): per Task, distinct from time estimates.
CREATE TABLE "TeamTaskPoints" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "taskId" uuid NOT NULL,
 points smallint CHECK(points BETWEEN 0 AND 1000),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedByActorId" uuid NOT NULL,
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamTaskPoints_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskPoints_task" FOREIGN KEY("spaceId","scopeId","taskId") REFERENCES "Task"("spaceId","scopeId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "TeamTaskPoints_actor" FOREIGN KEY("spaceId","updatedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","taskId")
);
-- Time off (TO): member requests, manager decisions, private reason.
CREATE TABLE "TeamTimeOff" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 "startDate" date NOT NULL,
 "endDate" date NOT NULL,
 "minutesPerDay" integer CHECK("minutesPerDay" BETWEEN 1 AND 1440),
 reason varchar(1000) CHECK(reason IS NULL OR length(btrim(reason))>0),
 state varchar(9) NOT NULL CHECK(state IN ('PENDING','APPROVED','REJECTED','CANCELED')),
 "decisionNote" varchar(1000) CHECK("decisionNote" IS NULL OR length(btrim("decisionNote"))>0),
 "decidedByActorId" uuid,
 "decidedAt" timestamptz(3),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamTimeOff_range" CHECK("endDate">="startDate" AND "endDate"-"startDate"<=366),
 CONSTRAINT "TeamTimeOff_decision_shape" CHECK(num_nonnulls("decidedByActorId","decidedAt") IN (0,2) AND (state NOT IN ('APPROVED','REJECTED') OR "decidedAt" IS NOT NULL) AND (state<>'PENDING' OR "decidedAt" IS NULL) AND ("decisionNote" IS NULL OR "decidedAt" IS NOT NULL)),
 CONSTRAINT "TeamTimeOff_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTimeOff_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTimeOff_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTimeOff_decider" FOREIGN KEY("spaceId","decidedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId",id)
);
CREATE INDEX "TeamTimeOff_page" ON "TeamTimeOff"("spaceId","scopeId","startDate",id);
CREATE TABLE "TeamTimeOffEvent" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "timeOffId" uuid NOT NULL,
 action varchar(9) NOT NULL CHECK(action IN ('SUBMITTED','APPROVED','REJECTED','CANCELED')),
 "actorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamTimeOffEvent_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTimeOffEvent_request" FOREIGN KEY("spaceId","timeOffId") REFERENCES "TeamTimeOff"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamTimeOffEvent_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "TeamTimeOffEvent_page" ON "TeamTimeOffEvent"("spaceId","timeOffId","createdAt",id);
-- Goal key results (GL): numeric, reproducible from recorded values or linked Tasks.
CREATE TABLE "TeamKeyResult" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "goalId" uuid NOT NULL,
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),
 unit varchar(30) CHECK(unit IS NULL OR length(btrim(unit))>0),
 source varchar(6) NOT NULL CHECK(source IN ('MANUAL','TASKS')),
 "startValue" numeric(20,4) NOT NULL,
 "targetValue" numeric(20,4) NOT NULL,
 "archivedAt" timestamptz(3),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdByActorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamKeyResult_range" CHECK("targetValue"<>"startValue" AND (source='MANUAL' OR ("startValue"=0 AND "targetValue">0))),
 CONSTRAINT "TeamKeyResult_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamKeyResult_goal" FOREIGN KEY("spaceId","scopeId","goalId") REFERENCES "Goal"("spaceId","scopeId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "TeamKeyResult_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId",id)
);
CREATE INDEX "TeamKeyResult_goal_page" ON "TeamKeyResult"("spaceId","goalId",id);
CREATE TABLE "TeamKeyResultCheckin" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "keyResultId" uuid NOT NULL,
 value numeric(20,4) NOT NULL,
 note varchar(500) CHECK(note IS NULL OR length(btrim(note))>0),
 "actorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamKeyResultCheckin_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamKeyResultCheckin_result" FOREIGN KEY("spaceId","keyResultId") REFERENCES "TeamKeyResult"("spaceId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "TeamKeyResultCheckin_actor" FOREIGN KEY("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "TeamKeyResultCheckin_page" ON "TeamKeyResultCheckin"("spaceId","keyResultId","createdAt",id);
-- Membership settings (MB): optional job title per admission generation.
CREATE TABLE "TeamMemberProfile" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0),
 "jobTitle" varchar(100) CHECK("jobTitle" IS NULL OR length(btrim("jobTitle"))>0),
 revision integer NOT NULL DEFAULT 2 CHECK(revision>1),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamMemberProfile_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamMemberProfile_member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamMemberProfile_generation" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","accessId",generation)
);
-- In-app Team notifications (RM): idempotent per recipient admission and dedupe key.
CREATE TABLE "TeamNotification" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "recipientAccessId" uuid NOT NULL,
 "recipientGeneration" integer NOT NULL CHECK("recipientGeneration">0),
 kind varchar(20) NOT NULL CHECK(kind IN ('ASSIGNMENT','ASSIGNMENT_REMINDER','CHECKIN_REMINDER','TIME_OFF_DECIDED')),
 "subjectId" uuid NOT NULL,
 "dedupeKey" varchar(120) NOT NULL CHECK(length("dedupeKey")>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "readAt" timestamptz(3),
 CONSTRAINT "TeamNotification_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamNotification_member" FOREIGN KEY("spaceId","scopeId","recipientAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamNotification_generation" FOREIGN KEY("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","recipientAccessId","recipientGeneration","dedupeKey")
);
CREATE INDEX "TeamNotification_inbox" ON "TeamNotification"("recipientAccessId","recipientGeneration",id);
ALTER TABLE "TeamSetting" ADD COLUMN "checkinReminderMinutes" integer CHECK("checkinReminderMinutes" BETWEEN 1 AND 1440);
-- Recognition (AN): optional Project association, re-authorized on every read.
ALTER TABLE "TeamThanks" ADD COLUMN "projectId" uuid;
-- Company legal and fiscal settings (LS).
ALTER TABLE "Company" ADD COLUMN "legalName" varchar(300) CHECK("legalName" IS NULL OR length(btrim("legalName"))>0), ADD COLUMN "fiscalStartMonth" smallint CHECK("fiscalStartMonth" BETWEEN 1 AND 12);
-- Rejection reasons (ER, AT): erasable text beside immutable decision events.
CREATE TABLE "CompanyDecisionReason" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "expenseEventId" uuid,
 "approvalEventId" uuid,
 "authorActorId" uuid NOT NULL,
 reason varchar(1000) CHECK(reason IS NULL OR length(btrim(reason))>0),
 "redactedAt" timestamptz(3),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyDecisionReason_target" CHECK(num_nonnulls("expenseEventId","approvalEventId")=1),
 CONSTRAINT "CompanyDecisionReason_redaction" CHECK((reason IS NULL)=("redactedAt" IS NOT NULL)),
 CONSTRAINT "CompanyDecisionReason_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDecisionReason_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDecisionReason_expense" FOREIGN KEY("spaceId","scopeId","expenseEventId") REFERENCES "CompanyExpenseReviewEvent"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDecisionReason_approval" FOREIGN KEY("spaceId","scopeId","approvalEventId") REFERENCES "CompanyFinancialApprovalEvent"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyDecisionReason_author" FOREIGN KEY("spaceId","authorActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("expenseEventId"),
 UNIQUE("approvalEventId")
);
-- Budget changes (BU): versioned requests; the budget stays effective until approval.
CREATE TABLE "CompanyBudgetChangeRequest" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "budgetId" uuid NOT NULL,
 "budgetRevision" integer NOT NULL CHECK("budgetRevision">0),
 amount numeric(28,4) NOT NULL CHECK(amount<>0),
 "requesterAccessId" uuid NOT NULL,
 "requesterGeneration" integer NOT NULL CHECK("requesterGeneration">0),
 "requesterActorId" uuid NOT NULL,
 reason varchar(1000) CHECK(reason IS NULL OR length(btrim(reason))>0),
 state varchar(9) NOT NULL CHECK(state IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
 "deciderActorId" uuid,
 "decidedAt" timestamptz(3),
 "decisionReason" varchar(1000) CHECK("decisionReason" IS NULL OR length(btrim("decisionReason"))>0),
 "adjustmentId" uuid,
 "redactedAt" timestamptz(3),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "CompanyBudgetChangeRequest_decision_shape" CHECK(num_nonnulls("deciderActorId","decidedAt") IN (0,2) AND (state IN ('APPROVED','REJECTED'))=("decidedAt" IS NOT NULL) AND (state='APPROVED')=("adjustmentId" IS NOT NULL) AND (state<>'REJECTED' OR "decisionReason" IS NOT NULL OR "redactedAt" IS NOT NULL)),
 CONSTRAINT "CompanyBudgetChangeRequest_company" FOREIGN KEY("spaceId") REFERENCES "Company"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyBudgetChangeRequest_context" FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyBudgetChangeRequest_budget" FOREIGN KEY("spaceId","scopeId","budgetId") REFERENCES "CompanyBudget"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyBudgetChangeRequest_requesterMember" FOREIGN KEY("spaceId","scopeId","requesterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyBudgetChangeRequest_requesterInterval" FOREIGN KEY("requesterAccessId","requesterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyBudgetChangeRequest_requesterActor" FOREIGN KEY("spaceId","requesterActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyBudgetChangeRequest_decider" FOREIGN KEY("spaceId","deciderActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyBudgetChangeRequest_adjustment" FOREIGN KEY("spaceId","scopeId","adjustmentId") REFERENCES "CompanyBudgetAdjustment"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","scopeId",id)
);
CREATE UNIQUE INDEX "CompanyBudgetChangeRequest_open" ON "CompanyBudgetChangeRequest"("spaceId","budgetId") WHERE state='PENDING';
CREATE INDEX "CompanyBudgetChangeRequest_page" ON "CompanyBudgetChangeRequest"("spaceId","scopeId",id);
COMMIT;
