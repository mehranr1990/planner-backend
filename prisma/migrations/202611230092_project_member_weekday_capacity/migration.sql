CREATE TABLE "ProjectMemberCapacityTemplate" (
  id UUID PRIMARY KEY, "spaceId" UUID NOT NULL, "scopeId" UUID NOT NULL, "projectId" UUID NOT NULL,
  "accessId" UUID NOT NULL, generation INTEGER NOT NULL CHECK (generation > 0),
  template JSONB, revision INTEGER NOT NULL DEFAULT 2 CHECK (revision > 0),
  CONSTRAINT "ProjectMemberCapacityTemplate_project_fk" FOREIGN KEY ("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ProjectMemberCapacityTemplate_member_fk" FOREIGN KEY ("spaceId","scopeId","accessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ProjectMemberCapacityTemplate_interval_fk" FOREIGN KEY ("accessId",generation) REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
  UNIQUE ("projectId","accessId",generation)
);
