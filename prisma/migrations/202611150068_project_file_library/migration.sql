BEGIN;
CREATE TABLE "ProjectFileFolder" (
 id UUID PRIMARY KEY, "spaceId" UUID NOT NULL, "scopeId" UUID NOT NULL, "projectId" UUID NOT NULL,
 "parentId" UUID, title VARCHAR(200) NOT NULL CHECK (length(btrim(title))>0), revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
 "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "archivedAt" TIMESTAMPTZ(3),
 UNIQUE ("spaceId","scopeId","projectId",id),
 FOREIGN KEY ("spaceId","scopeId","projectId") REFERENCES "Project"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","scopeId","projectId","parentId") REFERENCES "ProjectFileFolder"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK (id<>"parentId")
);
CREATE INDEX "ProjectFileFolder_spaceId_scopeId_projectId_parentId_id_idx" ON "ProjectFileFolder"("spaceId","scopeId","projectId","parentId",id);
ALTER TABLE "ProjectFile" ADD COLUMN "folderId" UUID, ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1 CHECK (revision>0);
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_folder_fk" FOREIGN KEY ("spaceId","scopeId","projectId","folderId") REFERENCES "ProjectFileFolder"("spaceId","scopeId","projectId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE TABLE "ProjectFileVersion" (
 "rootFileId" UUID NOT NULL, "fileId" UUID NOT NULL UNIQUE, "spaceId" UUID NOT NULL, "scopeId" UUID NOT NULL, "projectId" UUID NOT NULL,
 number INTEGER NOT NULL CHECK (number BETWEEN 2 AND 100), PRIMARY KEY ("rootFileId",number),
 UNIQUE ("spaceId","scopeId","projectId","fileId"),
 FOREIGN KEY ("spaceId","scopeId","projectId","rootFileId") REFERENCES "ProjectFile"("spaceId","scopeId","projectId","fileId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 FOREIGN KEY ("spaceId","scopeId","projectId","fileId") REFERENCES "ProjectFile"("spaceId","scopeId","projectId","fileId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CHECK ("rootFileId"<>"fileId")
);
COMMIT;
