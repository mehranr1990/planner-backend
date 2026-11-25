BEGIN;
SET LOCAL lock_timeout='5s';
-- Extend the existing review workflow to future backup manifests. Preserve every
-- historical policy/preview, the audit minimum, and the 30-day backup maximum.
ALTER TABLE "AdminAuditRetentionPolicy" DROP CONSTRAINT "AdminAuditRetentionPolicy_category_check",
 DROP CONSTRAINT "AdminAuditRetentionPolicy_days_check",
 ADD CHECK ((category IN ('SECURITY','CONTROL','PRIVACY') AND days BETWEEN 730 AND 3650)
 OR (category='BACKUP' AND days BETWEEN 1 AND 30));
ALTER TABLE "AdminAuditRetentionChange" DROP CONSTRAINT "AdminAuditRetentionChange_days_check",
 ADD CHECK ((category IN ('SECURITY','CONTROL','PRIVACY') AND days BETWEEN 730 AND 3650)
 OR (category='BACKUP' AND days BETWEEN 1 AND 30));
INSERT INTO "AdminAuditRetentionPolicy"(category,days) VALUES ('BACKUP',30);
CREATE FUNCTION admin_retention_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retention review is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PREVIEW' OR NEW."approvalReason" IS NOT NULL THEN RAISE EXCEPTION 'Invalid retention preview' USING ERRCODE='23514'; END IF;
 ELSIF (to_jsonb(NEW)-ARRAY['state','approverAdminId','approvalReason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','approverAdminId','approvalReason'])
 OR OLD."expiresAt"<=clock_timestamp()
 OR NOT ((OLD.state='PREVIEW' AND NEW.state='APPROVED' AND NEW."approvalReason" IS NOT NULL)
 OR (OLD.state='APPROVED' AND NEW.state='APPLIED' AND (NEW."approverAdminId",NEW."approvalReason") IS NOT DISTINCT FROM (OLD."approverAdminId",OLD."approvalReason"))) THEN
  RAISE EXCEPTION 'Invalid retention review transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminAuditRetentionChange_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AdminAuditRetentionChange" FOR EACH ROW EXECUTE FUNCTION admin_retention_review_guard();
COMMIT;
