BEGIN;
ALTER TABLE "TaskAssignment" ADD COLUMN "remindedAt" TIMESTAMPTZ(3);
ALTER TABLE "SharedAssignmentNotification" DROP CONSTRAINT "SharedAssignmentNotification_kind_check";
ALTER TABLE "SharedAssignmentNotification" ADD CONSTRAINT "SharedAssignmentNotification_kind_check" CHECK (kind IN ('ASSIGNED','ACCEPTED','DECLINED','REVOKED','REASSIGNED','WITHDRAWN','REMINDER'));
COMMIT;
