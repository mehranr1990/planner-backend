BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "MeetingAgendaEntry" ADD COLUMN "plannedMinutes" integer CHECK("plannedMinutes">0), ADD COLUMN "completedAt" timestamptz(3), ADD COLUMN notes text NOT NULL DEFAULT '' CHECK(length(notes)<=10000);
CREATE TABLE "MeetingAgendaRevision" (
 id uuid PRIMARY KEY,"meetingId" uuid NOT NULL,"entryId" uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 "plannedMinutes" integer CHECK("plannedMinutes">0),"completedAt" timestamptz(3),notes text NOT NULL CHECK(length(notes)<=10000),
 "actorMemberId" uuid NOT NULL,"actorGeneration" integer NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("entryId",revision),
 CONSTRAINT "MeetingAgendaRevision_entry_fk" FOREIGN KEY("meetingId","entryId") REFERENCES "MeetingAgendaEntry"("meetingId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "MeetingAgendaRevision_actor_fk" FOREIGN KEY("meetingId","actorMemberId","actorGeneration") REFERENCES "MeetingAdmission"("meetingId","memberId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "MeetingAgendaRevision_meetingId_entryId_id_idx" ON "MeetingAgendaRevision"("meetingId","entryId",id);
CREATE TABLE "AnnouncementSchedule" (
 "versionId" uuid PRIMARY KEY,"scheduledAt" timestamptz(3) NOT NULL,timezone varchar(100) NOT NULL,audience jsonb NOT NULL CHECK(audience->>'audience' IN ('ALL','NAMED')),
 status varchar(10) NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','CANCELED','PUBLISHED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"versionRevision" integer NOT NULL CHECK("versionRevision">0),
 "accessId" uuid NOT NULL,generation integer NOT NULL,"restoreGeneration" integer NOT NULL,"publishedAt" timestamptz(3),
 CHECK((status='PUBLISHED')=("publishedAt" IS NOT NULL)),
 CONSTRAINT "AnnouncementSchedule_version_fk" FOREIGN KEY("versionId") REFERENCES "AnnouncementVersion"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "AnnouncementSchedule_issuer_fk" FOREIGN KEY("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "AnnouncementSchedule_status_scheduledAt_versionId_idx" ON "AnnouncementSchedule"(status,"scheduledAt","versionId");
CREATE FUNCTION meeting_agenda_revision_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE m "Meeting";
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT * INTO m FROM "Meeting" WHERE id=OLD."meetingId";
  IF shared_purge_allowed(m."spaceId") OR shared_domain_purge_allowed(m."spaceId",m."scopeId") THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'Immutable agenda revision' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "MeetingAgendaRevision_immutable" BEFORE UPDATE OR DELETE ON "MeetingAgendaRevision" FOR EACH ROW EXECUTE FUNCTION meeting_agenda_revision_immutable();
COMMIT;
