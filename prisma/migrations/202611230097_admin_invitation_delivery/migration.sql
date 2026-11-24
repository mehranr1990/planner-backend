ALTER TABLE "AdminDelivery" ALTER COLUMN "targetUserId" DROP NOT NULL;
ALTER TABLE "AdminDelivery" ADD COLUMN "recipientEmail" VARCHAR(320);
ALTER TABLE "AdminDelivery" ADD CONSTRAINT "AdminDelivery_recipient" CHECK("targetUserId" IS NOT NULL OR "recipientEmail" IS NOT NULL);
