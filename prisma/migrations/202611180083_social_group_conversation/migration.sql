BEGIN;
-- ADR 0067 (owner decision D7): one primary Messaging-owned conversation per
-- Social Group. Additive: a nullable Social-owned reservation column with a
-- unique index (single primary conversation under concurrent opens), and the
-- reviewed replacement of the Messaging source CHECK to admit 'SOCIAL_GROUP'.
-- No existing row becomes invalid: every current source is SOCIAL_ACTIVITY or NULL.
ALTER TABLE "SocialGroup" ADD COLUMN "conversationId" uuid;
CREATE UNIQUE INDEX "SocialGroup_conversationId_key" ON "SocialGroup"("conversationId");
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_source_check";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_source_check" CHECK (("sourceKind" IS NULL) = ("sourceId" IS NULL) AND ("sourceKind" IS NULL OR ("sourceKind" IN ('SOCIAL_ACTIVITY','SOCIAL_GROUP') AND "kind" = 'PRIVATE_GROUP')));
COMMIT;
