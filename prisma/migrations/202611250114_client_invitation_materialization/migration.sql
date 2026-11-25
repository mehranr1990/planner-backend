-- Keep automatic in-app materialization private from the inviter's offer state,
-- revision and legacy proof-claim/revocation contracts.
ALTER TABLE "ConversationEmailInvitation" ADD COLUMN "inAppClaimed" boolean NOT NULL DEFAULT false;
ALTER TABLE "MeetingEmailInvitation" ADD COLUMN "inAppClaimed" boolean NOT NULL DEFAULT false;
