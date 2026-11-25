BEGIN;
ALTER TABLE "AdminSecurityApproval" ADD COLUMN "targetEnrollmentAt" TIMESTAMPTZ(3);
CREATE FUNCTION admin_security_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Security review history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING' OR NEW."approverAdminId" IS NOT NULL OR NEW."completedAt" IS NOT NULL THEN RAISE EXCEPTION 'Security review must begin pending' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','approverAdminId','approvalReason','completedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','approverAdminId','approvalReason','completedAt']) THEN
  RAISE EXCEPTION 'Immutable security review request' USING ERRCODE='23514';
 END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF OLD."expiresAt"<=clock_timestamp() OR NOT ((OLD.state='PENDING' AND NEW.state IN ('APPROVED','REJECTED')) OR (OLD.state='APPROVED' AND NEW.state='EXECUTED')) THEN
  RAISE EXCEPTION 'Invalid security review transition' USING ERRCODE='23514';
 END IF;
 IF OLD.state='APPROVED' AND (NEW."approverAdminId",NEW."approvalReason") IS DISTINCT FROM (OLD."approverAdminId",OLD."approvalReason") THEN
  RAISE EXCEPTION 'Immutable second approval' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminSecurityApproval_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AdminSecurityApproval" FOR EACH ROW EXECUTE FUNCTION admin_security_approval_guard();
COMMIT;
