ALTER TABLE "Project" ADD COLUMN "initialTemplate" VARCHAR(6), ADD COLUMN "initialTemplateVersion" INTEGER;
ALTER TABLE "Project" ADD CONSTRAINT "Project_initial_template_check" CHECK (("initialTemplate" IS NULL AND "initialTemplateVersion" IS NULL) OR ("initialTemplate" IN ('BLANK','KANBAN','SCRUM') AND "initialTemplateVersion"=1));
