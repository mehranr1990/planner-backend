BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "SharedCustody" DROP CONSTRAINT "SharedCustody_kind_check";
ALTER TABLE "SharedCustody" ADD CONSTRAINT "SharedCustody_kind_check" CHECK(kind IN ('PROJECT','TEAM','COMPANY','CONVERSATION','MEETING','SOCIAL_GROUP'));
CREATE TABLE "SocialPrivacy" (
 "spaceId" uuid PRIMARY KEY,"ownerUserId" uuid NOT NULL UNIQUE,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 discoverable boolean NOT NULL DEFAULT false,"allowFriendRequests" boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"updatedAt" timestamptz(3) NOT NULL,
 UNIQUE("spaceId","ownerUserId"),FOREIGN KEY("spaceId","ownerUserId") REFERENCES "Space"(id,"ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE TABLE "SocialConnection" (
 id uuid PRIMARY KEY,"requesterUserId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 "recipientUserId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 state varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','DECLINED','CANCELED','REMOVED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT now(),"updatedAt" timestamptz(3) NOT NULL,
 CHECK("requesterUserId"<>"recipientUserId")
);
CREATE UNIQUE INDEX "SocialConnection_live_pair" ON "SocialConnection"(LEAST("requesterUserId","recipientUserId"),GREATEST("requesterUserId","recipientUserId")) WHERE state IN ('PENDING','ACCEPTED');
CREATE INDEX "SocialConnection_requesterUserId_state_id_idx" ON "SocialConnection"("requesterUserId",state,id);
CREATE INDEX "SocialConnection_recipientUserId_state_id_idx" ON "SocialConnection"("recipientUserId",state,id);
CREATE TABLE "SocialCircle" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL,"ownerUserId" uuid NOT NULL,name varchar(100) NOT NULL CHECK(length(btrim(name))>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT now(),"updatedAt" timestamptz(3) NOT NULL,
 UNIQUE("spaceId",id),FOREIGN KEY("spaceId","ownerUserId") REFERENCES "Space"(id,"ownerUserId") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "SocialCircle_private_name" ON "SocialCircle"("spaceId",lower(name));
CREATE INDEX "SocialCircle_spaceId_id_idx" ON "SocialCircle"("spaceId",id);
CREATE TABLE "SocialCircleMember" (
 "spaceId" uuid NOT NULL,"circleId" uuid NOT NULL,"connectionId" uuid NOT NULL,
 PRIMARY KEY("circleId","connectionId"),
 FOREIGN KEY("spaceId","circleId") REFERENCES "SocialCircle"("spaceId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 FOREIGN KEY("connectionId") REFERENCES "SocialConnection"(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE TABLE "SocialGroup" (
 id uuid PRIMARY KEY,"spaceId" uuid NOT NULL UNIQUE REFERENCES "Space"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 "scopeId" uuid NOT NULL UNIQUE,"createdByActorId" uuid NOT NULL,name varchar(200) NOT NULL CHECK(length(btrim(name))>0),
 description varchar(4000),"publicSummary" varchar(500) NOT NULL DEFAULT '',discoverable boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"creationKey" char(64) NOT NULL,"creationFingerprint" char(64) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(),"updatedAt" timestamptz(3) NOT NULL,
 UNIQUE("spaceId","scopeId"),CHECK(id="spaceId" AND id="scopeId"),
 FOREIGN KEY("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "SocialGroup_discoverable_id_idx" ON "SocialGroup"(discoverable,id);
CREATE TABLE "SocialJoinRequest" (
 id uuid PRIMARY KEY,"groupId" uuid NOT NULL REFERENCES "SocialGroup"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 "requesterUserId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 "baseGeneration" integer,"baseRevision" integer,
 state varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED','CANCELED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),"createdAt" timestamptz(3) NOT NULL DEFAULT now(),"updatedAt" timestamptz(3) NOT NULL,
 CHECK(("baseGeneration" IS NULL)=("baseRevision" IS NULL) AND ("baseGeneration" IS NULL OR ("baseGeneration">0 AND "baseRevision">0)))
);
CREATE UNIQUE INDEX "SocialJoinRequest_pending_pair" ON "SocialJoinRequest"("groupId","requesterUserId") WHERE state='PENDING';
CREATE INDEX "SocialJoinRequest_groupId_state_id_idx" ON "SocialJoinRequest"("groupId",state,id);
CREATE INDEX "SocialJoinRequest_requesterUserId_id_idx" ON "SocialJoinRequest"("requesterUserId",id);

CREATE FUNCTION social_circle_member_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "SocialCircle" c JOIN "SocialConnection" f ON f.id=NEW."connectionId" WHERE c.id=NEW."circleId" AND c."spaceId"=NEW."spaceId" AND f.state='ACCEPTED' AND c."ownerUserId" IN(f."requesterUserId",f."recipientUserId")) THEN RAISE EXCEPTION 'Circle requires its owner current friend' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "SocialCircleMember_friend" BEFORE INSERT OR UPDATE ON "SocialCircleMember" FOR EACH ROW EXECUTE FUNCTION social_circle_member_guard();
CREATE FUNCTION social_connection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."requesterUserId"<>OLD."requesterUserId" OR NEW."recipientUserId"<>OLD."recipientUserId" OR NEW."createdAt"<>OLD."createdAt") THEN RAISE EXCEPTION 'Immutable friend request identity' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND NEW.state<>OLD.state AND NOT ((OLD.state='PENDING' AND NEW.state IN ('ACCEPTED','DECLINED','CANCELED')) OR (OLD.state='ACCEPTED' AND NEW.state='REMOVED')) THEN RAISE EXCEPTION 'Invalid friendship transition' USING ERRCODE='23514';END IF;
 IF NEW.state IN ('PENDING','ACCEPTED') AND EXISTS(SELECT 1 FROM "DmContactBlock" b WHERE b.active AND ((b."ownerUserId"=NEW."requesterUserId" AND b."targetUserId"=NEW."recipientUserId") OR (b."ownerUserId"=NEW."recipientUserId" AND b."targetUserId"=NEW."requesterUserId"))) THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='23514';END IF;
 IF NEW.state<>'ACCEPTED' THEN DELETE FROM "SocialCircleMember" WHERE "connectionId"=NEW.id;END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "SocialConnection_state" BEFORE INSERT OR UPDATE ON "SocialConnection" FOR EACH ROW EXECUTE FUNCTION social_connection_guard();
-- Social owns this atomic consequence of the existing Messaging block owner.
-- Applies equally to DM API blocks and restrictive restore replay.
CREATE FUNCTION social_block_consequence() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.active THEN UPDATE "SocialConnection" SET state=CASE WHEN state='PENDING' THEN 'CANCELED' ELSE 'REMOVED' END,revision=revision+1,"updatedAt"=clock_timestamp() WHERE state IN ('PENDING','ACCEPTED') AND (("requesterUserId"=NEW."ownerUserId" AND "recipientUserId"=NEW."targetUserId") OR ("requesterUserId"=NEW."targetUserId" AND "recipientUserId"=NEW."ownerUserId"));END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "DmContactBlock_social" AFTER INSERT OR UPDATE ON "DmContactBlock" FOR EACH ROW EXECUTE FUNCTION social_block_consequence();
CREATE FUNCTION social_group_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT shared_purge_allowed(OLD."spaceId") THEN RAISE EXCEPTION 'Policy-claimed Social Group disposal required' USING ERRCODE='23514';END IF;
  RETURN OLD;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId" AND kind='SOCIAL_GROUP') THEN RAISE EXCEPTION 'Typed Social Group custody required' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."spaceId"<>OLD."spaceId" OR NEW."scopeId"<>OLD."scopeId" OR NEW."createdByActorId"<>OLD."createdByActorId" OR NEW."creationKey"<>OLD."creationKey" OR NEW."creationFingerprint"<>OLD."creationFingerprint") THEN RAISE EXCEPTION 'Immutable Group identity' USING ERRCODE='23514';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "SocialGroup_shape" BEFORE INSERT OR UPDATE OR DELETE ON "SocialGroup" FOR EACH ROW EXECUTE FUNCTION social_group_shape();
CREATE OR REPLACE FUNCTION shared_context_role_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE context_kind text; scope_kind text;
BEGIN
 SELECT kind INTO context_kind FROM "SharedCustody" WHERE "spaceId"=NEW."spaceId";
 SELECT kind INTO scope_kind FROM "AccessScope" WHERE id=NEW."scopeId" AND "spaceId"=NEW."spaceId";
 IF scope_kind IN ('PROJECT','TEAM') THEN context_kind:=scope_kind; END IF;
 IF NEW."memberRole" IS NOT NULL AND ((context_kind='PROJECT' AND NEW."memberRole" NOT IN ('ADMIN','MANAGER','MEMBER','VIEWER')) OR (context_kind='TEAM' AND NEW."memberRole" NOT IN ('ADMIN','LEAD','MEMBER','VIEWER')) OR (context_kind='COMPANY' AND NEW."memberRole" NOT IN ('ORG_ADMIN','DEPT_MANAGER','TEAM_LEAD','MEMBER','VIEWER')) OR (context_kind='SOCIAL_GROUP' AND NEW."memberRole" NOT IN ('ADMIN','MEMBER'))) THEN RAISE EXCEPTION 'Role belongs to another context catalog' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION shared_purge_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM "SharedCustody" c JOIN "SharedLifecycleJob" j ON j."spaceId"=c."spaceId" AND j.generation=c."closureGeneration"
 WHERE c."spaceId"=target AND j."scopeId" IS NULL AND j."custodyId"=c."spaceId" AND c.kind IN ('PROJECT','TEAM','COMPANY','CONVERSATION','MEETING','SOCIAL_GROUP') AND c.state='PURGING' AND j.state='PURGING'
 AND j."recoveryDeadline"<=clock_timestamp() AND j."leaseUntil">clock_timestamp() AND j.progress->>'leaseId' ~ '^[0-9a-f-]{36}$'
 AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL'
 WHERE a."spaceId"=target AND (c.kind<>'COMPANY' OR a."scopeId"=target) AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL
 AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND e."closedAt">=a."joinedAt")))
$$;
CREATE FUNCTION social_group_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target uuid; context_kind text; present boolean;
BEGIN
 target:=COALESCE(NEW."spaceId",OLD."spaceId");
 SELECT kind INTO context_kind FROM "SharedCustody" WHERE "spaceId"=target;
 SELECT EXISTS(SELECT 1 FROM "SocialGroup" WHERE "spaceId"=target) INTO present;
 IF present AND context_kind IS DISTINCT FROM 'SOCIAL_GROUP' THEN RAISE EXCEPTION 'Exclusive typed Social Group custody required' USING ERRCODE='23514';END IF;
 IF context_kind='SOCIAL_GROUP' AND NOT present AND NOT shared_purge_allowed(target) AND NOT EXISTS(
  SELECT 1 FROM "SharedCustody" c JOIN "SharedLifecycleJob" j ON j."spaceId"=c."spaceId" AND j."custodyId"=c."spaceId" AND j.generation=c."closureGeneration" AND j."retentionPolicyVersion"=c."retentionPolicyVersion"
  WHERE c."spaceId"=target AND c.state='PURGING' AND j.state='PURGING' AND j."scopeId" IS NULL AND j."recoveryDeadline"<=clock_timestamp() AND j.progress->>'stage' IN ('ROOT','CORE')
  AND NOT EXISTS(SELECT 1 FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "Space" p ON p."ownerUserId"=u."userId" AND p.kind='PERSONAL' WHERE a."spaceId"=target AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u."userId" AND e."closedAt">=a."joinedAt"))
 ) THEN RAISE EXCEPTION 'Exclusive typed Social Group custody required' USING ERRCODE='23514';END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "SocialGroup_custody_binding" AFTER INSERT OR UPDATE OR DELETE ON "SocialGroup" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION social_group_binding_guard();
CREATE CONSTRAINT TRIGGER "SharedCustody_social_binding" AFTER INSERT OR UPDATE ON "SharedCustody" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION social_group_binding_guard();
ALTER TABLE "SharedUsageEntry" DROP CONSTRAINT "SharedUsageEntry_feature_check";
ALTER TABLE "SharedUsageEntry" ADD CONSTRAINT "SharedUsageEntry_feature_check" CHECK(feature IN ('social.group','social.join-request','messaging.conversation','messaging.participant','messaging.message','company.association','company.knowledge-folder','company.knowledge-document','company.knowledge-version','shared.custody','shared.membership','task.shared','goal.shared','shared.resource-grant','task.assignment','task.field-version','task.dependency','task.reschedule-preview','task.workflow-version','project.risk-issue','project.template-version','project.change-plan','task.shared-work-log','project.capacity-day','project.work-allocation','project.report-snapshot','project.document-version','project.comment-version','file.shared','team.project-reference','team.plan','team.work-item','calendar.shared-event','team.capacity-day','team.case','team.case-entry','team.disclosure','team.meeting','team.meeting-invitation','company.department','company.unit','company.policy-version','company.context-membership','company.financial-workflow','company.financial-workflow-version','company.financial-approval','company.reimbursement-request','company.payment-acknowledgement','company.acknowledgement-correction','company.expense','company.budget','company.commitment','company.finance-category','company.finance-reference','company.expense-version','company.staff-profile','company.availability-day','company.resource','company.allocation','company.employee-case','company.case-entry','meeting.resource','meeting.participant','meeting.invitation','meeting.agenda-entry','meeting.version','announcement.resource','announcement.version'));
COMMIT;
