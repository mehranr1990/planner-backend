BEGIN;
CREATE TABLE "AdminAuditRetentionPolicy" (
 category VARCHAR(12) PRIMARY KEY CHECK(category IN ('SECURITY','CONTROL','PRIVACY')),
 days INTEGER NOT NULL DEFAULT 730 CHECK(days BETWEEN 730 AND 3650),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)
);
INSERT INTO "AdminAuditRetentionPolicy"(category) VALUES('SECURITY'),('CONTROL'),('PRIVACY');
CREATE TABLE "AdminAuditRetentionChange" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 category VARCHAR(12) NOT NULL REFERENCES "AdminAuditRetentionPolicy"(category) ON DELETE RESTRICT,
 days INTEGER NOT NULL CHECK(days BETWEEN 730 AND 3650),
 "expectedRevision" INTEGER NOT NULL CHECK("expectedRevision">0),
 "eligibleRecords" INTEGER NOT NULL CHECK("eligibleRecords">=0),
 state VARCHAR(10) NOT NULL DEFAULT 'PREVIEW' CHECK(state IN ('PREVIEW','APPROVED','APPLIED')),
 "requesterAdminId" UUID NOT NULL REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 "approverAdminId" UUID REFERENCES "AdminUser"(id) ON DELETE RESTRICT,
 reason VARCHAR(500) NOT NULL, "approvalReason" VARCHAR(500),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '15 minutes'),
 CHECK("approverAdminId" IS NULL OR "approverAdminId"<>"requesterAdminId"),
 CHECK((state='PREVIEW' AND "approverAdminId" IS NULL) OR (state IN ('APPROVED','APPLIED') AND "approverAdminId" IS NOT NULL))
);
CREATE OR REPLACE FUNCTION admin_audit_evidence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('planner.audit_expiry',true)=OLD.category AND EXISTS(
 SELECT 1 FROM "AdminAuditRetentionPolicy" p WHERE p.category=OLD.category AND OLD."createdAt"<=clock_timestamp()-make_interval(days=>p.days)) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Immutable administrative audit evidence' USING ERRCODE='23514';
END $$;
-- Bounded invoker-rights expiry; no generic SQL, no shorter-than-policy cutoff.
CREATE FUNCTION admin_expire_audit_evidence(kind text,batch_size integer) RETURNS integer LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE item record; total integer:=0; prior text;
BEGIN
 IF batch_size<1 OR batch_size>100 OR kind NOT IN ('SECURITY','CONTROL','PRIVACY') THEN RAISE EXCEPTION 'Invalid audit expiry batch' USING ERRCODE='23514'; END IF;
 prior:=current_setting('planner.audit_expiry',true);
 PERFORM set_config('planner.audit_expiry',kind,true);
 FOR item IN SELECT e.id,e.source,e."eventId" FROM "AdminAuditEvidence" e JOIN "AdminAuditRetentionPolicy" p ON p.category=e.category
 WHERE e.category=kind AND e."createdAt"<=clock_timestamp()-make_interval(days=>p.days)
 AND (e.source<>'ADMIN' OR NOT EXISTS(SELECT 1 FROM "AdminDelivery" d WHERE d."auditId"=e."eventId"))
 ORDER BY e."createdAt",e.id LIMIT batch_size FOR UPDATE OF e SKIP LOCKED LOOP
  IF item.source='ADMIN' THEN DELETE FROM "AdminAuditEvent" WHERE id=item."eventId";
  ELSE DELETE FROM "SecurityAuditEvent" WHERE id=item."eventId"; END IF;
  DELETE FROM "AdminAuditEvidence" WHERE id=item.id; total:=total+1;
 END LOOP;
 PERFORM set_config('planner.audit_expiry',coalesce(prior,''),true);
 RETURN total;
END $$;
COMMIT;
