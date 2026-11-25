BEGIN;
ALTER TABLE "AdminPrivacyDeletionRequest" ADD COLUMN impact JSONB NOT NULL DEFAULT '{"members":null,"ownedBoundaries":0,"children":null}' CHECK(jsonb_typeof(impact)='object');
CREATE FUNCTION admin_privacy_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Administrative deletion review is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'REQUESTED' OR NEW."approverAdminId" IS NOT NULL OR NEW."resultJobId" IS NOT NULL
   OR NOT coalesce(((NEW.kind='ACCOUNT' AND NEW."targetUserId"=NEW."targetId") OR (NEW.kind='TEAM' AND NEW."targetTeamId"=NEW."targetId") OR (NEW.kind='COMPANY' AND NEW."targetCompanyId"=NEW."targetId")),false) THEN RAISE EXCEPTION 'Invalid initial deletion review' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 -- Typed live references may only become null when their source is erased; the
 -- immutable opaque target and review history remain. They can never be rebound.
 IF (to_jsonb(NEW)-ARRAY['targetUserId','targetTeamId','targetCompanyId']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['targetUserId','targetTeamId','targetCompanyId'])
 AND (NEW."targetUserId" IS NULL OR NEW."targetUserId" IS NOT DISTINCT FROM OLD."targetUserId")
 AND (NEW."targetTeamId" IS NULL OR NEW."targetTeamId" IS NOT DISTINCT FROM OLD."targetTeamId")
 AND (NEW."targetCompanyId" IS NULL OR NEW."targetCompanyId" IS NOT DISTINCT FROM OLD."targetCompanyId") THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','approverAdminId','approvalReason','resultJobId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','approverAdminId','approvalReason','resultJobId']) THEN RAISE EXCEPTION 'Immutable deletion impact review' USING ERRCODE='23514'; END IF;
 IF NOT ((OLD.state='REQUESTED' AND NEW.state='APPROVED') OR (OLD.state='APPROVED' AND NEW.state='APPLIED') OR (OLD.kind='ACCOUNT' AND OLD.state='APPLIED' AND NEW.state='RECOVERED')) THEN RAISE EXCEPTION 'Invalid deletion review transition' USING ERRCODE='23514'; END IF;
 IF NEW.state<>'RECOVERED' AND OLD."expiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'Expired deletion review' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'REQUESTED' AND (NEW."approverAdminId",NEW."approvalReason") IS DISTINCT FROM (OLD."approverAdminId",OLD."approvalReason") THEN RAISE EXCEPTION 'Immutable deletion approver' USING ERRCODE='23514'; END IF;
 IF OLD.state='APPLIED' AND NEW."resultJobId" IS DISTINCT FROM OLD."resultJobId" THEN RAISE EXCEPTION 'Immutable deletion job' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminPrivacyDeletionRequest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AdminPrivacyDeletionRequest" FOR EACH ROW EXECUTE FUNCTION admin_privacy_request_guard();
CREATE FUNCTION admin_privacy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable administrative deletion history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "AdminPrivacyDeletionHistory_guard" BEFORE UPDATE OR DELETE ON "AdminPrivacyDeletionHistory" FOR EACH ROW EXECUTE FUNCTION admin_privacy_history_guard();
COMMIT;
