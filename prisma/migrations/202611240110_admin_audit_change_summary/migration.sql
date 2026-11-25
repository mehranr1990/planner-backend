BEGIN;
ALTER TABLE "AdminAuditEvidence" ADD COLUMN "targetAdminId" UUID, ADD COLUMN "beforeRevision" INTEGER, ADD COLUMN "afterRevision" INTEGER;
-- Persist only typed revision numbers and the validated administrative subject.
-- Never copy arbitrary metadata, receipt results, free-form notes or work bodies.
CREATE FUNCTION admin_audit_change_summary() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE m jsonb;
BEGIN
 IF NEW.source='ADMIN' THEN
  SELECT metadata INTO m FROM "AdminAuditEvent" WHERE id=NEW."eventId";
  IF (m->>'targetAdminId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW."targetAdminId":=(m->>'targetAdminId')::uuid; END IF;
  IF (m#>>'{before,revision}') ~ '^[0-9]{1,9}$' THEN NEW."beforeRevision":=(m#>>'{before,revision}')::integer; END IF;
  IF (m#>>'{after,revision}') ~ '^[0-9]{1,9}$' THEN NEW."afterRevision":=(m#>>'{after,revision}')::integer; END IF;
  IF NEW."targetAdminId" IS NOT NULL OR NEW."beforeRevision" IS NOT NULL OR NEW."afterRevision" IS NOT NULL THEN
   NEW.digest:=encode(sha256(convert_to(jsonb_build_array(NEW.digest,NEW."targetAdminId",NEW."beforeRevision",NEW."afterRevision")::text,'UTF8')),'hex');
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminAuditEvidence_summary" BEFORE INSERT ON "AdminAuditEvidence" FOR EACH ROW EXECUTE FUNCTION admin_audit_change_summary();
COMMIT;
