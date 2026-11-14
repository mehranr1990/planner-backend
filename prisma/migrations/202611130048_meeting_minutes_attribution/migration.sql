BEGIN;
ALTER TABLE "MeetingDecision" ADD COLUMN "proposedByMemberId" uuid, ADD COLUMN "proposedByGeneration" integer;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_proposer_pair" CHECK (("proposedByMemberId" IS NULL) = ("proposedByGeneration" IS NULL));
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_proposedByMemberId_fk" FOREIGN KEY ("meetingId","proposedByMemberId","proposedByGeneration") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "MeetingAction" ADD COLUMN "assigneeMemberId" uuid, ADD COLUMN "assigneeGeneration" integer, ADD COLUMN "dueDate" date;
ALTER TABLE "MeetingAction" ADD CONSTRAINT "MeetingAction_assignee_pair" CHECK (("assigneeMemberId" IS NULL) = ("assigneeGeneration" IS NULL));
ALTER TABLE "MeetingAction" ADD CONSTRAINT "MeetingAction_assigneeMemberId_fk" FOREIGN KEY ("meetingId","assigneeMemberId","assigneeGeneration") REFERENCES "MeetingAdmission" ("meetingId","memberId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
COMMIT;
