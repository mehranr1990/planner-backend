ALTER TABLE "ConversationMember" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConversationMember" ADD COLUMN "hiddenAt" TIMESTAMPTZ(3);
ALTER TABLE "ConversationMember" ADD COLUMN "deletedThrough" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_deleted_through_check" CHECK ("deletedThrough" >= 0);
