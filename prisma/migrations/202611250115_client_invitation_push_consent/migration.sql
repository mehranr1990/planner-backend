-- Retain the event boundary for rechecking messaging push consent after delays/restarts.
ALTER TABLE "InvitationPushAttempt" ADD COLUMN "eventAt" timestamptz(3) NOT NULL DEFAULT now();
