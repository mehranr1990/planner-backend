BEGIN;
-- Workflow state belongs to typed columns on the existing typed association.
-- Preserve the M071 draft metadata unchanged; copy, never discard, prior requests.
ALTER TABLE "TeamProjectReference" ADD COLUMN "requestId" uuid;
ALTER TABLE "TeamProjectReference" ADD COLUMN "requestAction" varchar(6);
ALTER TABLE "TeamProjectReference" ADD COLUMN "requestState" varchar(8);
ALTER TABLE "TeamProjectReference" ADD COLUMN "requestCreatedAt" timestamptz(3);
ALTER TABLE "TeamProjectReference" ADD COLUMN "requestReviewedAt" timestamptz(3);
UPDATE "TeamProjectReference" SET
 "requestId"=("associationRequest"->>'id')::uuid,
 "requestAction"="associationRequest"->>'action',
 "requestState"="associationRequest"->>'state',
 "requestCreatedAt"=("associationRequest"->>'requestedAt')::timestamptz,
 "requestReviewedAt"=("associationRequest"->>'reviewedAt')::timestamptz
WHERE "associationRequest" IS NOT NULL;
CREATE UNIQUE INDEX "TeamProjectReference_requestId_key" ON "TeamProjectReference"("requestId");
CREATE INDEX "TeamProjectReference_pending" ON "TeamProjectReference"("teamId","requestState","projectId");
ALTER TABLE "TeamProjectReference" ADD CONSTRAINT "TeamProjectReference_request_shape" CHECK (
 num_nonnulls("requestId","requestAction","requestState","requestCreatedAt") IN (0,4)
 AND ("requestId" IS NOT NULL OR "requestReviewedAt" IS NULL)
 AND ("requestId" IS NULL OR (
 "requestAction" IN ('LINK','UNLINK') AND "requestState" IN ('PENDING','APPROVED','REJECTED','CANCELED')
 AND (("requestState"='PENDING' AND "requestReviewedAt" IS NULL) OR ("requestState"<>'PENDING' AND "requestReviewedAt" IS NOT NULL AND "requestReviewedAt">="requestCreatedAt"))
 )));
COMMIT;
