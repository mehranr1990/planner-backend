BEGIN;
-- TM-11 Team file library: folders, logical files and immutable versions bound to private StoredFile rows.
CREATE TABLE "TeamFileFolder" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "parentId" uuid,
 title varchar(200) NOT NULL CHECK(length(btrim(title))>0),
 "createdByActorId" uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamFileFolder_not_self" CHECK("parentId" IS NULL OR "parentId"<>id),
 CONSTRAINT "TeamFileFolder_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFileFolder_parent" FOREIGN KEY("spaceId","scopeId","parentId") REFERENCES "TeamFileFolder"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFileFolder_creator" FOREIGN KEY("spaceId","createdByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","scopeId",id)
);
CREATE INDEX "TeamFileFolder_page" ON "TeamFileFolder"("spaceId","scopeId",id);
CREATE TABLE "TeamFile" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "folderId" uuid,
 title varchar(300) NOT NULL CHECK(length(btrim(title))>0),
 "ownerAccessId" uuid NOT NULL,
 "ownerGeneration" integer NOT NULL CHECK("ownerGeneration">0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "updatedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "removedAt" timestamptz(3),
 "removedByActorId" uuid,
 CONSTRAINT "TeamFile_removed_shape" CHECK(num_nonnulls("removedAt","removedByActorId") IN (0,2)),
 CONSTRAINT "TeamFile_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFile_folder" FOREIGN KEY("spaceId","scopeId","folderId") REFERENCES "TeamFileFolder"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFile_owner" FOREIGN KEY("spaceId","scopeId","ownerAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFile_owner_generation" FOREIGN KEY("ownerAccessId","ownerGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFile_remover" FOREIGN KEY("spaceId","removedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("spaceId","scopeId",id)
);
CREATE INDEX "TeamFile_page" ON "TeamFile"("spaceId","scopeId","folderId",id);
CREATE TABLE "TeamFileVersion" (
 id uuid PRIMARY KEY,
 "spaceId" uuid NOT NULL,
 "scopeId" uuid NOT NULL,
 "fileId" uuid NOT NULL,
 number integer NOT NULL CHECK(number BETWEEN 1 AND 100),
 "uploaderAccessId" uuid NOT NULL,
 "uploaderGeneration" integer NOT NULL CHECK("uploaderGeneration">0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "TeamFileVersion_team" FOREIGN KEY("spaceId","scopeId") REFERENCES "Team"("spaceId","scopeId") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFileVersion_file" FOREIGN KEY("spaceId","scopeId","fileId") REFERENCES "TeamFile"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFileVersion_stored" FOREIGN KEY("spaceId","scopeId",id) REFERENCES "StoredFile"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFileVersion_uploader" FOREIGN KEY("spaceId","scopeId","uploaderAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "TeamFileVersion_uploader_generation" FOREIGN KEY("uploaderAccessId","uploaderGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION ON UPDATE NO ACTION,
 UNIQUE("fileId",number)
);
CREATE INDEX "TeamFileVersion_page" ON "TeamFileVersion"("spaceId","fileId",id);
COMMIT;
