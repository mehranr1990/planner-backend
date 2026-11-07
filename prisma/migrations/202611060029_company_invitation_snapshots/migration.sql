BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE "ContextInvitation" ADD COLUMN "companyTargetAccessId" uuid,ADD COLUMN "companyTargetGeneration" integer,ADD COLUMN "companyTargetRevision" integer,ADD COLUMN "companyAdmissionVersion" integer,
 ADD FOREIGN KEY("companyTargetAccessId") REFERENCES "ContextAccess"(id) ON DELETE NO ACTION,
 ADD FOREIGN KEY("companyTargetAccessId","companyTargetGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
 ADD CONSTRAINT "ContextInvitation_company_target_pair" CHECK(num_nonnulls("companyTargetAccessId","companyTargetGeneration","companyTargetRevision")=0 OR (num_nonnulls("companyTargetAccessId","companyTargetGeneration","companyTargetRevision")=3 AND "companyTargetGeneration">0 AND "companyTargetRevision">0)),
 ADD CONSTRAINT "ContextInvitation_company_admission_version" CHECK("companyAdmissionVersion" IS NULL OR "companyAdmissionVersion"=1);
-- Preserve every existing offer and its recipient/proof bytes. Unsupported legacy
-- Company offers remain unreadable/unacceptable until normal expiry or explicit revocation.
CREATE FUNCTION company_invitation_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW."companyScopeId" IS NULL THEN
  IF num_nonnulls(NEW."companyTargetAccessId",NEW."companyTargetGeneration",NEW."companyTargetRevision",NEW."companyAdmissionVersion")<>0 THEN RAISE EXCEPTION 'Company admission snapshot requires Company offer' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.state='PENDING' AND NEW."companyAdmissionVersion" IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Company offer requires generation snapshot' USING ERRCODE='23514'; END IF;
 IF NEW."companyTargetAccessId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ContextAccess" WHERE id=NEW."companyTargetAccessId" AND "spaceId"=NEW."spaceId" AND "scopeId"=NEW."companyScopeId") THEN RAISE EXCEPTION 'Foreign Company target admission' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."companyTargetAccessId",NEW."companyTargetGeneration",NEW."companyTargetRevision",NEW."companyAdmissionVersion") IS DISTINCT FROM (OLD."companyTargetAccessId",OLD."companyTargetGeneration",OLD."companyTargetRevision",OLD."companyAdmissionVersion") THEN RAISE EXCEPTION 'Immutable Company recipient snapshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ContextInvitation_company_snapshot" BEFORE INSERT OR UPDATE ON "ContextInvitation" FOR EACH ROW EXECUTE FUNCTION company_invitation_snapshot_guard();
COMMIT;
