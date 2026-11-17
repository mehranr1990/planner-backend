BEGIN;
-- Follow-up to M073; preserve its already-applied isolated-test checksum.
CREATE FUNCTION company_transfer_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 RAISE EXCEPTION 'Immutable employee transfer history' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "CompanyDepartmentTransfer_immutable" BEFORE UPDATE ON "CompanyDepartmentTransfer" FOR EACH ROW EXECUTE FUNCTION company_transfer_history_immutable();

CREATE FUNCTION company_asset_retirement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.state='RETIRED' AND (EXISTS(SELECT 1 FROM "CompanyAssetCustody" WHERE "resourceId"=NEW.id AND "returnedAt" IS NULL) OR EXISTS(SELECT 1 FROM "CompanyAssetMaintenance" WHERE "resourceId"=NEW.id AND state IN ('SCHEDULED','IN_PROGRESS'))) THEN
  RAISE EXCEPTION 'Outstanding asset obligations' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyResource_asset_retirement" BEFORE UPDATE ON "CompanyResource" FOR EACH ROW EXECUTE FUNCTION company_asset_retirement_guard();

CREATE FUNCTION company_gap_redaction_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF TG_TABLE_NAME='CompanyOneOnOneAction' THEN
  IF NEW.body IS DISTINCT FROM OLD.body AND (NEW.body IS NOT NULL OR NEW."redactedAt" IS NULL) THEN RAISE EXCEPTION 'Action text is immutable except privacy redaction' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.reason IS DISTINCT FROM OLD.reason AND NEW.reason IS NOT NULL THEN RAISE EXCEPTION 'Reason is immutable except privacy redaction' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CompanyOneOnOneAction_redaction" BEFORE UPDATE ON "CompanyOneOnOneAction" FOR EACH ROW EXECUTE FUNCTION company_gap_redaction_guard();
CREATE TRIGGER "CompanyAssetMaintenance_redaction" BEFORE UPDATE ON "CompanyAssetMaintenance" FOR EACH ROW EXECUTE FUNCTION company_gap_redaction_guard();
CREATE TRIGGER "CompanyTemporaryGrant_redaction" BEFORE UPDATE ON "CompanyTemporaryGrant" FOR EACH ROW EXECUTE FUNCTION company_gap_redaction_guard();
CREATE TRIGGER "CompanyAccessReview_redaction" BEFORE UPDATE ON "CompanyAccessReview" FOR EACH ROW EXECUTE FUNCTION company_gap_redaction_guard();
COMMIT;
