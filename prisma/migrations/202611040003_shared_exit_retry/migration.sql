-- P2-01 bounded, observable retry for durable account-exit fanout.
ALTER TABLE "SharedExitWork" ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5);
ALTER TABLE "SharedExitWork" ADD COLUMN "nextAt" timestamptz(3) NOT NULL DEFAULT now();
ALTER TABLE "SharedExitWork" ADD COLUMN "failureCode" varchar(80);
CREATE INDEX "SharedExitWork_pending" ON "SharedExitWork"("completedAt",attempts,"nextAt","userId");
