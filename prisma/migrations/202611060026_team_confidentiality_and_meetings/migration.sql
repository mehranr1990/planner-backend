BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "AccessScope" ADD COLUMN "restoreGeneration" integer NOT NULL DEFAULT 0 CHECK("restoreGeneration">=0);
CREATE TABLE "TeamCase" (
 "id" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "kind" varchar(12) NOT NULL,
 "authorAccessId" uuid NOT NULL,
 "authorGeneration" integer NOT NULL CHECK("authorGeneration">=0),
 "subjectAccessId" uuid NOT NULL,
 "subjectGeneration" integer NOT NULL CHECK("subjectGeneration">=0),
 "reviewerAccessId" uuid NOT NULL,
 "reviewerGeneration" integer NOT NULL CHECK("reviewerGeneration">=0),
 "reason" varchar(10000) NOT NULL,
 "evidence" varchar(10000) NOT NULL,
 "state" varchar(12) NOT NULL DEFAULT 'OPEN',
 "revision" integer NOT NULL DEFAULT 1 CHECK("revision">=0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(id),
 CHECK("scopeId"="spaceId"),
 CHECK(kind IN ('RECOGNITION','FEEDBACK','CORRECTIVE')),
 CHECK(state IN ('OPEN','RESOLVED')),
 CHECK(revision>0 AND "authorGeneration">0 AND "subjectGeneration">0 AND "reviewerGeneration">0),
 CHECK("authorAccessId"<>"subjectAccessId" AND "reviewerAccessId"<>"authorAccessId" AND "reviewerAccessId"<>"subjectAccessId"),
 CHECK(length(btrim(reason))>0 AND length(btrim(evidence))>0)
);
CREATE UNIQUE INDEX "TeamCase_spaceId_id_key" ON "TeamCase"("spaceId","id");
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_Team" FOREIGN KEY("spaceId") REFERENCES "Team"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_authorMember" FOREIGN KEY("spaceId","scopeId","authorAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_authorInterval" FOREIGN KEY("authorAccessId","authorGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_subjectMember" FOREIGN KEY("spaceId","scopeId","subjectAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_subjectInterval" FOREIGN KEY("subjectAccessId","subjectGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_reviewerMember" FOREIGN KEY("spaceId","scopeId","reviewerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCase" ADD CONSTRAINT "TeamCase_reviewerInterval" FOREIGN KEY("reviewerAccessId","reviewerGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE TABLE "TeamCaseEntry" (
 "id" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "caseId" uuid NOT NULL,
 "kind" varchar(12) NOT NULL,
 "body" varchar(10000) NOT NULL,
 "createdByActorId" uuid NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(id),
 CHECK(kind IN ('RESPONSE','APPEAL','REVIEW')),
 CHECK(length(btrim(body))>0)
);
ALTER TABLE "TeamCaseEntry" ADD CONSTRAINT "TeamCaseEntry_Case" FOREIGN KEY("spaceId","caseId") REFERENCES "TeamCase"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamCaseEntry" ADD CONSTRAINT "TeamCaseEntry_Actor" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE TABLE "TeamDisclosure" (
 "id" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "caseId" uuid NOT NULL,
 "sourceRevision" integer NOT NULL CHECK("sourceRevision">=0),
 "audience" varchar(8) NOT NULL,
 "summary" varchar(2000) NOT NULL,
 "expiresAt" timestamptz(3) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "state" varchar(12) NOT NULL DEFAULT 'PENDING',
 "revision" integer NOT NULL DEFAULT 1 CHECK("revision">=0),
 "restoreGeneration" integer NOT NULL CHECK("restoreGeneration">=0),
 "reviewNote" varchar(10000),
 "reviewedAt" timestamptz(3),
 "subjectConsentedAt" timestamptz(3),
 PRIMARY KEY(id),
 CHECK("sourceRevision">0 AND revision>0),
 CHECK(audience IN ('TEAM','NAMED')),
 CHECK(state IN ('PENDING','APPROVED','REJECTED','REVOKED')),
 CHECK(length(btrim(summary))>0),
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '30 days'),
 CHECK(state NOT IN ('APPROVED','REJECTED') OR ("reviewedAt" IS NOT NULL AND length(btrim("reviewNote"))>0))
);
CREATE UNIQUE INDEX "TeamDisclosure_spaceId_id_key" ON "TeamDisclosure"("spaceId","id");
ALTER TABLE "TeamDisclosure" ADD CONSTRAINT "TeamDisclosure_Case" FOREIGN KEY("spaceId","caseId") REFERENCES "TeamCase"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE TABLE "TeamDisclosureRecipient" (
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "disclosureId" uuid NOT NULL,
 "accessId" uuid NOT NULL,
 "generation" integer NOT NULL CHECK("generation">=0),
 PRIMARY KEY("spaceId","disclosureId","accessId"),
 CHECK("spaceId"="scopeId" AND generation>0)
);
ALTER TABLE "TeamDisclosureRecipient" ADD CONSTRAINT "TeamDisclosureRecipient_Disclosure" FOREIGN KEY("spaceId","disclosureId") REFERENCES "TeamDisclosure"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamDisclosureRecipient" ADD CONSTRAINT "TeamDisclosureRecipient_Member" FOREIGN KEY("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamDisclosureRecipient" ADD CONSTRAINT "TeamDisclosureRecipient_Interval" FOREIGN KEY("accessId","generation") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE TABLE "TeamMeeting" (
 "id" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "eventId" uuid NOT NULL,
 "agenda" varchar(10000) NOT NULL,
 "revision" integer NOT NULL DEFAULT 1 CHECK("revision">=0),
 "createdByActorId" uuid NOT NULL,
 PRIMARY KEY(id),
 CHECK(revision>0)
);
CREATE UNIQUE INDEX "TeamMeeting_spaceId_id_key" ON "TeamMeeting"("spaceId","id");
CREATE UNIQUE INDEX "TeamMeeting_spaceId_eventId_key" ON "TeamMeeting"("spaceId","eventId");
ALTER TABLE "TeamMeeting" ADD CONSTRAINT "TeamMeeting_Team" FOREIGN KEY("spaceId") REFERENCES "Team"("spaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeeting" ADD CONSTRAINT "TeamMeeting_Event" FOREIGN KEY("spaceId","eventId") REFERENCES "CalendarEvent"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeeting" ADD CONSTRAINT "TeamMeeting_Actor" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE TABLE "TeamMeetingInvitation" (
 "id" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "meetingId" uuid NOT NULL,
 "inviterAccessId" uuid NOT NULL,
 "inviterGeneration" integer NOT NULL CHECK("inviterGeneration">=0),
 "recipientAccessId" uuid NOT NULL,
 "recipientGeneration" integer NOT NULL CHECK("recipientGeneration">=0),
 "expiresAt" timestamptz(3) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "state" varchar(12) NOT NULL DEFAULT 'PENDING',
 "revision" integer NOT NULL DEFAULT 1 CHECK("revision">=0),
 "restoreGeneration" integer NOT NULL CHECK("restoreGeneration">=0),
 PRIMARY KEY(id),
 CHECK("spaceId"="scopeId" AND revision>0 AND "inviterGeneration">0 AND "recipientGeneration">0),
 CHECK(state IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '7 days')
);
ALTER TABLE "TeamMeetingInvitation" ADD CONSTRAINT "TeamMeetingInvitation_Meeting" FOREIGN KEY("spaceId","meetingId") REFERENCES "TeamMeeting"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeetingInvitation" ADD CONSTRAINT "TeamMeetingInvitation_inviterMember" FOREIGN KEY("spaceId","scopeId","inviterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeetingInvitation" ADD CONSTRAINT "TeamMeetingInvitation_inviterInterval" FOREIGN KEY("inviterAccessId","inviterGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeetingInvitation" ADD CONSTRAINT "TeamMeetingInvitation_recipientMember" FOREIGN KEY("spaceId","scopeId","recipientAccessId") REFERENCES "ContextAccess"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "TeamMeetingInvitation" ADD CONSTRAINT "TeamMeetingInvitation_recipientInterval" FOREIGN KEY("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE FUNCTION team_interaction_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE mutable text[];
BEGIN
 IF TG_TABLE_NAME IN ('TeamCaseEntry','TeamDisclosureRecipient') THEN RAISE EXCEPTION 'Immutable Team history' USING ERRCODE='23514'; END IF;
 mutable:=CASE TG_TABLE_NAME WHEN 'TeamCase' THEN ARRAY['revision','state'] WHEN 'TeamMeeting' THEN ARRAY['revision','agenda'] WHEN 'TeamDisclosure' THEN ARRAY['revision','state','reviewNote','reviewedAt','subjectConsentedAt'] ELSE ARRAY['revision','state'] END;
 IF (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Immutable Team record or invalid revision' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='TeamDisclosure' THEN
  IF (OLD.state IN ('REJECTED','REVOKED') AND NEW.state<>'REVOKED') OR (OLD.state='APPROVED' AND NEW.state NOT IN ('APPROVED','REVOKED')) THEN RAISE EXCEPTION 'Terminal disclosure decision' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='TeamMeetingInvitation' THEN
  IF OLD.state<>'PENDING' AND NEW.state<>'REVOKED' THEN RAISE EXCEPTION 'Terminal invitation decision' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "TeamCase_immutable" BEFORE UPDATE ON "TeamCase" FOR EACH ROW EXECUTE FUNCTION team_interaction_guard();
CREATE INDEX "TeamCase_page" ON "TeamCase"("spaceId",id);
CREATE TRIGGER "TeamCaseEntry_immutable" BEFORE UPDATE ON "TeamCaseEntry" FOR EACH ROW EXECUTE FUNCTION team_interaction_guard();
CREATE INDEX "TeamCaseEntry_page" ON "TeamCaseEntry"("spaceId",id);
CREATE TRIGGER "TeamDisclosure_immutable" BEFORE UPDATE ON "TeamDisclosure" FOR EACH ROW EXECUTE FUNCTION team_interaction_guard();
CREATE INDEX "TeamDisclosure_page" ON "TeamDisclosure"("spaceId",id);
CREATE TRIGGER "TeamDisclosureRecipient_immutable" BEFORE UPDATE ON "TeamDisclosureRecipient" FOR EACH ROW EXECUTE FUNCTION team_interaction_guard();
CREATE TRIGGER "TeamMeeting_immutable" BEFORE UPDATE ON "TeamMeeting" FOR EACH ROW EXECUTE FUNCTION team_interaction_guard();
CREATE INDEX "TeamMeeting_page" ON "TeamMeeting"("spaceId",id);
CREATE TRIGGER "TeamMeetingInvitation_immutable" BEFORE UPDATE ON "TeamMeetingInvitation" FOR EACH ROW EXECUTE FUNCTION team_interaction_guard();
CREATE INDEX "TeamMeetingInvitation_page" ON "TeamMeetingInvitation"("spaceId",id);
CREATE FUNCTION team_disclosure_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (NEW.audience='TEAM' OR NEW."subjectConsentedAt" IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM "TeamCase" WHERE "spaceId"=NEW."spaceId" AND id=NEW."caseId" AND kind='RECOGNITION') THEN RAISE EXCEPTION 'Recognition-only Team audience/consent' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "TeamDisclosure_shape" BEFORE INSERT OR UPDATE ON "TeamDisclosure" FOR EACH ROW EXECUTE FUNCTION team_disclosure_shape();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation'));
COMMIT;
