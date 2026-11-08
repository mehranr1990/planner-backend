BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE "CompanyCustodyTransfer" (
 "id" uuid NOT NULL,
 "sourceCustodyId" uuid NOT NULL,
 "sourceProjectId" uuid,
 "sourceTeamId" uuid,
 "companyId" uuid NOT NULL,
 "parentScopeId" uuid NOT NULL,
 "sourceOwnerAccessId" uuid NOT NULL,
 "sourceOwnerGeneration" integer NOT NULL,
 "companyOwnerAccessId" uuid NOT NULL,
 "companyOwnerGeneration" integer NOT NULL,
 "sourceVersion" bigint NOT NULL,
 "companyVersion" bigint NOT NULL,
 "retentionPolicyVersion" varchar(80) NOT NULL,
 "manifest" jsonb NOT NULL,
 "manifestHash" char(64) NOT NULL,
 "creationKey" char(64) NOT NULL,
 "fingerprint" char(64) NOT NULL,
 "state" varchar(24) NOT NULL,
 "revision" integer NOT NULL,
 "createdAt" timestamptz(3) NOT NULL,
 "expiresAt" timestamptz(3) NOT NULL,
 "appliedAt" timestamptz(3),
 PRIMARY KEY ("id"),
 UNIQUE ("sourceCustodyId","sourceOwnerAccessId","sourceOwnerGeneration","creationKey"),
 CONSTRAINT "CompanyCustodyTransfer_project" FOREIGN KEY ("sourceProjectId") REFERENCES "Project" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyTransfer_team" FOREIGN KEY ("sourceTeamId") REFERENCES "Team" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyTransfer_company" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyTransfer_context" FOREIGN KEY ("companyId","parentScopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyTransfer_sourceOwner" FOREIGN KEY ("sourceOwnerAccessId","sourceOwnerGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyTransfer_companyOwner" FOREIGN KEY ("companyOwnerAccessId","companyOwnerGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyTransfer_retention" FOREIGN KEY ("retentionPolicyVersion") REFERENCES "SharedRetentionPolicy" ("version") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK (("sourceProjectId" IS NOT NULL)::integer+("sourceTeamId" IS NOT NULL)::integer=1),
 CHECK ("sourceCustodyId"=COALESCE("sourceProjectId","sourceTeamId")),
 CHECK ("sourceCustodyId"<>"companyId"),
 CHECK ("parentScopeId"<>"companyId"),
 CHECK (state IN ('PREVIEWED','APPLYING','APPLIED','REVOKED')),
 CHECK (revision>0 AND "sourceOwnerGeneration">0 AND "companyOwnerGeneration">0 AND "sourceVersion">0 AND "companyVersion">0),
 CHECK ("expiresAt">"createdAt" AND (state='APPLIED')=("appliedAt" IS NOT NULL))
);
CREATE TABLE "CompanyCustodyConsent" (
 "transferId" uuid NOT NULL,
 "sourceActorId" uuid NOT NULL,
 "purpose" varchar(24) NOT NULL,
 "sourceAccessId" uuid,
 "sourceGeneration" integer NOT NULL,
 "destinationRootAccessId" uuid,
 "destinationRootGeneration" integer NOT NULL,
 "destinationRole" varchar(12),
 "manifestHash" char(64) NOT NULL,
 "decision" varchar(24) NOT NULL,
 "revision" integer NOT NULL,
 "decidedAt" timestamptz(3),
 "reauthenticatedAt" timestamptz(3),
 PRIMARY KEY ("transferId","sourceActorId","purpose"),
 CONSTRAINT "CompanyCustodyConsent_transfer" FOREIGN KEY ("transferId") REFERENCES "CompanyCustodyTransfer" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyConsent_actor" FOREIGN KEY ("sourceActorId") REFERENCES "SharedActor" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyConsent_source" FOREIGN KEY ("sourceAccessId","sourceGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "CompanyCustodyConsent_destination" FOREIGN KEY ("destinationRootAccessId","destinationRootGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK (purpose IN ('SOURCE_OWNER','COMPANY_OWNER','PARTICIPANT')),
 CHECK (decision IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
 CHECK (revision>0 AND "sourceGeneration">=0 AND "destinationRootGeneration">=0),
 CHECK (("sourceAccessId" IS NULL)=("sourceGeneration"=0)),
 CHECK (("destinationRootAccessId" IS NULL)=("destinationRootGeneration"=0)),
 CHECK (("decidedAt" IS NULL)=(decision='PENDING'))
);
CREATE TABLE "DomainScopeCustody" (
 "scopeId" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "parentScopeId" uuid NOT NULL,
 "projectId" uuid,
 "teamId" uuid,
 "originCustodyId" uuid NOT NULL,
 "transferId" uuid NOT NULL,
 "primaryOwnerAccessId" uuid NOT NULL,
 "state" varchar(24) NOT NULL,
 "revision" integer NOT NULL,
 "authorizationVersion" bigint NOT NULL,
 "retentionPolicyVersion" varchar(80) NOT NULL,
 "closureGeneration" integer NOT NULL,
 "createdAt" timestamptz(3) NOT NULL,
 PRIMARY KEY ("scopeId"),
 UNIQUE ("spaceId","scopeId"),
 UNIQUE ("transferId"),
 CONSTRAINT "DomainScopeCustody_company" FOREIGN KEY ("spaceId") REFERENCES "Company" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeCustody_scope" FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeCustody_parent" FOREIGN KEY ("spaceId","parentScopeId") REFERENCES "AccessScope" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeCustody_project" FOREIGN KEY ("spaceId","projectId") REFERENCES "Project" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeCustody_team" FOREIGN KEY ("spaceId","teamId") REFERENCES "Team" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeCustody_owner" FOREIGN KEY ("spaceId","scopeId","primaryOwnerAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeCustody_transfer" FOREIGN KEY ("transferId") REFERENCES "CompanyCustodyTransfer" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeCustody_retention" FOREIGN KEY ("retentionPolicyVersion") REFERENCES "SharedRetentionPolicy" ("version") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK (("projectId" IS NOT NULL)::integer+("teamId" IS NOT NULL)::integer=1),
 CHECK ("scopeId"=COALESCE("projectId","teamId") AND "scopeId"="originCustodyId"),
 CHECK ("scopeId"<>"spaceId" AND "scopeId"<>"parentScopeId"),
 CHECK (state IN ('ACTIVE','ARCHIVED','OWNER_EXIT_FROZEN','CLOSING_GRACE','CLOSED')),
 CHECK (revision>0 AND "authorizationVersion">0 AND "closureGeneration">=0)
);
CREATE TABLE "DomainScopeActorAlias" (
 "scopeId" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "historicalActorId" uuid NOT NULL,
 "canonicalActorId" uuid NOT NULL,
 "transferId" uuid NOT NULL,
 PRIMARY KEY ("scopeId","historicalActorId"),
 CONSTRAINT "DomainScopeActorAlias_custody" FOREIGN KEY ("spaceId","scopeId") REFERENCES "DomainScopeCustody" ("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeActorAlias_historical" FOREIGN KEY ("spaceId","historicalActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeActorAlias_canonical" FOREIGN KEY ("spaceId","canonicalActorId") REFERENCES "SharedActor" ("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeActorAlias_transfer" FOREIGN KEY ("transferId") REFERENCES "CompanyCustodyTransfer" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK ("historicalActorId"<>"canonicalActorId")
);
CREATE TABLE "DomainScopeAdmissionAlias" (
 "scopeId" uuid NOT NULL,
 "spaceId" uuid NOT NULL,
 "historicalAccessId" uuid NOT NULL,
 "historicalGeneration" integer NOT NULL,
 "destinationAccessId" uuid NOT NULL,
 "destinationGeneration" integer NOT NULL,
 "transferId" uuid NOT NULL,
 PRIMARY KEY ("scopeId","historicalAccessId","historicalGeneration"),
 CONSTRAINT "DomainScopeAdmissionAlias_custody" FOREIGN KEY ("spaceId","scopeId") REFERENCES "DomainScopeCustody" ("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeAdmissionAlias_historical" FOREIGN KEY ("historicalAccessId","historicalGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeAdmissionAlias_destination" FOREIGN KEY ("destinationAccessId","destinationGeneration") REFERENCES "ContextAccessInterval" ("accessId","generation") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeAdmissionAlias_destinationScope" FOREIGN KEY ("spaceId","scopeId","destinationAccessId") REFERENCES "ContextAccess" ("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "DomainScopeAdmissionAlias_transfer" FOREIGN KEY ("transferId") REFERENCES "CompanyCustodyTransfer" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK ("historicalAccessId"<>"destinationAccessId" AND "historicalGeneration">0 AND "destinationGeneration">0)
);
CREATE FUNCTION company_custody_protocol_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE plan "CompanyCustodyTransfer";
BEGIN
 IF TG_TABLE_NAME='CompanyCustodyTransfer' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Custody evidence requires retention disposal' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.state<>'PREVIEWED' THEN RAISE EXCEPTION 'Preview required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['state','revision','appliedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','appliedAt']) THEN RAISE EXCEPTION 'Immutable custody manifest' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.revision<>OLD.revision+1 OR OLD.state IN ('APPLIED','REVOKED') OR NOT ((OLD.state='PREVIEWED' AND NEW.state IN ('PREVIEWED','APPLYING','REVOKED')) OR (OLD.state='APPLYING' AND NEW.state='APPLIED'))) THEN RAISE EXCEPTION 'Invalid custody plan transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Custody evidence requires retention disposal' USING ERRCODE='23514'; END IF;
 SELECT * INTO plan FROM "CompanyCustodyTransfer" WHERE id=NEW."transferId";
 IF NOT FOUND THEN RAISE EXCEPTION 'Custody manifest required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CompanyCustodyConsent' THEN
  IF plan.state<>'PREVIEWED' OR plan."expiresAt"<=clock_timestamp() OR NEW."manifestHash"<>plan."manifestHash" THEN RAISE EXCEPTION 'Current custody preview required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['decision','revision','decidedAt','reauthenticatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['decision','revision','decidedAt','reauthenticatedAt']) OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Immutable custody consent identity' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' AND plan.state<>'APPLYING' THEN RAISE EXCEPTION 'Applying custody manifest required' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME<>'DomainScopeCustody' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Immutable custody provenance' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='DomainScopeCustody' AND TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','revision','authorizationVersion','primaryOwnerAccessId','closureGeneration']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','authorizationVersion','primaryOwnerAccessId','closureGeneration']) OR NEW.revision<>OLD.revision+1 OR NEW."authorizationVersion"<OLD."authorizationVersion" OR NEW."closureGeneration"<OLD."closureGeneration") THEN RAISE EXCEPTION 'Immutable scoped custody identity' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyCustodyTransfer_protocol" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyCustodyTransfer" FOR EACH ROW EXECUTE FUNCTION company_custody_protocol_guard();
CREATE TRIGGER "CompanyCustodyConsent_protocol" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyCustodyConsent" FOR EACH ROW EXECUTE FUNCTION company_custody_protocol_guard();
CREATE TRIGGER "DomainScopeCustody_protocol" BEFORE INSERT OR UPDATE OR DELETE ON "DomainScopeCustody" FOR EACH ROW EXECUTE FUNCTION company_custody_protocol_guard();
CREATE TRIGGER "DomainScopeActorAlias_protocol" BEFORE INSERT OR UPDATE OR DELETE ON "DomainScopeActorAlias" FOR EACH ROW EXECUTE FUNCTION company_custody_protocol_guard();
CREATE TRIGGER "DomainScopeAdmissionAlias_protocol" BEFORE INSERT OR UPDATE OR DELETE ON "DomainScopeAdmissionAlias" FOR EACH ROW EXECUTE FUNCTION company_custody_protocol_guard();
CREATE FUNCTION company_custody_applied_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "CompanyCustodyTransfer" WHERE id=NEW."transferId" AND state='APPLYING') THEN RAISE EXCEPTION 'Custody apply must complete atomically' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "DomainScopeCustody_applied" AFTER INSERT ON "DomainScopeCustody" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION company_custody_applied_guard();
COMMIT;
