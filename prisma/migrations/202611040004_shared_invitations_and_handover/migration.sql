-- P2-02: typed offers and accepted administrative succession; no Project/source tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "ContextAccess" ADD CONSTRAINT "ContextAccess_scope_key" UNIQUE ("spaceId","scopeId",id);
ALTER TABLE "ContextAccess" ADD CONSTRAINT "ContextAccess_admission_key" UNIQUE ("spaceId","scopeId",id,"actorId");
CREATE TABLE "ContextInvitation" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL,
  "scopeId" uuid NOT NULL,
  "inviterAccessId" uuid NOT NULL,
  "inviterGeneration" integer NOT NULL CHECK ("inviterGeneration">0),
  "recipientUserId" uuid REFERENCES "User"(id) ON DELETE RESTRICT,
  "recipientEmail" varchar(320),
  "recipientAccessId" uuid,
  "recipientGeneration" integer,
  "recipientRevision" integer,
  "memberRole" varchar(10) NOT NULL CHECK ("memberRole" IN ('ADMIN','MANAGER','MEMBER','VIEWER')),
  state varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ACCEPTED','DECLINED','REVOKED','EXPIRED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  "proofHash" char(64) UNIQUE CHECK ("proofHash" ~ '^[0-9a-f]{64}$'),
  "keyHash" char(64) NOT NULL CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" timestamptz(3) NOT NULL,
  "endedAt" timestamptz(3),
  "acceptedActorId" uuid,
  "acceptedAccessId" uuid,
  "acceptedGeneration" integer,
  FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","scopeId","inviterAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("inviterAccessId","inviterGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","scopeId","recipientAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("recipientAccessId","recipientGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","acceptedActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","scopeId","acceptedAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","scopeId","acceptedAccessId","acceptedActorId") REFERENCES "ContextAccess"("spaceId","scopeId",id,"actorId") ON DELETE NO ACTION,
  FOREIGN KEY ("acceptedAccessId","acceptedGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
  UNIQUE ("spaceId",id),
  UNIQUE ("spaceId","inviterAccessId","inviterGeneration","keyHash"),
  CHECK ("expiresAt"="createdAt"+interval '168 hours'),
  CHECK ((state='PENDING' AND "endedAt" IS NULL AND "proofHash" IS NOT NULL AND (("recipientUserId" IS NOT NULL AND "recipientEmail" IS NULL) OR ("recipientUserId" IS NULL AND "recipientEmail" IS NOT NULL))) OR (state<>'PENDING' AND "endedAt" IS NOT NULL AND "recipientEmail" IS NULL AND "recipientUserId" IS NULL)),
  CHECK ((num_nonnulls("recipientAccessId","recipientGeneration","recipientRevision")=0) OR (num_nonnulls("recipientAccessId","recipientGeneration","recipientRevision")=3 AND "recipientGeneration">0 AND "recipientRevision">0)),
  CHECK ((state='ACCEPTED' AND "acceptedActorId" IS NOT NULL AND "acceptedAccessId" IS NOT NULL AND "acceptedGeneration" IS NOT NULL AND "acceptedGeneration">0 AND "proofHash" IS NOT NULL) OR (state<>'ACCEPTED' AND "acceptedActorId" IS NULL AND "acceptedAccessId" IS NULL AND "acceptedGeneration" IS NULL)),
  CHECK ("recipientEmail" IS NULL OR (length("recipientEmail") BETWEEN 3 AND 320 AND "recipientEmail"=lower("recipientEmail")))
);
CREATE INDEX "ContextInvitation_expiry" ON "ContextInvitation"(state,"expiresAt",id);
CREATE INDEX "ContextInvitation_recipient" ON "ContextInvitation"("recipientUserId",id);
CREATE INDEX "ContextInvitation_email" ON "ContextInvitation"("recipientEmail",id);
CREATE INDEX "ContextInvitation_context" ON "ContextInvitation"("spaceId",state,id);
CREATE TABLE "OwnerHandover" (
  id uuid PRIMARY KEY,
  "spaceId" uuid NOT NULL,
  "scopeId" uuid NOT NULL,
  "fromAccessId" uuid NOT NULL,
  "fromGeneration" integer NOT NULL CHECK ("fromGeneration">0),
  "toAccessId" uuid NOT NULL,
  "toGeneration" integer NOT NULL CHECK ("toGeneration">0),
  "expectedCustodyRevision" integer NOT NULL CHECK ("expectedCustodyRevision">0),
  state varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ACCEPTED','DECLINED','REVOKED','EXPIRED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  "keyHash" char(64) NOT NULL CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "expiresAt" timestamptz(3) NOT NULL,
  "endedAt" timestamptz(3),
  "acceptedByActorId" uuid,
  "reauthenticatedAt" timestamptz(3),
  FOREIGN KEY ("spaceId","scopeId") REFERENCES "AccessScope"("spaceId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","scopeId","fromAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("fromAccessId","fromGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","scopeId","toAccessId") REFERENCES "ContextAccess"("spaceId","scopeId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("toAccessId","toGeneration") REFERENCES "ContextAccessInterval"("accessId",generation) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","acceptedByActorId") REFERENCES "SharedActor"("spaceId",id) ON DELETE NO ACTION,
  FOREIGN KEY ("spaceId","scopeId","toAccessId","acceptedByActorId") REFERENCES "ContextAccess"("spaceId","scopeId",id,"actorId") ON DELETE NO ACTION,
  UNIQUE ("spaceId",id),
  UNIQUE ("spaceId","fromAccessId","fromGeneration","keyHash"),
  CHECK ("fromAccessId"<>"toAccessId"),
  CHECK ("expiresAt"="createdAt"+interval '168 hours'),
  CHECK ((state='PENDING' AND "endedAt" IS NULL) OR (state<>'PENDING' AND "endedAt" IS NOT NULL)),
  CHECK ((state='ACCEPTED' AND "acceptedByActorId" IS NOT NULL AND "reauthenticatedAt" IS NOT NULL AND "reauthenticatedAt" BETWEEN "endedAt"-interval '5 minutes' AND "endedAt") OR (state<>'ACCEPTED' AND "acceptedByActorId" IS NULL AND "reauthenticatedAt" IS NULL))
);
CREATE UNIQUE INDEX "OwnerHandover_one_pending" ON "OwnerHandover"("spaceId") WHERE state='PENDING';
CREATE INDEX "OwnerHandover_expiry" ON "OwnerHandover"(state,"expiresAt",id);
CREATE TABLE "SharedRateLimit" (
  "keyHash" char(64) PRIMARY KEY CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
  "windowAt" timestamptz(3) NOT NULL,
  requests integer NOT NULL CHECK (requests>0),
  "expiresAt" timestamptz(3) NOT NULL
);
CREATE INDEX "SharedRateLimit_expiry" ON "SharedRateLimit"("expiresAt","keyHash");
COMMIT;
