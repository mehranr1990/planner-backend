BEGIN;
ALTER TABLE "ProjectComment" ADD COLUMN "registerItemId" UUID;
ALTER TABLE "ProjectActivity" ADD COLUMN "registerItemId" UUID;
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_registerItem_fk" FOREIGN KEY ("spaceId","scopeId","projectId","registerItemId") REFERENCES "ProjectRiskIssue"("spaceId","scopeId","projectId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_registerItem_fk" FOREIGN KEY ("spaceId","scopeId","projectId","registerItemId") REFERENCES "ProjectRiskIssue"("spaceId","scopeId","projectId","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_register_target_check" CHECK (num_nonnulls("taskId","goalId","documentId","registerItemId")<=1);
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_register_target_check" CHECK (num_nonnulls("taskId","goalId","documentId","registerItemId")<=1);
CREATE INDEX "ProjectComment_register_page" ON "ProjectComment" ("spaceId","scopeId","projectId","registerItemId","id");
COMMIT;
