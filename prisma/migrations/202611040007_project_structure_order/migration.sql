BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE INDEX "ProjectPhase_order" ON "ProjectPhase"("spaceId","scopeId","projectId",position,id);
CREATE INDEX "ProjectSection_order" ON "ProjectSection"("spaceId","scopeId","projectId",position,id);
CREATE INDEX "ProjectMilestone_order" ON "ProjectMilestone"("spaceId","scopeId","projectId",position,id);
COMMIT;
