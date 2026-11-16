BEGIN;
CREATE TABLE "ProjectRegisterDetail" (
 "itemId" UUID PRIMARY KEY, "spaceId" UUID NOT NULL, "scopeId" UUID NOT NULL, "projectId" UUID NOT NULL,
 "kind" VARCHAR(5) NOT NULL CHECK (kind IN ('RISK','ISSUE')), "ordinal" INTEGER NOT NULL CHECK (ordinal>0), "code" VARCHAR(32) NOT NULL,
 "checklist" JSONB NOT NULL DEFAULT '[]', "closeReason" VARCHAR(500), "closeNote" VARCHAR(2000), "closedAt" TIMESTAMPTZ(3), "closedByActorId" UUID,
 "convertedIssueId" UUID, "convertedTaskId" UUID,
 FOREIGN KEY ("spaceId","scopeId","projectId","itemId") REFERENCES "ProjectRiskIssue"("spaceId","scopeId","projectId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","scopeId","projectId","convertedIssueId") REFERENCES "ProjectRiskIssue"("spaceId","scopeId","projectId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","scopeId","projectId","convertedTaskId") REFERENCES "ProjectTask"("spaceId","scopeId","projectId","taskId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","closedByActorId") REFERENCES "SharedActor"("spaceId","id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK (num_nonnulls("convertedIssueId","convertedTaskId")<=1),
 CHECK (("closedAt" IS NULL AND "closedByActorId" IS NULL AND "closeReason" IS NULL) OR ("closedAt" IS NOT NULL AND "closedByActorId" IS NOT NULL AND length(btrim("closeReason"))>0)),
 UNIQUE ("spaceId","scopeId","projectId","code"), UNIQUE ("spaceId","scopeId","projectId","kind","ordinal"), UNIQUE ("spaceId","scopeId","projectId","itemId")
);
-- Assign stable codes without rewriting any existing risk, revision or history.
INSERT INTO "ProjectRegisterDetail" ("itemId","spaceId","scopeId","projectId","kind","ordinal","code")
SELECT id,"spaceId","scopeId","projectId",kind,n,CASE kind WHEN 'RISK' THEN 'R-' ELSE 'I-' END||n::text
FROM (SELECT *,row_number() OVER (PARTITION BY "spaceId","scopeId","projectId",kind ORDER BY "createdAt",id)::integer n FROM "ProjectRiskIssue") r;
COMMIT;
