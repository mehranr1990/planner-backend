-- P2-01: promoted G0 kernel; see docs/p2-01-migration-review.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE "SharedRetentionPolicy" (
  version varchar(80) PRIMARY KEY,
  configuration jsonb NOT NULL,
  "approvalReference" varchar(200) NOT NULL CHECK (length(trim("approvalReference")) > 0),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CHECK (jsonb_typeof(configuration) = 'object' AND configuration @> '{"sharedRecoverySeconds":2592000}'::jsonb)
);
CREATE TABLE "SharedCustody" (
  "spaceId" uuid PRIMARY KEY REFERENCES "Space"(id) ON DELETE NO ACTION,
  kind varchar(20) NOT NULL CHECK (kind = 'PROJECT'),
  state varchar(24) NOT NULL CHECK (state IN ('ACTIVE','ARCHIVED','OWNER_EXIT_FROZEN','CLOSING_GRACE','CLEANUP_PENDING','WAITING_OBLIGATIONS','BLOCKED_POLICY','PURGING','DELETED','FAILED')),
  "primaryOwnerAccessId" uuid,
  "authorizationVersion" bigint NOT NULL DEFAULT 1 CHECK ("authorizationVersion" > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  "retentionPolicyVersion" varchar(80) NOT NULL REFERENCES "SharedRetentionPolicy"(version) ON DELETE RESTRICT,
  "closureGeneration" integer NOT NULL DEFAULT 0 CHECK ("closureGeneration" >= 0),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "AccessScope" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL REFERENCES "SharedCustody"("spaceId") ON DELETE CASCADE,
  kind varchar(10) NOT NULL CHECK (kind = 'ROOT'),
  state varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','ARCHIVED','CLOSED')),
  "authorizationVersion" bigint NOT NULL DEFAULT 1 CHECK ("authorizationVersion" > 0),
  "currentPolicyVersion" integer NOT NULL DEFAULT 1 CHECK ("currentPolicyVersion" > 0),
  UNIQUE ("spaceId",id), CHECK (id = "spaceId")
);
CREATE TABLE "SharedActor" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL REFERENCES "SharedCustody"("spaceId") ON DELETE CASCADE,
  "userId" uuid REFERENCES "User"(id) ON DELETE RESTRICT,
  state varchar(10) NOT NULL CHECK (state IN ('ACTIVE','ERASED')),
  "erasedAt" timestamptz(3),
  UNIQUE ("spaceId",id),
  CHECK ((state = 'ACTIVE' AND "userId" IS NOT NULL AND "erasedAt" IS NULL) OR (state = 'ERASED' AND "userId" IS NULL AND "erasedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "SharedActor_live_user" ON "SharedActor"("spaceId","userId") WHERE "userId" IS NOT NULL;
CREATE INDEX "SharedActor_departure" ON "SharedActor"("userId",id) WHERE "userId" IS NOT NULL;
CREATE TABLE "ContextAccess" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL,
  "scopeId" uuid NOT NULL,
  "actorId" uuid NOT NULL,
  state varchar(12) NOT NULL CHECK (state IN ('ACTIVE','SUSPENDED','LEFT','REVOKED','ERASED')),
  "memberRole" varchar(10) CHECK ("memberRole" IN ('ADMIN','MANAGER','MEMBER','VIEWER')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  "joinedAt" timestamptz(3) NOT NULL,
  "endedAt" timestamptz(3),
  FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE CASCADE,
  FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
  UNIQUE ("spaceId",id), UNIQUE ("spaceId","scopeId","actorId"),
  CHECK ((state IN ('ACTIVE','SUSPENDED') AND "endedAt" IS NULL) OR (state IN ('LEFT','REVOKED','ERASED') AND "endedAt" IS NOT NULL AND "endedAt" >= "joinedAt"))
);
CREATE INDEX "ContextAccess_actor_scope" ON "ContextAccess"("actorId","scopeId",state);
ALTER TABLE "SharedCustody" ADD CONSTRAINT "SharedCustody_primary_access" FOREIGN KEY ("spaceId","primaryOwnerAccessId") REFERENCES "ContextAccess"("spaceId",id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "ContextAccessInterval" (
  "accessId" uuid NOT NULL REFERENCES "ContextAccess"(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  "joinedAt" timestamptz(3) NOT NULL,
  "endedAt" timestamptz(3),
  PRIMARY KEY ("accessId",generation),
  CHECK ("endedAt" IS NULL OR "endedAt" >= "joinedAt")
);
CREATE UNIQUE INDEX "ContextAccessInterval_open" ON "ContextAccessInterval"("accessId") WHERE "endedAt" IS NULL;
CREATE TABLE "ContextCapabilityPolicy" (
  "spaceId" uuid NOT NULL,
  "scopeId" uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  "roleDefaults" jsonb NOT NULL,
  "exportMaxRecords" integer NOT NULL CHECK ("exportMaxRecords" BETWEEN 1 AND 10000),
  "exportMaxBytes" integer NOT NULL CHECK ("exportMaxBytes" BETWEEN 1 AND 10485760),
  "publishedByActorId" uuid NOT NULL,
  "publishedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "auditId" uuid NOT NULL,
  PRIMARY KEY ("spaceId","scopeId",version),
  FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE CASCADE,
  FOREIGN KEY ("spaceId","publishedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
  CHECK (jsonb_typeof("roleDefaults") = 'object')
);
ALTER TABLE "AccessScope" ADD CONSTRAINT "AccessScope_current_policy" FOREIGN KEY ("spaceId",id,"currentPolicyVersion") REFERENCES "ContextCapabilityPolicy"("spaceId","scopeId",version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "SharedMutationReceipt" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL,
  "scopeId" uuid NOT NULL,
  "actorId" uuid NOT NULL,
  operation varchar(80) NOT NULL,
  "keyHash" char(64) NOT NULL CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "resultId" uuid NOT NULL,
  "statusCode" integer NOT NULL CHECK ("statusCode" BETWEEN 200 AND 299),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" timestamptz(3) NOT NULL,
  FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE CASCADE,
  FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
  UNIQUE ("spaceId","scopeId","actorId",operation,"keyHash"),
  CHECK ("expiresAt" = "createdAt" + interval '24 hours')
);
CREATE INDEX "SharedMutationReceipt_expiry" ON "SharedMutationReceipt"("expiresAt",id);
CREATE TABLE "SharedLifecycleJob" (
  id uuid PRIMARY KEY,
  "custodyId" uuid NOT NULL,
  "spaceId" uuid REFERENCES "SharedCustody"("spaceId") ON DELETE SET NULL,
  generation integer NOT NULL CHECK (generation > 0),
  state varchar(24) NOT NULL CHECK (state IN ('OWNER_EXIT_FROZEN','CLOSING_GRACE','CLEANUP_PENDING','WAITING_OBLIGATIONS','BLOCKED_POLICY','PURGING','DELETED','FAILED','CANCELED')),
  "effectiveDepartureAt" timestamptz(3) NOT NULL,
  "recoveryDeadline" timestamptz(3) NOT NULL,
  "retentionPolicyVersion" varchar(80) NOT NULL REFERENCES "SharedRetentionPolicy"(version) ON DELETE RESTRICT,
  "nextAt" timestamptz(3) NOT NULL,
  "leaseUntil" timestamptz(3),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progress) = 'object'),
  "recoveryHash" char(64) CHECK ("recoveryHash" ~ '^[0-9a-f]{64}$'),
  UNIQUE ("custodyId",generation),
  CHECK ("spaceId" IS NULL OR "spaceId" = "custodyId"),
  CHECK ("recoveryDeadline" = "effectiveDepartureAt" + interval '720 hours')
);
CREATE INDEX "SharedLifecycleJob_pending" ON "SharedLifecycleJob"(state,"nextAt",id);
CREATE INDEX "SharedLifecycleJob_lease" ON "SharedLifecycleJob"(state,"leaseUntil",id);
CREATE TABLE "ResourceGrant" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL,
  "scopeId" uuid NOT NULL,
  "granteeAccessId" uuid NOT NULL,
  "granteeGeneration" integer NOT NULL CHECK ("granteeGeneration" > 0),
  "issuerAccessId" uuid NOT NULL,
  "issuerGeneration" integer NOT NULL CHECK ("issuerGeneration" > 0),
  capabilities text[] NOT NULL CHECK (cardinality(capabilities) BETWEEN 1 AND 8 AND capabilities <@ ARRAY['read','comment','update','complete','file.read']::text[]),
  "expiresAt" timestamptz(3) NOT NULL,
  "revokedAt" timestamptz(3),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE ("spaceId",id),
  FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE CASCADE,
  FOREIGN KEY ("spaceId","granteeAccessId") REFERENCES "ContextAccess"("spaceId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","issuerAccessId") REFERENCES "ContextAccess"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "ResourceGrant_grantee_expiry" ON "ResourceGrant"("granteeAccessId","expiresAt",id);
CREATE TABLE "SharedAuditEvent" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL REFERENCES "SharedCustody"("spaceId") ON DELETE NO ACTION,
  "actorId" uuid NOT NULL,
  action varchar(80) NOT NULL,
  "resourceId" uuid,
  "requestId" uuid NOT NULL,
  "occurredAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "SharedAuditEvent_scope_time" ON "SharedAuditEvent"("spaceId","occurredAt",id);

ALTER TABLE "Space" ADD CONSTRAINT "Space_typed_owner" CHECK ((kind = 'PERSONAL' AND "ownerUserId" IS NOT NULL) OR (kind = 'SHARED' AND "ownerUserId" IS NULL));
ALTER TABLE "Space" ALTER COLUMN "ownerUserId" DROP NOT NULL;

CREATE FUNCTION shared_assert_custody(target uuid) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE s record; c record; a record; p record;
BEGIN
  SELECT * INTO s FROM "Space" WHERE id = target;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM "SharedCustody" WHERE "spaceId" = target;
  IF s.kind = 'PERSONAL' THEN
    IF FOUND THEN RAISE EXCEPTION 'Personal space cannot have shared custody' USING ERRCODE = '23514'; END IF;
    RETURN;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shared space requires custody' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "AccessScope" WHERE id = target AND "spaceId" = target) THEN
    RAISE EXCEPTION 'Shared custody requires root scope' USING ERRCODE = '23514';
  END IF;
  IF c.state IN ('ACTIVE','ARCHIVED') THEN
    SELECT ca.*, sa.state AS actor_state, sa."userId" INTO a FROM "ContextAccess" ca JOIN "SharedActor" sa ON (sa."spaceId",sa.id) = (ca."spaceId",ca."actorId")
      WHERE ca.id = c."primaryOwnerAccessId" AND ca."spaceId" = target AND ca."scopeId" = target;
    IF NOT FOUND OR a.state <> 'ACTIVE' OR a."memberRole" IS NULL OR a.actor_state <> 'ACTIVE' OR a."userId" IS NULL THEN
      RAISE EXCEPTION 'Active custody requires eligible full-member custodian' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "SharedLifecycleJob" j WHERE j."spaceId" = target AND j.generation = c."closureGeneration" AND j.state = c.state AND j."retentionPolicyVersion" = c."retentionPolicyVersion") THEN
      RAISE EXCEPTION 'Frozen or closing custody requires matching lifecycle job' USING ERRCODE = '23514';
    END IF;
  END IF;
  FOR a IN SELECT * FROM "ContextAccess" WHERE "spaceId" = target LOOP
    IF NOT EXISTS (SELECT 1 FROM "ContextAccessInterval" i WHERE i."accessId" = a.id AND i.generation = a.generation AND i."joinedAt" = a."joinedAt" AND i."endedAt" IS NOT DISTINCT FROM a."endedAt") THEN
      RAISE EXCEPTION 'Access requires matching current interval' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "ContextAccessInterval" i WHERE i."accessId" = a.id AND i."endedAt" IS NULL AND i.generation <> a.generation) THEN
      RAISE EXCEPTION 'Prior generation cannot remain open' USING ERRCODE = '23514';
    END IF;
    IF a.state IN ('ACTIVE','SUSPENDED') AND EXISTS (SELECT 1 FROM "SharedActor" sa WHERE sa.id = a."actorId" AND sa.state <> 'ACTIVE') THEN
      RAISE EXCEPTION 'Erased actor cannot have current access' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOR p IN SELECT * FROM "AccessScope" WHERE "spaceId" = target LOOP
    IF NOT EXISTS (SELECT 1 FROM "ContextCapabilityPolicy" cp WHERE (cp."spaceId",cp."scopeId",cp.version) = (target,p.id,p."currentPolicyVersion")) THEN
      RAISE EXCEPTION 'Scope requires current policy' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;
CREATE FUNCTION shared_check_custody() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target uuid; old_target uuid;
BEGIN
  IF TG_TABLE_NAME = 'Space' THEN
    IF TG_OP <> 'DELETE' THEN target := NEW.id; END IF;
    IF TG_OP <> 'INSERT' THEN old_target := OLD.id; END IF;
  ELSIF TG_TABLE_NAME = 'ContextAccessInterval' THEN
    IF TG_OP <> 'DELETE' THEN SELECT "spaceId" INTO target FROM "ContextAccess" WHERE id = NEW."accessId"; END IF;
    IF TG_OP <> 'INSERT' THEN SELECT "spaceId" INTO old_target FROM "ContextAccess" WHERE id = OLD."accessId"; END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN target := NEW."spaceId"; END IF;
    IF TG_OP <> 'INSERT' THEN old_target := OLD."spaceId"; END IF;
  END IF;
  IF target IS NOT NULL THEN PERFORM shared_assert_custody(target); END IF;
  IF old_target IS NOT NULL AND old_target IS DISTINCT FROM target THEN PERFORM shared_assert_custody(old_target); END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "Space_custody_commit" AFTER INSERT OR UPDATE OR DELETE ON "Space" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();
CREATE CONSTRAINT TRIGGER "SharedCustody_commit" AFTER INSERT OR UPDATE OR DELETE ON "SharedCustody" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();
CREATE CONSTRAINT TRIGGER "AccessScope_commit" AFTER INSERT OR UPDATE OR DELETE ON "AccessScope" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();
CREATE CONSTRAINT TRIGGER "SharedActor_commit" AFTER INSERT OR UPDATE OR DELETE ON "SharedActor" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();
CREATE CONSTRAINT TRIGGER "ContextAccess_commit" AFTER INSERT OR UPDATE OR DELETE ON "ContextAccess" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();
CREATE CONSTRAINT TRIGGER "ContextAccessInterval_commit" AFTER INSERT OR UPDATE OR DELETE ON "ContextAccessInterval" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();
CREATE CONSTRAINT TRIGGER "CapabilityPolicy_commit" AFTER INSERT OR UPDATE OR DELETE ON "ContextCapabilityPolicy" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();
CREATE CONSTRAINT TRIGGER "SharedLifecycleJob_commit" AFTER INSERT OR UPDATE OR DELETE ON "SharedLifecycleJob" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shared_check_custody();

CREATE FUNCTION shared_space_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId") THEN
    RAISE EXCEPTION 'Space identity and Personal owner are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.kind = 'SHARED' AND NOT EXISTS (SELECT 1 FROM "SharedLifecycleJob" WHERE "custodyId" = OLD.id AND state = 'DELETED') THEN
    RAISE EXCEPTION 'Shared space deletion requires completed lifecycle' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Space_immutable_and_delete" BEFORE UPDATE OR DELETE ON "Space" FOR EACH ROW EXECUTE FUNCTION shared_space_guard();

CREATE FUNCTION shared_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE role_name text; caps jsonb; cap text;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Published policy is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'SharedRetentionPolicy' THEN RETURN NEW; END IF;
  IF NOT (NEW."roleDefaults" ?& ARRAY['OWNER','ADMIN','MANAGER','MEMBER','VIEWER']) OR (SELECT count(*) FROM jsonb_object_keys(NEW."roleDefaults")) <> 5 THEN
    RAISE EXCEPTION 'Exact Project role catalog required' USING ERRCODE = '23514';
  END IF;
  FOR role_name,caps IN SELECT * FROM jsonb_each(NEW."roleDefaults") LOOP
    IF jsonb_typeof(caps) <> 'array' THEN RAISE EXCEPTION 'Capabilities must be arrays' USING ERRCODE = '23514'; END IF;
    FOR cap IN SELECT jsonb_array_elements_text(caps) LOOP
      IF cap IS NULL OR cap NOT IN ('task.read','task.create','task.update','task.complete','task.delete','assignment.accept','assignment.decline','assignment.assign','workflow.transition','workflow.publish','export.visible','file.read')
        OR (role_name = 'VIEWER' AND cap NOT IN ('task.read','export.visible','file.read'))
        OR (role_name = 'MEMBER' AND cap IN ('task.delete','workflow.publish')) THEN
        RAISE EXCEPTION 'Capability exceeds fixed ordinary-role ceiling' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CapabilityPolicy_guard" BEFORE INSERT OR UPDATE ON "ContextCapabilityPolicy" FOR EACH ROW EXECUTE FUNCTION shared_policy_guard();
CREATE TRIGGER "RetentionPolicy_immutable" BEFORE UPDATE ON "SharedRetentionPolicy" FOR EACH ROW EXECUTE FUNCTION shared_policy_guard();

CREATE FUNCTION shared_interval_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF (NEW."accessId",NEW.generation,NEW."joinedAt") IS DISTINCT FROM (OLD."accessId",OLD.generation,OLD."joinedAt") OR OLD."endedAt" IS NOT NULL OR NEW."endedAt" IS NULL THEN
    RAISE EXCEPTION 'Intervals may only close an open immutable generation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ContextAccessInterval_history" BEFORE UPDATE ON "ContextAccessInterval" FOR EACH ROW EXECUTE FUNCTION shared_interval_guard();

CREATE FUNCTION shared_retained_row_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME = 'ContextAccessInterval' THEN
    SELECT "spaceId" INTO target FROM "ContextAccess" WHERE id = OLD."accessId";
  ELSE target := OLD."spaceId"; END IF;
  IF target IS NOT NULL AND EXISTS (SELECT 1 FROM "SharedCustody" WHERE "spaceId" = target AND state NOT IN ('PURGING','DELETED')) THEN
    RAISE EXCEPTION 'Retained history requires controlled purge' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "ContextAccessInterval_retained" BEFORE DELETE ON "ContextAccessInterval" FOR EACH ROW EXECUTE FUNCTION shared_retained_row_guard();
CREATE TRIGGER "ContextCapabilityPolicy_retained" BEFORE DELETE ON "ContextCapabilityPolicy" FOR EACH ROW EXECUTE FUNCTION shared_retained_row_guard();

CREATE FUNCTION shared_unavailable_target() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION 'Typed resource grant targets are not activated by the G0 kernel' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ResourceGrant_target_required" BEFORE INSERT OR UPDATE ON "ResourceGrant" FOR EACH ROW EXECUTE FUNCTION shared_unavailable_target();

CREATE FUNCTION shared_personal_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Space" WHERE id = NEW."spaceId" AND kind = 'PERSONAL') THEN
    RAISE EXCEPTION 'Existing source is Personal-only until its reviewed extension' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Task_personal_until_extension" BEFORE INSERT OR UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();
CREATE TRIGGER "Label_personal_until_extension" BEFORE INSERT OR UPDATE ON "Label" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();
CREATE TRIGGER "Outbox_personal_until_extension" BEFORE INSERT OR UPDATE ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();
CREATE TRIGGER "Posting_personal_until_extension" BEFORE INSERT OR UPDATE ON "TransactionPosting" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();
CREATE TRIGGER "Exchange_personal_until_extension" BEFORE INSERT OR UPDATE ON "ExchangeRateSnapshot" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();
CREATE TRIGGER "SyncChange_personal_until_extension" BEFORE INSERT OR UPDATE ON "SyncChange" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();
CREATE TRIGGER "Xp_personal_until_extension" BEFORE INSERT OR UPDATE ON "XpLedger" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();
CREATE TRIGGER "Unlock_personal_until_extension" BEFORE INSERT OR UPDATE ON "AchievementUnlock" FOR EACH ROW EXECUTE FUNCTION shared_personal_source_guard();

CREATE TABLE "SharedExitWork" (
  "userId" uuid PRIMARY KEY,
  "closedAt" timestamptz(3) NOT NULL,
  "afterActorId" uuid,
  revision integer NOT NULL DEFAULT 1,
  "completedAt" timestamptz(3)
);
CREATE TABLE "SharedOutboxEvent" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL REFERENCES "SharedCustody"("spaceId") ON DELETE NO ACTION,
  "actorId" uuid NOT NULL,
  "auditId" uuid NOT NULL UNIQUE REFERENCES "SharedAuditEvent"(id) ON DELETE NO ACTION,
  action varchar(80) NOT NULL,
  "authorizationVersion" bigint NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "handledAt" timestamptz(3),
  FOREIGN KEY ("spaceId","actorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);
CREATE INDEX "SharedOutbox_pending" ON "SharedOutboxEvent"("handledAt",id);
CREATE TABLE "SharedUsageEntry" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL REFERENCES "SharedCustody"("spaceId") ON DELETE NO ACTION,
  "subjectActorId" uuid NOT NULL,
  "auditId" uuid NOT NULL UNIQUE REFERENCES "SharedAuditEvent"(id) ON DELETE NO ACTION,
  feature varchar(40) NOT NULL CHECK (feature IN ('shared.custody','shared.membership')),
  delta integer NOT NULL CHECK (delta IN (-1,1)),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY ("spaceId","subjectActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION
);

-- A generation can only advance on explicit readmission; identities never move contexts.
CREATE FUNCTION shared_access_generation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.generation <> 1 THEN RAISE EXCEPTION 'Initial admission generation must be one' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW."spaceId",NEW."scopeId",NEW."actorId") IS DISTINCT FROM (OLD.id,OLD."spaceId",OLD."scopeId",OLD."actorId") THEN
    RAISE EXCEPTION 'Admission identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.generation <> OLD.generation THEN
    IF NEW.generation <> OLD.generation+1 OR OLD.state NOT IN ('LEFT','REVOKED','ERASED') OR NEW.state <> 'ACTIVE' OR NEW."joinedAt" < OLD."endedAt" THEN
      RAISE EXCEPTION 'Invalid admission generation transition' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."joinedAt" IS DISTINCT FROM OLD."joinedAt" OR (OLD.state IN ('LEFT','REVOKED','ERASED') AND NEW.state IN ('ACTIVE','SUSPENDED')) THEN
    RAISE EXCEPTION 'Readmission requires a new immutable interval' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ContextAccess_generation" BEFORE INSERT OR UPDATE ON "ContextAccess" FOR EACH ROW EXECUTE FUNCTION shared_access_generation_guard();
COMMIT;
