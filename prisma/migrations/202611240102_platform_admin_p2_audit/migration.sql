BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Independent minimal evidence has no live identity/content FK: erasure must not
-- cascade-delete audit or require retaining the user's content or login identity.
CREATE TABLE "AdminAuditEvidence" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 source VARCHAR(20) NOT NULL CHECK(source IN ('ADMIN','USER_SECURITY')),
 "eventId" UUID NOT NULL,
 category VARCHAR(12) NOT NULL CHECK(category IN ('SECURITY','CONTROL','PRIVACY')),
 action VARCHAR(100) NOT NULL,
 outcome VARCHAR(10) NOT NULL CHECK(outcome IN ('SUCCEEDED','DENIED','FAILED')),
 "actorId" UUID, "targetUserId" UUID, "targetSpaceId" UUID,
 "requestId" UUID NOT NULL, reason VARCHAR(500), digest CHAR(64) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL,
 UNIQUE(source,"eventId")
);
CREATE INDEX "AdminAuditEvidence_category_createdAt_id_idx" ON "AdminAuditEvidence"(category,"createdAt",id);
CREATE FUNCTION admin_audit_category(action text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN action ~* '(ACCOUNT_(EXPORT|DELETION)|privacy|retention)' THEN 'PRIVACY'
 WHEN action ~* '(^AUTH_|^ACCESS_DENIED$|^FILE_|^ADMIN_ACCESS_DENIED$|^POST /sign-|^POST /two-factor|security|revoke.session|/recovery)' THEN 'SECURITY'
 ELSE 'CONTROL' END
$$;
CREATE FUNCTION admin_capture_audit_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE body jsonb; src text; category_name text; stamp timestamptz;
BEGIN
 IF NEW.outcome::text='ATTEMPTED' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='AdminAuditEvent' THEN
  src:='ADMIN'; stamp:=NEW."createdAt";
  body:=jsonb_build_object('source',src,'eventId',NEW.id,'action',NEW.action,'outcome',NEW.outcome,'actorId',NEW."actorAdminId",'targetUserId',NEW."targetUserId",'targetSpaceId',NEW."targetSpaceId",'requestId',NEW."requestId",'reason',NEW.reason,'createdAt',stamp);
 ELSE
  src:='USER_SECURITY'; stamp:=NEW."occurredAt";
  body:=jsonb_build_object('source',src,'eventId',NEW.id,'action',NEW.action,'outcome',NEW.outcome,'actorId',NEW."actorUserId",'targetUserId',NULL,'targetSpaceId',NULL,'requestId',NEW."requestId",'reason',NULL,'createdAt',stamp);
 END IF;
 category_name:=admin_audit_category(NEW.action);
 -- Exclude work-content events; the control-plane catalog is expandable explicitly.
 IF src='USER_SECURITY' AND category_name='CONTROL' THEN RETURN NEW; END IF;
 INSERT INTO "AdminAuditEvidence"(source,"eventId",category,action,outcome,"actorId","targetUserId","targetSpaceId","requestId",reason,digest,"createdAt")
 VALUES(src,NEW.id,category_name,NEW.action,NEW.outcome::text,(body->>'actorId')::uuid,(body->>'targetUserId')::uuid,(body->>'targetSpaceId')::uuid,NEW."requestId",body->>'reason',encode(sha256(convert_to(body::text,'UTF8')),'hex'),stamp)
 ON CONFLICT(source,"eventId") DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminAuditEvent_capture" AFTER INSERT OR UPDATE ON "AdminAuditEvent" FOR EACH ROW EXECUTE FUNCTION admin_capture_audit_evidence();
CREATE TRIGGER "SecurityAuditEvent_admin_capture" AFTER INSERT OR UPDATE ON "SecurityAuditEvent" FOR EACH ROW EXECUTE FUNCTION admin_capture_audit_evidence();
CREATE FUNCTION admin_audit_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable administrative audit evidence' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "AdminAuditEvidence_immutable" BEFORE UPDATE OR DELETE ON "AdminAuditEvidence" FOR EACH ROW EXECUTE FUNCTION admin_audit_evidence_guard();
COMMIT;
