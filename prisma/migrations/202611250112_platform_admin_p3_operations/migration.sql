-- P3 additive operational control plane; no customer rows or historical policy changed.
BEGIN;
CREATE TABLE "AdminOperationalPolicy" (
 section varchar(10) PRIMARY KEY CHECK(section IN ('HEALTH','JOBS','STORAGE','BACKUP')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), value jsonb NOT NULL CHECK(jsonb_typeof(value)='object')
);
CREATE TABLE "AdminOperationalPolicyDraft" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), section varchar(10) NOT NULL REFERENCES "AdminOperationalPolicy"(section),
 "expectedRevision" integer NOT NULL CHECK("expectedRevision">0), value jsonb NOT NULL,
 impact varchar(500) NOT NULL, state varchar(10) NOT NULL DEFAULT 'PREVIEW' CHECK(state IN ('PREVIEW','PUBLISHED')),
 "requesterAdminId" uuid NOT NULL REFERENCES "AdminUser"(id), "expiresAt" timestamptz(3) NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(), CHECK("expiresAt">"createdAt")
);
CREATE TABLE "AdminOperationalIncident" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule varchar(20) NOT NULL CHECK(rule IN ('DATABASE','QUEUE','STORAGE','WORKER','DELIVERY','BACKUP_AGE','API_ERRORS')),
 severity varchar(10) NOT NULL CHECK(severity IN ('WARNING','CRITICAL')), state varchar(12) NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','RECOVERED')),
 cause varchar(120) NOT NULL, "startedAt" timestamptz(3) NOT NULL DEFAULT now(), "recoveredAt" timestamptz(3),
 "lastNotifiedAt" timestamptz(3), "notificationSequence" integer NOT NULL DEFAULT 0 CHECK("notificationSequence">=0),
 CHECK((state='OPEN' AND "recoveredAt" IS NULL) OR (state='RECOVERED' AND "recoveredAt">="startedAt"))
);
CREATE UNIQUE INDEX "AdminOperationalIncident_open" ON "AdminOperationalIncident"(rule) WHERE state='OPEN';
CREATE TABLE "AdminOperationalNote" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "incidentId" uuid NOT NULL REFERENCES "AdminOperationalIncident"(id),
 "actorAdminId" uuid NOT NULL REFERENCES "AdminUser"(id), note varchar(500) NOT NULL CHECK(length(trim(note))>0), "createdAt" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "AdminOperationalNote_incidentId_id_idx" ON "AdminOperationalNote"("incidentId",id);
CREATE TABLE "AdminOperationalDelivery" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "incidentId" uuid NOT NULL REFERENCES "AdminOperationalIncident"(id),
 "adminUserId" uuid NOT NULL REFERENCES "AdminUser"(id), sequence integer NOT NULL CHECK(sequence>0),
 state varchar(10) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENDING','SENT','FAILED','CANCELED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8), "leaseUntil" timestamptz(3), "nextAt" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "AdminOperationalDelivery_incidentId_adminUserId_sequence_key" ON "AdminOperationalDelivery"("incidentId","adminUserId",sequence);
CREATE TABLE "AdminOperationalHeartbeat" (name varchar(20) PRIMARY KEY CHECK(name='worker'), "instanceId" uuid NOT NULL, "lastSeenAt" timestamptz(3) NOT NULL DEFAULT now());
CREATE TABLE "AdminOperationalCommand" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "actorAdminId" uuid NOT NULL REFERENCES "AdminUser"(id), permission varchar(100) NOT NULL,
 kind varchar(10) NOT NULL CHECK(kind IN ('RUN','RETRY','CANCEL','CHECK')), queue varchar(40) CHECK(queue IN ('planner.sweep','planner.outbox')),
 "jobId" uuid, "dispatchedJobId" uuid, "expectedAttempts" integer CHECK("expectedAttempts">=0),
 state varchar(12) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), "failureCode" varchar(60), "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "completedAt" timestamptz(3),
 CHECK((kind='CHECK' AND queue IS NULL AND "jobId" IS NULL) OR (kind='RUN' AND queue IS NOT NULL AND "jobId" IS NULL) OR (kind IN ('RETRY','CANCEL') AND queue IS NOT NULL AND "jobId" IS NOT NULL AND "expectedAttempts" IS NOT NULL))
);
CREATE INDEX "AdminOperationalCommand_state_createdAt_idx" ON "AdminOperationalCommand"(state,"createdAt");
CREATE TABLE "AdminStorageCleanupPreview" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "actorAdminId" uuid NOT NULL REFERENCES "AdminUser"(id), fingerprint char(64) NOT NULL,
 targets jsonb NOT NULL CHECK(jsonb_typeof(targets)='array' AND jsonb_array_length(targets)<=100), bytes bigint NOT NULL CHECK(bytes>=0),
 state varchar(10) NOT NULL DEFAULT 'PREVIEW' CHECK(state IN ('PREVIEW','APPLIED')), removed integer NOT NULL DEFAULT 0 CHECK(removed BETWEEN 0 AND 100),
 "expiresAt" timestamptz(3) NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), CHECK("expiresAt">"createdAt")
);
CREATE TABLE "AdminStoragePressure" (id varchar(10) PRIMARY KEY CHECK(id='storage'), since timestamptz(3) NOT NULL DEFAULT now());
CREATE TABLE "AdminBackupRun" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "actorAdminId" uuid REFERENCES "AdminUser"(id), origin varchar(10) NOT NULL CHECK(origin IN ('MANUAL','SCHEDULE')),
 state varchar(10) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','VERIFIED','FAILED')),
 "retentionDays" integer NOT NULL CHECK("retentionDays" BETWEEN 1 AND 30), "policyRevision" integer NOT NULL CHECK("policyRevision">0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "completedAt" timestamptz(3), "expiresAt" timestamptz(3), "failureCode" varchar(60),
 encrypted boolean NOT NULL DEFAULT false, "offHostVerified" boolean NOT NULL DEFAULT false, "manifestDigest" char(64),
 "operatorLeaseId" uuid, "leaseUntil" timestamptz(3), evidence jsonb,
 CHECK(state<>'VERIFIED' OR (encrypted AND "offHostVerified" AND "manifestDigest" IS NOT NULL AND evidence IS NOT NULL AND "completedAt" IS NOT NULL AND "expiresAt">"completedAt")),
 CHECK("expiresAt" IS NULL OR "expiresAt"<="createdAt"+make_interval(days=>"retentionDays"))
);
CREATE INDEX "AdminBackupRun_createdAt_id_idx" ON "AdminBackupRun"("createdAt",id);
CREATE UNIQUE INDEX "AdminBackupRun_one_pending" ON "AdminBackupRun"((1)) WHERE state IN ('QUEUED','RUNNING');
CREATE TABLE "AdminRestoreRun" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "backupId" uuid NOT NULL REFERENCES "AdminBackupRun"(id), mode varchar(10) NOT NULL CHECK(mode IN ('DRILL','RESTORE')),
 "targetReference" varchar(80) NOT NULL CHECK("targetReference" ~ '^[A-Za-z0-9._-]{1,80}$'),
 state varchar(12) NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','APPROVED','RUNNING','VERIFIED','FAILED')),
 "requesterAdminId" uuid NOT NULL REFERENCES "AdminUser"(id), "approverAdminId" uuid REFERENCES "AdminUser"(id),
 "expiresAt" timestamptz(3) NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "completedAt" timestamptz(3), "failureCode" varchar(60),
 "replayVerified" boolean NOT NULL DEFAULT false, "readinessVerified" boolean NOT NULL DEFAULT false, "operatorLeaseId" uuid, "leaseUntil" timestamptz(3), evidence jsonb,
 CHECK("approverAdminId" IS NULL OR "approverAdminId"<>"requesterAdminId"),
 CHECK(state NOT IN ('APPROVED','RUNNING','VERIFIED') OR "approverAdminId" IS NOT NULL),
 CHECK(state<>'VERIFIED' OR ("replayVerified" AND "readinessVerified" AND evidence IS NOT NULL AND "completedAt" IS NOT NULL)),
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '30 minutes')
);
CREATE INDEX "AdminRestoreRun_createdAt_id_idx" ON "AdminRestoreRun"("createdAt",id);
-- Initial defaults preserve minutely sweep and seven-day queue retention.
INSERT INTO "AdminOperationalPolicy"(section,value) VALUES
 ('HEALTH','{"rules":[{"rule":"DATABASE","enabled":true,"severity":"CRITICAL","threshold":1,"repeatMinutes":60,"channels":["IN_APP"],"silencedUntil":null},{"rule":"QUEUE","enabled":true,"severity":"CRITICAL","threshold":1,"repeatMinutes":60,"channels":["IN_APP"],"silencedUntil":null},{"rule":"STORAGE","enabled":true,"severity":"WARNING","threshold":1,"repeatMinutes":60,"channels":["IN_APP"],"silencedUntil":null},{"rule":"WORKER","enabled":true,"severity":"WARNING","threshold":180,"repeatMinutes":60,"channels":["IN_APP"],"silencedUntil":null},{"rule":"BACKUP_AGE","enabled":true,"severity":"WARNING","threshold":48,"repeatMinutes":1440,"channels":["IN_APP"],"silencedUntil":null}]}'),
 ('JOBS','{"sweepMinutes":1,"sweep":{"completedDays":7,"failedDays":7},"outbox":{"completedDays":7,"failedDays":7},"delivery":{"completedDays":7,"failedDays":7},"dead":{"completedDays":7,"failedDays":7}}'),
 ('STORAGE','{"mode":"WARN","minimumFreeBytes":1073741824,"graceMinutes":60,"cleanupAgeHours":24}'),
 ('BACKUP','{"enabled":false,"intervalHours":24,"drillIntervalDays":30}');
-- Preserve exact file targets independently of customer file/account erasure.
ALTER TABLE "AdminAuditEvidence" ADD COLUMN "targetFileId" uuid;
CREATE FUNCTION admin_operational_file_target() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE m jsonb;
BEGIN
 IF NEW.source='ADMIN' AND NEW.action='GET operations/storage/files/:id/content' THEN
  SELECT metadata INTO m FROM "AdminAuditEvent" WHERE id=NEW."eventId";
  IF (m->>'fileId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   NEW."targetFileId":=(m->>'fileId')::uuid;
   NEW.digest:=encode(sha256(convert_to(jsonb_build_array(NEW.digest,NEW."targetFileId")::text,'UTF8')),'hex');
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminAuditEvidence_file_target" BEFORE INSERT ON "AdminAuditEvidence" FOR EACH ROW EXECUTE FUNCTION admin_operational_file_target();
CREATE FUNCTION admin_operational_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='AdminOperationalNote' THEN RAISE EXCEPTION 'Immutable operational evidence' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='AdminOperationalPolicyDraft' THEN
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR OLD.state<>'PREVIEW' OR NEW.state<>'PUBLISHED' THEN RAISE EXCEPTION 'Immutable policy preview' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='AdminStorageCleanupPreview' THEN
  IF (to_jsonb(NEW)-ARRAY['state','removed']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','removed']) OR OLD.state<>'PREVIEW' OR NEW.state<>'APPLIED' THEN RAISE EXCEPTION 'Immutable cleanup preview' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='AdminBackupRun' THEN
  IF OLD.state IN ('VERIFIED','FAILED') OR (to_jsonb(NEW)-ARRAY['state','completedAt','expiresAt','failureCode','encrypted','offHostVerified','manifestDigest','operatorLeaseId','leaseUntil','evidence']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','completedAt','expiresAt','failureCode','encrypted','offHostVerified','manifestDigest','operatorLeaseId','leaseUntil','evidence']) OR NOT ((OLD.state='QUEUED' AND NEW.state IN ('RUNNING','FAILED')) OR (OLD.state='RUNNING' AND NEW.state IN ('VERIFIED','FAILED'))) THEN RAISE EXCEPTION 'Invalid backup transition' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='AdminRestoreRun' THEN
  IF OLD.state IN ('VERIFIED','FAILED') OR (to_jsonb(NEW)-ARRAY['state','approverAdminId','completedAt','failureCode','replayVerified','readinessVerified','operatorLeaseId','leaseUntil','evidence']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','approverAdminId','completedAt','failureCode','replayVerified','readinessVerified','operatorLeaseId','leaseUntil','evidence']) OR (OLD."approverAdminId" IS NOT NULL AND NEW."approverAdminId" IS DISTINCT FROM OLD."approverAdminId") OR NOT ((OLD.state='REQUESTED' AND NEW.state IN ('APPROVED','FAILED')) OR (OLD.state='APPROVED' AND NEW.state IN ('RUNNING','FAILED')) OR (OLD.state='RUNNING' AND NEW.state IN ('VERIFIED','FAILED'))) THEN RAISE EXCEPTION 'Invalid restore transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminOperationalNote_immutable" BEFORE UPDATE OR DELETE ON "AdminOperationalNote" FOR EACH ROW EXECUTE FUNCTION admin_operational_history_guard();
CREATE TRIGGER "AdminOperationalPolicyDraft_immutable" BEFORE UPDATE OR DELETE ON "AdminOperationalPolicyDraft" FOR EACH ROW EXECUTE FUNCTION admin_operational_history_guard();
CREATE TRIGGER "AdminStorageCleanupPreview_immutable" BEFORE UPDATE OR DELETE ON "AdminStorageCleanupPreview" FOR EACH ROW EXECUTE FUNCTION admin_operational_history_guard();
CREATE TRIGGER "AdminBackupRun_immutable" BEFORE UPDATE OR DELETE ON "AdminBackupRun" FOR EACH ROW EXECUTE FUNCTION admin_operational_history_guard();
CREATE TRIGGER "AdminRestoreRun_immutable" BEFORE UPDATE OR DELETE ON "AdminRestoreRun" FOR EACH ROW EXECUTE FUNCTION admin_operational_history_guard();
COMMIT;
