CREATE TABLE "TaskWorkflowDraft" (
 "id" UUID PRIMARY KEY, "spaceId" UUID NOT NULL, "scopeId" UUID NOT NULL,
 "workflowId" UUID, "baseRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("baseRevision">=0),
 "definition" JSONB NOT NULL, "state" VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK ("state" IN ('DRAFT','PUBLISHED','DISCARDED')),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0), "publishedVersion" INTEGER,
 "createdByActorId" UUID NOT NULL, "creationKey" CHAR(64) NOT NULL, "fingerprint" CHAR(64) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","scopeId","workflowId") REFERENCES "TaskWorkflow"("spaceId","scopeId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK ((state='PUBLISHED' AND "workflowId" IS NOT NULL AND "publishedVersion">0) OR (state<>'PUBLISHED' AND "publishedVersion" IS NULL)),
 UNIQUE ("spaceId","scopeId","createdByActorId","creationKey")
);
CREATE INDEX "TaskWorkflowDraft_spaceId_scopeId_id_idx" ON "TaskWorkflowDraft"("spaceId","scopeId","id");
