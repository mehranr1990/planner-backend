-- M044 / approved ADR 0049: private contact controls and guarded communication disposal.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE "DmContactState"("spaceId" uuid PRIMARY KEY,"ownerUserId" uuid NOT NULL UNIQUE,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),"updatedAt" timestamptz(3) NOT NULL,UNIQUE("spaceId","ownerUserId"));
CREATE TABLE "DmContactBlock"(id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"ownerUserId" uuid NOT NULL,"targetUserId" uuid NOT NULL,"sourceConversationId" uuid,active boolean NOT NULL,"restrictedAt" timestamptz(3),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),"updatedAt" timestamptz(3) NOT NULL,UNIQUE("spaceId","targetUserId"),CHECK("ownerUserId"<>"targetUserId"));
ALTER TABLE "MessageProgress" ADD COLUMN "receiptConsentAt" timestamptz(3);
CREATE TABLE "DmContactMutation"(id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"ownerUserId" uuid NOT NULL,"blockId" uuid,"keyHash" char(64) NOT NULL,fingerprint char(64) NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),UNIQUE("spaceId","keyHash"));
ALTER TABLE "DmContactState" ADD CONSTRAINT "DmContactState_owner_fk" FOREIGN KEY("spaceId","ownerUserId") REFERENCES "Space"(id,"ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "DmContactBlock" ADD CONSTRAINT "DmContactBlock_owner_fk" FOREIGN KEY("spaceId","ownerUserId") REFERENCES "DmContactState"("spaceId","ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "DmContactBlock" ADD CONSTRAINT "DmContactBlock_target_fk" FOREIGN KEY("targetUserId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "DmContactBlock" ADD CONSTRAINT "DmContactBlock_source_fk" FOREIGN KEY("sourceConversationId") REFERENCES "Conversation"(id) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "DmContactMutation" ADD CONSTRAINT "DmContactMutation_owner_fk" FOREIGN KEY("spaceId","ownerUserId") REFERENCES "DmContactState"("spaceId","ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "DmContactMutation" ADD CONSTRAINT "DmContactMutation_block_fk" FOREIGN KEY("blockId") REFERENCES "DmContactBlock"(id) ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX "DmContactBlock_targetUserId_active_idx" ON "DmContactBlock"("targetUserId",active);
-- Extend the existing actual lease/generation/zero-member guard to the two
-- newly approved independent custody kinds. All earlier predicates remain.
CREATE OR REPLACE FUNCTION shared_purge_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "SharedLifecycleJob" j ON j."spaceId"=c."spaceId" AND j.generation=c."closureGeneration"
 WHERE c."spaceId"=target AND j."scopeId" IS NULL AND j."custodyId"=c."spaceId" AND c.kind IN ('PROJECT','TEAM','COMPANY','CONVERSATION','MEETING') AND c.state='PURGING' AND j.state='PURGING'
 AND j."recoveryDeadline"<=clock_timestamp() AND j."leaseUntil">clock_timestamp() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$'
 AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL'
 WHERE a."spaceId"=target AND (c.kind<>'COMPANY' OR a."scopeId"=target) AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL
 AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND e."closedAt">=a."joinedAt")))
$$;
-- SQL immutability exceptions require the real, zero-member, policy-claimed custody.
-- A caller-set session flag is deliberately insufficient.
CREATE FUNCTION communication_cleanup_allowed(boundary uuid,scope uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT (shared_purge_allowed(boundary) OR shared_domain_purge_allowed(boundary,scope)) AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a WHERE a."spaceId"=boundary AND (scope=boundary OR a."scopeId"=scope) AND a.state='ACTIVE' AND a."memberRole" IS NOT NULL)
$$;
CREATE OR REPLACE FUNCTION message_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
 DECLARE resource jsonb; boundary record;
 BEGIN
 resource:=to_jsonb(OLD);
 IF resource ? 'conversationId' THEN SELECT "spaceId","scopeId" INTO boundary FROM "Conversation" WHERE id=(resource->>'conversationId')::uuid;
 ELSE SELECT c."spaceId",c."scopeId" INTO boundary FROM "MessageEntry" e JOIN "Conversation" c ON c.id=e."conversationId" WHERE e.id=(resource->>'messageId')::uuid; END IF;
 IF TG_OP='DELETE' AND communication_cleanup_allowed(boundary."spaceId",boundary."scopeId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Immutable message history' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION meeting_content_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
 DECLARE resource jsonb; boundary record;
 BEGIN
 resource:=to_jsonb(OLD);
 IF resource ? 'meetingId' THEN SELECT "spaceId","scopeId" INTO boundary FROM "Meeting" WHERE id=(resource->>'meetingId')::uuid;
 ELSIF resource ? 'announcementId' THEN SELECT "spaceId","scopeId" INTO boundary FROM "Announcement" WHERE id=(resource->>'announcementId')::uuid;
 ELSIF TG_TABLE_NAME='AnnouncementTarget' THEN SELECT a."spaceId",a."scopeId" INTO boundary FROM "AnnouncementVersion" v JOIN "Announcement" a ON a.id=v."announcementId" WHERE v.id=(resource->>'versionId')::uuid;
 ELSE RAISE EXCEPTION 'Unknown communication content owner' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' AND communication_cleanup_allowed(boundary."spaceId",boundary."scopeId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Immutable meeting/publication content' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION meeting_version_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
 DECLARE boundary record;
 BEGIN
 SELECT "spaceId","scopeId" INTO boundary FROM "Meeting" WHERE id=OLD."meetingId";
 IF communication_cleanup_allowed(boundary."spaceId",boundary."scopeId") THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.state='DRAFT' AND NEW."approvedReviewId" IS NULL AND NEW."finalizedAt" IS NULL AND NEW."selfFinalized"=false AND (to_jsonb(NEW)-ARRAY['state','approvedReviewId','finalizedAt','selfFinalized']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','approvedReviewId','finalizedAt','selfFinalized']) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Only cleanup approval-cycle reset is allowed' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' OR (NEW.id,NEW."meetingId",NEW.number,NEW."parentId",NEW."authorMemberId",NEW."authorGeneration",NEW.minutes,NEW.agenda,NEW."createdAt")
 IS DISTINCT FROM (OLD.id,OLD."meetingId",OLD.number,OLD."parentId",OLD."authorMemberId",OLD."authorGeneration",OLD.minutes,OLD.agenda,OLD."createdAt")
 OR (OLD.state<>'DRAFT' AND (NEW."reviewerMemberId",NEW."reviewerGeneration") IS DISTINCT FROM (OLD."reviewerMemberId",OLD."reviewerGeneration"))
 OR (OLD.state='FINAL' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Immutable meeting version' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION announcement_version_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
 DECLARE boundary record;
 BEGIN
 SELECT "spaceId","scopeId" INTO boundary FROM "Announcement" WHERE id=OLD."announcementId";
 IF TG_OP='DELETE' AND communication_cleanup_allowed(boundary."spaceId",boundary."scopeId") THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' OR (NEW.id,NEW."announcementId",NEW.number,NEW.title,NEW.text,NEW.acknowledgement,NEW."publisherActorId",NEW."publisherSpaceId",NEW."createdAt")
 IS DISTINCT FROM (OLD.id,OLD."announcementId",OLD.number,OLD.title,OLD.text,OLD.acknowledgement,OLD."publisherActorId",OLD."publisherSpaceId",OLD."createdAt")
 OR (OLD.state<>'DRAFT' AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt")
 OR (OLD.state='WITHDRAWN' AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Immutable announcement version' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;

COMMIT;
