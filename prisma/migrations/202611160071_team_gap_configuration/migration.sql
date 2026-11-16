BEGIN;
ALTER TABLE "TeamProjectReference" ADD COLUMN "associationRequest" jsonb;
ALTER TABLE "SharedAuditEvent" ADD COLUMN "details" jsonb;
-- Add explicit configuration only. Existing values and history remain unchanged.
ALTER TABLE "TeamMemberProfile" ADD COLUMN "capacityTemplate" jsonb;
ALTER TABLE "TeamMemberProfile" ADD COLUMN "capacityRevision" integer NOT NULL DEFAULT 1 CHECK ("capacityRevision">0);
ALTER TABLE "TeamPlan" ADD COLUMN "capacityPoints" integer CHECK ("capacityPoints" IS NULL OR ("capacityPoints" BETWEEN 0 AND 1000000 AND kind='SPRINT'));
ALTER TABLE "TeamPlan" ADD COLUMN "sprintBaseline" jsonb;
ALTER TABLE "TeamPlan" ADD COLUMN "sprintClosedEvidence" jsonb;
ALTER TABLE "TeamMeetingInvitation" ADD COLUMN "recurrenceKey" varchar(19);
ALTER TABLE "TeamMeetingInvitation" DROP CONSTRAINT "TeamMeetingInvitation_state_check";
ALTER TABLE "TeamMeetingInvitation" ADD CONSTRAINT "TeamMeetingInvitation_state_check" CHECK (state IN ('PENDING','ACCEPTED','DECLINED','MAYBE','REVOKED'));
ALTER TABLE "TeamTimeOffEvent" DROP CONSTRAINT "TeamTimeOffEvent_action_check";
ALTER TABLE "TeamTimeOffEvent" ADD CONSTRAINT "TeamTimeOffEvent_action_check" CHECK (action IN ('SUBMITTED','APPROVED','REJECTED','CANCELED','EDITED'));
CREATE OR REPLACE FUNCTION team_interaction_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path FROM CURRENT
AS $function$
DECLARE mutable text[];
BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)->'scopeId') IS DISTINCT FROM (to_jsonb(OLD)->'scopeId') OR (to_jsonb(NEW)->'sourceScopeId') IS DISTINCT FROM (to_jsonb(OLD)->'sourceScopeId')) THEN RAISE EXCEPTION 'Immutable source scope identity' USING ERRCODE='23514'; END IF;

 IF TG_TABLE_NAME IN ('TeamCaseEntry','TeamDisclosureRecipient') THEN RAISE EXCEPTION 'Immutable Team history' USING ERRCODE='23514'; END IF;
 mutable:=CASE TG_TABLE_NAME WHEN 'TeamCase' THEN ARRAY['revision','state'] WHEN 'TeamMeeting' THEN ARRAY['revision','agenda'] WHEN 'TeamDisclosure' THEN ARRAY['revision','state','reviewNote','reviewedAt','subjectConsentedAt'] ELSE ARRAY['revision','state'] END;
 IF (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Team record or invalid revision' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='TeamDisclosure' THEN
  IF (OLD.state IN ('REJECTED','REVOKED') AND NEW.state<>'REVOKED') OR (OLD.state='APPROVED' AND NEW.state NOT IN ('APPROVED','REVOKED')) THEN RAISE EXCEPTION 'Terminal disclosure decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='TeamMeetingInvitation' THEN
  IF OLD.state='REVOKED' OR NEW.state NOT IN ('ACCEPTED','DECLINED','MAYBE','REVOKED') THEN RAISE EXCEPTION 'Terminal invitation decision' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END; $function$;

ALTER TABLE "TeamTaskAssignment" DROP CONSTRAINT "TeamTaskAssignment_endReason_check";
ALTER TABLE "TeamTaskAssignment" ADD CONSTRAINT "TeamTaskAssignment_endReason_check" CHECK ("endReason" IN ('REMOVED','REASSIGNED','WITHDRAWN'));
ALTER TABLE "TeamTaskAssignmentEvent" DROP CONSTRAINT "TeamTaskAssignmentEvent_action_check";
ALTER TABLE "TeamTaskAssignmentEvent" ADD CONSTRAINT "TeamTaskAssignmentEvent_action_check" CHECK (action IN ('ASSIGNED','ACCEPTED','DECLINED','REMOVED','REASSIGNED','REMINDED','REVERTED'));
ALTER TABLE "TeamMemberProfile" ADD CONSTRAINT "TeamMemberProfile_capacity_shape" CHECK ("capacityTemplate" IS NULL OR (jsonb_typeof("capacityTemplate")='object' AND jsonb_typeof("capacityTemplate"->'weekdays')='array' AND jsonb_array_length("capacityTemplate"->'weekdays')=7));
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_evidence_kind" CHECK (("sprintBaseline" IS NULL AND "sprintClosedEvidence" IS NULL) OR kind='SPRINT');
COMMIT;
